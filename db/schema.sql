-- Broker Portal database. Safe to run more than once.

CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  username    TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('Admin','Production','Closing','Finance','Manager')),
  pass_hash   TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seq (name TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0);

CREATE TABLE IF NOT EXISTS insurers  (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, active BOOLEAN NOT NULL DEFAULT TRUE);
CREATE TABLE IF NOT EXISTS producers (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, comm_pct NUMERIC(6,2) NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT TRUE);

CREATE TABLE IF NOT EXISTS clients (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'Corporate',
  contact     TEXT, email TEXT, phone TEXT, city TEXT, trn TEXT,
  producer_id INTEGER REFERENCES producers(id),
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS clients_name_uq ON clients (lower(name));

CREATE TABLE IF NOT EXISTS enquiries (
  id           SERIAL PRIMARY KEY,
  ref          TEXT NOT NULL UNIQUE,
  client_id    INTEGER NOT NULL REFERENCES clients(id),
  dept TEXT NOT NULL, grp TEXT NOT NULL, cls TEXT NOT NULL, sub TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'New',
  source       TEXT,
  priority     TEXT NOT NULL DEFAULT 'Medium',
  stage        TEXT NOT NULL DEFAULT 'Inquiry',
  producer_id  INTEGER REFERENCES producers(id),
  sum_insured  NUMERIC(16,2) NOT NULL DEFAULT 0,
  premium_est  NUMERIC(16,2) NOT NULL DEFAULT 0,
  inception    DATE,
  requirements TEXT,
  lost_reason  TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enquiry_notes (
  id SERIAL PRIMARY KEY,
  enquiry_id INTEGER NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'note',       -- note | event
  body TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quotes (
  id SERIAL PRIMARY KEY,
  enquiry_id INTEGER NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  insurer_id INTEGER NOT NULL REFERENCES insurers(id),
  premium    NUMERIC(16,2) NOT NULL DEFAULT 0,
  terms      TEXT,
  status     TEXT NOT NULL DEFAULT 'Received',   -- Awaiting | Received | Chosen | Declined
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chart of accounts. Party accounts (one per client / insurer / producer) hang under a control account.
CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type CHAR(1) NOT NULL CHECK (type IN ('A','L','E','I','X')),
  parent_code TEXT,
  is_group BOOLEAN NOT NULL DEFAULT FALSE,
  control TEXT,                 -- on a control account: client | insurer | inscomm | producer
  party_kind TEXT, party_id INTEGER,
  active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_party_uq ON accounts (party_kind, party_id) WHERE party_kind IS NOT NULL;

CREATE TABLE IF NOT EXISTS journals (
  id SERIAL PRIMARY KEY,
  no TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,           -- Invoice | Reversal | Journal | Receipt | Payment
  jdate DATE NOT NULL,
  ref TEXT, narration TEXT,
  status TEXT NOT NULL DEFAULT 'Posted',   -- Posted | Reversed
  invoice_id INTEGER,
  reverses_id INTEGER REFERENCES journals(id),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS journal_lines (
  id SERIAL PRIMARY KEY,
  journal_id INTEGER NOT NULL REFERENCES journals(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  dr NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (dr >= 0),
  cr NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (cr >= 0),
  memo TEXT
);

-- An invoice is what Production books and Closing approves. Approval posts the journal.
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  ref TEXT NOT NULL UNIQUE,
  enquiry_id  INTEGER REFERENCES enquiries(id),
  client_id   INTEGER NOT NULL REFERENCES clients(id),
  insurer_id  INTEGER NOT NULL REFERENCES insurers(id),
  producer_id INTEGER REFERENCES producers(id),
  issue_type  TEXT NOT NULL DEFAULT 'New',      -- New | Renewal | Endorsement
  policy_no   TEXT NOT NULL,
  dept TEXT NOT NULL, grp TEXT NOT NULL, cls TEXT NOT NULL, sub TEXT NOT NULL,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  start_date DATE, expiry_date DATE,
  sum_insured NUMERIC(16,2) NOT NULL DEFAULT 0,
  net       NUMERIC(16,2) NOT NULL DEFAULT 0,   -- net premium
  fees      NUMERIC(16,2) NOT NULL DEFAULT 0,   -- policy / other fees
  vat_pct   NUMERIC(6,2)  NOT NULL DEFAULT 5,
  vat       NUMERIC(16,2) NOT NULL DEFAULT 0,
  total     NUMERIC(16,2) NOT NULL DEFAULT 0,   -- what the client pays
  comm_pct  NUMERIC(6,2)  NOT NULL DEFAULT 0,   -- brokerage from the insurer
  comm_amt  NUMERIC(16,2) NOT NULL DEFAULT 0,
  comm_vat  NUMERIC(16,2) NOT NULL DEFAULT 0,
  prod_pct  NUMERIC(6,2)  NOT NULL DEFAULT 0,   -- share paid to the producer
  prod_amt  NUMERIC(16,2) NOT NULL DEFAULT 0,
  prod_vat  NUMERIC(16,2) NOT NULL DEFAULT 0,
  pay_terms TEXT,
  status TEXT NOT NULL DEFAULT 'Draft',         -- Draft | Pending Closing | Returned | Approved | Reversed
  return_reason TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  approved_by INTEGER REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  journal_id INTEGER REFERENCES journals(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL, entity TEXT, entity_ref TEXT, detail TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
