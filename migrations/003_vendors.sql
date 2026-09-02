-- Run this once against an existing Ledgerstone database (via phpMyAdmin's
-- SQL tab) to add the Vendors directory. A fresh install via the current
-- schema.sql already has this table — skip this file for a brand-new
-- database.

CREATE TABLE vendors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  trade VARCHAR(100),
  email VARCHAR(150),
  phone VARCHAR(50),
  notes TEXT
) ENGINE=InnoDB;
