<?php
/* ============================================================
   lib.php — phần dùng chung của index.php.

   Hai nguyên tắc xuyên suốt:
   1. Mọi mốc thời gian do máy chủ sinh bằng time(). Quầy không gửi
      được ngày giờ lên — không có chuyện ghi lùi ngày cho khách quen.
   2. Hạng và quà KHÔNG lưu sẵn, luôn tính lại từ các lượt ghé.
   Giữ mã ở mức PHP 8.0: gói hosting có thể chưa lên 8.1, và lỗi cú pháp
   trên đó là trang trắng không một lời báo.
   ============================================================ */
declare(strict_types=1);

function mhFail(string $msg, int $code = 500) {
  if (function_exists('out')) out(['ok' => false, 'error' => $msg], $code);
  http_response_code($code);
  header('Content-Type: text/plain; charset=utf-8');
  echo $msg;
  exit;
}

/* ---------------- cấu hình ----------------
   Tìm config.php ở hai nơi:
     1. <cha của public_html>/memberhub-data/config.php — nên dùng
     2. api/config.php — ngay cạnh mã nguồn
   Chỗ 1 nằm ngoài thư mục web: trình duyệt không với tới, và upload đè
   app không đụng tới.                                                  */
$MH_DATA_DIR = dirname(__DIR__, 2) . '/memberhub-data';

$cfg = null;
foreach ([$MH_DATA_DIR . '/config.php', __DIR__ . '/config.php'] as $p)
  if (is_file($p)) { $cfg = $p; break; }
if (!$cfg)
  mhFail('Chưa có config.php — chép api/config.example.php thành config.php rồi dán mã mật khẩu vào. '
       . 'Muốn để ngoài public_html thì đặt ở: ' . $MH_DATA_DIR . '/config.php', 503);
require $cfg;

if (!defined('MH_OWNER_USER') || MH_OWNER_USER === '')
  mhFail('Chưa đặt MH_OWNER_USER trong config.php.', 503);
if (!defined('MH_OWNER_PASS') || MH_OWNER_PASS === '')
  mhFail('Chưa đặt mật khẩu chủ trong config.php. Chạy "node tools/hash-password.js" để tạo mã rồi dán vào.', 503);
/* Kiểm đúng DẠNG mã, không chỉ dò chữ mẫu. Trước đây chỉ chặn đúng chữ
   "DAN_MA_VAO_DAY", nên dòng mẫu có dấu, mật khẩu thật dán thẳng vào, hay
   mã bị PHP nuốt mất đoạn "$abc" vì để trong nháy kép… đều lọt qua — tài
   khoản chủ được tạo với mã hỏng và gõ mật khẩu nào cũng "Sai mật khẩu". */
if (!preg_match('~^pbkdf2_sha256\$\d+\$[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*$~', MH_OWNER_PASS))
  mhFail('Dòng MH_OWNER_PASS trong config.php chưa đúng. Nó phải là mã dài bắt đầu bằng "pbkdf2_sha256$210000$…" '
       . '(không phải mật khẩu thật), đặt trong dấu nháy ĐƠN: define(\'MH_OWNER_PASS\', \'pbkdf2_sha256$…\'); '
       . '— chạy "node tools/hash-password.js" rồi chép nguyên dòng nó in ra.', 503);

if (!defined('MH_TZ'))           define('MH_TZ', 'Asia/Ho_Chi_Minh');
if (!defined('MH_SHOP_NAME'))    define('MH_SHOP_NAME', 'Barbershop');
if (!defined('MH_UNDO_MINUTES')) define('MH_UNDO_MINUTES', 15);
if (!defined('MH_MIN_PASSWORD')) define('MH_MIN_PASSWORD', 6);
date_default_timezone_set(MH_TZ);

/* Chỗ cất cơ sở dữ liệu, theo thứ tự:
     1. MH_DB_FILE trong config.php
     2. memberhub-data/ cạnh public_html, nếu thư mục đó có
     3. api/data/                                                        */
if (defined('MH_DB_FILE'))      $DB_FILE = MH_DB_FILE;
elseif (is_dir($MH_DATA_DIR))   $DB_FILE = $MH_DATA_DIR . '/memberhub.sqlite';
else                            $DB_FILE = __DIR__ . '/data/memberhub.sqlite';

/* Loại dịch vụ. Chỗ duy nhất định nghĩa — giao diện hỏi máy chủ để lấy. */
const MH_KINDS = [
  'cut'     => 'Cắt tóc',
  'perm'    => 'Uốn / ép',
  'color'   => 'Nhuộm / tẩy',
  'care'    => 'Cạo, ráy tai, chăm sóc',
  'product' => 'Sản phẩm',
  'other'   => 'Khác',
];

/* ---------------- kết nối ---------------- */

function db(): PDO {
  static $pdo = null;
  if ($pdo) return $pdo;
  global $DB_FILE;

  if (!in_array('sqlite', PDO::getAvailableDrivers(), true))
    mhFail('Hosting này không bật pdo_sqlite.', 503);

  $dir = dirname($DB_FILE);
  if (!is_dir($dir)) @mkdir($dir, 0700, true);
  /* Phòng khi thư mục dữ liệu lỡ nằm trong public_html: chặn tải về. Trong
     đó có số điện thoại của cả tệp khách. */
  if (is_dir($dir) && !is_file($dir . '/.htaccess'))
    @file_put_contents($dir . '/.htaccess', "Require all denied\nOrder allow,deny\nDeny from all\n");

  try {
    $pdo = new PDO('sqlite:' . $DB_FILE, null, null, [
      PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
  } catch (Throwable $e) {
    mhFail('Không mở được cơ sở dữ liệu ở ' . $dir . ': ' . $e->getMessage(), 503);
  }
  $pdo->exec('PRAGMA foreign_keys = ON');
  $pdo->exec('PRAGMA busy_timeout = 5000');
  mhMigrate($pdo);
  return $pdo;
}

function mhMigrate(PDO $pdo): void {
  $sql = @file_get_contents(__DIR__ . '/schema.sql');
  if ($sql === false) mhFail('Thiếu file api/schema.sql.', 500);
  $pdo->exec($sql);

  /* "CREATE TABLE IF NOT EXISTS" không thêm cột vào bảng đã có — máy đang
     chạy bản cũ phải tự vá. Chỉ mục trên cột mới cũng phải đặt SAU khi vá,
     không thì schema.sql chạy trên CSDL cũ báo "no such column". */
  mhAddColumn($pdo, 'visits', 'barber_id', 'INTEGER');
  $pdo->exec('CREATE INDEX IF NOT EXISTS idx_visit_barber ON visits(barber_id, visit_date)');

  if ((int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0) {
    mhSyncOwnerFromConfig($pdo);
    return;
  }

  /* Lần đầu chạy: dựng sẵn tài khoản chủ, dịch vụ theo đúng mã hàng trong
     file KiotViet của quán, bốn hạng và hai chương trình — mở app lên là
     dùng được ngay, chủ chỉ việc sửa lại cho hợp. */
  $now = time();
  $pdo->prepare('INSERT INTO users (name, username, pass_hash, role, created_at) VALUES (?,?,?,?,?)')
      ->execute(['Chủ quán', mb_strtolower(MH_OWNER_USER), MH_OWNER_PASS, 'owner', $now]);
  $pdo->prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('owner_pass_config', ?)")
      ->execute([hash('sha256', MH_OWNER_PASS . '|' . mb_strtolower(MH_OWNER_USER))]);

  $sv = $pdo->prepare('INSERT INTO services (name, kind, price, kv_codes, sort) VALUES (?,?,?,?,?)');
  $i = 0;
  foreach ([
    ['Premium Haircut',          'cut',     120000, 'HC'],
    ['Premium Haircut – HSSV',   'cut',     120000, 'SP000094'],
    ['Combo Chill',              'cut',     200000, 'SP000098'],
    ['Combo Shine',              'cut',     220000, 'SP000099'],
    ['Combo Chill & Shine',      'cut',     300000, 'SP000100'],
    ['Baby Haircut',             'other',    30000, 'BHC'],
    ['Uốn – Premium Hair Curl',  'perm',    700000, 'HCu'],
    ['Ép side',                  'perm',    250000, 'SP000088'],
    ['Nhuộm – Premium Hair Color','color',  700000, 'HCl'],
    ['Tẩy tóc',                  'color',   250000, 'SP000086'],
    ['Phục hồi tóc',             'care',    300000, 'SP000087'],
    ['Cạo râu',                  'care',     90000, 'SP000097'],
    ['Cạo râu & mặt',            'care',    120000, 'BS'],
    ['Cạo mặt',                  'care',     70000, 'SP000096'],
    ['Lấy ráy tai',              'care',     90000, 'SP000095,SP000101'],
    ['Sản phẩm',                 'product',      0, 'SP000084,SP000085,SP000089'],
  ] as $s) $sv->execute([$s[0], $s[1], $s[2], $s[3], ++$i]);

  $t = $pdo->prepare('INSERT INTO tiers (name, color, min_cuts, min_spend, perks, sort) VALUES (?,?,?,?,?,?)');
  /* Đặc quyền chỉ là gợi ý để quầy có cái mà nói với khách — chủ sửa ở
     Thiết lập → Hạng. Mỗi dòng một điều. */
  $t->execute(['Đồng', '#b87333', 0,  0,       "Tích lượt nhận quà mốc 3 – 7 – 10\nTặng tinh dầu mỗi lần uốn", 1]);
  $t->execute(['Bạc',  '#aab4c3', 5,  1000000, "Giảm 5% sản phẩm", 2]);
  $t->execute(['Vàng', '#e2b33c', 10, 2000000, "Giảm 10% sản phẩm\nƯu tiên đặt lịch giờ cao điểm", 3]);
  $t->execute(['Đen',  '#1b1b1f', 15, 3500000, "Giảm 12% sản phẩm\nƯu tiên đặt lịch giờ cao điểm\nQuà sinh nhật", 4]);

  $p = $pdo->prepare('INSERT INTO programs (name, kind, steps, repeat, start_date, sort, created_at)
                      VALUES (?,?,?,?,?,?,?)');
  $p->execute(['Cắt tóc 3 - 7 - 10', 'cut', json_encode([
      ['at' => 3,  'gift' => 'Quà mốc 3 (sửa ở Thiết lập)'],
      ['at' => 7,  'gift' => 'Quà mốc 7 (sửa ở Thiết lập)'],
      ['at' => 10, 'gift' => 'Quà mốc 10 (sửa ở Thiết lập)'],
    ], JSON_UNESCAPED_UNICODE), 1, mhToday(), 1, $now]);
  $p->execute(['Uốn tặng tinh dầu', 'perm', json_encode([
      ['at' => 1, 'gift' => 'Tinh dầu dưỡng tóc'],
    ], JSON_UNESCAPED_UNICODE), 1, mhToday(), 2, $now]);
}

/* config.php là chỗ quyết định mật khẩu chủ: sửa dòng MH_OWNER_PASS (hoặc
   MH_OWNER_USER) là lần mở trang kế tiếp tài khoản chủ đổi theo. Trước đây
   mã chỉ được đọc ĐÚNG MỘT LẦN lúc tạo tài khoản — lỡ lần đầu mã hỏng thì
   sửa config bao nhiêu cũng vô ích, chủ bị khoá ngoài app vĩnh viễn.

   Đổi mật khẩu trong app vẫn giữ được: chỉ khi dòng trong config KHÁC lần
   áp gần nhất (so bằng mã băm lưu ở settings) mới ghi đè. Ai sửa được
   config.php thì đã có quyền cả máy chủ, nên đây không mở thêm cửa nào. */
function mhSyncOwnerFromConfig(PDO $pdo): void {
  $dau = hash('sha256', MH_OWNER_PASS . '|' . mb_strtolower(MH_OWNER_USER));
  $st = $pdo->query("SELECT value FROM settings WHERE key = 'owner_pass_config'");
  if ($st->fetchColumn() === $dau) return;
  $id = $pdo->query("SELECT id FROM users WHERE role = 'owner' ORDER BY id LIMIT 1")->fetchColumn();
  if (!$id) return;
  $ten = mb_strtolower(MH_OWNER_USER);
  /* Tên đăng nhập mới trùng một tài khoản quầy thì giữ tên cũ, chỉ đổi mật khẩu. */
  $trung = $pdo->prepare('SELECT 1 FROM users WHERE username = ? AND id <> ?');
  $trung->execute([$ten, $id]);
  if ($trung->fetchColumn())
    $pdo->prepare('UPDATE users SET pass_hash = ?, active = 1 WHERE id = ?')->execute([MH_OWNER_PASS, $id]);
  else
    $pdo->prepare('UPDATE users SET pass_hash = ?, username = ?, active = 1 WHERE id = ?')->execute([MH_OWNER_PASS, $ten, $id]);
  $pdo->prepare('DELETE FROM sessions WHERE user_id = ?')->execute([$id]);
  $pdo->exec('DELETE FROM login_attempts');       // gỡ luôn khoá 5 phút vì gõ sai nhiều lần
  $pdo->prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('owner_pass_config', ?)")->execute([$dau]);
  $pdo->prepare('INSERT INTO audit_log (user_id, action, detail, ip, created_at) VALUES (?,?,?,?,?)')
      ->execute([$id, 'owner_reset', 'Mật khẩu chủ đặt lại từ config.php', (string)($_SERVER['REMOTE_ADDR'] ?? ''), time()]);
}

function mhAddColumn(PDO $pdo, string $bang, string $cot, string $kieu): void {
  foreach ($pdo->query("PRAGMA table_info($bang)")->fetchAll() as $c) if ($c['name'] === $cot) return;
  $pdo->exec("ALTER TABLE $bang ADD COLUMN $cot $kieu");
}

/* ---------------- tiện ích ---------------- */

function mhToday(?int $at = null): string { return date('Y-m-d', $at ?? time()); }

/* +84 912… và 0912… là cùng một số. */
function mhPhone(string $s): string {
  $s = preg_replace('/\D/', '', $s);
  if (strncmp($s, '84', 2) === 0 && strlen($s) >= 11) $s = '0' . substr($s, 2);
  return $s;
}

/* Số che bớt cho tài khoản quầy: 077***7489. Đủ để khách nhận ra số của
   mình, không đủ để chép cả tệp khách đem đi. */
function mhMask(string $phone): string {
  if (strlen($phone) < 7) return $phone;
  return substr($phone, 0, 3) . '***' . substr($phone, -4);
}

/* Bỏ dấu để tìm tên — SQLite LIKE không hiểu "Đức" với "duc". */
function mhFold(string $s): string {
  $s = mb_strtolower(trim($s));
  $s = str_replace('đ', 'd', $s);
  if (class_exists('Normalizer')) {
    $s = Normalizer::normalize($s, Normalizer::FORM_D);
    $s = preg_replace('/\p{Mn}/u', '', $s);
  } else {
    $s = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s) ?: $s;
  }
  return $s;
}

function mhSetting(string $key, ?string $default = null): ?string {
  $st = db()->prepare('SELECT value FROM settings WHERE key = ?');
  $st->execute([$key]);
  $v = $st->fetchColumn();
  return $v === false ? $default : (string)$v;
}

function mhClientIp(): string { return (string)($_SERVER['REMOTE_ADDR'] ?? ''); }

function mhAudit(?int $uid, string $action, string $detail = ''): void {
  db()->prepare('INSERT INTO audit_log (user_id, action, detail, ip, created_at) VALUES (?,?,?,?,?)')
      ->execute([$uid, $action, $detail, mhClientIp(), time()]);
}

/* ---------------- mật khẩu & phiên ---------------- */

/* Cùng định dạng với tools/hash-password.js (Node) — tạo bằng Node, PHP
   kiểm được: pbkdf2_sha256$vòng$muối$băm. */
function mhVerifyPass(string $pass, string $stored): bool {
  $parts = explode('$', $stored);
  if (count($parts) !== 4 || $parts[0] !== 'pbkdf2_sha256') return false;
  [, $iter, $salt, $hash] = $parts;
  $calc = hash_pbkdf2('sha256', $pass, base64_decode($salt), (int)$iter, 32, true);
  return hash_equals(base64_decode($hash), $calc);
}

function mhMakePass(string $pass): string {
  $iter = 210000;
  $salt = random_bytes(16);
  $hash = hash_pbkdf2('sha256', $pass, $salt, $iter, 32, true);
  return 'pbkdf2_sha256$' . $iter . '$' . base64_encode($salt) . '$' . base64_encode($hash);
}

/* Bàn phím điện thoại tự chèn dấu cách sau gợi ý từ, không nhìn thấy
   được — cắt hai đầu ở cả chỗ đặt lẫn chỗ đăng nhập. */
function mhPass(string $s): string { return trim($s); }

function mhNewSession(int $uid): string {
  $token = bin2hex(random_bytes(32));
  $now   = time();
  /* Dọn phiên bỏ hoang: máy nào nửa năm không mở app thì phải đăng nhập
     lại. Máy quầy mở hằng ngày nên không bao giờ bị đá ra. */
  db()->prepare('DELETE FROM sessions WHERE last_seen < ?')->execute([$now - 180 * 86400]);
  db()->prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen, user_agent) VALUES (?,?,?,?,?)')
      ->execute([hash('sha256', $token), $uid, $now, $now,
                 substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200)]);
  return $token;
}

function mhCurrentUser(): ?array {
  $auth = (string)($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
  /* Một số cấu hình Apache chạy PHP qua FastCGI nuốt mất header
     Authorization — lúc đó đọc token app gửi kèm trong thân yêu cầu. */
  if (!preg_match('/Bearer\s+([0-9a-f]{64})/i', $auth, $m)
      && !preg_match('/^([0-9a-f]{64})$/i', (string)($GLOBALS['req']['_t'] ?? ''), $m)) return null;
  $st = db()->prepare('SELECT u.*, s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id
                        WHERE s.token_hash = ? AND u.active = 1');
  $st->execute([hash('sha256', $m[1])]);
  $row = $st->fetch();
  if (!$row) return null;
  db()->prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?')->execute([time(), $row['token_hash']]);
  $row['id'] = (int)$row['id'];
  return $row;
}

function mhRequireUser(): array {
  $u = mhCurrentUser();
  if (!$u) {
    /* Mã riêng cho "hết phiên": 401 còn dùng cho "sai mật khẩu", mà gõ
       nhầm một lần rồi bị văng ra ngoài thì vô lý. */
    if (function_exists('out'))
      out(['ok' => false, 'code' => 'session_expired',
           'error' => 'Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.'], 401);
    mhFail('Phiên đăng nhập đã hết.', 401);
  }
  return $u;
}

function mhRequireOwner(): array {
  $u = mhRequireUser();
  if ($u['role'] !== 'owner') mhFail('Mục này chỉ chủ quán mới dùng được.', 403);
  return $u;
}

function mhIsOwner(array $u): bool { return $u['role'] === 'owner'; }

/* Sai 5 lần thì khoá 5 phút — kể cả khi mật khẩu ngắn, dò cũng không bõ. */
function mhLockLeft(string $user): int {
  $st = db()->prepare('SELECT locked_until FROM login_attempts WHERE username = ? AND ip = ?');
  $st->execute([$user, mhClientIp()]);
  return max(0, (int)$st->fetchColumn() - time());
}

function mhNoteLoginFail(string $user): void {
  $now = time(); $ip = mhClientIp();
  db()->prepare('INSERT INTO login_attempts (username, ip, failed, last_try) VALUES (?,?,1,?)
                 ON CONFLICT(username, ip) DO UPDATE SET failed = failed + 1, last_try = excluded.last_try')
      ->execute([$user, $ip, $now]);
  $st = db()->prepare('SELECT failed FROM login_attempts WHERE username = ? AND ip = ?');
  $st->execute([$user, $ip]);
  if ((int)$st->fetchColumn() >= 5)
    db()->prepare('UPDATE login_attempts SET locked_until = ?, failed = 0 WHERE username = ? AND ip = ?')
        ->execute([$now + 300, $user, $ip]);
}

function mhClearLoginFails(string $user): void {
  db()->prepare('DELETE FROM login_attempts WHERE username = ? AND ip = ?')->execute([$user, mhClientIp()]);
}

/* ============================================================
   Hạng thành viên
   ============================================================ */

function mhTiers(): array {
  $rows = db()->query('SELECT * FROM tiers ORDER BY sort, id')->fetchAll();
  foreach ($rows as &$t) {
    $t['id'] = (int)$t['id']; $t['min_cuts'] = (int)$t['min_cuts'];
    $t['min_spend'] = (int)$t['min_spend']; $t['sort'] = (int)$t['sort'];
  }
  unset($t);
  return $rows;
}

/* Đạt MỘT trong hai là đủ. Ngưỡng 0 = không xét điều kiện đó. */
function mhTierReached(array $t, int $cuts, int $spend): bool {
  $c = $t['min_cuts']; $s = $t['min_spend'];
  if ($c <= 0 && $s <= 0) return true;
  return ($c > 0 && $cuts >= $c) || ($s > 0 && $spend >= $s);
}

/* Hạng hiện tại + còn thiếu bao nhiêu để lên hạng kế. Hạng cộng dồn trọn
   đời: chỉ lên, không bao giờ xuống (trừ khi chủ huỷ lượt ghi nhầm). */
function mhTierOf(int $cuts, int $spend, array $tiers): array {
  $idx = -1;
  foreach ($tiers as $i => $t) if (mhTierReached($t, $cuts, $spend)) $idx = $i;
  $cur  = $idx >= 0 ? $tiers[$idx] : null;
  $next = $tiers[$idx + 1] ?? null;
  $ra = ['tier' => $cur ? mhTierPublic($cur) : null, 'next' => null];
  if ($next) {
    $ra['next'] = [
      'tier'       => mhTierPublic($next),
      'need_cuts'  => $next['min_cuts']  > 0 ? max(0, $next['min_cuts']  - $cuts)  : null,
      'need_spend' => $next['min_spend'] > 0 ? max(0, $next['min_spend'] - $spend) : null,
      /* Tiến độ 0..1 theo điều kiện đang gần hơn — để vẽ thanh. */
      'progress'   => round(max(
        $next['min_cuts']  > 0 ? min(1, $cuts  / $next['min_cuts'])  : 0,
        $next['min_spend'] > 0 ? min(1, $spend / $next['min_spend']) : 0), 3),
    ];
  }
  return $ra;
}

function mhTierPublic(array $t): array {
  return ['id' => $t['id'], 'name' => $t['name'], 'color' => $t['color'], 'perks' => $t['perks'],
          'min_cuts' => $t['min_cuts'], 'min_spend' => $t['min_spend']];
}

/* Số lượt cắt, tổng chi, lượt gần nhất — của một khách, hoặc của tất cả
   (trả về mảng theo customer_id). Lượt đã huỷ không tính. */
function mhStats(?int $cid = null): array {
  $sql = "SELECT v.customer_id AS cid,
                 COUNT(*) AS visits,
                 COALESCE(SUM(v.amount), 0) AS spend,
                 SUM(CASE WHEN EXISTS (SELECT 1 FROM visit_items i
                                        WHERE i.visit_id = v.id AND i.kind = 'cut')
                          THEN 1 ELSE 0 END) AS cuts,
                 MAX(v.visit_date) AS last
            FROM visits v
           WHERE v.void_at IS NULL" . ($cid ? ' AND v.customer_id = ?' : '') . "
           GROUP BY v.customer_id";
  $st = db()->prepare($sql);
  $st->execute($cid ? [$cid] : []);
  $ra = [];
  foreach ($st->fetchAll() as $r)
    $ra[(int)$r['cid']] = ['visits' => (int)$r['visits'], 'spend' => (int)$r['spend'],
                           'cuts' => (int)$r['cuts'], 'last' => $r['last']];
  if ($cid && !isset($ra[$cid])) $ra[$cid] = ['visits' => 0, 'spend' => 0, 'cuts' => 0, 'last' => null];
  return $ra;
}

/* ============================================================
   Chương trình quà theo mốc
   ============================================================ */

function mhPrograms(bool $activeOnly = true): array {
  $rows = db()->query('SELECT * FROM programs' . ($activeOnly ? ' WHERE active = 1' : '')
                    . ' ORDER BY sort, id')->fetchAll();
  foreach ($rows as &$p) {
    $p['id'] = (int)$p['id']; $p['repeat'] = (int)$p['repeat']; $p['active'] = (int)$p['active'];
    $p['sort'] = (int)$p['sort'];
    $steps = json_decode((string)$p['steps'], true);
    $steps = is_array($steps) ? $steps : [];
    $steps = array_values(array_filter(array_map(function ($s) {
      return ['at' => (int)($s['at'] ?? 0), 'gift' => trim((string)($s['gift'] ?? ''))];
    }, $steps), function ($s) { return $s['at'] > 0; }));
    usort($steps, function ($a, $b) { return $a['at'] <=> $b['at']; });
    $p['steps'] = $steps;
  }
  unset($p);
  return $rows;
}

/* Đếm lượt được tính cho một chương trình: đúng loại dịch vụ, trong
   khoảng ngày của chương trình, chưa huỷ. Trả về [customer_id => số lượt]. */
function mhProgramCounts(array $p, ?int $cid = null): array {
  $sql = 'SELECT v.customer_id AS cid, COUNT(*) AS n FROM visits v
           WHERE v.void_at IS NULL AND v.visit_date >= ?';
  $args = [$p['start_date']];
  if ($p['end_date'] !== '') { $sql .= ' AND v.visit_date <= ?'; $args[] = $p['end_date']; }
  if ($p['kind'] !== 'any') {
    $sql .= ' AND EXISTS (SELECT 1 FROM visit_items i WHERE i.visit_id = v.id AND i.kind = ?)';
    $args[] = $p['kind'];
  }
  if ($cid) { $sql .= ' AND v.customer_id = ?'; $args[] = $cid; }
  $sql .= ' GROUP BY v.customer_id';
  $st = db()->prepare($sql);
  $st->execute($args);
  $ra = [];
  foreach ($st->fetchAll() as $r) $ra[(int)$r['cid']] = (int)$r['n'];
  return $ra;
}

/* Các seq đã trao, theo [customer_id][program_id] => [seq => true]. */
function mhGiven(?int $cid = null): array {
  $st = db()->prepare('SELECT customer_id, program_id, seq FROM rewards_given'
                    . ($cid ? ' WHERE customer_id = ?' : ''));
  $st->execute($cid ? [$cid] : []);
  $ra = [];
  foreach ($st->fetchAll() as $r) $ra[(int)$r['customer_id']][(int)$r['program_id']][(int)$r['seq']] = true;
  return $ra;
}

/* Từ số lượt n suy ra: quà đã đạt, quà còn nợ, mốc kế tiếp.

   Mốc 3-7-10 lặp vòng: vòng 1 đạt ở lượt 3, 7, 10; vòng 2 ở 13, 17, 20…
   seq đánh số phần quà theo thứ tự đó (0, 1, 2, 3, 4, 5…), nên một phần
   quà đã trao thì không bao giờ hiện lại là "còn nợ". */
function mhRewardState(array $p, int $n, array $givenSeqs): array {
  $steps = $p['steps'];
  $k = count($steps);
  $ra = ['program_id' => $p['id'], 'name' => $p['name'], 'kind' => $p['kind'],
         'n' => $n, 'len' => 0, 'pos' => $n, 'cycle' => 1,
         'steps' => $steps, 'pending' => [], 'next' => null, 'earned' => 0];
  if (!$k) return $ra;

  $L = $steps[$k - 1]['at'];
  $ra['len'] = $L;
  $earned = [];
  $cycles = $p['repeat'] ? intdiv($n, $L) : 0;
  for ($c = 0; $c <= $cycles; $c++) {
    foreach ($steps as $i => $s) {
      $tot = $c * $L + $s['at'];
      if ($tot > $n) break;
      $earned[] = ['seq' => $c * $k + $i, 'at' => $s['at'], 'total' => $tot,
                   'gift' => $s['gift'], 'cycle' => $c + 1];
    }
  }
  $ra['earned']  = count($earned);
  $ra['pending'] = array_values(array_filter($earned, function ($e) use ($givenSeqs) {
    return !isset($givenSeqs[$e['seq']]);
  }));

  if ($p['repeat']) {
    $ra['pos']   = $n % $L;
    $ra['cycle'] = intdiv($n, $L) + 1;
  }
  if ($p['repeat'] || $n < $L) {
    foreach ($steps as $s) if ($s['at'] > $ra['pos']) {
      $ra['next'] = ['at' => $s['at'], 'gift' => $s['gift'], 'need' => $s['at'] - $ra['pos']];
      break;
    }
  }
  return $ra;
}

/* Mọi chương trình của một khách. Chương trình đã hết hạn thì chỉ hiện
   khi khách còn quà chưa nhận — hết hạn rồi vẫn phải trao nốt. */
function mhCustomerRewards(int $cid): array {
  $given = mhGiven($cid)[$cid] ?? [];
  $ra = [];
  foreach (mhPrograms() as $p) {
    $n  = mhProgramCounts($p, $cid)[$cid] ?? 0;
    $st = mhRewardState($p, $n, $given[$p['id']] ?? []);
    if ($p['end_date'] !== '' && $p['end_date'] < mhToday() && !$st['pending']) continue;
    $st['ended'] = $p['end_date'] !== '' && $p['end_date'] < mhToday();
    $ra[] = $st;
  }
  return $ra;
}

/* ============================================================
   Khách
   ============================================================ */

function mhCustomerRow(int $cid): ?array {
  $st = db()->prepare('SELECT * FROM customers WHERE id = ?');
  $st->execute([$cid]);
  $c = $st->fetch();
  if (!$c) return null;
  $c['id'] = (int)$c['id'];
  return $c;
}

/* Tạo khách, hoặc trả về khách đã có số đó. */
function mhEnsureCustomer(string $phone, string $name, ?int $uid, string $kvCode = ''): array {
  $c = mhFindByPhone($phone);
  if ($c) {
    /* Bổ sung chỗ còn trống, không ghi đè tên chủ đã sửa tay. */
    if (($c['name'] === '' && $name !== '') || ($kvCode !== '' && !$c['kv_code'])) {
      db()->prepare("UPDATE customers SET name = CASE WHEN name = '' THEN ? ELSE name END,
                                          kv_code = COALESCE(kv_code, ?) WHERE id = ?")
          ->execute([$name, $kvCode ?: null, $c['id']]);
    }
    $c['_new'] = false;
    return $c;
  }
  db()->prepare('INSERT INTO customers (phone, last4, name, kv_code, created_at, created_by) VALUES (?,?,?,?,?,?)')
      ->execute([$phone, substr($phone, -4), $name, $kvCode ?: null, time(), $uid]);
  return ['id' => (int)db()->lastInsertId(), 'phone' => $phone, 'name' => $name, '_new' => true];
}

/* Tìm khách theo số điện thoại — số đang dùng hoặc số cũ (đã đổi / đã gộp). */
function mhFindByPhone(string $phone): ?array {
  $st = db()->prepare('SELECT * FROM customers WHERE phone = ?
                       UNION ALL
                       SELECT c.* FROM customer_aliases a JOIN customers c ON c.id = a.customer_id WHERE a.phone = ?
                       LIMIT 1');
  $st->execute([$phone, $phone]);
  $c = $st->fetch();
  if (!$c) return null;
  $c['id'] = (int)$c['id'];
  return $c;
}

function mhAddAlias(string $phone, int $cid): void {
  if (strlen($phone) < 9) return;
  db()->prepare('INSERT INTO customer_aliases (phone, last4, customer_id, created_at) VALUES (?,?,?,?)
                 ON CONFLICT(phone) DO UPDATE SET customer_id = excluded.customer_id')
      ->execute([$phone, substr($phone, -4), $cid, time()]);
}

/* ============================================================
   Thợ cắt
   ============================================================ */

function mhBarbers(bool $activeOnly = false): array {
  $rows = db()->query('SELECT * FROM barbers' . ($activeOnly ? ' WHERE active = 1' : '')
                    . ' ORDER BY active DESC, sort, id')->fetchAll();
  foreach ($rows as &$b) { $b['id'] = (int)$b['id']; $b['active'] = (int)$b['active']; $b['sort'] = (int)$b['sort']; }
  unset($b);
  return $rows;
}

/* KiotViet đánh dấu tài khoản đã xoá bằng đuôi "{DEL}". */
function mhCleanKvName(string $s): string {
  return trim((string)preg_replace('/\{DEL\}\s*$/i', '', trim($s)));
}

/* Tên ở cột "Người bán" → id thợ. Chưa có thì tạo luôn (thợ đã bị xoá
   bên KiotViet thì tạo ở trạng thái tắt) — nhập file lịch sử cả năm mà
   bắt chủ khai trước từng thợ cũ thì không ai làm. */
function mhBarberFromKv(string $raw, array &$cache, array &$moi): ?int {
  $ten = mhCleanKvName($raw);
  if ($ten === '') return null;
  $k = mhFold($ten);
  if (!$cache) foreach (mhBarbers() as $b) {
    $cache[mhFold($b['kv_name'] !== '' ? $b['kv_name'] : $b['name'])] = $b['id'];
    $cache += [mhFold($b['name']) => $b['id']];
  }
  if (isset($cache[$k])) return $cache[$k];
  $tat = preg_match('/\{DEL\}/i', $raw) ? 0 : 1;
  $sort = (int)db()->query('SELECT COALESCE(MAX(sort),0)+1 FROM barbers')->fetchColumn();
  db()->prepare('INSERT INTO barbers (name, kv_name, active, sort, created_at) VALUES (?,?,?,?,?)')
      ->execute([$ten, $ten, $tat, $sort, time()]);
  $cache[$k] = (int)db()->lastInsertId();
  $moi[] = $ten . ($tat ? '' : ' (đã nghỉ)');
  return $cache[$k];
}

/* Thợ quen của một khách: đếm lượt theo từng thợ, nhiều nhất lên đầu. */
function mhCustomerBarbers(int $cid): array {
  $st = db()->prepare('SELECT v.barber_id AS id, b.name, b.active, COUNT(*) AS n, MAX(v.visit_date) AS last
                         FROM visits v JOIN barbers b ON b.id = v.barber_id
                        WHERE v.customer_id = ? AND v.void_at IS NULL
                        GROUP BY v.barber_id ORDER BY n DESC, last DESC');
  $st->execute([$cid]);
  return array_map(function ($r) {
    return ['id' => (int)$r['id'], 'name' => $r['name'], 'active' => (int)$r['active'],
            'n' => (int)$r['n'], 'last' => $r['last']];
  }, $st->fetchAll());
}

/* Thợ chính của mọi khách (thợ có nhiều lượt nhất) — [customer_id => barber_id]. */
function mhMainBarbers(): array {
  $ra = [];
  foreach (db()->query('SELECT customer_id, barber_id, COUNT(*) n, MAX(visit_date) last FROM visits
                         WHERE void_at IS NULL AND barber_id IS NOT NULL
                         GROUP BY customer_id, barber_id ORDER BY n, last')->fetchAll() as $r)
    $ra[(int)$r['customer_id']] = (int)$r['barber_id'];     // sắp tăng dần → dòng cuối thắng
  return $ra;
}

/* Bảng tra mã hàng KiotViet → dịch vụ. */
function mhKvMap(): array {
  $map = [];
  foreach (db()->query('SELECT id, name, kind, kv_codes FROM services')->fetchAll() as $s)
    foreach (explode(',', (string)$s['kv_codes']) as $code) {
      $code = mb_strtoupper(trim($code));
      if ($code !== '') $map[$code] = ['id' => (int)$s['id'], 'kind' => $s['kind']];
    }
  return $map;
}

function mhAddFlag(int $visitId, string $flag): void {
  $st = db()->prepare('SELECT flags FROM visits WHERE id = ?');
  $st->execute([$visitId]);
  $cur = array_filter(explode(',', (string)$st->fetchColumn()));
  if (in_array($flag, $cur, true)) return;
  $cur[] = $flag;
  db()->prepare('UPDATE visits SET flags = ? WHERE id = ?')->execute([implode(',', $cur), $visitId]);
}

function mhDelFlag(int $visitId, string $flag): void {
  $st = db()->prepare('SELECT flags FROM visits WHERE id = ?');
  $st->execute([$visitId]);
  $cur = array_filter(explode(',', (string)$st->fetchColumn()));
  $moi = array_values(array_filter($cur, function ($f) use ($flag) { return $f !== $flag; }));
  if (count($moi) !== count($cur))
    db()->prepare('UPDATE visits SET flags = ? WHERE id = ?')->execute([implode(',', $moi), $visitId]);
}

/* Danh sách lượt, kèm dịch vụ và tên người ghi. */
function mhVisitList(string $where, array $args, int $limit = 200): array {
  $st = db()->prepare("SELECT v.*, u.name AS by_name, vu.name AS void_by_name,
                              c.name AS customer_name, c.phone AS customer_phone, b.name AS barber_name
                         FROM visits v
                         JOIN customers c ON c.id = v.customer_id
                    LEFT JOIN barbers b ON b.id = v.barber_id
                    LEFT JOIN users u  ON u.id  = v.created_by
                    LEFT JOIN users vu ON vu.id = v.void_by
                        WHERE $where
                        ORDER BY v.visit_date DESC, v.visit_time DESC, v.id DESC
                        LIMIT $limit");
  $st->execute($args);
  $rows = $st->fetchAll();
  if (!$rows) return [];
  $ids = array_map(function ($r) { return (int)$r['id']; }, $rows);
  $items = [];
  $q = db()->query('SELECT visit_id, name, kind, qty, price FROM visit_items WHERE visit_id IN ('
                   . implode(',', $ids) . ') ORDER BY id');
  foreach ($q->fetchAll() as $i)
    $items[(int)$i['visit_id']][] = ['name' => $i['name'], 'kind' => $i['kind'],
                                     'qty' => (int)$i['qty'], 'price' => (int)$i['price']];
  foreach ($rows as &$r) {
    $r['id'] = (int)$r['id']; $r['customer_id'] = (int)$r['customer_id'];
    $r['amount'] = (int)$r['amount']; $r['created_at'] = (int)$r['created_at'];
    $r['created_by'] = $r['created_by'] !== null ? (int)$r['created_by'] : null;
    $r['barber_id'] = $r['barber_id'] !== null ? (int)$r['barber_id'] : null;
    $r['void_at'] = $r['void_at'] !== null ? (int)$r['void_at'] : null;
    $r['items'] = $items[$r['id']] ?? [];
    $r['flags'] = array_values(array_filter(explode(',', (string)$r['flags'])));
  }
  unset($r);
  return $rows;
}
