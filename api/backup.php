<?php
/* ============================================================
   backup.php — sao lưu hằng đêm.

   Cron Jobs của Hostinger (hPanel → Nâng cao → Cron Jobs) chạy:
       /usr/bin/php /home/uXXXX/domains/<tên miền>/public_html/api/backup.php
   lúc 23:30 mỗi ngày. Chép cơ sở dữ liệu, nén + khoá mật khẩu, giữ 30
   bản trên máy chủ, gửi một bản vào Gmail (xem mhBackupRun ở lib.php).

   Gọi qua trình duyệt thì phải kèm ?key=MH_BACKUP_KEY — để phòng gói
   hosting chỉ cho cron gọi đường link.
   ============================================================ */
declare(strict_types=1);

require __DIR__ . '/lib.php';

if (PHP_SAPI !== 'cli') {
  header('Content-Type: text/plain; charset=utf-8');
  header('Cache-Control: no-store');
  if (!defined('MH_BACKUP_KEY') || strlen((string)MH_BACKUP_KEY) < 16
      || !hash_equals((string)MH_BACKUP_KEY, (string)($_GET['key'] ?? ''))) {
    http_response_code(403);
    exit("Forbidden\n");
  }
}

$r = mhBackupRun(true);
echo ($r['ok'] ? 'OK ' . $r['name'] . ' ' . $r['size'] . ' bytes' . ($r['mailed'] ? ' · đã gửi mail' : ' · không gửi mail')
               : 'LỖI') . ($r['error'] !== '' ? ' · ' . $r['error'] : '') . "\n";
exit($r['ok'] && $r['error'] === '' ? 0 : 1);
