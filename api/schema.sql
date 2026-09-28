-- ============================================================
--  member-hub — hạng thành viên & quà tặng cho khách barber
--
--  Chỉ lưu SỐ GỐC: khách ghé ngày nào, làm dịch vụ gì, trả bao nhiêu,
--  quà nào đã trao. Hạng và quà còn nợ luôn TÍNH LẠI từ đó mỗi lần xem,
--  không lưu sẵn — sửa mốc chương trình, đổi ngưỡng hạng hay huỷ một
--  lượt ghi nhầm thì mọi con số tự đúng theo, không có gì phải "chạy lại".
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

/* ---------------- người dùng app ---------------- */

/* role: 'owner' = chủ quán, thiết lập mọi thứ.
         'counter' = tài khoản quầy, dùng chung: tra khách, ghi lượt, trao quà. */
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  username    TEXT    NOT NULL UNIQUE,
  pass_hash   TEXT    NOT NULL,
  role        TEXT    NOT NULL DEFAULT 'counter',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

/* Token băm trước khi lưu — lộ file CSDL cũng không đăng nhập hộ được. */
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT    PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL,
  user_agent  TEXT
);

CREATE TABLE IF NOT EXISTS login_attempts (
  username     TEXT    NOT NULL,
  ip           TEXT    NOT NULL,
  failed       INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  last_try     INTEGER NOT NULL,
  PRIMARY KEY (username, ip)
);

/* ---------------- khách ---------------- */

/* Số điện thoại là khoá nhận diện khách — giống KiotViet. last4 tách riêng
   để tra ở quầy nhanh, và để có chỉ mục mà tra. */
CREATE TABLE IF NOT EXISTS customers (
  id          INTEGER PRIMARY KEY,
  phone       TEXT    NOT NULL UNIQUE,
  last4       TEXT    NOT NULL,
  name        TEXT    NOT NULL DEFAULT '',
  kv_code     TEXT,                          -- mã khách bên KiotViet (KH001262)
  note        TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  created_by  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cus_last4 ON customers(last4);

/* ---------------- dịch vụ ---------------- */

/* kind quyết định dịch vụ này được tính vào đâu:
     cut     — cắt tóc: đếm vào mốc 3-7-10 và vào hạng
     perm    — uốn / ép
     color   — nhuộm / tẩy
     care    — cạo, ráy tai, phục hồi…
     product — sản phẩm bán kèm
     other   — không tính gì, chỉ cộng tiền
   kv_codes: các mã hàng bên KiotViet ứng với dịch vụ này, cách nhau dấu phẩy
   — để nhập file Excel thì tự biết dòng nào là cắt, dòng nào là uốn. */
CREATE TABLE IF NOT EXISTS services (
  id        INTEGER PRIMARY KEY,
  name      TEXT    NOT NULL,
  kind      TEXT    NOT NULL DEFAULT 'other',
  price     INTEGER NOT NULL DEFAULT 0,      -- 0 = quầy tự nhập giá (sản phẩm)
  kv_codes  TEXT    NOT NULL DEFAULT '',
  active    INTEGER NOT NULL DEFAULT 1,
  sort      INTEGER NOT NULL DEFAULT 0
);

/* ---------------- lượt ghé ---------------- */

/* Một dòng = một lần khách ghé (một hoá đơn). Huỷ thì KHÔNG xoá, chỉ đánh
   dấu void_* — để còn biết ai huỷ, lúc nào, vì sao.

   source: 'counter' quầy ghi · 'owner' chủ ghi tay · 'import' nạp từ
   file KiotViet. created_at luôn là giờ máy chủ, không nhận giờ từ máy
   người dùng. */
CREATE TABLE IF NOT EXISTS visits (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  visit_date  TEXT    NOT NULL,              -- 'YYYY-MM-DD' giờ VN
  visit_time  TEXT    NOT NULL DEFAULT '',   -- 'HH:MM', chỉ để hiện
  amount      INTEGER NOT NULL DEFAULT 0,
  source      TEXT    NOT NULL DEFAULT 'counter',
  kv_invoice  TEXT,                          -- mã hoá đơn KiotViet đã khớp
  flags       TEXT    NOT NULL DEFAULT '',   -- NO_INVOICE: đối soát không thấy hoá đơn
  note        TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  created_by  INTEGER,
  void_at     INTEGER,
  void_by     INTEGER,
  void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_visit_cus  ON visits(customer_id, visit_date);
CREATE INDEX IF NOT EXISTS idx_visit_date ON visits(visit_date);
/* Một hoá đơn KiotViet chỉ khớp được với một lượt — nhập lại cùng một
   file hai lần không bị đếm đôi. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_visit_kv ON visits(kv_invoice) WHERE kv_invoice IS NOT NULL;

/* kind chép từ dịch vụ, và được cập nhật lại khi chủ đổi loại của dịch vụ
   (xem services_save) — nên luôn khớp với cách phân loại hiện tại. */
CREATE TABLE IF NOT EXISTS visit_items (
  id          INTEGER PRIMARY KEY,
  visit_id    INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  service_id  INTEGER,
  kv_code     TEXT,
  name        TEXT    NOT NULL,
  kind        TEXT    NOT NULL DEFAULT 'other',
  qty         INTEGER NOT NULL DEFAULT 1,
  price       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_item_visit ON visit_items(visit_id);
CREATE INDEX IF NOT EXISTS idx_item_kind  ON visit_items(kind, visit_id);

/* ---------------- hạng & chương trình ---------------- */

/* Đạt MỘT trong hai điều kiện là lên hạng. Ngưỡng = 0 nghĩa là không xét
   điều kiện đó; cả hai bằng 0 là hạng khởi điểm, ai cũng có. */
CREATE TABLE IF NOT EXISTS tiers (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  color      TEXT    NOT NULL DEFAULT '#888888',
  min_cuts   INTEGER NOT NULL DEFAULT 0,
  min_spend  INTEGER NOT NULL DEFAULT 0,
  perks      TEXT    NOT NULL DEFAULT '',
  sort       INTEGER NOT NULL DEFAULT 0
);

/* Chương trình quà theo mốc.
     kind   — loại dịch vụ được đếm ('cut', 'perm'…, hoặc 'any' = mọi lượt)
     steps  — JSON [{"at":3,"gift":"..."}, {"at":7,...}, {"at":10,...}]
     repeat — 1 = đạt mốc cuối xong thì quay lại vòng mới
   Chỉ đếm những lượt từ start_date trở đi — lịch sử nhập từ KiotViet
   trước ngày đó tính vào hạng nhưng không đẻ ra quà. */
CREATE TABLE IF NOT EXISTS programs (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  kind        TEXT    NOT NULL DEFAULT 'cut',
  steps       TEXT    NOT NULL DEFAULT '[]',
  repeat      INTEGER NOT NULL DEFAULT 1,
  start_date  TEXT    NOT NULL,
  end_date    TEXT    NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

/* Quà ĐÃ TRAO. Quà được nhận thì không lưu — nó tính ra từ số lượt.
   seq là số thứ tự phần quà trong chương trình đó (vòng 1 mốc 3 = 0,
   vòng 1 mốc 7 = 1, …), nên một phần quà không trao được hai lần. */
CREATE TABLE IF NOT EXISTS rewards_given (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  program_id  INTEGER NOT NULL REFERENCES programs(id)  ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  gift        TEXT    NOT NULL,
  at_count    INTEGER NOT NULL DEFAULT 0,    -- đạt ở lượt thứ mấy, để hiện
  given_at    INTEGER NOT NULL,
  given_by    INTEGER,
  UNIQUE (customer_id, program_id, seq)
);

/* ---------------- hệ thống ---------------- */

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER,
  action      TEXT    NOT NULL,
  detail      TEXT,
  ip          TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
