function intervalExpression(source, amount, unit, direction, timestamp) {
  const operation = direction === '-' ? 'DATE_SUB' : 'DATE_ADD';
  const base = timestamp ? 'CURRENT_TIMESTAMP' : 'CURRENT_DATE';
  const value = source.toLowerCase() === "'now'" ? base : `DATE(${source})`;
  return `${operation}(${value}, INTERVAL ${amount} ${unit.toUpperCase()})`;
}

const LONG_TEXT_COLUMNS = new Set([
  'address',
  'allergies',
  'bio',
  'chronic_conditions',
  'clinical_management',
  'clinical_notes',
  'description',
  'diagnosis',
  'emergency_contact_name',
  'history_of_present_illness',
  'instructions',
  'message',
  'notes',
  'old_values',
  'new_values',
  'physical_examination',
  'reason',
  'summary',
  'treatment_plan',
  'vital_signs',
]);

const DATE_COLUMNS = new Set([
  'appointment_date',
  'checkin_date',
  'date_of_birth',
  'due_date',
  'expected_date',
  'expiry_date',
  'prescribed_date',
]);

const TIME_COLUMNS = new Set(['appointment_time', 'end_time']);

const DATETIME_COLUMNS = new Set([
  'admission_date',
  'completed_at',
  'completed_date',
  'created_at',
  'discharge_date',
  'last_login',
  'loaded_at',
  'order_date',
  'payment_date',
  'record_date',
  'received_at',
  'refund_date',
  'result_date',
  'submitted_at',
  'approved_at',
  'updated_at',
  'used_at',
  'checkin_time',
  'expires_at',
]);

function mysqlTextType(columnName) {
  if (DATE_COLUMNS.has(columnName)) return 'DATE';
  if (TIME_COLUMNS.has(columnName)) return 'TIME';
  if (DATETIME_COLUMNS.has(columnName) || columnName.endsWith('_at')) return 'DATETIME';
  if (LONG_TEXT_COLUMNS.has(columnName)) return 'LONGTEXT';
  return 'VARCHAR(255)';
}

function translateCreateTable(sql) {
  let translated = sql
    .replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'INT NOT NULL AUTO_INCREMENT PRIMARY KEY')
    .replace(/\bINTEGER\b/gi, 'INT')
    .replace(/\bREAL\b/gi, 'DOUBLE');

  translated = translated.replace(
    /^(\s*)([A-Za-z_][\w]*)\s+TEXT\b(.*)$/gim,
    (_match, indentation, column, suffix) => `${indentation}${column} ${mysqlTextType(column)}${suffix}`
  );
  translated = translated.replace(/\bdatetime\('now'\)/gi, 'CURRENT_TIMESTAMP');
  translated = translated.replace(/\bdate\('now'\)/gi, 'CURRENT_DATE');
  translated = translated.replace(/DEFAULT\s*\(\s*CURRENT_TIMESTAMP\s*\)/gi, 'DEFAULT CURRENT_TIMESTAMP');
  translated = translated.replace(/DATE\s+DEFAULT\s+CURRENT_DATE\b/gi, 'DATE DEFAULT (CURRENT_DATE)');
  translated = translated.replace(/DATE\s+NOT\s+NULL\s+DEFAULT\s+CURRENT_DATE\b/gi, 'DATE NOT NULL DEFAULT (CURRENT_DATE)');
  translated = translated.replace(
    /(\bupdated_at\s+DATETIME\s+DEFAULT)\s*CURRENT_TIMESTAMP(?!\s+ON UPDATE)/gi,
    '$1 CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
  );
  translated = translated.replace(
    /\)\s*;?\s*$/,
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci'
  );
  return translated;
}

function translateSql(sql) {
  let translated = String(sql);
  if (/^\s*CREATE\s+TABLE\b/i.test(translated)) {
    translated = translateCreateTable(translated);
  }

  translated = translated.replace(
    /\b(datetime|date)\(\s*('now'|\?)\s*,\s*'([+-])(\d+)\s+(minute|hour|day|week|month|year)s?'\s*\)/gi,
    (_match, fn, source, direction, amount, unit) => intervalExpression(
      source,
      amount,
      unit,
      direction,
      fn.toLowerCase() === 'datetime'
    )
  );
  translated = translated.replace(/\bdatetime\(\s*'now'\s*\)/gi, 'CURRENT_TIMESTAMP');
  translated = translated.replace(/\bdate\(\s*'now'\s*\)/gi, 'CURRENT_DATE');
  translated = translated.replace(/\bdate\(\s*([A-Za-z_][\w$.]*)\s*\)/gi, 'DATE($1)');
  translated = translated.replace(
    /\bstrftime\(\s*'%Y-%m'\s*,\s*([A-Za-z_][\w$.]*)\s*\)/gi,
    'DATE_FORMAT($1, \'%Y-%m\')'
  );
  translated = translated.replace(
    /\bstrftime\(\s*'%Y%W'\s*,\s*([A-Za-z_][\w$.]*)\s*\)/gi,
    'DATE_FORMAT($1, \'%Y%u\')'
  );
  translated = translated.replace(/\bstrftime\(\s*'%Y'\s*,\s*'now'\s*\)/gi, 'YEAR(CURRENT_DATE)');
  translated = translated.replace(
    /\bstrftime\(\s*'%Y'\s*,\s*([A-Za-z_][\w$.]*)\s*\)/gi,
    'YEAR($1)'
  );
  translated = translated.replace(
    /\bstrftime\(\s*'%m-%d'\s*,\s*'now'\s*\)/gi,
    'DATE_FORMAT(CURRENT_DATE, \'%m-%d\')'
  );
  translated = translated.replace(
    /\bstrftime\(\s*'%m-%d'\s*,\s*([A-Za-z_][\w$.]*)\s*\)/gi,
    'DATE_FORMAT($1, \'%m-%d\')'
  );
  // MySQL has no partial (filtered) indexes, so drop the WHERE clause from any
  // CREATE INDEX statement. Uniqueness is still enforced for the indexed columns.
  translated = translated.replace(/(CREATE\s+(?:UNIQUE\s+)?INDEX\b[^;]*?)\s+WHERE\s+[^;]*/gi, '$1');
  // MySQL does not support IF NOT EXISTS on CREATE INDEX.
  translated = translated.replace(/CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+/gi, (m) => m.replace(/IF\s+NOT\s+EXISTS\s+/i, ''));
  return translated;
}

module.exports = { translateCreateTable, translateSql };
