// More modules: allocation of on-account money, bank reconciliation, year-end close, staff and provisions,
// renewals, and document attachments.
const { q, one, tx, nextNo, audit } = require('./db');
const { r2 } = require('./posting');
const { postVoucher, lockDate } = require('./finance');

const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const monthEnd = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);

// UAE end-of-service gratuity on basic salary: nothing before one year of service; 21 days per year for the
// first five years and 30 days per year after that; total capped at two years' basic. A day = basic / 30.
function gratuity(s, asAt) {
  const days = daysBetween(s.join_date, asAt) + 1; if (days < 365 || !s.basic) return { years: r2(days / 365), amount: 0 };
  const years = days / 365, daily = s.basic / 30;
  const amount = Math.min(Math.min(5, years) * 21 * daily + Math.max(0, years - 5) * 30 * daily, s.basic * 24);
  return { years: r2(years), amount: r2(amount) };
}
// Leave salary: 30 days a year accrue on basic; days already taken are deducted.
function leave(s, asAt) {
  const days = Math.max(0, r2((daysBetween(s.join_date, asAt) + 1) / 365 * 30 - (+s.leave_taken || 0)));
  return { days, amount: r2(days * s.basic / 30) };
}

module.exports = (api, { wrap, fail, need, can }) => {
  const safe = fn => wrap(async (req, res) => { try { await fn(req, res); } catch (e) { throw e.status ? e : fail(e.message); } });
  const fullBooks = (req, res, next) => req.scope.restricted ? res.status(403).json({ error: 'Your access is limited to part of the business, so this is not available to you' }) : next();
  const acct = code => one('SELECT * FROM accounts WHERE code=$1', [code]);

  // ---------- allocation: match money received or paid on account to invoices ----------
  api.post('/allocate', can('book'), fullBooks, safe(async (req, res) => {
    const b = req.body; need(b, 'account_id', 'date');
    const items = (b.items || []).map(i => ({ invoice_id: +i.invoice_id, amount: r2(i.amount) })).filter(i => i.amount > 0);
    if (!items.length) throw fail('Enter the amount to allocate against at least one invoice');
    res.json(await tx(async t => {
      const a = await t.one('SELECT * FROM accounts WHERE id=$1 FOR UPDATE', [b.account_id]);
      if (!a || !a.party_kind) throw fail('Choose a client, insurer or producer account');
      const debitNormal = a.party_kind === 'client' || a.party_kind === 'inscomm';
      const u = (await t.one('SELECT coalesce(sum(dr)-sum(cr),0) bal FROM journal_lines WHERE account_id=$1 AND invoice_id IS NULL', [a.id])).bal;
      const available = r2(debitNormal ? -u : u), total = r2(items.reduce((s, i) => s + i.amount, 0));
      if (total > available + 0.004) throw fail(`Only ${available.toFixed(2)} is unallocated on this account`);
      // Money on account sits on the account without an invoice; this moves it onto the invoices.
      const lines = [{ account_id: a.id, dr: debitNormal ? total : 0, cr: debitNormal ? 0 : total, memo: 'Allocated from on account' },
        ...items.map(i => ({ account_id: a.id, dr: debitNormal ? 0 : i.amount, cr: debitNormal ? i.amount : 0, memo: 'Allocation', invoice_id: i.invoice_id }))];
      const j = await postVoucher(t, { type: 'Allocation', date: b.date, ref: b.ref, narration: `Allocation of on-account amount – ${a.name}`, lines, user: req.user });
      return { ok: true, journal_no: j.no };
    }));
  }));

  // ---------- bank reconciliation ----------
  api.get('/bank-rec', can('finance'), fullBooks, safe(async (req, res) => {
    const banks = await q(`SELECT id, code, name FROM accounts WHERE cash_kind='bank' AND active ORDER BY code`);
    const id = +req.query.account_id || (banks[0] || {}).id; if (!id) return res.json({ banks, lines: [], recs: [] });
    const a = await one(`SELECT * FROM accounts WHERE id=$1 AND cash_kind='bank'`, [id]); if (!a) throw fail('Not a bank account', 404);
    const lines = await q(`SELECT l.id, l.dr, l.cr, l.memo, j.id journal_id, j.no, j.jdate, j.ref, j.narration FROM journal_lines l JOIN journals j ON j.id=l.journal_id
      WHERE l.account_id=$1 AND l.rec_id IS NULL ORDER BY j.jdate, j.id`, [id]);
    const bal = await one(`SELECT coalesce(sum(dr)-sum(cr),0) book, coalesce(sum(dr)-sum(cr) FILTER (WHERE rec_id IS NOT NULL),0) cleared FROM journal_lines WHERE account_id=$1`, [id]);
    const recs = await q(`SELECT r.*, u.name by_name, (SELECT count(*)::int FROM journal_lines WHERE rec_id=r.id) n FROM bank_recs r LEFT JOIN users u ON u.id=r.created_by WHERE account_id=$1 ORDER BY r.id DESC LIMIT 12`, [id]);
    res.json({ banks, account: a, lines, book: r2(bal.book), cleared: r2(bal.cleared), recs });
  }));
  api.post('/bank-rec', can('book'), fullBooks, safe(async (req, res) => {
    const b = req.body; need(b, 'account_id', 'statement_date', 'statement_balance');
    const ids = (b.line_ids || []).map(Number).filter(Boolean);
    res.json(await tx(async t => {
      const a = await t.one(`SELECT * FROM accounts WHERE id=$1 AND cash_kind='bank' FOR UPDATE`, [b.account_id]); if (!a) throw fail('Not a bank account');
      const sel = ids.length ? await t.q(`SELECT l.id, l.dr, l.cr, j.jdate FROM journal_lines l JOIN journals j ON j.id=l.journal_id WHERE l.id = ANY($1) AND l.account_id=$2 AND l.rec_id IS NULL`, [ids, a.id]) : [];
      if (sel.length !== ids.length) throw fail('Some lines are already reconciled or belong to another account. Reload the page.');
      if (sel.some(l => l.jdate > b.statement_date)) throw fail('A ticked line is dated after the statement date');
      const before = (await t.one('SELECT coalesce(sum(dr)-sum(cr),0) c FROM journal_lines WHERE account_id=$1 AND rec_id IS NOT NULL', [a.id])).c;
      const cleared = r2(before + sel.reduce((s, l) => s + l.dr - l.cr, 0)), diff = r2(r2(b.statement_balance) - cleared);
      if (Math.abs(diff) > 0.004) throw fail(`The ticked lines do not agree with the statement. Difference: ${diff.toFixed(2)}`);
      const r = await t.one('INSERT INTO bank_recs(account_id,statement_date,statement_balance,created_by) VALUES($1,$2,$3,$4) RETURNING id', [a.id, b.statement_date, r2(b.statement_balance), req.user.id]);
      if (ids.length) await t.q('UPDATE journal_lines SET rec_id=$1 WHERE id = ANY($2)', [r.id, ids]);
      await audit(t, req.user.id, 'Bank reconciled', 'account', a.code, `${b.statement_date} · ${r2(b.statement_balance)} · ${ids.length} lines`);
      return { ok: true };
    }));
  }));
  api.post('/bank-rec/:id/undo', can('book'), fullBooks, safe(async (req, res) => {
    await tx(async t => {
      const r = await t.one('SELECT * FROM bank_recs WHERE id=$1 FOR UPDATE', [req.params.id]); if (!r) throw fail('Not found', 404);
      const last = await t.one('SELECT max(id) id FROM bank_recs WHERE account_id=$1', [r.account_id]);
      if (last.id !== r.id) throw fail('Only the latest reconciliation can be undone');
      await t.q('UPDATE journal_lines SET rec_id=NULL WHERE rec_id=$1', [r.id]); await t.q('DELETE FROM bank_recs WHERE id=$1', [r.id]);
      await audit(t, req.user.id, 'Bank reconciliation undone', 'account', String(r.account_id), r.statement_date);
    });
    res.json({ ok: true });
  }));

  // ---------- year-end close and lock ----------
  api.get('/year-end', can('finance'), fullBooks, safe(async (req, res) => {
    const date = req.query.date || new Date().getFullYear() - 1 + '-12-31';
    const rows = await q(`SELECT a.code, a.name, a.type, sum(l.dr)-sum(l.cr) bal FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journals j ON j.id=l.journal_id
      WHERE a.type IN ('I','X') AND j.jdate<=$1 GROUP BY a.id HAVING abs(sum(l.dr)-sum(l.cr))>0.004 ORDER BY a.code`, [date]);
    const s = {}; (await q('SELECT * FROM settings')).forEach(r => s[r.key] = r.value);
    const ho = await acct(s.ho_account || '310501');
    res.json({ date, lock_date: s.lock_date || null, rows, profit: r2(-rows.reduce((t, r) => t + r.bal, 0)), ho_account: ho,
      closes: await q(`SELECT j.id, j.no, j.jdate, j.narration, j.status FROM journals j WHERE j.type='Year-end Close' ORDER BY j.id DESC`) });
  }));
  api.post('/year-end', can('admin'), safe(async (req, res) => {
    const b = req.body; need(b, 'date');
    res.json(await tx(async t => {
      const lock = await lockDate(t); if (lock && b.date <= lock) throw fail(`The books are already closed up to ${lock}`);
      const ho = await t.one(`SELECT * FROM accounts WHERE code=coalesce((SELECT value FROM settings WHERE key='ho_account'),'310501')`);
      if (!ho) throw fail('Head Office account not found');
      const rows = await t.q(`SELECT a.id, sum(l.dr)-sum(l.cr) bal FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journals j ON j.id=l.journal_id
        WHERE a.type IN ('I','X') AND j.jdate<=$1 GROUP BY a.id HAVING abs(sum(l.dr)-sum(l.cr))>0.004`, [b.date]);
      let j = null;
      if (rows.length) {
        // Every income and expense balance goes to zero; the net profit (or loss) moves to the Head Office account.
        const lines = rows.map(r => ({ account_id: r.id, dr: r.bal < 0 ? -r.bal : 0, cr: r.bal > 0 ? r.bal : 0, memo: 'Year-end close' }));
        const net = r2(rows.reduce((s, r) => s + r.bal, 0));            // negative = profit
        if (Math.abs(net) > 0.004) lines.push({ account_id: ho.id, dr: net > 0 ? net : 0, cr: net < 0 ? -net : 0, memo: net < 0 ? 'Profit for the year transferred to Head Office' : 'Loss for the year transferred to Head Office' });
        j = await postVoucher(t, { type: 'Year-end Close', date: b.date, ref: 'YE ' + b.date, narration: `Year-end close ${b.date}: ${net < 0 ? 'profit' : 'loss'} of ${Math.abs(net).toFixed(2)} transferred to ${ho.name}`, lines, user: req.user });
      }
      await t.q(`INSERT INTO settings(key,value) VALUES('lock_date',$1) ON CONFLICT (key) DO UPDATE SET value=$1`, [b.date]);
      await audit(t, req.user.id, 'Year closed and books locked', 'settings', b.date, j ? j.no : 'no income or expenses');
      return { ok: true, journal_no: j && j.no };
    }));
  }));

  // ---------- staff and provisions ----------
  api.get('/staff', can('book'), fullBooks, safe(async (req, res) => res.json(await q('SELECT * FROM staff ORDER BY active DESC, name'))));
  const staffVals = b => { need(b, 'name', 'join_date');
    return [b.emp_no || null, b.name.trim(), b.designation || null, b.join_date, r2(b.basic), r2(b.allowances), +b.leave_taken || 0, b.exit_date || null, b.active !== false && b.active !== 'false']; };
  api.post('/staff', can('book'), fullBooks, safe(async (req, res) => {
    const s = await one('INSERT INTO staff(emp_no,name,designation,join_date,basic,allowances,leave_taken,exit_date,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', staffVals(req.body));
    await audit({ q }, req.user.id, 'Staff added', 'staff', s.emp_no || s.name, s.name); res.json(s);
  }));
  api.put('/staff/:id', can('book'), fullBooks, safe(async (req, res) => {
    const s = await one('UPDATE staff SET emp_no=$1,name=$2,designation=$3,join_date=$4,basic=$5,allowances=$6,leave_taken=$7,exit_date=$8,active=$9 WHERE id=$10 RETURNING *', [...staffVals(req.body), req.params.id]);
    await audit({ q }, req.user.id, 'Staff updated', 'staff', s.emp_no || s.name, s.name); res.json(s);
  }));
  const provisionPreview = async (t, month) => {
    if (!/^\d{4}-\d{2}$/.test(month || '')) throw fail('Choose the month');
    const asAt = monthEnd(month);
    const staff = (await t.q('SELECT * FROM staff WHERE active AND join_date<=$1 ORDER BY name', [asAt])).map(s => ({ ...s, gratuity: gratuity(s, asAt), leave: leave(s, asAt) }));
    const bal = async code => (await t.one(`SELECT coalesce(sum(l.cr)-sum(l.dr),0) b FROM journal_lines l JOIN accounts a ON a.id=l.account_id JOIN journals j ON j.id=l.journal_id WHERE a.code=$1 AND j.jdate<=$2`, [code, asAt])).b;
    const needG = r2(staff.reduce((s, x) => s + x.gratuity.amount, 0)), needL = r2(staff.reduce((s, x) => s + x.leave.amount, 0));
    const haveG = r2(await bal('2201')), haveL = r2(await bal('2107'));
    const done = await t.one(`SELECT r.*, j.no FROM provision_runs r JOIN journals j ON j.id=r.journal_id WHERE r.month=$1 AND j.status='Posted'`, [month]);
    return { month, asAt, staff, needG, needL, haveG, haveL, diffG: r2(needG - haveG), diffL: r2(needL - haveL), done: done || null };
  };
  api.get('/provisions', can('book'), fullBooks, safe(async (req, res) => res.json(await provisionPreview({ q, one }, req.query.month))));
  api.post('/provisions', can('book'), fullBooks, safe(async (req, res) => {
    res.json(await tx(async t => {
      await t.q(`SELECT pg_advisory_xact_lock(4711)`);
      const p = await provisionPreview(t, req.body.month);
      if (p.done) throw fail(`Provisions for ${p.month} were already posted as ${p.done.no}`);
      const id = async code => (await t.one('SELECT id FROM accounts WHERE code=$1', [code])).id, L = [];
      // Only the difference between what is needed and what is already provided is posted.
      const pair = async (diff, exp, prov, label) => { if (Math.abs(diff) < 0.005) return;
        L.push({ account_id: await id(exp), dr: diff > 0 ? diff : 0, cr: diff < 0 ? -diff : 0, memo: label });
        L.push({ account_id: await id(prov), dr: diff < 0 ? -diff : 0, cr: diff > 0 ? diff : 0, memo: label }); };
      await pair(p.diffG, '5204', '2201', 'End of service gratuity – ' + p.month);
      await pair(p.diffL, '5203', '2107', 'Leave salary – ' + p.month);
      if (!L.length) throw fail('Nothing to post: provisions already match');
      const j = await postVoucher(t, { type: 'Provision', date: p.asAt, ref: 'PROV ' + p.month, narration: `Gratuity and leave salary provisions – ${p.month} (${p.staff.length} staff)`, lines: L, user: req.user });
      await t.q('INSERT INTO provision_runs(month,gratuity,leave,journal_id,created_by) VALUES($1,$2,$3,$4,$5)', [p.month, p.diffG, p.diffL, j.id, req.user.id]);
      return { ok: true, journal_no: j.no, gratuity: p.diffG, leave: p.diffL };
    }));
  }));

  // ---------- renewals ----------
  api.get('/renewals', safe(async (req, res) => {
    const days = Math.min(365, Math.max(1, +req.query.days || 90));
    res.json(await q(`SELECT i.id, i.ref, i.policy_no, i.start_date, i.expiry_date, i.net, i.total, i.dept, i.cls, i.sub, c.name client_name, s.name insurer_name, p.name producer_name,
        (i.expiry_date - CURRENT_DATE) days_left, e.id renewal_id, e.ref renewal_ref, e.stage renewal_stage,
        (SELECT x.ref FROM invoices x WHERE x.enquiry_id=e.id AND x.status='Approved' LIMIT 1) renewed_by
      FROM invoices i JOIN clients c ON c.id=i.client_id JOIN insurers s ON s.id=i.insurer_id LEFT JOIN producers p ON p.id=i.producer_id
      LEFT JOIN LATERAL (SELECT * FROM enquiries WHERE renews_invoice_id=i.id AND stage<>'Lost' ORDER BY id DESC LIMIT 1) e ON TRUE
      WHERE i.status='Approved' AND i.issue_type<>'Endorsement' AND i.expiry_date IS NOT NULL
        AND i.expiry_date BETWEEN CURRENT_DATE-60 AND CURRENT_DATE+$1::int AND ${req.scope.inv('i.')}
      ORDER BY i.expiry_date`, [days]));
  }));
  api.post('/policies/:id/renew', can('produce'), safe(async (req, res) => {
    res.json(await tx(async t => {
      const i = await t.one(`SELECT * FROM invoices i WHERE i.id=$1 AND i.status='Approved' AND i.issue_type<>'Endorsement' AND ${req.scope.inv('i.')}`, [req.params.id]);
      if (!i) throw fail('Policy not found', 404);
      if (await t.one(`SELECT 1 FROM enquiries WHERE renews_invoice_id=$1 AND stage<>'Lost'`, [i.id])) throw fail('A renewal has already been started for this policy');
      const ref = await nextNo(t, 'ENQ', 4);
      const e = await t.one(`INSERT INTO enquiries(ref,client_id,dept,grp,cls,sub,type,source,priority,producer_id,sum_insured,premium_est,inception,requirements,created_by,renews_invoice_id)
        VALUES($1,$2,$3,$4,$5,$6,'Renewal','Renewal','High',$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [ref, i.client_id, i.dept, i.grp, i.cls, i.sub, i.producer_id, i.sum_insured, i.net, i.expiry_date ? addDays(i.expiry_date, 1) : null,
          `Renewal of policy ${i.policy_no} expiring ${i.expiry_date || ''}`, req.user.id, i.id]);
      await t.q(`INSERT INTO enquiry_notes(enquiry_id,kind,body,user_id) VALUES($1,'event',$2,$3)`, [e.id, `Renewal started for policy ${i.policy_no}`, req.user.id]);
      await audit(t, req.user.id, 'Renewal started', 'enquiry', ref, i.policy_no);
      return e;
    }));
  }));

  // ---------- documents attached to a client, enquiry or invoice ----------
  const visible = async (req, entity, id) => {
    const cond = { client: ['clients', req.scope.cli('x.')], enquiry: ['enquiries', req.scope.enq('x.')], invoice: ['invoices', req.scope.inv('x.')] }[entity];
    if (!cond || !(await one(`SELECT 1 FROM ${cond[0]} x WHERE x.id=$1 AND ${cond[1]}`, [id]))) throw fail('Not found', 404);
  };
  const ALLOWED = /\.(pdf|jpe?g|png|gif|webp|docx?|xlsx?|csv|txt|msg|eml|zip)$/i;
  api.get('/documents', safe(async (req, res) => {
    await visible(req, req.query.entity, +req.query.entity_id);
    res.json(await q(`SELECT d.id, d.name, d.mime, d.size, d.at, d.uploaded_by, u.name by_name FROM documents d LEFT JOIN users u ON u.id=d.uploaded_by
      WHERE d.entity=$1 AND d.entity_id=$2 ORDER BY d.id DESC`, [req.query.entity, +req.query.entity_id]));
  }));
  api.post('/documents', safe(async (req, res) => {
    const b = req.body; need(b, 'entity', 'entity_id', 'name', 'data');
    await visible(req, b.entity, +b.entity_id);
    const name = String(b.name).replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 180);
    if (!ALLOWED.test(name)) throw fail('This file type is not allowed. Use PDF, images, Word, Excel, CSV, text, email or zip files.');
    const data = Buffer.from(String(b.data), 'base64');
    if (!data.length) throw fail('The file is empty'); if (data.length > 10 * 1024 * 1024) throw fail('The file is larger than 10 MB');
    const d = await one('INSERT INTO documents(entity,entity_id,name,mime,size,data,uploaded_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,size',
      [b.entity, +b.entity_id, name, String(b.mime || 'application/octet-stream').slice(0, 100), data.length, data, req.user.id]);
    await audit({ q }, req.user.id, 'Document attached', b.entity, String(b.entity_id), name); res.json(d);
  }));
  api.get('/documents/:id/file', safe(async (req, res) => {
    const d = await one('SELECT * FROM documents WHERE id=$1', [req.params.id]); if (!d) throw fail('Not found', 404);
    await visible(req, d.entity, d.entity_id);
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${encodeURIComponent(d.name)}"; filename*=UTF-8''${encodeURIComponent(d.name)}`,
      'Content-Security-Policy': "default-src 'none'" });
    res.send(d.data);
  }));
  api.delete('/documents/:id', safe(async (req, res) => {
    const d = await one('SELECT id, entity, entity_id, name, uploaded_by FROM documents WHERE id=$1', [req.params.id]); if (!d) throw fail('Not found', 404);
    await visible(req, d.entity, d.entity_id);
    if (d.uploaded_by !== req.user.id && req.user.role !== 'Admin') throw fail('Only the person who attached it, or an administrator, can remove it', 403);
    await q('DELETE FROM documents WHERE id=$1', [d.id]);
    await audit({ q }, req.user.id, 'Document removed', d.entity, String(d.entity_id), d.name); res.json({ ok: true });
  }));
};
