/* Finance screens: chart of accounts, vouchers with allocation, direct payments, PDC cheques, statements. */
const canBook = () => is('Admin', 'Finance');
const drcr = b => Math.abs(b) < 0.005 ? '—' : nf(Math.abs(b)) + (b > 0 ? ' Dr' : ' Cr');
const TYPE_NAME = { A: 'Assets', L: 'Liabilities', E: 'Equity', I: 'Income', X: 'Expenses' };
const postable = a => !a.is_group && !a.control && a.active;
const accOpts = (list, sel) => Object.keys(TYPE_NAME).map(t => { const g = list.filter(a => a.type === t && postable(a));
  return g.length ? `<optgroup label="${TYPE_NAME[t]}">${g.map(a => `<option value="${a.id}" ${a.id == sel ? 'selected' : ''}>${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</optgroup>` : ''; }).join('');

/* ---------- chart of accounts ---------- */
views.coa = async () => {
  const all = await api('GET', '/accounts'), by = {}; all.forEach(a => { a.bal = a.dr - a.cr; a.kids = []; by[a.code] = a; });
  all.forEach(a => { if (a.parent_code && by[a.parent_code]) by[a.parent_code].kids.push(a); });
  const total = a => a.bal + a.kids.reduce((s, k) => s + total(k), 0), out = [];
  const walk = (a, d) => { if (!S.search || hit(a.code, a.name) || a.kids.length) out.push([a, d]); a.kids.forEach(k => walk(k, d + 1)); };
  all.filter(a => !a.parent_code).forEach(r => walk(r, 0));
  const rows = S.search ? out.filter(([a]) => hit(a.code, a.name)) : out;
  return `<div class="head"><div><h1>Chart of Accounts</h1><p>Assets, liabilities, equity, income and expenses. Click an account to see its ledger.</p></div><span class="sp"></span>
    ${canBook() ? `<button class="btn pri" data-do="newAccount">${ic('plus')}New account</button>` : ''}</div>
    <div class="card"><div class="tw"><table><tr><th>Code</th><th>Account</th><th>Type</th><th></th><th class="num">Balance</th><th></th></tr>
    ${rows.map(([a, d]) => { const head = a.is_group || a.control || a.kids.length; return `<tr class="${head ? 'grp' : 'click'}" ${head ? '' : `data-do="ledger" data-id="${a.id}"`}>
      <td class="dim ind${Math.min(d, 4)}">${esc(a.code)}</td><td class="ind${Math.min(d, 4)}">${esc(a.name)}${a.active ? '' : ' ' + badge('Inactive', 'bad')}</td><td class="dim">${d ? '' : TYPE_NAME[a.type]}</td>
      <td>${a.cash_kind ? badge(a.cash_kind === 'bank' ? 'Bank' : 'Cash', 'info') : a.control ? badge('One per ' + ({ client: 'client', insurer: 'insurer', inscomm: 'insurer', producer: 'producer' }[a.control]), 'vio') : ''}</td>
      <td class="num">${drcr(total(a))}</td><td class="num">${canBook() && !a.party_kind ? `<button class="btn sm" data-do="editAccount" data-id="${a.id}">Rename</button>` : ''}</td></tr>`; }).join('')}</table></div></div>`;
};

/* ---------- vouchers ---------- */
views.vouchers = async () => {
  const list = (await api('GET', '/journals')).filter(j => hit(j.no, j.ref, j.narration, j.type));
  const B = (t, l) => `<button class="btn sm" data-do="newVoucher" data-id="${t}">${ic('plus')}${l || t}</button>`;
  return `<div class="head"><div><h1>Vouchers</h1><p>Every entry posted to the books. Posted vouchers are never edited, only reversed.</p></div></div>
    ${canBook() ? `<div class="card noprint" style="margin-bottom:16px"><div class="btns">${B('Bank Receipt')}${B('Bank Payment')}${B('Cash Receipt')}${B('Cash Payment')}${B('General Voucher')}
      <button class="btn sm pri" data-do="newDirect">${ic('send')}Direct Payment (client paid insurer)</button></div></div>` : ''}
    <div class="card">${list.length ? `<div class="tw"><table><tr><th>Voucher</th><th>Date</th><th>Type</th><th>Narration</th><th class="num">Amount</th><th>Posted by</th><th>Status</th></tr>
      ${list.map(j => `<tr class="click" data-do="voucher" data-id="${j.id}"><td><b>${esc(j.no)}</b></td><td>${fdate(j.jdate)}</td><td>${esc(j.type)}</td><td class="dim">${esc(j.narration || '')}${j.ref ? ` <small class="mute">· ${esc(j.ref)}</small>` : ''}</td><td class="num">${nf(j.amount)}</td>
        <td class="dim">${esc(j.created_by_name || '')}</td><td>${badge(j.status, j.status === 'Posted' ? 'ok' : 'bad')}</td></tr>`).join('')}</table></div>` : '<div class="empty">No vouchers yet</div>'}</div>`;
};

async function voucherForm(type, preset = {}) {
  const accounts = await api('GET', '/accounts'), jv = type === 'General Voucher', receipt = /Receipt/.test(type), kind = /Bank/.test(type) ? 'bank' : 'cash';
  const cashAccs = accounts.filter(a => a.cash_kind === kind && postable(a));
  if (!jv && !cashAccs.length) return toast(`Add a ${kind} account in the Chart of Accounts first`, 'bad');
  const line = (l = {}) => `<tr class="vl"><td style="width:34%"><select data-f="account_id"><option value="">Choose account…</option>${accOpts(accounts.filter(a => jv || !a.cash_kind), l.account_id)}</select></td>
    <td style="width:22%"><select data-f="invoice_id"><option value="">Without allocation</option></select></td>
    ${jv ? '<td><input data-f="dr" type="number" step="0.01" min="0" placeholder="Debit"></td><td><input data-f="cr" type="number" step="0.01" min="0" placeholder="Credit"></td>' : `<td><input data-f="amount" type="number" step="0.01" min="0" placeholder="Amount" value="${l.amount || ''}"></td>`}
    <td><input data-f="memo" placeholder="Description"></td><td><button type="button" class="x" data-rm title="Remove line">×</button></td></tr>`;
  modal('New ' + type.toLowerCase(), `<div class="form c3">${jv ? '' : `<div><label>${kind === 'bank' ? 'Bank' : 'Cash'} account</label><select name="cash_account_id">${cashAccs.map(a => `<option value="${a.id}">${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</select></div>`}
      ${fld('Date', 'date', today(), 'type="date" required')}${fld(kind === 'bank' && !jv ? 'Cheque / transfer reference' : 'Reference', 'ref', '')}<div class="full" style="grid-column:1/-1"><label>Narration</label><input name="narration" value="${esc(preset.narration || '')}"></div></div>
    <div class="sec">${jv ? 'Lines' : receipt ? 'Received from' : 'Paid to'}</div>
    <table class="vlines"><thead><tr><th>Account</th><th>Allocate to invoice</th>${jv ? '<th>Debit</th><th>Credit</th>' : '<th>Amount</th>'}<th>Description</th><th></th></tr></thead><tbody>${line(preset)}${jv ? line() : ''}</tbody></table>
    <div class="row" style="margin-top:10px"><button type="button" class="btn sm" data-add>${ic('plus')}Add line</button><span class="sp"></span><b id="vtot"></b></div>`,
    async (d, f) => {
      const lines = [...f.querySelectorAll('tr.vl')].map(tr => { const o = {}; tr.querySelectorAll('[data-f]').forEach(e => o[e.dataset.f] = e.value); return o; }).filter(l => l.account_id);
      const r = await api('POST', '/vouchers', { type, date: d.date, ref: d.ref, narration: d.narration, cash_account_id: d.cash_account_id, lines });
      toast('Posted as ' + r.journal_no);
    },
    { save: 'Post voucher', init: f => {
      const tot = () => { const s = k => [...f.querySelectorAll(`[data-f=${k}]`)].reduce((t, e) => t + (+e.value || 0), 0);
        $('#vtot', f).innerHTML = jv ? `Debit ${nf(s('dr'))} · Credit ${nf(s('cr'))} ${Math.abs(s('dr') - s('cr')) < 0.005 && s('dr') ? badge('Balanced', 'ok') : badge('Not balanced', 'warn')}` : 'Total ' + money(s('amount')); };
      const loadInv = act(async tr => { const a = tr.querySelector('[data-f=account_id]').value, sl = tr.querySelector('[data-f=invoice_id]');
        const items = a ? await api('GET', '/open-items?account_id=' + a) : []; tr._items = items;
        sl.innerHTML = '<option value="">Without allocation</option>' + items.map(i => `<option value="${i.id}">${esc(i.ref)} · ${esc(i.policy_no)} · ${nf(Math.abs(i.bal))}</option>`).join(''); sl.disabled = !items.length; });
      f.addEventListener('change', e => { const tr = e.target.closest('tr.vl'); if (!tr) return;
        if (e.target.dataset.f === 'account_id') loadInv(tr);
        if (e.target.dataset.f === 'invoice_id' && !jv) { const it = (tr._items || []).find(i => i.id == e.target.value), am = tr.querySelector('[data-f=amount]'); if (it && !am.value) am.value = Math.abs(it.bal).toFixed(2); tot(); } });
      f.addEventListener('input', tot);
      f.addEventListener('click', e => { if (e.target.closest('[data-add]')) $('tbody', f).insertAdjacentHTML('beforeend', line());
        const rm = e.target.closest('[data-rm]'); if (rm && f.querySelectorAll('tr.vl').length > 1) { rm.closest('tr').remove(); tot(); } });
      f.querySelectorAll('tr.vl').forEach(tr => { if (tr.querySelector('[data-f=account_id]').value) loadInv(tr); else tr.querySelector('[data-f=invoice_id]').disabled = true; }); tot();
    } });
  $('#modal .card').style.width = '980px';
}

async function directForm() {
  const st = await api('GET', '/statements/client');
  if (!st.parties.length) return toast('There are no approved invoices yet', 'bad');
  modal('Direct payment voucher', `<p class="dim" style="margin:0 0 12px">Use this when the client paid the premium straight to the insurance company. The client's balance and the insurer's premium payable both go down, and the commission on that premium becomes due.</p>
    <div class="form c3"><div><label>Client</label><select name="client"><option value="">Choose client…</option>${opts(st.parties.map(p => [p.id, p.name]))}</select></div>${fld('Date', 'date', today(), 'type="date" required')}${fld('Reference', 'ref', '')}</div>
    <div class="sec">Invoices the client paid</div><div id="dp"><div class="empty">Choose a client</div></div>`,
    async (d, f) => { const items = [...f.querySelectorAll('[data-inv]')].map(e => ({ invoice_id: +e.dataset.inv, amount: e.value })).filter(i => +i.amount > 0);
      const r = await api('POST', '/direct-payments', { date: d.date, ref: d.ref, items }); toast('Posted as ' + r.journal_no); },
    { save: 'Post direct payment', init: f => { f.client.onchange = act(async () => {
      const rows = f.client.value ? (await api('GET', '/statements/client?party_id=' + f.client.value)).rows.filter(r => r.balance > 0.004) : [];
      $('#dp', f).innerHTML = rows.length ? `<table><tr><th>Invoice</th><th>Policy</th><th>Insurer</th><th class="num">Outstanding</th><th class="num" style="width:170px">Paid to insurer</th></tr>${rows.map(r => `<tr><td>${esc(r.ref)}<br><small class="mute">${fdate(r.invoice_date)}</small></td>
        <td>${esc(r.policy_no)}</td><td class="dim">${esc(r.insurer_name)}</td><td class="num">${nf(r.balance)}</td><td><input data-inv="${r.id}" type="number" step="0.01" min="0" max="${r.balance}" placeholder="0.00"></td></tr>`).join('')}</table>` : '<div class="empty">Nothing outstanding for this client</div>'; }); } });
}

/* ---------- PDC cheques ---------- */
views.pdc = async () => {
  const list = (await api('GET', '/pdcs')).filter(p => hit(p.ref, p.cheque_no, p.client_name, p.invoice_ref, p.policy_no, p.bank));
  const pend = list.filter(p => p.status === 'Pending'), tone = { Pending: 'warn', Cleared: 'ok', Bounced: 'bad', Cancelled: 'mute' };
  return `<div class="head"><div><h1>PDC Cheques</h1><p>Post-dated cheques, each linked to its invoice. Pending: ${pend.length} · ${money(pend.reduce((s, p) => s + p.amount, 0))}</p></div><span class="sp"></span>
    ${canBook() ? `<button class="btn pri" data-do="newPdc">${ic('plus')}Record PDC</button>` : ''}</div>
    <div class="card">${list.length ? `<div class="tw"><table><tr><th>Ref</th><th>Cheque date</th><th>Cheque no. / Bank</th><th>Client</th><th>Invoice / Policy</th><th>Payable to</th><th class="num">Amount</th><th>Status</th><th></th></tr>
    ${list.map(p => `<tr><td>${esc(p.ref)}</td><td>${fdate(p.cheque_date)}${p.status === 'Pending' && p.cheque_date <= today() ? ' ' + badge('Due', 'bad') : ''}</td><td><b>${esc(p.cheque_no)}</b><br><small class="mute">${esc(p.bank || '')}</small></td><td>${esc(p.client_name)}</td>
      <td>${esc(p.invoice_ref)}<br><small class="mute">${esc(p.policy_no)}</small></td><td class="dim">${p.payee === 'Insurer' ? esc(p.insurer_name) : 'Us'}</td><td class="num">${nf(p.amount)}</td>
      <td>${badge(p.status, tone[p.status])}${p.journal_no ? `<br><small class="mute">${esc(p.journal_no)}</small>` : ''}</td>
      <td class="num">${canBook() && p.status === 'Pending' ? `<button class="btn sm ok" data-do="clearPdc" data-id="${p.id}" data-payee="${p.payee}">Cleared</button> <button class="btn sm danger" data-do="bouncePdc" data-id="${p.id}">Bounced</button>` : ''}</td></tr>`).join('')}</table></div>` : '<div class="empty">No cheques recorded</div>'}</div>`;
};

/* ---------- statements ---------- */
const ST = {
  client: ['Client – Premium', 'Client', ['Premium', 'original'], ['PDC held', 'pdc'], ['Settled', 'settled'], ['Balance due', 'balance']],
  insurer: ['Insurance Company – Premium', 'Insurance company', ['Premium payable', 'original'], ['Paid', 'settled'], ['Balance payable', 'balance']],
  inscomm: ['Insurance Company – Commission', 'Insurance company', ['Original commission', 'original'], ['PDC commission', 'pdc'], ['On outstanding premium', 'on_outstanding'], ['Settled', 'settled'], ['Due commission', 'balance']],
  producer: ['Producer – Commission', 'Producer', ['Original share', 'original'], ['PDC commission', 'pdc'], ['On outstanding premium', 'on_outstanding'], ['Settled', 'settled'], ['Due to producer', 'balance']]
};
views.statements = async () => {
  const ok = stKinds(), kind = ok.includes(S.args[0]) ? S.args[0] : ok.includes('inscomm') ? 'inscomm' : ok[0], def = ST[kind], pid = +S.args[1] || '';
  const d = await api('GET', `/statements/${kind}${pid ? '?party_id=' + pid : ''}`), cols = def.slice(2), rows = d.rows.filter(r => hit(r.ref, r.policy_no, r.client_name, r.endorsement_no));
  const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0), party = d.parties.find(p => p.id == pid);
  return `<div class="head"><div><h1>Statements</h1><p>Invoice by invoice, with what is settled and what is still due</p></div><span class="sp"></span>${pid ? '<button class="btn" onclick="window.print()">Print</button>' : ''}</div>
    <div class="card"><div class="tabs">${ok.map(k => `<a href="#statements/${k}" class="${k === kind ? 'on' : ''}">${ST[k][0]}</a>`).join('')}</div>
    <div class="row noprint" style="margin-bottom:14px"><div style="width:360px"><label>${def[1]}</label><select id="stParty" data-kind="${kind}"><option value="">Choose…</option>${opts(d.parties.map(p => [p.id, p.name]), pid)}</select></div></div>
    ${!pid ? `<div class="empty">Choose a ${def[1].toLowerCase()} to see the statement. Only those with approved invoices are listed.</div>` : `<h3 style="margin-bottom:10px">${esc(party ? party.name : '')} <span class="dim" style="font-weight:400">· ${def[0]} · as at ${fdate(today())}</span></h3>
    ${rows.length ? `<div class="tw"><table><tr><th>Invoice date</th><th>Invoice no.</th>${kind === 'client' ? '<th>Insurer</th>' : '<th>Client</th>'}<th>Policy no.</th><th>Endorsement no.</th>${cols.map(c => `<th class="num">${c[0]}</th>`).join('')}</tr>
      ${rows.map(r => `<tr><td>${fdate(r.invoice_date)}</td><td>${esc(r.ref)}</td><td>${esc(kind === 'client' ? r.insurer_name : r.client_name)}</td><td>${esc(r.policy_no)}</td><td class="dim">${esc(r.endorsement_no || '')}</td>
        ${cols.map((c, n) => `<td class="num">${n === cols.length - 1 ? `<b>${nf(r[c[1]])}</b>` : r[c[1]] ? nf(r[c[1]]) : '<span class="mute">—</span>'}</td>`).join('')}</tr>`).join('')}
      <tr class="tot"><td colspan="5">Total</td>${cols.map(c => `<td class="num">${nf(sum(c[1]))}</td>`).join('')}</tr>
      ${Math.abs(d.on_account) > 0.004 ? `<tr><td colspan="${4 + cols.length}">Received or paid without allocation (on account)</td><td class="num">${nf(d.on_account)}</td></tr>
        <tr class="tot"><td colspan="${4 + cols.length}">Net balance</td><td class="num">${nf(sum('balance') + d.on_account)}</td></tr>` : ''}</table></div>` : '<div class="empty">No approved invoices</div>'}`}</div>`;
};
document.addEventListener('change', e => { if (e.target.id === 'stParty') location.hash = `#statements/${e.target.dataset.kind}${e.target.value ? '/' + e.target.value : ''}`; });

/* ---------- actions ---------- */
Object.assign(DO, {
  newVoucher: type => voucherForm(type), newDirect: () => directForm(),
  newAccount: async () => { const acc = (await api('GET', '/accounts')).filter(a => !a.control && !a.party_kind);
    modal('New account', `<div class="form"><div class="full"><label>Under which heading</label><select name="parent_code">${Object.keys(TYPE_NAME).map(t => `<optgroup label="${TYPE_NAME[t]}">${acc.filter(a => a.type === t && (a.is_group || !(a.dr || a.cr))).map(a => `<option value="${a.code}">${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</optgroup>`).join('')}</select></div>
      ${fld('Account name', 'name', '', 'required')}${sel('Kind', 'cash_kind', [['', 'Normal account'], ['bank', 'Bank account'], ['cash', 'Cash account']])}${sel('Is it a heading for other accounts?', 'is_group', [['false', 'No, entries are posted to it'], ['true', 'Yes, a heading']])}</div>
      <p class="dim" style="margin:12px 0 0">The account code is given automatically. Client, insurer and producer accounts are created by the system when their first invoice is approved.</p>`, async d => { const a = await api('POST', '/accounts', d); toast('Account ' + a.code + ' added'); }); },
  editAccount: async id => { const a = (await api('GET', '/accounts')).find(x => x.id == id);
    modal('Account ' + a.code, `<div class="form">${fld('Account name', 'name', a.name, 'required')}${sel('Status', 'active', [['true', 'Active'], ['false', 'Inactive (no new entries)']], String(a.active))}</div>`, d => api('PUT', '/accounts/' + id, d), { narrow: true }); },
  ledger: async id => { const d = await api('GET', `/accounts/${id}/ledger`);
    modal(`${d.account.code} · ${d.account.name}`, d.lines.length ? `<div class="tw"><table><tr><th>Date</th><th>Voucher</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr>
      ${d.lines.map(l => `<tr class="click" data-do="voucher" data-id="${l.journal_id}"><td>${fdate(l.jdate)}</td><td><b>${esc(l.no)}</b></td><td class="dim">${esc(l.memo || l.narration || '')}${l.invoice_ref ? ' ' + badge(l.invoice_ref, 'info') : ''}</td>
        <td class="num">${l.dr ? nf(l.dr) : ''}</td><td class="num">${l.cr ? nf(l.cr) : ''}</td><td class="num">${drcr(l.bal)}</td></tr>`).join('')}</table></div>` : '<div class="empty">No entries on this account yet</div>', null);
    $('#modal .card').style.width = '900px'; },
  newPdc: async () => { const inv = (await api('GET', '/invoices')).filter(i => i.status === 'Approved'); if (!inv.length) return toast('There are no approved invoices yet', 'bad');
    modal('Record PDC cheque', `<div class="form"><div class="full"><label>Invoice</label><select name="invoice_id">${inv.map(i => `<option value="${i.id}">${esc(i.ref)} · ${esc(i.client_name)} · ${esc(i.policy_no)} · ${nf(i.total)}</option>`).join('')}</select></div>
      ${sel('Cheque payable to', 'payee', [['Us', 'Us (the broker)'], ['Insurer', 'The insurance company']])}${fld('Cheque number', 'cheque_no', '', 'required')}${fld('Drawn on bank', 'bank', '')}${fld('Cheque date', 'cheque_date', '', 'type="date" required')}
      ${fld('Amount (AED)', 'amount', '', 'type="number" step="0.01" min="0.01" required')}${fld('Note', 'note', '')}</div>`, async d => { const p = await api('POST', '/pdcs', d); toast('Recorded as ' + p.ref); }); },
  clearPdc: async (id, el) => { const banks = (await api('GET', '/accounts')).filter(a => a.cash_kind === 'bank' && postable(a)), direct = el.dataset.payee === 'Insurer';
    modal('Cheque cleared', `<div class="form">${fld('Date cleared', 'date', today(), 'type="date" required')}${direct ? '<div></div>' : `<div><label>Deposited into</label><select name="cash_account_id">${banks.map(a => `<option value="${a.id}">${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</select></div>`}</div>
      <p class="dim" style="margin:12px 0 0">${direct ? 'This cheque was payable to the insurer, so a direct payment voucher will be posted.' : 'A bank receipt will be posted and allocated to the invoice.'}</p>`,
      async d => { const r = await api('POST', `/pdcs/${id}/clear`, d); toast('Posted as ' + r.journal_no); }, { narrow: true, save: 'Post', kind: 'ok' }); },
  bouncePdc: id => ask('Cheque bounced', 'Reason / bank remark', d => api('POST', `/pdcs/${id}/status`, { status: 'Bounced', reason: d.reason }))
});
