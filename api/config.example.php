<?php
/* Chép file này thành config.php rồi sửa. config.php KHÔNG lên git và
   không nằm trong dist/ — nó là của riêng máy chủ.

   Nên đặt config.php (và dữ liệu) RA NGOÀI public_html:
     /home/uXXXXXXXX/domains/<tên miền>/memberhub-data/config.php
   tức là cạnh public_html. Tạo thư mục memberhub-data ở đó là app tự
   thấy — upload đè app bao nhiêu lần dữ liệu cũng không mất.            */

/* Tài khoản chủ quán — tạo lần đầu app chạy.
   Tạo mã mật khẩu bằng:  node tools/hash-password.js
   Mật khẩu thật không nằm trong file này, chỉ có mã băm không suy ngược được. */
define('MH_OWNER_USER', 'chu');
define('MH_OWNER_PASS', 'DAN_MA_VAO_DAY');

/* Tên quán, hiện ở màn hình đăng nhập. */
define('MH_SHOP_NAME', 'Augustus Barbershop');

/* Hosting chạy giờ UTC — lệch 7 tiếng thì khách cắt buổi tối bị tính
   sang ngày hôm sau. */
define('MH_TZ', 'Asia/Ho_Chi_Minh');

/* Quầy ghi nhầm thì được tự huỷ trong bao nhiêu phút. Quá thời gian này
   chỉ chủ huỷ được — để không ai lặng lẽ sửa sổ sau khi khách đã về. */
define('MH_UNDO_MINUTES', 15);

/* Chỉ định hẳn chỗ cất cơ sở dữ liệu (không bắt buộc). */
// define('MH_DB_FILE', '/home/uXXXXXXXX/domains/tenmien.com/memberhub-data/memberhub.sqlite');
