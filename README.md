# Ledgerstone — cPanel setup

A property management app: buildings, units, owners, tenants, leases, a
tenant ledger with aging, maintenance tracking with vendor/invoice/approval
workflow, trust accounting (a per-owner/building trust balance segregated
from tenant security deposits, generated monthly owner statements, and
ownership-transfer audit trail), a communications log, building/unit
profiles with a per-unit appliance list, and a staff timecard tool for
tracking labor by activity and building/unit.
Two account types: **staff** (full access) and **owner** (read-only,
scoped to the buildings they own).

Stack: PHP + MySQL. No Node, no build step, and no Composer dependencies
except dompdf (used only for PDF statement export — see "PDF statements"
below) — this is intentionally close to the simplest thing that works on
ordinary shared cPanel hosting.

## 1. Create the database

In cPanel:

1. **MySQL® Databases** → create a new database (e.g. `pm`). cPanel will
   prefix it with your account name, giving you something like
   `cpaneluser_pm`.
2. Same page → create a new database user with a strong password.
3. Add that user to the database, with **All Privileges**.
4. Note the three values cPanel just generated: the full database name,
   the full username, and the password you set.

## 2. Import the schema

1. cPanel → **phpMyAdmin** → select your new database → **Import** tab →
   choose `schema.sql` from this folder → **Go**.
2. This creates all the tables and one seed login:
   - Username: `admin`
   - Password: `changeme123`

   This account is flagged to force a password change — the app opens
   straight into the "Change Password" dialog on first login and won't
   let you dismiss it until you set a real password.

## 3. Upload the files

1. Create a subdomain or a subfolder for this — e.g. `pm.yourdomain.com`
   or `yourdomain.com/pm`. **cPanel → Subdomains** if you want a
   subdomain (recommended — keeps it cleanly separate from any other site).
2. Upload everything in this folder to that subdomain's document root,
   either via **File Manager** (zip upload, then extract) or FTP/SFTP.

## 4. Configure the database connection

1. Copy `config.sample.php` to `config.php` (same folder).
2. Edit `config.php` and fill in the three values from Step 1:
   ```php
   'db_host' => 'localhost',
   'db_name' => 'cpaneluser_pm',
   'db_user' => 'cpaneluser_pmuser',
   'db_pass' => 'the password you set',
   ```
3. Save. `config.php` is never served to browsers directly (`.htaccess`
   blocks it, and PHP files execute rather than display as text anyway),
   but don't email it around or commit it anywhere public — it's the one
   file with a real credential in it.

## 5. Log in

Visit your subdomain. You should land on a login page. Log in with
`admin` / `changeme123`, then immediately:

1. Sidebar → **Change password** → set a real password.
2. **Users** tab → add accounts for anyone else who needs access —
   staff get full access, an owner login needs to be linked to an
   existing owner record (add the owner under the Owners tab first if
   they're not there yet).

## How the two account types work

- **Staff** accounts see and can edit everything.
- **Owner** accounts are locked to whichever building(s) that owner
  record is tied to (via ownership %) — same level of detail as staff
  see (tenant names, individual charges and payments), just scoped to
  their own building(s), and **read-only**. The read-only boundary is
  enforced on the server in `api.php`, not just hidden in the UI, so
  it holds even if someone pokes at the browser console.

## Files

- `schema.sql` — run this once, in phpMyAdmin, to create the tables.
- `config.sample.php` → copy to `config.php`, fill in your DB
  credentials. Never commit or share `config.php` itself.
- `db.php`, `auth.php` — database connection and session/login helpers.
- `login.php`, `logout.php`, `index.php` — the pages a browser actually
  hits.
- `api.php` — the one backend endpoint the frontend talks to. Every
  write action re-checks the logged-in user's role server-side.
- `lib_rent.php` — the rent-due charge logic, shared by `api.php` (for the
  admin's manual "Run rent-due check now" button) and `cron_rent_due.php`.
- `cron_rent_due.php` — run daily by cPanel's Cron Jobs (see below); creates
  the month's rent charge for any active lease whose billing day is today.
- `assets/app.js`, `assets/style.css` — the whole frontend. One file
  each, no build step, no framework.

## Automatic rent due

Rent is charged to a lease's ledger automatically on its billing day each
month — no manual "Add Charge" needed for the regular monthly rent charge.
This runs via a cPanel cron job, not by anyone having the app open:

1. cPanel → **Cron Jobs**.
2. Common Settings → **Once Per Day** (e.g. 1:00 AM), or set your own schedule.
3. Command:
   ```
   php /home/murphserv/public_html/PROJECT-ledgerstone/cron_rent_due.php
   ```
   Use the full PHP binary path cPanel suggests if your host requires it
   instead of just `php` (often `/usr/local/bin/php` or similar — cPanel's
   Cron Jobs page shows the right one).
4. It's safe to run more than once a day (a lease already charged for
   today is skipped), and it does nothing outside the CLI — it can't be
   triggered by visiting a URL.
5. Admins can also trigger it on demand from the **Ledger** tab ("Run
   rent-due check now") — handy right after adding a new lease with a
   billing day earlier than today, so it doesn't wait for tomorrow's cron.

## Automatic deploy

By default, a merge to `main` only updates GitHub — cPanel's copy stays on
whatever was last deployed until someone opens **Git Version Control** and
clicks "Update from Remote" then "Deploy HEAD Commit". `cron_deploy.sh` runs
those two steps on a schedule instead:

1. cPanel → **Git Version Control** → open this repo → confirm the
   **Repository Path** shown there. If it isn't
   `/home/murphserv/repositories/ledgerstone`, edit `REPO_DIR` at the top of
   `cron_deploy.sh` to match, then commit and push that change (or edit it
   directly on the server — cron reads the file at run time, not a deployed
   copy of it).
2. cPanel → **Cron Jobs** → Common Settings → **Every 10 minutes** (or your
   own schedule — it's a no-op when `main` hasn't moved).
3. Command:
   ```
   /bin/bash /home/murphserv/repositories/ledgerstone/cron_deploy.sh >> /home/murphserv/logs/deploy.log 2>&1
   ```
   Point this at wherever `cron_deploy.sh` actually lives (the repo checkout
   from step 1, not `public_html`), and create the `logs` directory first if
   it doesn't exist. Drop the log redirect if you'd rather cPanel email you
   the output of every run.
4. It exits quietly with nothing deployed when there's nothing new; it only
   prints (and deploys) when `main` has moved since the last run.

## Backups

This is now a real database, not a browser-local file — cPanel's
**Backup** tool (or your host's automatic backup service, if they run
one) should include it once the database exists, but confirm that
rather than assuming it. A manual export from phpMyAdmin
(**Export → Quick → Go**) takes ten seconds and is worth doing before
any big change (e.g. before importing a new schema version).

## Updating an existing install (new columns/tables)

If your database was created before building/unit profiles or Timecards
existed, run `migrations/002_profiles_timecards_owner_statement.sql`
once via phpMyAdmin's SQL tab (Export your database first, as always
before a schema change). A fresh install via the current `schema.sql`
already has everything and doesn't need this file.

If your database predates the Vendors directory, also run
`migrations/003_vendors.sql` the same way.

If your database predates per-room measurements, also run
`migrations/004_rooms.sql` the same way.

If your database predates Printables (envelope/letter mailing addresses
and the stamp log), also run `migrations/005_printables.sql` the same way.

If your database predates trust accounting (a real owner trust balance
per building, segregated security deposits, vendor/invoice/approval
fields on maintenance, reserve amounts, generated owner statements, and
ownership transfers), also run `migrations/006_trust_accounting.sql` the
same way — **export your database first**, since this one replaces the
old `owner_ledger` table with `trust_transactions` and migrates its rows.
See the comments at the top of that file for what it changes and what to
double-check afterward.

## Trust accounting

- **Trust ledger** (Trust & Deposits tab) — each owner's share of pooled
  rent cash, per building, kept separate from the bank account itself so
  you can always prove what belongs to which owner. It fills in
  automatically: a tenant rent/late-fee/utility/other payment posts
  income split by ownership %, a completed repair posts an expense the
  same way, and generating a monthly statement (see below) posts the
  management fee, any unbilled postage, and a disbursement. The only
  manual entries are a fee, a disbursement, or a flagged adjustment —
  income and expense postings always follow their ledger/maintenance
  record so they can't drift out of sync with it.
- **Security deposits** — segregated from the trust ledger entirely, tied
  to unit + tenant + lease. Record one by adding a payment on a tenant's
  ledger with category "deposit" — it never touches the operating trust
  balance. Refund or deduct from it under Trust & Deposits. Deposits are
  keyed to the building, not the owner, so they automatically stay
  attached to a building through an ownership transfer with no separate
  step.
- **One statement per owner per month** — Reports → Owner Statements.
  Generating a statement rolls the management fee, any postage billed
  since the last cycle, and the period's itemized repairs into a single
  invoice, then discloses whatever's disbursed above the building's
  reserve (set per building on its edit form, alongside the repair
  approval threshold). A statement is a frozen snapshot — reopening one
  later shows exactly what was generated and disbursed at the time.
  Export any statement as PDF from its row, or from its detail view.
- **Maintenance approval** — set a building's repair approval threshold
  and any request over it needs a decision before its cost posts to the
  trust ledger. An owner login, otherwise entirely read-only, gets
  exactly one narrow write action here: approve or deny a pending request
  on a building they own.
- **Ownership transfers** — Properties → a building's "Transfer
  Ownership" button. Records the trust balance and security deposits on
  file at the moment of transfer as an audit trail, moves the trust
  balance to the incoming owner, and updates `building_owners` — deposits
  need no separate handling since they're already tied to the building.

### PDF statements (Composer / dompdf)

Owner statement PDFs use [dompdf](https://github.com/dompdf/dompdf), this
app's one Composer dependency — added deliberately, not by default, since
everything else here is plain PHP with no build step. Set it up once:

1. If your host offers cPanel's **Setup Node.js/PHP App** page with a
   Composer button, use that, pointed at this app's folder. Otherwise SSH
   in and run `composer install` in this folder.
2. That creates a `vendor/` folder. Either let it live on the server (if
   you used the Composer button or SSH, it's already there), or run
   `composer install` locally and commit/upload the `vendor/` folder
   alongside everything else — this repo doesn't run a build step on
   deploy, so `vendor/` has to already exist where `owner_statement_pdf.php`
   can find it.
3. Until then, PDF export shows a plain explanation instead of a fatal
   error, and a statement's **Print** view (browser "Save as PDF") still
   works as a fallback.

## Building/unit profiles, appliances, and timecards

- **Properties** → a building's edit form now has roof/electrical/exterior
  paint fields. Click a unit's number (or its **Profile** button) to open
  its profile page: wall color, faceplate color, a repeatable appliance
  list (type, make, model, serial #, install date — age is computed from
  that date), and a repeatable room list. Add a room while the unit is
  vacant to record its size, an optional paint color override (when a
  room isn't the unit's standard color), and a list of door/window
  measurements (width × height in inches) — everything needed to order
  custom blinds, screens, or doors without a return trip. Use the
  profile page's **Print** button to hand an owner a printout of all of
  it if they ever move on from you.
- **Timecards** (staff only) logs hours against a building (and
  optionally a specific unit) under one of six activities (Administrative,
  Leasing, Turnover, Repairs, Maintenance, Other), each with an hourly
  rate captured on the entry itself. A default rate can be set per staff
  login in **Users**. The tab includes a profitability snapshot — rent
  collected vs. labor cost for a building over a date range.
- **Reports → Owner Statements** generates one frozen statement per owner
  per building per month — see "Trust accounting" below for the full
  picture (income, itemized repairs, management fee, reserve, and
  disbursement) and how to export it as a PDF. There's no automated email
  sender built in yet, since this app has no mail server configuration.
- **Printables** (staff only) prints envelopes and form letters. Pick a
  "From" (a building or an owner) and a "To" (a tenant, vendor, owner, or
  custom entry) and it pulls the mailing address from that record —
  tenants use their unit's building address, owners and vendors use the
  mailing address on their record. Both addresses stay editable before
  printing. Each print (envelope or letter) logs a stamp in the **Stamps**
  panel below, which you can bill to an owner in bulk as an owner-ledger
  charge (quantity × a per-stamp rate you set). An **Envelope** button on
  the Owners/Tenants/Vendors lists jumps straight into Printables with
  that recipient already picked.

## Extending this later

Everything here is plain PHP and vanilla JS — no framework, no build
tool. If you want to keep developing it (new report types, CSV export,
etc.), any general-purpose coding tool can pick this up directly from
these files; there's no hidden state or generated code to reconstruct.

## Login security

- After 5 failed login attempts on an account, it's locked for 15 minutes
  (tracked in `users.failed_attempts` / `users.locked_until`). This also
  applies to repeated wrong "current password" guesses on the change-password
  form. Wait it out, or clear it early from phpMyAdmin — `users` table, set
  that row's `failed_attempts` to `0` and `locked_until` to `NULL`.
- Set `HTTPS` up on the subdomain before real use — the session cookie
  automatically gets the `Secure` flag once the app detects it's being
  served over `https://`, but only then.

## Locked out?

If everyone forgets their password, you can reset the `admin` account
straight from phpMyAdmin without touching PHP:

1. On any computer with PHP installed, run:
   `php -r "echo password_hash('yournewpassword', PASSWORD_DEFAULT);"`
   (No PHP handy? Any online bcrypt generator works too, as long as it
   produces a standard `$2y$...` bcrypt hash — that's what PHP's
   `password_verify()` expects.)
2. phpMyAdmin → your database → `users` table → edit the `admin` row →
   paste that hash into `password_hash` → Go.
