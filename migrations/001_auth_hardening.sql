-- Run this once against an existing Ledgerstone database that was created
-- from schema.sql before the auth-hardening changes (login lockout +
-- forced first-login password change). A fresh install via the current
-- schema.sql doesn't need this — those columns are already in the table.

ALTER TABLE users
  ADD COLUMN failed_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN locked_until DATETIME NULL,
  ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0;

-- Force the seeded admin account (and anyone still on a password you set
-- for them without going through the app) to change it on next login.
UPDATE users SET must_change_password = 1 WHERE username = 'admin';
