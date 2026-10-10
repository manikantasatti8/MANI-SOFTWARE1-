// The link between Production and Finance.
// When Closing approves an invoice, these are the accounting entries that hit the books.
const r2 = n => Math.round((+n || 0) * 100) / 100;

// Works out VAT, total and commissions from what the user typed.
function calcInvoice(b, vatRate = 5) {
  const net = r2(b.net), fees = r2(b.fees), vat_pct = b.vat_pct === undefined || b.vat_pct === '' ? vatRate : +b.vat_pct;
  const vat = r2((net + fees) * vat_pct / 100), total = r2(net + fees + vat);
  const comm_pct = +b.comm_pct || 0, comm_amt = r2(net * comm_pct / 100), comm_vat = r2(comm_amt * vatRate / 100);
  const prod_pct = +b.prod_pct || 0, prod_amt = r2(comm_amt * prod_pct / 100), prod_vat = r2(prod_amt * vatRate / 100);
  return { net, fees, vat_pct, vat, total, comm_pct, comm_amt, comm_vat, prod_pct, prod_amt, prod_vat };
}

const CONTROL = { client: '110201', insurer: '2101', inscomm: '110203', producer: '2102' };
const SUFFIX = { insurer: ' – Premium', inscomm: ' – Commission' };
const commIncome = dept => /motor/i.test(dept) ? '4101' : /medical/i.test(dept) ? '4102' : '4103';

// Finds the party's own account under its control account, creating it the first time.
async function partyAccount(t, kind, id, name, create) {
  const a = await t.one('SELECT * FROM accounts WHERE party_kind=$1 AND party_id=$2', [kind, id]);
  if (a) return a;
  const label = name + (SUFFIX[kind] || '');
  if (!create) return { id: null, code: CONTROL[kind] + ' · new', name: label };
  const ctl = await t.one('SELECT * FROM accounts WHERE code=$1 FOR UPDATE', [CONTROL[kind]]);
  const n = (await t.one('SELECT count(*)::int n FROM accounts WHERE parent_code=$1', [ctl.code])).n + 1;
  return t.one(`INSERT INTO accounts(code,name,type,parent_code,party_kind,party_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [ctl.code + '-' + String(n).padStart(4, '0'), label, ctl.type, ctl.code, kind, id]);
}

// Builds the journal lines for an invoice. With create=false it is only a preview (nothing is saved).
async function invoiceLines(t, inv, create) {
  const byCode = async code => t.one('SELECT * FROM accounts WHERE code=$1', [code]);
  const ref = inv.policy_no, L = [];
  const add = (a, amt, side, memo) => {
    amt = r2(amt); if (!amt) return;
    if (amt < 0) { amt = -amt; side = side === 'dr' ? 'cr' : 'dr'; }      // refunds / credit endorsements flip sides
    L.push({ account_id: a.id, code: a.code, name: a.name, dr: side === 'dr' ? amt : 0, cr: side === 'cr' ? amt : 0, memo });
  };
  const client = await partyAccount(t, 'client', inv.client_id, inv.client_name, create);
  const insP = await partyAccount(t, 'insurer', inv.insurer_id, inv.insurer_name, create);
  const insC = await partyAccount(t, 'inscomm', inv.insurer_id, inv.insurer_name, create);
  add(client, inv.total, 'dr', 'Premium due incl. VAT – ' + ref);
  add(insP, inv.total, 'cr', 'Gross premium payable – ' + ref);
  add(insC, inv.comm_amt + inv.comm_vat, 'dr', `Commission ${inv.comm_pct}% + VAT receivable – ${ref}`);
  add(await byCode(commIncome(inv.dept)), inv.comm_amt, 'cr', 'Brokerage commission – ' + ref);
  add(await byCode('2104'), inv.comm_vat, 'cr', 'Output VAT on commission – ' + ref);
  if (inv.producer_id && inv.prod_amt) {
    const prod = await partyAccount(t, 'producer', inv.producer_id, inv.producer_name, create);
    add(await byCode('5101'), inv.prod_amt, 'dr', 'Producer commission – ' + inv.producer_name);
    add(await byCode('1105'), inv.prod_vat, 'dr', 'Input VAT – ' + inv.producer_name);
    add(prod, inv.prod_amt + inv.prod_vat, 'cr', 'Commission payable – ' + ref);
  }
  const dr = r2(L.reduce((s, l) => s + l.dr, 0)), cr = r2(L.reduce((s, l) => s + l.cr, 0));
  if (Math.abs(dr - cr) > 0.004) throw new Error(`Entries do not balance (Dr ${dr} / Cr ${cr})`);
  return { lines: L, dr, cr };
}

module.exports = { r2, calcInvoice, invoiceLines };
