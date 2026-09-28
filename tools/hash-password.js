/* Tạo mã mật khẩu chủ quán để dán vào config.php.

   Chạy:  node tools/hash-password.js
          node tools/hash-password.js "mật-khẩu-của-bạn"

   Mật khẩu thật không đi đâu cả — không gửi lên mạng, không ghi ra file.
   Thứ in ra là mã băm PBKDF2-SHA256, không suy ngược lại được. PHP kiểm
   bằng hash_pbkdf2() với đúng tham số này (mhVerifyPass trong api/lib.php). */
const crypto   = require('crypto');
const readline = require('readline');

const ITER = 210000;

function make(pass){
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(pass, salt, ITER, 32, 'sha256');
  return `pbkdf2_sha256$${ITER}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function report(pass){
  pass = pass.trim();
  if (pass.length < 8){
    console.error('\n⚠︎  Mật khẩu chủ nên từ 8 ký tự — tài khoản này xem được số điện thoại của cả tệp khách.\n');
    process.exit(1);
  }
  console.log('\nDán nguyên dòng dưới đây vào config.php:\n');
  console.log(`define('MH_OWNER_PASS', '${make(pass)}');\n`);
  console.log('Lưu ý: dòng này chỉ có tác dụng LẦN ĐẦU app chạy (lúc tạo tài khoản chủ).');
  console.log('Về sau đổi mật khẩu trong app: Thiết lập → Đổi mật khẩu.\n');
}

const arg = process.argv.slice(2).join(' ');
if (arg) report(arg);
else {
  const rl = readline.createInterface({input: process.stdin, output: process.stdout});
  rl.question('Mật khẩu chủ quán: ', a => { rl.close(); report(a); });
}
