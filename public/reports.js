/* Reports: finance dashboard, PDC premium, aging, VAT, amortization, profit & loss, balance sheet. */
const pageHead = (title, sub, extra = '') => `<div class="head"><div><h1>${title}</h1><p>${sub}</p></div><span class="sp"></span>${extra}
  <button class="btn noprint" data-do="csv">${ic('doc')}Export to Excel</button><button class="btn noprint" onclick="window.print()">Print</button></div>`;
const num = (v, bold) => Math.abs(v || 0) < 0.005 ? '<span class="mute">—</span>' : bold ? `<b>${nf(v)}</b>` : nf(v);
const quarterStart = () => { const d = new Date(), m = Math.floor(d.getMonth() / 3) * 3; return `${d.getFullYear()}-${String(m + 1).padStart(2, '0')}-01`; };
const yearStart = () => new Date().getFullYear() + '-01-01';

/* ---------- finance dashboard ---------- */
views.fin = async () => {
  const d = await api('GET', '/fin-dashboard');
  const card = (href, label, value, sub, color, seed) => value === null || value === undefined ? '' :
    `<a class="card lift kpi" href="${href}"><span class="go">Open ›</span><div class="lbl">${label}</div><div class="val">${n0(value)}</div><div class="sub">${sub}</div>${spark(color, seed)}</a>`;
  const cash = (d.cash || []).filter(a => a.cash_kind === 'cash'), bank = (d.cash || []).filter(a => a.cash_kind === 'bank'), tot = l => l.reduce((s, a) => s + a.bal, 0);
  const list = l => l.map(a => `<div class="row mini"><span>${esc(a.name)}</span><span class="sp"></span><b>${nf(a.bal)}</b></div>`).join('');
  return `<div class="head"><div><h1>Finance Dashboard</h1><p>Click any card to open its detailed page</p></div></div>
    <div class="grid g4" style="margin-bottom:16px">
      ${d.cash ? `<a class="card lift kpi" href="#coa"><span class="go">Open ›</span><div class="lbl">Cash in hand</div><div class="val">${n0(tot(cash))}</div>${list(cash)}</a>
        <a class="card lift kpi" href="#coa"><span class="go">Open ›</span><div class="lbl">Bank balance</div><div class="val">${n0(tot(bank))}</div>${list(bank)}</a>` : ''}
      ${card('#aging/client', 'Premium outstanding from clients', d.client.outstanding, `${d.client.invoices} invoices · <span class="${d.client.over90 ? 'bad' : ''}">${n0(d.client.over90)} over 90 days</span>`, '#3d8dff', 3)}
      ${card('#aging/insurer', 'Premium payable to insurers', d.insurer.payable, `${d.insurer.invoices} invoices still to pay`, '#f2a93b', 5)}
      ${card('#aging/inscomm', 'Commission due from insurers', d.commission.due, `Waiting on unpaid premium / PDC: ${n0(d.commission.waiting)}`, '#2fc27a', 7)}
      ${card('#aging/producer', 'Producer commission payable', d.producer.payable, `Waiting: ${n0(d.producer.waiting)}`, '#8f72f7', 4)}
      ${card('#pdc-premium', 'PDC premium', d.pdc.amt, `${d.pdc.n} cheques on ${d.pdc.inv} invoices${d.pdc.due_n ? ` · <span class="bad">${d.pdc.due_n} due now (${n0(d.pdc.due_amt)})</span>` : ''}`, '#22c1ff', 6)}
      ${d.vat ? card('#vat', 'VAT payable (net)', d.vat.net, `Output ${n0(d.vat.output)} · Input ${n0(d.vat.input)}`, '#f0575a', 2) : ''}
    </div>
    <div class="card"><h3>Reports</h3><div class="btns">
      ${stKinds().map(k => `<a class="btn" href="#statements/${k}">${ST[k][0]} statement</a>`).join('')}
      ${stKinds().map(k => `<a class="btn" href="#aging/${k}">${ST[k][0]} aging</a>`).join('')}
      ${restricted() ? '' : '<a class="btn" href="#financials/pl">Profit & Loss</a><a class="btn" href="#financials/bs">Balance Sheet</a><a class="btn" href="#tb">Trial Balance</a><a class="btn" href="#vat">VAT Report</a><a class="btn" href="#amort">Amortization</a>'}
    </div></div>`;
};

/* ---------- PDC premium ---------- */
views['pdc-premium'] = async () => {
  const rows = (await api('GET', '/pdc-premium')).filter(r => hit(r.ref, r.client_name, r.insurer_name, r.policy_no));
  const t = k => rows.reduce((s, r) => s + (+r[k] || 0), 0);
  return pageHead('PDC Premium', 'Invoices with post-dated cheques still waiting to clear') +
    `<div class="buckets"><div class="card"><small>Invoices</small><b>${rows.length}</b></div><div class="card"><small>Cheques</small><b>${t('pdc_n')}</b></div>
      <div class="card"><small>PDC amount</small><b>${nf(t('pdc_amount'))}</b></div><div class="card"><small>Original premium</small><b>${nf(t('premium'))}</b></div></div>
    <div class="card">${rows.length ? `<div class="tw"><table class="export"><tr><th>Client</th><th>Invoice no.</th><th>Invoice date</th><th>Insurance company</th><th>Policy no.</th>
      <th class="num">Original premium</th><th class="num">Client paid</th><th class="num">Outstanding</th><th class="num">No. of PDCs</th><th class="num">PDC amount</th><th>Cheques</th></tr>
      ${rows.map(r => `<tr><td><b>${esc(r.client_name)}</b></td><td>${esc(r.ref)}</td><td>${fdate(r.invoice_date)}</td><td>${esc(r.insurer_name)}</td><td>${esc(r.policy_no)}${r.endorsement_no ? `<br><small class="mute">${esc(r.endorsement_no)}</small>` : ''}</td>
        <td class="num">${nf(r.premium)}</td><td class="num">${num(r.client_paid)}</td><td class="num">${nf(r.outstanding)}</td><td class="num">${r.pdc_n}</td><td class="num"><b>${nf(r.pdc_amount)}</b></td>
        <td class="mini">${r.cheques.map(c => `<div>${fdate(c.cheque_date)} · ${esc(c.cheque_no)}${c.bank ? ' ' + esc(c.bank) : ''} · <b>${nf(c.amount)}</b>${c.payee === 'Insurer' ? ' (to insurer)' : ''}${c.cheque_date <= today() ? ' ' + badge('Due', 'bad') : ''}</div>`).join('')}</td></tr>`).join('')}
      <tr class="tot"><td colspan="5">Total</td><td class="num">${nf(t('premium'))}</td><td class="num">${nf(t('client_paid'))}</td><td class="num">${nf(t('outstanding'))}</td><td class="num">${t('pdc_n')}</td><td class="num">${nf(t('pdc_amount'))}</td><td></td></tr></table></div>` : '<div class="empty">No cheques are waiting</div>'}</div>`;
};

/* ---------- aging ---------- */
const AG = {
  client: { title: 'Client Premium Aging', group: 'client_name', other: ['Insurer', 'insurer_name'], cols: [['Premium', 'premium'], ['Client paid', 'client_paid'], ['PDC held', 'pdc'], ['Outstanding', 'balance']] },
  insurer: { title: 'Insurer Premium Payable Aging', group: 'insurer_name', other: ['Client', 'client_name'], cols: [['Premium', 'premium'], ['Client paid', 'client_paid'], ['Paid to insurer', 'settled'], ['Payable', 'balance']] },
  inscomm: { title: 'Insurer Commission Aging', group: 'insurer_name', other: ['Client', 'client_name'], cols: [['Original premium', 'premium'], ['Client paid', 'client_paid'], ['Original commission', 'original'], ['Received', 'settled'], ['Not yet due', 'waiting'], ['Due commission', 'balance']] },
  producer: { title: 'Producer Commission Aging', group: 'producer_name', other: ['Client', 'client_name'], cols: [['Original premium', 'premium'], ['Client paid', 'client_paid'], ['Producer share', 'original'], ['Paid', 'settled'], ['Not yet due', 'waiting'], ['Due to producer', 'balance']] }
};
views.aging = async () => {
  const ok = stKinds(), kind = ok.includes(S.args[0]) ? S.args[0] : ok[0], cfg = AG[kind], pid = +S.args[1] || '';
  const d = await api('GET', `/aging/${kind}${pid ? '?party_id=' + pid : ''}`);
  const rows = d.rows.filter(r => hit(r.ref, r.policy_no, r.client_name, r.insurer_name, r.producer_name)).map(r => ({ ...r, waiting: r2((r.pdc || 0) + (r.on_outstanding || 0)) }));
  const groups = {}; rows.forEach(r => (groups[r[cfg.group] || '—'] = groups[r[cfg.group] || '—'] || []).push(r));
  const sum = (l, k) => l.reduce((s, r) => s + (r[k] || 0), 0), bsum = (l, b) => l.filter(r => r.bucket === b).reduce((s, r) => s + r.balance, 0);
  const ncol = 5 + cfg.cols.length + d.buckets.length;
  const line = r => `<tr><td>${fdate(r.invoice_date)}</td><td>${esc(r.ref)}</td><td>${esc(r[cfg.other[1]] || '')}</td><td>${esc(r.policy_no)}${r.endorsement_no ? `<br><small class="mute">${esc(r.endorsement_no)}</small>` : ''}</td><td class="num">${r.age}</td>
    ${cfg.cols.map((c, i) => `<td class="num">${num(r[c[1]], i === cfg.cols.length - 1)}</td>`).join('')}${d.buckets.map(b => `<td class="num">${r.bucket === b ? num(r.balance) : ''}</td>`).join('')}</tr>`;
  const totals = (l, label, cls) => `<tr class="${cls}"><td colspan="5">${label}</td>${cfg.cols.map(c => `<td class="num">${nf(sum(l, c[1]))}</td>`).join('')}${d.buckets.map(b => `<td class="num">${num(bsum(l, b))}</td>`).join('')}</tr>`;
  return pageHead(cfg.title, `As at ${fdate(today())} · age counted from the invoice date`) +
    `<div class="card" style="margin-bottom:16px"><div class="tabs">${ok.map(k => `<a href="#aging/${k}" class="${k === kind ? 'on' : ''}">${AG[k].title.replace(' Aging', '')}</a>`).join('')}</div>
      <div class="row noprint"><div style="width:360px"><label>Filter</label><select id="agParty" data-kind="${kind}"><option value="">All</option>${opts(d.parties.map(p => [p.id, p.name]), pid)}</select></div></div></div>
    <div class="buckets">${d.buckets.map(b => `<div class="card"><small>${b} days</small><b>${nf(bsum(rows, b))}</b></div>`).join('')}<div class="card"><small>Total</small><b>${nf(sum(rows, 'balance'))}</b></div></div>
    <div class="card">${rows.length ? `<div class="tw"><table class="export"><tr><th>Invoice date</th><th>Invoice no.</th><th>${cfg.other[0]}</th><th>Policy no.</th><th class="num">Days</th>
      ${cfg.cols.map(c => `<th class="num">${c[0]}</th>`).join('')}${d.buckets.map(b => `<th class="num">${b}</th>`).join('')}</tr>
      ${Object.keys(groups).sort().map(g => `<tr class="party"><td colspan="${ncol}">${esc(g)}</td></tr>${groups[g].map(line).join('')}${totals(groups[g], 'Total ' + esc(g), 'sub')}`).join('')}
      ${totals(rows, 'Grand total', 'tot')}</table></div>` : '<div class="empty">Nothing outstanding</div>'}</div>`;
};
document.addEventListener('change', e => { if (e.target.id === 'agParty') location.hash = `#aging/${e.target.dataset.kind}${e.target.value ? '/' + e.target.value : ''}`; });

/* ---------- VAT ---------- */
views.vat = async () => {
  const from = S.args[0] || quarterStart(), to = S.args[1] || today(), d = await api('GET', `/vat?from=${from}&to=${to}`);
  const tbl = (title, l, total) => `<div class="card" style="margin-bottom:16px"><h3>${title} <span class="sp"></span>${nf(total)}</h3>${l.length ? `<div class="tw"><table class="export"><tr><th>Date</th><th>Voucher</th><th>Invoice</th><th>Description</th><th class="num">VAT</th></tr>
    ${l.map(x => `<tr class="click" data-do="voucher" data-id="${x.journal_id}"><td>${fdate(x.jdate)}</td><td>${esc(x.no)}</td><td>${esc(x.invoice_ref || '')}</td><td class="dim">${esc(x.memo || x.narration || '')}</td><td class="num">${nf(x.amount)}</td></tr>`).join('')}
    <tr class="tot"><td colspan="4">Total</td><td class="num">${nf(total)}</td></tr></table></div>` : '<div class="empty">None in this period</div>'}</div>`;
  return pageHead('VAT Report', `${fdate(from)} to ${fdate(to)}`) +
    `<div class="card noprint" style="margin-bottom:16px"><div class="row wrap"><div><label>From</label><input type="date" id="vatFrom" value="${from}"></div><div><label>To</label><input type="date" id="vatTo" value="${to}"></div></div></div>
    <div class="buckets"><div class="card"><small>Output VAT (on our commission)</small><b>${nf(d.output_total)}</b></div><div class="card"><small>Input VAT (on our costs)</small><b>${nf(d.input_total)}</b></div>
      <div class="card"><small>${d.net >= 0 ? 'Net VAT payable' : 'Net VAT refundable'}</small><b class="${d.net >= 0 ? 'warn' : 'up'}">${nf(Math.abs(d.net))}</b></div></div>
    ${tbl('Output VAT', d.output, d.output_total)}${tbl('Input VAT', d.input, d.input_total)}`;
};
document.addEventListener('change', e => { if (e.target.id === 'vatFrom' || e.target.id === 'vatTo') location.hash = `#vat/${$('#vatFrom').value}/${$('#vatTo').value}`; });

/* ---------- amortization ---------- */
views.amort = async () => {
  const list = await api('GET', '/amort'), month = new Date().toISOString().slice(0, 7);
  return `<div class="head"><div><h1>Amortization</h1><p>Prepaid expenses (rent, insurance, licences) charged to expense month by month</p></div><span class="sp"></span>
    ${canBook() ? `<button class="btn pri" data-do="newAmort">${ic('plus')}New schedule</button>` : ''}</div>
    ${canBook() ? `<div class="card" style="margin-bottom:16px"><div class="row wrap"><div><label>Post every month due up to</label><input type="month" id="amortUpto" value="${month}"></div>
      <div style="align-self:flex-end"><button class="btn ok" data-do="runAmort">Post amortization</button></div><span class="sp"></span><small class="dim" style="max-width:460px">Each month is posted once only, as a voucher: debit the expense, credit the prepaid account. Months already posted are skipped.</small></div></div>` : ''}
    <div class="card">${list.length ? `<div class="tw"><table class="export"><tr><th>Schedule</th><th>Prepaid account</th><th>Expense account</th><th>Start</th><th class="num">Months</th><th class="num">Total</th><th class="num">Charged</th><th class="num">Remaining</th><th>Progress</th><th></th></tr>
      ${list.map(m => `<tr><td><b>${esc(m.name)}</b>${m.active ? '' : ' ' + badge('Stopped', 'mute')}</td><td class="dim">${esc(m.prepaid_code)} ${esc(m.prepaid_name)}</td><td class="dim">${esc(m.expense_code)} ${esc(m.expense_name)}</td>
        <td>${esc(m.start_month)}</td><td class="num">${m.months_posted} / ${m.months}</td><td class="num">${nf(m.total)}</td><td class="num">${nf(m.posted)}</td><td class="num"><b>${nf(m.total - m.posted)}</b></td>
        <td style="width:120px"><div class="progress"><i style="width:${Math.round(m.posted / m.total * 100)}%"></i></div></td>
        <td class="num">${canBook() && m.active && m.months_posted < m.months ? `<button class="btn sm danger" data-do="stopAmort" data-id="${m.id}">Stop</button>` : ''}</td></tr>`).join('')}</table></div>` : '<div class="empty">No schedules yet</div>'}</div>`;
};

/* ---------- profit & loss, balance sheet ---------- */
views.financials = async () => {
  const tab = S.args[0] === 'bs' ? 'bs' : 'pl', from = S.args[1] || yearStart(), to = S.args[2] || today();
  const all = await api('GET', `/financials?from=${from}&to=${to}`), by = {};
  all.forEach(a => { a.kids = []; by[a.code] = a; }); all.forEach(a => { if (a.parent_code && by[a.parent_code]) by[a.parent_code].kids.push(a); });
  const field = tab === 'pl' ? 'period' : 'closing', sign = a => (a.type === 'A' || a.type === 'X') ? 1 : -1;
  const val = a => sign(a) * a[field] + a.kids.reduce((s, k) => s + val(k), 0);
  const rowsOf = (a, d) => { const v = val(a); if (Math.abs(v) < 0.005) return '';
    const head = a.kids.length > 0; return `<tr class="${head ? 'grp' : ''}"><td class="ind${Math.min(d, 4)}">${esc(a.name)}</td><td class="dim">${esc(a.code)}</td><td class="num">${head ? '' : nf(v)}</td><td class="num">${head ? nf(v) : ''}</td></tr>` + a.kids.map(k => rowsOf(k, d + 1)).join(''); };
  const root = c => by[c], total = c => root(c) ? val(root(c)) : 0;
  const section = (c, label) => `<tr class="party"><td colspan="4">${label}</td></tr>${root(c) ? root(c).kids.map(k => rowsOf(k, 1)).join('') : ''}<tr class="sub"><td colspan="3">Total ${label.toLowerCase()}</td><td class="num">${nf(total(c))}</td></tr>`;
  const inc = total('4'), exp = total('5'), profit = inc - exp;
  const plProfitToDate = -all.filter(a => a.type === 'I' || a.type === 'X').reduce((s, a) => s + a.closing, 0);
  const A = total('1'), L = total('2'), E = total('3') + plProfitToDate, balanced = Math.abs(A - L - E) < 0.01;
  const head = pageHead(tab === 'pl' ? 'Profit & Loss' : 'Balance Sheet', tab === 'pl' ? `${fdate(from)} to ${fdate(to)}` : `As at ${fdate(to)}`, tab === 'bs' ? (balanced ? badge('Balanced', 'ok') : badge('Out of balance', 'bad')) : '');
  return head + `<div class="card noprint" style="margin-bottom:16px"><div class="tabs"><a href="#financials/pl/${from}/${to}" class="${tab === 'pl' ? 'on' : ''}">Profit & Loss</a><a href="#financials/bs/${from}/${to}" class="${tab === 'bs' ? 'on' : ''}">Balance Sheet</a></div>
      <div class="row wrap">${tab === 'pl' ? `<div><label>From</label><input type="date" id="finFrom" value="${from}"></div>` : `<input type="hidden" id="finFrom" value="${from}">`}<div><label>${tab === 'pl' ? 'To' : 'As at'}</label><input type="date" id="finTo" value="${to}" data-fintab="${tab}"></div></div></div>
    <div class="card"><div class="tw"><table class="export"><tr><th>Account</th><th>Code</th><th class="num"></th><th class="num">AED</th></tr>
    ${tab === 'pl' ? `${section('4', 'Income')}${section('5', 'Expenses')}<tr class="tot"><td colspan="3">${profit >= 0 ? 'Net profit' : 'Net loss'}</td><td class="num ${profit >= 0 ? 'up' : 'bad'}">${nf(profit)}</td></tr>`
      : `${section('1', 'Assets')}${section('2', 'Liabilities')}${section('3', 'Equity')}<tr><td class="ind1">Profit not yet transferred</td><td></td><td></td><td class="num">${nf(plProfitToDate)}</td></tr>
        <tr class="tot"><td colspan="3">Liabilities + equity + profit</td><td class="num">${nf(L + E)}</td></tr>`}</table></div></div>`;
};
document.addEventListener('change', e => { if (e.target.id === 'finFrom' || e.target.id === 'finTo') location.hash = `#financials/${$('#finTo').dataset.fintab}/${$('#finFrom').value}/${$('#finTo').value}`; });

/* ---------- actions ---------- */
Object.assign(DO, {
  // Downloads the report table as a CSV file, which opens directly in Excel.
  csv: () => { const t = $('#page table.export') || $('#page table'); if (!t) return toast('Nothing to export', 'bad');
    const cell = c => '"' + c.innerText.replace(/\s+/g, ' ').trim().replace(/"/g, '""') + '"';
    const csv = [...t.rows].map(r => [...r.cells].flatMap(c => [cell(c), ...Array(Math.max(0, c.colSpan - 1)).fill('""')]).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = `${S.view}${S.args.length ? '-' + S.args.join('-') : ''}-${today()}.csv`; a.click(); URL.revokeObjectURL(a.href); },
  newAmort: async () => { const acc = await api('GET', '/accounts'), leaf = t => acc.filter(a => a.type === t && postable(a) && !a.cash_kind && !a.party_kind);
    modal('New amortization schedule', `<div class="form">${fld('Description', 'name', '', 'required placeholder="e.g. Office rent 2026"')}${fld('Total amount (AED)', 'total', '', 'type="number" step="0.01" min="0.01" required')}
      <div><label>Prepaid account (asset)</label><select name="prepaid_account_id">${leaf('A').map(a => `<option value="${a.id}" ${/prepaid/i.test(a.name) ? '' : ''}>${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</select></div>
      <div><label>Expense account</label><select name="expense_account_id">${leaf('X').map(a => `<option value="${a.id}">${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</select></div>
      ${fld('First month charged', 'start_month', new Date().toISOString().slice(0, 7), 'type="month" required')}${fld('Number of months', 'months', 12, 'type="number" min="1" max="120" required')}</div>
      <p class="dim" style="margin:12px 0 0">Record the payment itself with a bank payment voucher to the prepaid account. This schedule then moves it to expense month by month.</p>`,
      async d => { await api('POST', '/amort', d); toast('Schedule saved'); },
      { init: f => { const p = [...f.prepaid_account_id.options].find(o => /prepaid/i.test(o.text)); if (p) p.selected = true; } }); },
  runAmort: async () => { const r = await api('POST', '/amort/run', { month: $('#amortUpto').value }); toast(r.posted.length ? `Posted ${r.posted.length} voucher(s)` : 'Nothing due'); render(); },
  stopAmort: id => ask('Stop schedule', 'Reason', async () => { await api('POST', `/amort/${id}/stop`); })
});
