const PLACEHOLDER_BACKUP_KEYS = new Set(['', 'REPLACE_ME', 'change-me', 'change_this_to_a_secure_random_string']);

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
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

  if (!isHttpsUrl(String(env.PUBLIC_URL || ''))) {
    errors.push('PUBLIC_URL must be an absolute https:// URL.');
  }

  const origins = String(env.CORS_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    errors.push('CORS_ORIGINS must contain at least one production https:// origin.');
  } else {
    const invalidOrigins = origins.filter(origin => !isHttpsOrigin(origin));
    if (invalidOrigins.length > 0) {
      errors.push('Every CORS_ORIGINS entry must be an HTTPS origin without a path or trailing slash.');
    }
  }

  for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) {
    if (!String(env[key] || '').trim()) {
      errors.push(`${key} must be configured so production password resets can be delivered.`);
    }
  }

  const backupKey = String(env.BACKUP_ENCRYPTION_KEY || '').trim();
  if (PLACEHOLDER_BACKUP_KEYS.has(backupKey)) {
    errors.push('BACKUP_ENCRYPTION_KEY must be set to a non-placeholder secret stored outside the repository.');
  }

  if (String(env.DB_PATH || '').trim() === ':memory:') {
    errors.push('DB_PATH must point to a persistent database file in production.');
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
