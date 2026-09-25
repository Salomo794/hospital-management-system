// Orchestration shared by the staff billing route and the patient portal.
//
// The order of operations matters more than it looks. SQLite here is a single
// connection behind a serialized write queue, so holding a transaction open
// across a provider HTTP call would block every other write in the process for
// the length of that call. Each step below therefore commits before the next
// network round trip:
//
//   1. validate and write the 'pending' row   (transaction)
//   2. ask the provider to send the prompt   (no lock held)
//   3. record the provider's charge id       (transaction)
//
// Step 1 commits before step 2 so that a duplicate tap cannot open two charges,
// and so a provider outage still leaves an auditable pending row rather than
// nothing at all.
const { ApiError } = require('../utils/http');
const { randomUUID, generateRecordNumber } = require('../utils/ids');
const { recalculateBillPayment } = require('../utils/bills');
const { recordAudit } = require('../utils/audit');
const {
  MOBILE_MONEY_METHOD,
  PENDING_PAYMENT_STATUS,
  COMPLETED_PAYMENT_STATUS,
} = require('../config/paymentMethods');
const { getAdapter } = require('./mobileMoney');
const { normalizePhone, isValidPhone, isNetwork, networkLabel } = require('./mobileMoney');

// Terminal states. A charge that has already reached one of these must never be
// moved again, which is what makes webhook redelivery harmless.
const TERMINAL_STATUSES = new Set([COMPLETED_PAYMENT_STATUS, 'failed', 'cancelled']);

function maskPhone(phone) {
  const normalized = normalizePhone(phone);
  if (normalized.length < 4) return '****';
  return `${'*'.repeat(Math.max(normalized.length - 4, 0))}${normalized.slice(-4)}`;
}

// Normalizes the three provider-facing fields the caller has to supply.
// Returns them together because a partial return is how a request ends up
// reaching the provider with no phone number on it.
function validateRequest({ phone, network, email }) {
  if (!isValidPhone(phone)) {
    throw new ApiError(400, 'A valid mobile money phone number is required');
  }
  if (!isNetwork(network)) {
    throw new ApiError(400, 'Unsupported mobile money network');
  }
  let normalizedEmail = null;
  if (email !== undefined && email !== null && email !== '') {
    const value = String(email).trim();
    // Providers reject a bad address asynchronously, which shows up much later
    // as a charge that never completes, so it is caught up front instead.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new ApiError(400, 'A valid email address is required for mobile money payments');
    }
    normalizedEmail = value;
  }
  return { phone: normalizePhone(phone), network, email: normalizedEmail };
}

// Step 1. Writes the pending row, or explains why this bill cannot be charged.
async function createPendingPayment({ connection, req, bill, amount, phone, network, email, receivedBy, notes, prefix = 'PAY', reference = null }) {
  const [existingPending] = await connection.query(
    `SELECT id, payment_number FROM payments
     WHERE bill_id = ? AND payment_method = ? AND status = ?`,
    [bill.id, MOBILE_MONEY_METHOD, PENDING_PAYMENT_STATUS]
  );
  if (existingPending.length > 0) {
    // Without this, a double tap sends two prompts for the same balance and a
    // patient who approves both leaves the bill overpaid.
    throw new ApiError(
      409,
      `A mobile money request of ${existingPending[0].payment_number} is still awaiting this patient. `
      + 'Wait for it to complete or fail before sending another.'
    );
  }

  const outstanding = Number(bill.outstanding);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ApiError(400, 'amount must be greater than zero');
  }
  // A partial mobile money charge is not offered: reconciling a fraction of a
  // bill against a provider settlement is a manual job, so the request has to
  // be for the balance in full.
  if (Math.abs(amount - outstanding) > 0.005) {
    throw new ApiError(400, `Mobile money must cover the full outstanding balance of ${outstanding.toFixed(2)}`);
  }

  const paymentNumber = generateRecordNumber(prefix);
  // The record number doubles as the provider reference. It is already unique,
  // and the unique index on transaction_reference then makes a replayed request
  // collide at the database level rather than creating a second charge. The
  // portal overrides it with its own request-scoped reference so a retried
  // submit resolves to the charge already in flight instead of a second one.
  const providerReference = reference || paymentNumber;
  const [result] = await connection.query(
    `INSERT INTO payments
       (uuid, payment_number, bill_id, patient_id, amount, payment_method, status,
        transaction_reference, provider, received_by, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [
      randomUUID(), paymentNumber, bill.id, bill.patient_id, amount, MOBILE_MONEY_METHOD,
      PENDING_PAYMENT_STATUS, providerReference, receivedBy ?? null,
      notes || `Mobile money request to ${networkLabel(network)} ending ${maskPhone(phone)}`,
    ]
  );
  return {
    paymentId: result.insertId,
    paymentNumber,
    reference: providerReference,
    amount,
    phone: normalizePhone(phone),
    network,
    email,
  };
}

// Step 2. Outside any transaction, on purpose. See the note at the top.
async function requestChargeFromProvider(pending, { callbackUrl } = {}) {
  const adapter = getAdapter();
  const result = await adapter.initializeCharge({
    amount: pending.amount,
    currency: undefined,
    reference: pending.reference,
    email: pending.email,
    phone: pending.phone,
    network: pending.network,
    callbackUrl,
  });
  return { adapter, result };
}

// Step 3. Attaches the provider's own charge id to the row.
async function attachProviderReference({ connection, paymentId, provider, providerReference }) {
  await connection.query(
    'UPDATE payments SET provider = ?, provider_reference = ? WHERE id = ?',
    [provider, providerReference, paymentId]
  );
}

// Promotes or fails a pending charge from an authoritative provider answer.
// Re-entrant on purpose: the same call arriving twice is a no-op.
async function applyGatewayResult({ connection, req, paymentId, result }) {
  const [rows] = await connection.query('SELECT * FROM payments WHERE id = ?', [paymentId]);
  if (rows.length === 0) throw new ApiError(404, 'Payment not found');
  const payment = rows[0];
  if (TERMINAL_STATUSES.has(payment.status)) {
    return { payment, bill: await recalculateBillPayment(connection, payment.bill_id), changed: false };
  }

  const status = result.status === COMPLETED_PAYMENT_STATUS ? COMPLETED_PAYMENT_STATUS : result.status;
  await connection.query(
    `UPDATE payments
     SET status = ?, provider_reference = COALESCE(?, provider_reference),
         failure_reason = ?, completed_at = CASE WHEN ? = 'completed' THEN datetime('now') ELSE NULL END
     WHERE id = ?`,
    [status, result.providerReference || null, result.failureReason || null, status, paymentId]
  );

  const bill = await recalculateBillPayment(connection, payment.bill_id);
  await recordAudit({
    req,
    connection,
    action: status === COMPLETED_PAYMENT_STATUS
      ? 'billing.mobile_money.settled'
      : 'billing.mobile_money.failed',
    table: 'payments',
    recordId: paymentId,
    summary: `${payment.payment_number} ${status} for bill ${payment.bill_id}`
      + (result.failureReason ? `: ${result.failureReason}` : ''),
    before: { status: payment.status, bill_paid_amount: null },
    after: {
      payment_number: payment.payment_number,
      bill_id: payment.bill_id,
      amount: payment.amount,
      status,
      provider_reference: result.providerReference || null,
      failure_reason: result.failureReason || null,
      bill_paid_amount: bill.paid_amount,
      bill_payment_status: bill.payment_status,
    },
  });
  return { payment: { ...payment, status }, bill, changed: true };
}

// Staff abandoning a request before the patient responds.
async function cancelPendingPayment({ connection, req, paymentId }) {
  const [rows] = await connection.query('SELECT * FROM payments WHERE id = ?', [paymentId]);
  if (rows.length === 0) throw new ApiError(404, 'Payment not found');
  const payment = rows[0];
  if (payment.status !== PENDING_PAYMENT_STATUS) {
    throw new ApiError(409, `This request is already ${payment.status} and can no longer be cancelled`);
  }
  await connection.query(
    "UPDATE payments SET status = 'cancelled', failure_reason = ? WHERE id = ?",
    ['Cancelled before the customer responded', paymentId]
  );
  const bill = await recalculateBillPayment(connection, payment.bill_id);
  await recordAudit({
    req,
    connection,
    action: 'billing.mobile_money.cancelled',
    table: 'payments',
    recordId: paymentId,
    summary: `${payment.payment_number} cancelled by staff`,
    after: { payment_number: payment.payment_number, status: 'cancelled' },
  });
  return { payment: { ...payment, status: 'cancelled' }, bill };
}

module.exports = {
  validateRequest,
  createPendingPayment,
  requestChargeFromProvider,
  attachProviderReference,
  applyGatewayResult,
  cancelPendingPayment,
  maskPhone,
};
