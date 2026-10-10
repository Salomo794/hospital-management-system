const path = require('path');
const dotenv = require('dotenv');

const serverDirectory = path.join(__dirname, '..');
const environmentPath = path.join(serverDirectory, '.env');
let loaded = false;

function loadEnvironment() {
  if (!loaded) {
    dotenv.config({ path: environmentPath, quiet: true });
    loaded = true;
  }
  return process.env;
}

module.exports = {
  environmentPath,
  loadEnvironment,
  serverDirectory,
};
