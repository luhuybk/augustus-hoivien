<?php
/* Bộ định tuyến chỉ dùng khi chạy thử trên máy:
     php -S 127.0.0.1:5300 -t . dev.php

   Việc duy nhất nó làm là bảo trình duyệt ĐỪNG nhớ file js/css. Không có
   nó thì sửa mã xong tải lại trang vẫn thấy bản cũ, và mình ngồi sửa một
   lỗi đã sửa rồi.

   Trên máy chủ thật không có file này — ở đó build.js gắn ?v=<mã bản> vào
   địa chỉ js/css, đổi mã là trình duyệt tự tải bản mới.                 */
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$file = __DIR__ . $path;

if (is_file($file) && preg_match('/\.(js|css|webmanifest|svg)$/', $file)) {
  $loai = [
    'js'          => 'text/javascript; charset=utf-8',
    'css'         => 'text/css; charset=utf-8',
    'webmanifest' => 'application/manifest+json',
    'svg'         => 'image/svg+xml',
  ][pathinfo($file, PATHINFO_EXTENSION)];

  header('Content-Type: ' . $loai);
  header('Cache-Control: no-store, no-cache, must-revalidate');
  readfile($file);
  return true;
}

return false;   // còn lại để máy chủ tự lo
