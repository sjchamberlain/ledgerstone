-- Run this once against an existing Ledgerstone database (via phpMyAdmin's
-- SQL tab) to add real trust accounting: a per-owner/building trust cash
-- ledger segregated from a separate security-deposit sub-ledger, vendor/
-- invoice/approval fields on maintenance, reserve + approval-threshold
-- settings per building, generated/frozen owner statements, and an
-- owner-transfer audit trail. A fresh install via the current schema.sql
-- already has all of this — skip this file for a brand-new database.
--
-- BACK UP YOUR DATABASE FIRST (phpMyAdmin → Export → Quick → Go). This
-- migration replaces owner_ledger with trust_transactions and drops the
-- old table after migrating its rows.

-- ---------------------------------------------------------------
-- Buildings: reserve (minimum balance to hold back each statement cycle)
-- and the $ threshold above which a repair needs owner approval. A NULL
-- threshold means no approval gate is configured for that building yet
-- (repairs are recorded as auto-approved).
-- ---------------------------------------------------------------
ALTER TABLE buildings
  ADD COLUMN reserve_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN maintenance_approval_threshold DECIMAL(10,2) NULL;

-- ---------------------------------------------------------------
-- Maintenance: vendor + invoice tracking, and an approval workflow that
-- an owner login can act on (through a single narrow write action, not
-- general write access — enforced in api.php, not just hidden in the UI).
-- ---------------------------------------------------------------
ALTER TABLE maintenance
  ADD COLUMN vendor_id INT NULL,
  ADD COLUMN invoice_number VARCHAR(100) NULL,
  ADD COLUMN invoice_date DATE NULL,
  ADD COLUMN approval_status ENUM('auto_approved','pending','approved','denied') NOT NULL DEFAULT 'auto_approved',
  ADD COLUMN approved_by INT NULL,
  ADD COLUMN approved_at DATETIME NULL,
  ADD FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL,
  ADD FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------
-- Tenant ledger: payment method, and an optional link from a payment row
-- to the charge it satisfies (lets a statement/report show "date paid"
-- and "amount paid" against a specific charge, not just a running total).
-- ---------------------------------------------------------------
ALTER TABLE ledger
  ADD COLUMN payment_method ENUM('cash','check','ach','card','online','other') NULL,
  ADD COLUMN charge_id INT NULL,
  ADD FOREIGN KEY (charge_id) REFERENCES ledger(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------
-- TRUST_TRANSACTIONS — the owner's cash trust balance per building,
-- independent of the pooled bank account: proves each owner's portion of
-- pooled trust funds without commingling. Every row that moves cash into
-- or out of an owner's trust position (rent collected on their behalf,
-- the management fee, repair costs, a disbursement, an ownership
-- transfer, or a manual correction) lands here. running_balance is
-- recomputed by the app on every insert/delete for that owner+building
-- pair, in date/id order, rather than trusted as a stored delta — cheap
-- at this data volume and impossible to drift out of sync.
--
-- Security deposits are deliberately NOT tracked here — see
-- security_deposits below. Amount is always stored as a positive
-- magnitude except for 'adjustment', which can be negative; direction
-- for every other type is implied by `type`.
-- ---------------------------------------------------------------
CREATE TABLE trust_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner_id INT NOT NULL,
  building_id INT NOT NULL,
  type ENUM('income','fee','expense','disbursement','transfer_in','transfer_out','adjustment') NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'other',
  date DATE NOT NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  running_balance DECIMAL(10,2) NOT NULL DEFAULT 0,
  memo VARCHAR(255),
  related_ledger_id INT NULL,
  related_maintenance_id INT NULL,
  related_transfer_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE,
  FOREIGN KEY (related_ledger_id) REFERENCES ledger(id) ON DELETE CASCADE,
  FOREIGN KEY (related_maintenance_id) REFERENCES maintenance(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- SECURITY_DEPOSITS — the segregated deposit sub-ledger: tied to unit +
-- tenant + lease, never mixed into trust_transactions. Deliberately
-- keyed to building_id rather than owner_id, so a deposit automatically
-- stays attached to the building (and therefore survives a sale) without
-- any special-cased transfer step — see owner_transfers below, which
-- only ever moves the *trust cash* balance, not deposits.
-- ---------------------------------------------------------------
CREATE TABLE security_deposits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lease_id INT NOT NULL,
  unit_id INT NOT NULL,
  tenant_id INT NOT NULL,
  building_id INT NOT NULL,
  amount_held DECIMAL(10,2) NOT NULL DEFAULT 0,
  date_received DATE NOT NULL,
  status ENUM('held','partially_refunded','refunded','applied') NOT NULL DEFAULT 'held',
  notes TEXT,
  FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE,
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE security_deposit_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  security_deposit_id INT NOT NULL,
  date DATE NOT NULL,
  type ENUM('receipt','refund','deduction') NOT NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  memo VARCHAR(255),
  related_ledger_id INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (security_deposit_id) REFERENCES security_deposits(id) ON DELETE CASCADE,
  FOREIGN KEY (related_ledger_id) REFERENCES ledger(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- OWNER_STATEMENTS — a frozen snapshot per owner/building/period, not a
-- live recomputation: reopening a statement from three months ago always
-- shows exactly what was generated (and disbursed) then, even if ledger
-- entries are edited later. line_items holds the itemized breakdown
-- (unit-by-unit rent due/collected, itemized repairs, etc.) as JSON.
-- ---------------------------------------------------------------
CREATE TABLE owner_statements (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner_id INT NOT NULL,
  building_id INT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  rent_due DECIMAL(10,2) NOT NULL DEFAULT 0,
  rent_collected DECIMAL(10,2) NOT NULL DEFAULT 0,
  late_fees_collected DECIMAL(10,2) NOT NULL DEFAULT 0,
  other_income DECIMAL(10,2) NOT NULL DEFAULT 0,
  management_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
  repairs_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  other_expenses DECIMAL(10,2) NOT NULL DEFAULT 0,
  reserve_held DECIMAL(10,2) NOT NULL DEFAULT 0,
  amount_disbursed DECIMAL(10,2) NOT NULL DEFAULT 0,
  ending_trust_balance DECIMAL(10,2) NOT NULL DEFAULT 0,
  line_items JSON NOT NULL,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  generated_by INT NULL,
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE,
  FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uniq_owner_building_period (owner_id, building_id, period_start, period_end)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- OWNER_TRANSFERS — the audit trail for a building sale: who it moved
-- from/to, when, and exactly how much trust cash and how many/much in
-- security deposits were on record at that moment. Deposits themselves
-- don't move (see security_deposits above) — this row is the disclosure
-- record proving what the incoming owner assumed responsibility for.
-- ---------------------------------------------------------------
CREATE TABLE owner_transfers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  building_id INT NOT NULL,
  from_owner_id INT NOT NULL,
  to_owner_id INT NOT NULL,
  transfer_date DATE NOT NULL,
  ownership_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  trust_balance_transferred DECIMAL(10,2) NOT NULL DEFAULT 0,
  deposits_transferred_count INT NOT NULL DEFAULT 0,
  deposits_transferred_total DECIMAL(10,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE,
  FOREIGN KEY (from_owner_id) REFERENCES owners(id) ON DELETE CASCADE,
  FOREIGN KEY (to_owner_id) REFERENCES owners(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

ALTER TABLE trust_transactions
  ADD FOREIGN KEY (related_transfer_id) REFERENCES owner_transfers(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------
-- Backfill trust_transactions from the old owner_ledger, then drop it.
-- Old 'charge' rows (management fee, billed postage) become type='fee';
-- old 'payment' rows (an owner paying money into the business) become
-- type='adjustment' with a negative-of-fee-sign amount, since there's no
-- reliable way to guess whether a given historical payment was rent
-- income, a disbursement reversal, or something else — flagged in the
-- memo so it's easy to find and reclassify by hand if it matters.
-- running_balance is computed per (owner_id, building_id) in date/id order.
-- ---------------------------------------------------------------
INSERT INTO trust_transactions (owner_id, building_id, type, category, date, amount, running_balance, memo)
SELECT
  owner_id, building_id,
  IF(type = 'charge', 'fee', 'adjustment') AS type,
  IF(type = 'charge', 'management_fee', 'other') AS category,
  date,
  amount,
  0,
  IF(type = 'payment', CONCAT('[migrated from owner_ledger, uncategorized] ', COALESCE(memo, '')), memo)
FROM owner_ledger
ORDER BY owner_id, building_id, date, id;

-- Recompute running_balance per (owner_id, building_id), oldest first.
-- MySQL doesn't allow ORDER BY on a multi-table UPDATE ... JOIN — the
-- ordering has to happen inside the joined subquery instead, computing
-- each row's balance there before it's written back by id.
SET @rb := 0, @ob := NULL, @bb := NULL;
UPDATE trust_transactions t
JOIN (
  SELECT
    id,
    (@rb := IF(@ob = owner_id AND @bb = building_id, @rb, 0)
      + IF(type IN ('income','transfer_in'), amount,
          IF(type = 'adjustment', amount, -amount))) AS new_balance,
    @ob := owner_id,
    @bb := building_id
  FROM trust_transactions
  ORDER BY owner_id, building_id, date, id
) AS calc ON calc.id = t.id
SET t.running_balance = calc.new_balance;

DROP TABLE owner_ledger;

-- ---------------------------------------------------------------
-- Backfill security_deposits from existing leases that show a deposit
-- amount, so pre-existing deposits are represented in the segregated
-- sub-ledger too. date_received defaults to the lease start date, the
-- closest available fact — correct it by hand afterward if you have the
-- real receipt date on file.
-- ---------------------------------------------------------------
INSERT INTO security_deposits (lease_id, unit_id, tenant_id, building_id, amount_held, date_received, status)
SELECT l.id, l.unit_id, l.tenant_id, u.building_id, l.deposit_amount, l.start_date, 'held'
FROM leases l
JOIN units u ON u.id = l.unit_id
WHERE l.deposit_amount > 0;

INSERT INTO security_deposit_transactions (security_deposit_id, date, type, amount, memo)
SELECT id, date_received, 'receipt', amount_held, 'Migrated from leases.deposit_amount'
FROM security_deposits;
