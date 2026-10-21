// The browser origins whose responses the API is willing to serve.
//
// A browser sends an `Origin` header on every request it considers
// non-trivial, including same-origin POSTs, so an origin the API refuses is
// refused for the application's own pages too. That makes the allowlist
// part of whether the application works at all, not only part of whether it
// is safe.

const DEVELOPMENT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

/**
 * Split a comma-separated origin list into individual browser origins.
 * Blank entries are dropped here; the production readiness check is what
 * reports them, so a typo is never silently swallowed.
 */
function parseOrigins(value) {
  return String(value || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

/**
 * The origin of an address, e.g. `https://hms.example.org:8443`.
 * Returns null for anything that is not an absolute URL.
 */
function originOf(value) {
  try {
    return new URL(String(value || '').trim()).origin;
  } catch {
    return null;
  }
}

/**
 * Whether a value is exactly the origin a browser would put in an `Origin`
 * header: scheme, host and optional port, and nothing else. A path, a
 * trailing slash or embedded credentials can never match, so accepting one
 * would quietly allow nothing instead.
 */
function isHttpsOrigin(value) {
  try {
    const url = new URL(value);
    // Browser Origin headers contain only scheme, host and optional port.
    return url.protocol === 'https:' && url.origin === value;
  } catch {
    return false;
  }
}

/**
 * The browser origins the API will serve.
 *
 * In production the application's own public origin is always allowed. A
 * single-service deployment serves the client and the API from the same
 * address, so refusing that origin would break the deployment rather than
 * protect it. Any other origin - a separately hosted client, for instance -
 * has to be listed in CORS_ORIGINS explicitly.
 */
function resolveAllowedOrigins(env = process.env) {
  const configured = parseOrigins(env.CORS_ORIGINS);
  const own = originOf(env.PUBLIC_URL);

  if (env.NODE_ENV === 'production') {
    return new Set([own, ...configured].filter(Boolean));
  }
  return new Set([...DEVELOPMENT_ORIGINS, own, ...configured].filter(Boolean));
}

module.exports = {
  DEVELOPMENT_ORIGINS,
  isHttpsOrigin,
  originOf,
  parseOrigins,
  resolveAllowedOrigins,
};
