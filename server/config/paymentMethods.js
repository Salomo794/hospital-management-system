// Single source of truth for the payment methods the API accepts.
//
// Add or remove an entry in PAYMENT_METHODS and everything stays in sync:
// the request validators in routes/billing.js and routes/portal.js, the
// CHECK constraint on the payments table, and the dropdowns in the client
// (which reads the list from GET /api/billing/payment-methods).
//
// The order below is the order staff see in the dropdowns.
const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'mobile_wallet', label: 'Mobile Wallet' },
  { value: 'mobile_money', label: 'Mobile Money' },
  { value: 'upi', label: 'UPI / QR' },
  { value: 'online', label: 'Online' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque / Demand Draft' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'other', label: 'Other' },
];

// Mobile money is the one method that is not settled the moment staff press
// save: the customer has to approve a prompt on their own handset first. Its
// rows therefore start out 'pending' and only count towards a bill once the
// provider confirms. Every other method is collected in hand, so it lands as
// 'completed' immediately and this list is only consulted for those.
const MOBILE_MONEY_METHOD = 'mobile_money';
const PENDING_PAYMENT_STATUS = 'pending';
const COMPLETED_PAYMENT_STATUS = 'completed';
const PAYMENT_STATUSES = ['pending', 'completed', 'failed', 'cancelled'];

// Anything that is not 'pending' or 'failed' counts as collected money.
const SETTLED_PAYMENT_STATUSES = ['completed'];

// Payment method values are interpolated into DDL below, so keep them to a
// strict identifier shape. Failing loudly at require time is far better than
// emitting a malformed CHECK constraint.
const SAFE_METHOD_VALUE = /^[a-z][a-z0-9_]*$/;
for (const method of PAYMENT_METHODS) {
  if (!SAFE_METHOD_VALUE.test(method.value)) {
    throw new Error(`[paymentMethods] "${method.value}" is not a valid payment method identifier`);
  }
}

const PAYMENT_METHOD_VALUES = PAYMENT_METHODS.map(method => method.value);
const PAYMENT_METHOD_LABELS = new Map(PAYMENT_METHODS.map(method => [method.value, method.label]));

function isPaymentMethod(value) {
  return typeof value === 'string' && PAYMENT_METHOD_VALUES.includes(value);
}

function paymentMethodLabel(value) {
  return PAYMENT_METHOD_LABELS.get(value) || value;
}

// Used by setup.js and the payments-table migration to build the DDL, so the
// database constraint can never drift from the validators.
function paymentMethodValueList() {
  return PAYMENT_METHOD_VALUES.map(value => `'${value}'`).join(',');
}

function paymentMethodConstraint(column = 'payment_method') {
  return `CHECK(${column} IN (${paymentMethodValueList()}))`;
}

// Mirrors paymentMethodConstraint() for the settlement state of a payment.
function paymentStatusConstraint(column = 'status') {
  return `CHECK(${column} IN (${PAYMENT_STATUSES.map(status => `'${status}'`).join(',')}))`;
}

function isPaymentStatus(value) {
  return typeof value === 'string' && PAYMENT_STATUSES.includes(value);
}

// The canonical payments table shape, column order included, so the migration
// can copy existing rows into a rebuilt table without losing data. The status
// and provider columns are what let an unconfirmed mobile money charge sit in
// the table without being mistaken for collected money.
const PAYMENTS_TABLE_COLUMNS = [
  'id',
  'uuid',
  'payment_number',
  'bill_id',
  'patient_id',
  'amount',
  'payment_method',
  'status',
  'transaction_reference',
  'provider',
  'provider_reference',
  'failure_reason',
  'received_by',
  'payment_date',
  'completed_at',
  'notes',
  'created_at',
];

module.exports = {
  PAYMENT_METHODS,
  PAYMENT_METHOD_VALUES,
  PAYMENTS_TABLE_COLUMNS,
  PAYMENT_STATUSES,
  SETTLED_PAYMENT_STATUSES,
  MOBILE_MONEY_METHOD,
  PENDING_PAYMENT_STATUS,
  COMPLETED_PAYMENT_STATUS,
  isPaymentMethod,
  isPaymentStatus,
  paymentMethodLabel,
  paymentMethodValueList,
  paymentMethodConstraint,
  paymentStatusConstraint,
};
