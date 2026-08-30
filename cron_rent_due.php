<?php
declare(strict_types=1);

// Run daily via cPanel Cron Jobs, e.g.:
//   php /home/CPANELUSER/public_html/pm/cron_rent_due.php
// CLI only — refuses to run over HTTP so it can't be triggered by a web
// request (it needs no login, since cron has no session to authenticate).
if (PHP_SAPI !== 'cli') {
  http_response_code(403);
  exit("This script is for cron use only.\n");
}

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/lib_rent.php';

$pdo = pm_db();
$createdLeaseIds = pm_generate_due_rent($pdo);

$count = count($createdLeaseIds);
echo date('Y-m-d H:i:s') . " — rent due check: created {$count} charge(s)"
  . ($count ? ' for lease id(s) ' . implode(', ', $createdLeaseIds) : '') . ".\n";
