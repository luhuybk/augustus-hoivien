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
  role        TEXT    NOT NULL DEFAULT 'counter', -- owner | counter | barber
  barber_id   INTEGER,                              -- tài khoản thợ: thợ nào
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
  birthday    TEXT    NOT NULL DEFAULT '',   -- 'MM-DD'; năm để riêng vì khách hay không nói
  birth_year  INTEGER,
  created_at  INTEGER NOT NULL,
  created_by  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cus_last4 ON customers(last4);

/* Số điện thoại cũ của khách — khi đổi số hoặc gộp hai khách trùng.
   Hoá đơn KiotViet vẫn mang số cũ thì vẫn về đúng người, và quầy gõ 4 số
   cuối của số cũ vẫn ra. */
CREATE TABLE IF NOT EXISTS customer_aliases (
  phone       TEXT    PRIMARY KEY,
  last4       TEXT    NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alias_last4 ON customer_aliases(last4);
CREATE INDEX IF NOT EXISTS idx_alias_cus   ON customer_aliases(customer_id);

/* ---------------- thợ cắt ---------------- */

/* kv_name: tên của thợ ở cột "Người bán" bên KiotViet — để nhập file thì
   biết hoá đơn nào của ai. Tách khỏi name để chủ đổi tên hiển thị (vd.
   "Lạc") mà vẫn khớp được với "Lâm Gia Lạc" trong file.
   Thợ nghỉ thì tắt, KHÔNG xoá — lượt cũ vẫn trỏ vào. Sau này đặt lịch
   cũng dựa trên bảng này. */
CREATE TABLE IF NOT EXISTS barbers (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  kv_name     TEXT    NOT NULL DEFAULT '',
  base_salary INTEGER NOT NULL DEFAULT 0,    -- lương cứng mỗi tháng
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

/* ---------------- dịch vụ ---------------- */

/* kind quyết định dịch vụ này được tính vào đâu:
     cut     — cắt tóc: đếm vào mốc 3-7-10 và vào hạng
     perm    — uốn / ép
     color   — nhuộm / tẩy
     care    — cạo, ráy tai, phục hồi…
     product — sản phẩm bán kèm
     other   — không tính gì, chỉ cộng tiền
   kv_codes: các mã hàng bên KiotViet ứng với dịch vụ này, cách nhau dấu phẩy
   — để nhập file Excel thì tự biết dòng nào là cắt, dòng nào là uốn.
   wage / comm_pct: phần của thợ — tiền cố định mỗi lượt, và % hoa hồng
   trên tiền thực thu (sản phẩm). Lương tháng tính theo mức ĐANG đặt; chốt
   lương thì con số được chụp lại, đổi mức sau đó không làm lệch tháng cũ.
   discountable: dòng này có được giảm theo hạng / khuyến mãi không. */
CREATE TABLE IF NOT EXISTS services (
  id        INTEGER PRIMARY KEY,
  name      TEXT    NOT NULL,
  kind      TEXT    NOT NULL DEFAULT 'other',
  price     INTEGER NOT NULL DEFAULT 0,      -- 0 = quầy tự nhập giá (sản phẩm)
  kv_codes  TEXT    NOT NULL DEFAULT '',
  wage      INTEGER NOT NULL DEFAULT 0,
  comm_pct  REAL    NOT NULL DEFAULT 0,
  discountable INTEGER NOT NULL DEFAULT 1,
  grp       TEXT    NOT NULL DEFAULT 'A',    -- nhóm: A lẻ · B combo · C hoá chất · D sản phẩm (settings.svc_groups)
  note      TEXT    NOT NULL DEFAULT '',     -- chú thích cho nhân viên, hiện khi rê chuột
  active    INTEGER NOT NULL DEFAULT 1,
  sort      INTEGER NOT NULL DEFAULT 0
);

/* ---------------- lượt ghé ---------------- */

/* Một dòng = một hoá đơn (một lần khách ghé). Huỷ thì KHÔNG xoá, chỉ
   đánh dấu void_* — để còn biết ai huỷ, lúc nào, vì sao.

   customer_id NULL = khách lẻ không để số — vẫn là doanh thu, vẫn tính
   lương thợ, chỉ không vào hạng.
   amount = tiền hàng khách trả sau giảm giá, KHÔNG gồm tip; subtotal là
   theo giá niêm yết. pay_cash + pay_transfer = amount + tip.
   source: 'counter' quầy ghi · 'owner' chủ ghi tay · 'import' nạp từ
   file KiotViet. created_at luôn là giờ máy chủ, không nhận giờ từ máy
   người dùng. */
CREATE TABLE IF NOT EXISTS visits (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  visit_date  TEXT    NOT NULL,              -- 'YYYY-MM-DD' giờ VN
  visit_time  TEXT    NOT NULL DEFAULT '',   -- 'HH:MM', chỉ để hiện
  amount      INTEGER NOT NULL DEFAULT 0,
  subtotal    INTEGER NOT NULL DEFAULT 0,
  discount    INTEGER NOT NULL DEFAULT 0,
  disc_note   TEXT    NOT NULL DEFAULT '',   -- "Hạng Vàng −15%", tên khuyến mãi…
  tip         INTEGER NOT NULL DEFAULT 0,
  pay_cash    INTEGER NOT NULL DEFAULT 0,
  pay_transfer INTEGER NOT NULL DEFAULT 0,
  mdisc       INTEGER NOT NULL DEFAULT 0,    -- giảm thêm bằng tay (đ) — có ⚠ khi chốt ca
  mdisc_note  TEXT    NOT NULL DEFAULT '',   -- lý do giảm thêm, bắt buộc khi mdisc > 0
  client_ref  TEXT,                          -- mã máy quầy sinh cho mỗi hoá đơn: gửi lại không tạo hai lần
  source      TEXT    NOT NULL DEFAULT 'counter',
  kv_invoice  TEXT,                          -- mã hoá đơn KiotViet đã khớp
  flags       TEXT    NOT NULL DEFAULT '',   -- NO_INVOICE: đối soát không thấy hoá đơn
  barber_id   INTEGER,                       -- thợ cắt lượt này (NULL = chưa ghi)
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
  price       INTEGER NOT NULL DEFAULT 0,    -- thành tiền của dòng, đã trừ giảm giá
  list_price  INTEGER NOT NULL DEFAULT 0,    -- đơn giá niêm yết lúc bán
  disc        INTEGER NOT NULL DEFAULT 0,    -- giảm giá của dòng (gồm cả giảm tay)
  mdisc       INTEGER NOT NULL DEFAULT 0,    -- phần giảm thêm bằng tay của dòng
  detail      TEXT    NOT NULL DEFAULT '',   -- tên sản phẩm cụ thể (Wax Reuzel…)
  guest       INTEGER NOT NULL DEFAULT 0,    -- 0 = khách chính; 1, 2… = bạn đi cùng, tính chung hoá đơn
  barber_id   INTEGER                        -- thợ làm món này nếu khác thợ của hoá đơn (bạn đi cùng)
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
  bday_gift  TEXT    NOT NULL DEFAULT '',     -- quà sinh nhật của hạng này; trống = không có
  disc_pct   INTEGER NOT NULL DEFAULT 0,      -- % giảm mỗi bill, trên các dòng được giảm
  sort       INTEGER NOT NULL DEFAULT 0
);

/* Quà sinh nhật đã trao — mỗi khách mỗi năm một lần. */
CREATE TABLE IF NOT EXISTS birthday_given (
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  year        INTEGER NOT NULL,
  gift        TEXT    NOT NULL,
  given_at    INTEGER NOT NULL,
  given_by    INTEGER,
  PRIMARY KEY (customer_id, year)
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

/* Khuyến mãi quầy chọn được khi tính tiền (HSSV, khai trương…). Chỉ chủ
   tạo; quầy không gõ tay được số tiền giảm. Không cộng dồn với giảm theo
   hạng — app lấy mức nào có lợi hơn cho khách.
   kind: 'pct' (giảm %) hoặc 'amt' (giảm số tiền). */
CREATE TABLE IF NOT EXISTS promos (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  kind        TEXT    NOT NULL DEFAULT 'pct',
  value       INTEGER NOT NULL DEFAULT 0,
  start_date  TEXT    NOT NULL DEFAULT '',
  end_date    TEXT    NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

/* ---------------- lương ---------------- */

/* Thưởng / phụ cấp / nợ / ứng lương trong tháng — số âm là trừ.
   amount = qty × rate (có dấu). recurring = khoản tháng nào cũng có (tiền
   xăng, bảo hiểm…) — tháng sau bấm một nút là chép sang. */
CREATE TABLE IF NOT EXISTS payroll_adjust (
  id          INTEGER PRIMARY KEY,
  month       TEXT    NOT NULL,              -- 'YYYY-MM'
  barber_id   INTEGER NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  label       TEXT    NOT NULL,
  amount      INTEGER NOT NULL,
  qty         INTEGER NOT NULL DEFAULT 1,
  rate        INTEGER NOT NULL DEFAULT 0,
  recurring   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  created_by  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_padj_month ON payroll_adjust(month);

/* KPI tháng của từng thợ. Tháng chưa đặt thì dùng KPI tháng gần nhất. */
CREATE TABLE IF NOT EXISTS payroll_kpi (
  month       TEXT    NOT NULL,
  barber_id   INTEGER NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  cuts        INTEGER NOT NULL DEFAULT 0,    -- số đầu cắt
  combo       INTEGER NOT NULL DEFAULT 0,    -- số combo
  chem        INTEGER NOT NULL DEFAULT 0,    -- doanh thu hoá chất
  prod        INTEGER NOT NULL DEFAULT 0,    -- doanh thu sản phẩm
  PRIMARY KEY (month, barber_id)
);

/* Tháng đã chốt lương: chụp lại nguyên bảng lương lúc chốt (JSON). */
CREATE TABLE IF NOT EXISTS payroll_closed (
  month       TEXT    PRIMARY KEY,
  data        TEXT    NOT NULL,
  closed_at   INTEGER NOT NULL,
  closed_by   INTEGER
);

/* ---------------- chốt ca ---------------- */

/* Tiền "ngoài luồng" trong két: mua đá −8.000, thu hộ +…  */
CREATE TABLE IF NOT EXISTS cash_moves (
  id          INTEGER PRIMARY KEY,
  move_date   TEXT    NOT NULL,
  amount      INTEGER NOT NULL,              -- + thu vào, − chi ra
  note        TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  created_by  INTEGER,
  void_at     INTEGER,
  void_by     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cash_date ON cash_moves(move_date);

/* Mỗi ngày một lần chốt (chốt lại thì ghi đè). Các con số tính từ hoá đơn
   do máy chủ tính lúc chốt và chụp lại — huỷ hoá đơn sau đó không làm
   đổi biên bản; quầy chỉ nhập tiền đầu ca, tiền đếm được, tiền để lại. */
CREATE TABLE IF NOT EXISTS shift_close (
  close_date  TEXT    PRIMARY KEY,
  opening     INTEGER NOT NULL DEFAULT 0,    -- tiền trong tủ đầu ca
  cash_sales  INTEGER NOT NULL DEFAULT 0,    -- tiền mặt thu từ hoá đơn (gồm tip trả tiền mặt)
  transfer    INTEGER NOT NULL DEFAULT 0,
  tips_out    INTEGER NOT NULL DEFAULT 0,    -- tip trả thợ từ két
  moves       INTEGER NOT NULL DEFAULT 0,    -- ngoài luồng (+/−)
  expected    INTEGER NOT NULL DEFAULT 0,
  counted     INTEGER NOT NULL DEFAULT 0,
  diff        INTEGER NOT NULL DEFAULT 0,    -- counted − expected
  keep        INTEGER NOT NULL DEFAULT 0,    -- để lại tủ cho ca sau
  note        TEXT    NOT NULL DEFAULT '',
  closed_at   INTEGER NOT NULL,
  closed_by   INTEGER
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

/* Quầy / thợ báo hoá đơn sai (nhầm thợ, nhầm món, giảm bậy…) hoặc báo
   thiếu hoá đơn (visit_id NULL). Quầy và thợ không tự sửa được hoá đơn —
   chỉ báo, chủ quán sửa rồi đánh dấu đã xử lý. */
CREATE TABLE IF NOT EXISTS bill_reports (
  id          INTEGER PRIMARY KEY,
  visit_id    INTEGER REFERENCES visits(id) ON DELETE CASCADE,
  report_date TEXT    NOT NULL,
  note        TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'open',   -- open | done
  reply       TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  created_by  INTEGER,
  resolved_at INTEGER,
  resolved_by INTEGER
);
CREATE INDEX IF NOT EXISTS idx_report_visit  ON bill_reports(visit_id);
CREATE INDEX IF NOT EXISTS idx_report_status ON bill_reports(status, report_date);

/* ---------------- đặt lịch ----------------
   Giờ tính bằng phút trong ngày (9:30 = 570). Thợ "ai cũng được" thì máy
   chủ tự chọn thợ đang trống lúc đặt, any_barber = 1 để quầy biết khách
   không kén thợ — đổi thợ thoải mái. */
CREATE TABLE IF NOT EXISTS bookings (
  id          INTEGER PRIMARY KEY,
  book_date   TEXT    NOT NULL,
  start_min   INTEGER NOT NULL,
  dur         INTEGER NOT NULL,
  barber_id   INTEGER,
  any_barber  INTEGER NOT NULL DEFAULT 0,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  name        TEXT    NOT NULL DEFAULT '',
  phone       TEXT    NOT NULL DEFAULT '',
  services    TEXT    NOT NULL DEFAULT '[]',     -- [{"id":1,"name":"Cắt"}]
  note        TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'booked', -- booked | arrived | done | noshow | cancel
  confirmed   INTEGER NOT NULL DEFAULT 1,        -- khách tự đặt: 0 tới khi quầy gọi xác nhận
  source      TEXT    NOT NULL DEFAULT 'staff',  -- staff | online
  visit_id    INTEGER,
  token_hash  TEXT,                              -- mã xem / huỷ của khách tự đặt (đã băm)
  ip          TEXT    NOT NULL DEFAULT '',
  cancel_note TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  created_by  INTEGER,
  updated_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_book_date  ON bookings(book_date, barber_id);
CREATE INDEX IF NOT EXISTS idx_book_phone ON bookings(phone, status);

/* Thợ nghỉ cả ngày (0 → 1440) hoặc một khúc giờ. */
CREATE TABLE IF NOT EXISTS barber_off (
  id          INTEGER PRIMARY KEY,
  barber_id   INTEGER NOT NULL,
  off_date    TEXT    NOT NULL,
  start_min   INTEGER NOT NULL DEFAULT 0,
  end_min     INTEGER NOT NULL DEFAULT 1440,
  note        TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  created_by  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_off_date ON barber_off(off_date);
