<?php
declare(strict_types=1);

/**
 * Creates a rent "charge" ledger entry for every active lease whose
 * billing day matches $today, unless one already exists for that lease
 * on that date (so it's safe to run more than once on the same day, e.g.
 * a cron retry after a transient DB error).
 *
 * A billing_day past the end of a short month (e.g. 31 in a 30-day month,
 * or 30/31 in February) is billed on that month's last day instead.
 *
 * Returns the ids of the leases a charge was created for.
 */
function pm_generate_due_rent(PDO $pdo, ?string $today = null): array {
  $today = $today ?: date('Y-m-d');
  $todayDay = (int)date('j', strtotime($today));
  $daysInMonth = (int)date('t', strtotime($today));

  $stmt = $pdo->query("SELECT id, rent_amount, start_date, end_date, billing_day FROM leases WHERE status = 'active'");
  $leases = $stmt->fetchAll();

  $dupCheck = $pdo->prepare(
    "SELECT COUNT(*) AS c FROM ledger WHERE lease_id = ? AND type = 'charge' AND category = 'rent' AND date = ?"
  );
  $insert = $pdo->prepare(
    "INSERT INTO ledger (lease_id, date, type, category, amount, memo) VALUES (?, ?, 'charge', 'rent', ?, 'Rent due')"
  );

  $createdLeaseIds = [];
  foreach ($leases as $lease) {
    $billingDay = (int)$lease['billing_day'];
    $effectiveDay = min($billingDay > 0 ? $billingDay : 1, $daysInMonth);
    if ($effectiveDay !== $todayDay) continue;
    if ($lease['start_date'] > $today) continue;
    if ($lease['end_date'] !== null && $lease['end_date'] < $today) continue;

    $dupCheck->execute([$lease['id'], $today]);
    if ((int)$dupCheck->fetch()['c'] > 0) continue;

    $insert->execute([$lease['id'], $today, $lease['rent_amount']]);
    $createdLeaseIds[] = (int)$lease['id'];
  }

  return $createdLeaseIds;
}
