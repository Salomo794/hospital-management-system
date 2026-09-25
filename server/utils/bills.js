const { ApiError } = require('./http');
const { SETTLED_PAYMENT_STATUSES } = require('../config/paymentMethods');

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

// Only settled payments count. A mobile money charge the customer has not
// approved yet is sitting in the same table as a cash payment, and counting it
// would mark the bill paid before a single shilling has arrived. Filtering on
// the status here means every caller inherits that rule, so no code path can
// settle a bill from an unconfirmed charge.
const SETTLED_FILTER = SETTLED_PAYMENT_STATUSES.map(status => `'${status}'`).join(',');

// Recomputes a bill's paid total and status from the payment and refund ledger
// rather than by incrementing a running total. Deriving the figure means a
// bill can never drift out of step with the money actually recorded against
// it, and recording a payment and refunding one share the same code path.
async function recalculateBillPayment(connection, billId) {
  const [rows] = await connection.query(
    `SELECT b.id, b.net_amount,
            COALESCE((SELECT SUM(amount) FROM payments WHERE bill_id = b.id AND status IN (${SETTLED_FILTER})), 0)
            - COALESCE((SELECT SUM(amount) FROM payment_refunds WHERE bill_id = b.id), 0) AS ledger_paid
     FROM bills b WHERE b.id = ?`,
    [billId]
  );
  if (rows.length === 0) throw new ApiError(404, 'Bill not found');
  const bill = rows[0];
  // A ledger can never legitimately go negative, but clamping keeps a corrupted
  // row from turning into a negative bill total.
  const paidAmount = money(Math.max(Number(bill.ledger_paid), 0));
  const netAmount = Number(bill.net_amount);
  const paymentStatus = paidAmount >= netAmount ? 'paid' : paidAmount > 0 ? 'partial' : 'pending';
  await connection.query(
    'UPDATE bills SET paid_amount = ?, payment_status = ? WHERE id = ?',
    [paidAmount, paymentStatus, billId]
  );
  const [updated] = await connection.query('SELECT * FROM bills WHERE id = ?', [billId]);
  return updated[0];
}

module.exports = { money, recalculateBillPayment };
