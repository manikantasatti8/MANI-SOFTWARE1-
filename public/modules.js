/* More screens: renewals, endorsements, allocation, bank reconciliation, staff & provisions, year-end, documents. */
const thisMonth = () => new Date().toISOString().slice(0, 7);
const lastYearEnd = () => (new Date().getFullYear() - 1) + '-12-31';
const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

/* ---------- documents (used on clients, enquiries and invoices) ---------- */
async function loadDocs(el) {
  const [entity, id] = el.dataset.docs.split(':');
  let list; try { list = await api('GET', `/documents?entity=${entity}&entity_id=${id}`); } catch (e) { el.innerHTML = ''; return; }
  el.innerHTML = `<h3 style="display:flex;align-items:center;gap:8px;margin-bottom:10px">Documents <span class="sp"></span>
      <label class="btn sm" style="margin:0">${ic('plus')}Attach file<input type="file" multiple hidden data-upload="${entity}:${id}"></label></h3>
    ${list.length ? list.map(d => `<div class="row" style="padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05)">${ic('doc').replace('<svg', '<svg style="width:18px;height:18px;stroke:var(--cyan);fill:none;stroke-width:1.7"')}
      <a href="/api/documents/${d.id}/file">${esc(d.name)}</a><span class="sp"></span><small class="mute">${kb(d.size)} · ${esc(d.by_name || '')} · ${ftime(d.at)}</small>
      ${d.uploaded_by === S.user.id || is('Admin') ? `<button type="button" class="x" data-do="delDoc" data-id="${d.id}" title="Remove">×</button>` : ''}</div>`).join('') : '<div class="mute" style="padding:6px 0">No documents attached</div>'}`;
}
document.addEventListener('change', act(async e => {
  const inp = e.target.closest('[data-upload]'); if (!inp) return;
  const [entity, id] = inp.dataset.upload.split(':'), box = inp.closest('[data-docs]');
  for (const f of inp.files) {
    if (f.size > 10 * 1024 * 1024) { toast(f.name + ' is larger than 10 MB', 'bad'); continue; }
    const data = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = no; r.readAsDataURL(f); });
    await api('POST', '/documents', { entity, entity_id: +id, name: f.name, mime: f.type, data });
  }
  toast('Attached'); loadDocs(box);
}));

/* ---------- renewals ---------- */
views.renewals = async () => {
  const days = +S.args[0] || 90, list = (await api('GET', '/renewals?days=' + days)).filter(r => hit(r.policy_no, r.client_name, r.insurer_name, r.cls));
  const status = r => r.renewed_by ? badge('Renewed · ' + r.renewed_by, 'ok') : r.renewal_id ? `<a href="#enquiries/${r.renewal_id}">${esc(r.renewal_ref)}</a> ${stBadge(r.renewal_stage)}` : badge('Not started', r.days_left < 0 ? 'bad' : 'warn');
  return pageHead('Renewals', `Policies expiring in the next ${days} days, and those expired in the last 60 days`) +
    `<div class="card noprint" style="margin-bottom:16px"><div class="tabs" style="margin:0;border:0">${[30, 60, 90, 180].map(n => `<a href="#renewals/${n}" class="${n === days ? 'on' : ''}">Next ${n} days</a>`).join('')}</div></div>
    <div class="buckets"><div class="card"><small>Due</small><b>${list.length}</b></div><div class="card"><small>Not started</small><b class="warn">${list.filter(r => !r.renewal_id && !r.renewed_by).length}</b></div>
      <div class="card"><small>In progress</small><b>${list.filter(r => r.renewal_id && !r.renewed_by).length}</b></div><div class="card"><small>Renewed</small><b class="up">${list.filter(r => r.renewed_by).length}</b></div>
      <div class="card"><small>Premium due for renewal</small><b>${nf(list.reduce((s, r) => s + r.net, 0))}</b></div></div>
    <div class="card">${list.length ? `<div class="tw"><table class="export"><tr><th>Expiry</th><th class="num">Days</th><th>Client</th><th>Policy no.</th><th>Insurer</th><th>Class</th><th>Producer</th><th class="num">Net premium</th><th>Status</th><th></th></tr>
      ${list.map(r => `<tr><td>${fdate(r.expiry_date)}</td><td class="num ${r.days_left < 0 ? 'bad' : r.days_left <= 30 ? 'warn' : ''}">${r.days_left}</td><td><b>${esc(r.client_name)}</b></td><td>${esc(r.policy_no)}</td>
        <td class="dim">${esc(r.insurer_name)}</td><td class="dim">${esc(r.cls)}</td><td class="dim">${esc(r.producer_name || '')}</td><td class="num">${nf(r.net)}</td><td>${status(r)}</td>
        <td class="num">${canProduce() && !r.renewal_id && !r.renewed_by ? `<button class="btn sm pri" data-do="renew" data-id="${r.id}">Start renewal</button>` : ''}</td></tr>`).join('')}</table></div>` : '<div class="empty">Nothing due in this period</div>'}</div>`;
};

/* ---------- endorsements ---------- */
views.endorsements = async () => {
  const list = (await api('GET', '/invoices')).filter(i => i.issue_type === 'Endorsement').filter(i => hit(i.ref, i.policy_no, i.endorsement_no, i.client_name));
  return `<div class="head"><div><h1>Endorsements</h1><p>Additions (extra premium) and deletions (refunds) on existing policies. They go to Closing like any invoice.</p></div><span class="sp"></span>
    ${canProduce() ? `<button class="btn pri" data-do="newEndorsement">${ic('plus')}New endorsement</button>` : ''}</div>
    <div class="card">${list.length ? `<div class="tw"><table class="export"><tr><th>Invoice</th><th>Endorsement no.</th><th>Policy no.</th><th>Client</th><th>Insurer</th><th class="num">Premium</th><th class="num">Total</th><th class="num">Commission</th><th>Status</th><th></th></tr>
      ${list.map(i => `<tr><td>${esc(i.ref)}<br><small class="mute">${fdate(i.invoice_date)}</small></td><td><b>${esc(i.endorsement_no || '')}</b></td><td>${esc(i.policy_no)}</td><td>${esc(i.client_name)}</td><td class="dim">${esc(i.insurer_name)}</td>
        <td class="num ${i.net < 0 ? 'bad' : ''}">${nf(i.net)}</td><td class="num">${nf(i.total)}</td><td class="num">${nf(i.comm_amt)}</td><td>${badge(i.status, INV_TONE[i.status])}</td>
        <td class="num">${canProduce() && ['Draft', 'Returned'].includes(i.status) ? `<button class="btn sm" data-do="editInvoice" data-id="${i.id}">Edit</button> <button class="btn sm pri" data-do="submit" data-id="${i.id}">Send to Closing</button>` : `<button class="btn sm" data-do="preview" data-id="${i.id}">View</button>`}</td></tr>`).join('')}</table></div>` : '<div class="empty">No endorsements yet. Use “Endorse” on a policy, or the button above.</div>'}</div>`;
};
function endorsementFrom(p) {
  invoiceForm({ client_id: p.client_id, insurer_id: p.insurer_id, producer_id: p.producer_id, issue_type: 'Endorsement', policy_no: p.policy_no, dept: p.dept, grp: p.grp, cls: p.cls, sub: p.sub,
    start_date: today(), expiry_date: p.expiry_date, comm_pct: p.comm_pct, prod_pct: p.prod_pct, vat_pct: p.vat_pct, net: '', pay_terms: p.pay_terms });
  setTimeout(() => { const f = $('#modal form'); if (f) { $('h2', f).textContent = 'Endorsement on policy ' + p.policy_no; f.endorsement_no.focus(); } }, 0);
}

/* ---------- bank reconciliation ---------- */
views.bankrec = async () => {
  const d = await api('GET', '/bank-rec' + (S.args[0] ? '?account_id=' + S.args[0] : ''));
  if (!d.account) return `<div class="head"><div><h1>Bank Reconciliation</h1></div></div><div class="card"><div class="empty">Add a bank account in the Chart of Accounts first</div></div>`;
  return `<div class="head"><div><h1>Bank Reconciliation</h1><p>Tick each entry that appears on the bank statement. The ticked total must agree with the statement balance.</p></div></div>
    <div class="card" style="margin-bottom:16px"><div class="form c3"><div><label>Bank account</label><select id="recBank">${d.banks.map(b => `<option value="${b.id}" ${b.id === d.account.id ? 'selected' : ''}>${esc(b.code)} · ${esc(b.name)}</option>`).join('')}</select></div>
      <div><label>Statement date</label><input type="date" id="recDate" value="${today()}"></div><div><label>Closing balance on the statement</label><input type="number" step="0.01" id="recBal" placeholder="0.00"></div></div></div>
    <div class="buckets"><div class="card"><small>Balance in the books</small><b>${nf(d.book)}</b></div><div class="card"><small>Already reconciled</small><b>${nf(d.cleared)}</b></div>
      <div class="card"><small>Reconciled after ticks</small><b id="recCleared">${nf(d.cleared)}</b></div><div class="card"><small>Difference to statement</small><b id="recDiff">—</b></div></div>
    <div class="card" style="margin-bottom:16px"><h3>Entries not yet on a statement <span class="sp"></span>${canBook() && d.lines.length ? '<button class="btn sm" data-do="recAll">Tick all up to the date</button> <button class="btn sm ok" data-do="recSave">Save reconciliation</button>' : ''}</h3>
      ${d.lines.length ? `<div class="tw"><table id="recTable" data-cleared="${d.cleared}" data-account="${d.account.id}"><tr><th></th><th>Date</th><th>Voucher</th><th>Reference</th><th>Description</th><th class="num">Money in</th><th class="num">Money out</th></tr>
        ${d.lines.map(l => `<tr><td><input type="checkbox" class="rec" value="${l.id}" data-amt="${l.dr - l.cr}" data-date="${l.jdate}" style="width:auto" ${canBook() ? '' : 'disabled'}></td><td>${fdate(l.jdate)}</td><td><a data-do="voucher" data-id="${l.journal_id}">${esc(l.no)}</a></td>
          <td>${esc(l.ref || '')}</td><td class="dim">${esc(l.memo || l.narration || '')}</td><td class="num">${l.dr ? nf(l.dr) : ''}</td><td class="num">${l.cr ? nf(l.cr) : ''}</td></tr>`).join('')}</table></div>` : '<div class="empty">Everything is reconciled</div>'}</div>
    <div class="card"><h3>Past reconciliations</h3>${d.recs.length ? `<table><tr><th>Statement date</th><th class="num">Statement balance</th><th class="num">Entries</th><th>By</th><th></th></tr>${d.recs.map((r, i) => `<tr><td>${fdate(r.statement_date)}</td><td class="num">${nf(r.statement_balance)}</td><td class="num">${r.n}</td>
      <td class="dim">${esc(r.by_name || '')} · ${ftime(r.created_at)}</td><td class="num">${i === 0 && canBook() ? `<button class="btn sm danger" data-do="recUndo" data-id="${r.id}">Undo</button>` : ''}</td></tr>`).join('')}</table>` : '<div class="empty">None yet</div>'}</div>`;
};
function recUpdate() {
  const t = $('#recTable'); if (!t) return; const date = $('#recDate').value;
  t.querySelectorAll('.rec').forEach(c => { const late = c.dataset.date > date; c.disabled = late || !canBook(); if (late) c.checked = false; });
  const cleared = +t.dataset.cleared + [...t.querySelectorAll('.rec:checked')].reduce((s, c) => s + +c.dataset.amt, 0), bal = $('#recBal').value;
  $('#recCleared').textContent = nf(cleared);
  $('#recDiff').innerHTML = bal === '' ? '—' : Math.abs(+bal - cleared) < 0.005 ? '<span class="up">0.00 ✓</span>' : `<span class="bad">${nf(+bal - cleared)}</span>`;
}
document.addEventListener('input', e => { if (['recBal', 'recDate'].includes(e.target.id) || e.target.classList.contains('rec')) recUpdate(); });
document.addEventListener('change', e => { if (e.target.id === 'recBank') location.hash = '#bankrec/' + e.target.value; if (e.target.classList.contains('rec') || e.target.id === 'recDate') recUpdate(); });

/* ---------- staff & provisions ---------- */
views.staff = async () => {
  const tab = S.args[0] === 'provisions' ? 'provisions' : 'staff', month = S.args[1] || thisMonth();
  const tabs = `<div class="card noprint" style="margin-bottom:16px"><div class="tabs" style="margin:0;border:0"><a href="#staff" class="${tab === 'staff' ? 'on' : ''}">Staff register</a><a href="#staff/provisions" class="${tab === 'provisions' ? 'on' : ''}">Gratuity & leave provisions</a></div></div>`;
  if (tab === 'staff') {
    const [list, p] = await Promise.all([api('GET', '/staff'), api('GET', '/provisions?month=' + thisMonth())]), calc = {}; p.staff.forEach(s => calc[s.id] = s);
    return `<div class="head"><div><h1>Staff & Provisions</h1><p>Staff register used for end-of-service gratuity and leave salary provisions</p></div><span class="sp"></span>
      <button class="btn pri" data-do="newStaff">${ic('plus')}New staff</button><button class="btn" data-do="csv">${ic('doc')}Export to Excel</button></div>${tabs}
      <div class="card">${list.length ? `<div class="tw"><table class="export"><tr><th>Emp. no.</th><th>Name</th><th>Designation</th><th>Joined</th><th class="num">Years</th><th class="num">Basic</th><th class="num">Allowances</th><th class="num">Leave taken (days)</th><th class="num">Gratuity today</th><th class="num">Leave balance (days)</th><th>Status</th></tr>
        ${list.map(s => { const c = calc[s.id]; return `<tr class="click" data-do="editStaff" data-id="${s.id}"><td class="dim">${esc(s.emp_no || '')}</td><td><b>${esc(s.name)}</b></td><td class="dim">${esc(s.designation || '')}</td><td>${fdate(s.join_date)}</td>
          <td class="num">${c ? c.gratuity.years.toFixed(1) : ''}</td><td class="num">${nf(s.basic)}</td><td class="num">${nf(s.allowances)}</td><td class="num">${s.leave_taken}</td><td class="num">${c ? nf(c.gratuity.amount) : ''}</td><td class="num">${c ? c.leave.days.toFixed(1) : ''}</td>
          <td>${s.active ? badge('Active', 'ok') : badge('Left' + (s.exit_date ? ' ' + fdate(s.exit_date) : ''), 'mute')}</td></tr>`; }).join('')}</table></div>` : '<div class="empty">No staff yet</div>'}</div>`;
  }
  const p = await api('GET', '/provisions?month=' + month);
  return `<div class="head"><div><h1>Staff & Provisions</h1><p>Provision needed at ${fdate(p.asAt)} compared with what is already in the books</p></div><span class="sp"></span>
      <button class="btn" data-do="csv">${ic('doc')}Export to Excel</button></div>${tabs}
    <div class="card" style="margin-bottom:16px"><div class="row wrap"><div><label>Month</label><input type="month" id="provMonth" value="${month}"></div><span class="sp"></span>
      ${p.done ? badge(`Posted as ${p.done.no}`, 'ok') : `<button class="btn ok" data-do="postProv" data-id="${month}" ${Math.abs(p.diffG) + Math.abs(p.diffL) < 0.01 ? 'disabled' : ''}>Post provisions for ${month}</button>`}</div>
      <p class="dim" style="margin:10px 0 0">Gratuity: 21 days' basic per year for the first 5 years, 30 days after, nothing before 1 year, capped at 2 years' basic. Leave: 30 days a year on basic, less days taken. Only the difference is posted.</p></div>
    <div class="buckets"><div class="card"><small>Gratuity needed</small><b>${nf(p.needG)}</b></div><div class="card"><small>Gratuity in books</small><b>${nf(p.haveG)}</b></div><div class="card"><small>Gratuity to post</small><b class="${p.diffG ? 'warn' : ''}">${nf(p.diffG)}</b></div>
      <div class="card"><small>Leave needed</small><b>${nf(p.needL)}</b></div><div class="card"><small>Leave in books</small><b>${nf(p.haveL)}</b></div><div class="card"><small>Leave to post</small><b class="${p.diffL ? 'warn' : ''}">${nf(p.diffL)}</b></div></div>
    <div class="card">${p.staff.length ? `<div class="tw"><table class="export"><tr><th>Name</th><th>Joined</th><th class="num">Years</th><th class="num">Basic</th><th class="num">Gratuity</th><th class="num">Leave days</th><th class="num">Leave salary</th></tr>
      ${p.staff.map(s => `<tr><td><b>${esc(s.name)}</b></td><td>${fdate(s.join_date)}</td><td class="num">${s.gratuity.years.toFixed(2)}</td><td class="num">${nf(s.basic)}</td><td class="num">${nf(s.gratuity.amount)}</td><td class="num">${s.leave.days.toFixed(1)}</td><td class="num">${nf(s.leave.amount)}</td></tr>`).join('')}
      <tr class="tot"><td colspan="4">Total</td><td class="num">${nf(p.needG)}</td><td></td><td class="num">${nf(p.needL)}</td></tr></table></div>` : '<div class="empty">No active staff</div>'}</div>`;
};
document.addEventListener('change', e => { if (e.target.id === 'provMonth') location.hash = '#staff/provisions/' + e.target.value; });
function staffForm(s = {}) {
  modal(s.id ? 'Edit staff' : 'New staff', `<div class="form">${fld('Employee number', 'emp_no', s.emp_no)}${fld('Full name', 'name', s.name, 'required')}${fld('Designation', 'designation', s.designation)}
    ${fld('Joining date', 'join_date', s.join_date || '', 'type="date" required')}${fld('Basic salary (monthly)', 'basic', s.basic ?? '', 'type="number" step="0.01" min="0" required')}${fld('Allowances (monthly)', 'allowances', s.allowances ?? '', 'type="number" step="0.01" min="0"')}
    ${fld('Annual leave days taken since joining', 'leave_taken', s.leave_taken ?? 0, 'type="number" step="0.5" min="0"')}${fld('Last working day (if left)', 'exit_date', s.exit_date || '', 'type="date"')}
    ${s.id ? sel('Status', 'active', [['true', 'Active'], ['false', 'Left']], String(s.active)) : ''}</div>`,
    d => s.id ? api('PUT', '/staff/' + s.id, d) : api('POST', '/staff', d));
}

/* ---------- year-end ---------- */
views.yearend = async () => {
  const date = S.args[0] || lastYearEnd(), d = await api('GET', '/year-end?date=' + date);
  return `<div class="head"><div><h1>Year-end & Lock</h1><p>Closing a year moves its profit to the Head Office account and locks the books up to that date</p></div></div>
    <div class="card" style="margin-bottom:16px"><div class="row wrap"><div><label>Year-end date</label><input type="date" id="yeDate" value="${date}"></div><span class="sp"></span>
      <div class="mini">Books locked up to: <b>${d.lock_date ? fdate(d.lock_date) : 'not locked'}</b></div></div></div>
    <div class="buckets"><div class="card"><small>${d.profit >= 0 ? 'Profit' : 'Loss'} to transfer</small><b class="${d.profit >= 0 ? 'up' : 'bad'}">${nf(Math.abs(d.profit))}</b></div>
      <div class="card"><small>Transferred to</small><b style="font-size:14px">${esc(d.ho_account ? d.ho_account.code + ' · ' + d.ho_account.name : '—')}</b></div></div>
    <div class="card" style="margin-bottom:16px"><h3>Income and expense balances at ${fdate(date)} <span class="sp"></span>
      ${is('Admin') && (!d.lock_date || date > d.lock_date) ? `<button class="btn ok" data-do="closeYear" data-id="${date}">Close year and lock books</button>` : ''}</h3>
      ${d.rows.length ? `<table class="export"><tr><th>Code</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr>${d.rows.map(r => `<tr><td class="dim">${esc(r.code)}</td><td>${esc(r.name)}</td><td class="num">${r.bal > 0 ? nf(r.bal) : ''}</td><td class="num">${r.bal < 0 ? nf(-r.bal) : ''}</td></tr>`).join('')}</table>` : '<div class="empty">No open income or expense balances up to this date</div>'}
      <p class="dim" style="margin:12px 0 0">After closing, nothing can be posted on or before the year-end date. An invoice approved later with an older date is posted on the first open day.</p></div>
    <div class="card"><h3>Previous closes</h3>${d.closes.length ? `<table>${d.closes.map(c => `<tr class="click" data-do="voucher" data-id="${c.id}"><td><b>${esc(c.no)}</b></td><td>${fdate(c.jdate)}</td><td class="dim">${esc(c.narration)}</td></tr>`).join('')}</table>` : '<div class="empty">None yet</div>'}</div>`;
};
document.addEventListener('change', e => { if (e.target.id === 'yeDate') location.hash = '#yearend/' + e.target.value; });

/* ---------- actions ---------- */
Object.assign(DO, {
  delDoc: async (id, el) => { const box = el.closest('[data-docs]'); if (!confirm('Remove this document?')) return; await api('DELETE', '/documents/' + id); loadDocs(box); },
  renew: async id => { const e = await api('POST', `/policies/${id}/renew`); toast('Renewal enquiry ' + e.ref + ' created'); go('enquiries', e.id); },
  endorse: async id => endorsementFrom((await api('GET', '/policies')).find(p => p.id == id)),
  newEndorsement: async () => { const pols = await api('GET', '/policies'); if (!pols.length) return toast('There are no approved policies yet', 'bad');
    modal('New endorsement', `<label>Policy</label><select name="policy">${pols.map(p => `<option value="${p.id}">${esc(p.policy_no)} · ${esc(p.client_name)} · ${esc(p.insurer_name)} · ${esc(p.cls)}</option>`).join('')}</select>`,
      async d => { const p = pols.find(x => x.id == d.policy); setTimeout(() => endorsementFrom(p), 60); }, { narrow: true, save: 'Next' }); },
  allocate: async (accountId, el) => { const kind = el.dataset.kind, st = await api('GET', `/statements/${kind}?party_id=${el.dataset.party}`), avail = -st.on_account;
    const open = st.rows.map(r => ({ ...r, open: ['client', 'insurer'].includes(kind) ? r.balance : r2(r.original - r.settled) })).filter(r => r.open > 0.004);
    if (!open.length) return toast('No open invoices to allocate to', 'bad');
    modal('Allocate on-account amount', `<p class="dim" style="margin:0 0 12px">Available to allocate: <b>${nf(avail)}</b></p>${fld('Date', 'date', today(), 'type="date" required')}
      <table style="margin-top:12px"><tr><th>Invoice</th><th>Policy</th><th class="num">Open</th><th class="num" style="width:160px">Allocate</th></tr>${open.map(r => `<tr><td>${esc(r.ref)}<br><small class="mute">${fdate(r.invoice_date)}</small></td><td>${esc(r.policy_no)}</td><td class="num">${nf(r.open)}</td>
        <td><input type="number" step="0.01" min="0" max="${r.open}" data-alloc="${r.id}" placeholder="0.00"></td></tr>`).join('')}</table><p class="mini" id="allocTot" style="margin:10px 0 0"></p>`,
      async (d, f) => { const items = [...f.querySelectorAll('[data-alloc]')].map(i => ({ invoice_id: +i.dataset.alloc, amount: i.value })).filter(i => +i.amount > 0);
        const r = await api('POST', '/allocate', { account_id: +accountId, date: d.date, items }); toast('Allocated as ' + r.journal_no); },
      { save: 'Allocate', init: f => { let left = avail; f.querySelectorAll('[data-alloc]').forEach(i => { const v = Math.min(left, +i.max); if (v > 0.004) { i.value = v.toFixed(2); left = r2(left - v); } });
        const up = () => { const t = [...f.querySelectorAll('[data-alloc]')].reduce((s, i) => s + (+i.value || 0), 0); $('#allocTot', f).innerHTML = `Allocating <b>${nf(t)}</b> of ${nf(avail)}${t > avail + 0.004 ? ' <span class="bad">— more than available</span>' : ''}`; };
        f.oninput = up; up(); } }); },
  recAll: () => { const date = $('#recDate').value; document.querySelectorAll('#recTable .rec').forEach(c => { if (c.dataset.date <= date) c.checked = true; }); recUpdate(); },
  recSave: async () => { const t = $('#recTable'), ids = [...t.querySelectorAll('.rec:checked')].map(c => +c.value);
    if ($('#recBal').value === '') return toast('Enter the closing balance from the bank statement', 'bad');
    await api('POST', '/bank-rec', { account_id: +t.dataset.account, statement_date: $('#recDate').value, statement_balance: $('#recBal').value, line_ids: ids }); toast('Reconciliation saved'); render(); },
  recUndo: async id => { if (!confirm('Undo this reconciliation? Its entries will be unticked.')) return; await api('POST', `/bank-rec/${id}/undo`); toast('Undone'); render(); },
  newStaff: () => staffForm(), editStaff: async id => staffForm((await api('GET', '/staff')).find(s => s.id == id)),
  postProv: async month => { const r = await api('POST', '/provisions', { month }); toast(`Posted as ${r.journal_no}`); render(); },
  closeYear: date => ask(`Close the year at ${fdate(date)}?`, 'Type CLOSE to confirm. This locks the books up to this date and cannot be undone.', async d => {
    if (String(d.reason).trim().toUpperCase() !== 'CLOSE') throw new Error('Type CLOSE to confirm'); const r = await api('POST', '/year-end', { date }); toast(r.journal_no ? 'Closed as ' + r.journal_no : 'Books locked'); })
});
