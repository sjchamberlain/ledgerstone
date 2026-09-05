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
    $stmt = $pdo->query('SELECT id, username, role, owner_id, display_name, email, hourly_rate FROM users ORDER BY username');
    $rows = array_map(fn($r) => [
      'id' => (int)$r['id'], 'username' => $r['username'], 'role' => $r['role'],
      'ownerId' => $r['owner_id'] !== null ? (int)$r['owner_id'] : null,
      'displayName' => $r['display_name'], 'email' => $r['email'],
      'hourlyRate' => $r['hourly_rate'] !== null ? (float)$r['hourly_rate'] : null,
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

    if ($action === 'generateOwnerStatement') {
      pm_require_admin();
      $result = pm_generate_owner_statement($pdo, (int)$body['ownerId'], (int)$body['buildingId'], (string)$body['month'], $user, isset($body['stampRate']) && $body['stampRate'] !== '' ? (float)$body['stampRate'] : null);
      echo json_encode($result);
      exit;
    }

    if ($action === 'approveMaintenance') {
      $decision = (string)($body['decision'] ?? '');
      $result = pm_decide_maintenance_approval($pdo, $user, (int)($body['id'] ?? 0), $decision);
      echo json_encode($result);
      exit;
    }

    if ($action === 'transferOwner') {
      pm_require_admin();
      $result = pm_transfer_owner($pdo, $user, $body);
      echo json_encode($result);
      exit;
    }

    if ($action === 'postDepositTransaction') {
      pm_require_admin();
      $result = pm_post_deposit_transaction($pdo, $body);
      echo json_encode($result);
      exit;
    }

    if ($action === 'postTrustAdjustment') {
      pm_require_admin();
      $result = pm_post_trust_adjustment($pdo, $body);
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

  $rateStmt = $pdo->prepare('SELECT hourly_rate FROM users WHERE id = ?');
  $rateStmt->execute([$user['id']]);
  $hourlyRate = $rateStmt->fetchColumn();
  $hourlyRate = $hourlyRate !== false && $hourlyRate !== null ? (float)$hourlyRate : null;

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

  $vendorRows = pm_fetch_vendors($pdo);

  if ($isAdmin) {
    $ownerRows = pm_fetch_owners($pdo, null);
    $trustRows = pm_fetch_trust_transactions($pdo, null, null);
    $statementRows = pm_fetch_owner_statements($pdo, null, null);
    $transferRows = pm_fetch_owner_transfers($pdo, null);
    $commRows = pm_fetch_communications($pdo, null);
    $tenantCommRows = pm_fetch_tenant_communications($pdo, null);
  } else {
    // owners visible = anyone who co-owns a building this user can see
    $stmt = $pdo->prepare('SELECT DISTINCT owner_id FROM building_owners WHERE building_id IN (' . pm_in_clause($buildingIdList) . ')');
    $stmt->execute($buildingIdList ?: [0]);
    $visibleOwnerIds = array_map('intval', array_column($stmt->fetchAll(), 'owner_id'));
    $ownerRows = pm_fetch_owners($pdo, $visibleOwnerIds ?: [0]);
    $trustRows = pm_fetch_trust_transactions($pdo, [$user['owner_id']], null);
    $statementRows = pm_fetch_owner_statements($pdo, [$user['owner_id']], null);
    $transferRows = pm_fetch_owner_transfers($pdo, $buildingIdList);
    $commRows = pm_fetch_communications($pdo, [$user['owner_id']]);
    $tenantCommRows = pm_fetch_tenant_communications($pdo, $leaseIdList ?: [0]);
  }

  $depositRows = pm_fetch_security_deposits($pdo, $leaseIdList, $isAdmin);
  $depositTxRows = pm_fetch_security_deposit_transactions($pdo, array_column($depositRows, 'id'));

  $applianceRows = pm_fetch_appliances($pdo, $unitIdList);
  $roomRows = pm_fetch_rooms($pdo, $unitIdList);
  $roomOpeningRows = pm_fetch_room_openings($pdo, array_column($roomRows, 'id'));
  // Time entries record internal labor cost — admin/staff only, not shown to owner logins.
  $timeEntryRows = $isAdmin ? pm_fetch_time_entries($pdo, null) : [];
  // Stamp usage is an internal operations log — admin/staff only.
  $stampLogRows = $isAdmin ? pm_fetch_stamp_log($pdo) : [];

  return [
    'currentUser' => [
      'id' => $user['id'], 'username' => $user['username'], 'role' => $user['role'],
      'displayName' => $user['display_name'], 'ownerId' => $user['owner_id'],
      'mustChangePassword' => !empty($user['must_change_password']),
      'hourlyRate' => $hourlyRate,
    ],
    'appVersion' => pm_app_version(),
    'csrfToken' => pm_csrf_token(),
    'buildings' => $buildings,
    'units' => $unitRows,
    'owners' => $ownerRows,
    'tenants' => $tenants,
    'vendors' => $vendorRows,
    'leases' => $leaseRows,
    'ledger' => $ledgerRows,
    'maintenance' => $maintRows,
    'trustTransactions' => $trustRows,
    'securityDeposits' => $depositRows,
    'securityDepositTransactions' => $depositTxRows,
    'ownerStatements' => $statementRows,
    'ownerTransfers' => $transferRows,
    'communications' => $commRows,
    'tenantCommunications' => $tenantCommRows,
    'appliances' => $applianceRows,
    'rooms' => $roomRows,
    'roomOpenings' => $roomOpeningRows,
    'timeEntries' => $timeEntryRows,
    'stampLog' => $stampLogRows,
  ];
}

function pm_in_clause(?array $ids): string {
  // Every call site pairs this with an execute() that falls back to a
  // single sentinel param (`$ids ?: [0]`) when the id list is empty — so
  // an empty (but non-null) list must still return exactly one placeholder
  // here, or PDO throws "Invalid parameter number" on the param-count
  // mismatch. `id IN (?)` bound to 0 is a safe no-match, since ids start at 1.
  if ($ids === null) return '1=1';
  if (count($ids) === 0) return '?';
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
      'roofLastServiced' => $r['roof_last_serviced'], 'roofNotes' => $r['roof_notes'],
      'electricalLoad' => $r['electrical_load'], 'exteriorPaintColor' => $r['exterior_paint_color'],
      'profileNotes' => $r['profile_notes'],
      'reserveAmount' => (float)$r['reserve_amount'],
      'maintenanceApprovalThreshold' => $r['maintenance_approval_threshold'] !== null ? (float)$r['maintenance_approval_threshold'] : null,
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
    'notes' => $r['notes'], 'wallColor' => $r['wall_color'], 'faceplateColor' => $r['faceplate_color'],
  ], $stmt->fetchAll());
}

function pm_fetch_appliances(PDO $pdo, array $unitIds): array {
  $sql = 'SELECT * FROM appliances WHERE unit_id IN (' . pm_in_clause($unitIds) . ')';
  $stmt = $pdo->prepare($sql);
  $stmt->execute($unitIds ?: [0]);
  return array_map(fn($r) => [
    'id' => (int)$r['id'], 'unitId' => (int)$r['unit_id'], 'type' => $r['type'], 'make' => $r['make'],
    'model' => $r['model'], 'serialNumber' => $r['serial_number'], 'installDate' => $r['install_date'],
    'notes' => $r['notes'],
  ], $stmt->fetchAll());
}

function pm_fetch_rooms(PDO $pdo, array $unitIds): array {
  $sql = 'SELECT * FROM rooms WHERE unit_id IN (' . pm_in_clause($unitIds) . ')';
  $stmt = $pdo->prepare($sql);
  $stmt->execute($unitIds ?: [0]);
  return array_map(fn($r) => [
    'id' => (int)$r['id'], 'unitId' => (int)$r['unit_id'], 'name' => $r['name'],
    'lengthIn' => $r['length_in'] !== null ? (float)$r['length_in'] : null,
    'widthIn' => $r['width_in'] !== null ? (float)$r['width_in'] : null,
    'paintColor' => $r['paint_color'], 'notes' => $r['notes'],
  ], $stmt->fetchAll());
}

function pm_fetch_room_openings(PDO $pdo, array $roomIds): array {
  $sql = 'SELECT * FROM room_openings WHERE room_id IN (' . pm_in_clause($roomIds) . ')';
  $stmt = $pdo->prepare($sql);
  $stmt->execute($roomIds ?: [0]);
  return array_map(fn($r) => [
    'id' => (int)$r['id'], 'roomId' => (int)$r['room_id'], 'type' => $r['type'], 'label' => $r['label'],
    'widthIn' => $r['width_in'] !== null ? (float)$r['width_in'] : null,
    'heightIn' => $r['height_in'] !== null ? (float)$r['height_in'] : null,
    'notes' => $r['notes'],
  ], $stmt->fetchAll());
}

function pm_fetch_time_entries(PDO $pdo, ?array $buildingIds): array {
  $sql = 'SELECT * FROM time_entries';
  $params = [];
  if ($buildingIds !== null) {
    $sql .= ' WHERE building_id IN (' . pm_in_clause($buildingIds) . ')';
    $params = $buildingIds ?: [0];
  }
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  return array_map(fn($r) => [
    'id' => (int)$r['id'], 'buildingId' => (int)$r['building_id'],
    'unitId' => $r['unit_id'] !== null ? (int)$r['unit_id'] : null,
    'userId' => $r['user_id'] !== null ? (int)$r['user_id'] : null,
    'date' => $r['date'], 'activity' => $r['activity'], 'hours' => (float)$r['hours'],
    'rate' => (float)$r['rate'], 'description' => $r['description'], 'notes' => $r['notes'],
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
  return array_map(fn($r) => [
    'id' => (int)$r['id'], 'name' => $r['name'], 'email' => $r['email'], 'phone' => $r['phone'],
    'mailingAddress' => $r['mailing_address'],
  ], $stmt->fetchAll());
}

function pm_fetch_vendors(PDO $pdo): array {
  $stmt = $pdo->query('SELECT * FROM vendors');
  return array_map(fn($r) => [
    'id' => (int)$r['id'], 'name' => $r['name'], 'trade' => $r['trade'],
    'email' => $r['email'], 'phone' => $r['phone'], 'address' => $r['address'], 'notes' => $r['notes'],
  ], $stmt->fetchAll());
}

function pm_fetch_stamp_log(PDO $pdo): array {
  $stmt = $pdo->query('SELECT * FROM stamp_log ORDER BY date DESC, id DESC');
  return array_map(fn($r) => [
    'id' => (int)$r['id'], 'date' => $r['date'],
    'buildingId' => $r['building_id'] !== null ? (int)$r['building_id'] : null,
    'ownerId' => $r['owner_id'] !== null ? (int)$r['owner_id'] : null,
    'quantity' => (int)$r['quantity'], 'purpose' => $r['purpose'], 'billed' => (bool)$r['billed'],
  ], $stmt->fetchAll());
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
    'paymentMethod' => $r['payment_method'], 'chargeId' => $r['charge_id'] !== null ? (int)$r['charge_id'] : null,
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
    'vendorId' => $r['vendor_id'] !== null ? (int)$r['vendor_id'] : null,
    'invoiceNumber' => $r['invoice_number'], 'invoiceDate' => $r['invoice_date'],
    'approvalStatus' => $r['approval_status'],
    'approvedBy' => $r['approved_by'] !== null ? (int)$r['approved_by'] : null,
    'approvedAt' => $r['approved_at'],
  ], $stmt->fetchAll());
}

/* =========================================================
   TRUST ACCOUNTING — owner trust balance per building (segregated from
   security deposits), generated owner statements, and the ownership-
   transfer audit trail.
   ========================================================= */
function pm_fetch_trust_transactions(PDO $pdo, ?array $ownerIds, ?array $buildingIds): array {
  $sql = 'SELECT * FROM trust_transactions';
  $params = [];
  $clauses = [];
  if ($ownerIds !== null) { $clauses[] = 'owner_id IN (' . pm_in_clause($ownerIds) . ')'; $params = array_merge($params, $ownerIds ?: [0]); }
  if ($buildingIds !== null) { $clauses[] = 'building_id IN (' . pm_in_clause($buildingIds) . ')'; $params = array_merge($params, $buildingIds ?: [0]); }
  if ($clauses) $sql .= ' WHERE ' . implode(' AND ', $clauses);
  $sql .= ' ORDER BY owner_id, building_id, date, id';
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  return array_map(fn($r) => [
    'id' => (int)$r['id'], 'ownerId' => (int)$r['owner_id'], 'buildingId' => (int)$r['building_id'],
    'type' => $r['type'], 'category' => $r['category'], 'date' => $r['date'],
    'amount' => (float)$r['amount'], 'runningBalance' => (float)$r['running_balance'], 'memo' => $r['memo'],
    'relatedLedgerId' => $r['related_ledger_id'] !== null ? (int)$r['related_ledger_id'] : null,
    'relatedMaintenanceId' => $r['related_maintenance_id'] !== null ? (int)$r['related_maintenance_id'] : null,
    'relatedTransferId' => $r['related_transfer_id'] !== null ? (int)$r['related_transfer_id'] : null,
  ], $stmt->fetchAll());
}

function pm_fetch_security_deposits(PDO $pdo, array $leaseIds, bool $isAdmin): array {
  $sql = 'SELECT * FROM security_deposits';
  $params = [];
  if (!$isAdmin) {
    $sql .= ' WHERE lease_id IN (' . pm_in_clause($leaseIds) . ')';
    $params = $leaseIds ?: [0];
  }
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  return array_map(fn($r) => [
    'id' => (int)$r['id'], 'leaseId' => (int)$r['lease_id'], 'unitId' => (int)$r['unit_id'],
    'tenantId' => (int)$r['tenant_id'], 'buildingId' => (int)$r['building_id'],
    'amountHeld' => (float)$r['amount_held'], 'dateReceived' => $r['date_received'], 'status' => $r['status'],
    'notes' => $r['notes'],
  ], $stmt->fetchAll());
}

function pm_fetch_security_deposit_transactions(PDO $pdo, array $depositIds): array {
  if (!$depositIds) return [];
  $sql = 'SELECT * FROM security_deposit_transactions WHERE security_deposit_id IN (' . pm_in_clause($depositIds) . ') ORDER BY date, id';
  $stmt = $pdo->prepare($sql);
  $stmt->execute($depositIds);
  return array_map(fn($r) => [
    'id' => (int)$r['id'], 'securityDepositId' => (int)$r['security_deposit_id'], 'date' => $r['date'],
    'type' => $r['type'], 'amount' => (float)$r['amount'], 'memo' => $r['memo'],
    'relatedLedgerId' => $r['related_ledger_id'] !== null ? (int)$r['related_ledger_id'] : null,
  ], $stmt->fetchAll());
}

function pm_fetch_owner_statements(PDO $pdo, ?array $ownerIds, ?array $buildingIds): array {
  $sql = 'SELECT * FROM owner_statements';
  $params = [];
  $clauses = [];
  if ($ownerIds !== null) { $clauses[] = 'owner_id IN (' . pm_in_clause($ownerIds) . ')'; $params = array_merge($params, $ownerIds ?: [0]); }
  if ($buildingIds !== null) { $clauses[] = 'building_id IN (' . pm_in_clause($buildingIds) . ')'; $params = array_merge($params, $buildingIds ?: [0]); }
  if ($clauses) $sql .= ' WHERE ' . implode(' AND ', $clauses);
  $sql .= ' ORDER BY period_start DESC, id DESC';
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  return array_map(fn($r) => [
    'id' => (int)$r['id'], 'ownerId' => (int)$r['owner_id'], 'buildingId' => (int)$r['building_id'],
    'periodStart' => $r['period_start'], 'periodEnd' => $r['period_end'],
    'rentDue' => (float)$r['rent_due'], 'rentCollected' => (float)$r['rent_collected'],
    'lateFeesCollected' => (float)$r['late_fees_collected'], 'otherIncome' => (float)$r['other_income'],
    'managementFee' => (float)$r['management_fee'], 'repairsTotal' => (float)$r['repairs_total'],
    'otherExpenses' => (float)$r['other_expenses'], 'reserveHeld' => (float)$r['reserve_held'],
    'amountDisbursed' => (float)$r['amount_disbursed'], 'endingTrustBalance' => (float)$r['ending_trust_balance'],
    'lineItems' => json_decode($r['line_items'], true) ?: [], 'generatedAt' => $r['generated_at'],
  ], $stmt->fetchAll());
}

function pm_fetch_owner_transfers(PDO $pdo, ?array $buildingIds): array {
  $sql = 'SELECT * FROM owner_transfers';
  $params = [];
  if ($buildingIds !== null) {
    $sql .= ' WHERE building_id IN (' . pm_in_clause($buildingIds) . ')';
    $params = $buildingIds ?: [0];
  }
  $sql .= ' ORDER BY transfer_date DESC, id DESC';
  $stmt = $pdo->prepare($sql);
  $stmt->execute($params);
  return array_map(fn($r) => [
    'id' => (int)$r['id'], 'buildingId' => (int)$r['building_id'], 'fromOwnerId' => (int)$r['from_owner_id'],
    'toOwnerId' => (int)$r['to_owner_id'], 'transferDate' => $r['transfer_date'],
    'ownershipPct' => (float)$r['ownership_pct'], 'trustBalanceTransferred' => (float)$r['trust_balance_transferred'],
    'depositsTransferredCount' => (int)$r['deposits_transferred_count'],
    'depositsTransferredTotal' => (float)$r['deposits_transferred_total'], 'notes' => $r['notes'],
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
      $profileFields = [
        $r['roofLastServiced'] ?: null, $r['roofNotes'] ?? '', $r['electricalLoad'] ?? '',
        $r['exteriorPaintColor'] ?? '', $r['profileNotes'] ?? '',
        $r['reserveAmount'] ?: 0, ($r['maintenanceApprovalThreshold'] ?? '') === '' ? null : (float)$r['maintenanceApprovalThreshold'],
      ];
      if ($id) {
        $stmt = $pdo->prepare('UPDATE buildings SET name=?, address=?, fee_type=?, fee_value=?, roof_last_serviced=?, roof_notes=?, electrical_load=?, exterior_paint_color=?, profile_notes=?, reserve_amount=?, maintenance_approval_threshold=? WHERE id=?');
        $stmt->execute([$r['name'], $r['address'], $r['feeType'], $r['feeValue'], ...$profileFields, $id]);
      } else {
        $stmt = $pdo->prepare('INSERT INTO buildings (name, address, fee_type, fee_value, roof_last_serviced, roof_notes, electrical_load, exterior_paint_color, profile_notes, reserve_amount, maintenance_approval_threshold) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
        $stmt->execute([$r['name'], $r['address'], $r['feeType'], $r['feeValue'], ...$profileFields]);
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
      $fields = [$r['buildingId'], $r['number'], $r['beds'], $r['baths'], $r['sqft'] ?: null, $r['notes'] ?? '', $r['wallColor'] ?? '', $r['faceplateColor'] ?? ''];
      if ($id) {
        $pdo->prepare('UPDATE units SET building_id=?, number=?, beds=?, baths=?, sqft=?, notes=?, wall_color=?, faceplate_color=? WHERE id=?')
          ->execute([...$fields, $id]);
      } else {
        $pdo->prepare('INSERT INTO units (building_id, number, beds, baths, sqft, notes, wall_color, faceplate_color) VALUES (?,?,?,?,?,?,?,?)')
          ->execute($fields);
        $id = (int)$pdo->lastInsertId();
      }
      return $id;
    }
    case 'appliance': {
      $id = (int)($r['id'] ?? 0);
      $fields = [$r['unitId'], $r['type'], $r['make'] ?? '', $r['model'] ?? '', $r['serialNumber'] ?? '', $r['installDate'] ?: null, $r['notes'] ?? ''];
      if ($id) {
        $pdo->prepare('UPDATE appliances SET unit_id=?, type=?, make=?, model=?, serial_number=?, install_date=?, notes=? WHERE id=?')
          ->execute([...$fields, $id]);
      } else {
        $pdo->prepare('INSERT INTO appliances (unit_id, type, make, model, serial_number, install_date, notes) VALUES (?,?,?,?,?,?,?)')
          ->execute($fields);
        $id = (int)$pdo->lastInsertId();
      }
      return $id;
    }
    case 'room': {
      $id = (int)($r['id'] ?? 0);
      $fields = [$r['unitId'], $r['name'], $r['lengthIn'] ?: null, $r['widthIn'] ?: null, $r['paintColor'] ?? '', $r['notes'] ?? ''];
      if ($id) {
        $pdo->prepare('UPDATE rooms SET unit_id=?, name=?, length_in=?, width_in=?, paint_color=?, notes=? WHERE id=?')
          ->execute([...$fields, $id]);
      } else {
        $pdo->prepare('INSERT INTO rooms (unit_id, name, length_in, width_in, paint_color, notes) VALUES (?,?,?,?,?,?)')
          ->execute($fields);
        $id = (int)$pdo->lastInsertId();
      }
      return $id;
    }
    case 'roomOpening': {
      $id = (int)($r['id'] ?? 0);
      $fields = [$r['roomId'], $r['type'], $r['label'] ?? '', $r['widthIn'] ?: null, $r['heightIn'] ?: null, $r['notes'] ?? ''];
      if ($id) {
        $pdo->prepare('UPDATE room_openings SET room_id=?, type=?, label=?, width_in=?, height_in=?, notes=? WHERE id=?')
          ->execute([...$fields, $id]);
      } else {
        $pdo->prepare('INSERT INTO room_openings (room_id, type, label, width_in, height_in, notes) VALUES (?,?,?,?,?,?)')
          ->execute($fields);
        $id = (int)$pdo->lastInsertId();
      }
      return $id;
    }
    case 'timeEntry': {
      $id = (int)($r['id'] ?? 0);
      $fields = [$r['buildingId'], $r['unitId'] ?: null, $r['userId'] ?: null, $r['date'], $r['activity'], $r['hours'], $r['rate'], $r['description'] ?? '', $r['notes'] ?? ''];
      if ($id) {
        $pdo->prepare('UPDATE time_entries SET building_id=?, unit_id=?, user_id=?, date=?, activity=?, hours=?, rate=?, description=?, notes=? WHERE id=?')
          ->execute([...$fields, $id]);
      } else {
        $pdo->prepare('INSERT INTO time_entries (building_id, unit_id, user_id, date, activity, hours, rate, description, notes) VALUES (?,?,?,?,?,?,?,?,?)')
          ->execute($fields);
        $id = (int)$pdo->lastInsertId();
      }
      return $id;
    }
    case 'stampLog': {
      $id = (int)($r['id'] ?? 0);
      $fields = [$r['date'], $r['buildingId'] ?: null, $r['ownerId'] ?: null, $r['quantity'] ?: 1, $r['purpose'] ?? '', !empty($r['billed']) ? 1 : 0];
      if ($id) {
        $pdo->prepare('UPDATE stamp_log SET date=?, building_id=?, owner_id=?, quantity=?, purpose=?, billed=? WHERE id=?')
          ->execute([...$fields, $id]);
      } else {
        $pdo->prepare('INSERT INTO stamp_log (date, building_id, owner_id, quantity, purpose, billed) VALUES (?,?,?,?,?,?)')
          ->execute($fields);
        $id = (int)$pdo->lastInsertId();
      }
      return $id;
    }
    case 'owner': {
      $id = (int)($r['id'] ?? 0);
      $fields = [$r['name'], $r['email'] ?? '', $r['phone'] ?? '', $r['mailingAddress'] ?? ''];
      if ($id) {
        $pdo->prepare('UPDATE owners SET name=?, email=?, phone=?, mailing_address=? WHERE id=?')->execute([...$fields, $id]);
      } else {
        $pdo->prepare('INSERT INTO owners (name, email, phone, mailing_address) VALUES (?,?,?,?)')->execute($fields);
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
    case 'vendor': {
      $id = (int)($r['id'] ?? 0);
      $fields = [$r['name'], $r['trade'] ?? '', $r['email'] ?? '', $r['phone'] ?? '', $r['address'] ?? '', $r['notes'] ?? ''];
      if ($id) {
        $pdo->prepare('UPDATE vendors SET name=?, trade=?, email=?, phone=?, address=?, notes=? WHERE id=?')->execute([...$fields, $id]);
      } else {
        $pdo->prepare('INSERT INTO vendors (name, trade, email, phone, address, notes) VALUES (?,?,?,?,?,?)')->execute($fields);
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
      $paymentMethod = ($type === 'payment' && !empty($r['paymentMethod'])) ? $r['paymentMethod'] : null;
      $chargeId = ($type === 'payment' && !empty($r['chargeId'])) ? (int)$r['chargeId'] : null;
      $fields = [$r['leaseId'], $r['date'], $type, $r['category'], $r['amount'], $r['memo'] ?? '', $paymentMethod, $chargeId];
      $wasEdit = (bool)$id;
      if ($id) {
        // A previously-posted trust/deposit entry is tied to this exact ledger
        // row (related_ledger_id, ON DELETE CASCADE) — remove it before
        // re-deriving from the edited amount/category so edits can't leave a
        // stale trust posting behind.
        pm_reverse_ledger_trust_posting($pdo, $id);
        $pdo->prepare('UPDATE ledger SET lease_id=?, date=?, type=?, category=?, amount=?, memo=?, payment_method=?, charge_id=? WHERE id=?')->execute([...$fields, $id]);
      } else {
        $pdo->prepare('INSERT INTO ledger (lease_id, date, type, category, amount, memo, payment_method, charge_id) VALUES (?,?,?,?,?,?,?,?)')->execute($fields);
        $id = (int)$pdo->lastInsertId();
      }
      if ($type === 'payment') {
        pm_post_ledger_payment_trust($pdo, $id, (int)$r['leaseId'], (string)$r['category'], (float)$r['amount'], (string)$r['date']);
      }
      return $id;
    }
    case 'maintenance': {
      $id = (int)($r['id'] ?? 0);
      $buildingId = $r['buildingId'] ?: null;
      $unitId = $r['unitId'] ?: null;
      $cost = (float)($r['cost'] ?: 0);
      $status = $r['status'];
      $vendorId = $r['vendorId'] ?? null ? (int)$r['vendorId'] : null;

      $existing = null;
      if ($id) {
        $stmt = $pdo->prepare('SELECT * FROM maintenance WHERE id = ?');
        $stmt->execute([$id]);
        $existing = $stmt->fetch();
      }
      // Once a human has recorded a decision (approved/denied), leave it in
      // place on later edits — only a still-undecided record (auto_approved
      // or pending) gets its approval status re-derived from the building's
      // threshold, so editing an unrelated field can't silently overturn an
      // owner's decision.
      $approvalStatus = $existing ? $existing['approval_status'] : 'auto_approved';
      if (!$existing || in_array($approvalStatus, ['auto_approved', 'pending'], true)) {
        $threshold = null;
        if ($buildingId) {
          $bstmt = $pdo->prepare('SELECT maintenance_approval_threshold FROM buildings WHERE id = ?');
          $bstmt->execute([$buildingId]);
          $t = $bstmt->fetchColumn();
          $threshold = ($t === false || $t === null) ? null : (float)$t;
        }
        $approvalStatus = ($threshold !== null && $cost > $threshold) ? 'pending' : 'auto_approved';
      }

      $fields = [
        $buildingId, $unitId, $r['title'], $r['description'] ?? '', $r['priority'], $status,
        $r['dateReported'], $r['dateCompleted'] ?: null, $cost, $r['notes'] ?? '',
        $vendorId, $r['invoiceNumber'] ?? '', $r['invoiceDate'] ?: null, $approvalStatus,
      ];
      if ($id) {
        $pdo->prepare('UPDATE maintenance SET building_id=?, unit_id=?, title=?, description=?, priority=?, status=?, date_reported=?, date_completed=?, cost=?, notes=?, vendor_id=?, invoice_number=?, invoice_date=?, approval_status=? WHERE id=?')
          ->execute([...$fields, $id]);
      } else {
        $pdo->prepare('INSERT INTO maintenance (building_id, unit_id, title, description, priority, status, date_reported, date_completed, cost, notes, vendor_id, invoice_number, invoice_date, approval_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          ->execute($fields);
        $id = (int)$pdo->lastInsertId();
      }
      pm_post_maintenance_trust_expense($pdo, $id, $buildingId ? (int)$buildingId : null, $status, $cost, $approvalStatus, $r['dateCompleted'] ?: $r['dateReported']);
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
  if ($entity === 'ledgerEntry') {
    pm_reverse_ledger_trust_posting($pdo, $id);
    $pdo->prepare('DELETE FROM ledger WHERE id = ?')->execute([$id]);
    return;
  }
  if ($entity === 'maintenance') {
    $stmt = $pdo->prepare('SELECT building_id FROM maintenance WHERE id = ?');
    $stmt->execute([$id]);
    $buildingId = $stmt->fetchColumn();
    $pdo->prepare('DELETE FROM maintenance WHERE id = ?')->execute([$id]); // cascades trust_transactions rows
    if ($buildingId) pm_recompute_trust_balances_for_building($pdo, (int)$buildingId);
    return;
  }
  if ($entity === 'trustTransaction') {
    $stmt = $pdo->prepare('SELECT owner_id, building_id, type FROM trust_transactions WHERE id = ?');
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) return;
    if (!in_array($row['type'], ['fee', 'disbursement', 'adjustment'], true)) {
      throw new PmUserError('Only manually-posted entries (fee, disbursement, adjustment) can be deleted directly — income and expense postings follow their ledger/maintenance record.');
    }
    $pdo->prepare('DELETE FROM trust_transactions WHERE id = ?')->execute([$id]);
    pm_recompute_trust_balance($pdo, (int)$row['owner_id'], (int)$row['building_id']);
    return;
  }
  if ($entity === 'securityDepositTransaction') {
    $stmt = $pdo->prepare('SELECT security_deposit_id FROM security_deposit_transactions WHERE id = ?');
    $stmt->execute([$id]);
    $depositId = $stmt->fetchColumn();
    $pdo->prepare('DELETE FROM security_deposit_transactions WHERE id = ?')->execute([$id]);
    if ($depositId) pm_recompute_security_deposit($pdo, (int)$depositId);
    return;
  }
  if ($entity === 'ownerStatement') {
    $pdo->prepare('DELETE FROM owner_statements WHERE id = ?')->execute([$id]);
    return;
  }

  $table = [
    'building' => 'buildings', 'unit' => 'units', 'owner' => 'owners', 'tenant' => 'tenants',
    'vendor' => 'vendors',
    'lease' => 'leases',
    'communication' => 'communications', 'tenantComm' => 'tenant_communications',
    'appliance' => 'appliances', 'timeEntry' => 'time_entries',
    'room' => 'rooms', 'roomOpening' => 'room_openings', 'stampLog' => 'stamp_log',
  ][$entity] ?? null;
  if (!$table) throw new PmUserError("Unknown entity: $entity");
  $pdo->prepare("DELETE FROM $table WHERE id = ?")->execute([$id]);
}

/* =========================================================
   TRUST LEDGER PRIMITIVES
   ========================================================= */

// Recomputes running_balance for one owner+building's trust_transactions,
// in date/id order, from scratch. Cheap at this data volume and immune to
// drift — every write path below calls this after inserting or deleting
// a row, rather than trying to patch a stored delta.
function pm_recompute_trust_balance(PDO $pdo, int $ownerId, int $buildingId): void {
  $stmt = $pdo->prepare('SELECT id, type, amount FROM trust_transactions WHERE owner_id = ? AND building_id = ? ORDER BY date, id');
  $stmt->execute([$ownerId, $buildingId]);
  $rows = $stmt->fetchAll();
  $bal = 0.0;
  $upd = $pdo->prepare('UPDATE trust_transactions SET running_balance = ? WHERE id = ?');
  foreach ($rows as $r) {
    $amt = (float)$r['amount'];
    if (in_array($r['type'], ['income', 'transfer_in'], true)) $bal += $amt;
    elseif ($r['type'] === 'adjustment') $bal += $amt; // adjustment amount is signed
    else $bal -= $amt; // fee, expense, disbursement, transfer_out
    $bal = round($bal, 2);
    $upd->execute([$bal, $r['id']]);
  }
}

function pm_recompute_trust_balances_for_building(PDO $pdo, int $buildingId): void {
  $stmt = $pdo->prepare('SELECT DISTINCT owner_id FROM trust_transactions WHERE building_id = ?');
  $stmt->execute([$buildingId]);
  foreach ($stmt->fetchAll() as $r) {
    pm_recompute_trust_balance($pdo, (int)$r['owner_id'], $buildingId);
  }
}

function pm_trust_balance_as_of(PDO $pdo, int $ownerId, int $buildingId, string $asOfDate): float {
  $stmt = $pdo->prepare('SELECT running_balance FROM trust_transactions WHERE owner_id = ? AND building_id = ? AND date <= ? ORDER BY date DESC, id DESC LIMIT 1');
  $stmt->execute([$ownerId, $buildingId, $asOfDate]);
  $v = $stmt->fetchColumn();
  return $v === false ? 0.0 : (float)$v;
}

function pm_post_trust(PDO $pdo, int $ownerId, int $buildingId, string $type, string $category, string $date, float $amount, ?string $memo, ?int $relatedLedgerId = null, ?int $relatedMaintenanceId = null, ?int $relatedTransferId = null): int {
  $pdo->prepare('INSERT INTO trust_transactions (owner_id, building_id, type, category, date, amount, running_balance, memo, related_ledger_id, related_maintenance_id, related_transfer_id) VALUES (?,?,?,?,?,?,0,?,?,?,?)')
    ->execute([$ownerId, $buildingId, $type, $category, $date, $amount, $memo, $relatedLedgerId, $relatedMaintenanceId, $relatedTransferId]);
  $id = (int)$pdo->lastInsertId();
  pm_recompute_trust_balance($pdo, $ownerId, $buildingId);
  return $id;
}

// A tenant ledger *payment* moves real cash: rent/late-fee/utility/other
// becomes operating trust income for the building's owner(s), split by
// building_owners.pct — proving each owner's share without touching the
// pooled bank balance. A 'deposit' payment is deliberately routed to the
// segregated security_deposits sub-ledger instead (see below) and never
// reaches trust_transactions at all, so deposit cash can never commingle
// with operating trust funds even accidentally.
function pm_post_ledger_payment_trust(PDO $pdo, int $ledgerId, int $leaseId, string $category, float $amount, string $date): void {
  $stmt = $pdo->prepare('SELECT u.building_id, l.unit_id, l.tenant_id FROM leases l JOIN units u ON u.id = l.unit_id WHERE l.id = ?');
  $stmt->execute([$leaseId]);
  $row = $stmt->fetch();
  if (!$row) return;
  $buildingId = (int)$row['building_id'];

  if ($category === 'deposit') {
    pm_receive_security_deposit($pdo, $leaseId, (int)$row['unit_id'], (int)$row['tenant_id'], $buildingId, $amount, $date, $ledgerId);
    return;
  }

  $stmt = $pdo->prepare('SELECT owner_id, pct FROM building_owners WHERE building_id = ?');
  $stmt->execute([$buildingId]);
  $owners = $stmt->fetchAll();
  if (!$owners) return; // no owner assigned yet — nothing to post

  $cat = $category === 'rent' ? 'rent_income' : 'other_income';
  foreach ($owners as $o) {
    $share = round($amount * ((float)$o['pct'] / 100), 2);
    if ($share == 0.0) continue;
    pm_post_trust($pdo, (int)$o['owner_id'], $buildingId, 'income', $cat, $date, $share, ucfirst($category) . ' collected', $ledgerId);
  }
}

// Undoes whatever a ledger row previously caused (a trust income posting,
// or a security-deposit receipt) before that row is edited or deleted.
// trust_transactions.related_ledger_id and security_deposit_transactions.
// related_ledger_id both cascade-delete, so this is just "delete anything
// tagged with this ledger id, then recompute the balances that changed."
function pm_reverse_ledger_trust_posting(PDO $pdo, int $ledgerId): void {
  $stmt = $pdo->prepare('SELECT DISTINCT owner_id, building_id FROM trust_transactions WHERE related_ledger_id = ?');
  $stmt->execute([$ledgerId]);
  $affected = $stmt->fetchAll();
  $stmt = $pdo->prepare('SELECT DISTINCT security_deposit_id FROM security_deposit_transactions WHERE related_ledger_id = ?');
  $stmt->execute([$ledgerId]);
  $affectedDeposits = $stmt->fetchAll();

  $pdo->prepare('DELETE FROM trust_transactions WHERE related_ledger_id = ?')->execute([$ledgerId]);
  $pdo->prepare('DELETE FROM security_deposit_transactions WHERE related_ledger_id = ?')->execute([$ledgerId]);

  foreach ($affected as $a) pm_recompute_trust_balance($pdo, (int)$a['owner_id'], (int)$a['building_id']);
  foreach ($affectedDeposits as $d) pm_recompute_security_deposit($pdo, (int)$d['security_deposit_id']);
}

// A completed, non-denied repair is a cash outflow paid on the owner's
// behalf — it decreases the owner's trust balance, split by pct, same as
// income does. Re-derives the posting from scratch on every save
// (delete-by-tag, then re-insert if still eligible) so an edit to cost,
// status, or approval can't leave a stale expense behind.
function pm_post_maintenance_trust_expense(PDO $pdo, int $maintenanceId, ?int $buildingId, string $status, float $cost, string $approvalStatus, ?string $date): void {
  $stmt = $pdo->prepare('SELECT DISTINCT owner_id, building_id FROM trust_transactions WHERE related_maintenance_id = ?');
  $stmt->execute([$maintenanceId]);
  $previouslyAffected = $stmt->fetchAll();
  $pdo->prepare('DELETE FROM trust_transactions WHERE related_maintenance_id = ?')->execute([$maintenanceId]);
  foreach ($previouslyAffected as $a) pm_recompute_trust_balance($pdo, (int)$a['owner_id'], (int)$a['building_id']);

  $eligible = $status === 'completed' && $cost > 0 && $buildingId && in_array($approvalStatus, ['auto_approved', 'approved'], true);
  if (!$eligible) return;

  $stmt = $pdo->prepare('SELECT owner_id, pct FROM building_owners WHERE building_id = ?');
  $stmt->execute([$buildingId]);
  foreach ($stmt->fetchAll() as $o) {
    $share = round($cost * ((float)$o['pct'] / 100), 2);
    if ($share == 0.0) continue;
    pm_post_trust($pdo, (int)$o['owner_id'], $buildingId, 'expense', 'repair_expense', $date ?: date('Y-m-d'), $share, 'Repair cost', null, $maintenanceId);
  }
}

/* =========================================================
   SECURITY DEPOSITS — segregated sub-ledger, tied to unit + tenant +
   lease. Never posted to trust_transactions (see pm_post_ledger_payment_
   trust above), so operating trust cash and deposit cash can't commingle
   even by accident.
   ========================================================= */
function pm_receive_security_deposit(PDO $pdo, int $leaseId, int $unitId, int $tenantId, int $buildingId, float $amount, string $date, ?int $ledgerId): void {
  $stmt = $pdo->prepare('SELECT id FROM security_deposits WHERE lease_id = ?');
  $stmt->execute([$leaseId]);
  $depositId = $stmt->fetchColumn();
  if (!$depositId) {
    $pdo->prepare('INSERT INTO security_deposits (lease_id, unit_id, tenant_id, building_id, amount_held, date_received, status) VALUES (?,?,?,?,0,?,"held")')
      ->execute([$leaseId, $unitId, $tenantId, $buildingId, $date]);
    $depositId = (int)$pdo->lastInsertId();
  }
  $pdo->prepare('INSERT INTO security_deposit_transactions (security_deposit_id, date, type, amount, memo, related_ledger_id) VALUES (?,?,"receipt",?,?,?)')
    ->execute([$depositId, $date, $amount, 'Deposit received', $ledgerId]);
  pm_recompute_security_deposit($pdo, (int)$depositId);
}

function pm_recompute_security_deposit(PDO $pdo, int $depositId): void {
  $stmt = $pdo->prepare('SELECT type, amount FROM security_deposit_transactions WHERE security_deposit_id = ?');
  $stmt->execute([$depositId]);
  $receipts = 0.0; $outflow = 0.0;
  foreach ($stmt->fetchAll() as $t) {
    if ($t['type'] === 'receipt') $receipts += (float)$t['amount'];
    else $outflow += (float)$t['amount'];
  }
  $held = round($receipts - $outflow, 2);
  $status = 'held';
  if ($held <= 0.005) $status = 'refunded';
  elseif ($outflow > 0.005) $status = 'partially_refunded';
  $pdo->prepare('UPDATE security_deposits SET amount_held = ?, status = ? WHERE id = ?')->execute([max(0, $held), $status, $depositId]);
}

function pm_post_deposit_transaction(PDO $pdo, array $body): array {
  $depositId = (int)($body['securityDepositId'] ?? 0);
  $type = (string)($body['type'] ?? '');
  $amount = (float)($body['amount'] ?? 0);
  $date = (string)($body['date'] ?? date('Y-m-d'));
  $memo = (string)($body['memo'] ?? '');
  if (!$depositId) throw new PmUserError('Choose a security deposit.');
  if (!in_array($type, ['refund', 'deduction'], true)) throw new PmUserError('Type must be refund or deduction.');
  if ($amount <= 0) throw new PmUserError('Enter an amount greater than $0.');

  $stmt = $pdo->prepare('SELECT amount_held FROM security_deposits WHERE id = ?');
  $stmt->execute([$depositId]);
  $held = $stmt->fetchColumn();
  if ($held === false) throw new PmUserError('Security deposit not found.');
  if ($amount > (float)$held + 0.005) throw new PmUserError('That amount is more than the ' . money_fmt((float)$held) . ' currently held.');

  $pdo->prepare('INSERT INTO security_deposit_transactions (security_deposit_id, date, type, amount, memo) VALUES (?,?,?,?,?)')
    ->execute([$depositId, $date, $type, $amount, $memo ?: null]);
  pm_recompute_security_deposit($pdo, $depositId);

  return ['ok' => true, 'message' => ucfirst($type) . ' of ' . money_fmt($amount) . ' recorded.'];
}

/* =========================================================
   Manual trust entries — admin-only corrections. Income, expense, and
   transfer postings stay system-generated (from ledger payments,
   completed repairs, and ownership transfers respectively) so they can't
   drift from the records that produced them; a manual entry is only ever
   a management fee, a disbursement, or a flagged adjustment.
   ========================================================= */
function pm_post_trust_adjustment(PDO $pdo, array $body): array {
  $ownerId = (int)($body['ownerId'] ?? 0);
  $buildingId = (int)($body['buildingId'] ?? 0);
  $type = (string)($body['type'] ?? '');
  $date = (string)($body['date'] ?? date('Y-m-d'));
  $amount = (float)($body['amount'] ?? 0);
  $memo = (string)($body['memo'] ?? '');
  if (!$ownerId || !$buildingId) throw new PmUserError('Choose an owner and building.');
  if (!in_array($type, ['fee', 'disbursement', 'adjustment'], true)) throw new PmUserError('Invalid entry type.');
  if ($type !== 'adjustment' && $amount <= 0) throw new PmUserError('Enter an amount greater than $0.');
  if ($type === 'adjustment' && $amount == 0) throw new PmUserError('Enter a non-zero amount.');

  $category = $type === 'fee' ? 'manual_fee' : ($type === 'disbursement' ? 'disbursement' : 'adjustment');
  pm_post_trust($pdo, $ownerId, $buildingId, $type, $category, $date, $amount, $memo ?: null);
  return ['ok' => true, 'message' => 'Trust entry posted.'];
}

/* =========================================================
   MAINTENANCE APPROVAL — an owner login is otherwise entirely read-only,
   but gets exactly this one narrow write path, enforced here (not just
   hidden in the UI): they may decide a *pending* item on a building they
   own, nothing else.
   ========================================================= */
function pm_decide_maintenance_approval(PDO $pdo, array $user, int $id, string $decision): array {
  if (!in_array($decision, ['approved', 'denied'], true)) throw new PmUserError('Decision must be approved or denied.');
  $stmt = $pdo->prepare('SELECT * FROM maintenance WHERE id = ?');
  $stmt->execute([$id]);
  $m = $stmt->fetch();
  if (!$m) throw new PmUserError('Maintenance request not found.');
  if ($m['approval_status'] !== 'pending') throw new PmUserError('This request is not awaiting approval.');

  if ($user['role'] !== 'admin') {
    if (!$m['building_id']) throw new PmUserError('Not authorized.');
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM building_owners WHERE building_id = ? AND owner_id = ?');
    $stmt->execute([$m['building_id'], $user['owner_id']]);
    if ((int)$stmt->fetchColumn() === 0) throw new PmUserError('Not authorized.');
  }

  $pdo->prepare('UPDATE maintenance SET approval_status = ?, approved_by = ?, approved_at = NOW() WHERE id = ?')
    ->execute([$decision, $user['id'], $id]);

  if ($decision === 'approved') {
    pm_post_maintenance_trust_expense($pdo, $id, $m['building_id'] ? (int)$m['building_id'] : null, $m['status'], (float)$m['cost'], 'approved', $m['date_completed'] ?: $m['date_reported']);
  }

  return ['ok' => true, 'message' => 'Request ' . $decision . '.'];
}

/* =========================================================
   OWNER STATEMENTS — one generation per owner/building/month rolls the
   management fee, unbilled postage, and the period's itemized repairs
   into a single frozen statement, instead of separate fee/stamp-billing
   actions scattered around the app. Rent/other income and repair costs
   already post to trust_transactions as they happen (see above) — this
   function adds the fee and postage for the period, then disburses
   everything above the building's reserve.
   ========================================================= */
function pm_generate_owner_statement(PDO $pdo, int $ownerId, int $buildingId, string $month, array $user, ?float $stampRate): array {
  $stmt = $pdo->prepare('SELECT pct FROM building_owners WHERE building_id = ? AND owner_id = ?');
  $stmt->execute([$buildingId, $ownerId]);
  $pct = $stmt->fetchColumn();
  if ($pct === false) throw new PmUserError('This owner has no stake in that building.');
  $pct = (float)$pct;

  $periodStart = $month . '-01';
  $periodEnd = date('Y-m-t', strtotime($periodStart));

  $dup = $pdo->prepare('SELECT COUNT(*) FROM owner_statements WHERE owner_id = ? AND building_id = ? AND period_start = ? AND period_end = ?');
  $dup->execute([$ownerId, $buildingId, $periodStart, $periodEnd]);
  if ((int)$dup->fetchColumn() > 0) {
    throw new PmUserError('A statement for this owner, building, and month already exists — delete it first to regenerate.');
  }

  $bstmt = $pdo->prepare('SELECT * FROM buildings WHERE id = ?');
  $bstmt->execute([$buildingId]);
  $building = $bstmt->fetch();
  if (!$building) throw new PmUserError('Building not found.');

  $units = $pdo->prepare('SELECT id, number FROM units WHERE building_id = ?');
  $units->execute([$buildingId]);
  $units = $units->fetchAll();
  $unitIds = array_column($units, 'id');

  $leaseStmt = $pdo->prepare('SELECT id, unit_id, tenant_id FROM leases WHERE unit_id IN (' . pm_in_clause($unitIds) . ')');
  $leaseStmt->execute($unitIds ?: [0]);
  $leases = $leaseStmt->fetchAll();
  $leaseIds = array_column($leases, 'id');

  // Unit-by-unit rent due vs. collected, plus late fees and other income
  // (pet/parking/utility reimbursement etc.), building-wide.
  $unitLines = [];
  $rentDueTotal = 0.0; $rentCollectedTotal = 0.0;
  foreach ($units as $u) {
    $unitLeaseIds = array_column(array_filter($leases, fn($l) => $l['unit_id'] == $u['id']), 'id');
    if (!$unitLeaseIds) { $unitLines[] = ['unit' => $u['number'], 'rentDue' => 0, 'rentCollected' => 0]; continue; }
    $due = pm_sum_ledger($pdo, $unitLeaseIds, 'charge', 'rent', $periodStart, $periodEnd);
    $collected = pm_sum_ledger($pdo, $unitLeaseIds, 'payment', 'rent', $periodStart, $periodEnd);
    $rentDueTotal += $due; $rentCollectedTotal += $collected;
    $unitLines[] = ['unit' => $u['number'], 'rentDue' => $due, 'rentCollected' => $collected];
  }
  $lateFees = pm_sum_ledger($pdo, $leaseIds, 'payment', 'late_fee', $periodStart, $periodEnd);
  $otherIncomeUtility = pm_sum_ledger($pdo, $leaseIds, 'payment', 'utility', $periodStart, $periodEnd);
  $otherIncomeOther = pm_sum_ledger($pdo, $leaseIds, 'payment', 'other', $periodStart, $periodEnd);
  $otherIncome = round($otherIncomeUtility + $otherIncomeOther, 2);
  $totalCollected = round($rentCollectedTotal + $lateFees + $otherIncome, 2);

  // Management fee for the whole building this period, this owner's share.
  $rentCollectedForFee = $rentCollectedTotal; // fee always keys off rent actually collected
  if ($building['fee_type'] === 'percent') {
    $feeTotal = $rentCollectedForFee * ((float)$building['fee_value'] / 100);
  } else {
    $activeStmt = $pdo->prepare("SELECT COUNT(*) FROM leases WHERE unit_id IN (" . pm_in_clause($unitIds) . ") AND status = 'active'");
    $activeStmt->execute($unitIds ?: [0]);
    $feeTotal = (float)$building['fee_value'] * (int)$activeStmt->fetchColumn();
  }
  $managementFee = round($feeTotal * $pct / 100, 2);
  if ($managementFee > 0) {
    pm_post_trust($pdo, $ownerId, $buildingId, 'fee', 'management_fee', $periodEnd, $managementFee, "Management fee — $month");
  }

  // Unbilled postage rolled into the same statement, if a rate was given.
  $postageBilled = 0.0; $stampCount = 0;
  if ($stampRate !== null && $stampRate > 0) {
    $stmt = $pdo->prepare('SELECT id, quantity FROM stamp_log WHERE billed = 0 AND owner_id = ? AND (building_id = ? OR building_id IS NULL)');
    $stmt->execute([$ownerId, $buildingId]);
    $unbilled = $stmt->fetchAll();
    if ($unbilled) {
      $stampCount = array_sum(array_map(fn($r) => (int)$r['quantity'], $unbilled));
      $postageBilled = round($stampCount * $stampRate, 2);
      pm_post_trust($pdo, $ownerId, $buildingId, 'fee', 'postage', $periodEnd, $postageBilled, "Postage — {$stampCount} stamp(s) @ " . number_format($stampRate, 2));
      $ids = array_map(fn($r) => (int)$r['id'], $unbilled);
      $pdo->prepare('UPDATE stamp_log SET billed = 1 WHERE id IN (' . pm_in_clause($ids) . ')')->execute($ids);
    }
  }

  // Itemized repairs completed this period (owner's pct share), for
  // display — these already posted as trust expense when marked completed.
  $mstmt = $pdo->prepare(
    "SELECT m.*, v.name AS vendor_name FROM maintenance m LEFT JOIN vendors v ON v.id = m.vendor_id
     WHERE (m.building_id = ? OR m.unit_id IN (" . pm_in_clause($unitIds) . ")) AND m.status = 'completed'
       AND m.date_completed BETWEEN ? AND ?"
  );
  $mstmt->execute(array_merge([$buildingId], $unitIds ?: [0], [$periodStart, $periodEnd]));
  $repairRows = $mstmt->fetchAll();
  $repairItems = [];
  $repairsTotal = 0.0;
  foreach ($repairRows as $m) {
    $share = round((float)$m['cost'] * $pct / 100, 2);
    $repairsTotal += $share;
    $repairItems[] = [
      'date' => $m['date_completed'], 'vendor' => $m['vendor_name'], 'description' => $m['title'],
      'amount' => $share, 'fullCost' => (float)$m['cost'],
    ];
  }
  $repairsTotal = round($repairsTotal, 2);

  // Any other manually-posted fee/expense/adjustment this period, not
  // already counted above (management_fee, postage, repair_expense).
  $stmt = $pdo->prepare(
    "SELECT COALESCE(SUM(CASE WHEN type IN ('fee','expense') THEN amount WHEN type = 'adjustment' AND amount < 0 THEN -amount ELSE 0 END),0)
     FROM trust_transactions WHERE owner_id = ? AND building_id = ? AND date BETWEEN ? AND ?
       AND category NOT IN ('rent_income','other_income','management_fee','postage','repair_expense','disbursement')"
  );
  $stmt->execute([$ownerId, $buildingId, $periodStart, $periodEnd]);
  $otherExpenses = round((float)$stmt->fetchColumn(), 2);

  // Disburse everything above the building's reserve.
  $currentBalance = pm_trust_balance_as_of($pdo, $ownerId, $buildingId, $periodEnd);
  $reserve = (float)$building['reserve_amount'];
  $amountDisbursed = round(max(0, $currentBalance - $reserve), 2);
  if ($amountDisbursed > 0) {
    pm_post_trust($pdo, $ownerId, $buildingId, 'disbursement', 'disbursement', $periodEnd, $amountDisbursed, "Disbursement — $month");
  }
  $endingBalance = round($currentBalance - $amountDisbursed, 2);

  $lineItems = [
    'units' => $unitLines,
    'lateFees' => $lateFees,
    'otherIncome' => ['utility' => $otherIncomeUtility, 'other' => $otherIncomeOther],
    'repairs' => $repairItems,
    'postage' => ['stampCount' => $stampCount, 'amount' => $postageBilled],
    'ownershipPct' => $pct,
  ];

  $ins = $pdo->prepare(
    'INSERT INTO owner_statements
      (owner_id, building_id, period_start, period_end, rent_due, rent_collected, late_fees_collected, other_income,
       management_fee, repairs_total, other_expenses, reserve_held, amount_disbursed, ending_trust_balance, line_items, generated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  $ins->execute([
    $ownerId, $buildingId, $periodStart, $periodEnd, round($rentDueTotal, 2), round($rentCollectedTotal, 2),
    $lateFees, $otherIncome, $managementFee, $repairsTotal, $otherExpenses, $reserve, $amountDisbursed, $endingBalance,
    json_encode($lineItems), $user['id'],
  ]);
  $id = (int)$pdo->lastInsertId();

  return ['ok' => true, 'id' => $id, 'message' => 'Statement generated for ' . $month . ': ' . money_fmt($totalCollected) . ' collected, ' . money_fmt($amountDisbursed) . ' disbursed, ' . money_fmt($endingBalance) . ' held in trust.'];
}

function pm_sum_ledger(PDO $pdo, array $leaseIds, string $type, string $category, string $start, string $end): float {
  if (!$leaseIds) return 0.0;
  $stmt = $pdo->prepare('SELECT COALESCE(SUM(amount),0) FROM ledger WHERE lease_id IN (' . pm_in_clause($leaseIds) . ') AND type = ? AND category = ? AND date BETWEEN ? AND ?');
  $stmt->execute(array_merge($leaseIds, [$type, $category, $start, $end]));
  return round((float)$stmt->fetchColumn(), 2);
}

/* =========================================================
   OWNER TRANSFERS — closing out a building sale. Only the trust cash
   balance and building_owners move; security deposits are keyed to
   building_id, not owner_id (see security_deposits above), so they
   already stay attached to the building and need no transfer step —
   this call records what was on file at the moment of transfer as the
   disclosure/audit trail for what the incoming owner assumed.
   ========================================================= */
function pm_transfer_owner(PDO $pdo, array $user, array $body): array {
  $buildingId = (int)($body['buildingId'] ?? 0);
  $fromOwnerId = (int)($body['fromOwnerId'] ?? 0);
  $toOwnerId = (int)($body['toOwnerId'] ?? 0);
  $date = (string)($body['transferDate'] ?? date('Y-m-d'));
  $notes = (string)($body['notes'] ?? '');
  if (!$buildingId || !$fromOwnerId || !$toOwnerId) throw new PmUserError('Choose the building, outgoing owner, and incoming owner.');
  if ($fromOwnerId === $toOwnerId) throw new PmUserError('Outgoing and incoming owner must be different.');

  $stmt = $pdo->prepare('SELECT pct FROM building_owners WHERE building_id = ? AND owner_id = ?');
  $stmt->execute([$buildingId, $fromOwnerId]);
  $pct = $stmt->fetchColumn();
  if ($pct === false) throw new PmUserError('That owner has no stake in this building.');
  $pct = (float)$pct;

  $balance = pm_trust_balance_as_of($pdo, $fromOwnerId, $buildingId, $date);

  $dstmt = $pdo->prepare('SELECT COUNT(*), COALESCE(SUM(amount_held),0) FROM security_deposits WHERE building_id = ? AND status IN ("held","partially_refunded")');
  $dstmt->execute([$buildingId]);
  [$depositCount, $depositTotal] = $dstmt->fetch(PDO::FETCH_NUM);

  $pdo->prepare(
    'INSERT INTO owner_transfers (building_id, from_owner_id, to_owner_id, transfer_date, ownership_pct, trust_balance_transferred, deposits_transferred_count, deposits_transferred_total, notes, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)'
  )->execute([$buildingId, $fromOwnerId, $toOwnerId, $date, $pct, $balance, (int)$depositCount, (float)$depositTotal, $notes ?: null, $user['id']]);
  $transferId = (int)$pdo->lastInsertId();

  if (abs($balance) > 0.005) {
    pm_post_trust($pdo, $fromOwnerId, $buildingId, 'transfer_out', 'transfer', $date, abs($balance), 'Ownership transfer — trust balance out', null, null, $transferId);
    pm_post_trust($pdo, $toOwnerId, $buildingId, 'transfer_in', 'transfer', $date, abs($balance), 'Ownership transfer — trust balance in', null, null, $transferId);
  }

  $pdo->prepare('DELETE FROM building_owners WHERE building_id = ? AND owner_id = ?')->execute([$buildingId, $fromOwnerId]);
  $existing = $pdo->prepare('SELECT id FROM building_owners WHERE building_id = ? AND owner_id = ?');
  $existing->execute([$buildingId, $toOwnerId]);
  if ($existing->fetchColumn()) {
    $pdo->prepare('UPDATE building_owners SET pct = pct + ? WHERE building_id = ? AND owner_id = ?')->execute([$pct, $buildingId, $toOwnerId]);
  } else {
    $pdo->prepare('INSERT INTO building_owners (building_id, owner_id, pct) VALUES (?,?,?)')->execute([$buildingId, $toOwnerId, $pct]);
  }

  return ['ok' => true, 'message' => "Transferred {$pct}% ownership, " . money_fmt($balance) . ' in trust, and disclosed ' . $depositCount . ' security deposit(s) totalling ' . money_fmt((float)$depositTotal) . '.'];
}

function money_fmt(float $n): string { return '$' . number_format($n, 2); }

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
  $hourlyRate = ($r['hourlyRate'] ?? '') === '' ? null : (float)$r['hourlyRate'];

  if ($username === '') return ['ok' => false, 'message' => 'Username is required.'];
  if ($role === 'owner' && !$ownerId) return ['ok' => false, 'message' => 'An owner-role login must be linked to an owner.'];

  if ($id) {
    if ($password !== '') {
      $pdo->prepare('UPDATE users SET username=?, role=?, owner_id=?, display_name=?, email=?, hourly_rate=?, password_hash=? WHERE id=?')
        ->execute([$username, $role, $ownerId, $displayName, $email, $hourlyRate, password_hash($password, PASSWORD_DEFAULT), $id]);
    } else {
      $pdo->prepare('UPDATE users SET username=?, role=?, owner_id=?, display_name=?, email=?, hourly_rate=? WHERE id=?')
        ->execute([$username, $role, $ownerId, $displayName, $email, $hourlyRate, $id]);
    }
  } else {
    if ($password === '') return ['ok' => false, 'message' => 'Password is required for a new user.'];
    try {
      $pdo->prepare('INSERT INTO users (username, password_hash, role, owner_id, display_name, email, hourly_rate) VALUES (?,?,?,?,?,?,?)')
        ->execute([$username, password_hash($password, PASSWORD_DEFAULT), $role, $ownerId, $displayName, $email, $hourlyRate]);
      $id = (int)$pdo->lastInsertId();
    } catch (PDOException $e) {
      if ($e->getCode() === '23000') return ['ok' => false, 'message' => 'That username is already taken.'];
      throw $e;
    }
  }
  return ['ok' => true, 'id' => $id];
}
