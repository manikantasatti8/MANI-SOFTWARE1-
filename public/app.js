/* Broker Portal — browser side. All rules and money are checked again on the server. */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = n => (+n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = n => (+n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
const money = n => 'AED ' + nf(n);
const fdate = s => s ? new Date(String(s).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const ftime = s => s ? new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const today = () => new Date().toISOString().slice(0, 10);
const initials = n => String(n || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const r2 = n => Math.round((+n || 0) * 100) / 100;
const badge = (t, k) => `<span class="badge b-${k || 'mute'}">${esc(t)}</span>`;
const opts = (list, sel, blank) => (blank === undefined ? '' : `<option value="">${esc(blank)}</option>`) +
  list.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(l)}</option>`; }).join('');

const S = { user: null, meta: null, view: 'dashboard', sel: null, tab: {}, search: '' };

async function api(method, url, body) {
  const r = await fetch('/api' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && S.user) { S.user = null; render(); throw new Error('You were signed out. Please sign in again.'); }
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
}
function toast(msg, kind = 'ok') { const t = $('#toast'); t.textContent = msg; t.className = 'toast ' + kind; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 3800); }
const act = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, 'bad'); } };

/* ---------- icons ---------- */
const IC = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  kanban: '<rect x="3" y="4" width="5" height="16" rx="1.5"/><rect x="10" y="4" width="5" height="10" rx="1.5"/><rect x="17" y="4" width="4" height="13" rx="1.5"/>',
  inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3-5.5 6.5-5.5s5.900 1.900 6.500 5.500"/><path d="M16 4.800a3.500 3.500 0 010 6.400M18 14.800c2 .7 3.200 2.400 3.600 5.200"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  shield: '<path d="M12 3l8 3v6c0 4.500-3.200 7.800-8 9-4.800-1.200-8-4.500-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.500l2.700 2.700L16 9.500"/>',
  book: '<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 19V5M9 8h6M9 12h6"/>',
  scale: '<path d="M12 4v16M6 20h12M5 8h14M5 8l-2.500 6a3 3 0 005 0zM19 8l-2.500 6a3 3 0 005 0z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.600 5.600l2.100 2.100M16.300 16.300l2.100 2.100M5.600 18.400l2.100-2.100M16.300 7.700l2.100-2.100"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>', coin: '<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v5c0 1.700 3.100 3 7 3s7-1.300 7-3V7M5 12v5c0 1.700 3.100 3 7 3s7-1.300 7-3v-5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.500-3.500"/>'
};
const ic = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg>`;

/* ---------- stages ---------- */
const STAGES = ['Inquiry', 'Requirements', 'Marketed', 'Quoted', 'Client Decision', 'Closing', 'Closed', 'Lost'];
const STAGE = {
  Inquiry: ['Enquiry', 'info', '#3d8dff', '#1c56d4', 'inbox', 'New submissions'], Requirements: ['Requirements', 'vio', '#8f72f7', '#5a3fd0', 'doc', 'Awaiting documents'],
  Marketed: ['Sent to Insurers', 'warn', '#f2a93b', '#c0711a', 'send', 'Quotes requested'], Quoted: ['Quotations', 'info', '#22c1ff', '#0f84c4', 'chat', 'Quotes received'],
  'Client Decision': ['Client Confirmed', 'ok', '#2fc27a', '#17875a', 'check', 'Ready to book'], Closing: ['With Closing', 'warn', '#f5b04a', '#b8691a', 'shield', 'Awaiting approval'],
  Closed: ['Policy Issued', 'ok', '#34c98a', '#12805a', 'coin', 'Posted to Finance'], Lost: ['Not Confirmed', 'bad', '#f0575a', '#b22d3a', 'clock', 'Lost']
};
const stBadge = s => badge((STAGE[s] || [s])[0], (STAGE[s] || [])[1]);
const INV_TONE = { Draft: 'mute', 'Pending Closing': 'warn', Returned: 'bad', Approved: 'ok', Reversed: 'bad' };
const PRI_TONE = { High: 'bad', Medium: 'warn', Low: 'ok' };
const SOURCES = ['Email', 'Phone', 'Walk-in', 'Referral', 'Website', 'Renewal', 'Existing policy'];
const PAY_TERMS = ['Full payment', '2 cheques (PDC)', '4 cheques (PDC)', 'Bank transfer', 'Credit card', 'Premium finance'];
const LOST = ['Price too high', 'Went to another broker', 'Chose to stay with current insurer', 'No response from client', 'Cover no longer needed', 'Insurers declined to quote', 'Other'];

/* ---------- navigation by role ---------- */
const is = (...roles) => roles.includes(S.user.role);
// Per-user limits set by the administrator. The server enforces them; the screens only hide what would be refused.
const ACC = () => (S.user.role === 'Admin' ? null : S.user.access) || {};
const restricted = () => { const a = ACC(); return !!((a.depts || []).length || (a.producers || []).length || (a.clients_hidden || []).length || a.max_invoice); };
const ST_KINDS = ['client', 'insurer', 'inscomm', 'producer'];
const stKinds = () => { const a = ACC().statements || []; return a.length ? ST_KINDS.filter(k => a.includes(k)) : ST_KINDS; };
const canProduce = () => is('Admin', 'Production'), canClose = () => is('Admin', 'Closing'), canFinance = () => is('Admin', 'Finance', 'Manager', 'Closing');
function navItems() {
  const n = [['', [['dashboard', 'Dashboard', 'grid']]],
    ['Production', [['pipeline', 'Pipeline', 'kanban'], ['enquiries', 'Enquiries', 'inbox'], ['clients', 'Clients', 'users'], ['invoices', 'Book Invoice', 'doc'], ['policies', 'Policies', 'shield']]],
    ['Closing', [['closing', 'Closing Approvals', 'check']]]];
  if (canFinance()) { const full = !restricted(), anySt = stKinds().length;
    n.push(['Finance', [['fin', 'Finance Dashboard', 'grid'], full && ['coa', 'Chart of Accounts', 'book'], full && ['vouchers', 'Vouchers', 'book'], ['pdc', 'PDC Cheques', 'doc'], ['pdc-premium', 'PDC Premium', 'coin'],
      anySt && ['statements', 'Statements', 'users'], anySt && ['aging', 'Aging Reports', 'clock'], full && ['financials', 'Profit & Loss / Balance Sheet', 'scale'], full && ['vat', 'VAT Report', 'scale'], full && ['amort', 'Amortization', 'clock'], full && ['tb', 'Trial Balance', 'scale']].filter(Boolean)]); }
  const adm = []; if (is('Admin')) adm.push(['admin', 'Users & Lists', 'gear']); if (canFinance() && !restricted()) adm.push(['audit', 'Activity Log', 'clock']);
  if (adm.length) n.push(['Admin', adm]);
  return n;
}

/* ---------- shell ---------- */
async function render() {
  if (!S.user) return renderLogin();
  if (!S.meta) S.meta = await api('GET', '/meta');
  const counts = S.counts || {};
  $('#app').innerHTML = `<div class="shell">
    <aside class="side"><div class="brand"><div class="logo">BP</div><div><b>${esc(S.meta.settings.company || 'Broker Portal')}</b><small>Smart Operations</small></div></div>
      <nav class="nav">${navItems().map(([g, items]) => (g ? `<div class="ngroup">${g}</div>` : '') + items.map(([id, l, i]) =>
        `<a href="#${id}" data-nav="${id}" class="${S.view === id ? 'on' : ''}">${ic(i)}${l}${counts[id] ? `<span class="cnt ${id === 'closing' ? 'hot' : ''}">${counts[id]}</span>` : ''}</a>`).join('')).join('')}</nav></aside>
    <div class="main"><div class="top">
      <div class="search">${ic('search')}<input id="q" placeholder="Search clients, policies, enquiries or reference number…" value="${esc(S.search)}"></div><span class="sp"></span>
      <a class="btn sm" href="${esc(location.href)}" target="_blank" rel="noopener" title="Open this page in a new browser tab">${ic('plus')}New tab</a>
      <div class="me" data-do="account"><div class="av">${initials(S.user.name)}</div><div><b>${esc(S.user.name)}</b><small>${esc(S.user.role)}</small></div></div>
      <button class="btn sm" data-do="logout">Sign out</button></div>
      <div class="page" id="page"><div class="empty">Loading…</div></div></div></div>`;
  try { $('#page').innerHTML = await views[S.view](); } catch (e) { $('#page').innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
// Every screen has its own address (#view/part/part), so it can be bookmarked or opened in another tab.
const go = (view, sel) => { const h = '#' + view + (sel ? '/' + sel : ''); S.search = '';
  if (location.hash === h) { readHash(); render(); } else location.hash = h; };
function readHash() { const [v, ...args] = location.hash.slice(1).split('/').map(decodeURIComponent);
  S.view = views[v] ? v : 'dashboard'; S.args = args; S.sel = S.view === 'enquiries' && +args[0] ? +args[0] : S.view === 'enquiries' ? null : S.sel; }
window.addEventListener('hashchange', () => { if (!S.user) return; S.search = ''; closeModal(); readHash(); render(); });
const hit = (...vals) => !S.search || vals.join(' ').toLowerCase().includes(S.search.toLowerCase());

function renderLogin(err) {
  $('#app').innerHTML = `<div class="login"><div class="card"><div class="logo">BP</div><h1>Broker Portal</h1><p class="dim" style="margin:6px 0 0">Production · Closing · Finance</p>
    <form id="login"><div><label>Username</label><input name="username" autocomplete="username" autofocus required></div>
    <div><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
    <div class="err">${esc(err || '')}</div><button class="btn pri" style="justify-content:center;padding:11px">Sign in</button></form></div></div>`;
  $('#login').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    try { S.user = await api('POST', '/login', { username: f.get('username'), password: f.get('password') }); S.meta = null; readHash(); render(); }
    catch (x) { renderLogin(x.message); }
  };
}

/* ---------- small charts ---------- */
function spark(color, seed) {
  let p = [], y = 30; for (let i = 0; i < 12; i++) { y = Math.max(6, Math.min(38, y - 3 + ((seed * (i + 3) * 7) % 11) - 4)); p.push(`${i * 9},${y}`); }
  return `<svg class="spark" viewBox="0 0 100 44"><polyline points="${p.join(' ')}" fill="none" stroke="${color}" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function funnel(rows) {
  const h = 30, w = 150; return `<svg viewBox="0 0 ${w} ${rows.length * h}" width="150">` + rows.map((r, i) => {
    const a = w * (1 - i / (rows.length + .6)), b = w * (1 - (i + 1) / (rows.length + .6)), y = i * h;
    return `<defs><linearGradient id="f${i}" x1="0" x2="1"><stop offset="0" stop-color="${r[2]}"/><stop offset=".5" stop-color="${r[3]}"/><stop offset="1" stop-color="${r[2]}"/></linearGradient></defs>
      <polygon fill="url(#f${i})" points="${(w - a) / 2},${y + 1} ${(w + a) / 2},${y + 1} ${(w + b) / 2},${y + h - 1} ${(w - b) / 2},${y + h - 1}"/>`;
  }).join('') + '</svg>';
}
function donut(parts, center, sub) {
  const tot = parts.reduce((s, p) => s + p[1], 0) || 1; let a = 0; const R = 54, C = 2 * Math.PI * R;
  return `<svg viewBox="0 0 150 150" width="150"><circle cx="75" cy="75" r="${R}" fill="none" stroke="#0a1424" stroke-width="20"/>` + parts.map(p => {
    const len = C * p[1] / tot, s = `<circle cx="75" cy="75" r="${R}" fill="none" stroke="${p[2]}" stroke-width="20" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-a}" transform="rotate(-90 75 75)"/>`; a += len; return s;
  }).join('') + `<text x="75" y="74" text-anchor="middle" fill="#fff" font-size="24" font-weight="700">${center}</text><text x="75" y="93" text-anchor="middle" fill="#93a4c0" font-size="11">${sub}</text></svg>`;
}

/* ---------- views ---------- */
const views = {};

views.dashboard = async () => {
  const d = await api('GET', '/dashboard'), k = d.k, by = {}; d.stages.forEach(s => by[s.stage] = s);
  S.counts = { closing: k.pending_n, invoices: k.returned_n + k.draft_n };
  const flow = STAGES.slice(0, 7), fr = flow.slice(0, 6).map(s => [STAGE[s][0], by[s] || { n: 0, premium: 0 }, STAGE[s][2], STAGE[s][3]]);
  const maxP = Math.max(1, ...d.producers.map(p => p.premium));
  const rb = [['Overdue', d.renew.filter(r => r.days < 0).length, '#f0575a'], ['0–30 days', d.renew.filter(r => r.days >= 0 && r.days <= 30).length, '#f2c14b'], ['31–60 days', d.renew.filter(r => r.days > 30).length, '#3d8dff']];
  return `<div class="head"><div><h1>Broker Portal <span class="dim" style="font-weight:400">– Smart Operations</span></h1><p>Real-time visibility from enquiry to the books.</p></div><span class="sp"></span>
      <div class="dim">${new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</div></div>
    <div class="card flow">${flow.map(s => `<div class="step" data-nav="${s === 'Closing' ? 'closing' : s === 'Closed' ? 'policies' : 'pipeline'}"><div class="orb" style="--c1:${STAGE[s][2]};--c2:${STAGE[s][3]}">${ic(STAGE[s][4])}</div>
      <b>${STAGE[s][0]}</b><div class="n">${(by[s] || {}).n || 0}</div><small>${STAGE[s][5]}</small></div>`).join('')}</div>
    <div class="grid g4" style="margin-bottom:16px">
      <div class="card lift kpi"><div class="lbl">Total Pipeline Premium</div><div class="val">${n0(k.pipeline)}</div><div class="sub">AED · open enquiries</div>${spark('#3d8dff', 3)}</div>
      <div class="card lift kpi"><div class="lbl">Policies Issued (this month)</div><div class="val">${k.issued_mtd}</div><div class="sub">Premium AED ${n0(k.premium_mtd)}</div>${spark('#22c1ff', 5)}</div>
      <div class="card lift kpi"><div class="lbl">Commission Posted (this month)</div><div class="val">${n0(k.comm_mtd)}</div><div class="sub up">AED · already in Finance</div>${spark('#2fc27a', 7)}</div>
      <div class="card lift kpi"><div class="lbl">Waiting for Closing</div><div class="val">${n0(k.pending_amt)}</div><div class="sub ${k.pending_n ? 'warn' : ''}">${k.pending_n} invoice${k.pending_n === 1 ? '' : 's'} awaiting approval</div>${spark('#f2a93b', 4)}</div></div>
    <div class="grid g3" style="margin-bottom:16px">
      <div class="card"><h3>Pipeline Funnel</h3><div class="funnel">${funnel(fr)}<table class="legend">${fr.map(r => `<tr><td><i class="dot" style="background:${r[2]}"></i>${r[0]}</td><td class="num"><b>${r[1].n}</b></td><td class="num dim">${n0(r[1].premium)}</td></tr>`).join('')}</table></div></div>
      <div class="card"><h3>Producer Performance <span class="sp"></span><small class="dim">this year</small></h3>${d.producers.length ? `<table>${d.producers.map(p => `<tr><td style="width:36%">${esc(p.name)}</td>
        <td style="width:38%"><div class="bar" style="width:${Math.max(3, p.premium / maxP * 100)}%"></div></td><td class="num">${n0(p.premium)}</td><td class="num dim">${p.policies}</td></tr>`).join('')}</table>` : '<div class="empty">Approved policies will appear here</div>'}</div>
      <div class="card"><h3>Renewal Alerts <span class="sp"></span><small class="dim">next 60 days</small></h3><div class="donut">${donut(rb, d.renew.length, 'Renewals due')}<table class="legend">${rb.map(r => `<tr><td><i class="dot" style="background:${r[2]}"></i>${r[0]}</td><td class="num"><b>${r[1]}</b></td></tr>`).join('')}</table></div></div></div>
    <div class="grid g21">
      <div class="card"><h3>Approval Queue ${k.pending_n ? badge(k.pending_n + ' pending', 'bad') : ''}<span class="sp"></span><a data-nav="closing">View all</a></h3>
        ${d.queue.length ? `<div class="tw"><table><tr><th>#</th><th>Client</th><th>Class</th><th class="num">Total</th><th>Submitted</th><th>Status</th></tr>${d.queue.map(i => `<tr class="click" data-nav="closing" data-sel="${i.id}">
          <td>${esc(i.ref)}</td><td>${esc(i.client_name)}</td><td class="dim">${esc(i.cls)}</td><td class="num">${nf(i.total)}</td><td class="dim">${ftime(i.submitted_at)}</td><td>${badge('Pending', 'warn')}</td></tr>`).join('')}</table></div>` : '<div class="empty">Nothing is waiting for Closing</div>'}</div>
      <div class="card"><h3>Recent Activity</h3>${d.activity.length ? `<ul class="tl">${d.activity.map(a => `<li style="grid-template-columns:14px 1fr"><div><b>${esc(a.action)}</b> <span class="dim">${esc(a.entity_ref || '')}</span><br><small class="mute">${esc(a.user_name || '')} · ${ftime(a.at)}</small></div></li>`).join('')}</ul>` : '<div class="empty">No activity yet</div>'}</div></div>`;
};

views.pipeline = async () => {
  const all = (await api('GET', '/enquiries')).filter(e => hit(e.ref, e.client_name, e.cls, e.sub));
  return `<div class="head"><div><h1>Pipeline <span class="dim" style="font-weight:400">– Workflow View</span></h1><p>Track enquiries from first contact to final outcome</p></div><span class="sp"></span>
    ${canProduce() ? `<button class="btn pri" data-do="newEnquiry">${ic('plus')}New enquiry</button>` : ''}</div>
    <div class="board">${STAGES.map(s => { const list = all.filter(e => e.stage === s); return `<div class="col"><header style="--c1:${STAGE[s][2]};--c2:${STAGE[s][3]}">${STAGE[s][0]}<span>${list.length}</span></header>
      ${list.slice(0, 30).map(e => `<div class="card lift tk" data-nav="enquiries" data-sel="${e.id}"><b>${esc(e.client_name)}</b><small>${esc(e.cls)}</small>
        <div class="row"><span class="dim">${esc(e.ref)}</span><span class="sp"></span><div class="av sm" title="${esc(e.producer_name || '')}">${initials(e.producer_name || e.created_by_name)}</div></div>
        <div class="row" style="margin-top:6px"><small class="mute" style="margin:0">${fdate(e.created_at)}</small><span class="sp"></span>${e.premium_est ? `<small class="dim" style="margin:0">${n0(e.premium_est)}</small>` : ''}</div></div>`).join('') || '<div class="empty">—</div>'}</div>`; }).join('')}</div>`;
};

views.enquiries = async () => {
  const all = await api('GET', '/enquiries'), tab = S.tab.enq || 'Open';
  const groups = { Open: e => !['Closed', 'Lost'].includes(e.stage), New: e => ['Inquiry', 'Requirements'].includes(e.stage), 'In Progress': e => ['Marketed', 'Quoted'].includes(e.stage),
    'Awaiting Closing': e => ['Client Decision', 'Closing'].includes(e.stage), Done: e => ['Closed', 'Lost'].includes(e.stage) };
  const list = all.filter(groups[tab]).filter(e => hit(e.ref, e.client_name, e.cls, e.sub, e.producer_name));
  if (!S.sel && list[0]) S.sel = list[0].id;
  const e = S.sel ? await api('GET', '/enquiries/' + S.sel).catch(() => null) : null;
  return `<div class="split"><div class="card"><div class="row"><h2>Enquiry Inbox</h2><span class="sp"></span>${canProduce() ? `<button class="btn pri sm" data-do="newEnquiry">${ic('plus')}New</button>` : ''}</div>
    <div class="list-tabs" style="margin-top:12px">${Object.keys(groups).map(g => `<a data-tab="enq:${g}" class="${g === tab ? 'on' : ''}">${g}<span>${all.filter(groups[g]).length}</span></a>`).join('')}</div>
    ${list.length ? `<div class="tw"><table><tr><th>Client</th><th>Product</th><th>Priority</th><th>Stage</th></tr>${list.map(x => `<tr class="click ${e && x.id === e.id ? 'sel' : ''}" data-sel="${x.id}">
      <td><b>${esc(x.client_name)}</b><br><small class="mute">${esc(x.ref)}</small></td><td class="dim">${esc(x.cls)}</td><td>${badge(x.priority, PRI_TONE[x.priority])}</td><td>${stBadge(x.stage)}</td></tr>`).join('')}</table></div>` : '<div class="empty">No enquiries here</div>'}</div>
    <div>${e ? workspace(e) : '<div class="card"><div class="empty">Choose an enquiry on the left, or create a new one.</div></div>'}</div></div>`;
};
function workspace(e) {
  const open = !['Closed', 'Lost', 'Closing'].includes(e.stage), chosen = e.quotes.find(q => q.status === 'Chosen'), P = canProduce() && open;
  const idx = STAGES.indexOf(e.stage), pct = e.stage === 'Lost' ? 0 : Math.round((idx + 1) / 7 * 100);
  return `<div class="card" style="margin-bottom:16px"><div class="row wrap"><h1 style="font-size:22px">${esc(e.client_name)}</h1><span class="dim">${esc(e.ref)}</span>${badge(e.dept, 'info')}${stBadge(e.stage)}<span class="sp"></span>${badge(e.priority + ' priority', PRI_TONE[e.priority])}</div>
      <p class="dim" style="margin:6px 0 12px">${esc(e.grp)} › ${esc(e.cls)} › ${esc(e.sub)} &nbsp;|&nbsp; ${esc(e.type)} &nbsp;|&nbsp; Source: ${esc(e.source || '—')}</p>
      <div class="progress" style="margin-bottom:14px"><i style="width:${pct}%"></i></div>
      <div class="kv"><div><small>Producer</small><b>${esc(e.producer_name || '—')}</b></div><div><small>Sum insured</small><b>${n0(e.sum_insured)}</b></div><div><small>Estimated premium</small><b>${n0(e.premium_est)}</b></div>
        <div><small>Inception</small><b>${fdate(e.inception)}</b></div><div><small>Contact</small><b>${esc(e.contact || '—')}</b></div><div><small>Received</small><b>${fdate(e.created_at)}</b></div></div>
      ${e.requirements ? `<p style="margin:12px 0 0"><small class="dim">Requirements</small><br>${esc(e.requirements)}</p>` : ''}
      ${e.lost_reason ? `<p class="bad" style="margin:12px 0 0">Not confirmed: ${esc(e.lost_reason)}</p>` : ''}
      ${P ? `<div class="row wrap" style="margin-top:14px">
        ${e.stage === 'Inquiry' ? `<button class="btn" data-do="stage" data-id="${e.id}" data-stage="Requirements">Request requirements</button>` : ''}
        ${['Inquiry', 'Requirements'].includes(e.stage) ? `<button class="btn" data-do="stage" data-id="${e.id}" data-stage="Marketed">${ic('send')}Send to insurers</button>` : ''}
        <button class="btn" data-do="newQuote" data-id="${e.id}">${ic('plus')}Add quotation</button>
        ${chosen && !e.invoices.some(i => i.status !== 'Reversed') ? `<button class="btn pri" data-do="bookFrom" data-id="${e.id}">${ic('doc')}Book invoice</button>` : ''}
        <button class="btn" data-do="editEnquiry" data-id="${e.id}">Edit</button><span class="sp"></span><button class="btn danger" data-do="lost" data-id="${e.id}">Not confirmed</button></div>` : ''}</div>
    <div class="grid g2" style="margin-bottom:16px"><div class="card"><h3>Insurer Quotations</h3>${e.quotes.length ? `<table><tr><th>Insurer</th><th class="num">Premium</th><th>Status</th><th></th></tr>${e.quotes.map(q => `<tr>
        <td>${esc(q.insurer_name)}${q.terms ? `<br><small class="mute">${esc(q.terms)}</small>` : ''}</td><td class="num">${nf(q.premium)}</td><td>${badge(q.status, q.status === 'Chosen' ? 'ok' : q.status === 'Declined' ? 'mute' : 'info')}</td>
        <td class="num">${P && q.status !== 'Chosen' ? `<button class="btn sm ok" data-do="choose" data-id="${q.id}">Client confirmed</button>` : ''}</td></tr>`).join('')}</table>` : '<div class="empty">No quotations yet</div>'}
        ${e.invoices.length ? `<div class="sec">Invoices</div>${e.invoices.map(i => `<div class="row" style="padding:5px 0"><a data-nav="invoices">${esc(i.ref)}</a><span class="dim">${esc(i.policy_no)}</span><span class="sp"></span>${nf(i.total)} ${badge(i.status, INV_TONE[i.status])}</div>`).join('')}` : ''}</div>
      <div class="card"><h3>Internal Notes</h3><form id="noteForm" data-id="${e.id}" class="row"><input name="body" placeholder="Add a note…" required><button class="btn sm">Add</button></form>
        <div style="margin-top:10px">${e.notes.filter(n => n.kind === 'note').map(n => `<div class="row" style="align-items:flex-start;padding:8px 0"><div class="av sm">${initials(n.user_name)}</div><div><b>${esc(n.user_name || '')}</b> <small class="mute">${ftime(n.at)}</small><br>${esc(n.body)}</div></div>`).join('') || '<div class="empty">No notes yet</div>'}</div></div></div>
    <div class="card"><h3>Timeline</h3><ul class="tl">${e.notes.map(n => `<li class="${n.kind}"><span class="dim">${ftime(n.at)}</span><span>${esc(n.body)} <small class="mute">· ${esc(n.user_name || '')}</small></span></li>`).join('')}</ul></div>`;
}

views.clients = async () => {
  const list = (await api('GET', '/clients')).filter(c => hit(c.code, c.name, c.contact, c.email, c.producer_name));
  return `<div class="head"><div><h1>Clients</h1><p>${list.length} on the register</p></div><span class="sp"></span>${canProduce() ? `<button class="btn pri" data-do="newClient">${ic('plus')}New client</button>` : ''}</div>
    <div class="card">${list.length ? `<div class="tw"><table><tr><th>Code</th><th>Client</th><th>Type</th><th>Contact</th><th>Producer</th><th class="num">Enquiries</th><th class="num">Policies</th><th class="num">Premium</th></tr>
      ${list.map(c => `<tr class="${canProduce() ? 'click' : ''}" data-do="${canProduce() ? 'editClient' : ''}" data-id="${c.id}"><td class="dim">${esc(c.code)}</td><td><b>${esc(c.name)}</b></td><td>${esc(c.type)}</td>
        <td class="dim">${esc(c.contact || '')}${c.phone ? ' · ' + esc(c.phone) : ''}</td><td>${esc(c.producer_name || '—')}</td><td class="num">${c.enquiries}</td><td class="num">${c.policies}</td><td class="num">${nf(c.premium)}</td></tr>`).join('')}</table></div>` : '<div class="empty">No clients yet. Add your first client to begin.</div>'}</div>`;
};

const invRow = (i, extra = '') => `<td>${esc(i.ref)}<br><small class="mute">${fdate(i.invoice_date)}</small></td><td><b>${esc(i.client_name)}</b><br><small class="mute">${esc(i.policy_no)}</small></td>
  <td class="dim">${esc(i.insurer_name)}<br><small class="mute">${esc(i.cls)}</small></td><td class="num">${nf(i.net)}</td><td class="num">${nf(i.total)}</td><td class="num">${nf(i.comm_amt)}</td>${extra}`;
views.invoices = async () => {
  const all = await api('GET', '/invoices'), tab = S.tab.inv || 'To do';
  const groups = { 'To do': i => ['Draft', 'Returned'].includes(i.status), 'With Closing': i => i.status === 'Pending Closing', Approved: i => i.status === 'Approved', All: () => true };
  const list = all.filter(groups[tab]).filter(i => hit(i.ref, i.client_name, i.policy_no, i.insurer_name));
  return `<div class="head"><div><h1>Book Invoice</h1><p>Production books the policy here and sends it to Closing</p></div><span class="sp"></span>${canProduce() ? `<button class="btn pri" data-do="newInvoice">${ic('plus')}New invoice</button>` : ''}</div>
    <div class="card"><div class="tabs">${Object.keys(groups).map(g => `<a data-tab="inv:${g}" class="${g === tab ? 'on' : ''}">${g} (${all.filter(groups[g]).length})</a>`).join('')}</div>
    ${list.length ? `<div class="tw"><table><tr><th>Invoice</th><th>Client / Policy</th><th>Insurer / Class</th><th class="num">Net premium</th><th class="num">Total</th><th class="num">Commission</th><th>Status</th><th></th></tr>
      ${list.map(i => `<tr>${invRow(i)}<td>${badge(i.status, INV_TONE[i.status])}${i.return_reason ? `<br><small class="bad">${esc(i.return_reason)}</small>` : ''}${i.journal_no ? `<br><small class="mute">${esc(i.journal_no)}</small>` : ''}</td>
        <td class="num">${canProduce() && ['Draft', 'Returned'].includes(i.status) ? `<button class="btn sm" data-do="editInvoice" data-id="${i.id}">Edit</button> <button class="btn sm pri" data-do="submit" data-id="${i.id}">${ic('send')}Send to Closing</button>` : `<button class="btn sm" data-do="preview" data-id="${i.id}">View</button>`}</td></tr>`).join('')}</table></div>` : '<div class="empty">Nothing here</div>'}</div>`;
};

views.closing = async () => {
  const all = await api('GET', '/invoices'), pend = all.filter(i => i.status === 'Pending Closing').filter(i => hit(i.ref, i.client_name, i.policy_no));
  const done = all.filter(i => i.status === 'Approved').slice(0, 15);
  S.counts = Object.assign(S.counts || {}, { closing: pend.length });
  return `<div class="head"><div><h1>Closing Approvals</h1><p>Approving posts the entries to Finance straight away. Check the entries before you approve.</p></div></div>
    <div class="card" style="margin-bottom:16px"><h3>Pending Approval ${pend.length ? badge(pend.length, 'bad') : ''}</h3>${pend.length ? `<div class="tw"><table><tr><th>Invoice</th><th>Client / Policy</th><th>Insurer / Class</th><th class="num">Net premium</th><th class="num">Total</th><th class="num">Commission</th><th>Booked by</th><th></th></tr>
      ${pend.map(i => `<tr>${invRow(i, `<td class="dim">${esc(i.created_by_name || '')}<br><small class="mute">${ftime(i.submitted_at)}</small></td>`)}<td class="num"><button class="btn sm pri" data-do="preview" data-id="${i.id}">Review entries</button></td></tr>`).join('')}</table></div>` : '<div class="empty">Nothing is waiting for approval</div>'}</div>
    <div class="card"><h3>Recently Approved</h3>${done.length ? `<div class="tw"><table><tr><th>Invoice</th><th>Client / Policy</th><th>Insurer / Class</th><th class="num">Net premium</th><th class="num">Total</th><th class="num">Commission</th><th>Approved</th><th>Voucher</th></tr>
      ${done.map(i => `<tr class="click" data-do="preview" data-id="${i.id}">${invRow(i, `<td class="dim">${esc(i.approved_by_name || '')}<br><small class="mute">${ftime(i.approved_at)}</small></td><td>${badge(i.journal_no, 'ok')}</td>`)}</tr>`).join('')}</table></div>` : '<div class="empty">No approvals yet</div>'}</div>`;
};

views.policies = async () => {
  const list = (await api('GET', '/policies')).filter(i => hit(i.policy_no, i.client_name, i.insurer_name, i.cls));
  const days = d => d ? Math.round((new Date(d + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 864e5) : null;
  return `<div class="head"><div><h1>Policies</h1><p>Approved policies, soonest expiry first</p></div></div>
    <div class="card">${list.length ? `<div class="tw"><table><tr><th>Policy no.</th><th>Client</th><th>Insurer</th><th>Class</th><th>Start</th><th>Expiry</th><th class="num">Net premium</th><th>Renewal</th></tr>
      ${list.map(i => { const d = days(i.expiry_date); return `<tr class="click" data-do="preview" data-id="${i.id}"><td><b>${esc(i.policy_no)}</b></td><td>${esc(i.client_name)}</td><td class="dim">${esc(i.insurer_name)}</td><td class="dim">${esc(i.cls)}</td>
        <td>${fdate(i.start_date)}</td><td>${fdate(i.expiry_date)}</td><td class="num">${nf(i.net)}</td><td>${d === null ? '' : d < 0 ? badge('Expired', 'bad') : d <= 30 ? badge(d + ' days', 'warn') : d <= 60 ? badge(d + ' days', 'info') : badge('Active', 'ok')}</td></tr>`; }).join('')}</table></div>` : '<div class="empty">Policies appear here once Closing approves them</div>'}</div>`;
};

views.vouchers = async () => {
  const list = (await api('GET', '/journals')).filter(j => hit(j.no, j.ref, j.narration));
  return `<div class="head"><div><h1>Vouchers</h1><p>Every entry posted to the books. Posted vouchers are never edited, only reversed.</p></div></div>
    <div class="card">${list.length ? `<div class="tw"><table><tr><th>Voucher</th><th>Date</th><th>Type</th><th>Narration</th><th class="num">Amount</th><th>Posted by</th><th>Status</th></tr>
      ${list.map(j => `<tr class="click" data-do="voucher" data-id="${j.id}"><td><b>${esc(j.no)}</b></td><td>${fdate(j.jdate)}</td><td>${esc(j.type)}</td><td class="dim">${esc(j.narration)}</td><td class="num">${nf(j.amount)}</td>
        <td class="dim">${esc(j.created_by_name || '')}</td><td>${badge(j.status, j.status === 'Posted' ? 'ok' : 'bad')}</td></tr>`).join('')}</table></div>` : '<div class="empty">No vouchers yet. They are created automatically when Closing approves an invoice.</div>'}</div>`;
};
views.tb = async () => {
  const rows = await api('GET', '/trial-balance'), T = { A: 'Assets', L: 'Liabilities', E: 'Equity', I: 'Income', X: 'Expenses' };
  const dr = rows.reduce((s, r) => s + Math.max(0, r.bal), 0), cr = rows.reduce((s, r) => s + Math.max(0, -r.bal), 0);
  return `<div class="head"><div><h1>Trial Balance</h1><p>As at ${fdate(today())} · includes reversals</p></div><span class="sp"></span>${Math.abs(dr - cr) < 0.005 ? badge('Balanced', 'ok') : badge('Out of balance', 'bad')}</div>
    <div class="card">${rows.length ? `<table><tr><th>Code</th><th>Account</th><th>Type</th><th class="num">Debit</th><th class="num">Credit</th></tr>
      ${rows.filter(r => Math.abs(r.bal) > 0.004).map(r => `<tr><td class="dim">${esc(r.code)}</td><td>${esc(r.name)}</td><td class="dim">${T[r.type]}</td><td class="num">${r.bal > 0 ? nf(r.bal) : ''}</td><td class="num">${r.bal < 0 ? nf(-r.bal) : ''}</td></tr>`).join('')}
      <tr class="tot"><td></td><td>Total</td><td></td><td class="num">${nf(dr)}</td><td class="num">${nf(cr)}</td></tr></table>` : '<div class="empty">No balances yet</div>'}</div>`;
};

views.audit = async () => {
  const list = (await api('GET', '/audit')).filter(a => hit(a.action, a.entity_ref, a.detail, a.user_name));
  return `<div class="head"><div><h1>Activity Log</h1><p>Who did what, and when. This log cannot be edited.</p></div></div>
    <div class="card"><div class="tw"><table><tr><th>When</th><th>User</th><th>Action</th><th>Reference</th><th>Detail</th></tr>${list.map(a => `<tr><td class="dim">${ftime(a.at)}</td><td>${esc(a.user_name || '')}</td><td><b>${esc(a.action)}</b></td><td>${esc(a.entity_ref || '')}</td><td class="dim">${esc(a.detail || '')}</td></tr>`).join('')}</table></div></div>`;
};
views.admin = async () => {
  const users = await api('GET', '/users');
  return `<div class="head"><div><h1>Users & Lists</h1><p>Each person signs in with their own name and only sees what their role allows</p></div><span class="sp"></span><button class="btn pri" data-do="newUser">${ic('plus')}New user</button></div>
    <div class="card" style="margin-bottom:16px"><h3>Users</h3><table><tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th>Access</th><th></th></tr>${users.map(u => `<tr><td><b>${esc(u.username)}</b></td><td>${esc(u.name)}</td><td>${badge(u.role, 'info')}</td>
      <td>${u.active ? badge('Active', 'ok') : badge('Disabled', 'bad')}</td><td class="dim">${u.role === 'Admin' ? 'Admin – sees everything' : esc(accessSummary(u.access))}</td><td class="num"><button class="btn sm" data-do="editUser" data-id="${u.id}">Edit</button></td></tr>`).join('')}</table></div>
    <div class="grid g2"><div class="card"><h3>Insurers <span class="sp"></span><button class="btn sm" data-do="newInsurer">${ic('plus')}Add</button></h3>${S.meta.insurers.map(i => `<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05)">${esc(i.name)}</div>`).join('')}</div>
      <div class="card"><h3>Producers <span class="sp"></span><button class="btn sm" data-do="newProducer">${ic('plus')}Add</button></h3>${S.meta.producers.map(p => `<div class="row" style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05)">${esc(p.name)}<span class="sp"></span><span class="dim">${p.comm_pct}% of commission</span></div>`).join('')}</div></div>`;
};

/* ---------- forms ---------- */
function modal(title, body, onSave, o = {}) {
  const m = $('#modal'); m.hidden = false;
  m.innerHTML = `<form class="card ${o.narrow ? 'narrow' : ''}"><h2>${esc(title)}</h2><div style="margin-top:14px">${body}</div>
    <footer>${o.extra || ''}<span class="sp"></span><button type="button" class="btn" data-do="closeModal">${onSave ? 'Cancel' : 'Close'}</button>${onSave ? `<button class="btn ${o.kind || 'pri'}">${esc(o.save || 'Save')}</button>` : ''}</footer></form>`;
  const f = $('form', m); if (o.init) o.init(f);
  f.onsubmit = act(async e => { e.preventDefault(); if (!onSave) return; const d = Object.fromEntries(new FormData(f)); await onSave(d, f); closeModal(); await refresh(); });
  const first = $('input:not([type=hidden]),select,textarea', f); if (first) first.focus();
}
const closeModal = () => { $('#modal').hidden = true; $('#modal').innerHTML = ''; };
const refresh = async () => { S.meta = await api('GET', '/meta'); await render(); };
const fld = (label, name, val = '', attr = '') => `<div><label>${label}</label><input name="${name}" value="${esc(val ?? '')}" ${attr}></div>`;
const sel = (label, name, list, val, blank, cls = '') => `<div class="${cls}"><label>${label}</label><select name="${name}">${opts(list, val, blank)}</select></div>`;

// Department > Group > Class > Sub class: each list depends on the one before it.
function taxFields(v = {}) {
  const d = v.dept || Object.keys(TAX)[0], g = v.grp || Object.keys(TAX[d])[0], c = v.cls || Object.keys(TAX[d][g])[0];
  return sel('Department', 'dept', Object.keys(TAX), d) + sel('Group of risk', 'grp', Object.keys(TAX[d]), g) + sel('Class of risk', 'cls', Object.keys(TAX[d][g]), c) + sel('Sub class', 'sub', TAX[d][g][c], v.sub);
}
function taxBind(f) {
  const fill = (n, list) => { f[n].innerHTML = opts(list); };
  f.dept.onchange = () => { fill('grp', Object.keys(TAX[f.dept.value])); f.grp.onchange(); };
  f.grp.onchange = () => { fill('cls', Object.keys(TAX[f.dept.value][f.grp.value])); f.cls.onchange(); };
  f.cls.onchange = () => fill('sub', TAX[f.dept.value][f.grp.value][f.cls.value]);
}
const clientOpts = () => S.meta.clients.map(c => [c.id, c.name]), insOpts = () => S.meta.insurers.filter(i => i.active).map(i => [i.id, i.name]), prodOpts = () => S.meta.producers.filter(p => p.active).map(p => [p.id, p.name]);

function clientForm(c = {}) {
  modal(c.id ? 'Edit client' : 'New client', `<div class="form">${fld('Client name', 'name', c.name, 'required')}${sel('Type', 'type', ['Corporate', 'Individual', 'SME', 'Government'], c.type)}
    ${fld('Contact person', 'contact', c.contact)}${fld('Phone', 'phone', c.phone)}${fld('Email', 'email', c.email, 'type="email"')}${fld('City', 'city', c.city)}
    ${fld('TRN (VAT number)', 'trn', c.trn)}${sel('Producer', 'producer_id', prodOpts(), c.producer_id, '— none —')}</div>`,
    d => c.id ? api('PUT', '/clients/' + c.id, d) : api('POST', '/clients', d));
}
function enquiryForm(e = {}) {
  if (!S.meta.clients.length) return toast('Add a client first', 'bad');
  modal(e.id ? 'Edit enquiry ' + e.ref : 'New enquiry', `<div class="form">${e.id ? '' : sel('Client', 'client_id', clientOpts(), e.client_id, undefined, 'full')}${taxFields(e)}
    ${sel('Business type', 'type', ['New', 'Renewal'], e.type)}${sel('Source', 'source', SOURCES, e.source)}${sel('Priority', 'priority', ['High', 'Medium', 'Low'], e.priority || 'Medium')}${sel('Producer', 'producer_id', prodOpts(), e.producer_id, '— none —')}
    ${fld('Sum insured (AED)', 'sum_insured', e.sum_insured || '', 'type="number" step="0.01" min="0"')}${fld('Estimated premium (AED)', 'premium_est', e.premium_est || '', 'type="number" step="0.01" min="0"')}
    ${fld('Inception date', 'inception', e.inception || '', 'type="date"')}<div class="full"><label>Requirements / notes</label><textarea name="requirements">${esc(e.requirements || '')}</textarea></div></div>`,
    async d => { if (e.id) await api('PUT', '/enquiries/' + e.id, d); else { const n = await api('POST', '/enquiries', d); S.view = 'enquiries'; S.sel = n.id; S.tab.enq = 'Open'; } }, { init: taxBind });
}
function calc(b) {
  const net = r2(b.net), fees = r2(b.fees), vp = b.vat_pct === '' ? 5 : +b.vat_pct, vat = r2((net + fees) * vp / 100), comm = r2(net * (+b.comm_pct || 0) / 100), prod = r2(comm * (+b.prod_pct || 0) / 100);
  return { vat, total: r2(net + fees + vat), comm, commVat: r2(comm * .05), prod };
}
function invoiceForm(i = {}) {
  if (!S.meta.clients.length) return toast('Add a client first', 'bad');
  const start = i.start_date || today(), exp = i.expiry_date || (() => { const d = new Date(start + 'T00:00:00'); d.setFullYear(d.getFullYear() + 1); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
  modal(i.id ? 'Edit invoice ' + i.ref : 'Book invoice', `<input type="hidden" name="enquiry_id" value="${i.enquiry_id || ''}">
    <div class="sec" style="margin-top:0">Client & policy</div><div class="form">${sel('Client', 'client_id', clientOpts(), i.client_id)}${sel('Insurer', 'insurer_id', insOpts(), i.insurer_id)}
      ${fld('Policy number', 'policy_no', i.policy_no, 'required')}${sel('Issue type', 'issue_type', ['New', 'Renewal', 'Endorsement'], i.issue_type)}${fld('Endorsement number (if any)', 'endorsement_no', i.endorsement_no)}<div></div>${taxFields(i)}
      ${fld('Invoice date', 'invoice_date', i.invoice_date || today(), 'type="date" required')}${fld('Sum insured (AED)', 'sum_insured', i.sum_insured || '', 'type="number" step="0.01"')}
      ${fld('Policy start', 'start_date', start, 'type="date"')}${fld('Policy expiry', 'expiry_date', exp, 'type="date"')}</div>
    <div class="sec">Premium & charges</div><div class="form c3">${fld('Net premium (AED)', 'net', i.net ?? '', 'type="number" step="0.01" required')}${fld('Policy / other fees', 'fees', i.fees || '', 'type="number" step="0.01"')}${fld('VAT %', 'vat_pct', i.vat_pct ?? 5, 'type="number" step="0.01" min="0"')}</div>
    <div class="sec">Commission</div><div class="form c3">${fld('Commission from insurer %', 'comm_pct', i.comm_pct ?? '', 'type="number" step="0.01" min="0" max="100"')}${sel('Producer', 'producer_id', prodOpts(), i.producer_id, '— none —')}
      ${fld('Producer share % of commission', 'prod_pct', i.prod_pct ?? '', 'type="number" step="0.01" min="0" max="100"')}</div>
    <div class="form" style="margin-top:12px">${sel('Payment terms', 'pay_terms', PAY_TERMS, i.pay_terms)}</div><div class="sec">Invoice summary</div><div class="sum" id="sum"></div>`,
    async d => { if (i.id) await api('PUT', '/invoices/' + i.id, d); else await api('POST', '/invoices', d); S.view = 'invoices'; S.tab.inv = 'To do'; },
    { save: 'Save draft', init: f => { taxBind(f); const up = () => { const c = calc(Object.fromEntries(new FormData(f)));
      $('#sum', f).innerHTML = `<div><small>VAT on premium</small><b>${nf(c.vat)}</b></div><div><small>Client pays</small><b>${nf(c.total)}</b></div><div><small>Our commission (+VAT ${nf(c.commVat)})</small><b>${nf(c.comm)}</b></div><div><small>Producer share</small><b>${nf(c.prod)}</b></div>`; };
      f.oninput = up; up(); } });
}
async function previewInvoice(id) {
  const p = await api('GET', '/invoices/' + id + '/preview'), i = p.invoice, pending = i.status === 'Pending Closing' && canClose();
  modal(`${i.ref} · ${i.client_name}`, `<div class="row wrap" style="margin-bottom:12px">${badge(i.status, INV_TONE[i.status])}${badge(i.issue_type, 'info')}<span class="dim">Policy ${esc(i.policy_no)} · ${esc(i.insurer_name)} · ${esc(i.cls)} / ${esc(i.sub)}</span></div>
    <div class="sum"><div><small>Net premium</small><b>${nf(i.net)}</b></div><div><small>Fees + VAT</small><b>${nf(i.fees + i.vat)}</b></div><div><small>Client pays</small><b>${nf(i.total)}</b></div><div><small>Commission ${i.comm_pct}%</small><b>${nf(i.comm_amt)}</b></div></div>
    <p class="dim" style="margin:12px 0 0">Period ${fdate(i.start_date)} – ${fdate(i.expiry_date)} · Booked by ${esc(i.created_by_name || '')}${i.approved_by_name ? ' · Approved by ' + esc(i.approved_by_name) + ' as ' + esc(i.journal_no) : ''}</p>
    <div class="sec">${i.status === 'Approved' ? 'Entries posted to Finance' : 'Entries that will be posted to Finance on approval'}</div>
    <table><tr><th>Account</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th></tr>${p.lines.map(l => `<tr><td><span class="dim">${esc(l.code)}</span> ${esc(l.name)}</td><td class="dim">${esc(l.memo)}</td><td class="num">${l.dr ? nf(l.dr) : ''}</td><td class="num">${l.cr ? nf(l.cr) : ''}</td></tr>`).join('')}
      <tr class="tot"><td>Total</td><td></td><td class="num">${nf(p.dr)}</td><td class="num">${nf(p.cr)}</td></tr></table>`,
    pending ? async () => { const r = await api('POST', '/invoices/' + id + '/approve'); toast('Approved and posted to Finance as ' + r.journal_no); } : null,
    { save: 'Approve & post to Finance', kind: 'ok', extra: pending ? `<button type="button" class="btn danger" data-do="returnInv" data-id="${id}">Return to Production</button>` : '' });
}
const ask = (title, label, onSave, list) => modal(title, list ? `<label>${label}</label><select name="reason">${opts(list)}</select>` : `<label>${label}</label><textarea name="reason" required></textarea>`, onSave, { narrow: true, save: 'Confirm' });
function userForm(u = {}) {
  const a = u.access || {}, has = (k, v) => (a[k] || []).map(String).includes(String(v));
  const checks = (name, list) => `<div class="checks">${list.map(([v, l]) => `<label><input type="checkbox" data-acc="${name}" value="${esc(v)}" ${has(name, v) ? 'checked' : ''}> ${esc(l)}</label>`).join('')}</div>`;
  modal(u.id ? 'Edit user' : 'New user', `<div class="form">${u.id ? '' : fld('Username', 'username', '', 'required')}${fld('Full name', 'name', u.name, 'required')}${sel('Role', 'role', ['Production', 'Closing', 'Finance', 'Manager', 'Admin'], u.role)}
    ${fld(u.id ? 'New password (leave empty to keep)' : 'Password (8 or more characters)', 'password', '', `type="password" autocomplete="new-password" ${u.id ? '' : 'required'}`)}${u.id ? sel('Status', 'active', [['true', 'Active'], ['false', 'Disabled']], String(u.active)) : ''}</div>
    <div class="sec">What this user may see <span class="mute" style="text-transform:none;letter-spacing:0">— leave everything empty for no limits. Admin users are never limited.</span></div>
    <div class="form"><div><label>Departments (only these)</label>${checks('depts', Object.keys(TAX).map(d => [d, d]))}</div>
      <div><label>Statements and aging reports (only these)</label>${checks('statements', [['client', 'Client – premium'], ['insurer', 'Insurance company – premium'], ['inscomm', 'Insurance company – commission'], ['producer', 'Producer – commission']])}</div>
      ${fld('Hide invoices above (AED)', 'max_invoice', a.max_invoice || '', 'type="number" min="0" step="1" placeholder="No limit"')}<div></div>
      <div><label>Producers (only these producers' business)</label>${checks('producers', S.meta.producers.map(p => [p.id, p.name]))}</div>
      <div><label>Clients hidden from this user</label><select multiple size="7" data-acc-multi="clients_hidden">${S.meta.clients.map(c => `<option value="${c.id}" ${has('clients_hidden', c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <small class="mute">Hold Ctrl to pick several</small></div></div>
    <p class="dim" style="margin:12px 0 0">A user with any of these limits sees only matching clients, enquiries, invoices, PDCs, statements and aging. The full books (vouchers, ledgers, trial balance, VAT) are closed to them.</p>`,
    (d, f) => { const access = { depts: [], statements: [], producers: [], max_invoice: +d.max_invoice || 0,
        clients_hidden: [...f.querySelectorAll('[data-acc-multi] option:checked')].map(o => +o.value) };
      f.querySelectorAll('[data-acc]:checked').forEach(c => access[c.dataset.acc].push(c.dataset.acc === 'producers' ? +c.value : c.value));
      const body = Object.assign(d, { access }); delete body.max_invoice;
      return u.id ? api('PUT', '/users/' + u.id, Object.assign(body, { active: d.active !== 'false' })) : api('POST', '/users', body); });
}
const accessSummary = a => { a = a || {}; const p = [];
  if ((a.depts || []).length) p.push(a.depts.join(', ')); if ((a.producers || []).length) p.push(a.producers.length + ' producer(s)');
  if ((a.clients_hidden || []).length) p.push(a.clients_hidden.length + ' client(s) hidden'); if (a.max_invoice) p.push('up to ' + n0(a.max_invoice));
  if ((a.statements || []).length) p.push('statements: ' + a.statements.length); return p.length ? p.join(' · ') : 'No limits'; };

/* ---------- actions ---------- */
const DO = {
  logout: async () => { await api('POST', '/logout'); S.user = null; S.meta = null; render(); },
  account: () => modal('Change my password', fld('New password (8 or more characters)', 'password', '', 'type="password" autocomplete="new-password" required minlength="8"'), async d => { await api('POST', '/password', d); toast('Password changed'); }, { narrow: true }),
  closeModal, newClient: () => clientForm(), newEnquiry: () => enquiryForm(), newInvoice: () => invoiceForm(), newUser: () => userForm(),
  editClient: async id => clientForm((await api('GET', '/clients')).find(c => c.id == id)),
  editEnquiry: async id => enquiryForm(await api('GET', '/enquiries/' + id)),
  editInvoice: async id => invoiceForm((await api('GET', '/invoices')).find(i => i.id == id)),
  editUser: async id => userForm((await api('GET', '/users')).find(u => u.id == id)),
  stage: async (id, el) => { await api('POST', `/enquiries/${id}/stage`, { stage: el.dataset.stage }); render(); },
  lost: id => ask('Client did not confirm', 'Reason', d => api('POST', `/enquiries/${id}/stage`, { stage: 'Lost', reason: d.reason }), LOST),
  newQuote: id => modal('Add quotation', `<div class="form">${sel('Insurer', 'insurer_id', insOpts())}${fld('Premium (AED)', 'premium', '', 'type="number" step="0.01" min="0.01" required')}<div class="full"><label>Terms / remarks</label><textarea name="terms"></textarea></div></div>`,
    d => api('POST', `/enquiries/${id}/quotes`, d), { narrow: true }),
  choose: async id => { await api('POST', `/quotes/${id}/choose`); toast('Client confirmation recorded'); render(); },
  bookFrom: async id => { const e = await api('GET', '/enquiries/' + id), q = e.quotes.find(x => x.status === 'Chosen'), p = S.meta.producers.find(x => x.id === e.producer_id);
    invoiceForm({ enquiry_id: e.id, client_id: e.client_id, insurer_id: q.insurer_id, producer_id: e.producer_id, issue_type: e.type, dept: e.dept, grp: e.grp, cls: e.cls, sub: e.sub, net: q.premium, sum_insured: e.sum_insured, start_date: e.inception, prod_pct: p ? p.comm_pct : '' }); },
  submit: async id => { await api('POST', `/invoices/${id}/submit`); toast('Sent to Closing'); render(); },
  preview: id => previewInvoice(id),
  returnInv: id => ask('Return to Production', 'What needs to be corrected?', async d => { await api('POST', `/invoices/${id}/return`, d); toast('Returned to Production'); }),
  voucher: async id => { const j = await api('GET', '/journals/' + id), canRev = is('Admin', 'Finance') && j.status === 'Posted' && j.type !== 'Reversal';
    modal(`${j.no} · ${j.type}`, `<p class="dim" style="margin:0 0 12px">${fdate(j.jdate)} · ${esc(j.narration)} ${badge(j.status, j.status === 'Posted' ? 'ok' : 'bad')}</p>
      <table><tr><th>Account</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th></tr>${j.lines.map(l => `<tr><td><span class="dim">${esc(l.code)}</span> ${esc(l.name)}</td><td class="dim">${esc(l.memo || '')}${l.invoice_ref ? ' ' + badge(l.invoice_ref, 'info') : ''}</td><td class="num">${l.dr ? nf(l.dr) : ''}</td><td class="num">${l.cr ? nf(l.cr) : ''}</td></tr>`).join('')}</table>`,
      null, { extra: canRev ? `<button type="button" class="btn danger" data-do="reverse" data-id="${j.id}">Reverse this voucher</button>` : '' }); },
  reverse: id => ask('Reverse voucher', 'Reason for the reversal', async d => { const r = await api('POST', `/journals/${id}/reverse`, d); toast('Reversed as ' + r.journal_no); }),
  newInsurer: () => modal('Add insurer', fld('Insurer name', 'name', '', 'required'), d => api('POST', '/insurers', d), { narrow: true }),
  newProducer: () => modal('Add producer', `<div class="form">${fld('Producer name', 'name', '', 'required')}${fld('Share % of commission', 'comm_pct', '', 'type="number" step="0.01" min="0" max="100"')}</div>`, d => api('POST', '/producers', d), { narrow: true })
};

document.addEventListener('click', act(async e => {
  const d = e.target.closest('[data-do]'); if (d && d.dataset.do) return DO[d.dataset.do](d.dataset.id, d);
  const t = e.target.closest('[data-tab]'); if (t) { const [k, v] = t.dataset.tab.split(':'); S.tab[k] = v; S.sel = null; return render(); }
  const n = e.target.closest('[data-nav]');
  if (n) { if (n.tagName === 'A' && (e.ctrlKey || e.metaKey || e.shiftKey)) return; e.preventDefault(); return go(n.dataset.nav, n.dataset.sel ? +n.dataset.sel : null); }
  const s = e.target.closest('[data-sel]'); if (s) { if (S.view === 'enquiries') return go('enquiries', +s.dataset.sel); S.sel = +s.dataset.sel; return render(); }
}));
document.addEventListener('submit', act(async e => {
  if (e.target.id !== 'noteForm') return; e.preventDefault();
  await api('POST', `/enquiries/${e.target.dataset.id}/notes`, { body: new FormData(e.target).get('body') }); render();
}));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('#modal').hidden) closeModal();
  if (e.key === 'Enter' && e.target.id === 'q') { S.search = e.target.value.trim(); S.sel = null; render(); }
});

(async () => { try { S.user = await (await fetch('/api/me')).json().then(u => u.id ? u : null); } catch (e) { S.user = null; }
  readHash(); render(); })();
