<?php
declare(strict_types=1);
require_once __DIR__ . '/db.php';

const PM_MAX_LOGIN_ATTEMPTS = 5;
const PM_LOCKOUT_MINUTES = 15;

/** Thrown for expected, user-facing errors — safe to show verbatim to the client. */
class PmUserError extends Exception {}

function pm_is_https(): bool {
  if (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off') return true;
  if (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') return true;
  if ((string)($_SERVER['SERVER_PORT'] ?? '') === '443') return true;
  return false;
}

function pm_start_session(): void {
  if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params([
      'lifetime' => 0,
      'path' => '/',
      'httponly' => true,
      'samesite' => 'Lax',
      'secure' => pm_is_https(), // automatically on once served over https
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

/**
 * Attempts a login. Returns ['ok' => bool, 'error' => ?string].
 * 'error' is only set for a message worth showing distinctly (e.g. lockout);
 * a plain wrong-username-or-password failure leaves it null so the caller
 * can show its own generic message without revealing which part was wrong.
 */
function pm_attempt_login(string $username, string $password): array {
  $pdo = pm_db();
  $stmt = $pdo->prepare('SELECT * FROM users WHERE username = ?');
  $stmt->execute([$username]);
  $row = $stmt->fetch();

  // Roughly constant-time whether or not the username exists, to make
  // account enumeration and scripted brute-forcing slower.
  usleep(300000);

  if ($row && $row['locked_until'] !== null && strtotime($row['locked_until']) > time()) {
    return ['ok' => false, 'error' => 'Too many failed attempts on this account. Try again in a few minutes.'];
  }

  if (!$row || !password_verify($password, $row['password_hash'])) {
    if ($row) {
      pm_register_login_failure($pdo, (int)$row['id'], (int)$row['failed_attempts']);
    }
    return ['ok' => false, 'error' => null];
  }

  if ((int)$row['failed_attempts'] > 0 || $row['locked_until'] !== null) {
    $pdo->prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?')->execute([$row['id']]);
  }

  pm_start_session();
  session_regenerate_id(true);
  $_SESSION['user'] = [
    'id' => (int)$row['id'],
    'username' => $row['username'],
    'role' => $row['role'],
    'owner_id' => $row['owner_id'] !== null ? (int)$row['owner_id'] : null,
    'display_name' => $row['display_name'],
    'must_change_password' => (bool)$row['must_change_password'],
  ];
  return ['ok' => true, 'error' => null];
}

function pm_register_login_failure(PDO $pdo, int $userId, int $currentAttempts): void {
  $attempts = $currentAttempts + 1;
  if ($attempts >= PM_MAX_LOGIN_ATTEMPTS) {
    $pdo->prepare('UPDATE users SET failed_attempts = ?, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?')
      ->execute([$attempts, PM_LOCKOUT_MINUTES, $userId]);
  } else {
    $pdo->prepare('UPDATE users SET failed_attempts = ? WHERE id = ?')->execute([$attempts, $userId]);
  }
}

function pm_logout(): void {
  pm_start_session();
  $_SESSION = [];
  session_destroy();
}
