-- Run this once against an existing Ledgerstone database (via phpMyAdmin's
-- SQL tab) to pick up: building & unit profile fields, a per-unit appliance
-- list, and time tracking. A fresh install via the current schema.sql
-- already has all of this — skip this file for a brand-new database.
-- The owner statement enhancements reuse existing tables/columns, so
-- nothing schema-side is needed for those.

ALTER TABLE buildings
  ADD COLUMN roof_last_serviced DATE NULL,
  ADD COLUMN roof_notes TEXT NULL,
  ADD COLUMN electrical_load VARCHAR(100) NULL,
  ADD COLUMN exterior_paint_color VARCHAR(150) NULL,
  ADD COLUMN profile_notes TEXT NULL;

ALTER TABLE units
  ADD COLUMN wall_color VARCHAR(100) NULL,
  ADD COLUMN faceplate_color VARCHAR(100) NULL;

CREATE TABLE appliances (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unit_id INT NOT NULL,
  type VARCHAR(100) NOT NULL,
  make VARCHAR(100),
  model VARCHAR(100),
  serial_number VARCHAR(100),
  install_date DATE NULL,
  notes TEXT,
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE users
  ADD COLUMN hourly_rate DECIMAL(8,2) NULL;

CREATE TABLE time_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  building_id INT NOT NULL,
  unit_id INT NULL,
  user_id INT NULL,
  date DATE NOT NULL,
  activity ENUM('admin','leasing','turnover','repairs','maintenance','other') NOT NULL DEFAULT 'other',
  hours DECIMAL(5,2) NOT NULL DEFAULT 0,
  rate DECIMAL(8,2) NOT NULL DEFAULT 0,
  description VARCHAR(255),
  notes TEXT,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE CASCADE,
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
