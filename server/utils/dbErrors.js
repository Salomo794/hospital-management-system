/**
 * Driver-agnostic classification of database constraint failures.
 *
 * The application used to inspect `SQLITE_CONSTRAINT*` codes directly, which
 * silently stopped matching after the MySQL cutover: MySQL reports the same
 * conditions as `ER_DUP_ENTRY`, `ER_NO_REFERENCED_ROW_2`,
 * `ER_ROW_IS_REFERENCED_2` and `ER_CHECK_CONSTRAINT_VIOLATED`, all under
 * SQLSTATE 23000 (3819 for CHECK). Both dialects are recognised here so a
 * conflict returns 409 rather than surfacing as a 500.
 */
const CONSTRAINT_CODES = new Set([
  'ER_DUP_ENTRY',
  'ER_NO_REFERENCED_ROW_2',
  'ER_ROW_IS_REFERENCED_2',
  'ER_CHECK_CONSTRAINT_VIOLATED',
  'ER_BAD_NULL_ERROR',
]);

function isConstraintError(error) {
  const code = String((error && error.code) || '');
  const state = String((error && (error.sqlState || error.sqlstate)) || '');
  const errno = Number(error && error.errno);
  // 1062 duplicate key, 1451/1452 foreign key, 3819 check constraint.
  return code.startsWith('SQLITE_CONSTRAINT')
    || CONSTRAINT_CODES.has(code)
    || state === '23000'
    || [1062, 1451, 1452, 3819].includes(errno);
}

/** True only for uniqueness conflicts, where the cause is a duplicate value. */
function isUniqueViolation(error) {
  const code = String((error && error.code) || '');
  return code === 'ER_DUP_ENTRY'
    || (error && error.isUniqueViolation === true)
    || Number(error && error.errno) === 1062
    || /UNIQUE constraint failed/i.test(String((error && error.message) || ''));
}

module.exports = { isConstraintError, isUniqueViolation };
