'use strict';

/**
 * Live MySQL integration tests for the connection layer.
 *
 * These run against a real MySQL/MariaDB server. When no server is reachable
 * they are SKIPPED with a visible message (never silently reported as passing),
 * so a sandbox or CI runner without a database cannot produce a false green.
 *
 * Enable/skip behaviour:
 *   - HMS_MYSQL_TESTS=0  -> force skip
 *   - otherwise         -> run when a server answers, skip when it does not
 *
 * Requires DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME (defaults to
 * 127.0.0.1:3306 root/hms), matching server/config/mysqlPool.js.
 */

const test = require('node:test');
const assert = require('node:assert');

const mysqlPool = require('../config/mysqlPool');

let available = false;
let skipReason = 'MySQL server not reachable';

async function probe() {
  if (process.env.HMS_MYSQL_TESTS === '0') {
    skipReason = 'HMS_MYSQL_TESTS=0';
    return;
  }
  try {
    available = await mysqlPool.isReady();
    if (!available) skipReason = 'isReady() returned false';
  } catch (error) {
    skipReason = `MySQL unavailable (${error.code || error.message})`;
  }
}

const probeDone = probe();

/** Allocate a uniquely named table and drop it afterwards. */
async function withTable(t, definition, body) {
  const name = `hms_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  await mysqlPool.query(`CREATE TABLE \`${name}\` (${definition}) ENGINE=InnoDB`);
  t.after(async () => {
    try {
      await mysqlPool.query(`DROP TABLE IF EXISTS \`${name}\``);
    } catch {
      // Cleanup failures must not mask test results.
    }
  });
  return body(name);
}

test('mysqlPool: connects and answers a health probe', async t => {
  await probeDone;
  if (!available) return t.skip(skipReason);

  assert.strictEqual(await mysqlPool.isReady(), true);

  const [rows] = await mysqlPool.query('SELECT ? AS echo, VERSION() AS version', ['hello']);
  assert.strictEqual(rows[0].echo, 'hello');
  assert.match(rows[0].version, /\d+\.\d+/);
});

test('mysqlPool: uses a real connection pool, not a single serialized socket', async t => {
  await probeDone;
  if (!available) return t.skip(skipReason);

  const started = Date.now();
  // 8 concurrent statements that each sleep 0.25s. Serialized execution would
  // need >= 2s; a real pool finishes far sooner.
  await Promise.all(
    Array.from({ length: 8 }, () => mysqlPool.query('SELECT SLEEP(0.25) AS slept'))
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, `concurrent queries took ${elapsed}ms; pool may be serializing`);
});

test('mysqlPool: parameterised queries prevent SQL injection', async t => {
  await probeDone;
  if (!available) return t.skip(skipReason);

  const payload = "Robert'); DROP TABLE patients;--";
  const [rows] = await mysqlPool.query('SELECT ? AS value', [payload]);
  assert.strictEqual(rows[0].value, payload, 'driver must pass the payload as data');
});

test('mysqlPool: DECIMAL money and DATETIME return in app-friendly shapes', async t => {
  await probeDone;
  if (!available) return t.skip(skipReason);

  const [rows] = await mysqlPool.query(
    "SELECT CAST(1500.00 AS DECIMAL(12,2)) AS amount, CAST('2026-01-31 08:15:00' AS DATETIME) AS at"
  );
  assert.strictEqual(typeof rows[0].amount, 'number', 'DECIMAL should be a number');
  assert.strictEqual(rows[0].amount, 1500);
  assert.strictEqual(typeof rows[0].at, 'string', 'DATETIME should be a string');
  assert.match(String(rows[0].at), /^2026-01-31 08:15:00/);
});

test('mysqlPool: runTransaction commits all writes atomically', async t => {
  await probeDone;
  if (!available) return t.skip(skipReason);

  await withTable(t, 'id INT PRIMARY KEY, label VARCHAR(32)', async table => {
    const result = await mysqlPool.runTransaction(async tx => {
      await tx.query(`INSERT INTO \`${table}\` (id, label) VALUES (?, ?)`, [1, 'a']);
      await tx.query(`INSERT INTO \`${table}\` (id, label) VALUES (?, ?)`, [2, 'b']);
      return 'done';
    });
    assert.strictEqual(result, 'done');

    const [rows] = await mysqlPool.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    assert.strictEqual(Number(rows[0].n), 2, 'both rows must be committed');
  });
});

test('mysqlPool: runTransaction rolls back every write when the callback throws', async t => {
  await probeDone;
  if (!available) return t.skip(skipReason);

  await withTable(t, 'id INT PRIMARY KEY, label VARCHAR(32)', async table => {
    await assert.rejects(
      () => mysqlPool.runTransaction(async tx => {
        await tx.query(`INSERT INTO \`${table}\` (id, label) VALUES (?, ?)`, [1, 'a']);
        await tx.query(`INSERT INTO \`${table}\` (id, label) VALUES (?, ?)`, [2, 'b']);
        throw new Error('business rule violated');
      }),
      /business rule violated/
    );

    const [rows] = await mysqlPool.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    assert.strictEqual(Number(rows[0].n), 0, 'no row may survive a rollback');
  });
});

test('mysqlPool: a failed statement inside a transaction rolls the whole unit back', async t => {
  await probeDone;
  if (!available) return t.skip(skipReason);

  await withTable(t, 'id INT PRIMARY KEY, label VARCHAR(32)', async table => {
    await assert.rejects(
      () => mysqlPool.runTransaction(async tx => {
        await tx.query(`INSERT INTO \`${table}\` (id, label) VALUES (?, ?)`, [1, 'kept?']);
        // Duplicate primary key -> driver error -> must abort the transaction.
        await tx.query(`INSERT INTO \`${table}\` (id, label) VALUES (?, ?)`, [1, 'dup']);
      }),
      error => {
        assert.strictEqual(error.code, 'ER_DUP_ENTRY');
        assert.strictEqual(error.isUniqueViolation, true);
        return true;
      }
    );

    const [rows] = await mysqlPool.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    assert.strictEqual(Number(rows[0].n), 0, 'the first insert must be rolled back too');
  });
});

test('mysqlPool: foreign keys are enforced by the engine', async t => {
  await probeDone;
  if (!available) return t.skip(skipReason);

  await withTable(t, 'id INT PRIMARY KEY', async parent => {
    const child = `${parent}_c`;
    await mysqlPool.query(
      `CREATE TABLE \`${child}\` (
         id INT PRIMARY KEY,
         parent_id INT NOT NULL,
         CONSTRAINT \`fk_${child}\` FOREIGN KEY (parent_id) REFERENCES \`${parent}\`(id)
           ON DELETE RESTRICT ON UPDATE CASCADE
       ) ENGINE=InnoDB`
    );
    t.after(async () => {
      try { await mysqlPool.query(`DROP TABLE IF EXISTS \`${child}\``); } catch { /* ignore */ }
    });

    // Orphan insert must be rejected.
    await assert.rejects(
      () => mysqlPool.query(`INSERT INTO \`${child}\` (id, parent_id) VALUES (?, ?)`, [1, 999]),
      error => {
        assert.strictEqual(error.isForeignKeyViolation, true);
        return true;
      }
    );

    await mysqlPool.query(`INSERT INTO \`${parent}\` (id) VALUES (?)`, [7]);
    await mysqlPool.query(`INSERT INTO \`${child}\` (id, parent_id) VALUES (?, ?)`, [2, 7]);

    // ON DELETE RESTRICT must block removing a referenced parent.
    await assert.rejects(
      () => mysqlPool.query(`DELETE FROM \`${parent}\` WHERE id = ?`, [7]),
      error => {
        assert.strictEqual(error.isForeignKeyViolation, true);
        return true;
      }
    );
  });
});

test('mysqlPool: errors are sanitised and do not leak SQL or values', async t => {
  await probeDone;
  if (!available) return t.skip(skipReason);

  // MySQL's raw duplicate-key message embeds the offending value
  // ("Duplicate entry 'patient-hiv-status' for key 'PRIMARY'"), so this is a
  // real leak path: the sanitised error must not carry patient data.
  await withTable(t, 'id INT PRIMARY KEY, secret VARCHAR(64)', async table => {
    const secret = 'patient-hiv-status';
    await mysqlPool.query(`INSERT INTO \`${table}\` (id, secret) VALUES (?, ?)`, [1, secret]);

    await assert.rejects(
      () => mysqlPool.query(`INSERT INTO \`${table}\` (id, secret) VALUES (?, ?)`, [1, 'another']),
      error => {
        assert.strictEqual(error.code, 'ER_DUP_ENTRY', 'stable code for callers to branch on');
        assert.strictEqual(error.isUniqueViolation, true);
        const message = String(error.message);
        assert.ok(!message.includes(secret), 'message must not leak stored parameter values');
        assert.ok(!message.includes('another'), 'message must not leak submitted parameter values');
        assert.ok(!/INSERT INTO/i.test(message), 'message must not echo the SQL statement');
        return true;
      }
    );
  });

  // A missing table still maps to a stable code without echoing the SQL.
  await assert.rejects(
    () => mysqlPool.query('SELECT * FROM `definitely_not_a_table` WHERE x = ?', ['secret-value']),
    error => {
      assert.strictEqual(error.code, 'ER_NO_SUCH_TABLE');
      assert.ok(!String(error.message).includes('secret-value'), 'no parameter leak');
      return true;
    }
  );

  // No credentials may ever appear in a serialised error.
  await assert.rejects(
    () => mysqlPool.query('SELECT * FROM `definitely_not_a_table`'),
    error => {
      const serialized = JSON.stringify({ message: error.message, code: error.code, errno: error.errno });
      assert.ok(!/hms_local_dev_pw|password=/i.test(serialized), 'no credentials in errors');
      return true;
    }
  );
});

test('mysqlPool: getConnection() releases back to the pool under load', async t => {
  await probeDone;
  if (!available) return t.skip(skipReason);

  // Take and release more connections than the pool limit; a leak would hang.
  for (let i = 0; i < 25; i += 1) {
    const connection = await mysqlPool.getConnection();
    try {
      const [rows] = await connection.query('SELECT ? AS n', [i]);
      assert.strictEqual(rows[0].n, i);
    } finally {
      connection.release();
    }
  }
  assert.strictEqual(await mysqlPool.isReady(), true);
});

test('mysqlPool: reports engine/schema info used by readiness checks', async t => {
  await probeDone;
  if (!available) return t.skip(skipReason);

  const info = await mysqlPool.getEngineInfo();
  assert.strictEqual(info.database, mysqlPool.config.database);
  assert.ok(Array.isArray(info.engines));
  assert.ok(info.engines.every(engine => engine === 'InnoDB' || engine === null),
    `expected InnoDB tables, saw: ${info.engines.join(', ')}`);
});

test.after(async () => {
  await mysqlPool.close();
});
