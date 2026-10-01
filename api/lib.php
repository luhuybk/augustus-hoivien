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
  mhAddColumn($pdo, 'customers', 'birthday', "TEXT NOT NULL DEFAULT ''");
  mhAddColumn($pdo, 'customers', 'birth_year', 'INTEGER');
  /* Máy đang chạy: lần đầu có cột quà sinh nhật thì bật sẵn cho Vàng và
     Đen — đúng như chủ quán yêu cầu; hạng khác chủ tự bật trong Thiết lập. */
  if (mhAddColumn($pdo, 'tiers', 'bday_gift', "TEXT NOT NULL DEFAULT ''"))
  {
    $pdo->exec("UPDATE tiers SET bday_gift = 'Quà sinh nhật' WHERE name IN ('Vàng', 'Đen')");
    /* Bản trước ghi "Quà sinh nhật" như một dòng đặc quyền của hạng Đen —
       giờ nó là mục riêng, bỏ dòng cũ đi cho khỏi hiện hai lần. */
    $pdo->exec("UPDATE tiers SET perks = TRIM(REPLACE(perks, char(10) || 'Quà sinh nhật', ''))");
  }
  $pdo->exec('CREATE INDEX IF NOT EXISTS idx_visit_barber ON visits(barber_id, visit_date)');

  /* Bán hàng thay KiotViet: hoá đơn có giảm giá, tip, cách trả tiền; dịch
     vụ có phần của thợ; hạng có % giảm. */
  foreach (['subtotal' => 'INTEGER NOT NULL DEFAULT 0', 'discount' => 'INTEGER NOT NULL DEFAULT 0',
            'disc_note' => "TEXT NOT NULL DEFAULT ''", 'tip' => 'INTEGER NOT NULL DEFAULT 0',
            'pay_cash' => 'INTEGER NOT NULL DEFAULT 0', 'pay_transfer' => 'INTEGER NOT NULL DEFAULT 0'] as $cot => $kieu)
    mhAddColumn($pdo, 'visits', $cot, $kieu);
  mhAddColumn($pdo, 'visit_items', 'list_price', 'INTEGER NOT NULL DEFAULT 0');
  mhAddColumn($pdo, 'visit_items', 'disc', 'INTEGER NOT NULL DEFAULT 0');
  mhAddColumn($pdo, 'barbers', 'base_salary', 'INTEGER NOT NULL DEFAULT 0');
  mhAddColumn($pdo, 'services', 'wage', 'INTEGER NOT NULL DEFAULT 0');
  mhAddColumn($pdo, 'services', 'comm_pct', 'REAL NOT NULL DEFAULT 0');
  /* Sản phẩm bán lẻ mặc định không giảm theo hạng — chủ bật lại được. */
  if (mhAddColumn($pdo, 'services', 'discountable', 'INTEGER NOT NULL DEFAULT 1'))
    $pdo->exec("UPDATE services SET discountable = 0 WHERE kind = 'product'");
  /* Mức giảm chủ quán đưa ra: Đồng 5% · Bạc 10% · Vàng 15% · Đen 20%. Dòng
     đặc quyền "Giảm …% sản phẩm" gợi ý từ bản đầu thì bỏ — giờ giảm giá là
     con số thật app tự trừ, hiện riêng. */
  if (mhAddColumn($pdo, 'tiers', 'disc_pct', 'INTEGER NOT NULL DEFAULT 0')) {
    $pdo->exec("UPDATE tiers SET disc_pct = CASE name WHEN 'Đồng' THEN 5 WHEN 'Bạc' THEN 10
                  WHEN 'Vàng' THEN 15 WHEN 'Đen' THEN 20 ELSE 0 END");
    foreach (['Giảm 5% sản phẩm', 'Giảm 10% sản phẩm', 'Giảm 12% sản phẩm'] as $cu)
      $pdo->prepare("UPDATE tiers SET perks = TRIM(REPLACE(REPLACE(perks, ? || char(10), ''), ?, ''), char(10))")
          ->execute([$cu, $cu]);
  }
  mhVisitsNullableCustomer($pdo, $sql);
  mhAddColumn($pdo, 'services', 'note', "TEXT NOT NULL DEFAULT ''");
  mhAddColumn($pdo, 'payroll_adjust', 'qty', 'INTEGER NOT NULL DEFAULT 1');
  mhAddColumn($pdo, 'payroll_adjust', 'rate', 'INTEGER NOT NULL DEFAULT 0');
  mhAddColumn($pdo, 'payroll_adjust', 'recurring', 'INTEGER NOT NULL DEFAULT 0');
  if (mhAddColumn($pdo, 'services', 'grp', "TEXT NOT NULL DEFAULT 'A'")) mhSeedGroups($pdo);
  /* Giảm thêm bằng tay trên từng món (uốn giảm thẳng 100k…), không theo
     hạng — bắt buộc ghi lý do, hiện ⚠ trong sổ ngày cho chủ soát. */
  mhAddColumn($pdo, 'visits', 'mdisc', 'INTEGER NOT NULL DEFAULT 0');
  mhAddColumn($pdo, 'visits', 'mdisc_note', "TEXT NOT NULL DEFAULT ''");
  mhAddColumn($pdo, 'visit_items', 'mdisc', 'INTEGER NOT NULL DEFAULT 0');
  /* Tên sản phẩm cụ thể trên dòng "Sản phẩm A – 12%"; tài khoản thợ. */
  mhAddColumn($pdo, 'visit_items', 'detail', "TEXT NOT NULL DEFAULT ''");
  mhAddColumn($pdo, 'users', 'barber_id', 'INTEGER');
  /* Mạng chập chờn: máy chủ đã ghi hoá đơn nhưng quầy không nhận được trả
     lời, bấm lại → nhận lại đúng hoá đơn cũ thay vì tạo hoá đơn thứ hai. */
  mhAddColumn($pdo, 'visits', 'client_ref', 'TEXT');
  $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_visit_ref ON visits(client_ref) WHERE client_ref IS NOT NULL');
  /* Đặt lịch: mỗi dịch vụ mất bao lâu (phút) và có cho khách tự đặt không.
     Đặt sẵn theo lời chủ quán: cắt 45', combo 60', uốn / nhuộm 90' (sửa
     được — uốn tuỳ tóc 1–2 tiếng thì quầy chỉnh lúc đặt). */
  if (mhAddColumn($pdo, 'services', 'duration', 'INTEGER NOT NULL DEFAULT 0'))
    $pdo->exec("UPDATE services SET duration = CASE
                  WHEN kind = 'product' THEN 0 WHEN grp = 'B' THEN 60 WHEN kind = 'cut' THEN 45
                  WHEN kind IN ('perm', 'color') THEN 90 WHEN kind = 'care' THEN 15 ELSE 30 END");
  if (mhAddColumn($pdo, 'services', 'bookable', 'INTEGER NOT NULL DEFAULT 1'))
    $pdo->exec("UPDATE services SET bookable = 0 WHERE kind = 'product'");

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

  $sv = $pdo->prepare("INSERT INTO services (name, kind, price, kv_codes, sort, discountable)
                       VALUES (?,?,?,?,?, CASE WHEN ? = 'product' THEN 0 ELSE 1 END)");
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
  ] as $s) $sv->execute([$s[0], $s[1], $s[2], $s[3], ++$i, $s[1]]);
  mhSeedGroups($pdo);

  $t = $pdo->prepare("INSERT INTO tiers (name, color, min_cuts, min_spend, perks, sort, disc_pct, bday_gift)
                      VALUES (?,?,?,?,?,?,?, CASE WHEN ? IN ('Vàng','Đen') THEN 'Quà sinh nhật' ELSE '' END)");
  /* Đặc quyền chỉ là gợi ý để quầy có cái mà nói với khách — chủ sửa ở
     Thiết lập → Hạng. Mỗi dòng một điều. */
  $t->execute(['Đồng', '#b87333', 0,  0,       "Tích lượt nhận quà mốc 3 – 7 – 10\nTặng tinh dầu mỗi lần uốn", 1, 5, 'Đồng']);
  $t->execute(['Bạc',  '#aab4c3', 5,  1000000, '', 2, 10, 'Bạc']);
  $t->execute(['Vàng', '#e2b33c', 10, 2000000, "Ưu tiên đặt lịch giờ cao điểm", 3, 15, 'Vàng']);
  $t->execute(['Đen',  '#1b1b1f', 15, 3500000, "Ưu tiên đặt lịch giờ cao điểm", 4, 20, 'Đen']);

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

/* Xếp dịch vụ vào nhóm, và — nếu chủ chưa đặt tiền công nào — đặt sẵn
   theo bảng lương quán đang tính tay (tháng 8/2026): đầu cắt 50k, Combo
   Shine 90k, Combo Chill 85k, Chill & Shine 125k, ráy tai 35k, em bé 30k,
   uốn 15% doanh thu; sản phẩm tách A 12% · B 20% · C 25% · S 50% theo đúng
   mã hàng KiotViet. Chỉ chạy một lần, lúc thêm cột nhóm. */
function mhSeedGroups(PDO $pdo): void {
  $rows = $pdo->query('SELECT * FROM services ORDER BY sort, id')->fetchAll();
  $up = $pdo->prepare('UPDATE services SET grp = ? WHERE id = ?');
  foreach ($rows as $r) {
    $f = mhFold((string)$r['name']);
    $g = $r['kind'] === 'product' ? 'D'
       : (in_array($r['kind'], ['perm', 'color'], true) || preg_match('/phuc hoi|tay toc|ep side|uon|nhuom/', $f) ? 'C'
       : (str_contains($f, 'combo') ? 'B' : 'A'));
    $up->execute([$g, $r['id']]);
  }
  if ((int)$pdo->query('SELECT COUNT(*) FROM services WHERE wage > 0 OR comm_pct > 0')->fetchColumn() > 0) return;
  $set = $pdo->prepare('UPDATE services SET wage = ?, comm_pct = ? WHERE id = ?');
  foreach ($rows as $r) {
    $f = mhFold((string)$r['name']);
    $w = 0; $c = 0;
    if (str_contains($f, 'chill & shine') || str_contains($f, 'chill and shine')) $w = 125000;
    elseif (str_contains($f, 'combo shine')) $w = 90000;
    elseif (str_contains($f, 'combo chill')) $w = 85000;
    elseif (str_contains($f, 'baby') || str_contains($f, 'em be')) $w = 30000;
    elseif (str_contains($f, 'ray tai')) $w = 35000;
    elseif ($r['kind'] === 'cut') $w = 50000;
    elseif (str_contains($f, 'uon') || str_contains($f, 'curl')) $c = 15;
    if ($w || $c) $set->execute([$w, $c, $r['id']]);
  }
  /* "Sản phẩm" chung một dòng (mã KiotViet A, B, C gộp lại) → mỗi mức
     hoa hồng một dòng. */
  $sp = null;
  foreach ($rows as $r) if ($r['kind'] === 'product' && str_contains(strtoupper((string)$r['kv_codes']), 'SP000084')) $sp = $r;
  if ($sp) {
    $pdo->prepare("UPDATE services SET name = 'Sản phẩm A – 12%', kv_codes = 'SP000084', comm_pct = 12, grp = 'D' WHERE id = ?")
        ->execute([$sp['id']]);
    $ins = $pdo->prepare("INSERT INTO services (name, kind, price, kv_codes, active, sort, wage, comm_pct, discountable, grp)
                          VALUES (?, 'product', 0, ?, 1, ?, 0, ?, 0, 'D')");
    $sort = (int)$sp['sort'];
    foreach ([['Sản phẩm B – 20%', 'SP000085', 20], ['Sản phẩm C – 25%', 'SP000089', 25], ['Sản phẩm S – 50%', '', 50]] as $k)
      $ins->execute([$k[0], $k[1], $sort, $k[2]]);
    /* Dòng hàng đã nhập theo mã B, C chuyển sang dịch vụ mới. */
    $re = $pdo->prepare('UPDATE visit_items SET service_id = (SELECT id FROM services WHERE kv_codes = ? LIMIT 1) WHERE kv_code = ?');
    foreach (['SP000085', 'SP000089'] as $code) $re->execute([$code, $code]);
  }
}

/* Nhóm dịch vụ — chủ đổi tên, thêm nhóm ở Thiết lập → Dịch vụ. */
function mhGroups(): array {
  $g = json_decode((string)mhSetting('svc_groups', ''), true);
  if (!is_array($g) || !$g)
    $g = [['code' => 'A', 'name' => 'Dịch vụ lẻ'], ['code' => 'B', 'name' => 'Combo'],
          ['code' => 'C', 'name' => 'Hoá chất'], ['code' => 'D', 'name' => 'Sản phẩm']];
  return $g;
}

/* Bản đầu bắt mọi lượt phải có khách (customer_id NOT NULL). Bán hàng thì
   có khách lẻ không để số — SQLite không sửa được ràng buộc cột, phải dựng
   lại bảng: tạo bảng mới theo schema.sql, chép dữ liệu, đổi tên. Tắt khoá
   ngoại trong lúc làm để xoá bảng cũ không kéo theo visit_items. */
function mhVisitsNullableCustomer(PDO $pdo, string $schema): void {
  $cols = $pdo->query('PRAGMA table_info(visits)')->fetchAll();
  $can = false;
  foreach ($cols as $c) if ($c['name'] === 'customer_id' && (int)$c['notnull'] === 1) $can = true;
  if (!$can) return;
  if (!preg_match('/CREATE TABLE IF NOT EXISTS visits \((.*?)\n\);/s', $schema, $m))
    mhFail('schema.sql thiếu bảng visits.', 500);
  $ten = implode(', ', array_map(function ($c) { return $c['name']; }, $cols));
  $pdo->exec('PRAGMA foreign_keys = OFF');
  $pdo->beginTransaction();
  try {
    $pdo->exec('DROP TABLE IF EXISTS visits_new');
    $pdo->exec("CREATE TABLE visits_new ({$m[1]}\n)");
    $pdo->exec("INSERT INTO visits_new ($ten) SELECT $ten FROM visits");
    $pdo->exec('DROP TABLE visits');
    $pdo->exec('ALTER TABLE visits_new RENAME TO visits');
    $pdo->exec($schema);                       // dựng lại chỉ mục
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_visit_barber ON visits(barber_id, visit_date)');
    $pdo->commit();
  } catch (Throwable $e) {
    $pdo->rollBack();
    $pdo->exec('PRAGMA foreign_keys = ON');
    mhFail('Nâng cấp bảng hoá đơn không được: ' . $e->getMessage(), 500);
  }
  $pdo->exec('PRAGMA foreign_keys = ON');
}

/* Trả về true nếu vừa thêm cột (để bên gọi điền giá trị ban đầu). */
function mhAddColumn(PDO $pdo, string $bang, string $cot, string $kieu): bool {
  foreach ($pdo->query("PRAGMA table_info($bang)")->fetchAll() as $c) if ($c['name'] === $cot) return false;
  $pdo->exec("ALTER TABLE $bang ADD COLUMN $cot $kieu");
  return true;
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
  $row['barber_id'] = $row['barber_id'] !== null ? (int)$row['barber_id'] : null;
  return $row;
}

/* Tài khoản thợ chỉ được xem hoá đơn của chính mình và báo sai — mọi lệnh
   khác (tính tiền, tra khách, chốt ca…) chặn ngay ở cửa. */
const MH_BARBER_ACTIONS = ['me', 'logout', 'my_bills', 'report_add', 'book_mine'];

function mhRequireUser(): array {
  $u = mhCurrentUser();
  if ($u && $u['role'] === 'barber' && !in_array($GLOBALS['action'] ?? '', MH_BARBER_ACTIONS, true))
    mhFail('Tài khoản thợ chỉ xem được hoá đơn của mình.', 403);
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
    $t['min_spend'] = (int)$t['min_spend']; $t['sort'] = (int)$t['sort']; $t['disc_pct'] = (int)$t['disc_pct'];
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
          'min_cuts' => $t['min_cuts'], 'min_spend' => $t['min_spend'], 'bday_gift' => $t['bday_gift'] ?? '',
          'disc_pct' => (int)($t['disc_pct'] ?? 0)];
}

/* ============================================================
   Sinh nhật
   ============================================================ */

/* Ngày/tháng/năm gửi lên → ['MM-DD', năm|null]. Ngày 0 = xoá ngày sinh.
   Kiểm bằng năm nhuận 2000 để 29/02 vẫn hợp lệ khi khách không nói năm. */
function mhParseBday($d, $m, $y): ?array {
  $d = (int)$d; $m = (int)$m; $y = (int)$y;
  if ($d === 0 && $m === 0) return ['', null];
  if ($y && ($y < 1920 || $y > (int)date('Y'))) mhFail('Năm sinh không hợp lệ.', 400);
  if (!checkdate($m, $d, $y ?: 2000)) mhFail('Ngày sinh không hợp lệ.', 400);
  return [sprintf('%02d-%02d', $m, $d), $y ?: null];
}

/* Các khách đã nhận quà sinh nhật NĂM NAY: [customer_id => true]. */
function mhBdayGivenThisYear(): array {
  $st = db()->prepare('SELECT customer_id FROM birthday_given WHERE year = ?');
  $st->execute([(int)date('Y')]);
  return array_fill_keys(array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN)), true);
}

/* Trạng thái sinh nhật của một khách theo hạng hiện tại.
   Quà trao trong cả THÁNG sinh nhật — dễ nói với khách ("tháng sinh nhật
   anh ghé là có quà"), và khách không phải canh đúng ngày mới đến. */
function mhBdayState(array $c, ?array $tier, bool $daNhan): array {
  $gift = $tier ? trim((string)($tier['bday_gift'] ?? '')) : '';
  $bd = (string)($c['birthday'] ?? '');
  $ra = ['birthday' => $bd, 'year' => $c['birth_year'] !== null ? (int)$c['birth_year'] : null,
         'eligible' => $gift !== '', 'gift' => $gift, 'this_month' => false, 'given' => $daNhan,
         'pending' => false, 'days' => null];
  if ($bd === '') return $ra;
  $ra['this_month'] = substr($bd, 0, 2) === date('m');
  $ra['pending'] = $ra['eligible'] && $ra['this_month'] && !$daNhan;
  /* Còn bao nhiêu ngày tới sinh nhật (0 = hôm nay). 29/02 năm thường tính 01/03. */
  $nam = (int)date('Y');
  $t = strtotime("$nam-$bd") ?: strtotime("$nam-03-01");
  if ($t < strtotime('today')) $t = strtotime(($nam + 1) . "-$bd") ?: strtotime(($nam + 1) . '-03-01');
  $ra['days'] = (int)round(($t - strtotime('today')) / 86400);
  return $ra;
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
           WHERE v.void_at IS NULL AND v.customer_id IS NOT NULL" . ($cid ? ' AND v.customer_id = ?' : '') . "
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
           WHERE v.void_at IS NULL AND v.customer_id IS NOT NULL AND v.visit_date >= ?';
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
  /* Hoá đơn tài khoản quầy tự đứng tên "người bán" (tên quán) — không phải thợ. */
  if ($k === mhFold(MH_SHOP_NAME)) return null;
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
                         WHERE void_at IS NULL AND barber_id IS NOT NULL AND customer_id IS NOT NULL
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
                    LEFT JOIN customers c ON c.id = v.customer_id
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
  $q = db()->query('SELECT visit_id, service_id, name, kind, qty, price, list_price, disc, mdisc, detail FROM visit_items WHERE visit_id IN ('
                   . implode(',', $ids) . ') ORDER BY id');
  foreach ($q->fetchAll() as $i)
    $items[(int)$i['visit_id']][] = ['name' => $i['name'], 'kind' => $i['kind'], 'service_id' => $i['service_id'] !== null ? (int)$i['service_id'] : null,
                                     'qty' => (int)$i['qty'], 'price' => (int)$i['price'],
                                     'list_price' => (int)$i['list_price'], 'disc' => (int)$i['disc'], 'mdisc' => (int)$i['mdisc'],
                                     'detail' => (string)$i['detail']];
  /* Báo sai đính kèm từng hoá đơn. */
  $bao = [];
  $q = db()->query('SELECT r.*, u.name AS by_name, ru.name AS res_name FROM bill_reports r
                      LEFT JOIN users u ON u.id = r.created_by LEFT JOIN users ru ON ru.id = r.resolved_by
                     WHERE r.visit_id IN (' . implode(',', $ids) . ') ORDER BY r.id');
  foreach ($q->fetchAll() as $b) $bao[(int)$b['visit_id']][] = mhReportRow($b);
  foreach ($rows as &$r) {
    $r['id'] = (int)$r['id']; $r['customer_id'] = $r['customer_id'] !== null ? (int)$r['customer_id'] : null;
    $r['code'] = mhBillCode($r);
    foreach (['amount', 'subtotal', 'discount', 'tip', 'pay_cash', 'pay_transfer', 'mdisc'] as $k) $r[$k] = (int)$r[$k];
    $r['created_at'] = (int)$r['created_at'];
    $r['created_by'] = $r['created_by'] !== null ? (int)$r['created_by'] : null;
    $r['barber_id'] = $r['barber_id'] !== null ? (int)$r['barber_id'] : null;
    $r['void_at'] = $r['void_at'] !== null ? (int)$r['void_at'] : null;
    $r['items'] = $items[$r['id']] ?? [];
    $r['reports'] = $bao[$r['id']] ?? [];
    $r['flags'] = array_values(array_filter(explode(',', (string)$r['flags'])));
  }
  unset($r);
  return $rows;
}

/* Tên sản phẩm cụ thể đã bán theo từng dòng sản phẩm, hay bán nhất trước,
   kèm giá lần bán gần nhất — quầy chọn lại cho nhanh, giá tự điền. */
function mhProductNames(): array {
  $st = db()->prepare("SELECT i.service_id sid, i.detail d, COUNT(*) n, MAX(i.id) last FROM visit_items i
                         JOIN visits v ON v.id = i.visit_id
                        WHERE i.detail <> '' AND i.service_id IS NOT NULL AND v.void_at IS NULL AND v.visit_date >= ?
                        GROUP BY i.service_id, i.detail ORDER BY n DESC");
  $st->execute([date('Y-m-d', strtotime('-365 days'))]);
  $rows = $st->fetchAll();
  $gia = [];
  if ($rows) foreach (db()->query('SELECT id, list_price FROM visit_items WHERE id IN ('
                                  . implode(',', array_map(function ($r) { return (int)$r['last']; }, $rows)) . ')')->fetchAll() as $r)
    $gia[(int)$r['id']] = (int)$r['list_price'];
  $ra = [];
  foreach ($rows as $r) {
    $sid = (int)$r['sid'];
    if (count($ra[$sid] ?? []) >= 40) continue;
    $ra[$sid][] = ['name' => $r['d'], 'price' => $gia[(int)$r['last']] ?? 0];
  }
  return $ra;
}

function mhReportRow(array $b): array {
  return ['id' => (int)$b['id'], 'visit_id' => $b['visit_id'] !== null ? (int)$b['visit_id'] : null,
          'date' => $b['report_date'], 'note' => $b['note'], 'status' => $b['status'], 'reply' => $b['reply'],
          'by' => $b['by_name'] ?? null, 'at' => (int)$b['created_at'], 'created_by' => $b['created_by'] !== null ? (int)$b['created_by'] : null,
          'res_by' => $b['res_name'] ?? null, 'res_at' => $b['resolved_at'] !== null ? (int)$b['resolved_at'] : null];
}

/* Mã hoá đơn để hiện và in: hoá đơn nhập từ KiotViet giữ mã bên đó
   (HD012586), hoá đơn app tạo là "AG" + số thứ tự. */
function mhBillCode(array $v): string {
  if (!empty($v['kv_invoice'])) return (string)$v['kv_invoice'];
  return 'AG' . str_pad((string)$v['id'], 6, '0', STR_PAD_LEFT);
}

/* ============================================================
   Tính tiền một hoá đơn
   ============================================================

   Một chỗ duy nhất tính giảm giá — app.js tính y hệt để hiện trước, nhưng
   số ghi vào sổ luôn là số máy chủ tính ở đây.

   $lines: [['svc' => dòng services, 'qty' => n, 'unit' => đơn giá, 'mdisc' => giảm tay]]
   Giảm theo hạng và khuyến mãi KHÔNG cộng dồn — lấy mức lớn hơn. Cả hai
   chỉ áp lên dòng được giảm (services.discountable). Món có giảm thêm
   bằng tay (mdisc, tính trên cả dòng) thì bỏ qua hạng/KM — giảm đúng số
   quầy gõ, không phụ thuộc hạng.

   Giảm theo % thì làm tròn GIÁ SAU GIẢM của từng món theo bước chủ chọn
   ($round = 5000 / 10000, $mode 'down' = xuống, có lợi cho khách; 'near'
   = gần nhất): cắt 170k hạng Đồng −5% = 161.500 → 160.000. */
function mhRoundCfg(): array {
  $b = (int)mhSetting('disc_round', '5000');
  return [in_array($b, [1000, 5000, 10000], true) ? $b : 1000, mhSetting('disc_round_mode', 'down') === 'near' ? 'near' : 'down'];
}

function mhQuote(array $lines, int $tierPct, string $tierName, ?array $promo, ?array $round = null): array {
  [$buoc, $kieu] = $round ?? mhRoundCfg();
  $gross = []; $elig = 0;
  foreach ($lines as $i => $l) {
    $gross[$i] = $l['unit'] * $l['qty'];
    if ((int)$l['svc']['discountable']) $elig += $gross[$i];
  }
  $chia = function (int $tong, array $chon) use ($gross) {
    /* Chia $tong theo tỉ lệ thành tiền các dòng $chon; dòng cuối nhận phần dư. */
    $ra = []; $co = 0; $sum = 0;
    foreach ($chon as $i) $sum += $gross[$i];
    if ($sum <= 0 || $tong <= 0) return $ra;
    $tong = min($tong, $sum);
    $cuoi = end($chon);
    foreach ($chon as $i) {
      $d = $i === $cuoi ? $tong - $co : intdiv($tong * $gross[$i], $sum);
      $ra[$i] = $d; $co += $d;
    }
    return $ra;
  };
  $eligIdx = array_keys(array_filter($lines, function ($l) {
    return (int)$l['svc']['discountable'] === 1 && empty($l['mdisc']);
  }));

  $pct = function (int $p) use ($eligIdx, $lines, $buoc, $kieu) {
    $ra = [];
    foreach ($eligIdx as $i) {
      $u = $lines[$i]['unit'];
      $con = $u - (int)round($u * $p / 100000) * 1000;
      $con = $kieu === 'near' ? (int)round($con / $buoc) * $buoc : intdiv($con, $buoc) * $buoc;
      $ra[$i] = ($u - max(0, min($u, $con))) * $lines[$i]['qty'];
    }
    return $ra;
  };
  $tier = $tierPct > 0 ? $pct($tierPct) : [];
  $pro  = [];
  if ($promo) $pro = $promo['kind'] === 'pct' ? $pct((int)$promo['value']) : $chia((int)$promo['value'], $eligIdx);
  $laKm = array_sum($pro) > array_sum($tier);
  $dung = $laKm ? $pro : $tier;
  $note = '';
  if (array_sum($dung) > 0)
    $note = $laKm ? 'KM: ' . $promo['name'] : 'Hạng ' . $tierName . ' −' . $tierPct . '%';

  $disc = [];
  foreach ($lines as $i => $l) $disc[$i] = min($gross[$i], $dung[$i] ?? 0);
  $tay = [];
  foreach ($lines as $i => $l) {
    $tay[$i] = min($gross[$i], max(0, (int)($l['mdisc'] ?? 0)));
    if ($tay[$i] > 0) $disc[$i] = $tay[$i];
  }
  $ra = ['lines' => [], 'subtotal' => 0, 'discount' => 0, 'total' => 0, 'note' => $note, 'mdisc' => array_sum($tay)];
  foreach ($lines as $i => $l) {
    $ra['lines'][] = ['net' => $gross[$i] - $disc[$i], 'disc' => $disc[$i], 'gross' => $gross[$i], 'mdisc' => $tay[$i]];
    $ra['subtotal'] += $gross[$i];
    $ra['discount'] += $disc[$i];
  }
  $ra['total'] = $ra['subtotal'] - $ra['discount'];
  return $ra;
}

/* Khuyến mãi đang chạy hôm nay. */
function mhPromos(bool $todayOnly): array {
  $rows = db()->query('SELECT * FROM promos ORDER BY active DESC, sort, id')->fetchAll();
  $nay = mhToday();
  $ra = [];
  foreach ($rows as $p) {
    $p['id'] = (int)$p['id']; $p['value'] = (int)$p['value']; $p['active'] = (int)$p['active'];
    $p['running'] = $p['active'] && ($p['start_date'] === '' || $p['start_date'] <= $nay)
                    && ($p['end_date'] === '' || $p['end_date'] >= $nay);
    if ($todayOnly && !$p['running']) continue;
    $ra[] = $p;
  }
  return $ra;
}

function mhServices(bool $activeOnly): array {
  $rows = db()->query('SELECT * FROM services' . ($activeOnly ? ' WHERE active = 1' : '') . ' ORDER BY sort, id')->fetchAll();
  foreach ($rows as &$s) {
    foreach (['id', 'price', 'active', 'sort', 'wage', 'discountable', 'duration', 'bookable'] as $k) $s[$k] = (int)$s[$k];
    $s['grp'] = (string)$s['grp']; $s['note'] = (string)$s['note'];
    $s['comm_pct'] = (float)$s['comm_pct'];
  }
  unset($s);
  return $rows;
}

/* ============================================================
   Lương thợ
   ============================================================

   Lương = lương cứng + Σ(tiền thợ mỗi lượt × số lượt) + Σ(% hoa hồng ×
   tiền thực thu của dòng) + tip (nếu tip trả cuối tháng) + thưởng/trừ.
   Thợ của cả hoá đơn nhận phần của mọi dòng trong hoá đơn đó.

   Tip: mặc định trả thợ CUỐI NGÀY từ két (đúng như file chốt ca của quán)
   — khi đó chốt ca trừ tip ra, lương tháng không cộng nữa. */
function mhTipMonthly(): bool { return false; }     // quán trả tip trong ngày từ két — lương tháng không cộng

/* KPI của tháng; chưa đặt thì lấy tháng gần nhất trước đó. */
function mhKpi(string $month): array {
  $ra = [];
  $st = db()->prepare('SELECT k.* FROM payroll_kpi k WHERE k.month = (SELECT MAX(month) FROM payroll_kpi
                         WHERE barber_id = k.barber_id AND month <= ?)');
  $st->execute([$month]);
  foreach ($st->fetchAll() as $k)
    $ra[(int)$k['barber_id']] = ['cuts' => (int)$k['cuts'], 'combo' => (int)$k['combo'], 'chem' => (int)$k['chem'],
                                 'prod' => (int)$k['prod'], 'from' => $k['month']];
  return $ra;
}

function mhPayroll(string $month): array {
  $svc = [];
  foreach (mhServices(false) as $s) $svc[$s['id']] = $s;
  $coTip = mhTipMonthly();
  $kpi = mhKpi($month);

  $tho = [];
  foreach (mhBarbers() as $b)
    $tho[$b['id']] = ['id' => $b['id'], 'name' => $b['name'], 'active' => $b['active'],
                      'base' => (int)$b['base_salary'], 'bills' => 0, 'revenue' => 0, 'tip' => 0,
                      'wage' => 0, 'sales' => 0, 'comm' => 0, 'adj' => 0, 'rows' => [], 'adjust' => [],
                      /* Số cho KPI: đầu cắt (dịch vụ cắt không phải combo), số combo,
                         doanh thu hoá chất, doanh thu sản phẩm — đúng 4 cột "Tổng" ở
                         bảng lương tay của quán. */
                      'kpi_now' => ['cuts' => 0, 'combo' => 0, 'chem' => 0, 'prod' => 0],
                      'kpi' => $kpi[$b['id']] ?? null, 'groups' => []];

  $st = db()->prepare("SELECT v.id, v.barber_id, v.amount, v.tip FROM visits v
                        WHERE v.void_at IS NULL AND v.barber_id IS NOT NULL AND v.visit_date LIKE ?");
  $st->execute([$month . '-%']);
  $bills = $st->fetchAll();
  foreach ($bills as $v) {
    $b = (int)$v['barber_id'];
    if (!isset($tho[$b])) continue;
    $tho[$b]['bills']++;
    $tho[$b]['revenue'] += (int)$v['amount'];
    $tho[$b]['tip'] += (int)$v['tip'];
  }
  $st = db()->prepare("SELECT v.barber_id, i.service_id, i.name, SUM(i.qty) q, SUM(i.price) p FROM visit_items i
                         JOIN visits v ON v.id = i.visit_id
                        WHERE v.void_at IS NULL AND v.barber_id IS NOT NULL AND v.visit_date LIKE ?
                        GROUP BY v.barber_id, COALESCE(i.service_id, -1), CASE WHEN i.service_id IS NULL THEN i.name END");
  $st->execute([$month . '-%']);
  foreach ($st->fetchAll() as $r) {
    $b = (int)$r['barber_id'];
    if (!isset($tho[$b])) continue;
    $s = $r['service_id'] !== null ? ($svc[(int)$r['service_id']] ?? null) : null;
    $q = (int)$r['q']; $p = (int)$r['p'];
    $wage = $s ? $s['wage'] * $q : 0;
    $comm = $s && $s['comm_pct'] > 0 ? (int)round($p * $s['comm_pct'] / 100) : 0;
    $tho[$b]['rows'][] = ['name' => $s ? $s['name'] : $r['name'], 'qty' => $q, 'sales' => $p,
                          'rate' => $s ? $s['wage'] : 0, 'wage' => $wage,
                          'comm_pct' => $s ? $s['comm_pct'] : 0, 'comm' => $comm];
    $tho[$b]['wage'] += $wage;
    $tho[$b]['comm'] += $comm;
    if ($s && $s['comm_pct'] > 0) $tho[$b]['sales'] += $p;
    $g = $s ? $s['grp'] : '?';
    $tho[$b]['groups'][$g]['qty'] = ($tho[$b]['groups'][$g]['qty'] ?? 0) + $q;
    $tho[$b]['groups'][$g]['sales'] = ($tho[$b]['groups'][$g]['sales'] ?? 0) + $p;
    $k = &$tho[$b]['kpi_now'];
    if ($s && $s['grp'] === 'B') $k['combo'] += $q;
    elseif ($s && $s['kind'] === 'cut') $k['cuts'] += $q;
    if ($s && $s['grp'] === 'C') $k['chem'] += $p;
    if ($s && ($s['grp'] === 'D' || $s['kind'] === 'product')) $k['prod'] += $p;
    unset($k);
  }
  $st = db()->prepare('SELECT * FROM payroll_adjust WHERE month = ? ORDER BY id');
  $st->execute([$month]);
  foreach ($st->fetchAll() as $a) {
    $b = (int)$a['barber_id'];
    if (!isset($tho[$b])) continue;
    $tho[$b]['adjust'][] = ['id' => (int)$a['id'], 'label' => $a['label'], 'amount' => (int)$a['amount'],
                            'qty' => (int)$a['qty'], 'rate' => (int)$a['rate'], 'recurring' => (int)$a['recurring']];
    $tho[$b]['adj'] += (int)$a['amount'];
  }
  $ra = [];
  foreach ($tho as $t) {
    if (!$t['active'] && !$t['bills'] && !$t['adjust']) continue;     // thợ đã nghỉ, tháng này không làm
    usort($t['rows'], function ($a, $b) { return $b['qty'] <=> $a['qty']; });
    $t['total'] = $t['base'] + $t['wage'] + $t['comm'] + ($coTip ? $t['tip'] : 0) + $t['adj'];
    $ra[] = $t;
  }
  $st = db()->prepare('SELECT COUNT(*) FROM visits WHERE void_at IS NULL AND barber_id IS NULL AND visit_date LIKE ?');
  $st->execute([$month . '-%']);
  return ['month' => $month, 'rows' => $ra, 'tip_included' => $coTip, 'no_barber' => (int)$st->fetchColumn(),
          'groups' => mhGroups()];
}

/* ============================================================
   Chốt ca
   ============================================================

   Tiền phải có trong két = tiền đầu ca + tiền mặt thu từ hoá đơn
   ± ngoài luồng − tip trả thợ từ két (nếu tip trả hằng ngày).
   Giống hệt công thức file "Augustus - Chốt ca": đầu ca + doanh thu −
   chuyển khoản − tip ± ngoài luồng. */
function mhShiftCalc(string $date, int $opening): array {
  $st = db()->prepare('SELECT COALESCE(SUM(pay_cash),0) c, COALESCE(SUM(pay_transfer),0) t, COALESCE(SUM(tip),0) tip,
                              COALESCE(SUM(amount),0) a, COUNT(*) n
                         FROM visits WHERE void_at IS NULL AND visit_date = ?');
  $st->execute([$date]);
  $v = $st->fetch();
  $st = db()->prepare('SELECT COALESCE(SUM(amount),0) FROM cash_moves WHERE void_at IS NULL AND move_date = ?');
  $st->execute([$date]);
  $moves = (int)$st->fetchColumn();
  $tipsOut = mhTipMonthly() ? 0 : (int)$v['tip'];
  return ['opening' => $opening, 'cash_sales' => (int)$v['c'], 'transfer' => (int)$v['t'], 'revenue' => (int)$v['a'],
          'tips' => (int)$v['tip'], 'tips_out' => $tipsOut, 'moves' => $moves, 'bills' => (int)$v['n'],
          'expected' => $opening + (int)$v['c'] + $moves - $tipsOut];
}


/* ============================================================
   Đặt lịch
   ============================================================ */

/* Cấu hình đặt lịch (settings): giờ mở / đóng cửa, bước giờ, khách được tự
   đặt không, đặt trước tối đa mấy ngày, phải đặt trước ít nhất mấy phút,
   những thứ trong tuần quán nghỉ (0 = CN), lời nhắn trên trang đặt lịch. */
function mhBookCfg(): array {
  $hm = function (string $s, int $mac) { return preg_match('/^(\d{1,2}):(\d{2})$/', $s, $m) ? (int)$m[1] * 60 + (int)$m[2] : $mac; };
  $nghi = array_values(array_filter(array_map('intval', explode(',', mhSetting('book_closed_days', ''))),
                                    function ($d) { return $d >= 0 && $d <= 6; }));
  return ['open' => $hm(mhSetting('book_open', '09:00'), 540), 'close' => $hm(mhSetting('book_close', '20:00'), 1200),
          'step' => in_array((int)mhSetting('book_step', '15'), [15, 30], true) ? (int)mhSetting('book_step', '15') : 15,
          'online' => mhSetting('book_online', '1') === '1', 'days' => max(1, min(60, (int)mhSetting('book_days', '14'))),
          'notice' => max(0, min(1440, (int)mhSetting('book_notice', '60'))), 'closed_days' => $nghi,
          'msg' => mhSetting('book_msg', ''),
          /* Khách bỏ hẹn từng này lần (180 ngày gần đây) thì không tự đặt online được nữa. */
          'noshow_block' => max(1, (int)mhSetting('book_noshow_block', '2'))];
}

function mhNowMin(): int { return (int)date('G') * 60 + (int)date('i'); }

/* Lịch bận của từng thợ trong ngày: lịch hẹn còn hiệu lực + giờ nghỉ.
   [barber_id => [[từ, đến, booking_id|0], …]] */
function mhBusy(string $date, int $boQua = 0): array {
  $ra = [];
  $st = db()->prepare("SELECT id, barber_id, start_min, dur FROM bookings
                        WHERE book_date = ? AND status IN ('booked', 'arrived') AND barber_id IS NOT NULL AND id <> ?");
  $st->execute([$date, $boQua]);
  foreach ($st->fetchAll() as $b) $ra[(int)$b['barber_id']][] = [(int)$b['start_min'], (int)$b['start_min'] + (int)$b['dur'], (int)$b['id']];
  $st = db()->prepare('SELECT barber_id, start_min, end_min FROM barber_off WHERE off_date = ?');
  $st->execute([$date]);
  foreach ($st->fetchAll() as $o) $ra[(int)$o['barber_id']][] = [(int)$o['start_min'], (int)$o['end_min'], 0];
  return $ra;
}

function mhFreeAt(array $busy, int $bid, int $tu, int $den): bool {
  foreach ($busy[$bid] ?? [] as [$a, $b]) if ($tu < $b && $a < $den) return false;
  return true;
}

/* Giờ còn trống trong ngày cho một lần làm dài $dur phút: [[phút, [thợ trống…]], …].
   $online: theo luật khách tự đặt (đặt trước tối thiểu, tối đa mấy ngày). */
function mhSlots(string $date, int $dur, ?int $bid, bool $online, int $boQua = 0): array {
  $cfg = mhBookCfg();
  $nay = mhToday();
  if ($date < $nay) return [];
  if (in_array((int)date('w', strtotime($date)), $cfg['closed_days'], true)) return [];
  if ($online && $date > date('Y-m-d', strtotime("+{$cfg['days']} days"))) return [];
  $tho = array_column(mhBarbers(true), 'id');
  if ($bid) $tho = in_array($bid, $tho, true) ? [$bid] : [];
  if (!$tho) return [];
  $busy = mhBusy($date, $boQua);
  $tuGio = $cfg['open'];
  if ($date === $nay) $tuGio = max($tuGio, mhNowMin() + ($online ? $cfg['notice'] : 0));
  $ra = [];
  $dur = max(15, $dur);
  for ($t = $cfg['open']; $t + $dur <= $cfg['close']; $t += $cfg['step']) {
    if ($t < $tuGio) continue;
    $trong = array_values(array_filter($tho, function ($b) use ($busy, $t, $dur) { return mhFreeAt($busy, $b, $t, $t + $dur); }));
    if ($trong) $ra[] = [$t, $trong];
  }
  return $ra;
}

/* Khách không kén thợ: chọn thợ trống, ít lịch trong ngày hơn thì ưu tiên. */
function mhPickBarber(array $busy, array $trong): int {
  usort($trong, function ($a, $b) use ($busy) { return count($busy[$a] ?? []) <=> count($busy[$b] ?? []); });
  return $trong[0];
}

function mhBookRow(array $b, bool $hienSo): array {
  return ['id' => (int)$b['id'], 'date' => $b['book_date'], 'start' => (int)$b['start_min'], 'dur' => (int)$b['dur'],
          'barber_id' => $b['barber_id'] !== null ? (int)$b['barber_id'] : null, 'any' => (int)$b['any_barber'],
          'customer_id' => $b['customer_id'] !== null ? (int)$b['customer_id'] : null,
          'name' => $b['name'], 'phone' => $hienSo ? $b['phone'] : mhMask($b['phone']),
          'services' => json_decode($b['services'], true) ?: [], 'note' => $b['note'], 'status' => $b['status'],
          'confirmed' => (int)$b['confirmed'], 'source' => $b['source'],
          'visit_id' => $b['visit_id'] !== null ? (int)$b['visit_id'] : null,
          'cancel_note' => $b['cancel_note'], 'by' => $b['by_name'] ?? null, 'created_at' => (int)$b['created_at']];
}

/* Dịch vụ khách chọn → [[{id, name}], tổng phút]. Bỏ qua món không đặt được. */
function mhBookServices($ids, bool $online): array {
  $sv = [];
  foreach (mhServices(true) as $s) $sv[$s['id']] = $s;
  $ds = []; $dur = 0;
  foreach (array_unique(array_map('intval', (array)$ids)) as $id) {
    $s = $sv[$id] ?? null;
    if (!$s || $s['kind'] === 'product' || ($online && !$s['bookable'])) continue;
    $ds[] = ['id' => $s['id'], 'name' => $s['name']];
    $dur += $s['duration'] ?: 30;
  }
  return [$ds, $dur];
}

/* ============================================================
   Sao lưu
   ============================================================

   Mỗi đêm Cron Jobs của Hostinger chạy api/backup.php:
     1. chép cơ sở dữ liệu ra một bản ổn định (VACUUM INTO — app vẫn chạy
        bình thường trong lúc chép),
     2. nén zip, khoá bằng mật khẩu MH_BACKUP_PASS (AES-256) — trong đó có
        số điện thoại của cả tệp khách,
     3. giữ 30 bản gần nhất trong memberhub-data/backups (ngoài thư mục web),
     4. gửi vào Gmail qua SMTP bằng "Mật khẩu ứng dụng" của Google.        */

const MH_BACKUP_KEEP = 30;

function mhBackupDir(): string {
  global $DB_FILE;
  $d = dirname($DB_FILE) . '/backups';
  if (!is_dir($d)) @mkdir($d, 0700, true);
  if (!is_file($d . '/.htaccess')) @file_put_contents($d . '/.htaccess', "Require all denied\nOrder allow,deny\nDeny from all\n");
  return $d;
}

function mhBackupFiles(): array {
  $ra = [];
  foreach (glob(mhBackupDir() . '/memberhub-*.{zip,gz}', GLOB_BRACE) ?: [] as $f)
    $ra[] = ['name' => basename($f), 'size' => filesize($f), 'at' => filemtime($f)];
  usort($ra, function ($a, $b) { return strcmp($b['name'], $a['name']); });
  return $ra;
}

function mhBackupMake(): array {
  $dir = mhBackupDir();
  $ts = date('Y-m-d_His');
  $tho = "$dir/memberhub-$ts.sqlite";
  @unlink($tho);
  db()->exec('VACUUM INTO ' . db()->quote($tho));
  $pass = defined('MH_BACKUP_PASS') ? (string)MH_BACKUP_PASS : '';
  if (class_exists('ZipArchive')) {
    $f = "$dir/memberhub-$ts.zip";
    $z = new ZipArchive();
    if ($z->open($f, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) throw new RuntimeException('Không tạo được tệp zip.');
    $z->addFile($tho, "memberhub-$ts.sqlite");
    if ($pass !== '') {
      $z->setPassword($pass);
      if (!$z->setEncryptionName("memberhub-$ts.sqlite", ZipArchive::EM_AES_256)) throw new RuntimeException('Máy chủ không khoá được tệp zip.');
    }
    $z->close();
  } else {
    if ($pass !== '') throw new RuntimeException('Máy chủ thiếu ZipArchive — không khoá được tệp sao lưu.');
    $f = "$dir/memberhub-$ts.sqlite.gz";
    file_put_contents($f, gzencode((string)file_get_contents($tho), 9));
  }
  @unlink($tho);
  $ds = mhBackupFiles();
  foreach (array_slice($ds, MH_BACKUP_KEEP) as $cu) @unlink($dir . '/' . $cu['name']);
  return ['path' => $f, 'name' => basename($f), 'size' => filesize($f), 'locked' => $pass !== ''];
}

function mhBackupMailReady(): bool {
  return defined('MH_BACKUP_TO') && MH_BACKUP_TO !== '' && defined('MH_SMTP_USER') && MH_SMTP_USER !== ''
      && defined('MH_SMTP_PASS') && MH_SMTP_PASS !== '';
}

/* Sao lưu + gửi mail. Ghi kết quả vào settings.last_backup để màn Thiết
   lập và Tổng quan báo cho chủ biết đêm qua có chạy không. */
function mhBackupRun(bool $mail): array {
  $kq = ['at' => time(), 'ok' => false, 'name' => '', 'size' => 0, 'mailed' => false, 'error' => ''];
  try {
    $b = mhBackupMake();
    $kq = array_merge($kq, ['ok' => true, 'name' => $b['name'], 'size' => $b['size'], 'locked' => $b['locked']]);
    if ($mail && mhBackupMailReady()) {
      if (!$b['locked']) throw new RuntimeException('Chưa đặt MH_BACKUP_PASS — không gửi tệp chưa khoá ra ngoài.');
      if ($b['size'] > 20 * 1024 * 1024) throw new RuntimeException('Tệp sao lưu lớn quá 20MB, Gmail không nhận.');
      $shop = defined('MH_SHOP_NAME') ? MH_SHOP_NAME : 'Hội viên';
      mhSmtpSend((string)MH_BACKUP_TO, "[$shop] Sao lưu dữ liệu " . date('d/m/Y'),
        "Bản sao lưu tự động của app $shop lúc " . date('H:i d/m/Y') . ".\n\n"
        . "Tệp: {$b['name']} (" . number_format($b['size'] / 1024, 0, ',', '.') . " KB), khoá bằng mật khẩu sao lưu.\n"
        . "Giữ thư này — khi cần khôi phục, gửi tệp cho người cài app.\n", $b['path']);
      $kq['mailed'] = true;
    }
  } catch (Throwable $e) {
    $kq['error'] = $e->getMessage();
  }
  db()->prepare("INSERT INTO settings (key, value) VALUES ('last_backup', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      ->execute([json_encode($kq, JSON_UNESCAPED_UNICODE)]);
  return $kq;
}

/* Gửi mail qua SMTP (Gmail: smtp.gmail.com cổng 465, đăng nhập bằng Mật
   khẩu ứng dụng 16 chữ). Viết tay cho khỏi kéo thư viện về hosting. */
function mhSmtpSend(string $to, string $subject, string $text, ?string $file = null): void {
  $host = defined('MH_SMTP_HOST') ? MH_SMTP_HOST : 'smtp.gmail.com';
  $port = defined('MH_SMTP_PORT') ? (int)MH_SMTP_PORT : 465;
  $user = (string)MH_SMTP_USER;
  $pass = str_replace(' ', '', (string)MH_SMTP_PASS);
  $nhan = array_values(array_filter(array_map('trim', explode(',', $to))));
  if (!$nhan) throw new RuntimeException('Chưa có địa chỉ nhận.');

  $fp = @stream_socket_client(($port === 465 ? 'ssl://' : 'tcp://') . "$host:$port", $eno, $estr, 20);
  if (!$fp) throw new RuntimeException("Không nối được tới $host:$port ($estr).");
  stream_set_timeout($fp, 30);
  $doc = function () use ($fp) {
    $s = '';
    while (($l = fgets($fp, 1024)) !== false) { $s .= $l; if (strlen($l) < 4 || $l[3] === ' ') break; }
    return $s;
  };
  $lenh = function (?string $c, array $mong) use ($fp, $doc) {
    if ($c !== null) fwrite($fp, $c . "\r\n");
    $r = $doc();
    if (!in_array((int)substr($r, 0, 3), $mong, true))
      throw new RuntimeException('Máy chủ thư trả lời: ' . trim(preg_replace('/\s+/', ' ', $r)));
    return $r;
  };
  try {
    $lenh(null, [220]);
    $lenh('EHLO memberhub', [250]);
    if ($port !== 465) {
      $lenh('STARTTLS', [220]);
      if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) throw new RuntimeException('Không bật được TLS.');
      $lenh('EHLO memberhub', [250]);
    }
    $lenh('AUTH LOGIN', [334]);
    $lenh(base64_encode($user), [334]);
    try { $lenh(base64_encode($pass), [235]); }
    catch (RuntimeException $e) {
      throw new RuntimeException('Gmail không nhận mật khẩu — phải dùng "Mật khẩu ứng dụng" 16 chữ, không phải mật khẩu Gmail. ' . $e->getMessage());
    }
    $lenh("MAIL FROM:<$user>", [250]);
    foreach ($nhan as $n) $lenh("RCPT TO:<$n>", [250, 251]);
    $lenh('DATA', [354]);
    $ranh = 'mh' . bin2hex(random_bytes(8));
    $h = 'From: ' . '=?UTF-8?B?' . base64_encode(defined('MH_SHOP_NAME') ? MH_SHOP_NAME : 'Hoi vien') . "?= <$user>\r\n"
       . 'To: ' . implode(', ', $nhan) . "\r\n"
       . 'Subject: =?UTF-8?B?' . base64_encode($subject) . "?=\r\n"
       . 'Date: ' . date('r') . "\r\n"
       . 'Message-ID: <' . bin2hex(random_bytes(12)) . '@memberhub>' . "\r\n"
       . "MIME-Version: 1.0\r\n"
       . "Content-Type: multipart/mixed; boundary=\"$ranh\"\r\n\r\n"
       . "--$ranh\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
       . chunk_split(base64_encode($text)) . "\r\n";
    if ($file !== null) {
      $ten = basename($file);
      $h .= "--$ranh\r\nContent-Type: application/octet-stream; name=\"$ten\"\r\nContent-Transfer-Encoding: base64\r\n"
          . "Content-Disposition: attachment; filename=\"$ten\"\r\n\r\n"
          . chunk_split(base64_encode((string)file_get_contents($file)));
    }
    $h .= "--$ranh--\r\n";
    /* base64 không bao giờ có dòng bắt đầu bằng dấu chấm — khỏi phải độn. */
    fwrite($fp, $h . "\r\n.\r\n");
    $lenh(null, [250]);
    @fwrite($fp, "QUIT\r\n");
  } finally {
    fclose($fp);
  }
}
