require('dotenv').config();
const { Pool, types } = require('pg');
types.setTypeParser(1700, v => parseFloat(v));                 // numeric -> number
types.setTypeParser(1082, v => v);                             // date stays 'YYYY-MM-DD'
const pool = new Pool({ host: process.env.PGHOST, port: process.env.PGPORT, user: process.env.PGUSER,
  password: process.env.PGPASSWORD, database: process.env.PGDATABASE || 'broker_portal' });

const q = (text, params) => pool.query(text, params).then(r => r.rows);
const one = (text, params) => q(text, params).then(r => r[0]);

// Runs fn inside one database transaction: everything succeeds together or nothing is saved.
async function tx(fn) {
  const c = await pool.connect();
  const t = { q: (s, p) => c.query(s, p).then(r => r.rows), one: (s, p) => c.query(s, p).then(r => r.rows[0]) };
  try { await c.query('BEGIN'); const out = await fn(t); await c.query('COMMIT'); return out; }
  catch (e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}

// Next running number, e.g. nextNo(t,'ENQ',4) -> ENQ-0007
async function nextNo(t, prefix, width = 4) {
  const r = await t.one(`INSERT INTO seq(name,n) VALUES($1,1) ON CONFLICT (name) DO UPDATE SET n=seq.n+1 RETURNING n`, [prefix]);
  return prefix + '-' + String(r.n).padStart(width, '0');
}
const audit = (t, userId, action, entity, ref, detail) =>
  t.q('INSERT INTO audit_log(user_id,action,entity,entity_ref,detail) VALUES($1,$2,$3,$4,$5)', [userId, action, entity, ref, detail || null]);

module.exports = { pool, q, one, tx, nextNo, audit };
