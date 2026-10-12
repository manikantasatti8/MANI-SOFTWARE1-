# MANI-SOFTWARE1- · Broker Portal

One system for an insurance broker: **Production** books the business, **Closing** approves it,
and the approval posts the accounting entries to **Finance** automatically.

```
Enquiry → Requirements → Sent to insurers → Quotations → Client confirmed
        → Invoice booked → Closing approves → Voucher posted to the books
```

## Run it on your laptop

You need Git, Node.js (LTS) and PostgreSQL installed.

1. Open the project folder in VS Code, then open a terminal (**Terminal > New Terminal**).
2. Install the parts the software needs:
   ```
   npm install
   ```
3. Copy `.env.example` to a new file named `.env`, and put your PostgreSQL password after `PGPASSWORD=`.
4. Create the database and your administrator login (it asks you to choose a password):
   ```
   npm run setup
   ```
5. Start the portal:
   ```
   npm start
   ```
6. Open **http://localhost:3000** in your browser and sign in.

To stop it, press `Ctrl + C` in the terminal. Next time you only need `npm start`.

## Who can do what

| Role       | Can do |
|------------|--------|
| Production | Clients, enquiries, quotations, book invoices, send to Closing |
| Closing    | Review the entries, approve (posts to Finance) or return to Production |
| Finance    | See vouchers and trial balance, reverse a posted voucher |
| Manager    | See everything, change nothing |
| Admin      | Everything, plus users, insurers and producers |

## Security

- Passwords are stored only in scrambled (bcrypt) form. Nobody can read them back.
- There are no default logins. The administrator password is chosen during setup.
- Five wrong passwords lock an account for 15 minutes.
- Users are signed out after 30 minutes without activity (`IDLE_MINUTES` in `.env`).
- The server checks the user's role on every action, not just the screen.
- A Closing user cannot approve an invoice they booked themselves.
- Posted vouchers are never edited or deleted, only reversed. Every action is in the Activity Log.
- `.env` holds the database password and login key. It is never uploaded to GitHub.

When other people start using it over the office network, it must run behind HTTPS.

## Where things are

| Folder | What it holds |
|--------|---------------|
| `db/schema.sql` | The database tables |
| `db/coa.js` | The chart of accounts |
| `db/setup.js` | First-time setup |
| `server/api.js` | Every action the portal can perform, with the role checks |
| `server/posting.js` | The accounting entries created when Closing approves |
| `public/` | The screens shown in the browser |
| `public/taxonomy.js` | Department > Group > Class > Sub class lists |

## Finance

- **Finance Dashboard**: cash, bank, premium outstanding, premium payable, commission due, producer payable,
  PDC premium and VAT. Click any card to open its detailed page.
- **Chart of Accounts**: assets, liabilities, equity, income, expenses. Add your own accounts and bank or cash accounts.
- **Vouchers**: bank receipt, bank payment, cash receipt, cash payment, general voucher. Each line can be allocated to an invoice or left without allocation (on account).
- **Direct payment voucher**: when the client pays the insurer directly. The client balance and the insurer premium payable both go down.
- **PDC cheques** and the **PDC Premium** page: each cheque is linked to its invoice. Marking it cleared posts the voucher.
- **Statements** and **Aging reports** for client premium, insurer premium, insurer commission and producer commission,
  invoice by invoice, in age buckets (0–30, 31–60, 61–90, 91–180, 181–365, over 365 days).
- **VAT report**, **Amortization** of prepaid expenses, **Profit & Loss**, **Balance Sheet**, **Trial Balance**.
- Every report has **Export to Excel** and **Print**.

Commission sits in one account per insurer. The statement splits it:
`original = PDC part + part on outstanding premium + due part`, and `due commission = due part − settled`.
Commission becomes due in step with the premium the client has paid, to us or directly to the insurer.

## Who sees what

Under **Users & Lists**, each user can be limited to:
departments (Medical / Motor / General), certain producers' business, invoices up to an amount,
certain statements and aging reports, and can have specific clients hidden.
These limits are applied by the server to every screen and every report. A limited user cannot open
the full books (vouchers, ledgers, trial balance, VAT, profit & loss). Admin users are never limited.

## Every screen has its own address

For example `http://localhost:3000/#aging/inscomm` or `#pdc-premium`. You can bookmark a screen,
use the browser's back button, or press **New tab** (top right) to work on several screens at once.

## Updating to a new version

Stop the portal (`Ctrl + C`), take a backup, then:
```
git pull
npm install
npm run setup
npm start
```
`npm run setup` only adds what is new. It never deletes data.

Backup (asks for your PostgreSQL password; keep the file outside the project folder):
```
"C:\Program Files\PostgreSQL\18\bin\pg_dump" -U postgres -h localhost -F c -f backup.dump broker_portal
```

## Not built yet

Matching an on-account receipt to invoices afterwards, gratuity and leave provisions, year-end transfer
to Head Office, bank reconciliation, endorsements as their own screen, renewals workflow, document upload, and email.
