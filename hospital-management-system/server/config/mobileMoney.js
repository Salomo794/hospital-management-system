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

// The networks that exist in each market, and separately the subset this provider
// can actually charge. Those are two different lists, and conflating them is how a
// deployment ends up advertising a payment method it cannot take.
//
// Paystack's documentation lists mobile money for Ghana, Kenya and Côte d'Ivoire
// only. Rwanda is a real mobile money market - MTN MoMo and Airtel Money are how
// patients there actually pay, and RWF is the currency - but Paystack holds a
// licence and settles in RWF without offering the channel.
//
// So Rwanda's networks are listed as market data, and PAYSTACK_CHARGEABLE_MARKETS
// is what says which markets this provider can take. A Rwandan deployment needs a
// provider that serves the country (Mukuru for MTN, Cellulant for Airtel) behind
// its own adapter; until one exists, Paystack keeps refusing Rwanda in production.
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
  rwanda: [
    { value: 'mtn', label: 'MTN MoMo' },
    { value: 'atl', label: 'Airtel Money' },
  ],
};

// The markets Paystack actually offers the mobile money channel in. Rwanda is
// absent on purpose: the networks above are real there, this provider cannot take them.
const PAYSTACK_CHARGEABLE_MARKETS = ['ghana', 'kenya', 'ivory_coast'];

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

// Lets a build whose market Paystack cannot serve - Rwanda today - exercise the
// real network codes for that market locally, without a provider account for it.
//
// Development and test only, for the same reason the mock is: a charge that can
// never succeed must not be advertised to a patient standing at a counter. This is
// refused outright when NODE_ENV=production, so the override cannot ship by
// accident, and it changes which networks are *offered* - it does not make Paystack
// start accepting Rwandan charges.
function unsupportedMarketAllowed() {
  return !isProduction() && flagEnabled('PAYSTACK_ALLOW_UNSUPPORTED_MARKET');
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
  // An explicitly configured provider wins over the development mock. If the
  // mock could take precedence, a developer pointing the app at real sandbox
  // keys would be silently served simulated charges, and every test would
  // pass against a provider that is not the one they are deploying.
  if (requested) {
    if (requested === PROVIDER_MOCK) return mockAllowed() ? PROVIDER_MOCK : null;
    if (!SUPPORTED_PROVIDERS.includes(requested)) return null;
    return requested === PROVIDER_PAYSTACK && paystackConfigured() ? PROVIDER_PAYSTACK : null;
  }
  if (mockAllowed()) return PROVIDER_MOCK;
  return paystackConfigured() ? PROVIDER_PAYSTACK : null;
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
// regardless, so the pending -> settled lifecycle can be exercised in any market
// without that market having to be one the configured currency resolves to.
function activeNetworks() {
  if (activeProviderName() === PROVIDER_MOCK) {
    return PAYSTACK_MARKET_NETWORKS.ghana;
  }
  const market = activeMarket();
  // A market this provider cannot charge offers nothing, even though its networks
  // are known. That is the difference that keeps a Rwandan build from showing a
  // patient an MTN MoMo button that would fail at the point of payment.
  if (PAYSTACK_CHARGEABLE_MARKETS.includes(market) || unsupportedMarketAllowed()) {
    return PAYSTACK_MARKET_NETWORKS[market] || [];
  }
  return [];
}

// Why the rail cannot be offered, when it cannot. Surfaced to the operator
// rather than left to be diagnosed from a rejected charge at the counter.
function unavailableReason() {
  if (!flagEnabled('MOBILE_MONEY_ENABLED')) return 'Mobile money is switched off (MOBILE_MONEY_ENABLED).';
  if (activeProviderName() === PROVIDER_MOCK) return null;
  const requested = requestedProvider();
  if (requested && !SUPPORTED_PROVIDERS.includes(requested)) {
    // Naming the value matters: collapsing this into "no provider selected"
    // would look like a configuration mistake rather than the real problem,
    // which is that this build ships no adapter for it.
    return `"${requested}" is not a provider this build can use. Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}.`;
  }
  if (requested === PROVIDER_MOCK && !mockAllowed()) {
    return 'The mock provider is development and test only, and is refused when NODE_ENV=production.';
  }
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
    if (unsupportedMarketAllowed()) {
      return `PAYSTACK_ALLOW_UNSUPPORTED_MARKET is on, but no mobile money networks are defined for "${market || 'unset'}".`;
    }
    // The wording is the operator's only clue, so it names the country, the
    // networks that are really there, and the way out.
    return `Paystack does not offer the mobile money channel in ${market}. `
      + 'MTN MoMo and Airtel Money are not chargeable through it in this market. '
      + 'A Rwandan deployment needs a provider that serves Rwanda, such as Mukuru or Cellulant, '
      + 'behind its own adapter. Outside production, PAYSTACK_ALLOW_UNSUPPORTED_MARKET=true '
      + 'exposes the local networks for development.';
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
  PAYSTACK_CHARGEABLE_MARKETS,
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
  unsupportedMarketAllowed,
};
