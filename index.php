<?php
declare(strict_types=1);
require_once __DIR__ . '/auth.php';

$user = pm_current_user();
if (!$user) {
  header('Location: login.php');
  exit;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ledgerstone — Property Management</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/style.css">
</head>
<body>
<div id="app"><div style="padding:40px;font-family:sans-serif;color:#5A6B7D;">Loading…</div></div>
<script>
  window.PM_CSRF = <?= json_encode(pm_csrf_token()) ?>;
  window.PM_USER = <?= json_encode(['id'=>$user['id'],'username'=>$user['username'],'role'=>$user['role'],'displayName'=>$user['display_name'],'ownerId'=>$user['owner_id'],'mustChangePassword'=>!empty($user['must_change_password'])]) ?>;
</script>
<script src="assets/app.js"></script>
</body>
</html>
