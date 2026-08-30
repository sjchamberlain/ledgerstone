<?php
declare(strict_types=1);

function pm_config(): array {
  static $cfg = null;
  if ($cfg === null) {
    $path = __DIR__ . '/config.php';
    if (!file_exists($path)) {
      http_response_code(500);
      die('config.php is missing. Copy config.sample.php to config.php and fill in your database details.');
    }
    $cfg = require $path;
  }
  return $cfg;
}

function pm_db(): PDO {
  static $pdo = null;
  if ($pdo === null) {
    $cfg = pm_config();
    $dsn = "mysql:host={$cfg['db_host']};dbname={$cfg['db_name']};charset=utf8mb4";
    try {
      $pdo = new PDO($dsn, $cfg['db_user'], $cfg['db_pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
      ]);
    } catch (PDOException $e) {
      http_response_code(500);
      die('Database connection failed. Check config.php against cPanel > MySQL Databases.');
    }
  }
  return $pdo;
}
