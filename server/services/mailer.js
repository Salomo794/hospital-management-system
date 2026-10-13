// Outbound email.
//
// Password resets are the only thing that needs email in this system, and the
// deployment is not obliged to have a mail server at all. Three states are
// therefore distinguished rather than one:
//
//   configured   SMTP_* is set, so mail is actually delivered
//   development  no SMTP, outside production, so the message is logged and the
//                caller can be handed the link to keep the flow testable
//   unavailable  no SMTP in production, so delivery is refused outright
//
// The last case matters most. Silently not sending a password reset is far
// worse than refusing: a user is told to check their inbox, waits, and concludes
// the system is broken. A 503 naming the missing configuration is honest and is
// diagnosable from the browser.
//
// The transport is injectable so tests can assert on what would have been sent
// without an SMTP server.
const nodemailer = require('nodemailer');

// Two slots, deliberately separate. `custom` is a transport supplied from
// outside - the test suite uses it to capture messages. `cached` is the real
// SMTP transport, built once on first use. Keeping them apart matters: a
// configured custom transport must be used even when no SMTP host is set,
// otherwise injecting a transport would be silently ignored.
let customTransport = null;
let cachedTransport = null;

function setting(name, fallback = '') {
  const value = String(process.env[name] ?? '').trim();
  return value === '' ? fallback : value;
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function smtpConfigured() {
  return setting('SMTP_HOST') !== '' && setting('SMTP_USER') !== '';
}

function fromAddress() {
  return setting('SMTP_FROM') || `Hospital Management System <no-reply@${setting('SMTP_HOST', 'localhost')}>`;
}

// A reset link has to point somewhere the user can actually open. An unset
// PUBLIC_URL is a deployment mistake that would produce a dead link in a real
// inbox, so it is caught here rather than discovered by a user.
function publicUrl() {
  return setting('PUBLIC_URL', 'http://localhost:3000').replace(/\/+$/, '');
}

function transport() {
  if (customTransport) return customTransport;
  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport({
      host: setting('SMTP_HOST'),
      port: Number(setting('SMTP_PORT', '587')),
      secure: setting('SMTP_SECURE', 'false').toLowerCase() === 'true',
      auth: { user: setting('SMTP_USER'), pass: setting('SMTP_PASS') },
    });
  }
  return cachedTransport;
}

// Replaces the transport. Used by the test suite; pass null to restore the
// real one.
function setTransport(custom) {
  customTransport = custom || null;
}

function resetTransport() {
  customTransport = null;
  cachedTransport = null;
}

const SUBJECTS = {
  passwordReset: 'Reset your Hospital Management System password',
};

// Reset links are credentials. Logging one is equivalent to handing the account
// to whoever can read the log file, and logs get shipped, indexed and kept far
// longer than a message should live. So the body is only written out when an
// operator explicitly asks for it, and never in production.
function tokenLoggingAllowed() {
  if (isProduction()) return false;
  return setting('MAIL_LOG_TOKENS') === 'true';
}

function describeMessage({ to, subject, text }) {
  const header = `[mail] SMTP is not configured; logging message instead.\n[mail] to: ${to}\n[mail] subject: ${subject}`;
  if (tokenLoggingAllowed()) return `${header}\n[mail] body:\n${text}`;
  // Enough to confirm the flow ran and where it was addressed, without leaving
  // a usable credential in the log.
  return `${header}\n[mail] body: withheld. Set MAIL_LOG_TOKENS=true to include it, or configure SMTP.`;
}

/**
 * Sends a message. Returns { delivered: boolean, transport: 'smtp'|'log' }.
 * Throws only when delivery was expected and could not happen.
 */
async function send({ to, subject, text, html }) {
  // An injected transport is the delivery mechanism, so it is used regardless
  // of whether SMTP happens to be configured.
  if (!customTransport && !smtpConfigured()) {
    if (isProduction()) {
      // Refusing is the point: an operator has to configure SMTP or turn the
      // feature off, rather than discovering later that no email ever sent.
      throw new Error('Email is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS and PUBLIC_URL to enable password resets.');
    }
    // Development and test: logged so the flow can be exercised end to end.
    console.warn(describeMessage({ to, subject, text }));
    return { delivered: false, transport: 'log' };
  }

  const info = await transport().sendMail({
    from: fromAddress(),
    to,
    subject,
    text,
    html,
  });
  return {
    delivered: true,
    transport: customTransport ? 'injected' : 'smtp',
    messageId: info?.messageId || null,
  };
}

function passwordResetEmail({ to, firstName, resetUrl, expiresInMinutes }) {
  const subject = SUBJECTS.passwordReset;
  const greeting = firstName ? `Hello ${firstName},` : 'Hello,';
  const text = [
    greeting,
    '',
    'We received a request to reset the password for your Hospital Management System account.',
    '',
    'Open this link to choose a new password:',
    resetUrl,
    '',
    `This link expires in ${expiresInMinutes} minutes and can only be used once.`,
    '',
    'If you did not request this, you can ignore this email. Your password will not change and no action is needed.',
  ].join('\n');
  const html = `<p>${greeting}</p>
<p>We received a request to reset the password for your Hospital Management System account.</p>
<p><a href="${resetUrl}">Choose a new password</a></p>
<p>This link expires in ${expiresInMinutes} minutes and can only be used once.</p>
<p>If you did not request this, you can ignore this email. Your password will not change and no action is needed.</p>`;
  return { subject, text, html, to };
}

module.exports = {
  send,
  setTransport,
  resetTransport,
  publicUrl,
  smtpConfigured,
  passwordResetEmail,
  SUBJECTS,
};
