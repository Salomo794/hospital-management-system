'use strict';

/**
 * Filesystem permission helpers for data at rest.
 *
 * SQLite creates its database and any file it writes with the process umask,
 * which is 644 on most Linux images. That makes a live patient database and its
 * backups readable by every local account on the host. The database holds PHI,
 * so the files should be owner-only (600) and their directory owner-only (700).
 *
 * These helpers are advisory: on filesystems that do not implement POSIX modes
 * (some container volume drivers, Windows) chmod throws EPERM/ENOSYS. A failure
 * to tighten permissions must never stop the server from booting or a backup
 * from being written, so errors are reported and swallowed.
 */

const fs = require('fs');

const OWNER_ONLY_FILE = 0o600;
const OWNER_ONLY_DIRECTORY = 0o700;

/**
 * Restrict a file to its owner. No-op on platforms without POSIX modes.
 *
 * @param {string} filePath absolute or relative path to the file
 * @param {{ silent?: boolean, label?: string }} [options]
 * @returns {boolean} true when the mode is (or already was) owner-only
 */
function restrictFile(filePath, options = {}) {
  const { silent = false, label = 'file' } = options;
  try {
    fs.chmodSync(filePath, OWNER_ONLY_FILE);
    return true;
  } catch (error) {
    // ENOENT is normal: callers may harden a path before it exists.
    if (error.code === 'ENOENT') return false;
    if (!silent) {
      console.warn(`[permissions] Could not restrict ${label} ${filePath} to owner-only: ${error.message}`);
    }
    return false;
  }
}

/**
 * Restrict a directory to its owner, so the filenames inside it are not
 * listable by other local accounts.
 *
 * @param {string} directoryPath
 * @param {{ silent?: boolean, label?: string }} [options]
 * @returns {boolean}
 */
function restrictDirectory(directoryPath, options = {}) {
  const { silent = false, label = 'directory' } = options;
  try {
    fs.chmodSync(directoryPath, OWNER_ONLY_DIRECTORY);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    if (!silent) {
      console.warn(`[permissions] Could not restrict ${label} ${directoryPath} to owner-only: ${error.message}`);
    }
    return false;
  }
}

/**
 * Harden a SQLite database plus the sidecar files WAL mode creates next to it.
 * `-wal` and `-shm` hold committed patient data until a checkpoint, so they need
 * the same protection as the main file.
 *
 * @param {string} databasePath
 * @returns {void}
 */
function restrictDatabaseFiles(databasePath) {
  if (!databasePath || databasePath === ':memory:') return;
  for (const suffix of ['', '-wal', '-shm']) {
    restrictFile(`${databasePath}${suffix}`, { silent: true, label: 'database file' });
  }
  restrictDirectory(require('path').dirname(databasePath), {
    silent: true,
    label: 'database directory',
  });
}

module.exports = {
  OWNER_ONLY_FILE,
  OWNER_ONLY_DIRECTORY,
  restrictFile,
  restrictDirectory,
  restrictDatabaseFiles,
};
