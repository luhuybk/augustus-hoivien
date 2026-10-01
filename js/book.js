/* Trang khách tự đặt lịch (datlich.html) — không đăng nhập.

   Bốn bước trên một trang: dịch vụ → thợ → ngày & giờ → tên, số điện
   thoại. Giờ trống luôn hỏi lại máy chủ; lúc bấm đặt máy chủ kiểm lần
   nữa, hai người cùng bấm một giờ thì người sau được báo chọn giờ khác.

   Đặt xong khách nhận một link riêng (#c=mã) để xem / huỷ lịch — mã nằm
   sau dấu # nên không lọt vào nhật ký máy chủ hay trang giới thiệu.     */

const URL_API = 'api/index.php';
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const tien = n => Number(n || 0).toLocaleString('vi-VN') + 'đ';
const THU = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const ngay = s => s.slice(8, 10) + '/' + s.slice(5, 7);

async function call(action, data = {}){
  let r;
  try{
    r = await fetch(URL_API, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(Object.assign({action}, data))});
  }catch(e){ throw new Error('Không có mạng. Kiểm tra kết nối rồi thử lại.'); }
  let j;
  try{ j = await r.json(); }catch(e){ throw new Error('Máy chủ đang bận, thử lại sau ít phút.'); }
  if (!j.ok){ const e = new Error(j.error || 'Có lỗi xảy ra.'); e.code = j.code; throw e; }
  return j;
}

function toast(msg, bad){
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ' ok'); t.hidden = false;
  clearTimeout(toast._h); toast._h = setTimeout(() => { t.hidden = true; }, bad ? 5000 : 2600);
}

const S = {init: null, sv: [], barber: 0, date: '', slots: null, dur: 0, start: null, name: '', phone: '', note: '', err: '', busy: false};

function luuMa(token, b){
  try{ localStorage.setItem('datlich.last', JSON.stringify({token, date: b.date, start: b.start})); }catch(e){}
}
function maCu(){
  try{
    const x = JSON.parse(localStorage.getItem('datlich.last') || 'null');
    if (x && x.date >= S.init.today) return x;
  }catch(e){}
  return null;
}

/* ---------- vẽ ---------- */

function veTrang(){
  const d = S.init, c = d.cfg;
  if (!c.online) return $('#app').innerHTML = `<h1>${esc(d.shop)}</h1>
    <div class="card"><p>Quán đang tạm ngưng nhận đặt lịch online. Anh vui lòng gọi điện hoặc nhắn tin cho quán nhé.</p></div>`;
  const cu = maCu();
  const nhom = d.groups.map(g => [g, d.services.filter(v => v.grp === g.code)]).filter(x => x[1].length);
  const le = d.services.filter(v => !d.groups.some(g => g.code === v.grp));
  if (le.length) nhom.push([{code: '', name: 'Khác'}, le]);
  const ngayDs = [];
  const goc = new Date(d.today + 'T00:00:00');
  for (let k = 0; k <= c.days; k++){ const x = new Date(goc); x.setDate(goc.getDate() + k); ngayDs.push(x); }

  $('#app').innerHTML = `<h1>${esc(d.shop)}</h1>
    <p class="lead">Đặt lịch online — chọn dịch vụ, thợ và giờ còn trống.</p>
    ${cu ? `<div class="note">Anh đang có lịch lúc <b>${hm(cu.start)} ngày ${ngay(cu.date)}</b> —
      <a href="#c=${esc(cu.token)}">xem / huỷ lịch</a></div>` : ''}
    ${c.msg ? `<div class="note">${esc(c.msg)}</div>` : ''}
    <div class="card"><h3><i>1</i>Dịch vụ</h3>
      ${nhom.map(([g, ds]) => `<div class="dim" style="margin:8px 0 6px;font-size:12.5px">${esc(g.name)}</div>
        <div class="svlist">${ds.map(v => `<button class="sv${S.sv.includes(v.id) ? ' on' : ''}" data-sv="${v.id}">
          <b>${esc(v.name)}</b><span>${v.price ? tien(v.price) : 'báo giá tại quán'} · ${v.duration}'</span>
          ${v.note ? `<em>${esc(v.note)}</em>` : ''}</button>`).join('')}</div>`).join('')}
    </div>
    <div class="card"><h3><i>2</i>Thợ</h3>
      <div class="chips" style="flex-wrap:wrap;margin:0">${[{id: 0, name: 'Ai cũng được'}].concat(d.barbers).map(b =>
        `<button class="chip big${S.barber === b.id ? ' on' : ''}" data-b="${b.id}">${b.id ? '✂︎ ' : ''}${esc(b.name)}</button>`).join('')}</div>
    </div>
    <div class="card"><h3><i>3</i>Ngày & giờ</h3>
      <div class="days">${ngayDs.map(x => { const k = iso(x), nghi = c.closed_days.includes(x.getDay());
        return `<button class="day${S.date === k ? ' on' : ''}" data-day="${k}"${nghi ? ' disabled title="Quán nghỉ"' : ''}>
          <small>${k === d.today ? 'Hôm nay' : THU[x.getDay()]}</small><b>${x.getDate()}</b><small>th ${x.getMonth() + 1}</small></button>`; }).join('')}</div>
      <div id="times">${veGio()}</div>
    </div>
    <div class="card"><h3><i>4</i>Thông tin của anh</h3>
      <div class="grid2" style="margin:0">
        <input class="inp" id="fName" placeholder="Tên" value="${esc(S.name)}" autocomplete="name">
        <input class="inp" id="fPhone" placeholder="Số điện thoại" inputmode="tel" value="${esc(S.phone)}" autocomplete="tel">
      </div>
      <input class="inp" id="fNote" placeholder="Ghi chú cho thợ (không bắt buộc)" value="${esc(S.note)}" style="margin-top:8px">
      <div class="hp" aria-hidden="true"><input id="fWeb" tabindex="-1" autocomplete="off"></div>
      ${S.start != null ? `<div class="sum">📅 <b>${hm(S.start)}</b> ${THU[new Date(S.date + 'T00:00:00').getDay()]} ${ngay(S.date)}
        · ${esc(d.services.filter(v => S.sv.includes(v.id)).map(v => v.name).join(', '))}
        · ✂︎ ${esc(S.barber ? (d.barbers.find(b => b.id === S.barber) || {}).name : 'thợ nào cũng được')}</div>` : ''}
      <p class="err" id="err"${S.err ? '' : ' hidden'}>${esc(S.err)}</p>
      <button class="btn pri" id="go" style="margin-top:12px"${S.busy ? ' disabled' : ''}>Đặt lịch</button>
      <p class="dim" style="margin:10px 0 0;font-size:12.5px">Quán sẽ gọi xác nhận. Số điện thoại chỉ dùng để liên hệ lịch hẹn.</p>
    </div>`;
}

function veGio(){
  if (!S.sv.length) return '<p class="dim" style="margin:10px 0 0">Chọn dịch vụ trước để xem giờ trống.</p>';
  if (!S.date) return '<p class="dim" style="margin:10px 0 0">Chọn ngày.</p>';
  if (S.slots === null) return '<p class="dim" style="margin:10px 0 0">Đang tìm giờ trống…</p>';
  if (!S.slots.length) return '<p class="dim" style="margin:10px 0 0">Ngày này đã kín lịch — anh chọn ngày khác hoặc thợ khác nhé.</p>';
  return `<div class="times">${S.slots.map(t => `<button class="chip${S.start === t ? ' on' : ''}" data-t="${t}">${hm(t)}</button>`).join('')}</div>
    <p class="dim" style="margin:8px 0 0;font-size:12.5px">Khoảng ${S.dur} phút.</p>`;
}

async function taiGio(){
  if (!S.sv.length || !S.date) return;
  S.slots = null; $('#times').innerHTML = veGio();
  const luot = taiGio.n = (taiGio.n || 0) + 1;
  try{
    const r = await call('pub_slots', {date: S.date, services: S.sv, barber_id: S.barber});
    if (luot !== taiGio.n) return;
    S.slots = r.slots; S.dur = r.dur;
    if (!S.slots.includes(S.start)) S.start = null;
  }catch(e){ S.slots = []; toast(e.message, true); }
  veTrang();
}

async function datLich(){
  S.name = $('#fName').value.trim(); S.phone = $('#fPhone').value.trim(); S.note = $('#fNote').value.trim();
  const loi = !S.sv.length ? 'Chọn dịch vụ.' : S.start == null ? 'Chọn giờ.' : S.name.length < 2 ? 'Nhập tên của anh.'
            : !/^0\d{9}$/.test(S.phone.replace(/\D/g, '')) ? 'Số điện thoại phải đủ 10 số, bắt đầu bằng 0.' : '';
  if (loi){ S.err = loi; return veTrang(); }
  S.busy = true; S.err = ''; veTrang();
  try{
    const r = await call('pub_book', {date: S.date, start: S.start, services: S.sv, barber_id: S.barber,
                                      name: S.name, phone: S.phone, note: S.note, website: $('#fWeb').value});
    luuMa(r.token, r.booking);
    location.hash = 'c=' + r.token;
  }catch(e){
    S.busy = false; S.err = e.message;
    if (e.code === 'taken'){ S.start = null; await taiGio(); }
    veTrang();
  }
}

/* ---------- xem / huỷ lịch bằng mã ---------- */

async function xemLich(token, huy){
  try{
    const r = await call('pub_booking', {token, cancel: huy ? 1 : 0});
    const b = r.booking;
    const tt = {booked: 'Đã đặt — quán sẽ gọi xác nhận', arrived: 'Đang phục vụ', done: 'Đã hoàn thành', noshow: 'Không đến', cancel: 'Đã huỷ'}[b.status] || b.status;
    if (b.status === 'cancel') try{ localStorage.removeItem('datlich.last'); }catch(e){}
    $('#app').innerHTML = `<h1>${esc(S.init.shop)}</h1>
      <div class="card">
        ${b.status === 'booked' ? '<div class="okbig">✓</div><h2 style="text-align:center;margin:0">Đặt lịch thành công</h2>' : `<h2>${esc(tt)}</h2>`}
        <div class="sum">👤 ${esc(b.name)}<br>📅 <b>${hm(b.start)}</b> – ${hm(b.start + b.dur)}, ${THU[new Date(b.date + 'T00:00:00').getDay()]} ${ngay(b.date)}/${b.date.slice(0, 4)}
          <br>✂︎ ${esc(b.barber)}<br>💈 ${esc(b.services.join(', '))}</div>
        ${b.status === 'booked' ? `<p class="dim">Lưu lại trang này (đánh dấu / chụp màn hình) để xem hoặc huỷ lịch. ${esc(tt)}.</p>
          <button class="btn" id="huy" style="margin-top:6px">Huỷ lịch này</button>` : ''}
        <a class="btn pri" href="datlich.html" style="margin-top:10px;display:block;text-align:center" id="moi">Đặt lịch khác</a>
      </div>`;
    if (huy) toast('Đã huỷ lịch');
  }catch(e){
    $('#app').innerHTML = `<h1>${esc(S.init.shop)}</h1><div class="card"><p>${esc(e.message)}</p>
      <a class="btn pri" href="datlich.html" style="display:block;text-align:center">Đặt lịch mới</a></div>`;
  }
}

/* ---------- sự kiện ---------- */

document.addEventListener('click', e => {
  const el = e.target.closest('button, a');
  if (!el) return;
  if (el.id === 'moi'){ e.preventDefault(); history.pushState('', '', location.pathname); return route(); }
  if (el.dataset.sv){
    const id = Number(el.dataset.sv), k = S.sv.indexOf(id);
    if (k >= 0) S.sv.splice(k, 1); else S.sv.push(id);
    veTrang(); return taiGio();
  }
  if (el.dataset.b !== undefined){ S.barber = Number(el.dataset.b); veTrang(); return taiGio(); }
  if (el.dataset.day){ S.date = el.dataset.day; S.start = null; veTrang(); return taiGio(); }
  if (el.dataset.t){ S.start = Number(el.dataset.t); S.err = ''; return veTrang(); }
  if (el.id === 'go') return datLich();
  if (el.id === 'huy'){
    if (el.dataset.sure !== '1'){ el.dataset.sure = '1'; el.textContent = 'Bấm lần nữa để huỷ'; return; }
    return xemLich(new URLSearchParams(location.hash.slice(1)).get('c'), true);
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'fName') S.name = e.target.value;
  if (e.target.id === 'fPhone') S.phone = e.target.value;
  if (e.target.id === 'fNote') S.note = e.target.value;
});
window.addEventListener('hashchange', route);

function route(){
  const c = new URLSearchParams(location.hash.slice(1)).get('c');
  if (c) return xemLich(c, false);
  veTrang();
}

(async () => {
  try{
    S.init = await call('pub_book_init');
    document.title = 'Đặt lịch · ' + S.init.shop;
    /* Ngày mở cửa gần nhất. */
    const goc = new Date(S.init.today + 'T00:00:00');
    for (let k = 0; k <= S.init.cfg.days; k++){
      const x = new Date(goc); x.setDate(goc.getDate() + k);
      if (!S.init.cfg.closed_days.includes(x.getDay())){ S.date = iso(x); break; }
    }
    route();
  }catch(e){
    $('#app').innerHTML = `<div class="card"><p>${esc(e.message)}</p></div>`;
  }
})();
