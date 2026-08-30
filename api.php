<?php
declare(strict_types=1);
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/lib_rent.php';

header('Content-Type: application/json');
$user = pm_require_login();
$pdo = pm_db();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? ($_POST['action'] ?? '');

try {
  if ($method === 'GET' && $action === 'getAll') {
    echo json_encode(pm_get_all($pdo, $user));
    exit;
  }

  if ($method === 'GET' && $action === 'version') {
    echo json_encode(['version' => pm_app_version()]);
    exit;
  }

  if ($method === 'GET' && $action === 'getUsers') {
    pm_require_admin();
    $stmt = $pdo->query('SELECT id, username, role, owner_id, display_name, email FROM users ORDER BY username');
    $rows = array_map(fn($r) => [
      'id' => (int)$r['id'], 'username' => $r['username'], 'role' => $r['role'],
      'ownerId' => $r['owner_id'] !== null ? (int)$r['owner_id'] : null,
      'displayName' => $r['display_name'], 'email' => $r['email'],
    ], $stmt->fetchAll());
    echo json_encode(['users' => $rows]);
    exit;
  }

  if ($method === 'POST') {
    pm_check_csrf();
    $body = json_decode(file_get_contents('php://input'), true) ?: [];

    if ($action === 'save') {
      pm_require_admin();
      $entity = $body['entity'] ?? '';
      $record = $body['record'] ?? [];
      $id = pm_save_entity($pdo, $entity, $record);
      echo json_encode(['ok' => true, 'id' => $id]);
      exit;
    }

    if ($action === 'delete') {
      pm_require_admin();
      $entity = $body['entity'] ?? '';
      $id = (int)($body['id'] ?? 0);
      pm_delete_entity($pdo, $entity, $id);
      echo json_encode(['ok' => true]);
      exit;
    }

    if ($action === 'generateFee') {
      pm_require_admin();
      $result = pm_generate_fee($pdo, (int)$body['buildingId'], (string)$body['month']);
      echo json_encode($result);
      exit;
    }

    if ($action === 'generateRentDue') {
      pm_require_admin();
      $createdLeaseIds = pm_generate_due_rent($pdo);
      $count = count($createdLeaseIds);
      echo json_encode([
        'ok' => true,
        'message' => $count
          ? "Created {$count} rent charge(s) for today."
          : 'No leases are due today (or today\'s rent charge already exists).',
      ]);
      exit;
    }

    if ($action === 'changePassword') {
      $current = (string)($body['current'] ?? '');
      $new = (string)($body['new'] ?? '');
      $result = pm_change_password($pdo, $user, $current, $new);
      echo json_encode($result);
      exit;
    }

    if ($action === 'saveUser') {
      pm_require_admin();
      $result = pm_save_user($pdo, $body);
      echo json_encode($result);
      exit;
    }

    if ($action === 'deleteUser') {
      pm_require_admin();
      $id = (int)($body['id'] ?? 0);
      if ($id === $user['id']) { throw new PmUserError("You can't delete your own account while logged in as it."); }
      $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
      echo json_encode(['ok' => true]);
      exit;
    }
  }

  http_response_code(400);
  echo json_encode(['error' => 'Unknown action']);
} catch (PmUserError $e) {
  http_response_code(400);
  echo json_encode(['error' => $e->getMessage()]);
} catch (Throwable $e) {
  error_log('[Ledgerstone api.php] ' . $e->getMessage());
  http_response_code(500);
  echo json_encode(['error' => 'An unexpected error occurred. Please try again or contact support.']);
}

/* =========================================================
   DEPLOYED VERSION — lets the frontend notice a new deploy and prompt a
   reload, since tabs left open across a cPanel Git deploy would otherwise
   silently keep running the old app.js against the new api.php.
   Derived from file mtimes rather than a hand-maintained version number,
   so it updates itself on every deploy with nothing to remember to bump.
   ========================================================= */
function pm_app_version(): string {
  $files = [__DIR__ . '/assets/app.js', __DIR__ . '/api.php', __DIR__ . '/index.php'];
  $latest = 0;
  foreach ($files as $f) {
    $latest = max($latest, @filemtime($f) ?: 0);
  }
  return (string)$latest;
}

/* =========================================================
   READ: full dataset, scoped by role
   ========================================================= */
function pm_get_all(PDO $pdo, array $user): array {
  $isAdmin = $user['role'] === 'admin';

  if ($isAdmin) {
    $buildingIds = null; // null = no filter
  } else {
    $stmt = $pdo->prepare('SELECT building_id FROM building_owners WHERE owner_id = ?');
    $stmt->execute([$user['owner_id']]);
    $buildingIds = array_map('intval', array_column($stmt->fetchAll(), 'building_id'));
  }

  $buildings = pm_fetch_buildings($pdo, $buildingIds);
  $buildingIdList = array_column($buildings, 'id');

  $unitRows = pm_fetch_units($pdo, $buildingIdList, $isAdmin);
  $unitIdList = array_column($unitRows, 'id');

  $leaseRows = pm_fetch_leases($pdo, $unitIdList, $isAdmin);
  $leaseIdList = array_column($leaseRows, 'id');

  $tenantIds = array_values(array_unique(array_column($leaseRows, 'tenantId')));
  $tenants = pm_fetch_tenants($pdo, $tenantIds, $isAdmin);

  $ledgerRows = pm_fetch_ledger($pdo, $leaseIdList, $isAdmin);
  $maintRows = pm_fetch_maintenance($pdo, $buildingIdList, $unitIdList, $isAdmin);

  if ($isAdmin) {
    $ownerRows = pm_fetch_owners($pdo, null);
    $ownerLedgerRows = pm_fetch_owner_ledger($pdo, null, null);
    $commRows = pm_fetch_communications($pdo, null);
    $tenantCommRows = pm_fetch_tenant_communications($pdo, null);
  } else {
    // owners visible = anyone who co-owns a building this user can see
    $stmt = $pdo->prepare('SELECT DISTINCT owner_id FROM building_owners WHERE building_id IN (' . pm_in_clause($buildingIdList) . ')');
    $stmt->execute($buildingIdList ?: [0]);
    $visibleOwnerIds = array_map('intval', array_column($stmt->fetchAll(), 'owner_id'));
    $ownerRows = pm_fetch_owners($pdo, $visibleOwnerIds ?: [0]);
    $ownerLedgerRows = pm_fetch_owner_ledger($pdo, [$user['owner_id']], null);
    $commRows = pm_fetch_communications($pdo, [$user['owner_id']]);
    $tenantCommRows = pm_fetch_tenant_communications($pdo, $leaseIdList ?: [0]);
  }

  return [
    'currentUser' => [
      'id' => $user['id'], 'username' => $user['username'], 'role' => $user['role'],
      'displayName' => $user['display_name'], 'ownerId' => $user['owner_id'],
      'mustChangePassword' => !empty($user['must_change_password']),
    ],
    'appVersion' => pm_app_version(),
    'csrfToken' => pm_csrf_token(),
    'buildings' => $buildings,
    'units' => $unitRows,
    'owners' => $ownerRows,
    'tenants' => $tenants,
    'leases' => $leaseRows,
    'ledger' => $ledgerRows,
    'maintenance' => $maintRows,
    'ownerLedger' => $ownerLedgerRows,
    'communications' => $commRows,
    'tenantCommunications' => $tenantCommRows,
  ];
}

function pm_in_clause(?array $ids): string {
  if ($ids === null) return '1=1';
  if (count($ids) === 0) return '0=1';
  return implode(',', array_fill(0, count($ids), '?'));
}

function pm_fetch_buildings(PDO $pdo, ?array $buildingIds): array {
  $sql = 'SELECT * FROM buildings';
  $params = [];
  if ($buildingIds !== null) {
    $sql .= ' WHERE id IN (' . pm_in_clause($buildingIds) . ')';
    $params = $buildingIds ?: [0];
  }
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  $rows = $stmt->fetchAll();

  $ownerStmt = $pdo->prepare('SELECT owner_id, pct FROM building_owners WHERE building_id = ?');
  $out = [];
  foreach ($rows as $r) {
    $ownerStmt->execute([$r['id']]);
    $owners = array_map(fn($o) => ['ownerId' => (int)$o['owner_id'], 'pct' => (float)$o['pct']], $ownerStmt->fetchAll());
    $out[] = [
      'id' => (int)$r['id'], 'name' => $r['name'], 'address' => $r['address'],
      'feeType' => $r['fee_type'], 'feeValue' => (float)$r['fee_value'], 'owners' => $owners,
    ];
  }
  return $out;
}

function pm_fetch_units(PDO $pdo, array $buildingIds, bool $isAdmin): array {
  $sql = 'SELECT * FROM units';
  $params = [];
  if (!$isAdmin) {
    $sql .= ' WHERE building_id IN (' . pm_in_clause($buildingIds) . ')';
    $params = $buildingIds ?: [0];
  }
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  return array_map(fn($r) => [
    'id' => (int)$r['id'], 'buildingId' => (int)$r['building_id'], 'number' => $r['number'],
    'beds' => (float)$r['beds'], 'baths' => (float)$r['baths'], 'sqft' => $r['sqft'] !== null ? (int)$r['sqft'] : null,
    'notes' => $r['notes'],
  ], $stmt->fetchAll());
}

function pm_fetch_owners(PDO $pdo, ?array $ownerIds): array {
  $sql = 'SELECT * FROM owners';
  $params = [];
  if ($ownerIds !== null) {
    $sql .= ' WHERE id IN (' . pm_in_clause($ownerIds) . ')';
    $params = $ownerIds ?: [0];
  }
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  return array_map(fn($r) => ['id' => (int)$r['id'], 'name' => $r['name'], 'email' => $r['email'], 'phone' => $r['phone']], $stmt->fetchAll());
}

function pm_fetch_tenants(PDO $pdo, array $tenantIds, bool $isAdmin): array {
  $sql = 'SELECT * FROM tenants';
  $params = [];
  if (!$isAdmin) {
    $sql .= ' WHERE id IN (' . pm_in_clause($tenantIds) . ')';
    $params = $tenantIds ?: [0];
  }
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  return array_map(fn($r) => ['id' => (int)$r['id'], 'name' => $r['name'], 'email' => $r['email'], 'phone' => $r['phone']], $stmt->fetchAll());
}

function pm_fetch_leases(PDO $pdo, array $unitIds, bool $isAdmin): array {
  $sql = 'SELECT * FROM leases';
  $params = [];
  if (!$isAdmin) {
    $sql .= ' WHERE unit_id IN (' . pm_in_clause($unitIds) . ')';
    $params = $unitIds ?: [0];
  }
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  return array_map(fn($r) => [
    'id' => (int)$r['id'], 'unitId' => (int)$r['unit_id'], 'tenantId' => (int)$r['tenant_id'],
    'startDate' => $r['start_date'], 'endDate' => $r['end_date'], 'rentAmount' => (float)$r['rent_amount'],
    'depositAmount' => (float)$r['deposit_amount'], 'billingDay' => (int)$r['billing_day'], 'status' => $r['status'],
  ], $stmt->fetchAll());
}

function pm_fetch_ledger(PDO $pdo, array $leaseIds, bool $isAdmin): array {
  $sql = 'SELECT * FROM ledger';
  $params = [];
  if (!$isAdmin) {
    $sql .= ' WHERE lease_id IN (' . pm_in_clause($leaseIds) . ')';
    $params = $leaseIds ?: [0];
  }
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  return array_map(fn($r) => [
    'id' => (int)$r['id'], 'leaseId' => (int)$r['lease_id'], 'date' => $r['date'], 'type' => $r['type'],
    'category' => $r['category'], 'amount' => (float)$r['amount'], 'memo' => $r['memo'],
  ], $stmt->fetchAll());
}

function pm_fetch_maintenance(PDO $pdo, array $buildingIds, array $unitIds, bool $isAdmin): array {
  $sql = 'SELECT * FROM maintenance';
  $params = [];
  if (!$isAdmin) {
    $sql .= ' WHERE building_id IN (' . pm_in_clause($buildingIds) . ') OR unit_id IN (' . pm_in_clause($unitIds) . ')';
    $params = array_merge($buildingIds ?: [0], $unitIds ?: [0]);
  }
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  return array_map(fn($r) => [
    'id' => (int)$r['id'], 'buildingId' => $r['building_id'] !== null ? (int)$r['building_id'] : null,
    'unitId' => $r['unit_id'] !== null ? (int)$r['unit_id'] : null, 'title' => $r['title'],
    'description' => $r['description'], 'priority' => $r['priority'], 'status' => $r['status'],
    'dateReported' => $r['date_reported'], 'dateCompleted' => $r['date_completed'], 'cost' => (float)$r['cost'],
    'notes' => $r['notes'],
  ], $stmt->fetchAll());
}

function pm_fetch_owner_ledger(PDO $pdo, ?array $ownerIds, ?array $buildingIds): array {
  $sql = 'SELECT * FROM owner_ledger';
  $params = [];
  if ($ownerIds !== null) {
    $sql .= ' WHERE owner_id IN (' . pm_in_clause($ownerIds) . ')';
    $params = $ownerIds ?: [0];
  }
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  return array_map(fn($r) => [
    'id' => (int)$r['id'], 'ownerId' => (int)$r['owner_id'], 'buildingId' => (int)$r['building_id'],
    'date' => $r['date'], 'type' => $r['type'], 'amount' => (float)$r['amount'], 'memo' => $r['memo'],
  ], $stmt->fetchAll());
}

function pm_fetch_communications(PDO $pdo, ?array $ownerIds): array {
  $sql = 'SELECT * FROM communications';
  $params = [];
  if ($ownerIds !== null) {
    $sql .= ' WHERE owner_id IN (' . pm_in_clause($ownerIds) . ')';
    $params = $ownerIds ?: [0];
  }
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  return array_map(fn($r) => [
    'id' => (int)$r['id'], 'ownerId' => (int)$r['owner_id'], 'buildingId' => $r['building_id'] !== null ? (int)$r['building_id'] : null,
    'date' => $r['date'], 'method' => $r['method'], 'subject' => $r['subject'], 'notes' => $r['notes'],
    'followUpDate' => $r['follow_up_date'],
  ], $stmt->fetchAll());
}

function pm_fetch_tenant_communications(PDO $pdo, ?array $leaseIds): array {
  $sql = 'SELECT * FROM tenant_communications';
  $params = [];
  if ($leaseIds !== null) {
    // include entries with no lease_id only for admin (leaseIds === null); for owners, only ones tied to a visible lease
    $sql .= ' WHERE lease_id IN (' . pm_in_clause($leaseIds) . ')';
    $params = $leaseIds ?: [0];
  }
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  return array_map(fn($r) => [
    'id' => (int)$r['id'], 'tenantId' => (int)$r['tenant_id'], 'leaseId' => $r['lease_id'] !== null ? (int)$r['lease_id'] : null,
    'date' => $r['date'], 'method' => $r['method'], 'subject' => $r['subject'], 'notes' => $r['notes'],
    'followUpDate' => $r['follow_up_date'],
  ], $stmt->fetchAll());
}

/* =========================================================
   WRITE: admin-only save/delete
   ========================================================= */
function pm_save_entity(PDO $pdo, string $entity, array $r): int {
  switch ($entity) {
    case 'building': {
      $id = (int)($r['id'] ?? 0);
      if ($id) {
        $stmt = $pdo->prepare('UPDATE buildings SET name=?, address=?, fee_type=?, fee_value=? WHERE id=?');
        $stmt->execute([$r['name'], $r['address'], $r['feeType'], $r['feeValue'], $id]);
      } else {
        $stmt = $pdo->prepare('INSERT INTO buildings (name, address, fee_type, fee_value) VALUES (?,?,?,?)');
        $stmt->execute([$r['name'], $r['address'], $r['feeType'], $r['feeValue']]);
        $id = (int)$pdo->lastInsertId();
      }
      $pdo->prepare('DELETE FROM building_owners WHERE building_id = ?')->execute([$id]);
      $ins = $pdo->prepare('INSERT INTO building_owners (building_id, owner_id, pct) VALUES (?,?,?)');
      foreach (($r['owners'] ?? []) as $o) {
        if (!empty($o['ownerId'])) $ins->execute([$id, (int)$o['ownerId'], (float)($o['pct'] ?? 0)]);
      }
      return $id;
    }
    case 'unit': {
      $id = (int)($r['id'] ?? 0);
      $fields = [$r['buildingId'], $r['number'], $r['beds'], $r['baths'], $r['sqft'] ?: null, $r['notes'] ?? ''];
      if ($id) {
        $pdo->prepare('UPDATE units SET building_id=?, number=?, beds=?, baths=?, sqft=?, notes=? WHERE id=?')
          ->execute([...$fields, $id]);
      } else {
        $pdo->prepare('INSERT INTO units (building_id, number, beds, baths, sqft, notes) VALUES (?,?,?,?,?,?)')
          ->execute($fields);
        $id = (int)$pdo->lastInsertId();
      }
      return $id;
    }
    case 'owner': {
      $id = (int)($r['id'] ?? 0);
      $fields = [$r['name'], $r['email'] ?? '', $r['phone'] ?? ''];
      if ($id) {
        $pdo->prepare('UPDATE owners SET name=?, email=?, phone=? WHERE id=?')->execute([...$fields, $id]);
      } else {
        $pdo->prepare('INSERT INTO owners (name, email, phone) VALUES (?,?,?)')->execute($fields);
        $id = (int)$pdo->lastInsertId();
      }
      return $id;
    }
    case 'tenant': {
      $id = (int)($r['id'] ?? 0);
      $fields = [$r['name'], $r['email'] ?? '', $r['phone'] ?? ''];
      if ($id) {
        $pdo->prepare('UPDATE tenants SET name=?, email=?, phone=? WHERE id=?')->execute([...$fields, $id]);
      } else {
        $pdo->prepare('INSERT INTO tenants (name, email, phone) VALUES (?,?,?)')->execute($fields);
        $id = (int)$pdo->lastInsertId();
      }
      return $id;
    }
    case 'lease': {
      $id = (int)($r['id'] ?? 0);
      $fields = [$r['unitId'], $r['tenantId'], $r['startDate'], $r['endDate'] ?: null, $r['rentAmount'], $r['depositAmount'], $r['billingDay'], $r['status']];
      if ($id) {
        $pdo->prepare('UPDATE leases SET unit_id=?, tenant_id=?, start_date=?, end_date=?, rent_amount=?, deposit_amount=?, billing_day=?, status=? WHERE id=?')
          ->execute([...$fields, $id]);
      } else {
        $pdo->prepare('INSERT INTO leases (unit_id, tenant_id, start_date, end_date, rent_amount, deposit_amount, billing_day, status) VALUES (?,?,?,?,?,?,?,?)')
          ->execute($fields);
        $id = (int)$pdo->lastInsertId();
      }
      return $id;
    }
    case 'ledgerCharge':
    case 'ledgerPayment': {
      $id = (int)($r['id'] ?? 0);
      $type = $entity === 'ledgerCharge' ? 'charge' : 'payment';
      $fields = [$r['leaseId'], $r['date'], $type, $r['category'], $r['amount'], $r['memo'] ?? ''];
      if ($id) {
        $pdo->prepare('UPDATE ledger SET lease_id=?, date=?, type=?, category=?, amount=?, memo=? WHERE id=?')->execute([...$fields, $id]);
      } else {
        $pdo->prepare('INSERT INTO ledger (lease_id, date, type, category, amount, memo) VALUES (?,?,?,?,?,?)')->execute($fields);
        $id = (int)$pdo->lastInsertId();
      }
      return $id;
    }
    case 'maintenance': {
      $id = (int)($r['id'] ?? 0);
      $fields = [$r['buildingId'] ?: null, $r['unitId'] ?: null, $r['title'], $r['description'] ?? '', $r['priority'], $r['status'], $r['dateReported'], $r['dateCompleted'] ?: null, $r['cost'] ?: 0, $r['notes'] ?? ''];
      if ($id) {
        $pdo->prepare('UPDATE maintenance SET building_id=?, unit_id=?, title=?, description=?, priority=?, status=?, date_reported=?, date_completed=?, cost=?, notes=? WHERE id=?')
          ->execute([...$fields, $id]);
      } else {
        $pdo->prepare('INSERT INTO maintenance (building_id, unit_id, title, description, priority, status, date_reported, date_completed, cost, notes) VALUES (?,?,?,?,?,?,?,?,?,?)')
          ->execute($fields);
        $id = (int)$pdo->lastInsertId();
      }
      return $id;
    }
    case 'ownerLedger': {
      $id = (int)($r['id'] ?? 0);
      $fields = [$r['ownerId'], $r['buildingId'], $r['date'], $r['type'], $r['amount'], $r['memo'] ?? ''];
      if ($id) {
        $pdo->prepare('UPDATE owner_ledger SET owner_id=?, building_id=?, date=?, type=?, amount=?, memo=? WHERE id=?')->execute([...$fields, $id]);
      } else {
        $pdo->prepare('INSERT INTO owner_ledger (owner_id, building_id, date, type, amount, memo) VALUES (?,?,?,?,?,?)')->execute($fields);
        $id = (int)$pdo->lastInsertId();
      }
      return $id;
    }
    case 'communication': {
      $id = (int)($r['id'] ?? 0);
      $fields = [$r['ownerId'], $r['buildingId'] ?: null, $r['date'], $r['method'], $r['subject'] ?? '', $r['notes'] ?? '', $r['followUpDate'] ?: null];
      if ($id) {
        $pdo->prepare('UPDATE communications SET owner_id=?, building_id=?, date=?, method=?, subject=?, notes=?, follow_up_date=? WHERE id=?')->execute([...$fields, $id]);
      } else {
        $pdo->prepare('INSERT INTO communications (owner_id, building_id, date, method, subject, notes, follow_up_date) VALUES (?,?,?,?,?,?,?)')->execute($fields);
        $id = (int)$pdo->lastInsertId();
      }
      return $id;
    }
    case 'tenantComm': {
      $id = (int)($r['id'] ?? 0);
      $fields = [$r['tenantId'], $r['leaseId'] ?: null, $r['date'], $r['method'], $r['subject'] ?? '', $r['notes'] ?? '', $r['followUpDate'] ?: null];
      if ($id) {
        $pdo->prepare('UPDATE tenant_communications SET tenant_id=?, lease_id=?, date=?, method=?, subject=?, notes=?, follow_up_date=? WHERE id=?')->execute([...$fields, $id]);
      } else {
        $pdo->prepare('INSERT INTO tenant_communications (tenant_id, lease_id, date, method, subject, notes, follow_up_date) VALUES (?,?,?,?,?,?,?)')->execute($fields);
        $id = (int)$pdo->lastInsertId();
      }
      return $id;
    }
    default:
      throw new PmUserError("Unknown entity: $entity");
  }
}

function pm_delete_entity(PDO $pdo, string $entity, int $id): void {
  $table = [
    'building' => 'buildings', 'unit' => 'units', 'owner' => 'owners', 'tenant' => 'tenants',
    'lease' => 'leases', 'ledgerEntry' => 'ledger', 'maintenance' => 'maintenance',
    'ownerLedger' => 'owner_ledger', 'communication' => 'communications', 'tenantComm' => 'tenant_communications',
  ][$entity] ?? null;
  if (!$table) throw new PmUserError("Unknown entity: $entity");
  $pdo->prepare("DELETE FROM $table WHERE id = ?")->execute([$id]);
}

/* =========================================================
   Monthly owner fee generation
   ========================================================= */
function pm_generate_fee(PDO $pdo, int $buildingId, string $month): array {
  $stmt = $pdo->prepare('SELECT * FROM buildings WHERE id = ?');
  $stmt->execute([$buildingId]);
  $b = $stmt->fetch();
  if (!$b) throw new PmUserError("Building not found");

  $monthStart = $month . '-01';
  $monthEnd = date('Y-m-t', strtotime($monthStart));

  $stmt = $pdo->prepare(
    'SELECT COALESCE(SUM(l.amount),0) AS total FROM ledger l
     JOIN leases le ON le.id = l.lease_id
     JOIN units u ON u.id = le.unit_id
     WHERE u.building_id = ? AND l.type = "payment" AND l.category = "rent" AND l.date BETWEEN ? AND ?'
  );
  $stmt->execute([$buildingId, $monthStart, $monthEnd]);
  $rentCollected = (float)$stmt->fetch()['total'];

  if ($b['fee_type'] === 'percent') {
    $fee = $rentCollected * ((float)$b['fee_value'] / 100);
  } else {
    $stmt = $pdo->prepare(
      'SELECT COUNT(*) AS c FROM leases le JOIN units u ON u.id = le.unit_id WHERE u.building_id = ? AND le.status = "active"'
    );
    $stmt->execute([$buildingId]);
    $activeUnits = (int)$stmt->fetch()['c'];
    $fee = (float)$b['fee_value'] * $activeUnits;
  }

  if ($fee <= 0) return ['ok' => false, 'message' => 'Calculated fee is $0 for that month — nothing generated.'];

  $stmt = $pdo->prepare('SELECT owner_id, pct FROM building_owners WHERE building_id = ?');
  $stmt->execute([$buildingId]);
  $owners = $stmt->fetchAll();
  if (!$owners) return ['ok' => false, 'message' => 'This building has no owners assigned yet.'];

  $memo = "Management fee — $month — {$b['name']}";
  $dupCheck = $pdo->prepare('SELECT COUNT(*) AS c FROM owner_ledger WHERE memo = ?');
  $dupCheck->execute([$memo]);
  if ((int)$dupCheck->fetch()['c'] > 0) {
    return ['ok' => false, 'message' => 'A fee charge with this memo already exists for that building and month.'];
  }

  $ins = $pdo->prepare('INSERT INTO owner_ledger (owner_id, building_id, date, type, amount, memo) VALUES (?,?,?,?,?,?)');
  foreach ($owners as $o) {
    $ins->execute([$o['owner_id'], $buildingId, $monthEnd, 'charge', round($fee * ((float)$o['pct'] / 100), 2), $memo]);
  }

  return ['ok' => true, 'message' => "Generated fee charges totalling \$" . number_format($fee, 2) . " across " . count($owners) . " owner(s), based on \$" . number_format($rentCollected, 2) . " in rent collected."];
}

/* =========================================================
   Users (admin manages logins here)
   ========================================================= */
function pm_change_password(PDO $pdo, array $user, string $current, string $new): array {
  if (strlen($new) < 8) return ['ok' => false, 'message' => 'New password must be at least 8 characters.'];
  $stmt = $pdo->prepare('SELECT password_hash, failed_attempts, locked_until FROM users WHERE id = ?');
  $stmt->execute([$user['id']]);
  $row = $stmt->fetch();
  if (!$row) return ['ok' => false, 'message' => 'Current password is incorrect.'];

  if ($row['locked_until'] !== null && strtotime($row['locked_until']) > time()) {
    return ['ok' => false, 'message' => 'Too many failed attempts. Try again in a few minutes.'];
  }

  if (!password_verify($current, $row['password_hash'])) {
    pm_register_login_failure($pdo, (int)$user['id'], (int)$row['failed_attempts']);
    return ['ok' => false, 'message' => 'Current password is incorrect.'];
  }

  $pdo->prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL, must_change_password = 0 WHERE id = ?')
    ->execute([password_hash($new, PASSWORD_DEFAULT), $user['id']]);
  $_SESSION['user']['must_change_password'] = false;
  return ['ok' => true, 'message' => 'Password updated.'];
}

function pm_save_user(PDO $pdo, array $r): array {
  $id = (int)($r['id'] ?? 0);
  $username = trim((string)($r['username'] ?? ''));
  $role = $r['role'] === 'admin' ? 'admin' : 'owner';
  $ownerId = $role === 'owner' ? (int)($r['ownerId'] ?? 0) : null;
  $displayName = (string)($r['displayName'] ?? '');
  $email = (string)($r['email'] ?? '');
  $password = (string)($r['password'] ?? '');

  if ($username === '') return ['ok' => false, 'message' => 'Username is required.'];
  if ($role === 'owner' && !$ownerId) return ['ok' => false, 'message' => 'An owner-role login must be linked to an owner.'];

  if ($id) {
    if ($password !== '') {
      $pdo->prepare('UPDATE users SET username=?, role=?, owner_id=?, display_name=?, email=?, password_hash=? WHERE id=?')
        ->execute([$username, $role, $ownerId, $displayName, $email, password_hash($password, PASSWORD_DEFAULT), $id]);
    } else {
      $pdo->prepare('UPDATE users SET username=?, role=?, owner_id=?, display_name=?, email=? WHERE id=?')
        ->execute([$username, $role, $ownerId, $displayName, $email, $id]);
    }
  } else {
    if ($password === '') return ['ok' => false, 'message' => 'Password is required for a new user.'];
    try {
      $pdo->prepare('INSERT INTO users (username, password_hash, role, owner_id, display_name, email) VALUES (?,?,?,?,?,?)')
        ->execute([$username, password_hash($password, PASSWORD_DEFAULT), $role, $ownerId, $displayName, $email]);
      $id = (int)$pdo->lastInsertId();
    } catch (PDOException $e) {
      if ($e->getCode() === '23000') return ['ok' => false, 'message' => 'That username is already taken.'];
      throw $e;
    }
  }
  return ['ok' => true, 'id' => $id];
}
