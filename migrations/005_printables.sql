-- Run this once against an existing Ledgerstone database (via phpMyAdmin's
-- SQL tab) to add the Printables feature: envelope/letter mailing addresses
-- and a stamp-usage log that can be billed to an owner. A fresh install via
-- the current schema.sql already has all of this — skip this file for a
-- brand-new database.

ALTER TABLE owners
  ADD COLUMN mailing_address TEXT NULL;

ALTER TABLE vendors
  ADD COLUMN address VARCHAR(255) NULL;

CREATE TABLE stamp_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  date DATE NOT NULL,
  building_id INT NULL,
  owner_id INT NULL,
  quantity INT NOT NULL DEFAULT 1,
  purpose VARCHAR(255) NULL,
  billed TINYINT(1) NOT NULL DEFAULT 0,
  FOREIGN KEY (building_id) REFERENCES buildings(id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE SET NULL
) ENGINE=InnoDB;
