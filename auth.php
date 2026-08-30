<?php
declare(strict_types=1);
require_once __DIR__ . '/db.php';

function pm_start_session(): void {
  if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params([
      'lifetime' => 0,
      'path' => '/',
      'httponly' => true,
      'samesite' => 'Lax',
      // 'secure' => true, // uncomment once you're serving over https (recommended)
    ]);
    session_start();
  }
}

function pm_current_user(): ?array {
  pm_start_session();
  return $_SESSION['user'] ?? null;
}

function pm_require_login(): array {
  $u = pm_current_user();
  if (!$u) {
    header('Content-Type: application/json');
    http_response_code(401);
    echo json_encode(['error' => 'Not logged in']);
    exit;
  }
  return $u;
}

function pm_require_admin(): array {
  $u = pm_require_login();
  if ($u['role'] !== 'admin') {
    header('Content-Type: application/json');
    http_response_code(403);
    echo json_encode(['error' => 'Admin access required']);
    exit;
  }
  return $u;
}

function pm_csrf_token(): string {
  pm_start_session();
  if (empty($_SESSION['csrf'])) {
    $_SESSION['csrf'] = bin2hex(random_bytes(32));
  }
  return $_SESSION['csrf'];
}

function pm_check_csrf(): void {
  pm_start_session();
  $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
  if (!$sent || !hash_equals($_SESSION['csrf'] ?? '', $sent)) {
    header('Content-Type: application/json');
    http_response_code(403);
    echo json_encode(['error' => 'Bad CSRF token, refresh the page and try again']);
    exit;
  }
}

function pm_attempt_login(string $username, string $password): bool {
  $stmt = pm_db()->prepare('SELECT * FROM users WHERE username = ?');
  $stmt->execute([$username]);
  $row = $stmt->fetch();
  if (!$row || !password_verify($password, $row['password_hash'])) {
    return false;
  }
  pm_start_session();
  session_regenerate_id(true);
  $_SESSION['user'] = [
    'id' => (int)$row['id'],
    'username' => $row['username'],
    'role' => $row['role'],
    'owner_id' => $row['owner_id'] !== null ? (int)$row['owner_id'] : null,
    'display_name' => $row['display_name'],
  ];
  return true;
}

function pm_logout(): void {
  pm_start_session();
  $_SESSION = [];
  session_destroy();
}
