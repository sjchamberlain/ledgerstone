<?php
declare(strict_types=1);
require_once __DIR__ . '/auth.php';

// PDF export for a generated owner statement. Separate from api.php
// because the response body is binary (a PDF), not JSON.
//
// Requires dompdf, the app's one Composer dependency — see composer.json.
// Run `composer install` once on the server (or locally, then upload the
// vendor/ folder) before this will produce a real PDF; until then it
// shows a plain explanation instead of a fatal error.

$user = pm_require_login();
$pdo = pm_db();

$id = (int)($_GET['id'] ?? 0);
if (!$id) { http_response_code(400); echo 'Missing statement id.'; exit; }

$stmt = $pdo->prepare('SELECT * FROM owner_statements WHERE id = ?');
$stmt->execute([$id]);
$statement = $stmt->fetch();
if (!$statement) { http_response_code(404); echo 'Statement not found.'; exit; }

if ($user['role'] !== 'admin' && (int)$statement['owner_id'] !== (int)$user['owner_id']) {
  http_response_code(403);
  echo 'Not authorized to view this statement.';
  exit;
}

$stmt = $pdo->prepare('SELECT * FROM owners WHERE id = ?');
$stmt->execute([$statement['owner_id']]);
$owner = $stmt->fetch();

$stmt = $pdo->prepare('SELECT * FROM buildings WHERE id = ?');
$stmt->execute([$statement['building_id']]);
$building = $stmt->fetch();

$lineItems = json_decode($statement['line_items'], true) ?: [];

function pm_pdf_money(float $n): string {
  $neg = $n < 0;
  return ($neg ? '-' : '') . '$' . number_format(abs($n), 2);
}
function pm_pdf_esc(?string $s): string { return htmlspecialchars($s ?? '', ENT_QUOTES, 'UTF-8'); }
function pm_pdf_date(?string $d): string { return $d ? date('M j, Y', strtotime($d)) : '—'; }

$periodLabel = date('F Y', strtotime($statement['period_start']));

ob_start();
?>
<style>
  body { font-family: Helvetica, Arial, sans-serif; font-size: 12px; color: #1a2530; }
  h1 { font-size: 18px; margin-bottom: 2px; }
  h2 { font-size: 13px; margin: 18px 0 6px; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
  .sub { color: #5a6b7a; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #e5e9ec; font-size: 11.5px; }
  th { color: #5a6b7a; font-weight: 600; }
  td.num, th.num { text-align: right; }
  .totals td { font-weight: 700; border-top: 2px solid #1a2530; border-bottom: none; }
  .net-box { margin-top: 16px; padding: 12px; background: #f4f6f7; }
  .net-box div { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .net-box .final { font-weight: 700; font-size: 14px; border-top: 1px solid #ccc; padding-top: 6px; margin-top: 6px; }
</style>
<h1>Owner Statement — <?= pm_pdf_esc($building['name']) ?></h1>
<div class="sub"><?= pm_pdf_esc($owner['name']) ?> · <?= pm_pdf_esc($periodLabel) ?></div>

<h2>Income</h2>
<table>
  <thead><tr><th>Unit</th><th class="num">Rent Due</th><th class="num">Rent Collected</th></tr></thead>
  <tbody>
    <?php foreach (($lineItems['units'] ?? []) as $u): ?>
      <tr><td><?= pm_pdf_esc($u['unit']) ?></td><td class="num"><?= pm_pdf_money((float)$u['rentDue']) ?></td><td class="num"><?= pm_pdf_money((float)$u['rentCollected']) ?></td></tr>
    <?php endforeach; ?>
    <tr class="totals"><td>Total</td><td class="num"><?= pm_pdf_money((float)$statement['rent_due']) ?></td><td class="num"><?= pm_pdf_money((float)$statement['rent_collected']) ?></td></tr>
  </tbody>
</table>
<table>
  <tbody>
    <tr><td>Late fees collected</td><td class="num"><?= pm_pdf_money((float)$statement['late_fees_collected']) ?></td></tr>
    <tr><td>Other income (utility / pet / parking reimbursement, etc.)</td><td class="num"><?= pm_pdf_money((float)$statement['other_income']) ?></td></tr>
    <tr class="totals"><td>Total collected</td><td class="num"><?= pm_pdf_money((float)$statement['rent_collected'] + (float)$statement['late_fees_collected'] + (float)$statement['other_income']) ?></td></tr>
  </tbody>
</table>

<h2>Expenses</h2>
<table>
  <tbody>
    <tr><td>Management fee</td><td class="num"><?= pm_pdf_money((float)$statement['management_fee']) ?></td></tr>
  </tbody>
</table>
<?php if (!empty($lineItems['repairs'])): ?>
<table>
  <thead><tr><th>Date</th><th>Vendor</th><th>Description</th><th class="num">Amount</th></tr></thead>
  <tbody>
    <?php foreach ($lineItems['repairs'] as $r): ?>
      <tr><td><?= pm_pdf_date($r['date']) ?></td><td><?= pm_pdf_esc($r['vendor'] ?: '—') ?></td><td><?= pm_pdf_esc($r['description']) ?></td><td class="num"><?= pm_pdf_money((float)$r['amount']) ?></td></tr>
    <?php endforeach; ?>
  </tbody>
</table>
<?php endif; ?>
<table>
  <tbody>
    <tr><td>Repairs &amp; maintenance</td><td class="num"><?= pm_pdf_money((float)$statement['repairs_total']) ?></td></tr>
    <?php if (!empty($lineItems['postage']['amount'])): ?>
      <tr><td>Postage (<?= (int)$lineItems['postage']['stampCount'] ?> stamp(s))</td><td class="num"><?= pm_pdf_money((float)$lineItems['postage']['amount']) ?></td></tr>
    <?php endif; ?>
    <?php if ((float)$statement['other_expenses'] > 0): ?>
      <tr><td>Other expenses</td><td class="num"><?= pm_pdf_money((float)$statement['other_expenses']) ?></td></tr>
    <?php endif; ?>
    <tr class="totals"><td>Total expenses</td><td class="num"><?= pm_pdf_money((float)$statement['management_fee'] + (float)$statement['repairs_total'] + (float)($lineItems['postage']['amount'] ?? 0) + (float)$statement['other_expenses']) ?></td></tr>
  </tbody>
</table>

<div class="net-box">
  <div><span>Reserve held back</span><span><?= pm_pdf_money((float)$statement['reserve_held']) ?></span></div>
  <div class="final"><span>Amount disbursed to owner</span><span><?= pm_pdf_money((float)$statement['amount_disbursed']) ?></span></div>
  <div><span>Ending trust balance for this building</span><span><?= pm_pdf_money((float)$statement['ending_trust_balance']) ?></span></div>
</div>
<?php
$html = ob_get_clean();

$autoload = __DIR__ . '/vendor/autoload.php';
if (!file_exists($autoload)) {
  http_response_code(500);
  header('Content-Type: text/html; charset=utf-8');
  echo '<h1>PDF export not set up yet</h1><p>This server hasn\'t run <code>composer install</code> yet, so the dompdf '
     . 'library isn\'t available. Run <code>composer install</code> in this app\'s folder (via SSH, or cPanel\'s '
     . '"Setup Node.js/PHP App" Composer button), then reload this page.</p>'
     . '<p>In the meantime, use the statement\'s <strong>Print</strong> view and your browser\'s "Save as PDF."</p>';
  exit;
}
require_once $autoload;

$dompdf = new \Dompdf\Dompdf(['isRemoteEnabled' => false]);
$dompdf->loadHtml($html);
$dompdf->setPaper('letter', 'portrait');
$dompdf->render();

$filename = 'owner-statement-' . preg_replace('/[^a-z0-9]+/i', '-', $building['name']) . '-' . $statement['period_start'] . '.pdf';
$dompdf->stream($filename, ['Attachment' => true]);
