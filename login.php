<?php
declare(strict_types=1);
require_once __DIR__ . '/auth.php';

pm_start_session();
if (pm_current_user()) {
  header('Location: index.php');
  exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $username = trim($_POST['username'] ?? '');
  $password = (string)($_POST['password'] ?? '');
  if ($username !== '' && $password !== '' && pm_attempt_login($username, $password)) {
    header('Location: index.php');
    exit;
  }
  $error = 'Incorrect username or password.';
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Log in — Ledgerstone</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@600&display=swap" rel="stylesheet">
<style>
  :root{ --ink:#1B2A41; --paper:#F4F6F8; --accent:#2F6690; --accent-dark:#1F4E70; --line:#DCE2E8; --bad:#B23A3A; --bad-bg:#FBEAEA; }
  *{box-sizing:border-box;}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--paper);font-family:'IBM Plex Sans',system-ui,sans-serif;color:var(--ink);}
  .card{background:#fff;border:1px solid var(--line);border-radius:10px;padding:36px 34px;width:100%;max-width:360px;box-shadow:0 10px 30px rgba(20,30,45,0.08);}
  .mark{font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:20px;margin-bottom:2px;}
  .sub{font-size:12.5px;color:#5A6B7D;margin-bottom:24px;letter-spacing:.03em;text-transform:uppercase;}
  label{display:block;font-size:12px;font-weight:600;color:#5A6B7D;margin-bottom:5px;text-transform:uppercase;letter-spacing:.03em;}
  input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:6px;font-size:14px;font-family:inherit;margin-bottom:16px;background:#fbfcfd;}
  button{width:100%;padding:11px;border:none;border-radius:6px;background:var(--accent);color:#fff;font-size:14.5px;font-weight:600;cursor:pointer;font-family:inherit;}
  button:hover{background:var(--accent-dark);}
  .error{background:var(--bad-bg);color:var(--bad);padding:9px 12px;border-radius:6px;font-size:13px;margin-bottom:16px;}
</style>
</head>
<body>
  <form class="card" method="post" autocomplete="on">
    <div class="mark">Ledgerstone</div>
    <div class="sub">Property Operations</div>
    <?php if ($error): ?><div class="error"><?= htmlspecialchars($error) ?></div><?php endif; ?>
    <label for="username">Username</label>
    <input id="username" name="username" type="text" required autofocus>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" required>
    <button type="submit">Log in</button>
  </form>
</body>
</html>
