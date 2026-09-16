// Minimal in-memory sliding-window rate limiter.
// Protects auth endpoints from brute-force attempts without external dependencies.
// Note: in-memory only; fine for single-process deployments.
const buckets = new Map();
const CLEANUP_INTERVAL = 60 * 1000;

// Deterministic key when no IP is available (e.g. behind proxy misconfig)
function clientKey(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function rateLimit({ windowMs = 15 * 60 * 1000, max = 100, message = 'Too many requests, please try again later.' } = {}) {
  return (req, res, next) => {
    const key = clientKey(req);
    const now = Date.now();
    const bucket = buckets.get(key) || { hits: [], startedAt: now };

    // Drop expired hits
    bucket.hits = bucket.hits.filter(t => now - t < windowMs);

    if (bucket.hits.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - bucket.hits[0])) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({ message });
    }

    bucket.hits.push(now);
    buckets.set(key, bucket);
    next();
  };
}

// Periodically purge stale buckets to avoid unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter(t => now - t < 60 * 60 * 1000);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}, CLEANUP_INTERVAL).unref();

module.exports = { rateLimit };