// Finance: chart of accounts, vouchers (with or without allocation), direct payments, PDC cheques, statements.
const { q, one, tx, nextNo, audit } = require('./db');
const { r2 } = require('./posting');

// Voucher types and the prefix of their running number.
const VTYPES = { 'Bank Receipt': 'BR', 'Bank Payment': 'BP', 'Cash Receipt': 'CR', 'Cash Payment': 'CP', 'General Voucher': 'JV', 'Direct Payment': 'DP', Amortization: 'AM' };
const PARTY_COL = { client: 'client_id', insurer: 'insurer_id', inscomm: 'insurer_id', producer: 'producer_id' };

// Saves one balanced voucher. lines: [{account_id, dr, cr, memo, invoice_id}]
async function postVoucher(t, { type, date, ref, narration, lines, cash_account_id, user }) {
  lines = lines.map(l => ({ ...l, dr: r2(l.dr), cr: r2(l.cr) })).filter(l => l.dr || l.cr);
  if (lines.length < 2) throw new Error('A voucher needs at least two lines with amounts');
  const dr = r2(lines.reduce((s, l) => s + l.dr, 0)), cr = r2(lines.reduce((s, l) => s + l.cr, 0));
  if (Math.abs(dr - cr) > 0.004) throw new Error(`Debits (${dr.toFixed(2)}) and credits (${cr.toFixed(2)}) do not match`);
  for (const l of lines) {
    if (l.dr < 0 || l.cr < 0 || (l.dr && l.cr)) throw new Error('Each line needs one positive amount');
    const a = await t.one('SELECT * FROM accounts WHERE id=$1', [l.account_id]);
    if (!a) throw new Error('Choose an account on every line');
    if (a.is_group || a.control) throw new Error(`${a.name} is a heading account — post to one of its sub-accounts`);
    if (!a.active) throw new Error(`${a.name} is inactive`);
    if (l.invoice_id) {                      // allocation: the invoice must belong to this party and must not be over-settled
      if (!a.party_kind) throw new Error(`${a.name} is not a client, insurer or producer account, so it cannot be allocated to an invoice`);
      const inv = await t.one(`SELECT * FROM invoices WHERE id=$1 AND status='Approved' FOR UPDATE`, [l.invoice_id]);
      if (!inv || inv[PARTY_COL[a.party_kind]] !== a.party_id) throw new Error(`That invoice does not belong to ${a.name}`);
      if (!['General Voucher', 'Amortization'].includes(type)) {
        const b = await t.one('SELECT coalesce(sum(dr)-sum(cr),0) bal FROM journal_lines WHERE invoice_id=$1 AND account_id=$2', [inv.id, a.id]);
        const after = r2(b.bal + l.dr - l.cr);
        if (Math.abs(after) > Math.abs(b.bal) + 0.004 || (b.bal && after && Math.sign(after) !== Math.sign(b.bal)))
          throw new Error(`${inv.ref}: the amount is more than what is outstanding (${Math.abs(b.bal).toFixed(2)})`);
      }
    } else l.invoice_id = null;
  }
  const no = await nextNo(t, VTYPES[type], 5);
  const j = await t.one(`INSERT INTO journals(no,type,jdate,ref,narration,cash_account_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [no, type, date, ref || null, narration || null, cash_account_id || null, user.id]);
  for (const l of lines) await t.q('INSERT INTO journal_lines(journal_id,account_id,dr,cr,memo,invoice_id) VALUES($1,$2,$3,$4,$5,$6)', [j.id, l.account_id, l.dr, l.cr, l.memo || null, l.invoice_id]);
  await audit(t, user.id, type + ' posted', 'journal', no, `${dr.toFixed(2)}${narration ? ' · ' + narration : ''}`);
  return j;
}
const partyAcc = async (t, kind, id) => {
  const a = await t.one('SELECT * FROM accounts WHERE party_kind=$1 AND party_id=$2', [kind, id]);
  if (!a) throw new Error('That party has no account yet (no approved invoice)'); return a;
};

// Ages in days since the invoice date, grouped into the usual buckets.
const BUCKETS = [['0–30', 30], ['31–60', 60], ['61–90', 90], ['91–180', 180], ['181–365', 365], ['Over 365', Infinity]];
const bucketOf = days => BUCKETS.find(b => days <= b[1])[0];

// One row per approved invoice the user may see, with premium, payments and the commission split.
// Commission becomes due in step with the premium the client has paid (to us or directly to the insurer):
//   original = PDC part + part on outstanding premium + due part;  balance = due part − settled.
async function partyRows(scope, kind, pid) {
  const col = PARTY_COL[kind];
  const inv = await q(`SELECT i.*, c.name client_name, s.name insurer_name, p.name producer_name,
      coalesce((SELECT sum(amount) FROM pdcs WHERE invoice_id=i.id AND status='Pending'),0) pdc,
      (SELECT count(*)::int FROM pdcs WHERE invoice_id=i.id AND status='Pending') pdc_n,
      (CURRENT_DATE - i.invoice_date) age
    FROM invoices i JOIN clients c ON c.id=i.client_id JOIN insurers s ON s.id=i.insurer_id LEFT JOIN producers p ON p.id=i.producer_id
    WHERE i.status='Approved' AND ${scope.inv('i.')} ${pid ? `AND i.${col}=${+pid}` : ''} ${kind === 'producer' ? 'AND i.prod_amt<>0' : ''}
    ORDER BY i.invoice_date, i.id`);
  if (!inv.length) return [];
  const mv = {}; (await q(`SELECT l.invoice_id, a.party_kind k, sum(l.dr)-sum(l.cr) bal FROM journal_lines l JOIN accounts a ON a.id=l.account_id
    WHERE l.invoice_id = ANY($1) AND a.party_kind IS NOT NULL GROUP BY 1,2`, [inv.map(i => i.id)])).forEach(r => (mv[r.invoice_id] = mv[r.invoice_id] || {})[r.k] = r.bal);
  return inv.map(i => {
    const m = mv[i.id] || {}, T = i.total, cbal = r2(m.client || 0), paid = r2(T - cbal);
    const ratio = Math.abs(T) > 0.005 ? Math.max(0, Math.min(1, paid / T)) : 1;
    const pdcShare = Math.abs(T) > 0.005 ? Math.max(0, Math.min(1 - ratio, i.pdc / T)) : 0;
    const split = full => { const pdc = r2(full * pdcShare), due = r2(full * ratio); return { original: full, pdc, on_outstanding: r2(full - pdc - due), due }; };
    const C = r2(i.comm_amt + i.comm_vat), comm_received = r2(C - (m.inscomm || 0));
    const base = { id: i.id, ref: i.ref, invoice_date: i.invoice_date, age: i.age, client_id: i.client_id, insurer_id: i.insurer_id, producer_id: i.producer_id,
      client_name: i.client_name, insurer_name: i.insurer_name, producer_name: i.producer_name, policy_no: i.policy_no, endorsement_no: i.endorsement_no,
      issue_type: i.issue_type, dept: i.dept, cls: i.cls, premium: T, client_paid: paid, client_balance: cbal, pdc_amount: i.pdc, pdc_n: i.pdc_n,
      commission: C, comm_received };
    let r;
    if (kind === 'client') r = { ...base, original: T, pdc: Math.min(i.pdc, Math.max(0, cbal)), settled: paid, balance: cbal };
    else if (kind === 'insurer') { const bal = r2(-(m.insurer || 0)); r = { ...base, original: T, settled: r2(T - bal), balance: bal }; }
    else if (kind === 'inscomm') { const s = split(C); r = { ...base, ...s, settled: comm_received, balance: r2(s.due - comm_received) }; }
    else { const s = split(r2(i.prod_amt + i.prod_vat)), settled = r2(s.original + (m.producer || 0)); r = { ...base, ...s, settled, balance: r2(s.due - settled) }; }
    r.bucket = bucketOf(r.age); return r;
  });
}

module.exports = (api, { wrap, fail, need, can }) => {
  const safe = fn => wrap(async (req, res) => { try { await fn(req, res); } catch (e) { throw e.status ? e : fail(e.message); } });
  // Users limited to certain departments, producers, clients or invoice sizes work only through statements, aging and PDCs.
  // Account-wide views (ledgers, vouchers, trial balance, VAT) would show the hidden business, so they are closed to them.
  const fullBooks = (req, res, next) => req.scope.restricted ? res.status(403).json({ error: 'Your access is limited to part of the business, so the full books are not available to you' }) : next();
  const stOk = kind => (req, res, next) => req.scope.statementOk(kind) ? next() : res.status(403).json({ error: 'You are not allowed to see this statement' });
  const invVisible = async (scope, ids) => { ids = [...new Set(ids.filter(Boolean).map(Number))]; if (!ids.length) return;
    const n = (await one(`SELECT count(*)::int n FROM invoices WHERE id = ANY($1) AND ${scope.inv('')}`, [ids])).n;
    if (n !== ids.length) throw fail('Invoice not found', 404); };

  // ---------- chart of accounts ----------
  api.get('/accounts', can('finance'), fullBooks, safe(async (req, res) => res.json(await q(`
    SELECT a.*, coalesce(b.dr,0) dr, coalesce(b.cr,0) cr FROM accounts a
    LEFT JOIN (SELECT account_id, sum(dr) dr, sum(cr) cr FROM journal_lines GROUP BY 1) b ON b.account_id=a.id ORDER BY a.code`))));
  api.post('/accounts', can('book'), fullBooks, safe(async (req, res) => {
    const b = req.body; need(b, 'parent_code', 'name');
    res.json(await tx(async t => {
      const p = await t.one('SELECT * FROM accounts WHERE code=$1 FOR UPDATE', [b.parent_code]);
      if (!p) throw fail('Choose the heading this account belongs under');
      if (p.control) throw fail('Accounts under this heading are created automatically, one per client, insurer or producer');
      if (p.party_kind) throw fail('A party account cannot have sub-accounts');
      if (!p.is_group && (await t.one('SELECT count(*)::int n FROM journal_lines WHERE account_id=$1', [p.id])).n) throw fail(`${p.name} already has entries, so it cannot become a heading`);
      const kids = await t.q('SELECT code FROM accounts WHERE parent_code=$1', [p.code]);
      const w = p.code.length === 1 ? 1 : 2; let n = 0;
      kids.forEach(k => { const x = parseInt(k.code.slice(p.code.length), 10); if (k.code.startsWith(p.code) && !isNaN(x)) n = Math.max(n, x); });
      const code = p.code + String(n + 1).padStart(w, '0');
      await t.q('UPDATE accounts SET is_group=TRUE WHERE id=$1', [p.id]);
      const a = await t.one('INSERT INTO accounts(code,name,type,parent_code,is_group,cash_kind) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [code, b.name.trim(), p.type, p.code, b.is_group === true || b.is_group === 'true', ['bank', 'cash'].includes(b.cash_kind) ? b.cash_kind : null]);
      await audit(t, req.user.id, 'Account added', 'account', code, a.name); return a;
    }));
  }));
  api.put('/accounts/:id', can('book'), fullBooks, safe(async (req, res) => {
    need(req.body, 'name');
    const a = await one('UPDATE accounts SET name=$1, active=$2 WHERE id=$3 RETURNING *', [req.body.name.trim(), req.body.active !== false && req.body.active !== 'false', req.params.id]);
    await audit({ q }, req.user.id, 'Account updated', 'account', a.code, a.name); res.json(a);
  }));
  // Account ledger with running balance.
  api.get('/accounts/:id/ledger', can('finance'), fullBooks, safe(async (req, res) => {
    const a = await one('SELECT * FROM accounts WHERE id=$1', [req.params.id]); if (!a) throw fail('Not found', 404);
    const lines = await q(`SELECT j.id journal_id, j.no, j.type, j.jdate, j.narration, j.status, l.dr, l.cr, l.memo, i.ref invoice_ref
      FROM journal_lines l JOIN journals j ON j.id=l.journal_id LEFT JOIN invoices i ON i.id=l.invoice_id WHERE l.account_id=$1 ORDER BY j.jdate, j.id, l.id`, [a.id]);
    let bal = 0; lines.forEach(l => { bal = r2(bal + l.dr - l.cr); l.bal = bal; });
    res.json({ account: a, lines });
  }));

  // Open invoices of a party account, for the allocation list.
  api.get('/open-items', can('finance'), safe(async (req, res) => {
    const a = await one('SELECT * FROM accounts WHERE id=$1', [req.query.account_id]);
    if (!a || !a.party_kind) return res.json([]);
    res.json(await q(`SELECT i.id, i.ref, i.policy_no, i.invoice_date, c.name client_name, sum(l.dr)-sum(l.cr) bal
      FROM journal_lines l JOIN invoices i ON i.id=l.invoice_id JOIN clients c ON c.id=i.client_id
      WHERE l.account_id=$1 AND i.status='Approved' AND ${req.scope.inv('i.')} GROUP BY i.id, c.name HAVING abs(sum(l.dr)-sum(l.cr))>0.004 ORDER BY i.invoice_date, i.id`, [a.id]));
  }));

  // ---------- vouchers ----------
  // Receipt / payment: one bank or cash account against any number of lines. General voucher: free debit and credit lines.
  api.post('/vouchers', can('book'), fullBooks, safe(async (req, res) => {
    const b = req.body; need(b, 'type', 'date');
    if (!VTYPES[b.type] || ['Direct Payment', 'Amortization'].includes(b.type)) throw fail('Unknown voucher type');
    const rows = Array.isArray(b.lines) ? b.lines : [];
    res.json(await tx(async t => {
      let lines;
      if (b.type === 'General Voucher') lines = rows.map(l => ({ account_id: l.account_id, dr: l.dr, cr: l.cr, memo: l.memo, invoice_id: l.invoice_id }));
      else {
        const receipt = /Receipt/.test(b.type), kind = /Bank/.test(b.type) ? 'bank' : 'cash';
        const cash = await t.one('SELECT * FROM accounts WHERE id=$1 AND cash_kind=$2', [b.cash_account_id, kind]);
        if (!cash) throw fail(`Choose the ${kind} account`);
        if (rows.some(l => r2(l.amount) <= 0)) throw fail('Every line needs an amount above zero');
        const total = r2(rows.reduce((s, l) => s + r2(l.amount), 0));
        lines = rows.map(l => ({ account_id: l.account_id, dr: receipt ? 0 : l.amount, cr: receipt ? l.amount : 0, memo: l.memo, invoice_id: l.invoice_id }));
        lines.unshift({ account_id: cash.id, dr: receipt ? total : 0, cr: receipt ? 0 : total, memo: b.narration });
      }
      const j = await postVoucher(t, { type: b.type, date: b.date, ref: b.ref, narration: b.narration, lines, cash_account_id: b.cash_account_id, user: req.user });
      return { ok: true, journal_no: j.no, id: j.id };
    }));
  }));

  // Direct payment: the client paid the insurer directly. No money passes through us:
  // the client's balance and the insurer's premium payable both go down, and the commission becomes due.
  const directLines = async (t, items) => {
    const lines = [];
    for (const it of items) {
      const amt = r2(it.amount); if (amt <= 0) continue;
      const inv = await t.one(`SELECT * FROM invoices WHERE id=$1 AND status='Approved'`, [it.invoice_id]); if (!inv) throw fail('Invoice not found');
      const ins = await partyAcc(t, 'insurer', inv.insurer_id), cl = await partyAcc(t, 'client', inv.client_id);
      lines.push({ account_id: ins.id, dr: amt, cr: 0, memo: `Premium paid directly by client – ${inv.policy_no}`, invoice_id: inv.id });
      lines.push({ account_id: cl.id, dr: 0, cr: amt, memo: `Paid directly to insurer – ${inv.policy_no}`, invoice_id: inv.id });
    }
    if (!lines.length) throw fail('Enter the amount paid against at least one invoice');
    return lines;
  };
  api.post('/direct-payments', can('book'), safe(async (req, res) => {
    const b = req.body; need(b, 'date'); await invVisible(req.scope, (b.items || []).map(i => i.invoice_id));
    res.json(await tx(async t => {
      const j = await postVoucher(t, { type: 'Direct Payment', date: b.date, ref: b.ref, narration: b.narration || 'Premium paid directly to insurer by client', lines: await directLines(t, b.items || []), user: req.user });
      return { ok: true, journal_no: j.no };
    }));
  }));

  // ---------- PDC cheques, each tied to an invoice ----------
  api.get('/pdcs', can('finance'), safe(async (req, res) => res.json(await q(`
    SELECT p.*, i.ref invoice_ref, i.policy_no, c.name client_name, s.name insurer_name, j.no journal_no
    FROM pdcs p JOIN invoices i ON i.id=p.invoice_id JOIN clients c ON c.id=i.client_id JOIN insurers s ON s.id=i.insurer_id LEFT JOIN journals j ON j.id=p.journal_id
    WHERE ${req.scope.inv('i.')} ORDER BY (p.status='Pending') DESC, p.cheque_date, p.id`))));
  api.post('/pdcs', can('book'), safe(async (req, res) => {
    const b = req.body; need(b, 'invoice_id', 'cheque_no', 'cheque_date', 'amount'); await invVisible(req.scope, [b.invoice_id]);
    res.json(await tx(async t => {
      const inv = await t.one(`SELECT * FROM invoices WHERE id=$1 AND status='Approved' FOR UPDATE`, [b.invoice_id]); if (!inv) throw fail('Choose an approved invoice');
      const cl = await partyAcc(t, 'client', inv.client_id);
      const bal = (await t.one('SELECT coalesce(sum(dr)-sum(cr),0) bal FROM journal_lines WHERE invoice_id=$1 AND account_id=$2', [inv.id, cl.id])).bal;
      const held = (await t.one(`SELECT coalesce(sum(amount),0) s FROM pdcs WHERE invoice_id=$1 AND status='Pending'`, [inv.id])).s;
      if (r2(b.amount) + held > bal + 0.004) throw fail(`Cheques would exceed what the client still owes on ${inv.ref} (${r2(bal - held).toFixed(2)} not yet covered)`);
      const ref = await nextNo(t, 'PDC', 4);
      const p = await t.one(`INSERT INTO pdcs(ref,invoice_id,payee,cheque_no,bank,cheque_date,amount,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [ref, inv.id, b.payee === 'Insurer' ? 'Insurer' : 'Us', String(b.cheque_no).trim(), b.bank, b.cheque_date, r2(b.amount), b.note, req.user.id]);
      await audit(t, req.user.id, 'PDC recorded', 'pdc', ref, `${inv.ref} · ${p.amount}`); return p;
    }));
  }));
  // Clearing a cheque posts the voucher: a bank receipt if it was written to us, a direct payment if written to the insurer.
  api.post('/pdcs/:id/clear', can('book'), safe(async (req, res) => {
    const b = req.body; need(b, 'date');
    const pv = await one('SELECT invoice_id FROM pdcs WHERE id=$1', [req.params.id]); await invVisible(req.scope, [pv && pv.invoice_id || -1]);
    res.json(await tx(async t => {
      const p = await t.one('SELECT * FROM pdcs WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!p || p.status !== 'Pending') throw fail('This cheque is not pending');
      const inv = await t.one('SELECT * FROM invoices WHERE id=$1', [p.invoice_id]);
      let j; const narr = `PDC ${p.cheque_no}${p.bank ? ' ' + p.bank : ''} cleared – ${inv.policy_no}`;
      if (p.payee === 'Insurer') j = await postVoucher(t, { type: 'Direct Payment', date: b.date, ref: p.cheque_no, narration: narr, lines: await directLines(t, [{ invoice_id: inv.id, amount: p.amount }]), user: req.user });
      else {
        const bank = await t.one(`SELECT * FROM accounts WHERE id=$1 AND cash_kind='bank'`, [b.cash_account_id]); if (!bank) throw fail('Choose the bank account the cheque was deposited into');
        const cl = await partyAcc(t, 'client', inv.client_id);
        j = await postVoucher(t, { type: 'Bank Receipt', date: b.date, ref: p.cheque_no, narration: narr, cash_account_id: bank.id, user: req.user,
          lines: [{ account_id: bank.id, dr: p.amount, cr: 0, memo: narr }, { account_id: cl.id, dr: 0, cr: p.amount, memo: narr, invoice_id: inv.id }] });
      }
      await t.q(`UPDATE pdcs SET status='Cleared', journal_id=$2 WHERE id=$1`, [p.id, j.id]);
      return { ok: true, journal_no: j.no };
    }));
  }));
  api.post('/pdcs/:id/status', can('book'), safe(async (req, res) => {
    const pv = await one('SELECT invoice_id FROM pdcs WHERE id=$1', [req.params.id]); await invVisible(req.scope, [pv && pv.invoice_id || -1]);
    if (!['Bounced', 'Cancelled'].includes(req.body.status)) throw fail('Unknown status');
    const p = await one(`UPDATE pdcs SET status=$2, note=coalesce($3,note) WHERE id=$1 AND status='Pending' RETURNING *`, [req.params.id, req.body.status, req.body.reason || null]);
    if (!p) throw fail('This cheque is not pending');
    await audit({ q }, req.user.id, 'PDC ' + req.body.status.toLowerCase(), 'pdc', p.ref, req.body.reason); res.json({ ok: true });
  }));

  // ---------- statements ----------
  const TBL = { client: 'clients', insurer: 'insurers', inscomm: 'insurers', producer: 'producers' };
  const partiesOf = (scope, kind) => q(`SELECT DISTINCT p.id, p.name FROM invoices i JOIN clients c ON c.id=i.client_id JOIN ${TBL[kind]} p ON p.id=i.${PARTY_COL[kind]}
    WHERE i.status='Approved' AND ${scope.inv('i.')} ${kind === 'producer' ? 'AND i.prod_amt<>0' : ''} ORDER BY p.name`);
  const debitNormal = kind => kind === 'client' || kind === 'inscomm';
  const onAccount = async (kind, pid) => { const r = await one(`SELECT coalesce(sum(l.dr)-sum(l.cr),0) bal FROM journal_lines l JOIN accounts a ON a.id=l.account_id
    WHERE a.party_kind=$1 AND a.party_id=$2 AND l.invoice_id IS NULL`, [kind, pid]); return r2(debitNormal(kind) ? r.bal : -r.bal); };
  const kindOk = (req, res, next) => PARTY_COL[req.params.kind] ? stOk(req.params.kind)(req, res, next) : res.status(404).json({ error: 'Unknown statement' });

  api.get('/statements/:kind', can('finance'), kindOk, safe(async (req, res) => {
    const kind = req.params.kind, parties = await partiesOf(req.scope, kind), pid = +req.query.party_id || null;
    if (!pid) return res.json({ parties, rows: [], on_account: 0 });
    if (!parties.some(p => p.id === pid)) throw fail('Not found', 404);
    // Money received or paid without allocation sits "on account" until it is matched to an invoice. Hidden from restricted users.
    res.json({ parties, rows: await partyRows(req.scope, kind, pid), on_account: req.scope.restricted ? 0 : await onAccount(kind, pid) });
  }));

  // ---------- aging ----------
  api.get('/aging/:kind', can('finance'), kindOk, safe(async (req, res) => {
    const kind = req.params.kind, pid = +req.query.party_id || null;
    const rows = (await partyRows(req.scope, kind, pid)).filter(r => Math.abs(r.balance) > 0.004 || (kind === 'inscomm' || kind === 'producer') && Math.abs(r.original - r.settled) > 0.004);
    res.json({ buckets: BUCKETS.map(b => b[0]), rows, parties: await partiesOf(req.scope, kind) });
  }));

  // ---------- finance dashboard ----------
  api.get('/fin-dashboard', can('finance'), safe(async (req, res) => {
    const [cl, ins, com, pro] = await Promise.all(['client', 'insurer', 'inscomm', 'producer'].map(k => req.scope.statementOk(k) ? partyRows(req.scope, k) : null));
    const sum = (rows, k) => rows ? r2(rows.reduce((s, r) => s + r[k], 0)) : null, cnt = (rows, f) => rows ? rows.filter(f).length : null;
    const pend = await one(`SELECT count(*)::int n, count(DISTINCT p.invoice_id)::int inv, coalesce(sum(p.amount),0) amt,
        count(*) FILTER (WHERE p.cheque_date<=CURRENT_DATE)::int due_n, coalesce(sum(p.amount) FILTER (WHERE p.cheque_date<=CURRENT_DATE),0) due_amt
      FROM pdcs p JOIN invoices i ON i.id=p.invoice_id WHERE p.status='Pending' AND ${req.scope.inv('i.')}`);
    const out = { pdc: pend,
      client: { outstanding: sum(cl, 'balance'), invoices: cnt(cl, r => r.balance > 0.004), over90: cl ? r2(cl.filter(r => r.age > 90).reduce((s, r) => s + Math.max(0, r.balance), 0)) : null },
      insurer: { payable: sum(ins, 'balance'), invoices: cnt(ins, r => r.balance > 0.004) },
      commission: { due: sum(com, 'balance'), waiting: com ? r2(com.reduce((s, r) => s + r.pdc + r.on_outstanding, 0)) : null, received: sum(com, 'settled') },
      producer: { payable: sum(pro, 'balance'), waiting: pro ? r2(pro.reduce((s, r) => s + r.pdc + r.on_outstanding, 0)) : null } };
    if (!req.scope.restricted) {
      out.cash = await q(`SELECT a.id, a.code, a.name, a.cash_kind, coalesce(sum(l.dr)-sum(l.cr),0) bal FROM accounts a LEFT JOIN journal_lines l ON l.account_id=a.id
        WHERE a.cash_kind IS NOT NULL AND a.active GROUP BY a.id ORDER BY a.code`);
      const v = await one(`SELECT coalesce(sum(l.cr)-sum(l.dr) FILTER (WHERE a.code='2104'),0) out_vat, coalesce(sum(l.dr)-sum(l.cr) FILTER (WHERE a.code='1105'),0) in_vat
        FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE a.code IN ('2104','1105')`);
      out.vat = { output: r2(v.out_vat), input: r2(v.in_vat), net: r2(v.out_vat - v.in_vat) };
    }
    res.json(out);
  }));

  // PDC premium: every invoice that has cheques waiting, with the cheques themselves.
  api.get('/pdc-premium', can('finance'), safe(async (req, res) => {
    const rows = await q(`SELECT i.id, i.ref, i.invoice_date, i.policy_no, i.endorsement_no, i.total premium, c.name client_name, s.name insurer_name,
        count(p.*)::int pdc_n, sum(p.amount) pdc_amount, min(p.cheque_date) next_date,
        json_agg(json_build_object('id',p.id,'ref',p.ref,'cheque_no',p.cheque_no,'bank',p.bank,'cheque_date',p.cheque_date,'amount',p.amount,'payee',p.payee) ORDER BY p.cheque_date) cheques
      FROM pdcs p JOIN invoices i ON i.id=p.invoice_id JOIN clients c ON c.id=i.client_id JOIN insurers s ON s.id=i.insurer_id
      WHERE p.status='Pending' AND ${req.scope.inv('i.')} GROUP BY i.id, c.name, s.name ORDER BY min(p.cheque_date)`);
    const paid = {}; if (rows.length) (await q(`SELECT l.invoice_id, sum(l.dr)-sum(l.cr) bal FROM journal_lines l JOIN accounts a ON a.id=l.account_id
      WHERE a.party_kind='client' AND l.invoice_id = ANY($1) GROUP BY 1`, [rows.map(r => r.id)])).forEach(r => paid[r.invoice_id] = r.bal);
    rows.forEach(r => { r.outstanding = r2(paid[r.id] || 0); r.client_paid = r2(r.premium - r.outstanding); });
    res.json(rows);
  }));

  // ---------- VAT report ----------
  api.get('/vat', can('finance'), fullBooks, safe(async (req, res) => {
    const from = req.query.from || '1900-01-01', to = req.query.to || '2999-12-31';
    const lines = await q(`SELECT a.code, j.id journal_id, j.no, j.jdate, j.type, j.narration, l.memo, i.ref invoice_ref, l.dr, l.cr
      FROM journal_lines l JOIN journals j ON j.id=l.journal_id JOIN accounts a ON a.id=l.account_id LEFT JOIN invoices i ON i.id=l.invoice_id
      WHERE a.code IN ('2104','1105') AND j.jdate BETWEEN $1 AND $2 ORDER BY j.jdate, j.id`, [from, to]);
    const output = lines.filter(l => l.code === '2104').map(l => ({ ...l, amount: r2(l.cr - l.dr) })), input = lines.filter(l => l.code === '1105').map(l => ({ ...l, amount: r2(l.dr - l.cr) }));
    const t = a => r2(a.reduce((s, l) => s + l.amount, 0));
    res.json({ from, to, output, input, output_total: t(output), input_total: t(input), net: r2(t(output) - t(input)) });
  }));

  // ---------- amortization of prepaid expenses ----------
  // A schedule spreads a prepaid amount over a number of months. Running a month posts one voucher per schedule:
  // debit the expense, credit the prepaid account. A month is never posted twice.
  api.get('/amort', can('finance'), fullBooks, safe(async (req, res) => res.json(await q(`
    SELECT m.*, pa.code prepaid_code, pa.name prepaid_name, ea.code expense_code, ea.name expense_name,
      coalesce((SELECT sum(amount) FROM amort_runs r JOIN journals j ON j.id=r.journal_id WHERE r.amort_id=m.id AND j.status='Posted'),0) posted,
      (SELECT count(*)::int FROM amort_runs r JOIN journals j ON j.id=r.journal_id WHERE r.amort_id=m.id AND j.status='Posted') months_posted,
      (SELECT max(month) FROM amort_runs r JOIN journals j ON j.id=r.journal_id WHERE r.amort_id=m.id AND j.status='Posted') last_month
    FROM amort m JOIN accounts pa ON pa.id=m.prepaid_account_id JOIN accounts ea ON ea.id=m.expense_account_id ORDER BY m.id DESC`))));
  api.post('/amort', can('book'), fullBooks, safe(async (req, res) => {
    const b = req.body; need(b, 'name', 'prepaid_account_id', 'expense_account_id', 'total', 'start_month', 'months');
    if (!/^\d{4}-\d{2}$/.test(b.start_month)) throw fail('Start month must look like 2026-01');
    const pa = await one('SELECT * FROM accounts WHERE id=$1', [b.prepaid_account_id]), ea = await one('SELECT * FROM accounts WHERE id=$1', [b.expense_account_id]);
    if (!pa || pa.type !== 'A' || pa.is_group || pa.control) throw fail('Choose a prepaid (asset) account that takes entries');
    if (!ea || ea.type !== 'X' || ea.is_group) throw fail('Choose an expense account that takes entries');
    const m = await one(`INSERT INTO amort(name,prepaid_account_id,expense_account_id,total,start_month,months,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.name.trim(), pa.id, ea.id, r2(b.total), b.start_month, Math.round(+b.months), req.user.id]);
    await audit({ q }, req.user.id, 'Amortization schedule added', 'amort', m.name, `${m.total} over ${m.months} months`); res.json(m);
  }));
  api.post('/amort/:id/stop', can('book'), fullBooks, safe(async (req, res) => { await q('UPDATE amort SET active=FALSE WHERE id=$1', [req.params.id]); res.json({ ok: true }); }));
  api.post('/amort/run', can('book'), fullBooks, safe(async (req, res) => {
    const upto = req.body.month; if (!/^\d{4}-\d{2}$/.test(upto || '')) throw fail('Choose the month to post up to');
    res.json(await tx(async t => {
      const posted = [];
      for (const m of await t.q('SELECT * FROM amort WHERE active ORDER BY id FOR UPDATE')) {
        const done = new Set((await t.q(`SELECT r.month FROM amort_runs r JOIN journals j ON j.id=r.journal_id WHERE r.amort_id=$1 AND j.status='Posted'`, [m.id])).map(r => r.month));
        const per = r2(m.total / m.months);
        for (let k = 0; k < m.months; k++) {
          const d = new Date(m.start_month + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + k);
          const month = d.toISOString().slice(0, 7); if (month > upto) break; if (done.has(month)) continue;
          const amt = k === m.months - 1 ? r2(m.total - per * (m.months - 1)) : per;          // last month takes the rounding
          const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
          const j = await postVoucher(t, { type: 'Amortization', date: end, ref: 'AMORT ' + month, narration: `${m.name} – ${month} (${k + 1} of ${m.months})`, user: req.user,
            lines: [{ account_id: m.expense_account_id, dr: amt, cr: 0 }, { account_id: m.prepaid_account_id, dr: 0, cr: amt }] });
          await t.q('DELETE FROM amort_runs WHERE amort_id=$1 AND month=$2', [m.id, month]);
          await t.q('INSERT INTO amort_runs(amort_id,month,amount,journal_id) VALUES($1,$2,$3,$4)', [m.id, month, amt, j.id]);
          posted.push(j.no);
        }
      }
      return { ok: true, posted };
    }));
  }));

};
