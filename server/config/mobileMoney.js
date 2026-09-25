// Configuration for the mobile money rail.
//
// Mobile money is deliberately off unless it is both configured and allowed.
// Two independent switches matter here and they are easy to confuse:
//
//   MOBILE_MONEY_PROVIDER   which adapter to talk to ('paystack' or 'mock')
//   MOBILE_MONEY_ENABLED    whether the feature is offered at all
//
// The mock adapter is a development and test affordance only. It is refused in
// production even if it is explicitly selected, because a "simulated" charge
// that marks a real hospital bill as paid is a revenue hole, not a feature.
const { loadEnvironment } = require('./environment');

const PROVIDER_PAYSTACK = 'paystack';
const PROVIDER_MOCK = 'mock';
const SUPPORTED_PROVIDERS = [PROVIDER_PAYSTACK, PROVIDER_MOCK];

// The networks that can actually be charged, per market.
//
// These are Paystack's own provider codes and they are market-specific:
// Paystack's documentation lists mobile money for Ghana, Kenya and Côte
// d'Ivoire only. A network that is valid in one market is simply rejected in
// another, so the list is resolved from the configured market rather than
// hardcoded. Offering a network the account cannot charge produces a confusing
// failure at the moment a patient is standing at the counter.
//
// Rwanda is deliberately empty. Paystack holds a licence there and settles in
// RWF, but it does not offer the mobile money channel, so MTN MoMo and Airtel
// Money cannot be charged through it. A Rwandan deployment needs a different
// provider (Mukuru and Cellulant are those used for MTN and Airtel Rwanda),
// reached through a separate adapter.
const PAYSTACK_MARKET_NETWORKS = {
  ghana: [
    { value: 'mtn', label: 'MTN Mobile Money' },
    { value: 'atl', label: 'AirtelTigo Money' },
    { value: 'vod', label: 'Telecel (Vodafone Cash)' },
  ],
  kenya: [
    { value: 'mpesa', label: 'M-PESA' },
    { value: 'atl', label: 'Airtel Money' },
  ],
  ivory_coast: [
    { value: 'orange', label: 'Orange Money' },
    { value: 'mtn', label: 'MTN Mobile Money' },
    { value: 'wave', label: 'Wave' },
  ],
  // Licensed for card payments, but the mobile money channel is not offered.
  rwanda: [],
};

// The currency a market settles in. This lets a deployment configure only the
// currency it already bills in and have the market follow from it.
const CURRENCY_MARKETS = {
  GHS: 'ghana',
  KES: 'kenya',
  XOF: 'ivory_coast',
  RWF: 'rwanda',
};

const SUPPORTED_MARKETS = Object.keys(PAYSTACK_MARKET_NETWORKS);

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function readSetting(name, fallback = '') {
  loadEnvironment();
  const value = String(process.env[name] ?? '').trim();
  return value === '' ? fallback : value;
}

function flagEnabled(name) {
  return readSetting(name, 'false').toLowerCase() === 'true';
}

// The mock adapter is only ever allowed outside production.
function mockAllowed() {
  return !isProduction() && flagEnabled('MOBILE_MONEY_MOCK');
}

function paystackConfigured() {
  const key = readSetting('PAYSTACK_SECRET_KEY');
  // Both are the same secret in test mode; a real key is long and prefixed.
  return key !== '' && !key.includes('REPLACE');
}

function requestedProvider() {
  return readSetting('MOBILE_MONEY_PROVIDER', '').toLowerCase();
}

// The adapter actually in use, or null when mobile money is unavailable.
function activeProviderName() {
  if (!flagEnabled('MOBILE_MONEY_ENABLED')) return null;
  const requested = requestedProvider();
  if (mockAllowed()) return PROVIDER_MOCK;
  if (requested === PROVIDER_MOCK) return null;
  if (requested === PROVIDER_PAYSTACK || paystackConfigured()) {
    return paystackConfigured() ? PROVIDER_PAYSTACK : null;
  }
  return null;
}

function isMobileMoneyEnabled() {
  return activeProviderName() !== null;
}

function paystackSettings() {
  return {
    secretKey: readSetting('PAYSTACK_SECRET_KEY'),
    // Paystack signs webhooks with the same secret unless a dedicated one is set.
    webhookSecret: readSetting('PAYSTACK_WEBHOOK_SECRET') || readSetting('PAYSTACK_SECRET_KEY'),
    baseUrl: readSetting('PAYSTACK_BASE_URL', 'https://api.paystack.co'),
    currency: readSetting('PAYSTACK_CURRENCY', 'NGN').toUpperCase(),
    callbackUrl: readSetting('PAYSTACK_CALLBACK_URL'),
  };
}

// An explicit market wins; otherwise it is inferred from the currency, which is
// the setting a deployment is most likely to have right already.
function activeMarket() {
  const explicit = readSetting('PAYSTACK_MARKET', '').toLowerCase();
  if (explicit) return explicit;
  return CURRENCY_MARKETS[paystackSettings().currency] || '';
}

// The networks chargeable in the active market. The mock uses the Ghana list
// regardless, so the lifecycle can be exercised in any market.
function activeNetworks() {
  if (activeProviderName() === PROVIDER_MOCK) {
    return PAYSTACK_MARKET_NETWORKS.ghana;
  }
  return PAYSTACK_MARKET_NETWORKS[activeMarket()] || [];
}

// Why the rail cannot be offered, when it cannot. Surfaced to the operator
// rather than left to be diagnosed from a rejected charge at the counter.
function unavailableReason() {
  if (!flagEnabled('MOBILE_MONEY_ENABLED')) return 'Mobile money is switched off (MOBILE_MONEY_ENABLED).';
  if (activeProviderName() === PROVIDER_MOCK) return null;
  if (activeProviderName() === null) {
    return paystackConfigured()
      ? 'No mobile money provider is selected.'
      : 'PAYSTACK_SECRET_KEY is not set.';
  }
  const market = activeMarket();
  if (!market || !SUPPORTED_MARKETS.includes(market)) {
    return `Paystack market "${market || 'unset'}" is not recognised. Set PAYSTACK_MARKET to one of: ${SUPPORTED_MARKETS.join(', ')}.`;
  }
  if (activeNetworks().length === 0) {
    return `Paystack does not offer the mobile money channel in ${market}. `
      + 'MTN MoMo and Airtel Money are not chargeable through it in this market.';
  }
  return null;
}

// Paystack prices in the currency's minor unit (kobo for NGN, pesewas for GHS),
// so 100 units is 100. Rejecting an amount that cannot survive the round trip
// is the caller's job; this only converts.
function toMinorUnits(amount) {
  return Math.round(Number(amount) * 100);
}

function fromMinorUnits(amount) {
  return Math.round(Number(amount)) / 100;
}

// The shape the browser is allowed to see. No secret ever reaches here, and the
// client uses it to decide whether to show the mobile money form at all. A
// configured-but-unavailable rail reports why, so a misconfigured deployment
// is diagnosable from the UI instead of only from the server log.
function publicConfig() {
  const provider = activeProviderName();
  const reason = unavailableReason();
  const networks = activeNetworks();
  if (!provider || reason) {
    return { enabled: false, provider: null, networks: [], currency: null, reason };
  }
  return {
    enabled: true,
    provider,
    currency: provider === PROVIDER_PAYSTACK ? paystackSettings().currency : 'NGN',
    market: provider === PROVIDER_PAYSTACK ? activeMarket() : 'ghana',
    networks,
    reason: null,
  };
}

module.exports = {
  PROVIDER_PAYSTACK,
  PROVIDER_MOCK,
  SUPPORTED_PROVIDERS,
  PAYSTACK_MARKET_NETWORKS,
  SUPPORTED_MARKETS,
  CURRENCY_MARKETS,
  activeProviderName,
  activeMarket,
  activeNetworks,
  unavailableReason,
  isMobileMoneyEnabled,
  paystackConfigured,
  paystackSettings,
  toMinorUnits,
  fromMinorUnits,
  publicConfig,
  mockAllowed,
};
