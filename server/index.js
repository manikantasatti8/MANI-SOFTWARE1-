require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const { pool } = require('./db');

const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32 || /change-this/.test(secret)) { console.error('SESSION_SECRET is not set. Run:  npm run setup'); process.exit(1); }
const IDLE_MINUTES = +process.env.IDLE_MINUTES || 30;      // signed out after this long with no activity

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'" });
  next();
});
app.use(express.json({ limit: '15mb' }));              // documents are uploaded as JSON (up to 10 MB each)
app.use(session({
  store: new PgStore({ pool, createTableIfMissing: true }),
  secret, name: 'bp.sid', resave: false, saveUninitialized: false, rolling: true,
  cookie: { httpOnly: true, sameSite: 'strict', maxAge: 1000 * 60 * IDLE_MINUTES }
}));
app.use('/api', require('./api'));
app.use(express.static(path.join(__dirname, '..', 'public')));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Broker Portal is running:  http://localhost:${port}`));
