# Ledgerstone — cPanel setup

A property management app: buildings, units, owners, tenants, leases, a
tenant ledger with aging, maintenance tracking, owner billing, a
communications log, building/unit profiles with a per-unit appliance list,
and a staff timecard tool for tracking labor by activity and building/unit.
Two account types: **staff** (full access) and **owner** (read-only,
scoped to the buildings they own).

Stack: PHP + MySQL. No Node, no build step, no Composer dependencies —
this is intentionally the simplest thing that works on ordinary shared
cPanel hosting.

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

## Building/unit profiles, appliances, and timecards

- **Properties** → a building's edit form now has roof/electrical/exterior
  paint fields. Click a unit's number (or its **Profile** button) to open
  its profile page: wall color, faceplate color, and a repeatable
  appliance list (type, make, model, serial #, install date — age is
  computed from that date).
- **Timecards** (staff only) logs hours against a building (and
  optionally a specific unit) under one of six activities (Administrative,
  Leasing, Turnover, Repairs, Maintenance, Other), each with an hourly
  rate captured on the entry itself. A default rate can be set per staff
  login in **Users**. The tab includes a profitability snapshot — rent
  collected vs. labor cost for a building over a date range.
- **Reports → Owner statement** is now a full monthly-statement view per
  building: occupied/vacant units, income, outstanding arrears, open
  maintenance count, repairs completed in the period (with cost), the
  projected annual rent roll, and net to owner after the management fee.
  Run it monthly and use **Print** (or your browser's "Save as PDF") to
  send it to the owner — there's no automated email sender built in yet,
  since this app has no mail server configuration.

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
