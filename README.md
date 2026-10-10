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

## Not built yet

Finance beyond vouchers and trial balance (receipts, payments, statements, reports), endorsements
as their own screen, renewals workflow, document upload, and email.
