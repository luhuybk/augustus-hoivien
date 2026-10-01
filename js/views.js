/* Các màn hình. Mỗi hàm trả về chuỗi HTML, app.js gắn vào #view và lo
   phần bấm nút. Tách ra vậy để sửa giao diện không đụng vào luồng.     */

const esc = s => String(s == null ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const tien = n => Number(n || 0).toLocaleString('vi-VN') + 'đ';
/* 2.340.000 → "2,3tr" cho chỗ chật. */
const tienGon = n => {
  n = Number(n || 0);
  if (n >= 1e6) return (Math.round(n / 1e5) / 10).toLocaleString('vi-VN') + 'tr';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n);
};
/* 1000000 → "1.000.000" cho ô nhập tiền; 0 thì để trống cho hiện chữ gợi ý. */
const soTien = n => Number(n) ? Number(n).toLocaleString('vi-VN') : '';
/* Tên món kèm tên sản phẩm cụ thể: "Sản phẩm A – 12% · Wax Reuzel". */
const tenMon = i => i.name + (i.detail ? ' · ' + i.detail : '');
/* Phút trong ngày → "09:30". */
const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const THU = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const thuCua = d => THU[new Date(d + 'T00:00:00').getDay()];
const ngay = d => d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '';
const ngayNgan = d => d ? d.slice(8, 10) + '/' + d.slice(5, 7) : '';

/* Chữ đen hay chữ trắng trên nền màu hạng — tuỳ nền sáng hay tối. */
function doSang(hex){
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
/* Hạng Đen nền đen thì viền vàng — không thì chìm hẳn vào nền tối. */
const tierStyle = c => `background:${esc(c)};color:${doSang(c) > 0.6 ? '#1b1204' : '#fff'}`
  + (doSang(c) < 0.18 ? ';box-shadow:inset 0 0 0 1.5px var(--acc)' : '');
const tierBadge = (t, lg) => t
  ? `<span class="tier${lg ? ' lg' : ''}" style="${tierStyle(t.color)}">${esc(t.name)}</span>` : '';

const head = (title, back, extra) => `<div class="head">
  ${back ? `<button class="back" data-act="back" aria-label="Quay lại">‹</button>` : ''}
  <h2 class="grow">${title}</h2>${extra || ''}</div>`;

const kindName = k => k === 'any' ? 'Mọi lượt ghé' : ((App.kinds || {})[k] || k);

/* Đặc quyền lưu dạng chữ, mỗi dòng một điều — tách ra thành danh sách.
   % giảm của hạng là con số app tự trừ khi tính tiền — luôn đứng đầu. */
const perksOf = t => (t && t.disc_pct ? ['Giảm ' + t.disc_pct + '% mỗi lần làm dịch vụ'] : [])
  .concat(String((t && t.perks) || '').split('\n')
  .map(x => x.replace(/^[\s\-•*✓]+/, '').trim()).filter(Boolean));

/* "Từ 5 lần cắt hoặc 1tr chi tiêu" — điều kiện lên hạng, đọc thành câu. */
const tierCond = t => {
  const dk = [];
  if (t.min_cuts > 0)  dk.push(t.min_cuts + ' lần cắt');
  if (t.min_spend > 0) dk.push(tienGon(t.min_spend) + ' chi tiêu');
  return dk.length ? 'Từ ' + dk.join(' hoặc ') : 'Hạng khởi điểm';
};

/* 'MM-DD' → '12/10' */
const ngaySinh = bd => bd ? bd.slice(3, 5) + '/' + bd.slice(0, 2) : '';

/* Ba ô chọn ngày / tháng / năm sinh. Năm để trống được — nhiều khách
   ngại nói tuổi, mà tặng quà thì chỉ cần ngày và tháng. */
function oNgaySinh(bd, nam, ten){
  ten = ten || '';
  const d = bd ? Number(bd.slice(3, 5)) : 0, m = bd ? Number(bd.slice(0, 2)) : 0;
  const opt = (n, cur, nhan) => `<option value="${n}"${n === cur ? ' selected' : ''}>${nhan}</option>`;
  let ngay = opt(0, d, 'Ngày'), thang = opt(0, m, 'Tháng');
  for (let i = 1; i <= 31; i++) ngay += opt(i, d, i);
  for (let i = 1; i <= 12; i++) thang += opt(i, m, 'Tháng ' + i);
  return `<div class="grid3 bdrow">
    <select class="inp" name="${ten}day" data-bd="day">${ngay}</select>
    <select class="inp" name="${ten}month" data-bd="month">${thang}</select>
    <input class="inp" name="${ten}year" data-bd="year" inputmode="numeric" maxlength="4" placeholder="Năm (không bắt buộc)" value="${nam || ''}">
  </div>`;
}

/* Xếp dịch vụ theo nhóm A, B, C… (giữ thứ tự trong nhóm). Dịch vụ mang mã
   nhóm đã bị xoá thì vào nhóm cuối "Khác". */
function theoNhom(ds, groups){
  groups = groups && groups.length ? groups : [{code: 'A', name: 'Dịch vụ'}];
  const ra = groups.map(g => [g, []]);
  const khac = [];
  ds.forEach(s => { const o = ra.find(([g]) => g.code === s.grp); (o ? o[1] : khac).push(s); });
  if (khac.length) ra.push([{code: '?', name: 'Khác'}, khac]);
  return ra.filter(([, x]) => x.length);
}

const perkList = (ds, cls) => ds.length
  ? `<ul class="perks${cls ? ' ' + cls : ''}">${ds.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';

/* Bảng các hạng và đặc quyền — dùng ở tab Khách (chủ) và mục Khác (quầy).
   Bấm một hạng thì lọc danh sách khách theo hạng đó. */
function tierPanel(tiers, counts, active, clickable){
  return `<div class="tiercards">${tiers.map(t => {
    const ds = perksOf(t);
    const tag = clickable ? 'button' : 'div';
    return `<${tag} class="tcard${active === t.id ? ' on' : ''}" ${clickable ? `data-act="cf" data-k="tier" data-v="${t.id}"` : ''}
        style="--tc:${esc(t.color)}">
      <div class="row">${tierBadge(t, true)}<span class="grow"></span>
        ${counts && counts[t.id] != null ? `<b class="num">${counts[t.id]}</b><span class="dim">khách</span>` : ''}</div>
      <div class="dim" style="margin:6px 0 2px">${tierCond(t)}</div>
      ${ds.length || t.bday_gift ? perkList(t.bday_gift ? ds.concat('🎂 ' + t.bday_gift + ' (trong tháng sinh nhật)') : ds)
                                 : '<div class="dim" style="font-style:italic">Chưa ghi đặc quyền</div>'}
    </${tag}>`;
  }).join('')}</div>`;
}

const Views = {

  login(shop){
    return `<div class="login">
      <div class="logo">✂︎</div>
      <h1>Hội viên</h1>
      <p class="muted">${esc(shop || '')}</p>
      <form id="loginForm">
        <div class="field"><label>Tên đăng nhập</label>
          <input name="username" autocapitalize="off" autocorrect="off" spellcheck="false"
                 autocomplete="username" required></div>
        <div class="field"><label>Mật khẩu</label>
          <input name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn pri" type="submit">Đăng nhập</button>
      </form>
    </div>`;
  },

  /* ---------------- tra cứu ở quầy ---------------- */

  lookup(st){
    const theoTen = st.mode === 'text';
    return `<div class="wrap">
      ${head('Tra khách', false,
        `<button class="chip" data-act="mode">${theoTen ? 'Tìm theo số' : 'Tìm theo tên'}</button>`)}
      <form id="searchForm" autocomplete="off">
        <input id="q" class="bigsearch${theoTen ? ' text' : ''}" name="q"
               inputmode="${theoTen ? 'text' : 'numeric'}" ${theoTen ? '' : 'maxlength="11"'}
               autocapitalize="off" autocorrect="off" spellcheck="false"
               placeholder="${theoTen ? 'Tên khách' : '4 số cuối'}" value="${esc(st.q || '')}"
               onfocus="this.select()">
      </form>
      <div id="results" style="margin-top:12px">${this.results(st)}</div>
      <button class="btn" data-act="newCus" style="margin-top:12px">+ Khách mới</button>
    </div>`;
  },

  results(st){
    if (st.err) return `<div class="empty">${esc(st.err)}</div>`;
    if (!st.rows) return `<p class="dim" style="text-align:center">
      Gõ 4 số cuối điện thoại của khách. Trùng đuôi số thì chọn đúng tên.</p>`;
    if (!st.rows.length) return `<div class="empty">Không có khách nào khớp “${esc(st.q)}”.<br>
      Khách lần đầu đến thì bấm <b>Khách mới</b> bên dưới.</div>`;
    return `<div class="list">${st.rows.map(r => `
      <button class="item${App.cur.name === 'card' && App.cur.id === r.id ? ' sel' : ''}" data-act="open" data-id="${r.id}">
        <div class="grow"><b>${esc(r.name || '(chưa có tên)')}</b>
          <div class="sub num">${esc(r.phone)} · ${r.cuts} lần cắt${r.last ? ' · ghé ' + ngayNgan(r.last) : ''}</div></div>
        ${r.pending ? `<span class="badge gift">🎁 ${r.pending}</span>` : ''}
        ${tierBadge(r.tier)}
      </button>`).join('')}</div>`;
  },

  newCus(pre){
    return `<div class="wrap">
      ${head('Khách mới', true)}
      <form id="newCusForm" class="card">
        <div class="field"><label>Tên khách</label>
          <input name="name" autocomplete="off" required value="${esc(pre.name || '')}"></div>
        <div class="field"><label>Số điện thoại (đủ 10 số)</label>
          <input name="phone" inputmode="tel" autocomplete="off" required value="${esc(pre.phone || '')}"></div>
        <p class="note">Nên dùng đúng số đã lưu bên KiotViet — đối soát cuối tuần khớp theo số điện thoại.</p>
        <button class="btn pri" type="submit">Tạo và mở thẻ khách</button>
      </form>
    </div>`;
  },

  /* ---------------- thẻ khách ---------------- */

  card(d, ui){
    const c = d.customer, s = d.stats, t = d.tier.tier, nx = d.tier.next;
    const owner = API.isOwner();
    const mau = t ? t.color : '#555';

    let hang = '';
    if (nx){
      const can = [];
      if (nx.need_cuts != null)  can.push(`<b>${nx.need_cuts}</b> lần cắt`);
      if (nx.need_spend != null) can.push(`<b>${tien(nx.need_spend)}</b>`);
      hang = `<div class="bar"><i style="width:${Math.round(nx.progress * 100)}%;background:${esc(nx.tier.color)}"></i></div>
        <div class="dim">Còn ${can.join(' hoặc ')} nữa lên ${tierBadge(nx.tier)}</div>`;
    } else if (t){
      hang = `<div class="dim" style="margin-top:8px">Hạng cao nhất 👑</div>`;
    }

    const pending = [];
    d.rewards.forEach(p => p.pending.forEach(e => pending.push(Object.assign({pid: p.program_id, pname: p.name}, e))));
    const moi = new Set((ui.justGot || []).map(e => e.program_id + '|' + e.seq));

    /* Đặc quyền hạng hiện tại, và hạng kế tiếp có THÊM gì — để quầy nói
       được với khách "cắt thêm 2 lần nữa là anh được giảm 10%". */
    const dqNay = perksOf(t).concat(t && t.bday_gift ? ['🎂 ' + t.bday_gift + ' (trong tháng sinh nhật)'] : []);
    const dqSau = nx ? perksOf(nx.tier).concat(nx.tier.bday_gift ? ['🎂 ' + nx.tier.bday_gift + ' (trong tháng sinh nhật)'] : [])
                         .filter(x => !dqNay.includes(x)) : [];
    const bd = d.bday || {};
    const dacQuyen = `<div class="card">
        <h3>Đặc quyền ${t ? 'hạng ' + esc(t.name) : ''}</h3>
        ${dqNay.length ? perkList(dqNay) : '<div class="dim">Hạng này chưa có đặc quyền nào.</div>'}
        ${dqSau.length ? `<div class="dim" style="margin-top:10px">Lên ${tierBadge(nx.tier)} có thêm:</div>${perkList(dqSau, 'next')}` : ''}
      </div>`;

    return `<div class="wrap cq">
      ${head('Thẻ khách', true)}
      <div class="cardgrid"><div>

      <div class="card">
        <div class="hero">
          <div class="ava" style="${tierStyle(mau)}">${esc((c.name || '?').trim().slice(0, 1).toUpperCase())}</div>
          <div class="grow">
            <div class="nm">${esc(c.name || '(chưa có tên)')}</div>
            <div class="dim num">${esc(c.phone)}${c.kv_code ? ' · ' + esc(c.kv_code) : ''}
              ${bd.birthday ? ` · <span class="${bd.this_month ? 'sn-nay' : ''}">🎂 ${ngaySinh(bd.birthday)}${bd.year ? '/' + bd.year : ''}${bd.days === 0 ? ' — hôm nay!' : bd.days <= 7 ? ' — còn ' + bd.days + ' ngày' : ''}</span>` : ''}</div>
          </div>
          ${tierBadge(t, true)}
        </div>
        <div class="dim" style="margin-top:10px">${s.cuts} lần cắt · ${s.visits} lượt ghé · đã chi ${tien(s.spend)}
          ${s.last ? ' · gần nhất ' + ngay(s.last) : ''}</div>
        ${this.thoQuen(d.barbers, s.visits)}
        ${hang}
        ${c.note && owner ? `<p class="note" style="margin:10px 0 0;white-space:pre-line">📝 ${esc(c.note)}</p>` : ''}
      </div>

      ${bd.eligible && !bd.birthday ? `<div class="card bdask" id="bdBox">
        <h3>🎂 Hỏi ngày sinh của khách</h3>
        <p class="dim" style="margin:0 0 10px">Hạng ${esc(t ? t.name : '')} có quà sinh nhật (${esc(bd.gift)}) — trao trong tháng sinh nhật.</p>
        ${oNgaySinh('', null)}
        <button class="btn pri" data-act="saveBday" style="margin-top:10px">Lưu ngày sinh</button>
      </div>` : ''}

      ${pending.length || bd.pending ? `<div class="giftbox${moi.size ? ' flash' : ''}">
        <h3>🎁 Quà chờ trao (${pending.length + (bd.pending ? 1 : 0)})</h3>
        ${bd.pending ? `<div class="item">
          <div class="grow"><b>🎂 ${esc(bd.gift)}</b>
            <div class="sub">Sinh nhật ${ngaySinh(bd.birthday)} — trao trong tháng ${Number(bd.birthday.slice(0, 2))}</div></div>
          <button class="btn sm pri" data-act="giveBday">Đã trao</button>
        </div>` : ''}
        ${pending.map(e => `<div class="item">
          <div class="grow"><b>${esc(e.gift)}</b>
            <div class="sub">${esc(e.pname)} · đạt ở lượt thứ ${e.total}${moi.has(e.pid + '|' + e.seq) ? ' · <b style="color:var(--gift)">vừa đạt</b>' : ''}</div></div>
          <button class="btn sm pri" data-act="give" data-p="${e.pid}" data-s="${e.seq}">Đã trao</button>
        </div>`).join('')}
      </div>` : ''}

      ${dacQuyen}

      ${d.rewards.length ? `<div class="card">${d.rewards.map(p => this.progress(p)).join('<div style="height:14px"></div>')}</div>` : ''}

      </div><div>

      <button class="btn pri" data-act="sellFor" style="margin-bottom:12px">💳 Tính tiền cho khách này</button>

      <div class="card">
        <h3>Hoá đơn ${owner ? '' : 'gần đây'}</h3>
        ${d.visits.length ? `<div class="list">${d.visits.map(v => this.visitRow(v, false)).join('')}</div>`
                          : '<div class="dim">Chưa có lượt nào.</div>'}
        ${owner ? '' : `<p class="dim" style="margin:8px 0 0">Tính tiền nhầm thì mở hoá đơn ở mục Báo cáo, bấm <b>📣 Báo sai</b> — chủ quán sẽ sửa.</p>`}
      </div>

      ${owner ? this.cardOwner(d) : ''}
      </div></div>
    </div>`;
  },

  progress(p){
    const hetHan = p.ended ? ' <span class="badge warn">đã kết thúc</span>' : '';
    /* "Mỗi lần uốn tặng tinh dầu" — một mốc, lặp lại: chấm tròn vô nghĩa. */
    if (p.len === 1){
      return `<b>${esc(p.name)}</b>${hetHan}
        <div class="dim">Mỗi lượt ${esc(kindName(p.kind).toLowerCase())} tặng: ${esc(p.steps[0].gift)} · đã tính ${p.n} lượt</div>`;
    }
    const moc = {};
    p.steps.forEach(s => moc[s.at] = s.gift);
    let dots = '';
    if (p.len <= 20){
      for (let i = 1; i <= p.len; i++)
        dots += `<i class="${i <= p.pos ? 'on' : ''}${moc[i] ? ' g' : ''}" title="${esc(moc[i] || '')}">${moc[i] ? '🎁' : i}</i>`;
    }
    const nx = p.next
      ? `Còn <b>${p.next.need}</b> lần nữa → ${esc(p.next.gift)}`
      : 'Đã nhận đủ các mốc.';
    return `<div class="row"><b class="grow">${esc(p.name)}</b>
        <span class="dim num">${p.cycle > 1 ? 'vòng ' + p.cycle + ' · ' : ''}${p.pos}/${p.len}</span></div>${hetHan}
      ${dots ? `<div class="dots">${dots}</div>` : ''}
      <div class="dim">${nx}</div>`;
  },

  /* "✂︎ Thợ quen: Lạc 12 lần (80%) · Phú 3" — quầy nhìn là biết khách hay
     ngồi ghế ai, để hỏi "hôm nay anh vẫn cắt với Lạc chứ?". */
  thoQuen(ds, tong){
    if (!ds || !ds.length) return '';
    const co = ds.reduce((a, b) => a + b.n, 0) || 1;
    return `<div class="thoquen">✂︎ Thợ quen: ${ds.slice(0, 3).map((b, i) =>
      `<span class="tq${i === 0 ? ' top' : ''}">${esc(b.name)} <b>${b.n}</b>${i === 0 && ds.length > 1 ? ` <i>${Math.round(b.n / co * 100)}%</i>` : ''}</span>`).join('')}
      ${co < tong ? `<span class="dim"> · ${tong - co} lượt chưa ghi thợ</span>` : ''}</div>`;
  },

  visitRow(v, showCustomer){
    const huy = v.void_at !== null && v.void_at !== undefined;
    const src = v.source === 'import' ? 'KiotViet' : '';
    const tra = v.pay_cash && v.pay_transfer ? 'TM + CK' : v.pay_cash ? 'Tiền mặt' : v.pay_transfer ? 'Chuyển khoản' : '';
    return `<div class="item${huy ? ' void' : ''}">
      <div class="grow">
        ${showCustomer ? (v.customer_id
          ? `<button class="link" data-act="open" data-id="${v.customer_id}" style="padding:0">${esc(v.customer_name || '(chưa tên)')}</button>
             <span class="dim num"> ${esc(v.customer_phone || '')}</span><br>`
          : '<span class="dim">Khách lẻ</span><br>') : ''}
        <b>${esc(v.items.map(i => tenMon(i) + (i.qty > 1 ? ' ×' + i.qty : '')).join(', ') || '—')}</b>
        <div class="sub num">${showCustomer ? '' : ngay(v.visit_date) + ' '}${esc(v.visit_time)} · <b>${tien(v.amount)}</b>
          ${v.discount ? ` <span class="dim">(giảm ${tienGon(v.discount)}${v.disc_note ? ' · ' + esc(v.disc_note) : ''})</span>` : ''}
          ${v.tip ? ' · tip ' + tienGon(v.tip) : ''}${tra ? ' · ' + tra : ''}
          ${v.barber_name ? ` · <b class="tho">✂︎ ${esc(v.barber_name)}</b>` : ''}
          ${v.by_name && v.source !== 'import' ? ' · ' + esc(v.by_name) : ''}${src ? ' · ' + src : ''}
          · <span class="dim">${esc(v.code || '')}</span></div>
        ${v.note ? `<div class="sub">📝 ${esc(v.note)}</div>` : ''}
        ${huy ? `<div class="sub" style="color:var(--bad)">Đã huỷ${v.void_by_name ? ' bởi ' + esc(v.void_by_name) : ''}: ${esc(v.void_reason || '')}</div>` : ''}
      </div>
      ${v.mdisc && !huy ? `<span class="badge warn" title="Giảm thêm tay: ${esc(v.mdisc_note || '')}">⚠ giảm tay</span>` : ''}
      ${(v.flags || []).includes('NO_INVOICE') && !huy ? '<span class="badge bad" title="Đối soát không thấy hoá đơn KiotViet nào cùng ngày">không có HĐ</span>' : ''}
      ${!huy && v.pay_cash + v.pay_transfer > 0 ? `<button class="link" data-act="printBill" data-id="${v.id}" title="In hoá đơn">🖨</button>` : ''}
      ${v.can_void && (App.barbers || []).length ? `<select class="vbsel" data-vb="${v.id}" title="Đổi thợ">
        <option value="0">— thợ —</option>
        ${App.barbers.map(b => `<option value="${b.id}"${b.id === v.barber_id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}
      </select>` : ''}
      ${v.can_void ? `<button class="link bad" data-act="void" data-id="${v.id}">Huỷ</button>` : ''}
    </div>`;
  },

  cardOwner(d){
    const c = d.customer, bd = d.bday || {};
    return `${d.bday_given && d.bday_given.length ? `<div class="card"><h3>🎂 Quà sinh nhật đã trao</h3><div class="list">${d.bday_given.map(g => `
      <div class="item"><div class="grow"><b>${esc(g.gift)}</b> <span class="dim">· năm ${g.year}</span>
        <div class="sub">${new Date(g.given_at * 1000).toLocaleString('vi-VN')}${g.by ? ' · ' + esc(g.by) : ''}</div></div>
        <button class="link bad" data-act="ungiveBday" data-year="${g.year}">Hoàn</button></div>`).join('')}</div></div>` : ''}
    <div class="card">
      <h3>Quà đã trao</h3>
      ${d.given && d.given.length ? `<div class="list">${d.given.map(g => `<div class="item">
        <div class="grow"><b>${esc(g.gift)}</b>
          <div class="sub">${esc(g.program)} · lượt ${g.at_count} · ${new Date(g.given_at * 1000).toLocaleString('vi-VN')}${g.by ? ' · ' + esc(g.by) : ''}</div></div>
        <button class="link bad" data-act="ungive" data-id="${g.id}">Hoàn</button></div>`).join('')}</div>`
        : '<div class="dim">Chưa trao quà nào.</div>'}
    </div>
    ${d.aliases && d.aliases.length ? `<div class="card"><h3>Số điện thoại cũ</h3>
      <p class="dim" style="margin:0 0 8px">Hoá đơn KiotViet mang các số này vẫn tính cho khách này; quầy gõ 4 số cuối số cũ vẫn ra.</p>
      <div class="chips" style="flex-wrap:wrap">${d.aliases.map(p => `<span class="chip num">${esc(p)}
        <button class="link bad" data-act="aliasDel" data-phone="${esc(p)}" style="padding:0 0 0 6px">×</button></span>`).join('')}</div></div>` : ''}
    <details class="card" id="mergeBox"${App.ui.mergeOpen ? ' open' : ''}>
      <summary>Gộp khách trùng</summary>
      <p class="dim">Tìm khách kia (tên hoặc số). Mọi lượt ghé, quà đã trao của họ chuyển sang <b>${esc(c.name || 'khách này')}</b>,
        số của họ thành số phụ, rồi họ bị xoá khỏi danh sách.</p>
      <input id="mergeQ" class="inp" placeholder="Tên hoặc số điện thoại khách trùng" autocomplete="off" value="${esc(App.ui.mergeQ || '')}">
      <div id="mergeRes" style="margin-top:10px">${this.mergeResults(App.ui.mergeRows, c.id)}</div>
    </details>
    <details class="card">
      <summary>Sửa thông tin khách</summary>
      <form id="cusEditForm" style="margin-top:12px">
        <div class="field"><label>Tên</label><input name="name" value="${esc(c.name)}"></div>
        <div class="field"><label>Số điện thoại</label><input name="phone" inputmode="tel" value="${esc(c.phone)}"></div>
        <div class="field"><label>Ngày sinh</label>${oNgaySinh(bd.birthday, bd.year, 'bd_')}</div>
        <div class="field"><label>Ghi chú (chỉ chủ quán thấy)</label><textarea name="note">${esc(c.note)}</textarea></div>
        <button class="btn pri" type="submit">Lưu</button>
      </form>
    </details>`;
  },

  mergeResults(rows, selfId){
    if (!rows) return '';
    rows = rows.filter(r => r.id !== selfId);
    if (!rows.length) return '<div class="dim">Không có khách nào khác khớp.</div>';
    return `<div class="list">${rows.map(r => `<div class="item"><div class="grow"><b>${esc(r.name || '(chưa có tên)')}</b>
        <div class="sub num">${esc(r.phone)} · ${r.cuts} lần cắt${r.last ? ' · ghé ' + ngay(r.last) : ''}</div></div>
        ${tierBadge(r.tier)}
        <button class="btn sm" data-act="merge" data-id="${r.id}">Gộp vào đây</button></div>`).join('')}</div>`;
  },

  /* ---------------- bán hàng ---------------- */

  /* Một màn: khách → thợ → dịch vụ → trả tiền. Máy tính thì hai cột:
     trái chọn, phải là hoá đơn đang lập. */
  pos(st, data, q){
    const owner = API.isOwner();
    if (st.done) return this.posDone(st);
    const sv = data.services || [];
    const coTho = (data.barbers || []).length > 0;
    const can = this.posMissing(st, data, q);

    const khach = st.cus ? (st.cus.walkin
      ? `<div class="poscus"><div class="grow"><b>Khách lẻ</b><div class="sub">Không tích hạng, không giảm theo hạng</div></div>
           <button class="chip" data-act="posCusClear">Đổi</button></div>`
      : `<div class="poscus"><div class="grow"><b>${esc(st.cus.name || '(chưa có tên)')}</b> ${tierBadge(st.cus.tier)}
           <div class="sub num">${esc(st.cus.phone)} · ${st.cus.cuts} lần cắt${st.cus.tier && st.cus.tier.disc_pct ? ` · <b style="color:var(--ok)">giảm ${st.cus.tier.disc_pct}%</b>` : ''}</div></div>
           <button class="chip" data-act="open" data-id="${st.cus.id}">Thẻ</button>
           <button class="chip" data-act="posCusClear">Đổi</button></div>
         ${st.cus.gifts && st.cus.gifts.length ? `<div class="giftbox" style="margin:10px 0 0;padding:10px 12px">
           <b style="color:var(--gift)">🎁 Khách có quà chờ trao:</b> ${esc(st.cus.gifts.join(' · '))}
           <div class="dim">Trao xong bấm “Đã trao” ở thẻ khách.</div></div>` : ''}`)
      : st.newCus ? `<form id="posNewCus" class="grid2" autocomplete="off">
           <input class="inp" name="phone" inputmode="tel" placeholder="Số điện thoại (10 số)" value="${esc(st.newPhone || '')}" required>
           <input class="inp" name="name" placeholder="Tên khách" value="${esc(st.newName || '')}" required>
           <button class="btn sm pri" type="submit">Tạo khách</button>
           <button class="btn sm" type="button" data-act="posNewCus">Thôi</button></form>`
      : `<input id="posQ" class="inp posq" placeholder="4 số cuối điện thoại hoặc tên khách   ( / )" value="${esc(st.q || '')}"
               autocomplete="off" inputmode="${/[^\d\s]/.test(st.q || '') ? 'text' : 'numeric'}">
         <div id="posRes">${this.posResults(st)}</div>
         <div class="row" style="margin-top:8px;gap:8px">
           <button class="btn sm" data-act="posNewCus">+ Khách mới</button>
           <button class="btn sm" data-act="posWalkin">Khách lẻ (không lấy số)</button></div>`;

    const lines = st.lines.map((l, i) => {
      const s = sv.find(x => x.id === l.sid);
      if (!s) return '';
      const r = q.lines[i] || {};
      const sp = s.kind === 'product';
      const dsTen = ((data.product_names || {})[s.id] || []);
      return `<div class="pline${l.mdOpen ? ' md' : ''}">
        <div class="grow"><b>${esc(s.name)}</b>
          ${sp ? `<input class="inp pdetail" id="posDt${i}" data-pdetail="${i}" list="pn${s.id}" autocomplete="off"
                   placeholder="Tên sản phẩm (bắt buộc) — vd. Wax Reuzel" value="${esc(l.detail || '')}">
                 <datalist id="pn${s.id}">${dsTen.map(x => `<option value="${esc(x.name)}">${x.price ? tien(x.price) : ''}</option>`).join('')}</datalist>` : ''}
          <div class="sub num">${s.price ? tien(s.price) : `<input class="inp pprice" data-pprice="${i}" data-money inputmode="numeric" placeholder="Nhập giá" value="${soTien(l.price)}">`}
            <span id="pdisc${i}" style="color:var(--${l.mdOpen ? 'warn' : 'ok'})">${r.disc ? ' · −' + tienGon(r.disc) : ''}</span>
            ${l.mdOpen ? '' : `<button class="link mdbtn" data-act="posMd" data-i="${i}">+ giảm thêm</button>`}</div>
          ${l.mdOpen ? `<div class="mdrow"><span>⚠ Giảm thêm</span>
            <input class="inp mini" id="posMd${i}" data-pmd="${i}" data-money inputmode="numeric" placeholder="số tiền" value="${soTien(l.mdisc)}">
            <button class="link bad" data-act="posMd" data-i="${i}" title="Bỏ giảm thêm">✕</button>
            <span class="dim">món này không giảm theo hạng nữa</span></div>` : ''}</div>
        <div class="qty"><button data-act="posQty" data-i="${i}" data-d="-1" aria-label="Bớt">−</button><b class="num">${l.qty}</b>
          <button data-act="posQty" data-i="${i}" data-d="1" aria-label="Thêm">+</button></div>
        <b class="num" id="pnet${i}" style="min-width:76px;text-align:right">${r.net != null ? tien(r.net) : ''}</b>
      </div>`;
    }).join('');

    const tongTra = q.total + st.tipN;
    const tra = st.pay === 'cash' ? `<div class="grid2" style="margin-top:10px">
          <div class="field" style="margin:0"><label>Khách đưa</label>
            <input class="inp" id="posGiven" data-money inputmode="numeric" value="${soTien(st.given)}" placeholder="${soTien(tongTra)}"></div>
          <div class="field" style="margin:0"><label>Trả lại khách</label>
            <div class="change num" id="posChange">${this.posChange(st, tongTra)}</div></div></div>
          <div class="chips" style="margin:8px 0 0">${[tongTra, 200000, 500000, 1000000].filter((v, i, a) => v >= tongTra && a.indexOf(v) === i)
            .map(v => `<button class="chip" data-act="posGivenSet" data-v="${v}">${v === tongTra ? 'Vừa đủ' : tienGon(v)}</button>`).join('')}</div>`
      : st.pay === 'mix' ? `<div class="grid2" style="margin-top:10px">
          <div class="field" style="margin:0"><label>Phần tiền mặt</label>
            <input class="inp" id="posCashPart" data-money inputmode="numeric" value="${soTien(st.cashPart)}"></div>
          <div class="field" style="margin:0"><label>Phần chuyển khoản</label>
            <div class="change num" id="posCkPart">${tien(Math.max(0, tongTra - st.cashPartN))}</div></div></div>` : '';

    return `<div class="wrap poswrap">
      ${head('Bán hàng', false, owner ? `<input type="date" id="posDate" class="inp" style="width:auto;padding:8px" value="${esc(st.date || App.today)}" max="${esc(App.today)}" title="Chủ quán ghi bù ngày cũ được">` : '')}
      ${st.booking ? `<p class="note" style="margin-top:-4px">📅 Tính tiền cho lịch hẹn ${esc(st.bookingLabel || '')} — thanh toán xong lịch tự đánh dấu "đã tính tiền".</p>`
                   : this.posBookings(data.bookings, data.barbers || [])}
      <div class="posgrid"><div>
        <div class="card"><h3>1 · Khách</h3>${khach}</div>
        <div class="card"><h3>2 · Thợ${coTho && !owner ? '' : ' <span class="dim" style="font-weight:400">(không bắt buộc với chủ)</span>'}</h3>
          ${coTho ? `<div class="chips" style="flex-wrap:wrap;margin:0">${data.barbers.map(b => `
            <button class="chip big${st.barber === b.id ? ' on' : ''}" data-act="posBarber" data-id="${b.id}">✂︎ ${esc(b.name)}${st.cus && st.cus.last_barber_id === b.id ? ' <span style="opacity:.7">· lần trước</span>' : ''}</button>`).join('')}</div>`
            : '<div class="dim">Chưa khai thợ — chủ quán thêm ở Thiết lập → Thợ cắt.</div>'}</div>
        <div class="card"><h3>3 · Dịch vụ</h3>
          ${sv.length ? theoNhom(sv.filter(s => s.active), data.groups).map(([g, ds]) => `
            <div class="grphead"><b>${esc(g.code)}</b> ${esc(g.name)}</div>
            <div class="svcs">${ds.map(s => {
              const n = st.lines.filter(l => l.sid === s.id).reduce((a, l) => a + l.qty, 0);
              return `<button class="svc${n ? ' on' : ''}${s.kind === 'cut' ? ' cut' : ''}" data-act="posAdd" data-id="${s.id}"${s.note ? ` data-tip="${esc(s.note)}"` : ''}>
                <b>${esc(s.name)}${s.note ? ' <i class="ti">i</i>' : ''}</b><span>${s.price ? tien(s.price) : 'nhập giá'}${n ? ` · <b style="display:inline">×${n}</b>` : ''}</span></button>`;
            }).join('')}</div>`).join('') : '<div class="dim">Chưa có dịch vụ nào. Chủ quán thêm ở Thiết lập → Dịch vụ.</div>'}
        </div>
      </div><div class="posright">
        <div class="card bill">
          <h3>Hoá đơn</h3>
          ${st.lines.length ? lines : `<div class="dim" style="padding:8px 0">Bấm dịch vụ bên ${window.innerWidth >= 900 ? 'trái' : 'trên'} để thêm vào hoá đơn.</div>`}
          ${(data.promos || []).length ? `<div class="field" style="margin:12px 0 0"><label>Khuyến mãi</label>
            <select class="inp" id="posPromo"><option value="0">— Không —</option>
              ${data.promos.map(p => `<option value="${p.id}"${st.promo === p.id ? ' selected' : ''}>${esc(p.name)} (−${p.kind === 'pct' ? p.value + '%' : tienGon(p.value)})</option>`).join('')}
            </select></div>` : ''}
          <div class="sum">
            <div class="row"><span class="grow">Tổng tiền hàng</span><span class="num" id="posSub">${tien(q.subtotal)}</span></div>
            <div class="row" id="posDiscRow" style="color:var(--ok)${q.discount - q.mdisc ? '' : ';display:none'}"><span class="grow" id="posDiscNote">Giảm · ${esc(q.note)}</span><span class="num" id="posDiscAmt">−${tien(q.discount - q.mdisc)}</span></div>
            ${st.lines.some(l => l.mdOpen) ? `<div class="row" style="color:var(--warn)"><span class="grow">⚠ Giảm thêm tay</span><span class="num" id="posMdAmt">−${tien(q.mdisc)}</span></div>
              <input class="inp mdreason" id="posMdReason" placeholder="Lý do giảm thêm (bắt buộc) — chủ xem lại lúc chốt ca" value="${esc(st.mdReason || '')}">` : ''}
            <div class="row"><span class="grow">Tip cho thợ <span class="dim">(trả thợ ngay trong ngày)</span></span>
              <input class="inp mini" id="posTip" data-money inputmode="numeric" value="${soTien(st.tip)}" placeholder="0"></div>
            <div class="row total"><span class="grow">Khách trả</span><b class="num" id="posTotal">${tien(tongTra)}</b></div>
          </div>
          <div class="paybtns">
            ${[['cash', '💵 Tiền mặt'], ['transfer', '🏦 Chuyển khoản'], ['mix', 'Cả hai']].map(([k, n]) =>
              `<button class="chip big${st.pay === k ? ' on' : ''}" data-act="posPay" data-k="${k}">${n}</button>`).join('')}
          </div>
          ${tra}
          <input class="inp" id="posNote" placeholder="Ghi chú (không bắt buộc)" value="${esc(st.note || '')}" style="margin-top:10px">
          <p class="dim" id="posWarn" style="margin:10px 0 0;color:var(--warn)${can ? '' : ';display:none'}">${esc(can)}</p>
          <button class="btn pri" data-act="posCheckout" style="margin-top:12px" ${can ? 'disabled' : ''}>Thanh toán ${tien(tongTra)}</button>
          ${st.lines.length || st.cus ? `<button class="link" data-act="posReset" style="margin-top:8px">Xoá hoá đơn đang lập</button>` : ''}
        </div>
      </div></div>
    </div>`;
  },

  /* Còn thiếu gì thì nút Thanh toán mờ, và nói rõ thiếu gì. */
  posMissing(st, data, q){
    if (!st.cus) return 'Chọn khách (hoặc bấm Khách lẻ).';
    if (!st.lines.length) return 'Chọn dịch vụ.';
    if (!API.isOwner() && (data.barbers || []).length && !st.barber) return 'Chọn thợ.';
    const sv = data.services || [];
    for (const l of st.lines){
      const s = sv.find(x => x.id === l.sid);
      if (s && s.kind === 'product' && !String(l.detail || '').trim()) return 'Ghi tên sản phẩm cho dòng ' + s.name + '.';
      if (s && !s.price && !(l.price >= 1000)) return 'Nhập giá cho ' + s.name + '.';
    }
    if (q.mdisc > 0 && String(st.mdReason || '').trim().length < 3) return 'Ghi lý do giảm thêm.';
    if (!st.pay) return 'Chọn cách khách trả tiền.';
    const tong = q.total + st.tipN;
    if (st.pay === 'mix' && !(st.cashPartN > 0 && st.cashPartN < tong)) return 'Nhập phần tiền mặt (nhỏ hơn tổng).';
    if (st.pay === 'cash' && st.givenN && st.givenN < tong) return 'Khách đưa chưa đủ.';
    return '';
  },

  posChange(st, tong){
    if (!st.givenN) return '—';
    return st.givenN >= tong ? tien(st.givenN - tong) : '<span style="color:var(--bad)">thiếu ' + tien(tong - st.givenN) + '</span>';
  },

  posResults(st){
    if (st.err) return `<div class="dim" style="margin-top:8px">${esc(st.err)}</div>`;
    if (!st.rows) return '';
    if (!st.rows.length) return `<div class="dim" style="margin-top:8px">Không có khách nào khớp. Khách lần đầu thì bấm <b>Khách mới</b>.</div>`;
    return `<div class="list" style="margin-top:8px">${st.rows.map(r => `
      <button class="item" data-act="posPick" data-id="${r.id}">
        <div class="grow"><b>${esc(r.name || '(chưa có tên)')}</b>
          <div class="sub num">${esc(r.phone)} · ${r.cuts} lần cắt${r.last ? ' · ghé ' + ngayNgan(r.last) : ''}</div></div>
        ${r.pending ? `<span class="badge gift">🎁 ${r.pending}</span>` : ''}
        ${tierBadge(r.tier)}
      </button>`).join('')}</div>`;
  },

  posDone(st){
    const r = st.done, v = r.bill;
    const tra = v.pay_cash && v.pay_transfer ? `Tiền mặt ${tien(v.pay_cash)} + chuyển khoản ${tien(v.pay_transfer)}`
      : v.pay_cash ? 'Tiền mặt' : 'Chuyển khoản';
    return `<div class="wrap" style="max-width:560px">
      <div class="card done">
        <div class="tick">✓</div>
        <h2 style="text-align:center">Đã thanh toán ${tien(v.amount + v.tip)}</h2>
        <p class="dim" style="text-align:center;margin:4px 0 14px">${esc(v.code)} · ${esc(v.customer_name || 'Khách lẻ')} · ${tra}
          ${st.change ? `<br><b style="color:var(--acc);font-size:16px">Trả lại khách ${tien(st.change)}</b>` : ''}</p>
        ${v.tip ? `<div class="note" style="font-size:14px;color:var(--tx)">💵 Lấy <b>${tien(v.tip)}</b> tiền mặt trong tủ đưa tip cho
          <b>${esc(v.barber_name || 'thợ')}</b> — tip trả trong ngày, chốt ca đã tự trừ khoản này.</div>` : ''}
        ${r.new_rewards && r.new_rewards.length ? `<div class="giftbox flash"><h3>🎁 Khách vừa đạt quà</h3>
          ${r.new_rewards.map(e => `<div><b>${esc(e.gift)}</b> <span class="dim">· ${esc(e.program)}</span></div>`).join('')}
          <div class="dim" style="margin-top:6px">Trao quà rồi bấm “Đã trao” trong thẻ khách.</div></div>` : ''}
        ${!(r.new_rewards && r.new_rewards.length) && r.pending ? `<div class="giftbox"><b style="color:var(--gift)">🎁 Khách còn ${r.pending} phần quà chờ trao</b></div>` : ''}
        <div class="grid2">
          <button class="btn" data-act="printBill" data-id="${v.id}">🖨 In hoá đơn</button>
          ${v.customer_id ? `<button class="btn" data-act="open" data-id="${v.customer_id}">Mở thẻ khách</button>` : '<span></span>'}
        </div>
        <button class="btn pri" data-act="posReset" style="margin-top:10px">+ Hoá đơn mới</button>
      </div>
    </div>`;
  },

  /* Hoá đơn in khổ 80mm (máy in nhiệt) — vừa cả khổ A5 nếu in giấy thường. */
  receipt(v, shop){
    const dong = v.items.map(i => `<tr><td>${esc(tenMon(i))}${i.qty > 1 ? ' ×' + i.qty : ''}
        ${i.disc ? `<div class="s">${tien(i.list_price)} − ${tien(i.disc)}</div>` : ''}</td>
      <td class="r">${tien(i.price)}</td></tr>`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(v.code)}</title><style>
      @page{size:80mm auto;margin:4mm}
      body{font:13px/1.45 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#000;margin:0;width:72mm}
      h1{font-size:17px;text-align:center;margin:0 0 2px}.c{text-align:center}.s{font-size:11px;color:#444}
      table{width:100%;border-collapse:collapse;margin:8px 0}td{padding:3px 0;vertical-align:top}.r{text-align:right;white-space:nowrap}
      .t td{border-top:1px dashed #000;padding-top:6px}.b{font-weight:700;font-size:15px}hr{border:0;border-top:1px dashed #000}
    </style></head><body>
      <h1>${esc(shop || '')}</h1>
      <div class="c s">Hoá đơn ${esc(v.code)} · ${ngay(v.visit_date)} ${esc(v.visit_time || '')}</div>
      <hr>
      ${v.customer_id ? `<div>Khách: <b>${esc(v.customer_name || '')}</b> ${esc(v.customer_phone || '')}</div>` : ''}
      ${v.barber_name ? `<div>Thợ: ${esc(v.barber_name)}</div>` : ''}
      <table>${dong}
        <tr class="t"><td>Tổng tiền hàng</td><td class="r">${tien(v.subtotal || v.amount + v.discount)}</td></tr>
        ${v.discount ? `<tr><td>Giảm giá${v.disc_note ? ' (' + esc(v.disc_note.replace(/Giảm thêm:.*$/, 'giảm thêm').replace(/^ · /, '')) + ')' : ''}</td><td class="r">−${tien(v.discount)}</td></tr>` : ''}
        ${v.tip ? `<tr><td>Tip</td><td class="r">${tien(v.tip)}</td></tr>` : ''}
        <tr class="b"><td>Thanh toán</td><td class="r">${tien(v.amount + v.tip)}</td></tr>
        ${v.pay_cash ? `<tr><td>Tiền mặt</td><td class="r">${tien(v.pay_cash)}</td></tr>` : ''}
        ${v.pay_transfer ? `<tr><td>Chuyển khoản</td><td class="r">${tien(v.pay_transfer)}</td></tr>` : ''}
      </table>
      <hr><div class="c">Cảm ơn anh, hẹn gặp lại!</div>
    </body></html>`;
  },

  /* ---------------- báo cáo cuối ngày ---------------- */

  /* Cả quầy lẫn chủ xem: tiền mặt phải có trong két, tiền chuyển khoản
     phải thấy trong tài khoản, mỗi thợ làm bao nhiêu. Số tính từ chính
     danh sách hoá đơn bên dưới — cộng tay lại cũng ra đúng vậy. */
  day(d){
    const owner = API.isOwner();
    const con = d.visits.filter(v => !v.void_at);
    const sum = (arr, k) => arr.reduce((a, v) => a + (v[k] || 0), 0);
    const dt = sum(con, 'amount'), tm = sum(con, 'pay_cash'), ck = sum(con, 'pay_transfer');
    const tip = sum(con, 'tip'), giam = sum(con, 'discount');
    const chuaGhi = con.filter(v => v.pay_cash + v.pay_transfer === 0);

    const tho = new Map();
    con.forEach(v => {
      const k = v.barber_name || '— chưa ghi thợ';
      const t = tho.get(k) || {bill: 0, cut: 0, dt: 0, tip: 0};
      t.bill++; t.dt += v.amount; t.tip += v.tip;
      t.cut += v.items.filter(i => i.kind === 'cut').reduce((a, i) => a + i.qty, 0);
      tho.set(k, t);
    });
    const dv = new Map();
    con.forEach(v => v.items.forEach(i => {
      const t = dv.get(tenMon(i)) || {n: 0, dt: 0};
      t.n += i.qty; t.dt += i.price; dv.set(tenMon(i), t);
    }));
    const homNay = d.date === App.today;
    const giamTay = con.filter(v => v.mdisc > 0);

    return `<div class="wrap">
      ${head(owner ? 'Sổ ngày' : 'Báo cáo hôm nay', false, `${owner
        ? `<input type="date" id="dayPick" class="inp" style="width:auto;padding:8px" value="${esc(d.date)}" max="${esc(App.today)}">`
        : ''}<button class="chip" data-act="reload">↻</button>`)}
      ${!homNay ? `<p class="dim" style="margin-top:-6px">${ngay(d.date)}</p>` : ''}
      <div class="stats">
        <div class="stat"><div class="n">${tienGon(dt)}</div><div class="l">doanh thu · ${con.length} hoá đơn</div></div>
        <div class="stat cash"><div class="n">${tienGon(tm)}</div><div class="l">💵 tiền mặt thu</div></div>
        <div class="stat"><div class="n">${tienGon(ck)}</div><div class="l">🏦 chuyển khoản</div></div>
        <div class="stat"><div class="n">${tienGon(tip)}</div><div class="l">tip${giam ? ' · đã giảm ' + tienGon(giam) : ''}</div></div>
      </div>
      ${chuaGhi.length ? `<p class="note" style="color:var(--warn)">${chuaGhi.length} lượt ghi kiểu cũ chưa có cách trả tiền (${tien(sum(chuaGhi, 'amount'))}) — không tính vào két.</p>` : ''}
      ${this.mdWarn(giamTay)}
      ${this.shift(d, con)}
      <div class="cols">
        ${tho.size ? `<div class="card"><h3>Theo thợ</h3><div class="tblwrap" style="border:0"><table class="tbl" style="font-size:13.5px">
          <thead><tr><th>Thợ</th><th class="r">HĐ</th><th class="r">Lượt cắt</th><th class="r">Doanh thu</th><th class="r">Tip</th></tr></thead>
          <tbody>${[...tho].sort((a, b) => b[1].dt - a[1].dt).map(([k, t]) => `<tr style="cursor:default">
            <td><b>${esc(k)}</b></td><td class="r num">${t.bill}</td><td class="r num">${t.cut}</td>
            <td class="r num">${tien(t.dt)}</td><td class="r num">${t.tip ? tien(t.tip) : ''}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
        ${dv.size ? `<div class="card"><h3>Theo dịch vụ</h3><div class="tblwrap" style="border:0"><table class="tbl" style="font-size:13.5px">
          <thead><tr><th>Dịch vụ</th><th class="r">SL</th><th class="r">Thành tiền</th></tr></thead>
          <tbody>${[...dv].sort((a, b) => b[1].dt - a[1].dt).map(([k, t]) => `<tr style="cursor:default">
            <td>${esc(k)}</td><td class="r num">${t.n}</td><td class="r num">${tien(t.dt)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      </div>
      ${d.gifts.length ? `<div class="card"><h3>Quà đã trao (${d.gifts.length})</h3><div class="list">${d.gifts.map(g => `
        <button class="item" data-act="open" data-id="${g.customer_id}"><div class="grow"><b>${esc(g.gift)}</b>
          <div class="sub">${esc(g.name)} · ${g.time}${g.by ? ' · ' + esc(g.by) : ''}</div></div></button>`).join('')}</div></div>` : ''}
      ${d.missing_reports && d.missing_reports.length ? `<div class="card mdwarn"><h3>📣 Báo thiếu hoá đơn (${d.missing_reports.length})</h3>
        ${this.reportList(d.missing_reports)}</div>` : ''}
      <div class="card"><h3>Hoá đơn (${con.length}${d.visits.length > con.length ? ' · ' + (d.visits.length - con.length) + ' đã huỷ' : ''})</h3>
        ${d.visits.length ? this.billList(d.visits) : '<div class="dim">Chưa có hoá đơn nào.</div>'}
        ${owner ? '' : `<p class="dim" style="margin:10px 0 0">Hoá đơn sai: bấm vào hoá đơn → <b>📣 Báo sai</b>. Quầy không tự huỷ hay sửa được.
          <button class="link" data-act="repOpen" data-k="miss" data-date="${esc(d.date)}" style="padding:0 4px">Báo thiếu hoá đơn</button></p>
          <div id="repmiss"></div>`}
      </div>
    </div>`;
  },

  /* Hoá đơn có giảm thêm tay — gom lên đầu sổ ngày để chủ soát lúc chốt ca. */
  mdWarn(ds){
    if (!ds.length) return '';
    return `<div class="card mdwarn"><h3>⚠ ${ds.length} hoá đơn giảm thêm tay · −${tien(ds.reduce((a, v) => a + v.mdisc, 0))}</h3>
      <div class="list">${ds.map(v => `<div class="item"><div class="grow">
        <b>${esc(v.visit_time || '')} · ${esc(v.customer_name || 'Khách lẻ')}</b> <span class="dim num">${esc(v.code)}</span>
        <div class="sub">${v.items.filter(i => i.mdisc).map(i => `${esc(tenMon(i))}: <s class="dim">${tien(i.list_price * i.qty)}</s> → <b>${tien(i.price)}</b>`).join(' · ')}</div>
        <div class="sub">Lý do: <b>${esc(v.mdisc_note || '—')}</b>${v.by_name ? ' · lập bởi ' + esc(v.by_name) : ''}${v.barber_name ? ' · ✂︎ ' + esc(v.barber_name) : ''}</div>
      </div><b class="num" style="color:var(--warn)">−${tien(v.mdisc)}</b></div>`).join('')}</div>
      <p class="dim" style="margin:8px 0 0">Món giảm thêm không theo hạng hay khuyến mãi — quầy tự gõ số tiền giảm và lý do.</p></div>`;
  },

  /* Danh sách hoá đơn gọn: giờ · khách · SĐT · tiền · thợ. Bấm một dòng
     mới mở chi tiết món, giảm giá, cách trả, người lập. */
  billList(ds){
    return `<div class="blist"><div class="bhead"><span>Giờ</span><span>Khách</span><span>SĐT</span><span class="r">Tiền</span><span>Thợ</span></div>
      ${ds.map(v => this.billRow(v)).join('')}</div>`;
  },

  billRow(v){
    const huy = v.void_at != null;
    const tra = v.pay_cash && v.pay_transfer ? '💵🏦' : v.pay_cash ? '💵' : v.pay_transfer ? '🏦' : '';
    return `<details class="brow${huy ? ' void' : ''}${v.mdisc && !huy ? ' md' : ''}"><summary>
      <span class="bt num">${esc(v.visit_time || '—')}</span>
      <span class="bk">${v.customer_id ? esc(v.customer_name || '(chưa tên)') : '<i class="dim">Khách lẻ</i>'}
        ${huy ? '<span class="badge bad">huỷ</span>' : ''}${v.mdisc && !huy ? '<span class="badge warn">⚠ giảm tay</span>' : ''}${(v.reports || []).some(r => r.status === 'open') ? '<span class="badge bad">📣 báo sai</span>' : ''}</span>
      <span class="bp num dim">${esc(v.customer_phone || '')}</span>
      <span class="ba num"><b>${tien(v.amount)}</b> <small title="${v.pay_cash && v.pay_transfer ? 'Tiền mặt + chuyển khoản' : v.pay_cash ? 'Tiền mặt' : 'Chuyển khoản'}">${tra}</small></span>
      <span class="bb">${v.barber_name ? '✂︎ ' + esc(v.barber_name) : '<span class="dim">—</span>'}</span>
    </summary>${this.billDetail(v)}</details>`;
  },

  billDetail(v){
    const huy = v.void_at != null;
    const dong = v.items.map(i => `<tr${i.mdisc ? ' class="md"' : ''}><td>${esc(i.name)}${i.detail ? `<div class="pdname">${esc(i.detail)}</div>` : ''}</td><td class="r num">${i.qty}</td>
      <td class="r num">${i.list_price ? tien(i.list_price) : ''}</td>
      <td class="r num">${i.disc ? (i.mdisc ? '⚠ ' : '') + '−' + tien(i.disc) : ''}</td><td class="r num"><b>${tien(i.price)}</b></td></tr>`).join('');
    const giamKhac = v.discount - (v.mdisc || 0);
    const noteKhac = (v.disc_note || '').replace(/\s*·?\s*Giảm thêm:.*$/, '');
    return `<div class="bdetail">
      <table class="tbl bitems"><thead><tr><th>Món</th><th class="r">SL</th><th class="r">Đơn giá</th><th class="r">Giảm</th><th class="r">Thành tiền</th></tr></thead>
        <tbody>${dong || '<tr><td colspan="5" class="dim">—</td></tr>'}</tbody></table>
      <div class="bsum">
        ${v.subtotal ? `<div><span>Tổng tiền hàng</span><b class="num">${tien(v.subtotal)}</b></div>` : ''}
        ${giamKhac > 0 ? `<div style="color:var(--ok)"><span>Giảm${noteKhac ? ' · ' + esc(noteKhac) : ''}</span><b class="num">−${tien(giamKhac)}</b></div>` : ''}
        ${v.mdisc ? `<div style="color:var(--warn)"><span>⚠ Giảm thêm tay · ${esc(v.mdisc_note || '')}</span><b class="num">−${tien(v.mdisc)}</b></div>` : ''}
        <div class="t"><span>Hoá đơn</span><b class="num">${tien(v.amount)}</b></div>
        ${v.tip ? `<div><span>Tip cho thợ (trả trong ngày)</span><b class="num">${tien(v.tip)}</b></div>` : ''}
        ${v.pay_cash ? `<div><span>💵 Tiền mặt</span><b class="num">${tien(v.pay_cash)}</b></div>` : ''}
        ${v.pay_transfer ? `<div><span>🏦 Chuyển khoản</span><b class="num">${tien(v.pay_transfer)}</b></div>` : ''}
      </div>
      <div class="sub dim">${esc(v.code || '')} · ${ngay(v.visit_date)} ${esc(v.visit_time || '')}
        ${v.by_name && v.source !== 'import' ? ' · lập bởi ' + esc(v.by_name) : ''}${v.source === 'import' ? ' · nhập từ KiotViet' : ''}</div>
      ${v.note ? `<div class="sub">📝 ${esc(v.note)}</div>` : ''}
      ${huy ? `<div class="sub" style="color:var(--bad)">Đã huỷ${v.void_by_name ? ' bởi ' + esc(v.void_by_name) : ''}: ${esc(v.void_reason || '')}</div>` : ''}
      ${this.reportList(v.reports || [])}
      <div class="row bact">
        ${!huy && v.pay_cash + v.pay_transfer > 0 && !API.isBarber() ? `<button class="chip" data-act="printBill" data-id="${v.id}">🖨 In</button>` : ''}
        ${v.customer_id && !API.isBarber() ? `<button class="chip" data-act="open" data-id="${v.customer_id}">Thẻ khách</button>` : ''}
        ${!API.isOwner() && !huy ? `<button class="chip warnchip" data-act="repOpen" data-id="${v.id}" data-k="${v.id}">📣 ${API.isBarber() && !v.barber_id ? 'Đây là hoá đơn của tôi' : 'Báo sai'}</button>` : ''}
        ${v.can_void && (App.barbers || []).length ? `<select class="vbsel" data-vb="${v.id}" title="Đổi thợ">
          <option value="0">— thợ —</option>
          ${App.barbers.map(b => `<option value="${b.id}"${b.id === v.barber_id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}
        </select>` : ''}
        ${v.can_void ? `<button class="link bad" data-act="void" data-id="${v.id}">Huỷ hoá đơn</button>` : ''}
      </div><div id="rep${v.id}"></div></div>`;
  },

  /* Ô báo sai / báo thiếu — quầy và thợ gửi, chủ quán xử lý. */
  reportForm(vid, date){
    const thoNhan = API.isBarber() && vid && !((App.findBill(vid) || {}).barber_id);
    return `<form class="repForm" data-vid="${vid}" data-date="${esc(date)}">
      ${vid ? '' : `<label class="dim">Ngày</label><input type="date" class="inp" name="date" value="${esc(date || App.today)}" max="${esc(App.today)}" style="width:auto;margin-bottom:6px">`}
      <textarea class="inp" name="note" rows="2" placeholder="${vid ? 'Sai ở đâu? vd: không phải em cắt, thiếu ráy tai, nhầm giá…' : 'Thiếu hoá đơn nào? vd: 14h cắt + ráy tai cho anh Nam, chưa xuất'}">${thoNhan ? 'Hoá đơn này em cắt' : ''}</textarea>
      <button class="btn sm pri" type="submit" style="margin-top:6px">Gửi cho chủ quán</button></form>`;
  },

  reportList(ds){
    if (!ds.length) return '';
    const owner = API.isOwner();
    return `<div class="reps">${ds.map(r => `<div class="rep ${r.status}">
      <div>📣 <b>${esc(r.by || '')}</b> <span class="dim">${new Date(r.at * 1000).toLocaleString('vi-VN', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})}</span>: ${esc(r.note)}</div>
      ${r.status === 'done'
        ? `<div class="ok">✓ Chủ đã xử lý${r.reply ? ': ' + esc(r.reply) : ''}${owner ? ` <button class="link" data-act="repReopen" data-id="${r.id}" style="padding:0 4px">mở lại</button>` : ''}</div>`
        : owner ? `<form class="resForm row" data-id="${r.id}"><input class="inp" name="reply" placeholder="Đã sửa gì? (không bắt buộc)">
                    <button class="btn sm pri" type="submit">✓ Đã xử lý</button></form>`
                : '<div class="dim">⏳ Chờ chủ quán xử lý</div>'}
    </div>`).join('')}</div>`;
  },

  /* Báo sai chờ chủ xử lý — đầu màn Hoá đơn. */
  reportsOpen(ds){
    if (!ds || !ds.length) return '';
    return `<div class="card mdwarn"><h3>📣 ${ds.length} báo sai chờ xử lý</h3>
      ${ds.map(r => r.bill ? `<div class="dim" style="margin-top:8px">${ngay(r.bill.visit_date)}</div><div class="blist">${this.billRow(r.bill)}</div>`
        : `<div class="dim" style="margin-top:8px">${ngay(r.date)} · báo thiếu hoá đơn</div>${this.reportList([r])}`).join('')}
      <p class="dim" style="margin:8px 0 0">Bấm hoá đơn để xem chi tiết, sửa thợ / huỷ nếu cần, rồi bấm "Đã xử lý".</p></div>`;
  },

  /* Hoá đơn chia theo ngày, mỗi ngày một dòng tổng. tong: {ngày: {n, amount}}
     (máy chủ cộng sẵn) — không có thì tự cộng từ danh sách. */
  billDays(rows, tong){
    const thu = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    if (!tong){
      tong = {};
      rows.filter(v => !v.void_at).forEach(v => { const t = tong[v.visit_date] || (tong[v.visit_date] = {n: 0, amount: 0}); t.n++; t.amount += v.amount; });
    }
    let ngayTruoc = '', html = '';
    rows.forEach(v => {
      if (v.visit_date !== ngayTruoc){
        if (ngayTruoc) html += '</div>';
        ngayTruoc = v.visit_date;
        const n = tong[v.visit_date] || {n: 0, amount: 0};
        html += `<div class="dayhead"><b>${thu[new Date(v.visit_date + 'T00:00:00').getDay()]} · ${ngay(v.visit_date)}</b>
          <span class="num">${n.n} HĐ · ${tien(n.amount)}</span></div><div class="blist">
          <div class="bhead"><span>Giờ</span><span>Khách</span><span>SĐT</span><span class="r">Tiền</span><span>Thợ</span></div>`;
      }
      html += this.billRow(v);
    });
    if (ngayTruoc) html += '</div>';
    return html;
  },

  /* ---------------- lịch hẹn ---------------- */

  /* Sổ lịch một ngày: mỗi thợ một cột, trục dọc là giờ. Bấm chỗ trống là
     đặt lịch đúng thợ, đúng giờ đó; bấm một lịch là mở chi tiết. */
  sched(d, ui){
    const cfg = d.cfg, PX = 1.3, H = (cfg.close - cfg.open) * PX;
    const homNay = d.date === App.today;
    const nghiQuan = cfg.closed_days.includes(new Date(d.date + 'T00:00:00').getDay());
    const conHieuLuc = d.rows.filter(b => b.status !== 'cancel' && b.status !== 'noshow');
    const top = m => ((m - cfg.open) * PX).toFixed(1);
    const nhan = [];
    for (let m = Math.ceil(cfg.open / 60) * 60; m < cfg.close; m += 60) nhan.push(m);
    const cot = b => {
      const ds = conHieuLuc.filter(x => x.barber_id === b.id).sort((p, q) => p.start - q.start);
      /* Lịch trùng giờ (quầy bấm "vẫn đặt") thì xếp làn cạnh nhau, không đè lên nhau. */
      const lan = [], cuoi = [];
      ds.forEach(x => { let k = cuoi.findIndex(z => z <= x.start); if (k < 0){ k = cuoi.length; cuoi.push(0); } cuoi[k] = x.start + x.dur; lan.push(k); });
      const soLan = ds.map((x, i) => 1 + Math.max(...ds.map((y, j) => y.start < x.start + x.dur && x.start < y.start + y.dur ? lan[j] : 0)));
      const off = d.off.filter(o => o.barber_id === b.id);
      return `<div class="scol" data-act="schedAt" data-b="${b.id}" style="height:${H}px">
        ${nhan.map(m => `<i class="sline" style="top:${top(m)}px"></i>`).join('')}
        ${off.map(o => { const a = Math.max(o.start, cfg.open), z = Math.min(o.end, cfg.close);
          return z > a ? `<div class="soff" style="top:${top(a)}px;height:${((z - a) * PX).toFixed(1)}px">
            <span>Nghỉ${o.start > 0 || o.end < 1440 ? ' ' + hm(o.start) + '–' + hm(o.end) : ''}${o.note ? ' · ' + esc(o.note) : ''}</span>
            <button class="x" data-act="offDel" data-id="${o.id}" title="Bỏ giờ nghỉ">×</button></div>` : ''; }).join('')}
        ${ds.map((x, i) => `<div class="sbk st-${x.status}${x.confirmed ? '' : ' unconf'}${ui.sel === x.id ? ' sel' : ''}" data-act="schedSel" data-id="${x.id}"
            style="top:${top(Math.max(x.start, cfg.open))}px;height:${Math.max(20, x.dur * PX - 2).toFixed(1)}px;left:calc(${(lan[i] / soLan[i] * 100).toFixed(2)}% + 3px);width:calc(${(100 / soLan[i]).toFixed(2)}% - 6px);right:auto">
          <b>${hm(x.start)}</b> ${esc(x.name || 'Khách')}${x.confirmed ? '' : ' 🌐'}
          <small>${esc(x.services.map(v => v.name).join(', '))}</small></div>`).join('')}
        ${homNay && d.now >= cfg.open && d.now <= cfg.close ? `<i class="snow" style="top:${top(d.now)}px"></i>` : ''}
      </div>`;
    };
    const tt = {booked: '', arrived: 'đang làm', done: 'đã tính tiền', noshow: 'không đến', cancel: 'đã huỷ'};
    const sel = d.rows.find(x => x.id === ui.sel);
    return `<div class="wrap wide-wrap">
      ${this.schedNav(ui, d.date)}
      <p class="dim" style="margin-top:0">${thuCua(d.date)} · ${ngay(d.date)} · ${conHieuLuc.length} lịch hẹn
        ${nghiQuan ? ' · <b style="color:var(--warn)">ngày quán nghỉ</b>' : ''}</p>
      ${d.unconfirmed ? `<p class="note" style="color:var(--warn)">🌐 ${d.unconfirmed} lịch khách tự đặt chưa gọi xác nhận (đánh dấu 🌐 trên lịch).</p>` : ''}
      <div class="row" style="gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <button class="btn sm pri" data-act="bookNew">+ Đặt lịch</button>
        <button class="btn sm" data-act="offNew">Thợ nghỉ</button>
      </div>
      <div id="schedPanel">${ui.form ? this.bookForm(ui.form, d) : ui.off ? this.offForm(ui.off, d) : sel ? this.bookDetail(sel, d) : ''}</div>
      ${d.barbers.length ? `<div class="sgrid" style="grid-template-columns:44px repeat(${d.barbers.length}, minmax(0,1fr))">
        <div></div>${d.barbers.map(b => `<div class="shead">✂︎ ${esc(b.name)} <small>${conHieuLuc.filter(x => x.barber_id === b.id).length}</small></div>`).join('')}
        <div class="stimes" style="height:${H}px">${nhan.map(m => `<span style="top:${top(m)}px">${hm(m)}</span>`).join('')}</div>
        ${d.barbers.map(cot).join('')}
      </div>` : '<div class="card dim">Chưa khai thợ — chủ quán thêm ở Thiết lập → Thợ cắt.</div>'}
      ${d.rows.length ? `<div class="card" style="margin-top:14px"><h3>Danh sách trong ngày</h3><div class="list">${d.rows.map(x => `
        <button class="item${x.status === 'cancel' || x.status === 'noshow' ? ' void' : ''}" data-act="schedSel" data-id="${x.id}">
          <b class="num" style="min-width:92px">${hm(x.start)}–${hm(x.start + x.dur)}</b>
          <div class="grow"><b>${esc(x.name || 'Khách')}</b> ${x.tier ? tierBadge(x.tier) : ''}${x.confirmed ? '' : ' <span class="badge warn">🌐 chưa xác nhận</span>'}
            <div class="sub">${esc(x.services.map(v => v.name).join(', ') || '—')} · ✂︎ ${esc((d.barbers.find(b => b.id === x.barber_id) || {}).name || '?')}${x.any ? ' (ai cũng được)' : ''}</div></div>
          ${tt[x.status] ? `<span class="badge${x.status === 'noshow' || x.status === 'cancel' ? ' bad' : ''}">${tt[x.status]}</span>` : ''}
        </button>`).join('')}</div></div>` : ''}
    </div>`;
  },

  /* Đầu màn Lịch hẹn: Ngày / Tuần / Tháng, lùi / tới, chọn ngày. */
  schedNav(ui, date){
    const nay = App.today;
    const coNay = ui.mode === 'month' ? date.slice(0, 7) === nay.slice(0, 7)
      : ui.mode === 'week' ? App.weekStart(date) === App.weekStart(nay) : date === nay;
    return `${head('Lịch hẹn', false, '<button class="chip" data-act="reload">↻</button>')}
      <div class="schednav">
        <div class="seg">${[['day', 'Ngày'], ['week', 'Tuần'], ['month', 'Tháng']].map(([k, n]) =>
          `<button class="chip${ui.mode === k ? ' on' : ''}" data-act="schedMode" data-k="${k}">${n}</button>`).join('')}</div>
        <button class="chip" data-act="schedDay" data-d="-1" aria-label="Trước">‹</button>
        <input type="date" id="schedDate" class="inp" value="${esc(date)}">
        <button class="chip" data-act="schedDay" data-d="1" aria-label="Sau">›</button>
        ${coNay ? '' : '<button class="chip" data-act="schedDay" data-d="0">Hôm nay</button>'}</div>`;
  },

  /* Lịch tuần / tháng — nhìn trước mấy ngày tới kín tới đâu. Bấm một ngày
     (hay một lịch) là mở lịch ngày đó. */
  schedRange(d, ui){
    const ten = id => (d.barbers.find(b => b.id === id) || {}).name || '?';
    const theoNgay = {};
    d.rows.forEach(b => (theoNgay[b.date] = theoNgay[b.date] || []).push(b));
    const offNgay = {};
    d.off.forEach(o => (offNgay[o.date] = offNgay[o.date] || []).push(o));
    const ngays = [];
    for (let x = new Date(d.from + 'T00:00:00'); App.iso(x) <= d.to; x.setDate(x.getDate() + 1)) ngays.push(App.iso(x));
    const nghi = n => d.cfg.closed_days.includes(new Date(n + 'T00:00:00').getDay());
    const chuaXN = d.rows.filter(b => !b.confirmed && b.status === 'booked').length;
    const tong = `<p class="dim" style="margin-top:0">${ngay(d.from)} → ${ngay(d.to)} · ${d.rows.length} lịch hẹn
      ${chuaXN ? ` · <b style="color:var(--warn)">🌐 ${chuaXN} chưa xác nhận</b>` : ''}</p>`;

    if (ui.mode === 'week'){
      return `<div class="wrap">${this.schedNav(ui, ui.date)}${tong}
        <div class="week">${ngays.map(n => {
          const ds = theoNgay[n] || [], os = offNgay[n] || [];
          const dem = d.barbers.map(b => [b, ds.filter(x => x.barber_id === b.id).length]);
          return `<div class="wday${n === App.today ? ' today' : ''}${nghi(n) ? ' closed' : ''}">
            <button class="whead" data-act="schedGo" data-d="${n}"><b>${thuCua(n)} ${ngayNgan(n)}</b>
              <span>${ds.length ? ds.length + ' lịch' : nghi(n) ? 'nghỉ' : 'trống'}</span></button>
            <div class="wcount">${dem.map(([b, k]) => `<span>✂︎ ${esc(b.name.split(' ').pop())} <b>${k}</b></span>`).join('')}</div>
            ${os.map(o => `<div class="woff">${esc(ten(o.barber_id).split(' ').pop())} nghỉ ${o.start > 0 || o.end < 1440 ? hm(o.start) + '–' + hm(o.end) : 'cả ngày'}</div>`).join('')}
            ${ds.map(b => `<button class="wbk${b.confirmed ? '' : ' unconf'}${b.status === 'done' ? ' done' : ''}" data-act="schedGo" data-d="${n}" data-id="${b.id}">
              <b>${hm(b.start)}</b> ${esc(b.name || 'Khách')}${b.confirmed ? '' : ' 🌐'}
              <small>✂︎ ${esc(ten(b.barber_id).split(' ').pop())} · ${esc(b.services.map(v => v.name).join(', ') || '—')}</small></button>`).join('')}
          </div>`; }).join('')}</div></div>`;
    }

    /* Tháng: lịch 7 cột, mỗi ô số lịch hẹn theo từng thợ. */
    const thang = ui.date.slice(0, 7);
    return `<div class="wrap">${this.schedNav(ui, ui.date)}
      <p class="dim" style="margin-top:0">Tháng ${thang.slice(5)}/${thang.slice(0, 4)} · ${d.rows.filter(b => b.date.slice(0, 7) === thang).length} lịch hẹn
        ${chuaXN ? ` · <b style="color:var(--warn)">🌐 ${chuaXN} chưa xác nhận</b>` : ''}</p>
      <div class="month">${['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(t => `<div class="mhd">${t}</div>`).join('')}
        ${ngays.map(n => {
          const ds = theoNgay[n] || [], ngoai = n.slice(0, 7) !== thang;
          const cho = ds.filter(b => !b.confirmed && b.status === 'booked').length;
          return `<button class="mday${ngoai ? ' out' : ''}${n === App.today ? ' today' : ''}${nghi(n) ? ' closed' : ''}${n < App.today ? ' past' : ''}" data-act="schedGo" data-d="${n}">
            <span class="mn">${Number(n.slice(8))}</span>
            ${ds.length ? `<b class="mc">${ds.length}</b>` : ''}${cho ? '<i class="mu">🌐</i>' : ''}
            ${ds.length ? `<span class="mb">${d.barbers.map(b => { const k = ds.filter(x => x.barber_id === b.id).length;
              return k ? `<em>${esc(b.name.split(' ').pop().slice(0, 4))} ${k}</em>` : ''; }).join('')}</span>` : ''}
            ${(offNgay[n] || []).length ? '<span class="mo">có thợ nghỉ</span>' : ''}
          </button>`; }).join('')}</div></div>`;
  },

  bookDetail(b, d){
    const tho = (d.barbers.find(x => x.id === b.barber_id) || {}).name || '?';
    const goi = /^\d{10}$/.test(b.phone || '');
    const nut = (act, ten, cls) => `<button class="btn sm${cls ? ' ' + cls : ''}" data-act="${act}" data-id="${b.id}">${ten}</button>`;
    return `<div class="card bkdetail">
      <div class="row"><h3 class="grow" style="margin:0">${hm(b.start)}–${hm(b.start + b.dur)} · ✂︎ ${esc(tho)}${b.any ? ' <span class="dim">(khách không kén thợ)</span>' : ''}</h3>
        <button class="x" data-act="schedClose" aria-label="Đóng">×</button></div>
      <div style="margin-top:8px"><b style="font-size:16px">${esc(b.name || 'Khách')}</b> ${b.tier ? tierBadge(b.tier) : ''}
        ${b.phone ? (goi ? ` · <a href="tel:${esc(b.phone)}" class="num">${esc(b.phone)}</a>` : ` · <span class="num dim">${esc(b.phone)}</span>`) : ''}</div>
      <div class="sub" style="margin-top:4px">${esc(b.services.map(v => v.name).join(', ') || 'Chưa chọn dịch vụ')} · ${b.dur} phút</div>
      ${b.note ? `<div class="sub">📝 ${esc(b.note)}</div>` : ''}
      <div class="sub dim">${b.source === 'online' ? '🌐 Khách tự đặt online' : 'Quầy đặt' + (b.by ? ' · ' + esc(b.by) : '')}
        ${b.cancel_note ? ' · ' + esc(b.cancel_note) : ''}</div>
      ${b.confirmed ? '' : `<p class="note" style="color:var(--warn);margin:10px 0 0">🌐 Khách tự đặt — gọi số trên để xác nhận rồi bấm "Đã gọi xác nhận".</p>`}
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:12px">
        ${b.status === 'booked' ? (b.confirmed ? '' : nut('bookConfirm', '✓ Đã gọi xác nhận', 'pri'))
          + nut('bookToPos', '💳 Khách đến — tính tiền', b.confirmed ? 'pri' : '') + nut('bookEdit', 'Sửa giờ / thợ')
          + nut('bookNoshow', 'Không đến') + nut('bookCancel', 'Huỷ lịch', 'bad') : ''}
        ${b.status === 'arrived' ? nut('bookToPos', '💳 Tính tiền', 'pri') + nut('bookEdit', 'Sửa') + nut('bookBack', 'Chưa đến') : ''}
        ${b.status === 'noshow' || b.status === 'cancel' ? nut('bookBack', 'Đặt lại như cũ') : ''}
        ${b.status === 'done' ? '<span class="badge">✓ Đã tính tiền</span>' : ''}
      </div></div>`;
  },

  /* Form đặt / sửa lịch. f giữ mọi thứ đang chọn (App.sched.form). */
  bookForm(f, d){
    const khach = f.customer
      ? `<div class="poscus"><div class="grow"><b>${esc(f.customer.name || '(chưa tên)')}</b> ${tierBadge(f.customer.tier)}
           <div class="sub num">${esc(f.customer.phone || '')}</div></div>
           <button class="chip" data-act="bkCusClear">Đổi</button></div>`
      : f.keepCus ? `<div class="poscus"><div class="grow"><b>${esc(f.name)}</b><div class="sub num">${esc(f.phone || '')}</div></div>
           <button class="chip" data-act="bkCusClear">Đổi</button></div>`
      : `<input id="bkQ" class="inp" placeholder="Tra khách quen: 4 số cuối hoặc tên" value="${esc(f.q || '')}" autocomplete="off">
         <div id="bkRes">${this.bkResults(f)}</div>
         <div class="grid2" style="margin-top:8px">
           <input class="inp" id="bkName" placeholder="Hoặc khách mới: tên" value="${esc(f.name || '')}">
           <input class="inp" id="bkPhone" inputmode="tel" placeholder="Số điện thoại (không bắt buộc)" value="${esc(f.phone || '')}"></div>`;
    const chon = new Set(f.services);
    const durs = []; for (let m = 15; m <= 240; m += 15) durs.push(m);
    return `<div class="card bkform"><div class="row"><h3 class="grow" style="margin:0">${f.id ? 'Sửa lịch hẹn' : 'Đặt lịch mới'}</h3>
        <button class="x" data-act="schedClose" aria-label="Đóng">×</button></div>
      <label class="flabel">Khách</label>${khach}
      <label class="flabel">Dịch vụ</label>
      <div class="chips wrapchips">${d.services.map(v => `<button class="chip${chon.has(v.id) ? ' on' : ''}" data-act="bkSvc" data-id="${v.id}">${esc(v.name)} <span style="opacity:.7">${v.duration ? v.duration + "'" : ''}</span></button>`).join('')}</div>
      <div class="grid2">
        <div><label class="flabel">Thời gian làm</label><select class="inp" id="bkDur">${durs.map(m =>
          `<option value="${m}"${m === f.dur ? ' selected' : ''}>${m < 60 ? m + ' phút' : Math.floor(m / 60) + ' giờ' + (m % 60 ? ' ' + m % 60 + "'" : '')}</option>`).join('')}</select></div>
        <div><label class="flabel">Ngày</label><input type="date" class="inp" id="bkDate" value="${esc(f.date)}"></div>
      </div>
      <label class="flabel">Thợ</label>
      <div class="chips wrapchips">${[{id: 0, name: 'Ai cũng được'}].concat(d.barbers).map(b =>
        `<button class="chip${f.barber_id === b.id ? ' on' : ''}" data-act="bkBarber" data-id="${b.id}">${b.id ? '✂︎ ' : ''}${esc(b.name)}</button>`).join('')}</div>
      <label class="flabel">Giờ <span class="dim" style="font-weight:400">— giờ còn trống của ${f.barber_id ? 'thợ này' : 'ít nhất một thợ'}</span></label>
      <div id="bkSlots">${this.bkSlots(f)}</div>
      <input class="inp" id="bkNote" placeholder="Ghi chú (vd. uốn con sâu, khách đi 2 người)" value="${esc(f.note || '')}" style="margin-top:10px">
      ${f.busy ? `<p class="note" style="color:var(--warn);margin:10px 0 0">${esc(f.busy)}</p>` : ''}
      <div class="row" style="gap:8px;margin-top:12px">
        <button class="btn pri" data-act="bkSave">${f.id ? 'Lưu thay đổi' : 'Đặt lịch'} ${f.start != null ? hm(f.start) : ''}</button>
        ${f.busy ? '<button class="btn" data-act="bkSave" data-force="1">Vẫn đặt (trùng giờ)</button>' : ''}
      </div></div>`;
  },

  bkResults(f){
    if (f.err) return `<div class="dim" style="margin-top:6px">${esc(f.err)}</div>`;
    if (!f.rows) return '';
    if (!f.rows.length) return '<div class="dim" style="margin-top:6px">Không thấy — nhập tên / số khách mới ở dưới.</div>';
    return `<div class="list" style="margin-top:6px">${f.rows.slice(0, 8).map(r => `<button class="item" data-act="bkPick" data-id="${r.id}">
      <div class="grow"><b>${esc(r.name || '(chưa có tên)')}</b><div class="sub num">${esc(r.phone)} · ${r.cuts} lần cắt</div></div>${tierBadge(r.tier)}</button>`).join('')}</div>`;
  },

  bkSlots(f){
    if (!f.slots) return '<div class="dim">Đang tìm giờ trống…</div>';
    const ds = f.slots.map(x => x[0]);
    const ngoai = f.start != null && !ds.includes(f.start);
    return `<div class="chips wrapchips slotchips">${ds.map(t =>
      `<button class="chip${f.start === t ? ' on' : ''}" data-act="bkTime" data-t="${t}">${hm(t)}</button>`).join('')
      || '<span class="dim">Ngày này không còn giờ trống.</span>'}</div>
      <div class="row" style="gap:8px;margin-top:6px"><span class="dim">Giờ khác:</span>
        <input type="time" class="inp" id="bkTime" step="300" style="width:auto;padding:6px" value="${f.start != null ? hm(f.start) : ''}">
        ${ngoai ? '<span style="color:var(--warn);font-size:13px">giờ này đang kín</span>' : ''}</div>`;
  },

  offForm(o, d){
    return `<div class="card bkform"><div class="row"><h3 class="grow" style="margin:0">Thợ nghỉ</h3>
        <button class="x" data-act="schedClose" aria-label="Đóng">×</button></div>
      <form id="offForm" class="grid2" style="margin-top:10px">
        <div><label class="flabel">Thợ</label><select class="inp" name="barber_id">${d.barbers.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>
        <div><label class="flabel">Ngày</label><input type="date" class="inp" name="date" value="${esc(o.date)}"></div>
        <div><label class="flabel">Từ (để trống = cả ngày)</label><input type="time" class="inp" name="start" step="900"></div>
        <div><label class="flabel">Đến</label><input type="time" class="inp" name="end" step="900"></div>
        <input class="inp" name="note" placeholder="Lý do (không bắt buộc)" style="grid-column:1/-1">
        <button class="btn pri" type="submit" style="grid-column:1/-1">Lưu giờ nghỉ</button>
      </form></div>`;
  },

  /* Đầu màn Bán hàng: lịch hẹn hôm nay chưa xong. */
  posBookings(ds, barbers){
    if (!ds || !ds.length) return '';
    const ten = id => (barbers.find(b => b.id === id) || {}).name || '';
    return `<div class="card posbk"><h3>📅 Lịch hẹn hôm nay (${ds.length})</h3><div class="list">${ds.slice(0, 6).map(b => `
      <div class="item"><b class="num">${hm(b.start)}</b><div class="grow"><b>${esc(b.name || 'Khách')}</b>${b.confirmed ? '' : ' 🌐'}
        <div class="sub">${esc(b.services.map(v => v.name).join(', '))} · ✂︎ ${esc(ten(b.barber_id))}</div></div>
        ${b.status === 'arrived' ? '<span class="badge">đang làm</span>' : ''}
        <button class="chip" data-act="bookToPos" data-id="${b.id}">${b.status === 'arrived' ? 'Tính tiền' : 'Khách đến'}</button></div>`).join('')}</div></div>`;
  },

  /* Tài khoản thợ: lịch hẹn của mình 7 ngày tới. */
  bookMine(d){
    const ngayDs = [...new Set(d.rows.map(b => b.date).concat(d.off.map(o => o.date)))].sort();
    return `<div class="wrap">
      ${head('Lịch hẹn của tôi', false, '<button class="chip" data-act="reload">↻</button>')}
      ${ngayDs.length ? ngayDs.map(n => `<div class="card"><h3>${thuCua(n)} · ${ngay(n)}${n === App.today ? ' · hôm nay' : ''}</h3>
        ${d.off.filter(o => o.date === n).map(o => `<p class="note" style="margin:0 0 8px">Nghỉ ${o.start > 0 || o.end < 1440 ? hm(o.start) + '–' + hm(o.end) : 'cả ngày'}${o.note ? ' · ' + esc(o.note) : ''}</p>`).join('')}
        <div class="list">${d.rows.filter(b => b.date === n).map(b => `<div class="item${b.status === 'done' ? ' void' : ''}">
          <b class="num" style="min-width:92px">${hm(b.start)}–${hm(b.start + b.dur)}</b>
          <div class="grow"><b>${esc(b.name || 'Khách')}</b> <span class="dim num">${esc(b.phone || '')}</span>
            <div class="sub">${esc(b.services.map(v => v.name).join(', '))}${b.note ? ' · 📝 ' + esc(b.note) : ''}</div></div>
          ${b.status === 'done' ? '<span class="badge">xong</span>' : b.status === 'arrived' ? '<span class="badge">đang làm</span>' : ''}</div>`).join('')}</div></div>`).join('')
        : '<div class="card dim">7 ngày tới chưa có lịch hẹn nào.</div>'}
    </div>`;
  },

  /* Thiết lập → Đặt lịch. */
  bookSet(c){
    const link = location.origin + location.pathname.replace(/[^/]*$/, '') + 'datlich.html';
    return `<div class="wrap">
      ${head('Đặt lịch', true)}
      <div class="card"><h3>Link cho khách tự đặt</h3>
        <div class="row" style="gap:8px;flex-wrap:wrap"><code class="grow" id="bookLink" style="word-break:break-all">${esc(link)}</code>
          <button class="btn sm" data-act="copyLink">Chép link</button><a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener">Mở thử</a></div>
        <p class="dim" style="margin:8px 0 0">Gắn vào trang Facebook, Zalo OA, Google Maps, bio Instagram. Khách tự đặt thì lịch hiện 🌐 —
          quầy gọi xác nhận rồi bấm "Đã gọi xác nhận".</p></div>
      <form id="bookSetForm" class="card"><h3>Giờ & luật đặt lịch</h3>
        <div class="grid2">
          <div><label class="flabel">Mở cửa</label><input type="time" class="inp" name="open" value="${hm(c.open)}"></div>
          <div><label class="flabel">Đóng cửa (lịch phải xong trước giờ này)</label><input type="time" class="inp" name="close" value="${hm(c.close)}"></div>
          <div><label class="flabel">Bước giờ</label><select class="inp" name="step">${[15, 30].map(x => `<option value="${x}"${c.step === x ? ' selected' : ''}>${x} phút</option>`).join('')}</select></div>
          <div><label class="flabel">Khách đặt trước tối đa</label><input class="inp" type="number" name="days" min="1" max="60" value="${c.days}"> </div>
          <div><label class="flabel">Khách phải đặt trước ít nhất (phút)</label><input class="inp" type="number" name="notice" min="0" max="1440" step="15" value="${c.notice}"></div>
          <div><label class="flabel">Không đến bao nhiêu lần thì chặn tự đặt</label><input class="inp" type="number" name="noshow_block" min="1" max="10" value="${c.noshow_block}"></div>
        </div>
        <label class="flabel">Ngày quán nghỉ trong tuần</label>
        <div class="chips wrapchips">${[1, 2, 3, 4, 5, 6, 0].map(k => `<label class="chip"><input type="checkbox" name="cd" value="${k}"${c.closed_days.includes(k) ? ' checked' : ''}> ${THU[k]}</label>`).join('')}</div>
        <label class="flabel">Lời nhắn trên trang đặt lịch</label>
        <textarea class="inp" name="msg" rows="2" placeholder="vd. Đến trễ quá 15 phút lịch sẽ tự huỷ. Uốn / nhuộm vui lòng gọi trước.">${esc(c.msg)}</textarea>
        <label class="check" style="margin-top:10px"><input type="checkbox" name="online"${c.online ? ' checked' : ''}> Cho khách tự đặt qua link</label>
        <button class="btn pri" type="submit" style="margin-top:12px">Lưu</button>
      </form>
      <p class="dim">Thời gian làm từng dịch vụ và dịch vụ nào cho khách tự đặt: sửa ở Thiết lập → Dịch vụ & giá.</p>
    </div>`;
  },

  /* Thiết lập → Sao lưu. */
  backup(d){
    const l = d.last;
    const kb = n => (n / 1024).toLocaleString('vi-VN', {maximumFractionDigits: 0}) + ' KB';
    return `<div class="wrap">
      ${head('Sao lưu dữ liệu', true)}
      <div class="card ${l && l.ok && !l.error ? '' : 'mdwarn'}"><h3>Lần sao lưu gần nhất</h3>
        ${l ? `<div><b>${new Date(l.at * 1000).toLocaleString('vi-VN')}</b> · ${l.ok ? esc(l.name) + ' · ' + kb(l.size) : 'không thành công'}
          ${l.mailed ? ' · <span style="color:var(--ok)">✓ đã gửi Gmail</span>' : ''}</div>
          ${l.error ? `<p style="color:var(--bad);margin:6px 0 0">${esc(l.error)}</p>` : ''}` : '<div style="color:var(--warn)">Chưa sao lưu lần nào.</div>'}
        <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="btn sm pri" data-act="backupNow">Sao lưu ${d.mail_ready ? '& gửi Gmail ' : ''}ngay</button>
          ${d.files.length ? `<button class="btn sm" data-act="backupGet" data-name="${esc(d.files[0].name)}">⬇ Tải bản mới nhất</button>` : ''}
        </div></div>
      <div class="card"><h3>Cài đặt gửi Gmail ${d.mail_ready && d.locked ? '<span class="badge" style="color:var(--ok)">✓ đã cài</span>' : '<span class="badge warn">chưa xong</span>'}</h3>
        <ol class="steps">
          <li class="${d.locked ? 'ok' : ''}">Mật khẩu khoá tệp sao lưu (<code>MH_BACKUP_PASS</code>) ${d.locked ? '✓' : '— chưa đặt'}</li>
          <li class="${d.mail_ready ? 'ok' : ''}">Gmail gửi + Mật khẩu ứng dụng (<code>MH_SMTP_USER</code>, <code>MH_SMTP_PASS</code>), nơi nhận (<code>MH_BACKUP_TO</code>) ${d.mail_ready ? '✓ → ' + esc(d.to) : '— chưa đặt'}</li>
        </ol>
        <details><summary class="link" style="padding:0">Xem hướng dẫn từng bước</summary>
          <ol class="guide">
            <li>Vào <b>myaccount.google.com → Bảo mật</b>, bật <b>Xác minh 2 bước</b> (nếu chưa bật).</li>
            <li>Tìm <b>"Mật khẩu ứng dụng"</b> (App passwords), tạo một mật khẩu tên "Hoi vien" → Google cho 16 chữ cái. Chép lại.</li>
            <li>Trên Hostinger, mở <b>Trình quản lý tệp</b> → thư mục <code>memberhub-data</code> → sửa <code>config.php</code>, thêm:
              <pre>define('MH_BACKUP_TO',   'gmail-nhận@gmail.com');
define('MH_SMTP_USER',   'gmail-gửi@gmail.com');
define('MH_SMTP_PASS',   '16 chữ vừa tạo');
define('MH_BACKUP_PASS', 'mật khẩu mở tệp — ghi ra giấy');</pre></li>
            <li>Quay lại đây bấm <b>Sao lưu & gửi Gmail ngay</b> — vài giây sau kiểm hộp thư.</li>
            <li>Hostinger → <b>Nâng cao → Cron Jobs</b> → tạo lệnh chạy <b>mỗi ngày lúc 23:30</b>:
              <pre>${esc(d.cron)}</pre></li>
          </ol>
          <p class="dim">Mở tệp sao lưu: dùng 7-Zip (Windows) hoặc Keka (Mac), nhập mật khẩu khoá tệp. Khi cần khôi phục, gửi tệp cho người cài app.</p>
        </details></div>
      ${d.files.length ? `<div class="card"><h3>Các bản trên máy chủ (giữ 30 bản gần nhất)</h3><div class="list">${d.files.map(f => `
        <div class="item"><div class="grow"><b class="num">${esc(f.name)}</b><div class="sub">${new Date(f.at * 1000).toLocaleString('vi-VN')} · ${kb(f.size)}</div></div>
          <button class="chip" data-act="backupGet" data-name="${esc(f.name)}">⬇ Tải</button></div>`).join('')}</div></div>` : ''}
    </div>`;
  },

  /* ---------------- tài khoản thợ ---------------- */
  mine(d){
    const con = d.rows.filter(v => !v.void_at);
    const mon = new Map();
    con.forEach(v => v.items.forEach(i => { const t = mon.get(i.name) || {n: 0, dt: 0}; t.n += i.qty; t.dt += i.price; mon.set(i.name, t); }));
    const nay = App.today.slice(0, 7);
    const truoc = (() => { const [y, m] = d.month.split('-').map(Number); return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0'); })();
    const sau = (() => { const [y, m] = d.month.split('-').map(Number); return m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0'); })();
    return `<div class="wrap">
      ${head('Hoá đơn của tôi', false, `<button class="chip" data-act="mineMonth" data-m="${truoc}">‹</button>
        <input type="month" id="mineMonth" class="inp" style="width:auto;padding:8px" value="${esc(d.month)}" max="${esc(nay)}">
        ${d.month < nay ? `<button class="chip" data-act="mineMonth" data-m="${sau}">›</button>` : ''}`)}
      <p class="dim" style="margin-top:-6px">✂︎ ${esc(d.barber)} · tháng ${esc(d.month.slice(5))}/${esc(d.month.slice(0, 4))}.
        Soát lại từng hoá đơn — thiếu hay sai thì bấm <b>📣 Báo sai</b> trong hoá đơn, hoặc báo thiếu ở cuối trang.</p>
      <div class="stats">
        <div class="stat"><div class="n">${con.length}</div><div class="l">hoá đơn</div></div>
        <div class="stat"><div class="n">${con.reduce((a, v) => a + v.items.filter(i => i.kind === 'cut').reduce((b, i) => b + i.qty, 0), 0)}</div><div class="l">lượt cắt</div></div>
        <div class="stat"><div class="n">${tienGon(con.reduce((a, v) => a + v.amount, 0))}</div><div class="l">doanh thu</div></div>
        <div class="stat"><div class="n">${tienGon(con.reduce((a, v) => a + v.tip, 0))}</div><div class="l">tip đã nhận</div></div>
      </div>
      ${mon.size ? `<div class="card"><h3>Đếm theo món</h3><div class="tblwrap" style="border:0"><table class="tbl" style="font-size:13.5px">
        <thead><tr><th>Món</th><th class="r">SL</th><th class="r">Thành tiền</th></tr></thead>
        <tbody>${[...mon].sort((a, b) => b[1].n - a[1].n).map(([k, t]) => `<tr style="cursor:default"><td>${esc(k)}</td>
          <td class="r num">${t.n}</td><td class="r num">${tien(t.dt)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      <div class="card" style="padding-top:4px">${d.rows.length ? this.billDays(d.rows) : '<p class="dim">Tháng này chưa có hoá đơn nào ghi tên bạn.</p>'}</div>
      ${d.unassigned.length ? `<details class="card"><summary><b>Hoá đơn chưa ghi thợ (${d.unassigned.length})</b>
        <span class="dim"> — có hoá đơn của bạn thì mở ra, bấm "Đây là hoá đơn của tôi"</span></summary>
        ${this.billDays(d.unassigned)}</details>` : ''}
      <div class="card"><h3>📣 Báo thiếu hoá đơn</h3>
        <p class="dim" style="margin-top:0">Cắt cho khách mà không thấy hoá đơn ở trên (quầy quên xuất)? Ghi lại để chủ quán kiểm tra.</p>
        ${this.reportForm(0, App.today)}</div>
      ${d.reports.length ? `<div class="card"><h3>Những lần đã báo (${d.reports.length})</h3>
        ${d.reports.map(r => `<div class="dim" style="margin-top:6px">${ngay(r.date)}${r.visit_id ? ' · hoá đơn' : ' · thiếu hoá đơn'}</div>${this.reportList([r])}`).join('')}</div>` : ''}
    </div>`;
  },

  /* ---------------- sổ hoá đơn ---------------- */
  bills(st, d){
    const chon = (id, ds, val) => `<select class="inp" id="${id}">${ds.map(([k, n]) =>
      `<option value="${k}"${String(val) === String(k) ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
    return `<div class="wrap">
      ${head('Hoá đơn', false, '<button class="chip" data-act="reload">↻</button>')}
      <div class="card bfilt">
        <div class="chips" style="margin:0 0 10px">${[['today', 'Hôm nay'], ['yday', 'Hôm qua'], ['7d', '7 ngày'], ['month', 'Tháng này'], ['pmonth', 'Tháng trước']]
          .map(([k, n]) => `<button class="chip${st.preset === k ? ' on' : ''}" data-act="billsPreset" data-k="${k}">${n}</button>`).join('')}</div>
        <div class="bfrow">
          <label class="bdate"><input type="date" class="inp" id="bFrom" value="${esc(d.from)}" max="${esc(App.today)}"> →
            <input type="date" class="inp" id="bTo" value="${esc(d.to)}" max="${esc(App.today)}"></label>
          <input class="inp" id="bQ" placeholder="Mã HĐ, tên / SĐT khách, tên món…" value="${esc(st.q)}" autocomplete="off">
        </div>
        <div class="bfrow sel">
          ${chon('bBarber', [['', 'Mọi thợ'], ...d.barbers.map(b => [b.id, b.name + (b.active ? '' : ' (nghỉ)')]), ['none', 'Chưa ghi thợ']], st.barber)}
          ${chon('bOnly', [['', 'Mọi hoá đơn'], ['report', '📣 Có báo sai chưa xử lý'], ['mdisc', '⚠ Có giảm thêm tay'], ['disc', 'Có giảm giá'], ['tip', 'Có tip'], ['walkin', 'Khách lẻ'], ['void', 'Đã huỷ']], st.only)}
          ${chon('bPay', [['', 'Mọi cách trả'], ['cash', '💵 Tiền mặt'], ['transfer', '🏦 Chuyển khoản'], ['mix', 'Cả hai']], st.pay)}
          ${chon('bSrc', [['', 'App + KiotViet'], ['app', 'Lập trên app'], ['import', 'Nhập từ KiotViet']], st.src)}
        </div>
      </div>
      <div id="billsBody">${this.billsBody(d)}</div>
    </div>`;
  },

  billsBody(d){
    const t = d.totals, html = this.billDays(d.rows, d.days);
    return `${this.reportsOpen(d.reports_open)}
      <div class="stats">
        <div class="stat"><div class="n">${tien(t.amount)}</div><div class="l">doanh thu · ${t.n} hoá đơn</div></div>
        <div class="stat cash"><div class="n">${tien(t.cash)}</div><div class="l">💵 tiền mặt (gồm tip)</div></div>
        <div class="stat"><div class="n">${tien(t.transfer)}</div><div class="l">🏦 chuyển khoản (gồm tip)</div></div>
        <div class="stat"><div class="n">${tien(t.discount)}</div><div class="l">đã giảm${t.mdisc_n ? ` · <b style="color:var(--warn)">⚠ ${t.mdisc_n} HĐ giảm tay ${tienGon(t.mdisc)}</b>` : ''}${t.tip ? ' · tip ' + tienGon(t.tip) : ''}</div></div>
      </div>
      ${t.void_n ? `<p class="dim" style="margin:-4px 0 10px">${t.void_n} hoá đơn đã huỷ trong khoảng này (không cộng vào tiền).</p>` : ''}
      ${d.rows.length ? `<div class="card" style="padding-top:4px">${html}</div>` : '<div class="card dim">Không có hoá đơn nào khớp.</div>'}
      ${d.more ? `<button class="btn" data-act="billsMore" style="margin-top:10px">Xem thêm hoá đơn cũ hơn</button>` : ''}`;
  },

  /* Chốt ca — 4 khung theo thứ tự quầy làm cuối ngày:
       ① tiền trong tủ lúc mở ca
       ② thu trong ngày (tiền mặt vào tủ, chuyển khoản vào tài khoản)
       ③ chi ra từ tủ: tip trả thợ, ngoài luồng (mua đá…)
       ④ đếm tủ, so với số phải có, chốt.
     Công thức y như file "Augustus - Chốt ca". */
  shift(d, con){
    const sh = d.shift, c = d.close, ui = App.shiftUi || {};
    const sua = !c || ui.edit;
    const so = (v) => `<b class="num">${tien(v)}</b>`;
    const tipBills = con.filter(v => v.tip > 0);
    const tipTho = new Map();
    tipBills.forEach(v => tipTho.set(v.barber_name || '— chưa ghi thợ', (tipTho.get(v.barber_name || '— chưa ghi thợ') || 0) + v.tip));
    const tm = con.filter(v => v.pay_cash > 0), ck = con.filter(v => v.pay_transfer > 0);
    const opening = sua ? (ui.opening != null ? ui.opening : sh.opening) : c.opening;
    const thuTM = sua ? sh.cash_sales : c.cash_sales;

    const m1 = `<div class="mod"><div class="mh"><i>1</i>Tiền trong tủ đầu ca</div>
      ${sua ? `<input class="inp big" id="shOpen" data-money inputmode="numeric" value="${soTien(opening)}" placeholder="0">
        ${d.prev_keep != null ? `<div class="dim">Lần chốt ${ngayNgan(d.prev_date)} để lại tủ ${tien(d.prev_keep)}</div>` : '<div class="dim">Đếm tiền lẻ có sẵn trong tủ lúc mở cửa.</div>'}`
        : `<div class="mv">${tien(c.opening)}</div>`}
    </div>`;

    const m2 = `<div class="mod"><div class="mh"><i>2</i>Thu trong ngày</div>
      <div class="ln"><span>💵 Tiền mặt vào tủ <span class="dim">· ${tm.length} HĐ</span></span>${so(sh.cash_sales)}</div>
      <div class="ln"><span>🏦 Chuyển khoản vào tài khoản <span class="dim">· ${ck.length} HĐ</span></span>${so(sh.transfer)}</div>
      <div class="ln sub"><span>Doanh thu dịch vụ (chưa gồm tip)</span><span class="num">${tien(sh.revenue)}</span></div>
      ${ck.length ? `<details style="margin-top:6px"><summary class="dim">Danh sách chuyển khoản — dò với sao kê</summary>
        <table class="tbl xl" style="margin-top:6px">${ck.map(v => `<tr style="cursor:default"><td class="num">${esc(v.visit_time)}</td>
          <td>${esc(v.code)}</td><td>${esc(v.customer_name || 'Khách lẻ')}</td><td class="r num">${tien(v.pay_transfer)}</td></tr>`).join('')}</table></details>` : ''}
    </div>`;

    const chiNgoai = d.moves.filter(m => m.amount < 0), thuNgoai = d.moves.filter(m => m.amount > 0);
    const tongM = ds => Math.abs(ds.reduce((x, m) => x + m.amount, 0));
    const moveRow = m => `<tr style="cursor:default"><td>${esc(m.note)} <span class="dim">· ${esc(m.time)}${m.by ? ' · ' + esc(m.by) : ''}</span></td>
      <td class="r num" style="color:${m.amount < 0 ? 'var(--bad)' : 'var(--ok)'}">${m.amount > 0 ? '+' : '−'}${tien(Math.abs(m.amount))}
      ${m.can_del && sua ? `<button class="link bad" data-act="moveDel" data-id="${m.id}" style="padding:0 0 0 6px">×</button>` : ''}</td></tr>`;
    const m3 = `<div class="mod wide"><div class="mh"><i>3</i>Tiền ra / vào tủ ngoài hoá đơn</div>
      <div class="mod3">
        <div>
          <div class="ln"><span><b>− Tip trả thợ</b> <span class="dim">· lấy tiền mặt trong tủ đưa thợ</span></span><b class="num bad">−${tien(sh.tips_out)}</b></div>
          ${tipBills.length ? `<table class="tbl xl">${tipBills.map(v => `<tr style="cursor:default">
              <td>✂︎ ${esc(v.barber_name || '—')}<div class="dim">${esc(v.code)} · bill ${tienGon(v.amount)}, khách ${v.pay_transfer ? 'chuyển' : 'đưa'} ${tienGon(v.amount + v.tip)}</div></td>
              <td class="r num">${tien(v.tip)}</td></tr>`).join('')}
            ${[...tipTho].map(([k, n]) => `<tr style="cursor:default" class="tot"><td>Đưa ${esc(k)}</td><td class="r num">${tien(n)}</td></tr>`).join('')}</table>`
            : '<div class="dim" style="padding:8px 0">Hôm nay không có tip.</div>'}
        </div>
        <div>
          <div class="ln"><span><b>± Ngoài luồng</b> <span class="dim">· mua đá, ship, thu hộ…</span></span>
            <b class="num">${sh.moves > 0 ? '+' : sh.moves < 0 ? '−' : ''}${tien(Math.abs(sh.moves))}</b></div>
          ${d.moves.length ? `<table class="tbl xl">${chiNgoai.map(moveRow).join('')}${thuNgoai.map(moveRow).join('')}
            ${chiNgoai.length && thuNgoai.length ? `<tr class="tot" style="cursor:default"><td>Chi ra ${tien(tongM(chiNgoai))} · Thu vào ${tien(tongM(thuNgoai))}</td><td></td></tr>` : ''}</table>`
            : '<div class="dim" style="padding:8px 0">Chưa có khoản nào.</div>'}
          ${sua ? `<form id="moveForm" class="moveform" autocomplete="off">
            <select class="inp" name="sign"><option value="-1">− Chi ra</option><option value="1">+ Thu vào</option></select>
            <input class="inp" name="note" placeholder="Nội dung (mua đá…)" required>
            <input class="inp" name="amount" data-money inputmode="numeric" placeholder="Số tiền" required>
            <button class="btn sm" type="submit">Thêm</button></form>` : ''}
        </div>
      </div>
    </div>`;

    const tipRa = sua ? sh.tips_out : c.tips_out, ngoai = sua ? sh.moves : c.moves;
    const cong = `<div class="formula num">
        <span id="shOpenF">${tien(Number(String(opening || 0).replace(/\D/g, '')))}<small>đầu ca</small></span><em>+</em>
        <span>${tien(thuTM)}<small>tiền mặt thu</small></span><em>−</em>
        <span>${tien(tipRa)}<small>tip trả thợ</small></span><em>${ngoai < 0 ? '−' : '+'}</em>
        <span>${tien(Math.abs(ngoai))}<small>ngoài luồng</small></span><em>=</em>
        <span class="eq" id="shExp">${tien(sua ? 0 : c.expected)}<small>phải có trong tủ</small></span></div>`;

    const m4 = sua ? `<div class="mod wide"><div class="mh"><i>4</i>Đếm tủ & chốt ca</div>
      ${cong}
      <div class="grid3" style="margin-top:12px">
        <div class="field" style="margin:0"><label><b>Tiền đếm được trong tủ</b></label>
          <input class="inp big" id="shCount" data-money inputmode="numeric" value="${soTien(ui.counted)}" placeholder="đếm rồi nhập"></div>
        <div class="field" style="margin:0"><label>Để lại tủ cho ca sau</label>
          <input class="inp big" id="shKeep" data-money inputmode="numeric" value="${soTien(ui.keep != null ? ui.keep : (c ? c.keep : ''))}" placeholder="0"></div>
        <div class="field" style="margin:0"><label>Nộp chủ / rút ra</label><div class="mv num" id="shOut">—</div></div>
      </div>
      <div class="diffbox" id="shDiff"></div>
      <input class="inp" id="shNote" placeholder="Ghi chú (bắt buộc nếu lệch)" value="${esc(ui.note != null ? ui.note : (c ? c.note : ''))}">
      <div class="row" style="margin-top:12px;gap:12px">
        <button class="btn pri" data-act="shiftClose" style="width:auto;padding:13px 28px">🔒 Chốt ca</button>
        ${c ? '<button class="link" data-act="shiftCancel">Thôi, giữ biên bản cũ</button>' : ''}</div>
    </div>` : `<div class="mod wide ${c.diff === 0 ? 'ok' : 'lech'}"><div class="mh"><i>4</i>Đã chốt ca 🔒
        <span class="grow"></span>${API.isOwner() ? '<button class="btn sm" data-act="shiftEdit">Chốt lại</button>' : ''}</div>
      <div class="dim" style="margin:-6px 0 10px">${new Date(c.closed_at * 1000).toLocaleString('vi-VN')}${c.by_name ? ' · ' + esc(c.by_name) : ''}</div>
      ${sh.expected !== c.expected ? `<div class="diffbox bad" style="margin-bottom:10px">⚠ Sổ đã thay đổi SAU khi chốt (thêm / huỷ hoá đơn, tip, ngoài luồng):
        tủ giờ phải có <b>${tien(sh.expected)}</b>, lúc chốt là ${tien(c.expected)}. ${API.isOwner() ? 'Bấm "Chốt lại" để đếm lại.' : 'Báo chủ quán chốt lại.'}</div>` : ''}
      ${cong}
      <div class="grid3" style="margin-top:12px">
        <div><div class="dim">Đếm được trong tủ</div><div class="mv">${tien(c.counted)}</div></div>
        <div><div class="dim">Để lại tủ</div><div class="mv">${tien(c.keep)}</div></div>
        <div><div class="dim">Nộp chủ / rút ra</div><div class="mv">${tien(c.counted - c.keep)}</div></div>
      </div>
      <div class="diffbox ${c.diff === 0 ? 'ok' : 'bad'}">${c.diff === 0 ? 'Chuẩn ✓ — khớp từng đồng' : (c.diff > 0 ? 'Dư ' : 'Thiếu ') + tien(Math.abs(c.diff))}</div>
      ${c.note ? `<div class="dim">📝 ${esc(c.note)}</div>` : ''}
    </div>`;

    return `<h3 style="margin:18px 0 10px">Chốt ca ${d.date === App.today ? 'hôm nay' : ngay(d.date)}</h3>
      <div class="mods">${m1}${m2}${m3}${m4}</div>`;
  },

  /* ---------------- lương thợ ---------------- */

  /* Mỗi thợ một tab (như mỗi thợ một trang trong file Excel), thêm tab
     Tổng hợp để nhìn cả quỹ lương. */
  payroll(d, ui){
    const dong = d.rows || [];
    const khoa = !!d.closed;
    const thangNay = d.month === (App.today || '').slice(0, 7);
    const t = dong.find(x => x.id === ui.open);
    const tong = k => dong.reduce((a, x) => a + this.payParts(x)[k], 0);
    return `<div class="wrap paywrap">
      ${head('Lương thợ', false, `<input type="month" id="payMonth" class="inp" style="width:auto;padding:8px" value="${esc(d.month)}" max="${esc((App.today || '').slice(0, 7))}">`)}
      ${khoa ? `<div class="card row" style="border-color:var(--ok);padding:12px 16px"><div class="grow">🔒 <b>Đã chốt</b> ${new Date(d.closed.at * 1000).toLocaleString('vi-VN')}${d.closed.by ? ' · ' + esc(d.closed.by) : ''}
          <div class="dim">Bảng giữ nguyên dù sau đó đổi tiền công hay huỷ hoá đơn cũ.</div></div>
        <button class="btn sm" data-act="payReopen">Mở lại</button></div>`
        : `<p class="note">Tạm tính theo mức tiền công đang đặt ở Thiết lập → Dịch vụ${thangNay ? ' · tháng chưa hết, số còn tăng' : ''}.
            Tip đã trả thợ trong ngày nên không cộng vào lương.</p>`}
      ${d.no_barber ? `<p class="note" style="color:var(--warn)">${d.no_barber} hoá đơn trong tháng chưa ghi thợ — không tính vào lương ai. Sửa ở Sổ ngày.</p>` : ''}
      <div class="ptabs">
        <button class="${!t ? 'on' : ''}" data-act="payOpen" data-id="0">📊 Tổng hợp</button>
        ${dong.map(x => `<button class="${t && t.id === x.id ? 'on' : ''}" data-act="payOpen" data-id="${x.id}">✂︎ ${esc(x.name)}<small>${tienGon(x.total)}</small></button>`).join('')}
      </div>
      ${t ? this.payBarber(t, khoa) : `<div class="tblwrap"><table class="tbl xl">
        <thead><tr><th>Thợ</th><th class="r">Hoá đơn</th><th class="r">I. Lương cứng</th><th class="r">II. Tiền công</th>
          <th class="r">III. Hoa hồng</th><th class="r">IV. Phụ cấp · thưởng</th><th class="r">V. Trừ</th><th class="r">Thực nhận</th><th>KPI</th></tr></thead>
        <tbody>${dong.map(x => { const p = this.payParts(x); return `<tr data-act="payOpen" data-id="${x.id}">
          <td><b>${esc(x.name)}</b>${x.active ? '' : ' <span class="dim">(nghỉ)</span>'}</td><td class="r num">${x.bills}</td>
          <td class="r num">${tien(p.base)}</td><td class="r num">${tien(p.wage)}</td><td class="r num">${tien(p.comm)}</td>
          <td class="r num">${tien(p.plus)}</td><td class="r num bad">${p.minus ? '−' + tien(p.minus) : ''}</td>
          <td class="r num"><b>${tien(x.total)}</b></td><td>${this.kpiDots(x)}</td></tr>`; }).join('')}
          <tr class="tot"><td>Tổng quỹ lương</td><td class="r num">${dong.reduce((a, x) => a + x.bills, 0)}</td>
            <td class="r num">${tien(tong('base'))}</td><td class="r num">${tien(tong('wage'))}</td><td class="r num">${tien(tong('comm'))}</td>
            <td class="r num">${tien(tong('plus'))}</td><td class="r num bad">${tong('minus') ? '−' + tien(tong('minus')) : ''}</td>
            <td class="r num"><b>${tien(dong.reduce((a, x) => a + x.total, 0))}</b></td><td></td></tr></tbody></table></div>
        <p class="dim">Bấm tên thợ (hoặc tab phía trên) để xem bảng lương chi tiết, KPI, thêm phụ cấp / thưởng / nợ.</p>`}
      <div class="row" style="margin-top:14px;gap:8px">
        ${khoa ? '' : `<button class="btn sm pri" data-act="payClose">🔒 Chốt lương tháng ${esc(d.month.slice(5))}/${esc(d.month.slice(0, 4))}</button>`}
        <button class="btn sm" data-act="payPrint">🖨 In ${t ? 'phiếu lương ' + esc(t.name) : 'bảng tổng hợp'}</button>
      </div>
    </div>`;
  },

  /* Tách tổng lương thành 5 phần I–V. */
  payParts(t){
    const plus = t.adjust.filter(a => a.amount > 0).reduce((s, a) => s + a.amount, 0);
    const minus = -t.adjust.filter(a => a.amount < 0).reduce((s, a) => s + a.amount, 0);
    return {base: t.base, wage: t.wage, comm: t.comm, plus, minus};
  },

  /* Bảng lương một thợ — dựng như trang Excel: mục I–V, mỗi mục có dòng cộng. */
  paySheet(t, khoa){
    const p = this.payParts(t);
    /* Mỗi mục cách mục trên một dòng trống — nhìn tách bạch như file Excel. */
    const gap = '<tr class="gap"><td colspan="4"></td></tr>';
    const sec = (so, ten) => `${so === 'I' ? '' : gap}<tr class="sec"><td colspan="4">${so}. ${ten}</td></tr>`;
    const cong = (ten, v, am) => `<tr class="tot"><td colspan="3">${ten}</td><td class="r num">${am && v ? '−' : ''}${tien(v)}</td></tr>`;
    const congTien = t.rows.filter(r => !r.comm_pct), hh = t.rows.filter(r => r.comm_pct);
    const adj = (ds, am) => ds.map(a => `<tr><td>${esc(a.label)}${a.recurring ? ' <span class="badge">hằng tháng</span>' : ''}
        ${!khoa ? `<button class="link bad" data-act="payAdjDel" data-id="${a.id}" style="padding:0 4px">×</button>` : ''}</td>
      <td class="r num">${a.qty || 1}</td><td class="r num">${tien(a.rate || Math.abs(a.amount))}</td>
      <td class="r num${am ? ' bad' : ''}">${am ? '−' : ''}${tien(Math.abs(a.amount))}</td></tr>`).join('');
    return `<table class="tbl xl sheet">
      <thead><tr><th>Khoản</th><th class="r">SL / Doanh số</th><th class="r">Đơn giá / %</th><th class="r">Thành tiền</th></tr></thead>
      <tbody>
        ${sec('I', 'Lương cứng')}
        <tr><td>Lương cứng tháng</td><td class="r num">1</td><td class="r num">${tien(t.base)}</td><td class="r num">${tien(t.base)}</td></tr>
        ${sec('II', 'Tiền công dịch vụ (theo lượt)')}
        ${congTien.map(r => `<tr><td>${esc(r.name)}</td><td class="r num">${r.qty}</td>
          <td class="r num">${r.rate ? tien(r.rate) : '<span class="dim">chưa đặt</span>'}</td><td class="r num">${r.wage ? tien(r.wage) : ''}</td></tr>`).join('')
          || '<tr><td colspan="4" class="dim">Chưa có lượt nào.</td></tr>'}
        ${cong('Cộng II', p.wage)}
        ${sec('III', 'Hoa hồng hoá chất · sản phẩm (% doanh số)')}
        ${hh.map(r => `<tr><td>${esc(r.name)}</td><td class="r num">${tien(r.sales)}</td>
          <td class="r num">${r.comm_pct}%</td><td class="r num">${tien(r.comm)}</td></tr>`).join('')
          || '<tr><td colspan="4" class="dim">Chưa bán hoá chất / sản phẩm nào.</td></tr>'}
        ${cong('Cộng III', p.comm)}
        ${sec('IV', 'Phụ cấp · thưởng · bonus')}
        ${adj(t.adjust.filter(a => a.amount > 0), false) || '<tr><td colspan="4" class="dim">Chưa có.</td></tr>'}
        ${cong('Cộng IV', p.plus)}
        ${sec('V', 'Khoản trừ — nợ · ứng · bảo hiểm')}
        ${adj(t.adjust.filter(a => a.amount < 0), true) || '<tr><td colspan="4" class="dim">Chưa có.</td></tr>'}
        ${cong('Cộng V', p.minus, true)}
        ${gap}<tr class="net"><td colspan="3">THỰC NHẬN = I + II + III + IV − V</td><td class="r num">${tien(t.total)}</td></tr>
      </tbody></table>
      <div class="dim" style="margin-top:6px">${t.bills} hoá đơn · doanh thu ${tien(t.revenue)}${t.tip ? ` · tip đã nhận trong ngày ${tien(t.tip)} (không tính lại)` : ''}</div>`;
  },

  payBarber(t, khoa){
    const kpi = this.kpiList(t);
    return `<div class="paygrid"><div class="card" style="padding:12px">
        <h3 style="margin:2px 2px 10px">Bảng lương ${esc(t.name)} — tháng ${esc(App.data.payroll.month.slice(5))}/${esc(App.data.payroll.month.slice(0, 4))}</h3>
        ${this.paySheet(t, khoa)}
      </div><div>
      <div class="card"><h3>🎯 KPI ${t.kpi && t.kpi.from && t.kpi.from !== App.data.payroll.month ? `<span class="dim" style="font-weight:400">(KPI tháng ${esc(t.kpi.from.slice(5))}/${esc(t.kpi.from.slice(0, 4))})</span>` : ''}</h3>
        <form id="kpiForm" data-barber="${t.id}">
          ${kpi.map(x => {
            const pct = x.goal ? Math.min(100, Math.round(x.now / x.goal * 100)) : 0;
            return `<div class="kpi${x.goal && x.now >= x.goal ? ' hit' : ''}">
              <div class="row"><span class="grow">${esc(x.ten)}</span>
                <b class="num">${x.laTien ? tienGon(x.now) : x.now}</b><span class="dim">/</span>
                ${khoa ? `<span class="num">${x.laTien ? tienGon(x.goal) : x.goal}</span>`
                  : `<input class="inp mini" name="${x.key}" ${x.laTien ? 'data-money' : ''} inputmode="numeric" value="${x.goal ? (x.laTien ? soTien(x.goal) : x.goal) : ''}" placeholder="mục tiêu">`}</div>
              ${x.goal ? `<div class="bar"><i style="width:${pct}%;${x.now >= x.goal ? 'background:var(--ok)' : ''}"></i></div>
                <div class="dim">${x.now >= x.goal ? '✓ Đạt' : 'Còn ' + (x.laTien ? tien(x.goal - x.now) : (x.goal - x.now))}</div>` : ''}
            </div>`;
          }).join('')}
          ${khoa ? '' : '<button class="btn sm" type="submit" style="margin-top:8px">Lưu KPI</button>'}
        </form></div>
      ${khoa ? '' : `<div class="card"><h3>➕ Thêm khoản cộng / trừ</h3>
        <form id="payAdjForm" class="adjform" data-barber="${t.id}" autocomplete="off">
          <select class="inp" name="sign"><option value="1">IV · Cộng (phụ cấp, thưởng, bonus)</option><option value="-1">V · Trừ (nợ, ứng, bảo hiểm)</option></select>
          <input class="inp" name="label" placeholder="Nội dung — vd. Tiền xăng, Clip, Ứng lương" required>
          <div class="grid2" style="gap:8px"><input class="inp" name="qty" inputmode="numeric" value="1" title="Số lượng">
            <input class="inp" name="rate" data-money inputmode="numeric" placeholder="Đơn giá / số tiền" required></div>
          <label class="check"><input type="checkbox" name="recurring" value="1"> Khoản hằng tháng (tháng sau chép lại được)</label>
          <button class="btn sm pri" type="submit">Thêm vào bảng</button>
        </form>
        <button class="btn sm" data-act="payCopy" data-id="${t.id}" style="margin-top:10px">↻ Chép các khoản hằng tháng từ tháng trước</button>
      </div>`}
    </div></div>`;
  },

  /* KPI: 4 chỉ số giống cột "Tổng" ở bảng lương tay — đạt thì xanh. */
  kpiList(t){
    const k = t.kpi || {}, n = t.kpi_now || {};
    return [['cuts', 'Đầu cắt', false], ['combo', 'Combo', false], ['chem', 'Doanh thu hoá chất', true], ['prod', 'Doanh thu sản phẩm', true]]
      .map(([key, ten, laTien]) => ({key, ten, laTien, now: n[key] || 0, goal: k[key] || 0}));
  },
  kpiDots(t){
    return this.kpiList(t).filter(x => x.goal).map(x =>
      `<span class="kdot${x.now >= x.goal ? ' hit' : ''}" title="${esc(x.ten)}: ${x.laTien ? tien(x.now) : x.now} / ${x.laTien ? tien(x.goal) : x.goal}"></span>`).join('')
      || '<span class="dim">—</span>';
  },

  /* ---------------- khuyến mãi giảm giá ---------------- */

  promos(rows){
    return `<div class="wrap">
      ${head('Khuyến mãi giảm giá', true)}
      <p class="note">Quầy chọn khuyến mãi lúc tính tiền (vd. HSSV −20%, Khai trương −30k). Chỉ áp lên dịch vụ được giảm
        (Thiết lập → Dịch vụ). <b>Không cộng dồn</b> với giảm theo hạng — app tự lấy mức có lợi hơn cho khách.
        Quầy không gõ tay được số tiền giảm nào khác.</p>
      ${rows.map(p => this.promoRow(p)).join('')}
      ${this.promoRow({id: 0, name: '', kind: 'pct', value: '', start_date: '', end_date: '', active: 1})}
    </div>`;
  },

  promoRow(p){
    return `<form class="erow${p.id && !p.running ? ' void' : ''}" data-promo="${p.id}">
      <div class="row"><b class="grow">${p.id ? esc(p.name) : 'Thêm khuyến mãi'}</b>
        ${p.id ? (p.running ? '<span class="badge" style="color:var(--ok)">đang chạy</span>' : '<span class="badge">không chạy</span>') : ''}</div>
      <div class="grid3">
        <div><label>Tên</label><input name="name" value="${esc(p.name)}" placeholder="vd. HSSV"></div>
        <div><label>Kiểu</label><select name="kind"><option value="pct"${p.kind === 'pct' ? ' selected' : ''}>Giảm %</option>
          <option value="amt"${p.kind === 'amt' ? ' selected' : ''}>Giảm số tiền</option></select></div>
        <div><label>Mức giảm (% hoặc đ)</label><input name="value" inputmode="numeric" data-money value="${p.kind === 'amt' ? soTien(p.value) : esc(p.value)}" placeholder="20 hoặc 30.000"></div>
        <div><label>Từ ngày (trống = ngay)</label><input type="date" name="start_date" value="${esc(p.start_date)}"></div>
        <div><label>Đến ngày (trống = không hạn)</label><input type="date" name="end_date" value="${esc(p.end_date)}"></div>
        <div><label>Trạng thái</label><select name="active"><option value="1"${p.active ? ' selected' : ''}>Bật</option>
          <option value="0"${p.active ? '' : ' selected'}>Tắt</option></select></div>
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn sm pri" type="submit">${p.id ? 'Lưu' : 'Thêm'}</button>
        ${p.id ? `<button class="link bad" type="button" data-act="promoDel" data-id="${p.id}">Xoá</button>` : ''}</div>
    </form>`;
  },

  /* ---------------- khác / thiết lập ---------------- */

  more(tiers){
    const owner = API.isOwner();
    const muc = (act, icon, ten, mo) => `<button class="item" data-act="${act}">
      <span style="font-size:20px">${icon}</span><div class="grow"><b>${ten}</b>
      ${mo ? `<div class="sub">${mo}</div>` : ''}</div><span class="dim">›</span></button>`;
    return `<div class="wrap">
      ${head(owner ? 'Thiết lập' : 'Khác')}
      <div class="card row"><div class="grow"><b>${esc(API.user ? API.user.name : '')}</b>
        <div class="dim">${owner ? 'Chủ quán' : API.isBarber() ? 'Tài khoản thợ' : 'Tài khoản quầy'} · ${esc(App.shop || '')}</div></div></div>
      ${owner ? `<div class="list" style="margin-bottom:12px">
        ${muc('go:services', '✂︎', 'Dịch vụ & giá', 'Giá bán, tiền công thợ, hoa hồng sản phẩm')}
        ${muc('go:tiers', '🏅', 'Hạng thành viên', 'Ngưỡng lên hạng, % giảm, quyền lợi')}
        ${muc('go:promos', '🏷', 'Khuyến mãi giảm giá', 'HSSV, khai trương… quầy chọn khi tính tiền')}
        ${muc('go:programs', '🎁', 'Quà theo mốc', 'Mốc quà theo số lần cắt, uốn…')}
        ${muc('go:import', '📥', 'Nhập & đối soát KiotViet', 'Nạp lịch sử, tìm lượt quầy quên ghi hoặc ghi khống')}
        ${muc('go:barbers', '💈', 'Thợ cắt', 'Danh sách thợ, lương cứng, khách quen')}
        ${muc('go:bookset', '📅', 'Đặt lịch', 'Giờ mở cửa, link cho khách tự đặt')}
        ${muc('go:backup', '💾', 'Sao lưu dữ liệu', 'Mỗi đêm tự sao lưu, gửi vào Gmail')}
        ${muc('go:users', '👤', 'Tài khoản quầy & thợ', 'Tạo, đổi mật khẩu, tắt; tài khoản thợ xem hoá đơn của mình')}
        ${muc('go:audit', '📜', 'Nhật ký', 'Ai đã ghi, huỷ, trao quà lúc nào')}
        ${muc('go:password', '🔑', 'Đổi mật khẩu chủ')}
      </div>` : ''}
      ${!owner && tiers && tiers.length ? `<h3>Hạng & đặc quyền</h3>${tierPanel(tiers, null, 0, false)}` : ''}
      <div class="list">
        ${muc('theme', '◐', 'Đổi sáng / tối')}
        ${muc('logout', '⎋', 'Đăng xuất')}
      </div>
    </div>`;
  },

  /* ---------------- tổng quan (chủ) ---------------- */

  dash(d){
    const tong = d.tiers.reduce((a, t) => a + t.count, 0) || 1;
    return `<div class="wrap">
      ${head('Tổng quan', false, `<button class="chip" data-act="reload">↻</button>`)}
      ${!d.last_backup || !d.last_backup.ok || d.last_backup.error || Date.now() / 1000 - d.last_backup.at > 36 * 3600
        ? `<button class="note dashlink" data-act="go:backup" style="color:var(--warn);width:100%;text-align:left">💾 ${!d.last_backup ? 'Chưa sao lưu dữ liệu lần nào' : d.last_backup.error ? 'Sao lưu gần nhất bị lỗi: ' + esc(d.last_backup.error) : 'Đã hơn 1 ngày chưa sao lưu'} — bấm để xem ›</button>` : ''}
      ${d.reports_open ? `<button class="note dashlink" data-act="tab" data-id="bills" style="color:var(--warn);width:100%;text-align:left">📣 ${d.reports_open} báo sai hoá đơn chờ xử lý ›</button>` : ''}
      ${d.bookings_today ? `<button class="note dashlink" data-act="tab" data-id="sched" style="width:100%;text-align:left">📅 Hôm nay có ${d.bookings_today} lịch hẹn${d.unconfirmed ? ` · <b style="color:var(--warn)">${d.unconfirmed} lịch khách tự đặt chưa xác nhận</b>` : ''} ›</button>` : ''}
      <div class="stats">
        <div class="stat"><div class="n">${tienGon(d.today.amount)}</div><div class="l">doanh thu hôm nay · ${d.today.visits} HĐ</div></div>
        <div class="stat"><div class="n">${tienGon(d.month.amount)}</div><div class="l">doanh thu tháng này · ${d.month.visits} HĐ</div></div>
        <div class="stat hot"><div class="n">${d.pending_total}</div><div class="l">quà chờ trao</div></div>
        <div class="stat"><div class="n">${d.month.gifts_given}</div><div class="l">quà đã trao tháng này</div></div>
      </div>
      <div class="cols">
        <div class="card"><h3>Khách theo hạng</h3>
          ${d.tiers.map(t => `<div class="tbar"><div class="t">${tierBadge(t)}</div>
            <div class="b"><i style="width:${(t.count / tong * 100).toFixed(1)}%;${tierStyle(t.color)}"></i></div>
            <div class="c">${t.count}</div></div>`).join('')}
          <div class="dim">${d.customers} khách trong danh sách · ${d.month.new_customers} khách mới tháng này</div>
        </div>
        ${d.barbers.length || d.no_barber ? `<div class="card"><h3>Thợ cắt tháng này</h3>
          ${d.barbers.length ? `<div class="tblwrap" style="border:0"><table class="tbl" style="font-size:13.5px">
            <thead><tr><th>Thợ</th><th class="r">Lượt</th><th class="r">Khách</th><th class="r" title="Khách đã từng cắt với chính thợ này trước tháng này">Quay lại</th><th class="r">Tiền DV</th></tr></thead>
            <tbody>${d.barbers.map(b => `<tr style="cursor:default"><td><b>${esc(b.name)}</b></td><td class="r num">${b.visits}</td>
              <td class="r num">${b.customers}</td>
              <td class="r num">${b.returning} <span class="dim">(${b.customers ? Math.round(b.returning / b.customers * 100) : 0}%)</span></td>
              <td class="r num">${tienGon(b.amount)}</td></tr>`).join('')}</tbody></table></div>` : ''}
          ${d.no_barber ? `<div class="dim" style="margin-top:6px;color:var(--warn)">${d.no_barber} lượt tháng này chưa ghi thợ.</div>` : ''}
        </div>` : ''}
        <div class="card"><h3>Quầy ghi tháng này</h3>
          ${d.by_user.length ? d.by_user.map(u => `<div class="row" style="padding:4px 0"><span class="grow">${esc(u.name)}</span>
            <b class="num">${u.n}</b></div>`).join('') : '<div class="dim">Chưa có lượt nào.</div>'}
          <div class="dim" style="margin-top:6px">${d.month.voided} hoá đơn bị huỷ trong tháng · doanh thu ${tien(d.month.amount)}
            (tiền mặt ${tienGon(d.month.cash)} · chuyển khoản ${tienGon(d.month.transfer)}${d.month.tip ? ' · gồm tip ' + tienGon(d.month.tip) : ''}${d.month.discount ? ' · đã giảm ' + tienGon(d.month.discount) : ''})</div>
          <div class="dim">Đối soát gần nhất: ${esc(d.last_import || 'chưa có')}</div>
        </div>
      </div>
      ${d.flagged.length ? `<div class="card"><h3 style="color:var(--bad)">Lượt quầy ghi mà không có hoá đơn KiotViet (${d.flagged.length})</h3>
        <p class="note">Khách có lượt trong app nhưng hôm đó KiotViet không có hoá đơn nào gắn số của khách.
          Có thể thu ngân quên gắn khách vào hoá đơn — hoặc là lượt ghi khống. Xem rồi huỷ nếu sai.</p>
        <div class="list">${d.flagged.map(v => this.visitRow(Object.assign({}, v, {can_void: false}), true)).join('')}</div></div>` : ''}
      ${d.birthdays.length || d.bday_missing ? `<div class="card"><h3>🎂 Sinh nhật tháng ${Number(App.today.slice(5, 7))} (${d.birthdays.length})</h3>
        ${d.birthdays.length ? `<div class="list">${d.birthdays.map(b => `
          <button class="item" data-act="open" data-id="${b.id}"><div class="grow"><b>${esc(b.name)}</b>
            <div class="sub num">🎂 ${ngaySinh(b.birthday)} · ${esc(b.phone)}</div></div>
            ${tierBadge(b.tier)}
            ${b.given ? '<span class="badge" style="color:var(--ok)">đã trao</span>' : '<span class="badge gift">chưa trao</span>'}</button>`).join('')}</div>`
          : '<div class="dim">Tháng này không có khách nào sinh nhật.</div>'}
        ${d.bday_missing ? `<p class="dim" style="margin:10px 0 0">${d.bday_missing} khách thuộc hạng có quà sinh nhật chưa có ngày sinh —
          <button class="link" data-act="goNoBday" style="padding:0">xem danh sách</button>. Quầy sẽ được nhắc hỏi khi khách ghé.</p>` : ''}
      </div>` : ''}
      <div class="card"><h3>Khách còn quà chưa nhận (${d.pending.length})</h3>
        ${d.pending.length ? `<div class="list">${d.pending.map(p => `
          <button class="item" data-act="open" data-id="${p.id}"><div class="grow"><b>${esc(p.name)}</b>
            <div class="sub">${esc(p.gifts.join(' · '))}</div></div>
            <span class="dim num">${ngayNgan(p.last)}</span></button>`).join('')}</div>`
          : '<div class="dim">Không còn ai chờ quà.</div>'}
      </div>
    </div>`;
  },

  /* ---------------- danh sách khách (chủ) ---------------- */

  /* opt.table: máy tính, không mở thẻ bên cạnh → hiện dạng bảng nhiều cột.
     opt.compact: đang nằm ở cột trái cạnh thẻ khách → bỏ khung hạng cho gọn. */
  customers(all, tiers, st, opt){
    opt = opt || {};
    const q = App.fold(st.q || '');
    const soQ = (st.q || '').replace(/\D/g, '');
    let rows = all.filter(c => (!st.tier || c.tier_id === st.tier)
      && (!q || App.fold(c.name).includes(q) || (soQ.length >= 3 && c.phone.includes(soQ))));
    if (st.only === 'gift') rows = rows.filter(c => c.pending.length);
    if (st.only === 'flag') rows = rows.filter(c => c.flagged);
    /* Tháng sinh nhật: xếp theo ngày trong tháng. Chưa có ngày sinh: chỉ
       khách thuộc hạng có quà — những người quầy cần hỏi. */
    const thangNay = (App.today || '').slice(5, 7);
    if (st.only === 'bday') rows = rows.filter(c => c.birthday && c.birthday.slice(0, 2) === thangNay);
    if (st.only === 'nobday') rows = rows.filter(c => c.bday_eligible && !c.birthday && c.visits);
    const so = {
      last:  (a, b) => String(b.last || '').localeCompare(String(a.last || '')),
      cuts:  (a, b) => b.cuts - a.cuts,
      spend: (a, b) => b.spend - a.spend,
      name:  (a, b) => a.name.localeCompare(b.name, 'vi'),
    }[st.sort || 'last'];
    rows.sort(st.only === 'bday' ? (a, b) => a.birthday.localeCompare(b.birthday) : so);
    if (st.barber) rows = rows.filter(c => c.barber_id === st.barber);
    const thoById = {};
    (App.data.barbersAll || []).forEach(b => thoById[b.id] = b);
    const tenTho = c => c.barber_id && thoById[c.barber_id] ? thoById[c.barber_id].name : '';
    const tierById = {}, dem = {};
    tiers.forEach(t => { tierById[t.id] = t; dem[t.id] = 0; });
    all.forEach(c => { if (c.visits && dem[c.tier_id] != null) dem[c.tier_id]++; });
    const hien = rows.slice(0, st.limit || 100);
    const dang = st.tier ? tierById[st.tier] : null;
    const cur = App.cur.name === 'card' ? App.cur.id : 0;

    const bang = `<div class="tblwrap"><table class="tbl">
      <thead><tr><th>Khách</th><th>Điện thoại</th><th>Hạng</th><th>Thợ quen</th><th class="r">Lần cắt</th>
        <th class="r">Đã chi</th><th>Ghé gần nhất</th><th>Quà chờ</th></tr></thead>
      <tbody>${hien.map(c => `<tr data-act="open" data-id="${c.id}">
        <td><b>${esc(c.name || '(chưa có tên)')}</b>${c.flagged ? ' <span class="badge bad">⚠︎</span>' : ''}</td>
        <td class="num">${esc(c.phone)}${c.birthday ? ` <span class="dim">🎂 ${ngaySinh(c.birthday)}</span>` : ''}</td>
        <td>${tierBadge(tierById[c.tier_id])}</td>
        <td>${esc(tenTho(c))}</td>
        <td class="r num">${c.cuts}</td>
        <td class="r num">${tien(c.spend)}</td>
        <td class="num">${c.last ? ngay(c.last) : '—'}</td>
        <td>${c.pending.length ? `<span class="badge gift">🎁 ${esc(c.pending.join(', '))}</span>` : ''}</td>
      </tr>`).join('')}</tbody></table></div>`;

    const danhSach = `<div class="list">${hien.map(c => `
        <button class="item${cur === c.id ? ' sel' : ''}" data-act="open" data-id="${c.id}"><div class="grow"><b>${esc(c.name || '(chưa có tên)')}</b>
          <div class="sub num">${esc(c.phone)} · ${c.cuts} lần cắt · ${tienGon(c.spend)}${c.last ? ' · ' + ngay(c.last) : ''}${tenTho(c) ? ' · ✂︎ ' + esc(tenTho(c)) : ''}</div></div>
          ${c.flagged ? '<span class="badge bad">⚠︎</span>' : ''}
          ${c.pending.length ? `<span class="badge gift">🎁 ${c.pending.length}</span>` : ''}
          ${tierBadge(tierById[c.tier_id])}</button>`).join('')}</div>`;

    return `<div class="wrap">
      ${head('Khách hàng', false, `<span class="dim">${rows.length} khách</span>`)}
      ${opt.compact ? '' : `<h3 style="margin-top:4px">Hạng & đặc quyền <span class="dim" style="font-weight:400">· bấm một hạng để lọc</span></h3>
        ${tierPanel(tiers, dem, st.tier, true)}`}
      ${opt.compact && dang ? `<div class="card" style="--tc:${esc(dang.color)}">${tierBadge(dang, true)}
        <span class="dim"> ${tierCond(dang)}</span>${perkList(perksOf(dang))}</div>` : ''}
      <input id="cusQ" class="inp" placeholder="Tìm tên hoặc số điện thoại   ( / )" value="${esc(st.q || '')}"
             autocomplete="off" style="margin:4px 0 10px">
      <div class="chips">
        <button class="chip${!st.tier && !st.only ? ' on' : ''}" data-act="cf" data-k="all">Tất cả</button>
        ${tiers.map(t => `<button class="chip${st.tier === t.id ? ' on' : ''}" data-act="cf" data-k="tier" data-v="${t.id}">${esc(t.name)}</button>`).join('')}
        <button class="chip${st.only === 'gift' ? ' on' : ''}" data-act="cf" data-k="gift">🎁 Chờ quà</button>
        <button class="chip${st.only === 'flag' ? ' on' : ''}" data-act="cf" data-k="flag">⚠︎ Có cờ</button>
        <button class="chip${st.only === 'bday' ? ' on' : ''}" data-act="cf" data-k="bday">🎂 Sinh nhật tháng này</button>
        <button class="chip${st.only === 'nobday' ? ' on' : ''}" data-act="cf" data-k="nobday">Chưa có ngày sinh</button>
      </div>
      <div class="chips">
        ${[['last', 'Ghé gần đây'], ['cuts', 'Cắt nhiều nhất'], ['spend', 'Chi nhiều nhất'], ['name', 'Tên A–Z']].map(([k, n]) =>
          `<button class="chip${(st.sort || 'last') === k ? ' on' : ''}" data-act="cs" data-k="${k}">${n}</button>`).join('')}
      </div>
      ${(App.data.barbersAll || []).length ? `<div class="chips">
        <button class="chip${!st.barber ? ' on' : ''}" data-act="cb" data-id="0">✂︎ Mọi thợ</button>
        ${App.data.barbersAll.map(b => `<button class="chip${st.barber === b.id ? ' on' : ''}" data-act="cb" data-id="${b.id}">${esc(b.name)}${b.active ? '' : ' (nghỉ)'}</button>`).join('')}
      </div>` : ''}
      ${hien.length ? (opt.table ? bang : danhSach) : '<div class="empty">Không có khách nào khớp.</div>'}
      ${rows.length > hien.length ? `<button class="btn" data-act="more" style="margin-top:12px">Hiện thêm (${rows.length - hien.length})</button>` : ''}
    </div>`;
  },

  /* ---------------- chương trình ---------------- */

  programs(rows){
    return `<div class="wrap">
      ${head('Quà theo mốc', true)}
      <p class="note">Mỗi chương trình đếm số lượt khách làm một loại dịch vụ, đủ mốc thì có quà.
        Chỉ lượt từ <b>ngày bắt đầu</b> trở đi mới được đếm — lịch sử cũ nhập từ KiotViet chỉ tính vào hạng.</p>
      ${rows.map(p => `<button class="card item" data-act="editProg" data-id="${p.id}" style="display:block">
        <div class="row"><b class="grow">${esc(p.name)}</b>
          ${p.active ? '<span class="badge" style="color:var(--ok)">đang chạy</span>' : '<span class="badge">tắt</span>'}</div>
        <div class="sub">${esc(kindName(p.kind))} · ${p.steps.map(s => `lần ${s.at} → ${esc(s.gift)}`).join(' · ')}</div>
        <div class="dim">${p.repeat ? 'Lặp lại vòng mới' : 'Chỉ một vòng'} · từ ${ngay(p.start_date)}${p.end_date ? ' đến ' + ngay(p.end_date) : ''}</div>
      </button>`).join('')}
      <button class="btn pri" data-act="editProg" data-id="0">+ Thêm chương trình</button>
    </div>`;
  },

  programEdit(p){
    const kinds = Object.assign({any: 'Mọi lượt ghé'}, App.kinds);
    return `<div class="wrap">
      ${head(p.id ? 'Sửa chương trình' : 'Chương trình mới', true)}
      <div class="card">
        <div class="field"><label>Tên</label><input data-pf="name" value="${esc(p.name)}"></div>
        <div class="grid2">
          <div class="field"><label>Đếm lượt</label><select data-pf="kind">
            ${Object.entries(kinds).map(([k, n]) => `<option value="${k}"${p.kind === k ? ' selected' : ''}>${esc(n)}</option>`).join('')}
          </select></div>
          <div class="field"><label>Trạng thái</label><select data-pf="active">
            <option value="1"${p.active ? ' selected' : ''}>Đang chạy</option>
            <option value="0"${p.active ? '' : ' selected'}>Tắt</option></select></div>
          <div class="field"><label>Bắt đầu đếm từ</label><input type="date" data-pf="start_date" value="${esc(p.start_date)}"></div>
          <div class="field"><label>Kết thúc (để trống = không hạn)</label><input type="date" data-pf="end_date" value="${esc(p.end_date || '')}"></div>
        </div>
        <label class="check"><input type="checkbox" data-pf="repeat"${p.repeat ? ' checked' : ''}>
          Đạt mốc cuối thì quay lại vòng mới (3-7-10 → 13-17-20 …)</label>
      </div>
      <div class="card">
        <h3>Mốc quà</h3>
        <div class="step dim" style="margin-bottom:4px"><span>Lần thứ</span><span>Quà tặng</span><span></span></div>
        ${p.steps.map((s, i) => `<div class="step">
          <input inputmode="numeric" data-step="${i}" data-f="at" value="${esc(s.at)}">
          <input data-step="${i}" data-f="gift" value="${esc(s.gift)}" placeholder="vd. Sáp vuốt tóc">
          <button class="x" data-act="stepDel" data-i="${i}" aria-label="Bỏ mốc">×</button></div>`).join('')}
        <button class="btn sm" data-act="stepAdd">+ Thêm mốc</button>
        <p class="dim" style="margin:10px 0 0">Muốn “mỗi lần uốn tặng tinh dầu”: đếm Uốn, một mốc lần thứ 1, bật lặp lại.</p>
      </div>
      ${p.id ? `<p class="note">Đổi mốc khi đã có khách nhận quà thì phần quà đã trao vẫn giữ nguyên, nhưng thứ tự mốc
        của những người đang giữa vòng sẽ tính theo mốc mới.</p>` : ''}
      <button class="btn pri" data-act="saveProg">Lưu chương trình</button>
      ${p.id ? `<button class="btn bad" data-act="delProg" style="margin-top:10px">Xoá chương trình</button>` : ''}
    </div>`;
  },

  /* ---------------- hạng ---------------- */

  /* Giá sau giảm của một món — cùng công thức mhQuote. */
  giaHang(u, p, round){
    const [buoc, kieu] = round || [1000, 'down'];
    if (!p) return u;
    let con = u - Math.round(u * p / 100000) * 1000;
    con = kieu === 'near' ? Math.round(con / buoc) * buoc : Math.floor(con / buoc) * buoc;
    return Math.max(0, Math.min(u, con));
  },

  tierPreview(rows, round, svc){
    const ds = (svc || []).slice(0, 6);
    if (!ds.length) return '';
    return `<div class="tblwrap"><table class="tbl xl">
      <thead><tr><th>Dịch vụ</th><th class="r">Giá gốc</th>${rows.map(t => `<th class="r">${esc(t.name)} −${Number(t.disc_pct) || 0}%</th>`).join('')}</tr></thead>
      <tbody>${ds.map(sv => `<tr style="cursor:default"><td>${esc(sv.name)}</td><td class="r num">${tien(sv.price)}</td>
        ${rows.map(t => { const g = this.giaHang(sv.price, Number(t.disc_pct) || 0, round);
          return `<td class="r num"><b>${tien(g)}</b>${g < sv.price ? `<div class="dim">giảm ${tienGon(sv.price - g)} · ${(Math.round((sv.price - g) / sv.price * 1000) / 10).toLocaleString('vi-VN')}%</div>` : ''}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div>`;
  },

  tiers(rows, dem, round, svc){
    round = round || [1000, 'down'];
    return `<div class="wrap">
      ${head('Hạng thành viên', true)}
      <div class="card"><h3>Làm tròn giá sau giảm</h3>
        <p class="dim" style="margin:0 0 10px">Giảm % cho ra giá lẻ (170k −5% = 161.500đ). Chọn cách làm tròn giá khách trả cho mỗi món:</p>
        <div class="grid2" style="max-width:520px">
          <select class="inp" id="roundStep">${[[1000, 'Tròn 1.000đ (gần như đúng %)'], [5000, 'Tròn 5.000đ'], [10000, 'Tròn 10.000đ']].map(([v, n]) =>
            `<option value="${v}"${round[0] === v ? ' selected' : ''}>${n}</option>`).join('')}</select>
          <select class="inp" id="roundMode"><option value="down"${round[1] === 'down' ? ' selected' : ''}>Làm tròn xuống (khách lợi)</option>
            <option value="near"${round[1] === 'near' ? ' selected' : ''}>Làm tròn gần nhất</option></select>
        </div>
        <h3 style="margin-top:14px">Giá khách trả theo hạng <span class="dim" style="font-weight:400">· đổi % bên dưới là bảng đổi theo</span></h3>
        <div id="tierPreview">${this.tierPreview(rows, round, svc)}</div>
      </div>
      <p class="note">Cộng dồn trọn đời, đạt <b>một trong hai</b> ngưỡng là lên hạng. Ngưỡng để 0 là không xét.
        Hạng đầu tiên là hạng khởi điểm của mọi khách.
        ${dem ? 'Số bên phải mỗi hạng là số khách sẽ nằm ở hạng đó <b>với ngưỡng đang gõ</b>.' : ''}</p>
      ${rows.map((t, i) => `<div class="erow">
        <div class="row"><b class="grow">${tierBadge(t, true)}</b>
          ${dem ? `<span class="badge" id="tc${i}">${dem[i]} khách</span>` : ''}
          ${i > 0 ? `<button class="x" data-act="tierDel" data-i="${i}" aria-label="Bỏ hạng">×</button>` : ''}</div>
        <div class="grid2">
          <div><label>Tên hạng</label><input data-tier="${i}" data-f="name" value="${esc(t.name)}"></div>
          <div><label>Màu</label><input type="color" data-tier="${i}" data-f="color" value="${esc(t.color)}"></div>
          <div><label>% giảm mỗi bill (dịch vụ được giảm)</label><input inputmode="numeric" data-tier="${i}" data-f="disc_pct" value="${t.disc_pct || ''}" placeholder="0 = không giảm"></div>
          <div></div>
          ${i > 0 ? `<div><label>Từ số lần cắt</label><input inputmode="numeric" data-tier="${i}" data-f="min_cuts" value="${t.min_cuts || ''}" placeholder="0 = không xét"></div>
          <div><label>Hoặc tổng chi từ (đ)</label><input inputmode="numeric" data-tier="${i}" data-f="min_spend" data-money value="${soTien(t.min_spend)}" placeholder="0 = không xét"></div>` : ''}
        </div>
        <div style="margin-top:8px"><label>🎂 Quà sinh nhật (để trống = hạng này không có) — quầy sẽ hỏi ngày sinh khách từ hạng này</label>
          <input data-tier="${i}" data-f="bday_gift" value="${esc(t.bday_gift || '')}" placeholder="vd. Gội dưỡng miễn phí"></div>
        <div style="margin-top:8px"><label>Đặc quyền — mỗi dòng một điều (hiện trên thẻ khách và tab Khách)</label>
          <textarea data-tier="${i}" data-f="perks" rows="4" placeholder="Giảm 10% sản phẩm&#10;Ưu tiên đặt lịch">${esc(t.perks)}</textarea></div>
      </div>`).join('')}
      <button class="btn" data-act="tierAdd" style="margin-bottom:10px">+ Thêm hạng</button>
      <button class="btn pri" data-act="saveTiers">Lưu các hạng</button>
    </div>`;
  },

  /* ---------------- dịch vụ ---------------- */

  services(rows, groups){
    const o = (s, i) => `<div class="erow${s.active ? '' : ' void'}">
        <div class="grid2" style="margin-top:0">
          <div><label>Tên</label><input data-svc="${i}" data-f="name" value="${esc(s.name)}"></div>
          <div class="grid2" style="margin:0">
            <div><label>Nhóm</label><select data-svc="${i}" data-f="grp">
              ${groups.map(g => `<option value="${esc(g.code)}"${s.grp === g.code ? ' selected' : ''}>${esc(g.code)} · ${esc(g.name)}</option>`).join('')}
            </select></div>
            <div><label>Loại (tính mốc / hạng)</label><select data-svc="${i}" data-f="kind">
              ${Object.entries(App.kinds).map(([k, n]) => `<option value="${k}"${s.kind === k ? ' selected' : ''}>${esc(n)}</option>`).join('')}
            </select></div>
          </div>
          <div><label>Giá bán (đ)</label><input inputmode="numeric" data-svc="${i}" data-f="price" data-money value="${soTien(s.price)}" placeholder="0 = nhập tay"></div>
          <div><label>Mã KiotViet</label><input data-svc="${i}" data-f="kv_codes" value="${esc(s.kv_codes)}" autocapitalize="characters"></div>
          <div><label>Tiền công thợ / lượt (đ)</label><input inputmode="numeric" data-svc="${i}" data-f="wage" data-money value="${soTien(s.wage)}" placeholder="0"></div>
          <div><label>% hoa hồng cho thợ (trên tiền thực thu)</label><input inputmode="decimal" data-svc="${i}" data-f="comm_pct" value="${s.comm_pct || ''}" placeholder="vd. 15 (uốn), 12 (sản phẩm A)"></div>
          <div><label>Thời gian làm (phút) — để xếp lịch hẹn</label><input inputmode="numeric" data-svc="${i}" data-f="duration" value="${s.duration || ''}" placeholder="vd. 45"></div>
        </div>
        <div style="margin-top:8px"><label>Chú thích cho nhân viên — hiện khi rê chuột vào dịch vụ ở màn Bán hàng</label>
          <textarea data-svc="${i}" data-f="note" rows="2" placeholder="vd. Gồm cắt + gội + cạo mặt, khoảng 45 phút">${esc(s.note || '')}</textarea></div>
        <div class="row" style="margin-top:8px;flex-wrap:wrap">
          <label class="check grow"><input type="checkbox" data-svc="${i}" data-f="active"${s.active ? ' checked' : ''}> Hiện ở quầy</label>
          <label class="check grow"><input type="checkbox" data-svc="${i}" data-f="discountable"${s.discountable ? ' checked' : ''}> Được giảm theo hạng / khuyến mãi</label>
          <label class="check grow"><input type="checkbox" data-svc="${i}" data-f="bookable"${s.bookable ? ' checked' : ''}> Cho khách tự đặt online</label>
          <button class="link" data-act="svcUp" data-i="${i}">↑ Lên</button>
          <button class="link" data-act="svcAddIn" data-g="${esc(s.grp)}">+ Thêm vào nhóm này</button>
        </div>
      </div>`;
    const theoIdx = rows.map((s, i) => Object.assign({_i: i}, s));
    return `<div class="wrap">
      ${head('Dịch vụ & giá', true)}
      <p class="note"><b>Nhóm</b> để chia màn Bán hàng và tính KPI: thường A lẻ, B combo, C hoá chất, D sản phẩm.
        <b>Loại</b> quyết định mốc quà / số lần cắt lên hạng (combo cũng là "Cắt tóc"). Giá 0 = quầy tự nhập giá.
        Đổi giá chỉ áp cho hoá đơn từ giờ.<br><b>Tiền công / lượt</b> và <b>% hoa hồng</b> là phần của thợ, cộng vào lương tháng.</p>
      <div class="card"><h3>Các nhóm</h3>
        ${groups.map((g, k) => `<div class="row" style="margin-bottom:6px">
          <input class="inp" style="width:64px;text-align:center" data-grp="${k}" data-f="code" value="${esc(g.code)}">
          <input class="inp grow" data-grp="${k}" data-f="name" value="${esc(g.name)}">
          ${groups.length > 1 ? `<button class="x" data-act="grpDel" data-i="${k}" aria-label="Bỏ nhóm">×</button>` : ''}</div>`).join('')}
        <button class="btn sm" data-act="grpAdd">+ Thêm nhóm</button>
      </div>
      ${theoNhom(theoIdx, groups).map(([g, ds]) => `<h3 class="grphead" style="margin-top:16px"><b>${esc(g.code)}</b> ${esc(g.name)} <span class="dim" style="font-weight:400">· ${ds.length}</span></h3>
        ${ds.map(x => o(rows[x._i], x._i)).join('')}`).join('')}
      <button class="btn" data-act="svcAdd" style="margin:12px 0 10px">+ Thêm dịch vụ</button>
      <button class="btn pri" data-act="saveSvc">Lưu dịch vụ</button>
    </div>`;
  },

  /* ---------------- nhập KiotViet ---------------- */

  importView(st){
    const r = st.result;
    const s = r && r.stats;
    return `<div class="wrap">
      ${head('Nhập & đối soát KiotViet', true)}
      <div class="card">
        <p class="note" style="margin-top:0">Trong KiotViet: <b>Giao dịch → Hoá đơn → Xuất file → Hoá đơn chi tiết</b>. Chọn file .xlsx đó ở đây.<br>
          • <b>Lần đầu:</b> nhập file cả năm để khách cũ có ngay hạng (không sinh quà).<br>
          • <b>Hằng tuần:</b> nhập file tuần vừa rồi để khớp với lượt quầy đã ghi — lượt quầy quên ghi được thêm vào,
            lượt quầy ghi mà KiotViet không có hoá đơn thì bị gắn cờ.<br>
          Nhập trùng file không sao — hoá đơn đã nhập được bỏ qua.</p>
        <input type="file" id="kvFile" accept=".xlsx" class="inp" multiple>
        <p class="dim" style="margin:8px 0 0">Chọn được nhiều file một lúc (vd. 2023, 2024, 2026) — app gộp lại rồi nhập một lượt.</p>
        ${st.busy ? `<p class="dim">${esc(st.busy)}</p>` : ''}
        ${st.err ? `<p style="color:var(--bad)">${esc(st.err)}</p>` : ''}
      </div>
      ${st.file ? `<div class="card"><h3>${st.fileCount > 1 ? st.fileCount + ' file: ' : 'File: '}${esc(st.fileName)}</h3>
        <div class="dim">${st.file.invoices.length} hoá đơn (${st.file.lines} dòng hàng) từ ${ngay(st.file.from)} đến ${ngay(st.file.to)}
          · ${st.file.withPhone} hoá đơn có số điện thoại${st.file.cancelled ? ' · bỏ ' + st.file.cancelled + ' dòng đã huỷ' : ''}</div></div>` : ''}
      ${s ? `<div class="card">
        <h3>${r.committed ? '✓ Đã nhập' : 'Xem trước — chưa ghi gì'}</h3>
        <div class="stats">
          <div class="stat"><div class="n">${s.created}</div><div class="l">lượt ${r.committed ? 'đã' : 'sẽ'} thêm</div></div>
          <div class="stat"><div class="n">${s.linked}</div><div class="l">khớp lượt quầy đã ghi</div></div>
          <div class="stat"><div class="n">${s.new_customers}</div><div class="l">khách mới</div></div>
          <div class="stat"><div class="n">${s.dup}</div><div class="l">đã nhập trước đó</div></div>
        </div>
        <div class="dim">${s.walkin} hoá đơn khách lẻ (không số điện thoại) ${r.committed ? 'đã' : 'sẽ'} nhập thành hoá đơn không gắn khách —
          có trong sổ ngày và lương thợ, không vào hạng.</div>
        ${s.walkin_skipped ? `<div class="dim">${s.walkin_skipped} hoá đơn khách lẻ rơi vào những ngày quán đã bán bằng app — bỏ qua để khỏi đếm hai lần.</div>` : ''}
        ${s.pay_filled ? `<div class="dim">${s.pay_filled} hoá đơn đã nhập từ trước ${r.committed ? 'đã' : 'sẽ'} được điền tiền mặt / chuyển khoản / tip.</div>` : ''}
        ${r.barbers_new && r.barbers_new.length ? `<p class="note" style="margin-top:10px">Thợ lấy từ cột “Người bán”, ${r.committed ? 'đã' : 'sẽ'} thêm vào danh sách thợ:
          <b>${r.barbers_new.map(esc).join(', ')}</b>. Đổi tên hiển thị ở Thiết lập → Thợ cắt.</p>` : ''}
        ${s.barber_filled ? `<div class="dim">${s.barber_filled} lượt đã nhập từ trước ${r.committed ? 'đã' : 'sẽ'} được điền thợ.</div>` : ''}
        ${r.unmapped.length ? `<p class="note" style="margin-top:10px">Mã hàng chưa gắn vào dịch vụ nào (sẽ tính là “Khác”, không vào số lần cắt):
          ${r.unmapped.map(u => `<b>${esc(u.code)}</b> ${esc(u.name)} (${u.count})`).join(' · ')}.
          Thêm mã vào mục Dịch vụ rồi nhập lại cũng được — không sợ trùng.</p>` : ''}
        ${r.orphans.length ? `<h3 style="margin-top:14px;color:var(--bad)">${r.orphans.length} lượt quầy ghi không có hoá đơn cùng ngày</h3>
          <div class="list">${r.orphans.map(v => this.visitRow(Object.assign({}, v, {can_void: false}), true)).join('')}</div>
          <p class="dim">${r.committed ? 'Đã gắn cờ — xem ở Tổng quan.' : 'Áp dụng thì các lượt này sẽ bị gắn cờ để bạn xem lại.'}</p>` : ''}
        ${r.committed ? '' : `<button class="btn pri" data-act="importGo" style="margin-top:12px">Áp dụng</button>`}
      </div>` : ''}
    </div>`;
  },

  /* ---------------- thợ cắt ---------------- */

  barbers(rows){
    return `<div class="wrap">
      ${head('Thợ cắt', true)}
      <p class="note">Quầy chọn thợ mỗi lần ghi lượt. <b>Tên bên KiotViet</b> là tên ở cột “Người bán” trong file hoá đơn —
        để nhập file thì biết lượt nào của ai. Thợ nghỉ thì bỏ tick, đừng xoá: lịch sử khách quen vẫn giữ.
        <br><b>Khách quen</b> = khách có từ 3 lượt, và thợ này là người cắt cho họ nhiều nhất.</p>
      ${rows.map((b, i) => `<div class="erow${b.active ? '' : ' void'}">
        ${b.id ? `<div class="row"><b class="grow">${esc(b.name)}</b>
          <span class="dim num">${b.visits} lượt · ${b.customers} khách · <b style="color:var(--acc)">${b.loyal} khách quen</b>${b.last ? ' · gần nhất ' + ngay(b.last) : ''}</span></div>` : '<b>Thợ mới</b>'}
        <div class="grid2">
          <div><label>Tên hiển thị</label><input data-bb="${i}" data-f="name" value="${esc(b.name)}"></div>
          <div><label>Tên bên KiotViet (cột Người bán)</label><input data-bb="${i}" data-f="kv_name" value="${esc(b.kv_name)}"></div>
          <div><label>Lương cứng / tháng (đ)</label><input inputmode="numeric" data-bb="${i}" data-f="base_salary" data-money value="${soTien(b.base_salary)}" placeholder="0"></div>
        </div>
        <div class="row" style="margin-top:8px">
          <label class="check grow"><input type="checkbox" data-bb="${i}" data-f="active"${b.active ? ' checked' : ''}> Đang làm (hiện ở quầy)</label>
          ${b.id ? `<button class="link" data-act="thoKhach" data-id="${b.id}">Xem khách quen ›</button>` : ''}
        </div>
      </div>`).join('')}
      <button class="btn" data-act="barberAdd" style="margin-bottom:10px">+ Thêm thợ</button>
      <button class="btn pri" data-act="saveBarbers">Lưu</button>
    </div>`;
  },

  /* ---------------- tài khoản ---------------- */

  users(rows, barbers){
    const chonTho = (u) => `<select name="barber_id"><option value="0">— chọn thợ —</option>
      ${(barbers || []).map(b => `<option value="${b.id}"${u.barber_id === b.id ? ' selected' : ''}>${esc(b.name)}${b.active ? '' : ' (nghỉ)'}</option>`).join('')}</select>`;
    const chonVai = (u) => `<select name="role"><option value="counter"${u.role === 'barber' ? '' : ' selected'}>Quầy — tính tiền</option>
      <option value="barber"${u.role === 'barber' ? ' selected' : ''}>Thợ — xem hoá đơn của mình</option></select>`;
    return `<div class="wrap">
      ${head('Tài khoản', true)}
      <p class="note"><b>Quầy</b>: tính tiền, tra khách, trao quà, xem báo cáo hôm nay, chốt ca. Không huỷ, không sửa được hoá đơn —
        nhầm thì bấm 📣 Báo sai, chủ quán sửa. Không xem được số điện thoại đầy đủ, giá vốn, lương.<br>
        <b>Thợ</b>: chỉ xem hoá đơn ghi tên mình theo tháng (đếm từng món), báo sai / báo thiếu hoá đơn. Không tính tiền, không tra khách.</p>
      ${rows.map(u => `<form class="erow" data-user="${u.id}">
        <div class="row"><b class="grow">${esc(u.name)}</b>
          <span class="badge">${u.role === 'owner' ? 'chủ' : u.role === 'barber' ? 'thợ' : 'quầy'}</span>
          ${u.active ? '' : '<span class="badge bad">đã tắt</span>'}</div>
        <div class="dim">${u.last_seen ? 'Dùng gần nhất ' + new Date(u.last_seen * 1000).toLocaleString('vi-VN') : 'Chưa đăng nhập'}</div>
        <div class="grid2">
          <div><label>Tên hiển thị</label><input name="name" value="${esc(u.name)}"></div>
          <div><label>Tên đăng nhập</label><input name="username" value="${esc(u.username)}" autocapitalize="off"></div>
          <div><label>Mật khẩu mới (để trống = giữ)</label><input name="password" autocapitalize="off" autocomplete="new-password"></div>
          <div><label>Trạng thái</label><select name="active"${u.role === 'owner' ? ' disabled' : ''}>
            <option value="1"${u.active ? ' selected' : ''}>Đang dùng</option><option value="0"${u.active ? '' : ' selected'}>Tắt</option></select></div>
          ${u.role === 'owner' ? '' : `<div><label>Loại tài khoản</label>${chonVai(u)}</div><div><label>Thợ (nếu là tài khoản thợ)</label>${chonTho(u)}</div>`}
        </div>
        <button class="btn sm pri" type="submit" style="margin-top:10px">Lưu</button>
      </form>`).join('')}
      <form class="erow" data-user="0">
        <b>Thêm tài khoản</b>
        <div class="grid2">
          <div><label>Tên hiển thị</label><input name="name" placeholder="vd. Phú"></div>
          <div><label>Tên đăng nhập</label><input name="username" placeholder="vd. phu" autocapitalize="off"></div>
          <div><label>Mật khẩu</label><input name="password" autocapitalize="off" autocomplete="new-password"></div>
          <div><label>Loại tài khoản</label>${chonVai({role: 'counter'})}</div>
          <div><label>Thợ (nếu là tài khoản thợ)</label>${chonTho({})}</div>
        </div>
        <button class="btn sm pri" type="submit" style="margin-top:10px">Tạo</button>
      </form>
    </div>`;
  },

  audit(rows){
    const ten = {login: 'Đăng nhập', visit_add: 'Ghi lượt', bill_create: 'Tính tiền', visit_void: 'Huỷ hoá đơn', reward_give: 'Trao quà',
      promo_save: 'Sửa khuyến mãi', promo_del: 'Xoá khuyến mãi', payroll_close: 'Chốt lương', payroll_reopen: 'Mở lại lương',
      payroll_adjust: 'Thưởng / trừ lương', payroll_adjust_del: 'Xoá thưởng / trừ', barbers_save: 'Sửa thợ',
      reward_ungive: 'Hoàn quà', customer_create: 'Thêm khách', customer_update: 'Sửa khách',
      services_save: 'Sửa dịch vụ', tiers_save: 'Sửa hạng', program_save: 'Sửa chương trình',
      program_del: 'Xoá chương trình', program_off: 'Tắt chương trình', import: 'Nhập KiotViet',
      user_save: 'Sửa tài khoản', change_password: 'Đổi mật khẩu', report_add: '📣 Báo sai', report_resolve: 'Xử lý báo sai',
      shift_close: 'Chốt ca', cash_move: 'Tiền ngoài luồng', cash_move_del: 'Xoá tiền ngoài luồng', visit_barber: 'Đổi thợ'};
    return `<div class="wrap">
      ${head('Nhật ký', true)}
      <div class="list">${rows.map(r => `<div class="item"><div class="grow">
        <b>${esc(ten[r.action] || r.action)}</b> <span class="dim">· ${esc(r.name || '?')}</span>
        ${r.detail ? `<div class="sub" style="word-break:break-word">${esc(r.detail)}</div>` : ''}</div>
        <span class="dim num">${esc(r.time)}</span></div>`).join('')}</div>
    </div>`;
  },

  password(){
    return `<div class="wrap">
      ${head('Đổi mật khẩu chủ', true)}
      <form id="pwForm" class="card">
        <div class="field"><label>Mật khẩu hiện tại</label><input name="old_password" type="password" autocomplete="current-password"></div>
        <div class="field"><label>Mật khẩu mới</label><input name="new_password" type="password" autocomplete="new-password"></div>
        <button class="btn pri" type="submit">Đổi</button>
      </form>
    </div>`;
  }
};
