const fs = require('fs');
const mysql = require('mysql2/promise');
const src = fs.readFileSync('./config/mysqlSchema.js', 'utf8');
const block = src.slice(src.indexOf('const SECONDARY_INDEXES'), src.indexOf('];', src.indexOf('const SECONDARY_INDEXES')));
const entries = [...block.matchAll(/\[\s*'([^']+)',\s*'([^']+)',\s*\[([^\]]+)\]/g)].map(m => ({
  table: m[1], index: m[2], cols: m[3].split(',').map(s => s.trim().replace(/'/g, '')),
}));
(async () => {
  const c = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'hms', password: 'hmspass', database: 'hms_cutover' });
  console.log('parsed entries:', entries.length);
  for (const e of entries) {
    const [types] = await c.query(
      `SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME IN (?)`, [e.table, e.cols]);
    const desc = types.map(t => `${t.COLUMN_NAME}:${t.DATA_TYPE}${t.CHARACTER_MAXIMUM_LENGTH ? '(' + t.CHARACTER_MAXIMUM_LENGTH + ')' : ''}`).join(' ');
    const bytes = types.reduce((n, t) => n + (t.CHARACTER_MAXIMUM_LENGTH ? Number(t.CHARACTER_MAXIMUM_LENGTH) * 4 : 8), 0);
    const [ex] = await c.query(`SELECT COUNT(*) n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?`, [e.table, e.index]);
    if (ex[0].n > 0) { console.log(`OK-EXISTS  ${e.index} (${bytes}B) ${desc}`); continue; }
    try {
      await c.query(`ALTER TABLE \`${e.table}\` ADD INDEX \`${e.index}\` (${e.cols.map(x => `\`${x}\``).join(', ')})`);
      console.log(`ADDED      ${e.index} (${bytes}B) ${desc}`);
    } catch (err) {
      console.log(`FAIL       ${e.index} (${bytes}B) ${err.code} ${err.message} | ${desc}`);
    }
  }
  await c.end();
})().catch(err => { console.error('PROBE FATAL', err.code, err.message); process.exit(1); });
