const { isHttpsOrigin, parseOrigins } = require('./corsOrigins');

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

  // An unset list is a single-service deployment and is allowed. A blank entry
  // inside a list is a mistake, because it is an origin the operator meant to
  // name and did not.
  const hasBlankEntry = rawOrigins.trim() !== '' && originEntries.some(origin => !origin);
  const invalidOrigins = origins.filter(origin => !isHttpsOrigin(origin));
  if (invalidOrigins.length > 0 || hasBlankEntry) {
    errors.push('Every CORS_ORIGINS entry must be an HTTPS origin without a path or trailing slash; empty entries are not allowed.');
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

  if (String(env.DB_PATH || '').trim() === ':memory:') {
    errors.push('DB_PATH must point to a persistent database file in production.');
  }

  return errors;
}

/**
 * Settings that are legal but worth saying out loud.
 *
 * An empty CORS_ORIGINS list is a valid single-service deployment, because
 * the application's own origin is always allowed. It does mean that no
 * separately hosted client can reach the API, which is a surprise worth
 * reporting rather than leaving to be discovered in the browser console.
 */
function productionReadinessWarnings(env = process.env) {
  const warnings = [];

  if (parseOrigins(env.CORS_ORIGINS).length === 0) {
    warnings.push(
      'CORS_ORIGINS is empty, so only the application\'s own origin (PUBLIC_URL) may call the API. ' +
      'Add the client origin if the client is hosted separately.'
    );
  }

  return warnings;
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

module.exports = {
  assertProductionReadiness,
  productionReadinessErrors,
  productionReadinessWarnings,
};
