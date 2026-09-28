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

/* Hỏi mật khẩu mà KHÔNG hiện chữ lên màn hình — chỉ hiện dấu *. Hiện
   nguyên chữ thì mật khẩu nằm lại trong lịch sử terminal, ai liếc qua
   hay chụp màn hình gửi nhờ xem lỗi là lộ. */
function hoiAn(cau){
  return new Promise(xong => {
    const rl = readline.createInterface({input: process.stdin, output: process.stdout, terminal: true});
    let dangHoi = true;
    rl._writeToOutput = s => {
      if (!dangHoi || s.startsWith(cau)) return process.stdout.write(s);
      if (s === '\r\n' || s === '\n') return process.stdout.write(s);
      process.stdout.write('*'.repeat([...s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')].length));
    };
    rl.question(cau, a => { dangHoi = false; rl.close(); process.stdout.write('\n'); xong(a); });
  });
}

const arg = process.argv.slice(2).join(' ');
if (arg) report(arg);
else (async () => {
  const a = await hoiAn('Mật khẩu chủ quán: ');
  /* Gõ hai lần: không thấy chữ thì gõ nhầm là không biết, mà mật khẩu
     chủ đặt sai thì chính mình bị khoá ngoài app. */
  const b = await hoiAn('Gõ lại lần nữa:    ');
  if (a.trim() !== b.trim()){
    console.error('\n⚠︎  Hai lần gõ không khớp — chạy lại lệnh.\n');
    process.exit(1);
  }
  report(a);
})();
