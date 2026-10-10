// One-time setup: creates the database, the tables and the starting data.
// Run with:  npm run setup      (safe to run again; it never deletes anything)
require('dotenv').config();
const fs = require('fs'), path = require('path');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const COA = require('./coa');

const DB = process.env.PGDATABASE || 'broker_portal';
const conn = database => ({ host: process.env.PGHOST, port: process.env.PGPORT, user: process.env.PGUSER, password: process.env.PGPASSWORD, database });

(async () => {
  const root = new Client(conn('postgres'));
  await root.connect();
  const has = await root.query('SELECT 1 FROM pg_database WHERE datname=$1', [DB]);
  if (!has.rowCount) { await root.query(`CREATE DATABASE "${DB}"`); console.log('Created database', DB); }
  await root.end();

  const db = new Client(conn(DB));
  await db.connect();
  await db.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

  for (const [code, name, type, parent, grp, control] of COA)
    await db.query(`INSERT INTO accounts(code,name,type,parent_code,is_group,control) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (code) DO NOTHING`,
      [code, name, type, parent, !!grp, control || null]);

  const users = [['admin', 'Administrator', 'Admin', 'admin123'], ['production', 'Production User', 'Production', 'prod123'],
    ['closing', 'Closing User', 'Closing', 'close123'], ['finance', 'Finance User', 'Finance', 'fin123'], ['manager', 'Manager', 'Manager', 'man123']];
  if (!(await db.query('SELECT 1 FROM users LIMIT 1')).rowCount)
    for (const [u, n, r, p] of users)
      await db.query('INSERT INTO users(username,name,role,pass_hash) VALUES($1,$2,$3,$4)', [u, n, r, bcrypt.hashSync(p, 10)]);

  const insurers = ['Orient Insurance', 'Sukoon Insurance', 'GIG Gulf', 'Abu Dhabi National Insurance (ADNIC)', 'Al Ain Ahlia Insurance',
    'Dubai Insurance', 'Emirates Insurance', 'Salama Islamic Arab Insurance', 'RSA Insurance', 'Watania Takaful'];
  if (!(await db.query('SELECT 1 FROM insurers LIMIT 1')).rowCount)
    for (const n of insurers) await db.query('INSERT INTO insurers(name) VALUES($1)', [n]);
  if (!(await db.query('SELECT 1 FROM producers LIMIT 1')).rowCount)
    await db.query(`INSERT INTO producers(name,comm_pct) VALUES('Direct Business - Dubai',0)`);

  await db.query(`INSERT INTO settings(key,value) VALUES('company','Broker Portal'),('currency','AED'),('vat','5') ON CONFLICT DO NOTHING`);
  await db.end();
  console.log('\nSetup complete. Start the portal with:  npm start');
  console.log('First login:  admin / admin123   (change it under Admin > Users)');
})().catch(e => {
  console.error('\nSetup failed:', e.message);
  if (/password authentication/.test(e.message)) console.error('Check PGPASSWORD in your .env file.');
  process.exit(1);
});
