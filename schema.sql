-- Ledgerstone property management schema
-- Import this via cPanel's phpMyAdmin (or `mysql -u user -p dbname < schema.sql`)

SET NAMES utf8mb4;

CREATE TABLE owners (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150),
  phone VARCHAR(50)
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
  profile_notes TEXT NULL
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
  FOREIGN KEY (lease_id) REFERENCES leases(id) ON DELETE CASCADE
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
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE SET NULL,
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE owner_ledger (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner_id INT NOT NULL,
  building_id INT NOT NULL,
  date DATE NOT NULL,
  type ENUM('charge','payment') NOT NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  memo VARCHAR(255),
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE CASCADE,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE
) ENGINE=InnoDB;

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

-- Seed one admin account so you can log in the first time.
-- Username: admin   Password: changeme123
-- must_change_password forces a new password to be set before the app is
-- usable, so this default credential can't linger unnoticed.
INSERT INTO users (username, password_hash, role, display_name, must_change_password)
VALUES ('admin', '$2y$10$Btj9rhTnC5TVe52xAHgVg.N12jKNxDtIPMH84/76AVHgKDAYx6Zby', 'admin', 'Admin', 1);
