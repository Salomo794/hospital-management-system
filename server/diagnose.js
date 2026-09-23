// Diagnostic script — runs before the main app to surface startup errors
process.on('uncaughtException', (err) => {
  const fs = require('fs');
  fs.writeFileSync('diag-error.txt', err.stack || err.message, 'utf8');
  process.exit(1);
});

try {
  require('./index.js');
} catch (err) {
  const fs = require('fs');
  fs.writeFileSync('diag-error.txt', err.stack || err.message, 'utf8');
  process.exit(1);
}
