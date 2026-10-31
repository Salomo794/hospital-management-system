const PLACEHOLDER_BACKUP_KEYS = new Set([
  '',
  'REPLACE_ME',
  'change-me',
  'change_this_to_a_secure_random_string',
]);

function isHttpsPublicUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      !value.endsWith('/');
  } catch {
    return false;
  }
}

function isHttpsOrigin(value) {
  try {
    const url = new URL(value);
    // Browser Origin headers contain only scheme, host and optional port.
    // Reject paths, credentials, and trailing slashes that would never match.
    return url.protocol === 'https:' && url.origin === value;
  } catch {
    return false;
  }
}

/**
 * Validate deployment settings that are required before production can handle
 * patient data. This cannot prove that a reverse proxy really terminates TLS;
 * it checks that the public URL and allowed browser origins are configured for
 * HTTPS and that password-reset mail and encrypted backups are ready.
 */
function productionReadinessErrors(env = process.env) {
  const errors = [];

  const publicUrl = String(env.PUBLIC_URL || '').trim();
  if (!isHttpsPublicUrl(publicUrl)) {
    errors.push('PUBLIC_URL must be an absolute HTTPS URL without credentials, query/hash, or a trailing slash.');
  }

  const rawOrigins = String(env.CORS_ORIGINS || '');
  const originEntries = rawOrigins.split(',').map(value => value.trim());
  const origins = originEntries.filter(Boolean);

  if (origins.length === 0) {
    errors.push('CORS_ORIGINS must contain at least one production HTTPS origin.');
  } else {
    const invalidOrigins = origins.filter(origin => !isHttpsOrigin(origin));
    if (invalidOrigins.length > 0 || originEntries.some(origin => !origin)) {
      errors.push('Every CORS_ORIGINS entry must be an HTTPS origin without a path or trailing slash; empty entries are not allowed.');
    }
  }

  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) {
    if (!String(env[key] || '').trim()) {
      errors.push(`${key} must be configured so production password resets can be delivered.`);
    }
  }

  const backupKey = String(env.BACKUP_ENCRYPTION_KEY || '').trim();
  if (PLACEHOLDER_BACKUP_KEYS.has(backupKey) || backupKey.length < 16) {
    errors.push('BACKUP_ENCRYPTION_KEY must be a non-placeholder secret of at least 16 characters, stored outside the repository.');
  }

  // MySQL is the only supported engine, so production must point at a real,
  // persistent server rather than an in-memory or loopback-only test database.
  const dbHost = String(env.DB_HOST || '').trim();
  if (!dbHost) {
    errors.push('DB_HOST must name the MySQL server in production.');
  } else if (dbHost === 'localhost' || dbHost === '127.0.0.1' || dbHost === '::1') {
    errors.push('DB_HOST must point at the managed MySQL server, not this process\'s loopback address.');
  }

  const dbName = String(env.DB_NAME || '').trim();
  if (!dbName) {
    errors.push('DB_NAME must name the production MySQL database.');
  } else if (dbName === 'test' || dbName === 'bootstrap') {
    errors.push(`DB_NAME must not be the throw-away "${dbName}" database in production.`);
  }

  if (!String(env.DB_USER || '').trim()) {
    errors.push('DB_USER must be configured for the production MySQL connection.');
  }

  const dbPassword = String(env.DB_PASSWORD || '');
  if (!dbPassword.trim()) {
    errors.push('DB_PASSWORD must be configured; the production database must not accept a passwordless account.');
  }

  const dbPort = String(env.DB_PORT || '').trim();
  if (dbPort && !/^\d+$/.test(dbPort)) {
    errors.push('DB_PORT must be a numeric TCP port.');
  }

  if (String(env.DB_PATH || '').trim()) {
    errors.push('DB_PATH is a SQLite setting and must be removed now that MySQL is the only database.');
  }

  return errors;
}

function assertProductionReadiness(env = process.env) {
  const errors = productionReadinessErrors(env);
  if (errors.length > 0) {
    throw new Error(
      '[production-readiness] Refusing to start with incomplete production configuration:\n' +
      errors.map(error => `  - ${error}`).join('\n') +
      '\nConfigure server/.env or the deployment environment, then restart.'
    );
  }
}

module.exports = { assertProductionReadiness, productionReadinessErrors };
