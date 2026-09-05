-- Ledgerstone property management schema
-- Import this via cPanel's phpMyAdmin (or `mysql -u user -p dbname < schema.sql`)

SET NAMES utf8mb4;

CREATE TABLE owners (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150),
  phone VARCHAR(50),
  mailing_address TEXT NULL   -- used as the return/to address on printed mail
) ENGINE=InnoDB;

CREATE TABLE buildings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  address VARCHAR(255),
  fee_type ENUM('percent','flat') NOT NULL DEFAULT 'percent',
  fee_value DECIMAL(10,2) NOT NULL DEFAULT 0,
  roof_last_serviced DATE NULL,
  roof_notes TEXT NULL,
  electrical_load VARCHAR(100) NULL,      -- e.g. "200A 3-phase"
  exterior_paint_color VARCHAR(150) NULL, -- brand + code, e.g. "SW 7006 Extra White"
  profile_notes TEXT NULL,
  reserve_amount DECIMAL(10,2) NOT NULL DEFAULT 0,          -- minimum trust balance to hold back each statement cycle
  maintenance_approval_threshold DECIMAL(10,2) NULL         -- repairs at/under this $ amount are auto-approved; NULL = no gate configured
) ENGINE=InnoDB;

CREATE TABLE building_owners (
  id INT AUTO_INCREMENT PRIMARY KEY,
  building_id INT NOT NULL,
  owner_id INT NOT NULL,
  pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE units (
  id INT AUTO_INCREMENT PRIMARY KEY,
  building_id INT NOT NULL,
  number VARCHAR(50) NOT NULL,
  beds DECIMAL(3,1) DEFAULT 1,
  baths DECIMAL(3,1) DEFAULT 1,
  sqft INT,
  notes TEXT,
  wall_color VARCHAR(100) NULL,
  faceplate_color VARCHAR(100) NULL,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE appliances (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unit_id INT NOT NULL,
  type VARCHAR(100) NOT NULL,       -- e.g. Stove, Refrigerator, Washer, Dryer, Water Heater, HVAC
  make VARCHAR(100),
  model VARCHAR(100),
  serial_number VARCHAR(100),
  install_date DATE NULL,           -- basis for computing age
  notes TEXT,
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE rooms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unit_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,        -- e.g. Living Room, Bedroom 1, Kitchen
  length_in DECIMAL(6,2) NULL,       -- room dimensions, inches
  width_in DECIMAL(6,2) NULL,
  paint_color VARCHAR(150) NULL,     -- overrides the unit's wall_color for this room, when it differs
  notes TEXT,
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE room_openings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  type ENUM('door','window') NOT NULL,
  label VARCHAR(100) NULL,           -- e.g. "Closet door", "North window"
  width_in DECIMAL(6,2) NULL,
  height_in DECIMAL(6,2) NULL,
  notes TEXT,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE tenants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150),
  phone VARCHAR(50)
) ENGINE=InnoDB;

CREATE TABLE vendors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  trade VARCHAR(100),
  email VARCHAR(150),
  phone VARCHAR(50),
  address VARCHAR(255) NULL,  -- mailing address, for printed envelopes/letters
  notes TEXT
) ENGINE=InnoDB;

CREATE TABLE leases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unit_id INT NOT NULL,
  tenant_id INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  rent_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  deposit_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  billing_day INT NOT NULL DEFAULT 1,
  status ENUM('active','ended') NOT NULL DEFAULT 'active',
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE ledger (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lease_id INT NOT NULL,
  date DATE NOT NULL,
  type ENUM('charge','payment') NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'rent',
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  memo VARCHAR(255),
  payment_method ENUM('cash','check','ach','card','online','other') NULL,
  charge_id INT NULL,  -- for a payment row, the charge it satisfies (optional)
  FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE,
  FOREIGN KEY (charge_id) REFERENCES ledger(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE maintenance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  building_id INT NULL,
  unit_id INT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  priority ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  status ENUM('open','in_progress','completed') NOT NULL DEFAULT 'open',
  date_reported DATE NOT NULL,
  date_completed DATE NULL,
  cost DECIMAL(10,2) DEFAULT 0,
  notes TEXT,
  vendor_id INT NULL,
  invoice_number VARCHAR(100) NULL,
  invoice_date DATE NULL,
  approval_status ENUM('auto_approved','pending','approved','denied') NOT NULL DEFAULT 'auto_approved',
  approved_by INT NULL,  -- FK to users(id) added below, once users exists
  approved_at DATETIME NULL,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE SET NULL,
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL,
  FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Owner's cash trust balance per building, independent of the pooled bank
-- balance — proves each owner's share of pooled trust funds without
-- commingling. Security deposits are deliberately excluded (see
-- security_deposits below); running_balance is recomputed by the app on
-- every write for that owner+building pair, in date/id order.
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

-- Security-deposit sub-ledger: tied to unit + tenant + lease, never mixed
-- into trust_transactions. Keyed to building_id (not owner_id) so a
-- deposit stays attached to the building — and therefore automatically
-- survives a sale — without a transfer step; see owner_transfers.
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

-- A frozen snapshot per owner/building/period, not a live recomputation —
-- reopening a statement later shows exactly what was generated (and
-- disbursed) at the time, even if ledger entries are edited afterward.
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
  generated_by INT NULL,  -- FK to users(id) added below, once users exists
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_owner_building_period (owner_id, building_id, period_start, period_end)
) ENGINE=InnoDB;

-- Audit trail for a building sale: how much trust cash and how many/much
-- in security deposits were on record at the moment ownership moved.
-- Deposits themselves don't move (they're already keyed to building_id) —
-- this is the disclosure record proving what the incoming owner assumed.
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
  created_by INT NULL,  -- FK to users(id) added below, once users exists
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE,
  FOREIGN KEY (from_owner_id) REFERENCES owners(id) ON DELETE CASCADE,
  FOREIGN KEY (to_owner_id) REFERENCES owners(id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE trust_transactions
  ADD FOREIGN KEY (related_transfer_id) REFERENCES owner_transfers(id) ON DELETE SET NULL;

CREATE TABLE communications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner_id INT NOT NULL,
  building_id INT NULL,
  date DATE NOT NULL,
  method ENUM('call','email','text','in_person','letter') NOT NULL DEFAULT 'call',
  subject VARCHAR(200),
  notes TEXT,
  follow_up_date DATE NULL,
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE tenant_communications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  lease_id INT NULL,
  date DATE NOT NULL,
  method ENUM('call','email','text','in_person','letter') NOT NULL DEFAULT 'call',
  subject VARCHAR(200),
  notes TEXT,
  follow_up_date DATE NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','owner') NOT NULL DEFAULT 'owner',
  owner_id INT NULL,               -- set only when role = 'owner'; links the login to an owners row
  display_name VARCHAR(150),
  email VARCHAR(150),
  hourly_rate DECIMAL(8,2) NULL,   -- default $/hr for this user's time entries; blank = no default
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,      -- login/password-change lockout; NULL = not locked
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Deferred FKs to users(id), from tables created earlier in this file
-- (before `users` existed to reference).
ALTER TABLE maintenance ADD FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE owner_statements ADD FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE owner_transfers ADD FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE time_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  building_id INT NOT NULL,
  unit_id INT NULL,
  user_id INT NULL,
  date DATE NOT NULL,
  activity ENUM('admin','leasing','turnover','repairs','maintenance','other') NOT NULL DEFAULT 'other',
  hours DECIMAL(5,2) NOT NULL DEFAULT 0,
  rate DECIMAL(8,2) NOT NULL DEFAULT 0, -- $/hr at time of entry, independent of the user's current default
  description VARCHAR(255),
  notes TEXT,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE,
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE stamp_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  date DATE NOT NULL,
  building_id INT NULL,      -- which building's mail this postage covers, when known
  owner_id INT NULL,         -- which owner to bill this postage to, when known
  quantity INT NOT NULL DEFAULT 1,
  purpose VARCHAR(255) NULL, -- e.g. "Envelope to Jane Smith" or "Letter — late rent notice"
  billed TINYINT(1) NOT NULL DEFAULT 0,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Seed one admin account so you can log in the first time.
-- Username: admin   Password: changeme123
-- must_change_password forces a new password to be set before the app is
-- usable, so this default credential can't linger unnoticed.
INSERT INTO users (username, password_hash, role, display_name, must_change_password)
VALUES ('admin', '$2y$10$Btj9rhTnC5TVe52xAHgVg.N12jKNxDtIPMH84/76AVHgKDAYx6Zby', 'admin', 'Admin', 1);
