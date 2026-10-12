// One-time setup: creates the database, the tables and the starting data.
// Run with:  npm run setup      (safe to run again; it never deletes anything)
require('dotenv').config();
const fs = require('fs'), path = require('path'), crypto = require('crypto'), readline = require('readline');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const COA = require('./coa');

// Asks a question in the terminal. With hide=true the typing is not shown.
let rl, hidden = false;
function ask(question, hide) {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const write = rl._writeToOutput.bind(rl);
    rl._writeToOutput = t => { if (!hidden) write(t); };
  }
  return new Promise(resolve => {
    rl.question(question, a => { if (hidden) process.stdout.write('\n'); hidden = false; resolve(a.trim()); });
    hidden = !!hide;
  });
}

// Makes sure .env holds a private random key for logins (never uploaded to GitHub).
function ensureSecret() {
  const f = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(f)) return;
  let t = fs.readFileSync(f, 'utf8');
  if (/^SESSION_SECRET=.{32,}$/m.test(t) && !/change-this/.test(t)) return;
  const line = 'SESSION_SECRET=' + crypto.randomBytes(48).toString('hex');
  t = /^SESSION_SECRET=.*$/m.test(t) ? t.replace(/^SESSION_SECRET=.*$/m, line) : t.trimEnd() + '\n' + line + '\n';
  fs.writeFileSync(f, t); console.log('Created a private login key in .env');
}

const DB = process.env.PGDATABASE || 'broker_portal';
const conn = database => ({ host: process.env.PGHOST, port: process.env.PGPORT, user: process.env.PGUSER, password: process.env.PGPASSWORD, database });

(async () => {
  ensureSecret();
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
  // Money accounts: receipts and payments can only use accounts marked bank or cash.
  await db.query(`UPDATE accounts SET cash_kind='cash' WHERE code IN ('110101','110102') AND cash_kind IS NULL`);
  await db.query(`UPDATE accounts SET cash_kind='bank' WHERE code='110111' AND cash_kind IS NULL`);

  // The first administrator. You choose the password; only its scrambled form is stored.
  if (!(await db.query('SELECT 1 FROM users LIMIT 1')).rowCount) {
    console.log('\nCreate the administrator login (this is yours alone).');
    const username = process.env.ADMIN_USER || (await ask('  Username [admin]: ')) || 'admin';
    const name = process.env.ADMIN_NAME || (await ask('  Your full name: ')) || 'Administrator';
    let pw = process.env.ADMIN_PASSWORD;
    while (!pw || pw.length < 8) {
      pw = await ask('  Password (8 or more characters): ', true);
      if (pw.length < 8) { console.log('  Too short.'); continue; }
      if (pw !== await ask('  Type it again: ', true)) { console.log('  The two did not match.'); pw = ''; }
    }
    await db.query('INSERT INTO users(username,name,role,pass_hash) VALUES($1,$2,$3,$4)', [username.trim(), name.trim(), 'Admin', bcrypt.hashSync(pw, 12)]);
    console.log('  Administrator created:', username.trim());
  }
  if (rl) rl.close();

  const insurers = ['Orient Insurance', 'Sukoon Insurance', 'GIG Gulf', 'Abu Dhabi National Insurance (ADNIC)', 'Al Ain Ahlia Insurance',
    'Dubai Insurance', 'Emirates Insurance', 'Salama Islamic Arab Insurance', 'RSA Insurance', 'Watania Takaful'];
  if (!(await db.query('SELECT 1 FROM insurers LIMIT 1')).rowCount)
    for (const n of insurers) await db.query('INSERT INTO insurers(name) VALUES($1)', [n]);
  if (!(await db.query('SELECT 1 FROM producers LIMIT 1')).rowCount)
    await db.query(`INSERT INTO producers(name,comm_pct) VALUES('Direct Business - Dubai',0)`);

  await db.query(`INSERT INTO settings(key,value) VALUES('company','Broker Portal'),('currency','AED'),('vat','5') ON CONFLICT DO NOTHING`);
  await db.end();
  console.log('\nSetup complete. Start the portal with:  npm start');
  console.log('Sign in with the administrator login you created, then add your team under Admin > Users & Lists.');
})().catch(e => {
  console.error('\nSetup failed:', e.message);
  if (/password authentication/.test(e.message)) console.error('Check PGPASSWORD in your .env file.');
  process.exit(1);
});
