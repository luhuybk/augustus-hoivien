<?php
/* ============================================================
   index.php — cửa duy nhất app gọi vào.

   Mọi lệnh đi bằng POST JSON: {"action":"visit_add", ...}
   và luôn trả {"ok":true, ...} hoặc {"ok":false,"error":"..."}.

   Tài khoản quầy dùng chung, nên phần lớn chỗ khó ở file này là giữ cho
   quầy làm đúng việc của quầy: tra khách, ghi lượt HÔM NAY, trao quà,
   tự huỷ lượt mình vừa ghi nhầm — và không hơn thế.
   ============================================================ */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

function out(array $data, int $code = 200) {
  http_response_code($code);
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

require __DIR__ . '/lib.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST')
  out(['ok' => false, 'error' => 'Chỉ nhận POST.'], 405);

$raw = file_get_contents('php://input') ?: '';
if (strlen($raw) > 12 * 1024 * 1024)        // file KiotViet cả năm ~ 1MB sau khi rút gọn
  out(['ok' => false, 'error' => 'Dữ liệu gửi lên lớn quá. Chia file theo từng quý rồi nhập lần lượt.'], 413);

$req = json_decode($raw, true);
if (!is_array($req)) out(['ok' => false, 'error' => 'Dữ liệu gửi lên không đọc được.'], 400);

$action = (string)($req['action'] ?? '');
function inp(string $k, $default = null) { global $req; return $req[$k] ?? $default; }
function validDate($s): bool { return is_string($s) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $s) && strtotime($s) !== false; }

/* Thẻ khách đầy đủ — thứ quầy nhìn vào khi khách đứng trước mặt.
   Quầy thấy số đã che và 5 lượt gần nhất; chủ thấy hết. */
function customerCard(int $cid, array $u): array {
  $c = mhCustomerRow($cid);
  if (!$c) out(['ok' => false, 'error' => 'Không tìm thấy khách này.'], 404);
  $owner = mhIsOwner($u);
  $s     = mhStats($cid)[$cid];
  $tier  = mhTierOf($s['cuts'], $s['spend'], mhTiers());

  $visits = mhVisitList('v.customer_id = ?' . ($owner ? '' : ' AND v.void_at IS NULL'),
                        [$cid], $owner ? 500 : 5);
  $han = time() - MH_UNDO_MINUTES * 60;
  foreach ($visits as &$v) {
    $v['can_void'] = $v['void_at'] === null && ($owner
      || ($v['source'] === 'counter' && $v['created_by'] === $u['id'] && $v['created_at'] >= $han));
    unset($v['customer_phone']);
  }
  unset($v);

  $ra = [
    'customer' => [
      'id' => $c['id'], 'name' => $c['name'],
      'phone' => $owner ? $c['phone'] : mhMask($c['phone']),
      'note' => $c['note'], 'kv_code' => $c['kv_code'], 'created_at' => (int)$c['created_at'],
    ],
    'bday'    => mhBdayState($c, $tier['tier'], isset(mhBdayGivenThisYear()[$cid])),
    'stats'   => $s,
    'tier'    => $tier,
    'rewards' => mhCustomerRewards($cid),
    'visits'  => $visits,
    /* Thợ quen, và thợ của lượt gần nhất — quầy chọn sẵn thợ đó khi ghi
       lượt mới, vì khách quen phần lớn cắt lại đúng người cũ. */
    'barbers' => mhCustomerBarbers($cid),
    'last_barber_id' => (function () use ($cid) {
      $st = db()->prepare('SELECT barber_id FROM visits WHERE customer_id = ? AND void_at IS NULL
                             AND barber_id IS NOT NULL ORDER BY visit_date DESC, id DESC LIMIT 1');
      $st->execute([$cid]);
      $b = $st->fetchColumn();
      return $b === false ? null : (int)$b;
    })(),
  ];
  if ($owner) {
    $st = db()->prepare('SELECT g.year, g.gift, g.given_at, u.name AS by_name FROM birthday_given g
                      LEFT JOIN users u ON u.id = g.given_by WHERE g.customer_id = ? ORDER BY g.year DESC');
    $st->execute([$cid]);
    $ra['bday_given'] = array_map(function ($g) {
      return ['year' => (int)$g['year'], 'gift' => $g['gift'], 'given_at' => (int)$g['given_at'], 'by' => $g['by_name']];
    }, $st->fetchAll());
    $st = db()->prepare('SELECT phone FROM customer_aliases WHERE customer_id = ? ORDER BY created_at');
    $st->execute([$cid]);
    $ra['aliases'] = $st->fetchAll(PDO::FETCH_COLUMN);
    $st = db()->prepare('SELECT g.*, p.name AS program, u.name AS by_name FROM rewards_given g
                           JOIN programs p ON p.id = g.program_id
                      LEFT JOIN users u ON u.id = g.given_by
                          WHERE g.customer_id = ? ORDER BY g.given_at DESC');
    $st->execute([$cid]);
    $ra['given'] = array_map(function ($g) {
      return ['id' => (int)$g['id'], 'program' => $g['program'], 'gift' => $g['gift'],
              'at_count' => (int)$g['at_count'], 'given_at' => (int)$g['given_at'], 'by' => $g['by_name']];
    }, $st->fetchAll());
  }
  return $ra;
}

/* Quà còn nợ của một khách, dạng khoá "program|seq" → phần quà. */
function pendingKeys(int $cid): array {
  $ra = [];
  foreach (mhCustomerRewards($cid) as $p)
    foreach ($p['pending'] as $e) $ra[$p['program_id'] . '|' . $e['seq']] = $e + ['program' => $p['name']];
  return $ra;
}

/* Tính cho TẤT CẢ khách một lượt: số lượt, hạng, số quà còn nợ.
   Vài nghìn khách vẫn chỉ là vài câu SQL gộp nhóm. */
function allCustomers(): array {
  $tiers = mhTiers();
  $stats = mhStats();
  $given = mhGiven();
  $progs = mhPrograms();
  $counts = [];
  foreach ($progs as $p) $counts[$p['id']] = mhProgramCounts($p);

  $flag = [];
  foreach (db()->query("SELECT customer_id, COUNT(*) n FROM visits
                         WHERE void_at IS NULL AND flags LIKE '%NO_INVOICE%' GROUP BY customer_id")->fetchAll() as $r)
    $flag[(int)$r['customer_id']] = (int)$r['n'];

  $tho = mhMainBarbers();
  $sn  = mhBdayGivenThisYear();
  $ra = [];
  foreach (db()->query('SELECT * FROM customers ORDER BY name')->fetchAll() as $c) {
    $cid = (int)$c['id'];
    $s = $stats[$cid] ?? ['visits' => 0, 'spend' => 0, 'cuts' => 0, 'last' => null];
    $t = mhTierOf($s['cuts'], $s['spend'], $tiers)['tier'];
    $pend = [];
    foreach ($progs as $p) {
      $st = mhRewardState($p, $counts[$p['id']][$cid] ?? 0, $given[$cid][$p['id']] ?? []);
      foreach ($st['pending'] as $e) $pend[] = $e['gift'];
    }
    $bd = mhBdayState($c, $t, isset($sn[$cid]));
    if ($bd['pending']) $pend[] = '🎂 ' . $bd['gift'];
    $ra[] = ['id' => $cid, 'name' => $c['name'], 'phone' => $c['phone'],
             'visits' => $s['visits'], 'cuts' => $s['cuts'], 'spend' => $s['spend'], 'last' => $s['last'],
             'tier_id' => $t ? $t['id'] : null, 'pending' => $pend, 'flagged' => $flag[$cid] ?? 0,
             'barber_id' => $tho[$cid] ?? null,
             'birthday' => $bd['birthday'], 'bday_eligible' => $bd['eligible'], 'bday_given' => $bd['given'],
             'created_at' => (int)$c['created_at']];
  }
  return $ra;
}

switch ($action) {

/* ===== đăng nhập ===== */

case 'login': {
  $user = mb_strtolower(trim((string)inp('username', '')));
  $pass = mhPass((string)inp('password', ''));
  if ($user === '' || $pass === '') out(['ok' => false, 'error' => 'Nhập tên đăng nhập và mật khẩu.'], 400);

  $left = mhLockLeft($user);
  if ($left > 0) out(['ok' => false, 'error' => 'Sai nhiều lần quá. Thử lại sau ' . ceil($left / 60) . ' phút.'], 429);

  $st = db()->prepare('SELECT * FROM users WHERE username = ?');
  $st->execute([$user]);
  $u = $st->fetch();
  /* Nói rõ hỏng ở đâu. Quán vài người, tên đăng nhập ai cũng biết; còn
     chặn dò thì đã có khoá 5 phút lo. */
  if (!$u) { mhNoteLoginFail($user); out(['ok' => false, 'error' => 'Không có tài khoản "' . $user . '".'], 401); }
  if ((int)$u['active'] !== 1) { mhNoteLoginFail($user); out(['ok' => false, 'error' => 'Tài khoản này đang bị tắt. Nhờ chủ quán bật lại.'], 401); }
  if (!mhVerifyPass($pass, $u['pass_hash'])) { mhNoteLoginFail($user); out(['ok' => false, 'error' => 'Sai mật khẩu.'], 401); }

  mhClearLoginFails($user);
  $token = mhNewSession((int)$u['id']);
  mhAudit((int)$u['id'], 'login');
  out(['ok' => true, 'token' => $token,
       'user' => ['id' => (int)$u['id'], 'name' => $u['name'], 'role' => $u['role']]]);
}

case 'logout': {
  $u = mhRequireUser();
  db()->prepare('DELETE FROM sessions WHERE token_hash = ?')->execute([$u['token_hash']]);
  out(['ok' => true]);
}

case 'me': {
  $u = mhRequireUser();
  out(['ok' => true, 'user' => ['id' => $u['id'], 'name' => $u['name'], 'role' => $u['role']],
       'shop' => MH_SHOP_NAME, 'kinds' => MH_KINDS, 'undo_minutes' => MH_UNDO_MINUTES,
       'today' => mhToday()]);
}

case 'shop': {
  out(['ok' => true, 'shop' => MH_SHOP_NAME]);
}

/* Tài khoản quầy dùng chung nên không tự đổi mật khẩu — đổi xong những
   người khác cùng ca không vào được. Chủ quán đổi giúp ở mục Tài khoản. */
case 'change_password': {
  $u = mhRequireOwner();
  $cu  = mhPass((string)inp('old_password', ''));
  $moi = mhPass((string)inp('new_password', ''));
  if (!mhVerifyPass($cu, $u['pass_hash'])) out(['ok' => false, 'error' => 'Mật khẩu hiện tại không đúng.'], 401);
  if (mb_strlen($moi) < MH_MIN_PASSWORD) out(['ok' => false, 'error' => 'Mật khẩu mới phải từ ' . MH_MIN_PASSWORD . ' ký tự.'], 400);
  db()->prepare('UPDATE users SET pass_hash = ? WHERE id = ?')->execute([mhMakePass($moi), $u['id']]);
  db()->prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?')->execute([$u['id'], $u['token_hash']]);
  mhAudit($u['id'], 'change_password');
  out(['ok' => true]);
}

/* ===== tra cứu ở quầy ===== */

/* Gõ 4 số cuối → mọi khách có đuôi số đó (đã có sẵn 22 cặp trùng trong
   tệp khách 2025, nên luôn phải trả về danh sách để chọn). Gõ nhiều số
   hơn thì tìm theo đoạn số; gõ chữ thì tìm theo tên, không dấu. */
case 'search': {
  $u = mhRequireUser();
  $q = trim((string)inp('q', ''));
  $digits = preg_replace('/\D/', '', $q);

  if ($digits !== '' && $digits === preg_replace('/[\s.\-]/', '', $q)) {
    if (strlen($digits) < 4) out(['ok' => false, 'error' => 'Gõ ít nhất 4 số.'], 400);
    /* Quầy chỉ tra được bằng đúng 4 số cuối hoặc đủ cả số. Cho tìm đoạn số
       giữa thì thử vài lần là đoán ra được mấy số đang bị che (077***7489). */
    if (!mhIsOwner($u) && strlen($digits) !== 4) {
      $digits = mhPhone($digits);
      if (strlen($digits) < 10) out(['ok' => false, 'error' => 'Gõ 4 số cuối, hoặc đủ cả số điện thoại.'], 400);
      $st = db()->prepare('SELECT * FROM customers WHERE phone = ?
                            OR id IN (SELECT customer_id FROM customer_aliases WHERE phone = ?)');
      $st->execute([$digits, $digits]);
    } elseif (strlen($digits) === 4) {
      /* Cả khách có số CŨ mang đuôi này — khách đổi số hay đọc nhầm số cũ. */
      $st = db()->prepare('SELECT * FROM customers WHERE last4 = ?
                            OR id IN (SELECT customer_id FROM customer_aliases WHERE last4 = ?)
                          ORDER BY name LIMIT 30');
      $st->execute([$digits, $digits]);
    } else {
      $st = db()->prepare('SELECT * FROM customers WHERE phone LIKE ?
                            OR id IN (SELECT customer_id FROM customer_aliases WHERE phone LIKE ?)
                          ORDER BY name LIMIT 30');
      $st->execute(['%' . mhPhone($digits) . '%', '%' . mhPhone($digits) . '%']);
    }
    $rows = $st->fetchAll();
  } else {
    $f = mhFold($q);
    if (mb_strlen($f) < 2) out(['ok' => false, 'error' => 'Gõ 4 số cuối điện thoại, hoặc ít nhất 2 chữ của tên.'], 400);
    $rows = [];
    foreach (db()->query('SELECT * FROM customers ORDER BY name')->fetchAll() as $c)
      if (str_contains(mhFold((string)$c['name']), $f)) { $rows[] = $c; if (count($rows) >= 30) break; }
  }

  $tiers = mhTiers();
  $ra = [];
  foreach ($rows as $c) {
    $cid = (int)$c['id'];
    $s = mhStats($cid)[$cid];
    $t = mhTierOf($s['cuts'], $s['spend'], $tiers)['tier'];
    $pending = 0;
    foreach (mhCustomerRewards($cid) as $p) $pending += count($p['pending']);
    if (mhBdayState($c, $t, isset(mhBdayGivenThisYear()[$cid]))['pending']) $pending++;
    $ra[] = ['id' => $cid, 'name' => $c['name'],
             'phone' => mhIsOwner($u) ? $c['phone'] : mhMask($c['phone']),
             'cuts' => $s['cuts'], 'last' => $s['last'], 'tier' => $t, 'pending' => $pending];
  }
  out(['ok' => true, 'rows' => $ra]);
}

case 'customer_get': {
  $u = mhRequireUser();
  out(['ok' => true] + customerCard((int)inp('id', 0), $u));
}

case 'customer_create': {
  $u = mhRequireUser();
  $name  = trim((string)inp('name', ''));
  $phone = mhPhone((string)inp('phone', ''));
  if ($name === '') out(['ok' => false, 'error' => 'Nhập tên khách.'], 400);
  if (!preg_match('/^0\d{9}$/', $phone))
    out(['ok' => false, 'error' => 'Số điện thoại phải đủ 10 số, bắt đầu bằng 0.'], 400);

  if ($c = mhFindByPhone($phone))
    out(['ok' => false, 'code' => 'exists', 'id' => (int)$c['id'],
         'error' => 'Số này đã có trong danh sách: ' . ($c['name'] ?: 'chưa có tên') . '.'], 409);

  $c = mhEnsureCustomer($phone, $name, $u['id']);
  mhAudit($u['id'], 'customer_create', $name . ' · ' . mhMask($phone));
  out(['ok' => true, 'id' => $c['id']]);
}

case 'customer_update': {
  $u = mhRequireOwner();
  $id    = (int)inp('id', 0);
  $name  = trim((string)inp('name', ''));
  $phone = mhPhone((string)inp('phone', ''));
  $note  = trim((string)inp('note', ''));
  $c = mhCustomerRow($id);
  if (!$c) out(['ok' => false, 'error' => 'Không tìm thấy khách.'], 404);
  if (strlen($phone) < 9) out(['ok' => false, 'error' => 'Số điện thoại chưa đúng.'], 400);
  $khac = mhFindByPhone($phone);
  if ($khac && $khac['id'] !== $id)
    out(['ok' => false, 'error' => 'Số này đang thuộc về khách "' . $khac['name']
         . '". Nếu là cùng một người thì dùng "Gộp khách trùng".'], 409);
  $pdo = db();
  $pdo->beginTransaction();
  /* Đổi số: giữ số cũ làm số phụ — hoá đơn KiotViet cũ mang số cũ vẫn về
     đúng người, và khách đọc số cũ ở quầy vẫn tra ra. */
  if ($c['phone'] !== $phone) {
    mhAddAlias($c['phone'], $id);
    $pdo->prepare('DELETE FROM customer_aliases WHERE phone = ?')->execute([$phone]);
  }
  $pdo->prepare('UPDATE customers SET name = ?, phone = ?, last4 = ?, note = ? WHERE id = ?')
      ->execute([$name, $phone, substr($phone, -4), $note, $id]);
  if (inp('bd_day') !== null) {
    [$bd, $by] = mhParseBday(inp('bd_day'), inp('bd_month'), inp('bd_year'));
    $pdo->prepare('UPDATE customers SET birthday = ?, birth_year = ? WHERE id = ?')->execute([$bd, $by, $id]);
  }
  $pdo->commit();
  mhAudit($u['id'], 'customer_update', "#$id " . $c['name'] . ($c['phone'] !== $phone ? ' · đổi số' : ''));
  out(['ok' => true] + customerCard($id, $u));
}

/* ===== ghi lượt ===== */

case 'visit_add': {
  $u = mhRequireUser();
  $owner = mhIsOwner($u);
  $cid = (int)inp('customer_id', 0);
  if (!mhCustomerRow($cid)) out(['ok' => false, 'error' => 'Không tìm thấy khách.'], 404);

  $items = inp('items', []);
  if (!is_array($items) || !$items) out(['ok' => false, 'error' => 'Chọn ít nhất một dịch vụ.'], 400);

  /* Ngày luôn là hôm nay theo máy chủ. Chỉ chủ được ghi bù ngày cũ. */
  $date = mhToday();
  if ($owner && validDate(inp('date')) && inp('date') <= mhToday()) $date = inp('date');

  $sv = [];
  foreach (db()->query('SELECT * FROM services')->fetchAll() as $s) $sv[(int)$s['id']] = $s;

  $rows = []; $amount = 0; $coCat = false;
  foreach ($items as $it) {
    $s = $sv[(int)($it['service_id'] ?? 0)] ?? null;
    if (!$s || (!$s['active'] && !$owner)) out(['ok' => false, 'error' => 'Có dịch vụ không còn trong danh sách. Tải lại trang.'], 400);
    $price = (int)$s['price'];
    /* Giá 0 = sản phẩm, giá thay đổi theo món nên quầy tự nhập. Có trần
       để một lần gõ thừa ba số 0 không đẩy khách lên hạng Đen. */
    if ($price === 0) {
      $price = (int)($it['price'] ?? 0);
      if ($price < 1000 || $price > 10000000)
        out(['ok' => false, 'error' => 'Nhập giá cho "' . $s['name'] . '" (từ 1.000đ đến 10 triệu).'], 400);
    }
    $rows[] = [(int)$s['id'], $s['name'], $s['kind'], $price];
    $amount += $price;
    if ($s['kind'] === 'cut') $coCat = true;
  }

  /* Một người không cắt tóc hai lần một ngày. Chặn ở đây là chặn luôn
     kiểu bấm hai lần cho chắc, hay cộng thêm lượt để khách quen sớm có
     quà. Thật sự có lần hai thì chủ ghi tay được. */
  if ($coCat && !$owner) {
    $st = db()->prepare("SELECT v.visit_time FROM visits v
                          WHERE v.customer_id = ? AND v.visit_date = ? AND v.void_at IS NULL
                            AND EXISTS (SELECT 1 FROM visit_items i WHERE i.visit_id = v.id AND i.kind = 'cut')
                          LIMIT 1");
    $st->execute([$cid, $date]);
    $gio = $st->fetchColumn();
    if ($gio !== false)
      out(['ok' => false, 'error' => 'Khách này đã được ghi một lượt cắt hôm nay'
           . ($gio ? ' lúc ' . $gio : '') . '. Nếu thật sự cắt lần hai, nhờ chủ quán ghi thêm.'], 409);
  }

  /* Thợ cắt: quầy bắt buộc chọn khi quán đã khai thợ — dữ liệu "khách
     này hay cắt với ai" chỉ có giá trị khi lượt nào cũng có. */
  $bid = (int)inp('barber_id', 0) ?: null;
  $dsTho = mhBarbers(true);
  if ($bid !== null && !in_array($bid, array_column(mhBarbers(), 'id'), true))
    out(['ok' => false, 'error' => 'Thợ này không còn trong danh sách. Tải lại trang.'], 400);
  if ($bid === null && $dsTho && !$owner)
    out(['ok' => false, 'error' => 'Chọn thợ cắt cho lượt này.'], 400);

  $truoc = pendingKeys($cid);

  $pdo = db();
  $pdo->beginTransaction();
  $pdo->prepare('INSERT INTO visits (customer_id, visit_date, visit_time, amount, source, note, barber_id, created_at, created_by)
                 VALUES (?,?,?,?,?,?,?,?,?)')
      ->execute([$cid, $date, $date === mhToday() ? date('H:i') : '', $amount,
                 $owner ? 'owner' : 'counter', trim((string)inp('note', '')), $bid, time(), $u['id']]);
  $vid = (int)$pdo->lastInsertId();
  $ins = $pdo->prepare('INSERT INTO visit_items (visit_id, service_id, name, kind, qty, price) VALUES (?,?,?,?,1,?)');
  foreach ($rows as $r) $ins->execute([$vid, $r[0], $r[1], $r[2], $r[3]]);
  $pdo->commit();

  $moi = array_values(array_diff_key(pendingKeys($cid), $truoc));
  mhAudit($u['id'], 'visit_add', "#$vid khách #$cid · " . implode(', ', array_column($rows, 1)) . ' · ' . $amount);
  out(['ok' => true, 'visit_id' => $vid, 'new_rewards' => $moi] + customerCard($cid, $u));
}

/* Huỷ lượt: quầy chỉ huỷ được lượt chính mình vừa ghi, trong vài phút.
   Không xoá — đánh dấu huỷ, ghi ai huỷ và vì sao. */
case 'visit_void': {
  $u = mhRequireUser();
  $id = (int)inp('id', 0);
  $reason = trim((string)inp('reason', ''));
  $st = db()->prepare('SELECT * FROM visits WHERE id = ?');
  $st->execute([$id]);
  $v = $st->fetch();
  if (!$v) out(['ok' => false, 'error' => 'Không tìm thấy lượt này.'], 404);
  if ($v['void_at'] !== null) out(['ok' => false, 'error' => 'Lượt này đã huỷ rồi.'], 409);
  if (!mhIsOwner($u)) {
    if ($v['source'] !== 'counter' || (int)$v['created_by'] !== $u['id'])
      out(['ok' => false, 'error' => 'Chỉ huỷ được lượt do chính tài khoản này ghi.'], 403);
    if ((int)$v['created_at'] < time() - MH_UNDO_MINUTES * 60)
      out(['ok' => false, 'error' => 'Quá ' . MH_UNDO_MINUTES . ' phút rồi — nhờ chủ quán huỷ giúp.'], 403);
    if ($reason === '') $reason = 'Quầy ghi nhầm';
  }
  if ($reason === '') out(['ok' => false, 'error' => 'Ghi lý do huỷ.'], 400);
  db()->prepare('UPDATE visits SET void_at = ?, void_by = ?, void_reason = ? WHERE id = ?')
      ->execute([time(), $u['id'], $reason, $id]);
  mhAudit($u['id'], 'visit_void', "#$id khách #" . $v['customer_id'] . ' · ' . $reason);
  out(['ok' => true] + customerCard((int)$v['customer_id'], $u));
}

/* Đổi thợ của một lượt đã ghi (chọn nhầm). Cùng luật với huỷ lượt: quầy
   chỉ sửa được lượt mình vừa ghi, trong vài phút. */
case 'visit_barber': {
  $u = mhRequireUser();
  $id  = (int)inp('id', 0);
  $bid = (int)inp('barber_id', 0) ?: null;
  $st = db()->prepare('SELECT * FROM visits WHERE id = ?');
  $st->execute([$id]);
  $v = $st->fetch();
  if (!$v || $v['void_at'] !== null) out(['ok' => false, 'error' => 'Không tìm thấy lượt này.'], 404);
  if (!mhIsOwner($u) && ($v['source'] !== 'counter' || (int)$v['created_by'] !== $u['id']
                         || (int)$v['created_at'] < time() - MH_UNDO_MINUTES * 60))
    out(['ok' => false, 'error' => 'Chỉ sửa được lượt mình vừa ghi trong ' . MH_UNDO_MINUTES . ' phút.'], 403);
  if ($bid !== null && !in_array($bid, array_column(mhBarbers(), 'id'), true))
    out(['ok' => false, 'error' => 'Không có thợ này.'], 400);
  db()->prepare('UPDATE visits SET barber_id = ? WHERE id = ?')->execute([$bid, $id]);
  mhAudit($u['id'], 'visit_barber', "#$id → thợ #" . ($bid ?? 0));
  out(['ok' => true] + customerCard((int)$v['customer_id'], $u));
}

/* Gộp khách trùng: mọi lượt, quà đã trao, số phụ của khách "from" chuyển
   sang khách "into", số chính của "from" thành số phụ của "into", rồi xoá
   "from". Dùng khi một người có hai số, hoặc lỡ tạo hai lần. */
case 'customer_merge': {
  $u = mhRequireOwner();
  $into = (int)inp('into', 0);
  $from = (int)inp('from', 0);
  $a = mhCustomerRow($into); $b = mhCustomerRow($from);
  if (!$a || !$b) out(['ok' => false, 'error' => 'Không tìm thấy khách.'], 404);
  if ($into === $from) out(['ok' => false, 'error' => 'Không gộp một khách với chính họ.'], 400);

  $pdo = db();
  $pdo->beginTransaction();
  $pdo->prepare('UPDATE visits SET customer_id = ? WHERE customer_id = ?')->execute([$into, $from]);

  /* Quà đã trao: hai người cùng đã nhận quà mốc 3 thì sau khi gộp là hai
     phần quà — đánh số lại theo thứ tự thời gian đã trao, để không mất
     dòng nào và cũng không trao lại phần đã trao. */
  $st = $pdo->prepare('SELECT * FROM rewards_given WHERE customer_id IN (?,?) ORDER BY program_id, given_at, id');
  $st->execute([$into, $from]);
  $qua = $st->fetchAll();
  $pdo->prepare('DELETE FROM rewards_given WHERE customer_id IN (?,?)')->execute([$into, $from]);
  $ins = $pdo->prepare('INSERT INTO rewards_given (customer_id, program_id, seq, gift, at_count, given_at, given_by)
                        VALUES (?,?,?,?,?,?,?)');
  $dem = [];
  foreach ($qua as $g) {
    $p = (int)$g['program_id'];
    $dem[$p] = ($dem[$p] ?? -1) + 1;
    $ins->execute([$into, $p, $dem[$p], $g['gift'], $g['at_count'], $g['given_at'], $g['given_by']]);
  }

  $pdo->prepare('UPDATE customer_aliases SET customer_id = ? WHERE customer_id = ?')->execute([$into, $from]);
  $ghi = trim($a['note'] . "\nĐã gộp từ " . ($b['name'] ?: '(chưa tên)') . ' · ' . $b['phone'] . ' · ' . date('d/m/Y'));
  $pdo->prepare('UPDATE customers SET note = ?, kv_code = COALESCE(kv_code, ?),
                                      name = CASE WHEN name = \'\' THEN ? ELSE name END WHERE id = ?')
      ->execute([$ghi, $b['kv_code'], $b['name'], $into]);
  $pdo->prepare('DELETE FROM customers WHERE id = ?')->execute([$from]);
  mhAddAlias($b['phone'], $into);
  $pdo->commit();

  mhAudit($u['id'], 'customer_merge', '#' . $from . ' ' . $b['name'] . ' (' . $b['phone'] . ') → #' . $into . ' ' . $a['name']);
  out(['ok' => true] + customerCard($into, $u));
}

/* Bỏ một số phụ (lỡ gộp nhầm số của người khác vào). */
case 'alias_del': {
  $u = mhRequireOwner();
  $phone = mhPhone((string)inp('phone', ''));
  $st = db()->prepare('SELECT customer_id FROM customer_aliases WHERE phone = ?');
  $st->execute([$phone]);
  $cid = (int)$st->fetchColumn();
  if (!$cid) out(['ok' => false, 'error' => 'Không có số phụ này.'], 404);
  db()->prepare('DELETE FROM customer_aliases WHERE phone = ?')->execute([$phone]);
  mhAudit($u['id'], 'alias_del', "khách #$cid · " . $phone);
  out(['ok' => true] + customerCard($cid, $u));
}

/* ===== thợ cắt ===== */

case 'barbers': {
  $u = mhRequireUser();
  if (!mhIsOwner($u)) out(['ok' => true, 'rows' => mhBarbers(true)]);
  /* Chủ xem kèm số liệu từng thợ: tổng lượt, số khách, và số khách coi
     thợ đó là thợ chính (khách quen — từ 3 lượt trở lên). */
  $rows = mhBarbers();
  $tk = [];
  foreach (db()->query('SELECT barber_id, COUNT(*) n, COUNT(DISTINCT customer_id) k, MAX(visit_date) last
                          FROM visits WHERE void_at IS NULL AND barber_id IS NOT NULL GROUP BY barber_id')->fetchAll() as $r)
    $tk[(int)$r['barber_id']] = $r;
  $quen = [];
  $st = mhStats();
  foreach (mhMainBarbers() as $cid => $bid)
    if (($st[$cid]['visits'] ?? 0) >= 3) $quen[$bid] = ($quen[$bid] ?? 0) + 1;
  foreach ($rows as &$b) {
    $b['visits'] = (int)($tk[$b['id']]['n'] ?? 0);
    $b['customers'] = (int)($tk[$b['id']]['k'] ?? 0);
    $b['last'] = $tk[$b['id']]['last'] ?? null;
    $b['loyal'] = $quen[$b['id']] ?? 0;
  }
  unset($b);
  out(['ok' => true, 'rows' => $rows]);
}

case 'barbers_save': {
  $u = mhRequireOwner();
  $rows = inp('rows', []);
  if (!is_array($rows)) out(['ok' => false, 'error' => 'Dữ liệu không đúng.'], 400);
  $pdo = db();
  $pdo->beginTransaction();
  $up  = $pdo->prepare('UPDATE barbers SET name = ?, kv_name = ?, active = ?, sort = ? WHERE id = ?');
  $ins = $pdo->prepare('INSERT INTO barbers (name, kv_name, active, sort, created_at) VALUES (?,?,?,?,?)');
  foreach (array_values($rows) as $i => $r) {
    $ten = trim((string)($r['name'] ?? ''));
    if ($ten === '') out(['ok' => false, 'error' => 'Thợ thứ ' . ($i + 1) . ' chưa có tên.'], 400);
    $kv = mhCleanKvName((string)($r['kv_name'] ?? ''));
    if (!empty($r['id'])) $up->execute([$ten, $kv, !empty($r['active']) ? 1 : 0, $i + 1, (int)$r['id']]);
    else $ins->execute([$ten, $kv, !empty($r['active']) ? 1 : 0, $i + 1, time()]);
  }
  $pdo->commit();
  mhAudit($u['id'], 'barbers_save', count($rows) . ' thợ');
  out(['ok' => true]);
}

/* ===== sinh nhật ===== */

/* Quầy ghi ngày sinh khi khách chưa có — hỏi ngay tại quầy. Đã có rồi thì
   chỉ chủ sửa được: không thì đổi ngày sinh sang tháng này là "có quà". */
case 'customer_birthday': {
  $u = mhRequireUser();
  $id = (int)inp('id', 0);
  $c = mhCustomerRow($id);
  if (!$c) out(['ok' => false, 'error' => 'Không tìm thấy khách.'], 404);
  if (!mhIsOwner($u) && $c['birthday'] !== '')
    out(['ok' => false, 'error' => 'Khách đã có ngày sinh — muốn sửa thì nhờ chủ quán.'], 403);
  [$bd, $by] = mhParseBday(inp('day'), inp('month'), inp('year'));
  if ($bd === '' && !mhIsOwner($u)) out(['ok' => false, 'error' => 'Chọn ngày và tháng sinh.'], 400);
  db()->prepare('UPDATE customers SET birthday = ?, birth_year = ? WHERE id = ?')->execute([$bd, $by, $id]);
  mhAudit($u['id'], 'customer_birthday', "#$id " . $c['name'] . ' · ' . ($bd ?: 'xoá') . ($by ? "-$by" : ''));
  out(['ok' => true] + customerCard($id, $u));
}

case 'birthday_give': {
  $u = mhRequireUser();
  $cid = (int)inp('customer_id', 0);
  $c = mhCustomerRow($cid);
  if (!$c) out(['ok' => false, 'error' => 'Không tìm thấy khách.'], 404);
  $s = mhStats($cid)[$cid];
  $bd = mhBdayState($c, mhTierOf($s['cuts'], $s['spend'], mhTiers())['tier'], isset(mhBdayGivenThisYear()[$cid]));
  if (!$bd['pending']) out(['ok' => false, 'error' => 'Quà sinh nhật không còn chờ trao (đã trao năm nay, hoặc chưa tới tháng sinh nhật).'], 409);
  db()->prepare('INSERT OR IGNORE INTO birthday_given (customer_id, year, gift, given_at, given_by) VALUES (?,?,?,?,?)')
      ->execute([$cid, (int)date('Y'), $bd['gift'], time(), $u['id']]);
  mhAudit($u['id'], 'birthday_give', "khách #$cid · " . $bd['gift']);
  out(['ok' => true] + customerCard($cid, $u));
}

case 'birthday_ungive': {
  $u = mhRequireOwner();
  $cid = (int)inp('customer_id', 0);
  $nam = (int)inp('year', 0);
  db()->prepare('DELETE FROM birthday_given WHERE customer_id = ? AND year = ?')->execute([$cid, $nam]);
  mhAudit($u['id'], 'birthday_ungive', "khách #$cid · $nam");
  out(['ok' => true] + customerCard($cid, $u));
}

/* ===== trao quà ===== */

case 'reward_give': {
  $u = mhRequireUser();
  $cid = (int)inp('customer_id', 0);
  $pid = (int)inp('program_id', 0);
  $seq = (int)inp('seq', -1);
  $pending = pendingKeys($cid);
  $e = $pending["$pid|$seq"] ?? null;
  if (!$e) out(['ok' => false, 'error' => 'Phần quà này không còn chờ trao (có thể đã có người bấm rồi).'], 409);
  db()->prepare('INSERT OR IGNORE INTO rewards_given (customer_id, program_id, seq, gift, at_count, given_at, given_by)
                 VALUES (?,?,?,?,?,?,?)')
      ->execute([$cid, $pid, $seq, $e['gift'], $e['total'], time(), $u['id']]);
  mhAudit($u['id'], 'reward_give', "khách #$cid · " . $e['program'] . ' · ' . $e['gift']);
  out(['ok' => true] + customerCard($cid, $u));
}

case 'reward_ungive': {
  $u = mhRequireOwner();
  $id = (int)inp('id', 0);
  $st = db()->prepare('SELECT * FROM rewards_given WHERE id = ?');
  $st->execute([$id]);
  $g = $st->fetch();
  if (!$g) out(['ok' => false, 'error' => 'Không tìm thấy.'], 404);
  db()->prepare('DELETE FROM rewards_given WHERE id = ?')->execute([$id]);
  mhAudit($u['id'], 'reward_ungive', 'khách #' . $g['customer_id'] . ' · ' . $g['gift']);
  out(['ok' => true] + customerCard((int)$g['customer_id'], $u));
}

/* ===== trong ngày ===== */

case 'day': {
  $u = mhRequireUser();
  $owner = mhIsOwner($u);
  $date = ($owner && validDate(inp('date'))) ? inp('date') : mhToday();
  $visits = mhVisitList('v.visit_date = ?', [$date], 500);
  $han = time() - MH_UNDO_MINUTES * 60;
  foreach ($visits as &$v) {
    $v['can_void'] = $v['void_at'] === null && ($owner
      || ($v['source'] === 'counter' && $v['created_by'] === $u['id'] && $v['created_at'] >= $han));
    $v['customer_phone'] = $owner ? $v['customer_phone'] : mhMask($v['customer_phone']);
  }
  unset($v);
  $st = db()->prepare("SELECT g.gift, g.given_at, c.id AS cid, c.name, u.name AS by_name
                         FROM rewards_given g JOIN customers c ON c.id = g.customer_id
                    LEFT JOIN users u ON u.id = g.given_by
                        WHERE g.given_at BETWEEN ? AND ? ORDER BY g.given_at DESC");
  $st->execute([strtotime($date . ' 00:00:00'), strtotime($date . ' 23:59:59')]);
  $gifts = array_map(function ($g) {
    return ['gift' => $g['gift'], 'time' => date('H:i', (int)$g['given_at']),
            'customer_id' => (int)$g['cid'], 'name' => $g['name'], 'by' => $g['by_name']];
  }, $st->fetchAll());
  out(['ok' => true, 'date' => $date, 'visits' => $visits, 'gifts' => $gifts]);
}

/* ===== danh mục ===== */

case 'services': {
  $u = mhRequireUser();
  $rows = db()->query('SELECT * FROM services' . (mhIsOwner($u) ? '' : ' WHERE active = 1')
                    . ' ORDER BY sort, id')->fetchAll();
  foreach ($rows as &$s) { $s['id'] = (int)$s['id']; $s['price'] = (int)$s['price'];
                           $s['active'] = (int)$s['active']; $s['sort'] = (int)$s['sort']; }
  unset($s);
  out(['ok' => true, 'rows' => $rows, 'kinds' => MH_KINDS]);
}

/* Lưu cả bảng dịch vụ một lần. Dòng bị bỏ khỏi bảng thì TẮT chứ không
   xoá — lượt cũ vẫn trỏ vào nó.

   Đổi loại của dịch vụ hay đổi mã KiotViet thì toàn bộ lượt cũ được xếp
   loại lại theo — đánh dấu "Combo Chill" là cắt tóc là các hoá đơn combo
   năm ngoái cũng thành lượt cắt, hạng của khách đổi theo ngay. */
case 'services_save': {
  $u = mhRequireOwner();
  $rows = inp('rows', []);
  if (!is_array($rows)) out(['ok' => false, 'error' => 'Dữ liệu không đúng.'], 400);

  $seenCode = [];
  foreach ($rows as $i => $r) {
    if (trim((string)($r['name'] ?? '')) === '') out(['ok' => false, 'error' => 'Dòng ' . ($i + 1) . ' chưa có tên.'], 400);
    if (!isset(MH_KINDS[$r['kind'] ?? ''])) out(['ok' => false, 'error' => 'Dòng ' . ($i + 1) . ': loại không đúng.'], 400);
    foreach (explode(',', (string)($r['kv_codes'] ?? '')) as $code) {
      $code = mb_strtoupper(trim($code));
      if ($code === '') continue;
      if (isset($seenCode[$code]))
        out(['ok' => false, 'error' => "Mã KiotViet $code đang nằm ở hai dịch vụ: " . $seenCode[$code] . ' và ' . $r['name'] . '.'], 400);
      $seenCode[$code] = $r['name'];
    }
  }

  $pdo = db();
  $pdo->beginTransaction();
  $giu = [];
  $up  = $pdo->prepare('UPDATE services SET name=?, kind=?, price=?, kv_codes=?, active=?, sort=? WHERE id=?');
  $ins = $pdo->prepare('INSERT INTO services (name, kind, price, kv_codes, active, sort) VALUES (?,?,?,?,?,?)');
  foreach (array_values($rows) as $i => $r) {
    $codes = implode(',', array_filter(array_map(function ($c) { return trim($c); },
                                                 explode(',', (string)($r['kv_codes'] ?? '')))));
    $vals = [trim((string)$r['name']), $r['kind'], max(0, (int)($r['price'] ?? 0)), $codes,
             !empty($r['active']) ? 1 : 0, $i + 1];
    if (!empty($r['id'])) { $up->execute(array_merge($vals, [(int)$r['id']])); $giu[] = (int)$r['id']; }
    else { $ins->execute($vals); $giu[] = (int)$pdo->lastInsertId(); }
  }
  $pdo->exec('UPDATE services SET active = 0 WHERE id NOT IN (' . implode(',', $giu ?: [0]) . ')');

  /* Xếp loại lại mọi lượt cũ theo bảng mới. */
  $pdo->exec('UPDATE visit_items SET kind = COALESCE((SELECT kind FROM services s WHERE s.id = visit_items.service_id), kind)
               WHERE kv_code IS NULL AND service_id IS NOT NULL');
  $pdo->exec("UPDATE visit_items SET kind = 'other', service_id = NULL WHERE kv_code IS NOT NULL");
  $set = $pdo->prepare('UPDATE visit_items SET kind = ?, service_id = ? WHERE kv_code = ?');
  foreach (mhKvMap() as $code => $m) $set->execute([$m['kind'], $m['id'], $code]);
  $pdo->commit();

  mhAudit($u['id'], 'services_save', count($rows) . ' dịch vụ');
  out(['ok' => true]);
}

case 'tiers': {
  mhRequireUser();
  out(['ok' => true, 'rows' => mhTiers()]);
}

case 'tiers_save': {
  $u = mhRequireOwner();
  $rows = inp('rows', []);
  if (!is_array($rows) || !$rows) out(['ok' => false, 'error' => 'Phải có ít nhất một hạng.'], 400);
  foreach (array_values($rows) as $i => $r) {
    if (trim((string)($r['name'] ?? '')) === '') out(['ok' => false, 'error' => 'Hạng thứ ' . ($i + 1) . ' chưa có tên.'], 400);
    if ($i === 0 && ((int)($r['min_cuts'] ?? 0) > 0 || (int)($r['min_spend'] ?? 0) > 0))
      out(['ok' => false, 'error' => 'Hạng đầu tiên là hạng khởi điểm — để cả hai ngưỡng bằng 0.'], 400);
  }
  $pdo = db();
  $pdo->beginTransaction();
  $giu = [];
  $up  = $pdo->prepare('UPDATE tiers SET name=?, color=?, min_cuts=?, min_spend=?, perks=?, sort=?, bday_gift=? WHERE id=?');
  $ins = $pdo->prepare('INSERT INTO tiers (name, color, min_cuts, min_spend, perks, sort, bday_gift) VALUES (?,?,?,?,?,?,?)');
  foreach (array_values($rows) as $i => $r) {
    $color = preg_match('/^#[0-9a-fA-F]{6}$/', (string)($r['color'] ?? '')) ? $r['color'] : '#888888';
    $vals = [trim((string)$r['name']), $color, max(0, (int)($r['min_cuts'] ?? 0)),
             max(0, (int)($r['min_spend'] ?? 0)), trim((string)($r['perks'] ?? '')), $i + 1,
             trim((string)($r['bday_gift'] ?? ''))];
    if (!empty($r['id'])) { $up->execute(array_merge($vals, [(int)$r['id']])); $giu[] = (int)$r['id']; }
    else { $ins->execute($vals); $giu[] = (int)$pdo->lastInsertId(); }
  }
  $pdo->exec('DELETE FROM tiers WHERE id NOT IN (' . implode(',', $giu) . ')');
  $pdo->commit();
  mhAudit($u['id'], 'tiers_save', implode(' / ', array_map(function ($r) { return $r['name']; }, $rows)));
  out(['ok' => true, 'rows' => mhTiers()]);
}

case 'programs': {
  $u = mhRequireUser();
  out(['ok' => true, 'rows' => mhPrograms(!mhIsOwner($u)), 'kinds' => MH_KINDS]);
}

case 'program_save': {
  $u = mhRequireOwner();
  $id    = (int)inp('id', 0);
  $name  = trim((string)inp('name', ''));
  $kind  = (string)inp('kind', 'cut');
  $start = (string)inp('start_date', '');
  $end   = (string)inp('end_date', '');
  $steps = inp('steps', []);
  if ($name === '') out(['ok' => false, 'error' => 'Đặt tên cho chương trình.'], 400);
  if ($kind !== 'any' && !isset(MH_KINDS[$kind])) out(['ok' => false, 'error' => 'Loại dịch vụ không đúng.'], 400);
  if (!validDate($start)) out(['ok' => false, 'error' => 'Chọn ngày bắt đầu.'], 400);
  if ($end !== '' && (!validDate($end) || $end < $start)) out(['ok' => false, 'error' => 'Ngày kết thúc phải sau ngày bắt đầu.'], 400);
  if (!is_array($steps) || !$steps) out(['ok' => false, 'error' => 'Thêm ít nhất một mốc quà.'], 400);
  $sach = []; $daCo = [];
  foreach ($steps as $s) {
    $at = (int)($s['at'] ?? 0); $gift = trim((string)($s['gift'] ?? ''));
    if ($at < 1 || $at > 500) out(['ok' => false, 'error' => 'Mốc phải là số lần từ 1 đến 500.'], 400);
    if ($gift === '') out(['ok' => false, 'error' => "Mốc $at chưa ghi quà gì."], 400);
    if (isset($daCo[$at])) out(['ok' => false, 'error' => "Mốc $at bị lặp."], 400);
    $daCo[$at] = true;
    $sach[] = ['at' => $at, 'gift' => $gift];
  }
  usort($sach, function ($a, $b) { return $a['at'] <=> $b['at']; });
  $vals = [$name, $kind, json_encode($sach, JSON_UNESCAPED_UNICODE), inp('repeat') ? 1 : 0,
           $start, $end, inp('active', 1) ? 1 : 0];
  if ($id) {
    db()->prepare('UPDATE programs SET name=?, kind=?, steps=?, repeat=?, start_date=?, end_date=?, active=? WHERE id=?')
        ->execute(array_merge($vals, [$id]));
  } else {
    $sort = (int)db()->query('SELECT COALESCE(MAX(sort),0)+1 FROM programs')->fetchColumn();
    db()->prepare('INSERT INTO programs (name, kind, steps, repeat, start_date, end_date, active, sort, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?)')->execute(array_merge($vals, [$sort, time()]));
    $id = (int)db()->lastInsertId();
  }
  mhAudit($u['id'], 'program_save', "#$id $name");
  out(['ok' => true, 'id' => $id]);
}

/* Chương trình đã trao quà thì chỉ tắt, không xoá — xoá là mất luôn lịch
   sử ai đã nhận gì. */
case 'program_del': {
  $u = mhRequireOwner();
  $id = (int)inp('id', 0);
  $st = db()->prepare('SELECT COUNT(*) FROM rewards_given WHERE program_id = ?');
  $st->execute([$id]);
  if ((int)$st->fetchColumn() > 0) {
    db()->prepare('UPDATE programs SET active = 0 WHERE id = ?')->execute([$id]);
    mhAudit($u['id'], 'program_off', "#$id");
    out(['ok' => true, 'kept' => true]);
  }
  db()->prepare('DELETE FROM programs WHERE id = ?')->execute([$id]);
  mhAudit($u['id'], 'program_del', "#$id");
  out(['ok' => true, 'kept' => false]);
}

/* ===== chủ quán: tổng quan & danh sách khách ===== */

case 'customers_all': {
  mhRequireOwner();
  out(['ok' => true, 'rows' => allCustomers(), 'tiers' => mhTiers(), 'barbers' => mhBarbers()]);
}

case 'dashboard': {
  mhRequireOwner();
  $today = mhToday();
  $month = date('Y-m');
  $all = allCustomers();

  $q = function (string $sql, array $a = []) { $st = db()->prepare($sql); $st->execute($a); return $st->fetch(); };
  $hom = $q('SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM visits WHERE void_at IS NULL AND visit_date = ?', [$today]);
  $thg = $q('SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM visits WHERE void_at IS NULL AND visit_date LIKE ?', [$month . '-%']);
  $huy = $q('SELECT COUNT(*) n FROM visits WHERE void_at >= ?', [strtotime($month . '-01')]);
  $moi = $q('SELECT COUNT(*) n FROM customers WHERE created_at >= ?', [strtotime($month . '-01')]);
  $qua = $q('SELECT COUNT(*) n FROM rewards_given WHERE given_at >= ?', [strtotime($month . '-01')]);

  $tierCount = [];
  foreach ($all as $c) if ($c['visits'] > 0) $tierCount[$c['tier_id']] = ($tierCount[$c['tier_id']] ?? 0) + 1;

  $pending = [];
  foreach ($all as $c) if ($c['pending'])
    $pending[] = ['id' => $c['id'], 'name' => $c['name'], 'phone' => $c['phone'], 'gifts' => $c['pending'], 'last' => $c['last']];
  usort($pending, function ($a, $b) { return strcmp((string)$b['last'], (string)$a['last']); });

  /* Lượt quầy ghi mà đối soát không thấy hoá đơn KiotViet nào khớp. */
  $flagged = mhVisitList("v.void_at IS NULL AND v.flags LIKE '%NO_INVOICE%'", [], 50);

  /* Quầy ghi theo từng tài khoản trong tháng — thấy ngay nếu một tài
     khoản ghi nhiều bất thường. */
  $st = db()->prepare("SELECT u.name, COUNT(*) n FROM visits v JOIN users u ON u.id = v.created_by
                        WHERE v.void_at IS NULL AND v.visit_date LIKE ? AND v.source = 'counter'
                        GROUP BY u.id ORDER BY n DESC");
  $st->execute([$month . '-%']);

  /* Theo thợ, tháng này: lượt, khách, tiền dịch vụ, và bao nhiêu khách
     quay lại (đã từng cắt với chính thợ đó trước tháng này). */
  $st2 = db()->prepare("SELECT b.id, b.name, COUNT(v.id) n, COUNT(DISTINCT v.customer_id) k,
                               COALESCE(SUM(v.amount),0) s,
                               COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM visits o
                                   WHERE o.customer_id = v.customer_id AND o.barber_id = v.barber_id
                                     AND o.void_at IS NULL AND o.visit_date < ?) THEN v.customer_id END) cu
                          FROM barbers b JOIN visits v ON v.barber_id = b.id
                         WHERE v.void_at IS NULL AND v.visit_date LIKE ?
                         GROUP BY b.id ORDER BY n DESC");
  $st2->execute([$month . '-01', $month . '-%']);
  $khongTho = $q("SELECT COUNT(*) n FROM visits WHERE void_at IS NULL AND barber_id IS NULL AND visit_date LIKE ?", [$month . '-%']);

  /* Sinh nhật tháng này của khách được quà, và khách được quà mà chưa
     có ngày sinh — để quầy nhớ hỏi. */
  $sinhNhat = []; $thieuNgay = 0;
  $hangById = [];
  foreach (mhTiers() as $t) $hangById[$t['id']] = $t;
  foreach ($all as $c) {
    if (!$c['bday_eligible']) continue;
    if ($c['birthday'] === '') { if ($c['visits']) $thieuNgay++; continue; }
    if (substr($c['birthday'], 0, 2) !== date('m')) continue;
    $sinhNhat[] = ['id' => $c['id'], 'name' => $c['name'], 'phone' => $c['phone'], 'birthday' => $c['birthday'],
                   'given' => $c['bday_given'], 'tier' => isset($hangById[$c['tier_id']]) ? mhTierPublic($hangById[$c['tier_id']]) : null];
  }
  usort($sinhNhat, function ($a, $b) { return strcmp($a['birthday'], $b['birthday']); });

  out(['ok' => true,
       'birthdays' => $sinhNhat, 'bday_missing' => $thieuNgay,
       'barbers' => array_map(function ($r) {
         return ['id' => (int)$r['id'], 'name' => $r['name'], 'visits' => (int)$r['n'], 'customers' => (int)$r['k'],
                 'amount' => (int)$r['s'], 'returning' => (int)$r['cu']]; }, $st2->fetchAll()),
       'no_barber' => (int)$khongTho['n'],
       'today' => ['visits' => (int)$hom['n'], 'amount' => (int)$hom['s']],
       'month' => ['visits' => (int)$thg['n'], 'amount' => (int)$thg['s'], 'voided' => (int)$huy['n'],
                   'new_customers' => (int)$moi['n'], 'gifts_given' => (int)$qua['n']],
       'customers' => count($all),
       'tiers' => array_map(function ($t) use ($tierCount) {
         return mhTierPublic($t) + ['count' => $tierCount[$t['id']] ?? 0]; }, mhTiers()),
       'pending' => array_slice($pending, 0, 60), 'pending_total' => array_sum(array_map(function ($p) { return count($p['gifts']); }, $pending)),
       'flagged' => $flagged, 'by_user' => $st->fetchAll(),
       'last_import' => mhSetting('last_import', '')]);
}

/* ===== nhập file KiotViet =====

   Trình duyệt đã đọc file Excel và gom thành từng hoá đơn:
     {c: mã HĐ, t: 'YYYY-MM-DD HH:MM', p: SĐT, n: tên, k: mã KH, a: tiền, i: [[mã hàng, tên, SL, thành tiền]]}

   Với mỗi hoá đơn có số điện thoại:
     – đã nhập hoá đơn này rồi              → bỏ qua (nhập lại file không đếm đôi)
     – khách có lượt quầy ghi CÙNG NGÀY     → khớp: gắn mã HĐ, lấy số tiền thật của KiotViet
     – không có                              → tạo lượt mới (quầy quên ghi, hoặc là lịch sử cũ)
   Sau đó, những lượt quầy ghi trong khoảng ngày của file mà không khớp
   hoá đơn nào → gắn cờ NO_INVOICE cho chủ xem.

   commit = false thì chạy y hệt rồi ROLLBACK — con số xem trước chính là
   con số sẽ ghi, không phải một phép tính riêng dễ lệch. */
case 'import': {
  $u = mhRequireOwner();
  $inv = inp('invoices', []);
  $commit = (bool)inp('commit', false);
  if (!is_array($inv) || !$inv) out(['ok' => false, 'error' => 'File không có hoá đơn nào.'], 400);

  $map = mhKvMap();
  $pdo = db();
  $pdo->beginTransaction();

  $n = ['invoices' => count($inv), 'walkin' => 0, 'dup' => 0, 'linked' => 0, 'created' => 0,
        'new_customers' => 0, 'amount_created' => 0];
  $unmapped = []; $dung = []; $min = null; $max = null;
  $thoCache = []; $thoMoi = []; $n['barber_filled'] = 0;
  $fillTho  = $pdo->prepare('UPDATE visits SET barber_id = ? WHERE kv_invoice = ? AND barber_id IS NULL');

  $findDup  = $pdo->prepare('SELECT 1 FROM visits WHERE kv_invoice = ?');
  $findSame = $pdo->prepare("SELECT id FROM visits WHERE customer_id = ? AND visit_date = ? AND kv_invoice IS NULL
                               AND void_at IS NULL AND source IN ('counter','owner') ORDER BY id");
  $link     = $pdo->prepare('UPDATE visits SET kv_invoice = ?, amount = ? WHERE id = ?');
  $insV     = $pdo->prepare("INSERT INTO visits (customer_id, visit_date, visit_time, amount, source, kv_invoice, barber_id, created_at, created_by)
                             VALUES (?,?,?,?,'import',?,?,?,?)");
  $insI     = $pdo->prepare('INSERT INTO visit_items (visit_id, service_id, kv_code, name, kind, qty, price) VALUES (?,?,?,?,?,?,?)');

  foreach ($inv as $h) {
    $code  = trim((string)($h['c'] ?? ''));
    $phone = mhPhone((string)($h['p'] ?? ''));
    $t     = (string)($h['t'] ?? '');
    if ($code === '' || !preg_match('/^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?/', $t, $m)) continue;
    if (strlen($phone) < 9) { $n['walkin']++; continue; }
    $date = $m[1]; $time = $m[2] ?? '';
    if ($min === null || $date < $min) $min = $date;
    if ($max === null || $date > $max) $max = $date;

    $bid = mhBarberFromKv((string)($h['b'] ?? ''), $thoCache, $thoMoi);

    $findDup->execute([$code]);
    if ($findDup->fetchColumn()) {
      $n['dup']++;
      /* Hoá đơn đã nhập từ trước khi app biết đọc cột thợ: nhập lại cùng
         file là điền bù thợ cho các lượt cũ. */
      if ($bid) { $fillTho->execute([$bid, $code]); $n['barber_filled'] += $fillTho->rowCount(); }
      continue;
    }

    $c = mhEnsureCustomer($phone, trim((string)($h['n'] ?? '')), $u['id'], trim((string)($h['k'] ?? '')));
    if ($c['_new']) $n['new_customers']++;
    $amount = (int)round((float)($h['a'] ?? 0));

    $findSame->execute([$c['id'], $date]);
    $vid = null;
    foreach ($findSame->fetchAll(PDO::FETCH_COLUMN) as $cand)
      if (!isset($dung[(int)$cand])) { $vid = (int)$cand; break; }

    if ($vid) {
      $dung[$vid] = true;
      $link->execute([$code, $amount, $vid]);
      if ($bid) $pdo->prepare('UPDATE visits SET barber_id = ? WHERE id = ? AND barber_id IS NULL')->execute([$bid, $vid]);
      mhDelFlag($vid, 'NO_INVOICE');
      $n['linked']++;
      continue;
    }

    $insV->execute([$c['id'], $date, $time, $amount, $code, $bid, time(), $u['id']]);
    $vid = (int)$pdo->lastInsertId();
    foreach ((array)($h['i'] ?? []) as $it) {
      $kv = mb_strtoupper(trim((string)($it[0] ?? '')));
      $mm = $map[$kv] ?? null;
      if (!$mm && $kv !== '') {
        $unmapped[$kv] = $unmapped[$kv] ?? ['code' => $kv, 'name' => (string)($it[1] ?? ''), 'count' => 0];
        $unmapped[$kv]['count']++;
      }
      $insI->execute([$vid, $mm ? $mm['id'] : null, $kv ?: null, (string)($it[1] ?? ''),
                      $mm ? $mm['kind'] : 'other', max(1, (int)($it[2] ?? 1)), (int)round((float)($it[3] ?? 0))]);
    }
    $n['created']++;
    $n['amount_created'] += $amount;
  }

  /* Lượt quầy ghi trong khoảng ngày của file mà không khớp hoá đơn nào. */
  $orphans = [];
  if ($min !== null) {
    $orphans = mhVisitList("v.void_at IS NULL AND v.kv_invoice IS NULL AND v.source IN ('counter','owner')
                            AND v.visit_date BETWEEN ? AND ?", [$min, $max], 500);
    foreach ($orphans as $o) mhAddFlag($o['id'], 'NO_INVOICE');
  }

  /* Khách tạo từ file thì "ngày tham gia" là lần đầu ghé trong KiotViet,
     không phải hôm nay — không thì tổng quan báo 500 khách mới tháng này. */
  $pdo->exec("UPDATE customers SET created_at = MIN(created_at,
                COALESCE((SELECT CAST(strftime('%s', MIN(visit_date)) AS INTEGER) - 25200
                            FROM visits WHERE customer_id = customers.id), created_at))");

  $n['range'] = [$min, $max];
  if ($commit) {
    $pdo->commit();
    $pdo->prepare("INSERT INTO settings (key, value) VALUES ('last_import', ?)
                   ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        ->execute([date('d/m/Y H:i') . " · $min → $max"]);
    mhAudit($u['id'], 'import', json_encode($n, JSON_UNESCAPED_UNICODE));
  } else {
    $pdo->rollBack();
  }
  out(['ok' => true, 'committed' => $commit, 'stats' => $n, 'barbers_new' => $thoMoi,
       'unmapped' => array_values($unmapped), 'orphans' => $orphans]);
}

/* ===== tài khoản ===== */

case 'users': {
  mhRequireOwner();
  $rows = db()->query("SELECT u.id, u.name, u.username, u.role, u.active, u.created_at,
                              (SELECT MAX(last_seen) FROM sessions s WHERE s.user_id = u.id) AS last_seen
                         FROM users u ORDER BY u.role DESC, u.name")->fetchAll();
  foreach ($rows as &$r) { $r['id'] = (int)$r['id']; $r['active'] = (int)$r['active'];
                           $r['last_seen'] = $r['last_seen'] ? (int)$r['last_seen'] : null; }
  unset($r);
  out(['ok' => true, 'rows' => $rows]);
}

case 'user_save': {
  $u = mhRequireOwner();
  $id   = (int)inp('id', 0);
  $name = trim((string)inp('name', ''));
  $user = mb_strtolower(trim((string)inp('username', '')));
  $pass = mhPass((string)inp('password', ''));
  $active = inp('active', 1) ? 1 : 0;
  if ($name === '') out(['ok' => false, 'error' => 'Đặt tên cho tài khoản.'], 400);
  if (!preg_match('/^[a-z0-9._-]{3,30}$/', $user))
    out(['ok' => false, 'error' => 'Tên đăng nhập 3–30 ký tự, chỉ chữ thường không dấu, số và . _ -'], 400);
  if ($pass !== '' && mb_strlen($pass) < MH_MIN_PASSWORD)
    out(['ok' => false, 'error' => 'Mật khẩu phải từ ' . MH_MIN_PASSWORD . ' ký tự.'], 400);
  $st = db()->prepare('SELECT id FROM users WHERE username = ? AND id <> ?');
  $st->execute([$user, $id]);
  if ($st->fetch()) out(['ok' => false, 'error' => 'Tên đăng nhập này đã có người dùng.'], 409);

  if ($id) {
    if ($id === $u['id'] && !$active) out(['ok' => false, 'error' => 'Không tự tắt tài khoản chủ được.'], 400);
    db()->prepare('UPDATE users SET name = ?, username = ?, active = ? WHERE id = ?')->execute([$name, $user, $active, $id]);
    if ($pass !== '') {
      db()->prepare('UPDATE users SET pass_hash = ? WHERE id = ?')->execute([mhMakePass($pass), $id]);
      /* Đổi mật khẩu quầy thường là vì người cũ nghỉ — đá mọi máy đang
         đăng nhập ra luôn. */
      db()->prepare('DELETE FROM sessions WHERE user_id = ?' . ($id === $u['id'] ? ' AND token_hash <> ?' : ''))
          ->execute($id === $u['id'] ? [$id, $u['token_hash']] : [$id]);
    }
    if (!$active) db()->prepare('DELETE FROM sessions WHERE user_id = ?')->execute([$id]);
  } else {
    if ($pass === '') out(['ok' => false, 'error' => 'Đặt mật khẩu cho tài khoản mới.'], 400);
    db()->prepare("INSERT INTO users (name, username, pass_hash, role, active, created_at) VALUES (?,?,?,'counter',?,?)")
        ->execute([$name, $user, mhMakePass($pass), $active, time()]);
    $id = (int)db()->lastInsertId();
  }
  mhAudit($u['id'], 'user_save', "#$id $user" . ($pass !== '' ? ' · đặt mật khẩu' : ''));
  out(['ok' => true, 'id' => $id]);
}

case 'audit': {
  mhRequireOwner();
  $rows = db()->query('SELECT a.*, u.name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
                        ORDER BY a.id DESC LIMIT 400')->fetchAll();
  out(['ok' => true, 'rows' => array_map(function ($r) {
    return ['time' => date('d/m H:i', (int)$r['created_at']), 'name' => $r['name'],
            'action' => $r['action'], 'detail' => $r['detail']];
  }, $rows)]);
}

default:
  out(['ok' => false, 'error' => 'Lệnh không hợp lệ: ' . $action], 400);
}
