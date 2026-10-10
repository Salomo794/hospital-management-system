// Mobile money provider adapters.
//
// Every adapter implements the same three operations, so routes never learn
// which provider is behind them:
//
//   initializeCharge(details) -> the checkout the customer is sent to approve
//   verifyCharge(reference)   -> the authoritative current state of a charge
//   verifyWebhook(raw, sig)   -> whether a callback really came from the provider
//
// A charge is deliberately not treated as money until the provider says so.
// initializeCharge returning successfully only means the prompt was sent, not
// that the patient paid, which is why the caller writes a 'pending' row and
// waits for verifyCharge or a webhook to promote it to 'completed'.
const crypto = require('crypto');
const {
  PROVIDER_PAYSTACK,
  PROVIDER_MOCK,
  activeProviderName,
  activeNetworks,
  unavailableReason,
  paystackSettings,
  toMinorUnits,
  fromMinorUnits,
} = require('../config/mobileMoney');
const { ApiError } = require('../utils/http');

// Resolved per call rather than at require time, because the active market
// depends on configuration that tests and deployments set at different points.
const networkValues = () => new Set(activeNetworks().map(network => network.value));
const REQUEST_TIMEOUT_MS = 20000;

// Paystack reports these in `data.status`. "abandoned" means the customer
// dismissed the prompt, which for a bill is a failure, not a pending state.
const PAYSTACK_SUCCESS_STATUS = 'success';
const PAYSTACK_PENDING_STATUSES = new Set(['pending', 'processing', 'queued', 'ongoing', 'reversed']);

function isNetwork(value) {
  return typeof value === 'string' && networkValues().has(value);
}

function networkLabel(value) {
  return activeNetworks().find(network => network.value === value)?.label || value;
}

// Providers are country specific and reject most formatting variations, so the
// number is reduced to digits with an optional leading plus before it leaves.
function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (raw === '') return '';
  const compact = raw.replace(/[\s()\-.]/g, '');
  return /^\+\d{7,15}$/.test(compact) ? compact : compact.replace(/\D/g, '');
}

function isValidPhone(value) {
  const normalized = normalizePhone(value);
  return /^\+?\d{7,15}$/.test(normalized);
}

function toGatewayError(status, payload, context) {
  // Provider messages are written for humans and are the only useful
  // diagnostic when a network or country combination is unsupported, so they
  // are passed through rather than replaced with a generic message.
  const detail = payload?.message || payload?.data?.message || 'no reason given';
  return new ApiError(status, `${context}: ${detail}`);
}

function hmacSha512(secret, payload) {
  return crypto.createHmac('sha512', secret).update(payload).digest('hex');
}

// Paystack sends the body signed; a timing-safe compare keeps a valid signature
// from being guessable one byte at a time.
function signatureMatches(expected, received) {
  if (typeof received !== 'string' || received === '') return false;
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

const paystackAdapter = {
  name: PROVIDER_PAYSTACK,

  async initializeCharge({ amount, currency, reference, email, phone, network, callbackUrl }) {
    const settings = paystackSettings();
    const body = {
      email,
      amount: toMinorUnits(amount),
      currency: currency || settings.currency,
      reference,
      channels: ['mobile_money'],
      mobile_money: { phone: normalizePhone(phone), provider: network },
    };
    if (callbackUrl) body.callback_url = callbackUrl;

    let response;
    try {
      response = await fetch(`${settings.baseUrl}/transaction/initialize`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ApiError(502, `Mobile money provider is unreachable: ${error.message}`);
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.status) {
      throw toGatewayError(
        502,
        payload,
        `Paystack rejected the ${networkLabel(network)} request`
      );
    }
    return {
      providerReference: String(payload.data?.reference || reference),
      authorizationUrl: payload.data?.authorization_url || null,
      accessCode: payload.data?.access_code || null,
    };
  },

  async verifyCharge(reference) {
    const settings = paystackSettings();
    let response;
    try {
      response = await fetch(`${settings.baseUrl}/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${settings.secretKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ApiError(502, `Mobile money provider is unreachable: ${error.message}`);
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.status) {
      throw toGatewayError(502, payload, 'Paystack could not verify this charge');
    }
    return interpretGatewayStatus(payload.data, reference);
  },

  verifyWebhook(rawBody, signature) {
    return signatureMatches(hmacSha512(paystackSettings().webhookSecret, rawBody), signature);
  },
};

// Shared by both adapters so the status mapping cannot drift between them.
function interpretGatewayStatus(data, reference) {
  const status = String(data?.status || '').toLowerCase();
  const providerReference = data?.reference ? String(data.reference) : String(reference || '');
  const gatewayResponse = typeof data?.gateway_response === 'string' ? data.gateway_response : '';

  if (status === PAYSTACK_SUCCESS_STATUS) {
    return {
      status: 'completed',
      providerReference,
      amount: data?.amount === undefined ? null : fromMinorUnits(data.amount),
      currency: data?.currency || null,
      failureReason: null,
    };
  }
  if (PAYSTACK_PENDING_STATUSES.has(status)) {
    return { status: 'pending', providerReference, amount: null, currency: data?.currency || null, failureReason: null };
  }
  return {
    status: 'failed',
    providerReference,
    amount: null,
    currency: data?.currency || null,
    failureReason: gatewayResponse || `Payment ${status || 'did not complete'}`,
  };
}

// The mock provider keeps charges in memory for the life of the process. It
// exists so the pending -> completed lifecycle can be exercised end to end
// without a sandbox account, and it is unreachable in production.
const mockCharges = new Map();
const MOCK_SECRET = 'hms-mobile-money-mock-secret';

// This system's settlement states, expressed in Paystack's vocabulary.
const MOCK_STATUS_TO_GATEWAY = {
  completed: 'success',
  failed: 'failed',
  pending: 'pending',
};

const mockAdapter = {
  name: PROVIDER_MOCK,

  async initializeCharge({ amount, currency, reference, email, phone, network }) {
    // Paystack rejects a charge with no phone number or an unknown network
    // outright. The mock refuses the same inputs so a caller that forgets to
    // pass them fails in the test suite rather than on the first live payment.
    if (!isValidPhone(phone)) throw new ApiError(400, 'Mock provider: a valid phone number is required');
    if (!isNetwork(network)) throw new ApiError(400, 'Mock provider: an unknown network cannot be charged');
    if (!email) throw new ApiError(400, 'Mock provider: an email address is required');
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
      throw new ApiError(400, 'Mock provider: amount must be greater than zero');
    }

    const providerReference = `mock_${crypto.randomBytes(8).toString('hex')}`;
    mockCharges.set(reference, {
      providerReference,
      amount: toMinorUnits(amount),
      currency: currency || 'NGN',
      email,
      phone: normalizePhone(phone),
      network,
      status: 'pending',
      failureReason: null,
    });
    return { providerReference, authorizationUrl: null, accessCode: null };
  },

  async verifyCharge(reference) {
    const charge = mockCharges.get(reference);
    if (!charge) throw new ApiError(404, 'No such mobile money charge');
    // Providers report success as "success", not as this system's internal
    // "completed". The mock has to answer in the same vocabulary a real
    // gateway uses, or the shared status mapping reads a settled charge as a
    // failure.
    return interpretGatewayStatus(
      {
        status: MOCK_STATUS_TO_GATEWAY[charge.status] || charge.status,
        reference,
        amount: charge.amount,
        currency: charge.currency,
        // Carried the same way Paystack reports a decline, so the reason the
        // customer sees is the one the mock was settled with.
        gateway_response: charge.failureReason,
      },
      reference
    );
  },

  verifyWebhook(rawBody, signature) {
    return signatureMatches(hmacSha512(MOCK_SECRET, rawBody), signature);
  },
};

// Every provider this build can actually talk to. A new aggregator is added
// here and nowhere else: the billing and portal routes only ever call the three
// methods on an adapter, so nothing outside this file has to change.
const PROVIDER_ADAPTERS = {
  [PROVIDER_PAYSTACK]: paystackAdapter,
  [PROVIDER_MOCK]: mockAdapter,
};

function getAdapter() {
  const name = activeProviderName();
  // An unavailable reason explains a misconfiguration; a bare 503 would leave
  // the operator guessing why a configured provider is not being offered.
  const reason = unavailableReason();
  if (reason) throw new ApiError(503, reason);
  const adapter = name ? PROVIDER_ADAPTERS[name] : null;
  if (!adapter) {
    throw new ApiError(503, `No mobile money adapter is built for "${name || 'the selected provider'}".`);
  }
  return adapter;
}

// Test hook for the mock rail: stands in for the customer approving (or
// declining) the prompt, which is the one step a real provider performs.
function settleMockCharge(reference, { success = true, reason = null } = {}) {
  const charge = mockCharges.get(reference);
  if (!charge) return null;
  if (charge.status !== 'pending') return charge;
  charge.status = success ? 'completed' : 'failed';
  charge.failureReason = success ? null : reason || 'Payment declined by customer';
  return charge;
}

// Test hook: what the mock was actually asked to charge. Lets a test assert
// the real fields reached the provider rather than trusting the response.
function getMockCharge(reference) {
  return mockCharges.get(reference) || null;
}

function mockWebhookSignature(rawBody) {
  return hmacSha512(MOCK_SECRET, rawBody);
}

module.exports = {
  PROVIDER_ADAPTERS,
  getAdapter,
  isNetwork,
  networkLabel,
  normalizePhone,
  isValidPhone,
  interpretGatewayStatus,
  settleMockCharge,
  getMockCharge,
  mockWebhookSignature,
};
