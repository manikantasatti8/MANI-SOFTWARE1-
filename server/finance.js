// Finance: chart of accounts, vouchers (with or without allocation), direct payments, PDC cheques, statements.
const { q, one, tx, nextNo, audit } = require('./db');
const { r2 } = require('./posting');

// Voucher types and the prefix of their running number.
const VTYPES = { 'Bank Receipt': 'BR', 'Bank Payment': 'BP', 'Cash Receipt': 'CR', 'Cash Payment': 'CP', 'General Voucher': 'JV', 'Direct Payment': 'DP' };
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
      if (type !== 'General Voucher') {
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

module.exports = (api, { wrap, fail, need, can }) => {
  const safe = fn => wrap(async (req, res) => { try { await fn(req, res); } catch (e) { throw e.status ? e : fail(e.message); } });

  // ---------- chart of accounts ----------
  api.get('/accounts', can('finance'), safe(async (req, res) => res.json(await q(`
    SELECT a.*, coalesce(b.dr,0) dr, coalesce(b.cr,0) cr FROM accounts a
    LEFT JOIN (SELECT account_id, sum(dr) dr, sum(cr) cr FROM journal_lines GROUP BY 1) b ON b.account_id=a.id ORDER BY a.code`))));
  api.post('/accounts', can('book'), safe(async (req, res) => {
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
  api.put('/accounts/:id', can('book'), safe(async (req, res) => {
    need(req.body, 'name');
    const a = await one('UPDATE accounts SET name=$1, active=$2 WHERE id=$3 RETURNING *', [req.body.name.trim(), req.body.active !== false && req.body.active !== 'false', req.params.id]);
    await audit({ q }, req.user.id, 'Account updated', 'account', a.code, a.name); res.json(a);
  }));
  // Account ledger with running balance.
  api.get('/accounts/:id/ledger', can('finance'), safe(async (req, res) => {
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
      WHERE l.account_id=$1 AND i.status='Approved' GROUP BY i.id, c.name HAVING abs(sum(l.dr)-sum(l.cr))>0.004 ORDER BY i.invoice_date, i.id`, [a.id]));
  }));

  // ---------- vouchers ----------
  // Receipt / payment: one bank or cash account against any number of lines. General voucher: free debit and credit lines.
  api.post('/vouchers', can('book'), safe(async (req, res) => {
    const b = req.body; need(b, 'type', 'date');
    if (!VTYPES[b.type] || b.type === 'Direct Payment') throw fail('Unknown voucher type');
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
    const b = req.body; need(b, 'date');
    res.json(await tx(async t => {
      const j = await postVoucher(t, { type: 'Direct Payment', date: b.date, ref: b.ref, narration: b.narration || 'Premium paid directly to insurer by client', lines: await directLines(t, b.items || []), user: req.user });
      return { ok: true, journal_no: j.no };
    }));
  }));

  // ---------- PDC cheques, each tied to an invoice ----------
  api.get('/pdcs', can('finance'), safe(async (req, res) => res.json(await q(`
    SELECT p.*, i.ref invoice_ref, i.policy_no, c.name client_name, s.name insurer_name, j.no journal_no
    FROM pdcs p JOIN invoices i ON i.id=p.invoice_id JOIN clients c ON c.id=i.client_id JOIN insurers s ON s.id=i.insurer_id LEFT JOIN journals j ON j.id=p.journal_id
    ORDER BY (p.status='Pending') DESC, p.cheque_date, p.id`))));
  api.post('/pdcs', can('book'), safe(async (req, res) => {
    const b = req.body; need(b, 'invoice_id', 'cheque_no', 'cheque_date', 'amount');
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
    if (!['Bounced', 'Cancelled'].includes(req.body.status)) throw fail('Unknown status');
    const p = await one(`UPDATE pdcs SET status=$2, note=coalesce($3,note) WHERE id=$1 AND status='Pending' RETURNING *`, [req.params.id, req.body.status, req.body.reason || null]);
    if (!p) throw fail('This cheque is not pending');
    await audit({ q }, req.user.id, 'PDC ' + req.body.status.toLowerCase(), 'pdc', p.ref, req.body.reason); res.json({ ok: true });
  }));

  // ---------- statements ----------
  // One row per approved invoice, with the commission split the way a broker reads it:
  //   original = PDC part + part still tied to unpaid premium + due part;  balance = due part − already settled.
  // Commission becomes due in step with the premium the client has paid (to us or directly to the insurer).
  api.get('/statements/:kind', can('finance'), safe(async (req, res) => {
    const kind = req.params.kind; if (!PARTY_COL[kind]) throw fail('Unknown statement');
    const tbl = { client: 'clients', insurer: 'insurers', inscomm: 'insurers', producer: 'producers' }[kind];
    const parties = await q(`SELECT DISTINCT p.id, p.name FROM ${tbl} p JOIN accounts a ON a.party_kind=$1 AND a.party_id=p.id ORDER BY p.name`, [kind]);
    const pid = +req.query.party_id || null;
    if (!pid) return res.json({ parties, rows: [], on_account: 0 });
    const inv = await q(`SELECT i.*, c.name client_name, s.name insurer_name, p.name producer_name,
        coalesce((SELECT sum(amount) FROM pdcs WHERE invoice_id=i.id AND status='Pending'),0) pdc
      FROM invoices i JOIN clients c ON c.id=i.client_id JOIN insurers s ON s.id=i.insurer_id LEFT JOIN producers p ON p.id=i.producer_id
      WHERE i.status='Approved' AND i.${PARTY_COL[kind]}=$1 ORDER BY i.invoice_date, i.id`, [pid]);
    const mv = {}; (await q(`SELECT l.invoice_id, a.party_kind k, sum(l.dr)-sum(l.cr) bal FROM journal_lines l JOIN accounts a ON a.id=l.account_id
      WHERE l.invoice_id = ANY($1) AND a.party_kind IS NOT NULL GROUP BY 1,2`, [inv.map(i => i.id)])).forEach(r => (mv[r.invoice_id] = mv[r.invoice_id] || {})[r.k] = r.bal);
    const rows = inv.map(i => {
      const m = mv[i.id] || {}, T = i.total, cbal = r2(m.client || 0), paid = r2(T - cbal);
      const ratio = Math.abs(T) > 0.005 ? Math.max(0, Math.min(1, paid / T)) : 1;
      const pdcShare = Math.abs(T) > 0.005 ? Math.max(0, Math.min(1 - ratio, i.pdc / T)) : 0;        // part of the premium covered by pending cheques
      const split = full => { const pdc = r2(full * pdcShare), due = r2(full * ratio); return { original: full, pdc, on_outstanding: r2(full - pdc - due), due }; };
      const base = { id: i.id, ref: i.ref, invoice_date: i.invoice_date, client_name: i.client_name, insurer_name: i.insurer_name, producer_name: i.producer_name,
        policy_no: i.policy_no, endorsement_no: i.endorsement_no, issue_type: i.issue_type };
      if (kind === 'client') return { ...base, original: T, pdc: Math.min(i.pdc, Math.max(0, cbal)), settled: paid, balance: cbal };
      if (kind === 'insurer') { const bal = r2(-(m.insurer || 0)); return { ...base, original: T, settled: r2(T - bal), balance: bal }; }
      if (kind === 'inscomm') { const s = split(r2(i.comm_amt + i.comm_vat)), settled = r2(s.original - (m.inscomm || 0)); return { ...base, ...s, settled, balance: r2(s.due - settled) }; }
      const s = split(r2(i.prod_amt + i.prod_vat)), settled = r2(s.original + (m.producer || 0)); return { ...base, ...s, settled, balance: r2(s.due - settled) };
    }).filter(r => kind !== 'producer' || r.original);
    // Money received or paid without allocation sits "on account" until it is matched to an invoice.
    const oa = await one(`SELECT coalesce(sum(l.dr)-sum(l.cr),0) bal FROM journal_lines l JOIN accounts a ON a.id=l.account_id WHERE a.party_kind=$1 AND a.party_id=$2 AND l.invoice_id IS NULL`, [kind, pid]);
    const debitNormal = kind === 'client' || kind === 'inscomm';
    res.json({ parties, rows, on_account: r2(debitNormal ? oa.bal : -oa.bal), account: await one('SELECT id, code, name FROM accounts WHERE party_kind=$1 AND party_id=$2', [kind, pid]) });
  }));
};
