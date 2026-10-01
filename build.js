/* Đóng gói app Hội viên để đưa lên máy chủ (Hostinger…).
   Chạy:  node build.js            — chỉ dựng, ra thư mục dist/
          node build.js --deploy   — dựng xong đẩy luôn lên nhánh `deploy`
                                     trên GitHub, Hostinger tự kéo về

   dist/ là đúng những gì public_html cần chứa.

   Chỉ những tệp cần cho người dùng mới vào dist/. Mã nguồn phụ trợ
   (build.js, README, tools/) ở lại trên máy: đưa lên máy chủ là ai cũng
   tải về đọc được.

   api/config.php cũng KHÔNG vào dist/ — mã mật khẩu chủ nằm trong đó, và
   trên máy chủ nó đã có sẵn rồi, ghi đè lên là mất.                    */
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const os     = require('os');
const {execFileSync} = require('child_process');

const dir  = __dirname;
const DIST = path.join(dir, 'dist');
const read = p => fs.readFileSync(path.join(dir, p), 'utf8');

const JS = ['js/api.js', 'js/kiotviet.js', 'js/views.js', 'js/app.js'];

/* ---------- mã phiên bản: đổi khi và chỉ khi mã nguồn đổi ---------- */
const srcFiles = ['index.html', 'datlich.html', 'css/style.css', 'js/book.js', ...JS];
const VERSION = crypto.createHash('sha1')
  .update(srcFiles.map(read).join('\0')).digest('hex').slice(0, 8);

/* ---------- kiểm cú pháp trước khi đóng gói ----------
   Thà dừng ở đây còn hơn để một dấu ngoặc thiếu biến thành trang trắng
   trên điện thoại nhân viên, lúc đó không có cách nào biết hỏng ở đâu. */
try {
  new Function(JS.map(f => read(f)).join('\n;\n'));
  new Function(read('js/book.js'));          // trang đặt lịch chạy riêng
} catch (e) {
  console.error('\n✗ Mã JavaScript có lỗi cú pháp — chưa dựng gì cả:\n  ' + e.message + '\n');
  process.exit(1);
}

/* ---------- dựng dist/ ---------- */
fs.rmSync(DIST, {recursive: true, force: true});

const put = (rel, data) => {
  const f = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(f), {recursive: true});
  fs.writeFileSync(f, data);
};
const copy = rel => put(rel, fs.readFileSync(path.join(dir, rel)));

/* Gắn ?v= vào css/js để trình duyệt không dùng bản cũ sau khi cập nhật —
   nhân viên không ai biết bấm Ctrl+F5, và bảo họ làm vậy cũng vô ích. */
put('index.html', read('index.html').replace(
  /(href|src)="((?:css|js)\/[^"]+)"/g, (_, a, p) => `${a}="${p}?v=${VERSION}"`));

/* Trang khách tự đặt lịch — công khai, không cần đăng nhập. */
put('datlich.html', read('datlich.html').replace(
  /(href|src)="((?:css|js)\/[^"]+)"/g, (_, a, p) => `${a}="${p}?v=${VERSION}"`));

for (const f of ['css/style.css', ...JS, 'js/book.js', 'manifest.webmanifest', 'icon.svg']) copy(f);

/* Phần máy chủ: mọi thứ trừ config.php và dữ liệu. */
for (const f of ['index.php', 'lib.php', 'schema.sql', 'backup.php', '.htaccess']) copy('api/' + f);

copy('api/config.example.php');

/* .htaccess ở gốc. Hostinger kéo bằng git thì public_html có cả thư mục
   .git — phải chặn, không thì ai cũng tải được lịch sử các bản dựng. */
put('.htaccess', `# Hội viên — cấu hình cho Apache/LiteSpeed (Hostinger)

<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteRule (^|/)\\.git(/|$) - [F,L]
  # luôn dùng https
  RewriteCond %{HTTPS} !=on
  RewriteCond %{HTTP:X-Forwarded-Proto} !https
  RewriteRule ^(.*)$ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]
</IfModule>

<IfModule mod_mime.c>
  AddType application/manifest+json .webmanifest
  AddType text/javascript           .js
  AddType image/svg+xml             .svg
  AddCharset UTF-8 .html .css .js .webmanifest
</IfModule>

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/javascript application/json application/manifest+json image/svg+xml
</IfModule>

<IfModule mod_headers.c>
  # css/js luôn kèm ?v=… nên giữ lâu được; đổi mã nguồn là đổi địa chỉ
  <FilesMatch "\\.(css|js)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  # index.html phải luôn hỏi lại máy chủ, không thì kẹt ở bản cũ
  <FilesMatch "^(index\\.html|datlich\\.html|manifest\\.webmanifest)$">
    Header set Cache-Control "no-cache, must-revalidate"
  </FilesMatch>
  Header set X-Robots-Tag "noindex, nofollow"
  Header set X-Content-Type-Options "nosniff"
  Header set Referrer-Policy "no-referrer"
</IfModule>

Options -Indexes
DirectoryIndex index.html

# tệp ẩn (.git, .gitignore…) và tệp mã nguồn phụ không bao giờ trả về
<FilesMatch "^\\.|\\.(sql|md|sqlite.*)$">
  Require all denied
</FilesMatch>
`);
put('robots.txt', 'User-agent: *\nDisallow: /\n');

console.log(`\n✓ Đã dựng dist/ (bản ${VERSION})\n`);

if (process.argv.includes('--deploy')) deploy();
else {
  console.log('Upload toàn bộ dist/ vào public_html trên Hostinger — hoặc chạy "node build.js --deploy".');
  console.log('Lần đầu, tạo config.php trên máy chủ:');
  console.log('  1. chạy "node tools/hash-password.js" ở máy để tạo mã mật khẩu chủ');
  console.log('  2. tạo thư mục memberhub-data CẠNH public_html (ngoài thư mục web)');
  console.log('  3. chép api/config.example.php vào đó thành config.php, dán mã vừa tạo\n');
  console.log('Những lần sau chỉ cần upload đè — config.php và dữ liệu không bị đụng.\n');
}

/* ============================================================
   --deploy: đẩy nội dung dist/ lên nhánh `deploy` (cùng cách kol-hub)

   `main` chứa mã nguồn (build.js, tools/…) — không được nằm trên máy chủ.
   Nhánh `deploy` chỉ chứa đúng dist/, Hostinger kéo nguyên nhánh về
   public_html. `git pull` chỉ đụng file git quản lý, nên config.php và
   memberhub-data/ nằm im qua mọi lần cập nhật.

   Không đổi nhánh, không đụng thư mục làm việc: nhét từng file vào kho
   đối tượng của git rồi tự ghép cây và commit, bằng một bảng mục lục tạm.
   ============================================================ */
function deploy(){
  const walk = d => fs.readdirSync(d, {withFileTypes: true}).flatMap(e =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const files = walk(DIST);
  const git = (args, env) => execFileSync('git', args,
    {cwd: dir, encoding: 'utf8', env: env || process.env, stdio: ['ignore', 'pipe', 'pipe']}).trim();
  /* Hỏi thử: im lặng khi không có câu trả lời (nhánh chưa có ở lần đầu). */
  const thu = (args, env) => {
    try { return execFileSync('git', args, {cwd: dir, encoding: 'utf8', env: env || process.env,
                                            stdio: ['ignore', 'pipe', 'ignore']}).trim(); }
    catch (e) { return null; }
  };

  if (!thu(['rev-parse', '--git-dir'])) {
    console.error('✗ Thư mục này chưa phải kho git — chưa đẩy được.\n'); process.exit(1);
  }
  const env = Object.assign({}, process.env);
  if (!thu(['var', 'GIT_AUTHOR_IDENT'])) {
    const ten  = thu(['log', '-1', '--format=%an']) || 'Hoi vien';
    const mail = thu(['log', '-1', '--format=%ae']) || 'hoivien@localhost';
    Object.assign(env, {GIT_AUTHOR_NAME: ten, GIT_AUTHOR_EMAIL: mail,
                        GIT_COMMITTER_NAME: ten, GIT_COMMITTER_EMAIL: mail});
  }
  const idx = path.join(os.tmpdir(), 'memberhub-deploy-index-' + process.pid);
  fs.rmSync(idx, {force: true});
  env.GIT_INDEX_FILE = idx;

  try {
    files.forEach(f => {
      const rel  = path.relative(DIST, f).split(path.sep).join('/');
      const hash = git(['hash-object', '-w', '--', f], env);
      git(['update-index', '--add', '--cacheinfo', `100644,${hash},${rel}`], env);
    });
    const tree = git(['write-tree'], env);
    const parent = thu(['rev-parse', '--verify', 'refs/heads/deploy^{commit}']);
    if (parent && thu(['rev-parse', parent + '^{tree}']) === tree) {
      console.log(`· nhánh deploy đã đúng bản ${VERSION} rồi — không tạo commit mới.`);
    } else {
      const msg = `Bản dựng ${VERSION}`;
      const commit = git(parent ? ['commit-tree', tree, '-p', parent, '-m', msg]
                                : ['commit-tree', tree, '-m', msg], env);
      git(['update-ref', 'refs/heads/deploy', commit, parent || ''], env);
      console.log(`✓ nhánh deploy → ${commit.slice(0, 7)}  (${msg})`);
    }
  } catch (e) {
    console.error('✗ Không dựng được nhánh deploy:\n  ' + String(e.stderr || e.message).trim().split('\n')[0] + '\n');
    process.exit(1);
  } finally {
    fs.rmSync(idx, {force: true});
  }

  if (!thu(['remote', 'get-url', 'origin'])) {
    console.log('· chưa gắn GitHub (git remote add origin …) — nhánh deploy mới nằm trên máy.\n');
    return;
  }
  try {
    execFileSync('git', ['push', 'origin', 'deploy'], {cwd: dir, stdio: ['ignore', 'ignore', 'pipe']});
    console.log('✓ đã đẩy lên GitHub. Hostinger sẽ tự kéo về trong khoảng một phút.\n');
  } catch (e) {
    console.error('✗ đẩy lên GitHub không được:\n  ' + String(e.stderr || e.message).trim().split('\n').slice(-1)[0]);
    console.error('  Đẩy tay:  git push origin deploy\n');
  }
}
