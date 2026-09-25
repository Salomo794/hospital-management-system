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
  { value: 'upi', label: 'UPI / QR' },
  { value: 'online', label: 'Online' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque / Demand Draft' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'other', label: 'Other' },
];

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

// The canonical payments table shape, column order included, so the migration
// can copy existing rows into a rebuilt table without losing data.
const PAYMENTS_TABLE_COLUMNS = [
  'id',
  'uuid',
  'payment_number',
  'bill_id',
  'patient_id',
  'amount',
  'payment_method',
  'transaction_reference',
  'received_by',
  'payment_date',
  'notes',
  'created_at',
];

module.exports = {
  PAYMENT_METHODS,
  PAYMENT_METHOD_VALUES,
  PAYMENTS_TABLE_COLUMNS,
  isPaymentMethod,
  paymentMethodLabel,
  paymentMethodValueList,
  paymentMethodConstraint,
};
