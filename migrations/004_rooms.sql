-- Run this once against an existing Ledgerstone database (via phpMyAdmin's
-- SQL tab) to add per-room inventory: room dimensions, paint color, and a
-- door/window measurement list per room. A fresh install via the current
-- schema.sql already has this — skip this file for a brand-new database.

CREATE TABLE rooms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unit_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  length_in DECIMAL(6,2) NULL,
  width_in DECIMAL(6,2) NULL,
  paint_color VARCHAR(150) NULL,
  notes TEXT,
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE room_openings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  type ENUM('door','window') NOT NULL,
  label VARCHAR(100) NULL,
  width_in DECIMAL(6,2) NULL,
  height_in DECIMAL(6,2) NULL,
  notes TEXT,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
) ENGINE=InnoDB;
