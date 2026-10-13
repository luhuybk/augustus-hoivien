/* Service worker của app Hội viên — chỉ để MẤT MẠNG vẫn mở được app.

   - Trang (index.html): hỏi máy chủ trước, mất mạng mới lấy bản đã lưu.
   - css/js: địa chỉ có ?v=<bản> nên lưu một lần dùng mãi; bản mới là địa
     chỉ mới, bản cũ dọn khi service worker mới bật.
   - api/: KHÔNG bao giờ đi qua đây — dữ liệu luôn lấy thẳng từ máy chủ;
     hoá đơn lúc mất mạng do app.js tự giữ (hàng chờ gửi).
   build.js điền mã bản và danh sách tệp lúc dựng. */
const CACHE = 'hoivien-__VERSION__';
const ASSETS = __ASSETS__;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./'].concat(ASSETS))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('hoivien-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin || u.pathname.includes('/api/') || u.pathname.endsWith('datlich.html')) return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then(res => {
      if (res.ok) { const b = res.clone(); caches.open(CACHE).then(c => c.put('./', b)); }
      return res;
    }).catch(() => caches.match('./')));
    return;
  }
  if (u.search.includes('v=')) {
    e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => {
      if (res.ok) { const b = res.clone(); caches.open(CACHE).then(c => c.put(r, b)); }
      return res;
    })));
  }
});
