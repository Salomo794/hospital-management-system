class FixedWindowRateLimiter {
  constructor({ windowMs, max }) {
    this.windowMs = windowMs;
    this.max = max;
    this.entries = new Map();
  }

  consume(key) {
    const now = Date.now();
    let entry = this.entries.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.entries.set(key, entry);
    }

    entry.count += 1;
    if (this.entries.size > 10_000) {
      for (const [candidateKey, candidate] of this.entries) {
        if (candidate.resetAt <= now) this.entries.delete(candidateKey);
      }
    }

    return {
      allowed: entry.count <= this.max,
      remaining: Math.max(this.max - entry.count, 0),
      retryAfterSeconds: Math.max(Math.ceil((entry.resetAt - now) / 1000), 1),
    };
  }

  reset(key) {
    this.entries.delete(key);
  }
}

module.exports = { FixedWindowRateLimiter };
