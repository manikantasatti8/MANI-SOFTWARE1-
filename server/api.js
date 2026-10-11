const express = require('express');
const bcrypt = require('bcryptjs');
const { q, one, tx, nextNo, audit } = require('./db');
const { r2, calcInvoice, invoiceLines } = require('./posting');

const api = express.Router();
const wrap = fn => (req, res, next) => fn(req, res, next).catch(e => {
  const known = e.status || /duplicate key|violates|do not balance/.test(e.message);
  if (!known) console.error(e);
  res.status(e.status || 400).json({ error: /duplicate key/.test(e.message) ? 'That already exists' : e.message });
});
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const need = (b, ...keys) => { for (const k of keys) if (b[k] === undefined || b[k] === null || b[k] === '') throw fail('Please fill in: ' + k.replace(/_/g, ' ')); };

// ---------- who can do what ----------
const CAN = {
  produce: ['Admin', 'Production'],            // clients, enquiries, quotes, book invoices
  close:   ['Admin', 'Closing'],               // approve or return invoices
  finance: ['Admin', 'Finance', 'Manager', 'Closing'],   // see the books
  reverse: ['Admin', 'Finance'],
  book:    ['Admin', 'Finance'],               // vouchers, PDC cheques, chart of accounts
  admin:   ['Admin']
};
const can = what => (req, res, next) => CAN[what].includes(req.user.role) ? next() : res.status(403).json({ error: 'Your role cannot do this' });

// ---------- login ----------
// Five wrong passwords lock the account for 15 minutes.
api.post('/login', wrap(async (req, res) => {
  const bad = fail('Wrong username or password', 401);
  const u = await one('SELECT * FROM users WHERE lower(username)=lower($1) AND active', [String(req.body.username || '').trim()]);
  if (!u) { bcrypt.compareSync('x', '$2a$12$abcdefghijklmnopqrstuuJ8m1Yb4oQ7e0n0b0b0b0b0b0b0b0b0b0'); throw bad; }
  if (u.locked_until && new Date(u.locked_until) > new Date())
    throw fail(`Too many wrong passwords. Try again after ${new Date(u.locked_until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`, 423);
  if (!bcrypt.compareSync(String(req.body.password || ''), u.pass_hash)) {
    const n = u.failed_attempts + 1, lock = n >= 5;
    await q(`UPDATE users SET failed_attempts=$2, locked_until=CASE WHEN $3 THEN now()+interval '15 minutes' ELSE NULL END WHERE id=$1`, [u.id, lock ? 0 : n, lock]);
    if (lock) await audit({ q }, u.id, 'Account locked', 'user', u.username, '5 wrong passwords');
    throw bad;
  }
  await q('UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=$1', [u.id]);
  await new Promise((ok, no) => req.session.regenerate(e => e ? no(e) : ok()));
  req.session.uid = u.id;
  await audit({ q }, u.id, 'Signed in', 'user', u.username);
  res.json({ id: u.id, name: u.name, role: u.role, username: u.username });
}));
api.post('/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

api.use(wrap(async (req, res, next) => {
  const u = req.session.uid && await one('SELECT id,username,name,role FROM users WHERE id=$1 AND active', [req.session.uid]);
  if (!u) throw fail('Please sign in', 401);
  req.user = u; next();
}));
api.get('/me', (req, res) => res.json(req.user));
api.post('/password', wrap(async (req, res) => {
  if ((req.body.password || '').length < 8) throw fail('Password must be at least 8 characters');
  await q('UPDATE users SET pass_hash=$1 WHERE id=$2', [bcrypt.hashSync(req.body.password, 10), req.user.id]);
  res.json({ ok: true });
}));

// ---------- lists used by the forms ----------
api.get('/meta', wrap(async (req, res) => {
  const s = {}; (await q('SELECT * FROM settings')).forEach(r => s[r.key] = r.value);
  res.json({ settings: s, insurers: await q('SELECT * FROM insurers ORDER BY name'), producers: await q('SELECT * FROM producers ORDER BY name'),
    clients: await q('SELECT id,code,name FROM clients ORDER BY name') });
}));

// ---------- clients ----------
api.get('/clients', wrap(async (req, res) => res.json(await q(`
  SELECT c.*, p.name producer_name,
    (SELECT count(*)::int FROM enquiries e WHERE e.client_id=c.id) enquiries,
    (SELECT count(*)::int FROM invoices i WHERE i.client_id=c.id AND i.status='Approved') policies,
    (SELECT coalesce(sum(i.net),0) FROM invoices i WHERE i.client_id=c.id AND i.status='Approved') premium
  FROM clients c LEFT JOIN producers p ON p.id=c.producer_id ORDER BY c.name`))));
const clientCols = ['name', 'type', 'contact', 'email', 'phone', 'city', 'trn', 'producer_id'];
api.post('/clients', can('produce'), wrap(async (req, res) => {
  need(req.body, 'name');
  res.json(await tx(async t => {
    const code = await nextNo(t, 'CL', 4), b = req.body;
    const c = await t.one(`INSERT INTO clients(code,name,type,contact,email,phone,city,trn,producer_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [code, b.name.trim(), b.type || 'Corporate', b.contact, b.email, b.phone, b.city, b.trn, b.producer_id || null, req.user.id]);
    await audit(t, req.user.id, 'Client added', 'client', code, c.name); return c;
  }));
}));
api.put('/clients/:id', can('produce'), wrap(async (req, res) => {
  need(req.body, 'name'); const b = req.body;
  const c = await one(`UPDATE clients SET name=$1,type=$2,contact=$3,email=$4,phone=$5,city=$6,trn=$7,producer_id=$8 WHERE id=$9 RETURNING *`,
    [b.name.trim(), b.type || 'Corporate', b.contact, b.email, b.phone, b.city, b.trn, b.producer_id || null, req.params.id]);
  await audit({ q }, req.user.id, 'Client updated', 'client', c.code, c.name); res.json(c);
}));

// ---------- enquiries ----------
const STAGES = ['Inquiry', 'Requirements', 'Marketed', 'Quoted', 'Client Decision', 'Closing', 'Closed', 'Lost'];
const ENQ = `SELECT e.*, c.name client_name, c.code client_code, c.contact, c.email, c.phone, p.name producer_name, u.name created_by_name
  FROM enquiries e JOIN clients c ON c.id=e.client_id LEFT JOIN producers p ON p.id=e.producer_id LEFT JOIN users u ON u.id=e.created_by`;
const note = (t, enquiryId, userId, body, kind = 'event') =>
  t.q('INSERT INTO enquiry_notes(enquiry_id,kind,body,user_id) VALUES($1,$2,$3,$4)', [enquiryId, kind, body, userId]);
const setStage = async (t, id, stage, userId, extra) => {
  const e = await t.one('SELECT stage,ref FROM enquiries WHERE id=$1 FOR UPDATE', [id]);
  if (!e || e.stage === stage) return;
  await t.q('UPDATE enquiries SET stage=$1, updated_at=now() WHERE id=$2', [stage, id]);
  await note(t, id, userId, `Stage: ${e.stage} → ${stage}${extra ? ' — ' + extra : ''}`);
};

api.get('/enquiries', wrap(async (req, res) => res.json(await q(ENQ + ' ORDER BY e.created_at DESC'))));
api.get('/enquiries/:id', wrap(async (req, res) => {
  const e = await one(ENQ + ' WHERE e.id=$1', [req.params.id]); if (!e) throw fail('Not found', 404);
  e.notes = await q('SELECT n.*, u.name user_name FROM enquiry_notes n LEFT JOIN users u ON u.id=n.user_id WHERE enquiry_id=$1 ORDER BY at DESC', [e.id]);
  e.quotes = await q('SELECT qt.*, i.name insurer_name FROM quotes qt JOIN insurers i ON i.id=qt.insurer_id WHERE enquiry_id=$1 ORDER BY premium', [e.id]);
  e.invoices = await q('SELECT id,ref,policy_no,status,total FROM invoices WHERE enquiry_id=$1 ORDER BY id', [e.id]);
  res.json(e);
}));
api.post('/enquiries', can('produce'), wrap(async (req, res) => {
  const b = req.body; need(b, 'client_id', 'dept', 'grp', 'cls', 'sub');
  res.json(await tx(async t => {
    const ref = await nextNo(t, 'ENQ', 4);
    const e = await t.one(`INSERT INTO enquiries(ref,client_id,dept,grp,cls,sub,type,source,priority,producer_id,sum_insured,premium_est,inception,requirements,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [ref, b.client_id, b.dept, b.grp, b.cls, b.sub, b.type || 'New', b.source, b.priority || 'Medium', b.producer_id || null,
        r2(b.sum_insured), r2(b.premium_est), b.inception || null, b.requirements, req.user.id]);
    await note(t, e.id, req.user.id, 'Enquiry created');
    await audit(t, req.user.id, 'Enquiry created', 'enquiry', ref, `${b.cls} / ${b.sub}`); return e;
  }));
}));
api.put('/enquiries/:id', can('produce'), wrap(async (req, res) => {
  const b = req.body; need(b, 'dept', 'grp', 'cls', 'sub');
  res.json(await one(`UPDATE enquiries SET dept=$1,grp=$2,cls=$3,sub=$4,type=$5,source=$6,priority=$7,producer_id=$8,sum_insured=$9,premium_est=$10,inception=$11,requirements=$12,updated_at=now()
    WHERE id=$13 AND stage NOT IN ('Closed') RETURNING *`,
    [b.dept, b.grp, b.cls, b.sub, b.type || 'New', b.source, b.priority || 'Medium', b.producer_id || null, r2(b.sum_insured), r2(b.premium_est), b.inception || null, b.requirements, req.params.id]));
}));
api.post('/enquiries/:id/stage', can('produce'), wrap(async (req, res) => {
  const { stage, reason } = req.body;
  if (!STAGES.includes(stage) || stage === 'Closed' || stage === 'Closing') throw fail('That stage is set automatically by the system');
  if (stage === 'Lost' && !reason) throw fail('Please give the reason the client did not confirm');
  await tx(async t => {
    const e = await t.one('SELECT stage FROM enquiries WHERE id=$1', [req.params.id]);
    if (['Closed', 'Closing'].includes(e.stage)) throw fail('This enquiry is already with Closing');
    await setStage(t, req.params.id, stage, req.user.id, reason);
    if (stage === 'Lost') await t.q('UPDATE enquiries SET lost_reason=$1 WHERE id=$2', [reason, req.params.id]);
  });
  res.json({ ok: true });
}));
api.post('/enquiries/:id/notes', wrap(async (req, res) => {
  need(req.body, 'body'); await note({ q }, req.params.id, req.user.id, req.body.body, 'note'); res.json({ ok: true });
}));

// ---------- quotations ----------
api.post('/enquiries/:id/quotes', can('produce'), wrap(async (req, res) => {
  const b = req.body; need(b, 'insurer_id', 'premium');
  await tx(async t => {
    await t.q('INSERT INTO quotes(enquiry_id,insurer_id,premium,terms,created_by) VALUES($1,$2,$3,$4,$5)', [req.params.id, b.insurer_id, r2(b.premium), b.terms, req.user.id]);
    const ins = await t.one('SELECT name FROM insurers WHERE id=$1', [b.insurer_id]);
    await note(t, req.params.id, req.user.id, `Quotation received from ${ins.name}: ${r2(b.premium).toLocaleString()}`);
    const e = await t.one('SELECT stage FROM enquiries WHERE id=$1', [req.params.id]);
    if (['Inquiry', 'Requirements', 'Marketed'].includes(e.stage)) await setStage(t, req.params.id, 'Quoted', req.user.id);
  });
  res.json({ ok: true });
}));
api.post('/quotes/:id/choose', can('produce'), wrap(async (req, res) => {
  await tx(async t => {
    const qt = await t.one('SELECT qt.*, i.name insurer_name FROM quotes qt JOIN insurers i ON i.id=qt.insurer_id WHERE qt.id=$1', [req.params.id]);
    if (!qt) throw fail('Not found', 404);
    await t.q(`UPDATE quotes SET status=CASE WHEN id=$1 THEN 'Chosen' ELSE 'Declined' END WHERE enquiry_id=$2`, [qt.id, qt.enquiry_id]);
    await note(t, qt.enquiry_id, req.user.id, `Client confirmed ${qt.insurer_name}`);
    await setStage(t, qt.enquiry_id, 'Client Decision', req.user.id);
  });
  res.json({ ok: true });
}));

// ---------- invoices: Production books, Closing approves, Finance is posted automatically ----------
const INV = `SELECT i.*, c.name client_name, c.code client_code, s.name insurer_name, p.name producer_name, e.ref enquiry_ref,
    u.name created_by_name, a.name approved_by_name, j.no journal_no
  FROM invoices i JOIN clients c ON c.id=i.client_id JOIN insurers s ON s.id=i.insurer_id LEFT JOIN producers p ON p.id=i.producer_id
  LEFT JOIN enquiries e ON e.id=i.enquiry_id LEFT JOIN users u ON u.id=i.created_by LEFT JOIN users a ON a.id=i.approved_by LEFT JOIN journals j ON j.id=i.journal_id`;
const invFields = b => {
  need(b, 'client_id', 'insurer_id', 'policy_no', 'dept', 'grp', 'cls', 'sub', 'net');
  if (b.issue_type !== 'Endorsement' && +b.net <= 0) throw fail('Net premium must be more than zero');
  if (b.start_date && b.expiry_date && b.expiry_date < b.start_date) throw fail('Expiry date is before the start date');
  const m = calcInvoice(b);
  return [b.enquiry_id || null, b.client_id, b.insurer_id, b.producer_id || null, b.issue_type || 'New', String(b.policy_no).trim(), b.endorsement_no || null, b.dept, b.grp, b.cls, b.sub,
    b.invoice_date || new Date().toISOString().slice(0, 10), b.start_date || null, b.expiry_date || null, r2(b.sum_insured),
    m.net, m.fees, m.vat_pct, m.vat, m.total, m.comm_pct, m.comm_amt, m.comm_vat, m.prod_pct, m.prod_amt, m.prod_vat, b.pay_terms];
};
const invCols = 'enquiry_id,client_id,insurer_id,producer_id,issue_type,policy_no,endorsement_no,dept,grp,cls,sub,invoice_date,start_date,expiry_date,sum_insured,net,fees,vat_pct,vat,total,comm_pct,comm_amt,comm_vat,prod_pct,prod_amt,prod_vat,pay_terms';

api.get('/invoices', wrap(async (req, res) => res.json(await q(INV + ' ORDER BY i.id DESC'))));
api.post('/invoices/calc', (req, res) => res.json(calcInvoice(req.body)));
api.post('/invoices', can('produce'), wrap(async (req, res) => {
  const v = invFields(req.body);
  res.json(await tx(async t => {
    const ref = await nextNo(t, 'INV', 4);
    const i = await t.one(`INSERT INTO invoices(ref,${invCols},created_by) VALUES($1,${v.map((_, n) => '$' + (n + 2)).join(',')},$${v.length + 2}) RETURNING *`, [ref, ...v, req.user.id]);
    await audit(t, req.user.id, 'Invoice drafted', 'invoice', ref, i.policy_no); return i;
  }));
}));
api.put('/invoices/:id', can('produce'), wrap(async (req, res) => {
  const v = invFields(req.body);
  const i = await one(`UPDATE invoices SET (${invCols})=(${v.map((_, n) => '$' + (n + 1)).join(',')}) WHERE id=$${v.length + 1} AND status IN ('Draft','Returned') RETURNING *`, [...v, req.params.id]);
  if (!i) throw fail('Only a draft or returned invoice can be changed');
  res.json(i);
}));
api.post('/invoices/:id/submit', can('produce'), wrap(async (req, res) => {
  await tx(async t => {
    const i = await t.one(`UPDATE invoices SET status='Pending Closing', submitted_at=now(), return_reason=NULL WHERE id=$1 AND status IN ('Draft','Returned') RETURNING *`, [req.params.id]);
    if (!i) throw fail('This invoice was already sent to Closing');
    if (i.enquiry_id) await setStage(t, i.enquiry_id, 'Closing', req.user.id, 'invoice ' + i.ref + ' sent to Closing');
    await audit(t, req.user.id, 'Sent to Closing', 'invoice', i.ref, i.policy_no);
  });
  res.json({ ok: true });
}));
// What Closing sees before approving: the exact entries that will be posted.
api.get('/invoices/:id/preview', wrap(async (req, res) => {
  const i = await one(INV + ' WHERE i.id=$1', [req.params.id]); if (!i) throw fail('Not found', 404);
  res.json({ invoice: i, ...(await invoiceLines({ q, one }, i, false)) });
}));
api.post('/invoices/:id/return', can('close'), wrap(async (req, res) => {
  need(req.body, 'reason');
  await tx(async t => {
    const i = await t.one(`UPDATE invoices SET status='Returned', return_reason=$2 WHERE id=$1 AND status='Pending Closing' RETURNING *`, [req.params.id, req.body.reason]);
    if (!i) throw fail('This invoice is not waiting for Closing');
    if (i.enquiry_id) await setStage(t, i.enquiry_id, 'Client Decision', req.user.id, 'returned by Closing: ' + req.body.reason);
    await audit(t, req.user.id, 'Returned to Production', 'invoice', i.ref, req.body.reason);
  });
  res.json({ ok: true });
}));
api.post('/invoices/:id/approve', can('close'), wrap(async (req, res) => {
  res.json(await tx(async t => {
    const lock = await t.one('SELECT status, created_by FROM invoices WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!lock || lock.status !== 'Pending Closing') throw fail('This invoice is not waiting for Closing');
    if (lock.created_by === req.user.id && req.user.role !== 'Admin') throw fail('You cannot approve an invoice you booked yourself');
    const i = await t.one(INV + ' WHERE i.id=$1', [req.params.id]);
    const { lines } = await invoiceLines(t, i, true);
    const no = await nextNo(t, 'IJ', 5);
    const kind = i.issue_type === 'New' ? '' : i.issue_type + ' ';
    const j = await t.one(`INSERT INTO journals(no,type,jdate,ref,narration,invoice_id,created_by) VALUES($1,'Invoice',$2,$3,$4,$5,$6) RETURNING *`,
      [no, i.invoice_date, i.ref, `${kind}Invoice ${i.ref} – ${i.client_name} – ${i.cls} – ${i.insurer_name}`, i.id, req.user.id]);
    for (const l of lines) await t.q('INSERT INTO journal_lines(journal_id,account_id,dr,cr,memo,invoice_id) VALUES($1,$2,$3,$4,$5,$6)', [j.id, l.account_id, l.dr, l.cr, l.memo, l.invoice_id]);
    await t.q(`UPDATE invoices SET status='Approved', approved_by=$2, approved_at=now(), journal_id=$3 WHERE id=$1`, [i.id, req.user.id, j.id]);
    if (i.enquiry_id) await setStage(t, i.enquiry_id, 'Closed', req.user.id, `approved by Closing, posted as ${no}`);
    await audit(t, req.user.id, 'Approved and posted', 'invoice', i.ref, `${no} · ${i.total}`);
    return { ok: true, journal_no: no };
  }));
}));

api.get('/policies', wrap(async (req, res) => res.json(await q(INV + ` WHERE i.status='Approved' AND i.issue_type<>'Endorsement' ORDER BY i.expiry_date NULLS LAST`))));

// ---------- finance: read the books, reverse a posted voucher ----------
api.get('/journals', can('finance'), wrap(async (req, res) => res.json(await q(`
  SELECT j.*, u.name created_by_name, (SELECT sum(dr) FROM journal_lines l WHERE l.journal_id=j.id) amount
  FROM journals j LEFT JOIN users u ON u.id=j.created_by ORDER BY j.id DESC`))));
api.get('/journals/:id', can('finance'), wrap(async (req, res) => {
  const j = await one('SELECT * FROM journals WHERE id=$1', [req.params.id]); if (!j) throw fail('Not found', 404);
  j.lines = await q('SELECT l.*, a.code, a.name, i.ref invoice_ref FROM journal_lines l JOIN accounts a ON a.id=l.account_id LEFT JOIN invoices i ON i.id=l.invoice_id WHERE journal_id=$1 ORDER BY l.id', [j.id]);
  res.json(j);
}));
api.post('/journals/:id/reverse', can('reverse'), wrap(async (req, res) => {
  need(req.body, 'reason');
  res.json(await tx(async t => {
    const j = await t.one('SELECT * FROM journals WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!j || j.status !== 'Posted' || j.type === 'Reversal') throw fail('Only a posted voucher can be reversed');
    if (j.type === 'Invoice') {
      const used = await t.one(`SELECT count(*)::int n FROM journal_lines l JOIN journals x ON x.id=l.journal_id WHERE l.invoice_id=$1 AND x.id<>$2 AND x.status='Posted' AND x.type<>'Reversal'`, [j.invoice_id, j.id]);
      if (used.n) throw fail('This invoice has receipts or payments allocated to it. Reverse those vouchers first.');
      if ((await t.one(`SELECT count(*)::int n FROM pdcs WHERE invoice_id=$1 AND status='Pending'`, [j.invoice_id])).n) throw fail('This invoice has pending PDC cheques. Cancel them first.');
    }
    const no = await nextNo(t, 'RJ', 5);
    const r = await t.one(`INSERT INTO journals(no,type,jdate,ref,narration,invoice_id,reverses_id,created_by) VALUES($1,'Reversal',CURRENT_DATE,$2,$3,$4,$5,$6) RETURNING id`,
      [no, j.no, `Reversal of ${j.no} — ${req.body.reason}`, j.invoice_id, j.id, req.user.id]);
    await t.q('INSERT INTO journal_lines(journal_id,account_id,dr,cr,memo,invoice_id) SELECT $1,account_id,cr,dr,memo,invoice_id FROM journal_lines WHERE journal_id=$2 ORDER BY id', [r.id, j.id]);
    await t.q(`UPDATE journals SET status='Reversed' WHERE id=$1`, [j.id]);
    if (j.type === 'Invoice') await t.q(`UPDATE invoices SET status='Reversed' WHERE id=$1`, [j.invoice_id]);
    await t.q(`UPDATE pdcs SET status='Pending', journal_id=NULL WHERE journal_id=$1`, [j.id]);
    await audit(t, req.user.id, 'Voucher reversed', 'journal', j.no, `${no} · ${req.body.reason}`);
    return { ok: true, journal_no: no };
  }));
}));
api.get('/trial-balance', can('finance'), wrap(async (req, res) => res.json(await q(`
  SELECT a.code, a.name, a.type, sum(l.dr) dr, sum(l.cr) cr, sum(l.dr)-sum(l.cr) bal
  FROM journal_lines l JOIN accounts a ON a.id=l.account_id GROUP BY a.id HAVING sum(l.dr)<>0 OR sum(l.cr)<>0 ORDER BY a.code`))));

// ---------- dashboard ----------
api.get('/dashboard', wrap(async (req, res) => {
  const [stages, k, producers, queue, renew, activity] = await Promise.all([
    q(`SELECT stage, count(*)::int n, coalesce(sum(premium_est),0) premium FROM enquiries GROUP BY stage`),
    one(`SELECT
      (SELECT coalesce(sum(premium_est),0) FROM enquiries WHERE stage NOT IN ('Closed','Lost')) pipeline,
      (SELECT count(*)::int FROM invoices WHERE status='Approved' AND approved_at>=date_trunc('month',now())) issued_mtd,
      (SELECT coalesce(sum(net),0) FROM invoices WHERE status='Approved' AND approved_at>=date_trunc('month',now())) premium_mtd,
      (SELECT coalesce(sum(comm_amt),0) FROM invoices WHERE status='Approved' AND approved_at>=date_trunc('month',now())) comm_mtd,
      (SELECT count(*)::int FROM invoices WHERE status='Pending Closing') pending_n,
      (SELECT coalesce(sum(total),0) FROM invoices WHERE status='Pending Closing') pending_amt,
      (SELECT count(*)::int FROM invoices WHERE status='Returned') returned_n,
      (SELECT count(*)::int FROM invoices WHERE status='Draft') draft_n`),
    q(`SELECT coalesce(p.name,'Unassigned') name, coalesce(sum(i.net),0) premium, count(*)::int policies FROM invoices i LEFT JOIN producers p ON p.id=i.producer_id
       WHERE i.status='Approved' AND i.approved_at>=date_trunc('year',now()) GROUP BY 1 ORDER BY 2 DESC LIMIT 6`),
    q(INV + ` WHERE i.status='Pending Closing' ORDER BY i.submitted_at LIMIT 6`),
    q(`SELECT i.id, i.ref, i.policy_no, i.expiry_date, i.net, c.name client_name, i.cls, (i.expiry_date-CURRENT_DATE) days FROM invoices i JOIN clients c ON c.id=i.client_id
       WHERE i.status='Approved' AND i.issue_type<>'Endorsement' AND i.expiry_date<=CURRENT_DATE+60 ORDER BY i.expiry_date`),
    q(`SELECT a.*, u.name user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE a.action<>'Signed in' ORDER BY a.id DESC LIMIT 8`)
  ]);
  res.json({ stages, k, producers, queue, renew, activity });
}));

// ---------- admin ----------
api.get('/audit', can('finance'), wrap(async (req, res) => res.json(await q('SELECT a.*, u.name user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 500'))));
api.get('/users', can('admin'), wrap(async (req, res) => res.json(await q('SELECT id,username,name,role,active,created_at FROM users ORDER BY id'))));
api.post('/users', can('admin'), wrap(async (req, res) => {
  const b = req.body; need(b, 'username', 'name', 'role', 'password');
  if (b.password.length < 8) throw fail('Password must be at least 8 characters');
  const u = await one('INSERT INTO users(username,name,role,pass_hash) VALUES($1,$2,$3,$4) RETURNING id,username,name,role', [b.username.trim(), b.name.trim(), b.role, bcrypt.hashSync(b.password, 10)]);
  await audit({ q }, req.user.id, 'User added', 'user', u.username, u.role); res.json(u);
}));
api.put('/users/:id', can('admin'), wrap(async (req, res) => {
  const b = req.body; need(b, 'name', 'role');
  if (+req.params.id === req.user.id && (b.role !== 'Admin' || b.active === false)) throw fail('You cannot remove your own admin access');
  await q('UPDATE users SET name=$1, role=$2, active=$3 WHERE id=$4', [b.name, b.role, b.active !== false, req.params.id]);
  if (b.password) { if (b.password.length < 8) throw fail('Password must be at least 8 characters'); await q('UPDATE users SET pass_hash=$1 WHERE id=$2', [bcrypt.hashSync(b.password, 10), req.params.id]); }
  await audit({ q }, req.user.id, 'User updated', 'user', b.name, b.role); res.json({ ok: true });
}));
api.post('/insurers', can('admin'), wrap(async (req, res) => { need(req.body, 'name'); res.json(await one('INSERT INTO insurers(name) VALUES($1) RETURNING *', [req.body.name.trim()])); }));
api.post('/producers', can('admin'), wrap(async (req, res) => { need(req.body, 'name'); res.json(await one('INSERT INTO producers(name,comm_pct) VALUES($1,$2) RETURNING *', [req.body.name.trim(), +req.body.comm_pct || 0])); }));

require('./finance')(api, { wrap, fail, need, can });

module.exports = api;
