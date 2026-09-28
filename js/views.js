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

/* Đặc quyền lưu dạng chữ, mỗi dòng một điều — tách ra thành danh sách. */
const perksOf = t => String((t && t.perks) || '').split('\n')
  .map(x => x.replace(/^[\s\-•*✓]+/, '').trim()).filter(Boolean);

/* "Từ 5 lần cắt hoặc 1tr chi tiêu" — điều kiện lên hạng, đọc thành câu. */
const tierCond = t => {
  const dk = [];
  if (t.min_cuts > 0)  dk.push(t.min_cuts + ' lần cắt');
  if (t.min_spend > 0) dk.push(tienGon(t.min_spend) + ' chi tiêu');
  return dk.length ? 'Từ ' + dk.join(' hoặc ') : 'Hạng khởi điểm';
};

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
      ${ds.length ? perkList(ds) : '<div class="dim" style="font-style:italic">Chưa ghi đặc quyền</div>'}
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
    const dqNay = perksOf(t);
    const dqSau = nx ? perksOf(nx.tier).filter(x => !dqNay.includes(x)) : [];
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
            <div class="dim num">${esc(c.phone)}${c.kv_code ? ' · ' + esc(c.kv_code) : ''}</div>
          </div>
          ${tierBadge(t, true)}
        </div>
        <div class="dim" style="margin-top:10px">${s.cuts} lần cắt · ${s.visits} lượt ghé · đã chi ${tien(s.spend)}
          ${s.last ? ' · gần nhất ' + ngay(s.last) : ''}</div>
        ${this.thoQuen(d.barbers, s.visits)}
        ${hang}
        ${c.note && owner ? `<p class="note" style="margin:10px 0 0;white-space:pre-line">📝 ${esc(c.note)}</p>` : ''}
      </div>

      ${pending.length ? `<div class="giftbox${moi.size ? ' flash' : ''}">
        <h3>🎁 Quà chờ trao (${pending.length})</h3>
        ${pending.map(e => `<div class="item">
          <div class="grow"><b>${esc(e.gift)}</b>
            <div class="sub">${esc(e.pname)} · đạt ở lượt thứ ${e.total}${moi.has(e.pid + '|' + e.seq) ? ' · <b style="color:var(--gift)">vừa đạt</b>' : ''}</div></div>
          <button class="btn sm pri" data-act="give" data-p="${e.pid}" data-s="${e.seq}">Đã trao</button>
        </div>`).join('')}
      </div>` : ''}

      ${dacQuyen}

      ${d.rewards.length ? `<div class="card">${d.rewards.map(p => this.progress(p)).join('<div style="height:14px"></div>')}</div>` : ''}

      </div><div>

      <div class="card">
        <h3>Ghi lượt ${owner ? '' : 'hôm nay'}</h3>
        ${this.pickBarber(ui, d.last_barber_id)}
        ${this.pickServices(ui)}
        ${owner ? `<div class="field" style="margin-top:12px"><label>Ngày (chủ quán ghi bù được ngày cũ)</label>
          <input type="date" id="visitDate" value="${esc(ui.date || App.today || '')}" max="${esc(App.today || '')}"></div>` : ''}
        ${this.canTho(ui) ? '<p class="dim" style="margin:10px 0 0;color:var(--warn)">Chọn thợ cắt trước khi ghi.</p>' : ''}
        <button class="btn pri" data-act="addVisit" style="margin-top:12px" ${ui.sel.size && !this.canTho(ui) ? '' : 'disabled'}>
          Ghi lượt${ui.sel.size ? ' · ' + tien(this.tongChon(ui)) : ''}</button>
      </div>

      <div class="card">
        <h3>Lượt ghé ${owner ? '' : 'gần đây'}</h3>
        ${d.visits.length ? `<div class="list">${d.visits.map(v => this.visitRow(v, false)).join('')}</div>`
                          : '<div class="dim">Chưa có lượt nào.</div>'}
        ${owner ? '' : `<p class="dim" style="margin:8px 0 0">Ghi nhầm thì huỷ được trong ${App.undoMinutes} phút. Quá thời gian thì nhờ chủ quán.</p>`}
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

  /* Quầy bắt buộc chọn thợ khi quán đã khai thợ; chủ thì không bắt. */
  canTho(ui){
    return !API.isOwner() && (App.barbers || []).length > 0 && !ui.barber;
  },

  pickBarber(ui, lastId){
    const ds = App.barbers || [];
    if (!ds.length) return API.isOwner()
      ? '<p class="dim" style="margin:0 0 10px">Chưa khai thợ cắt — thêm ở Thiết lập → Thợ cắt (hoặc nhập file KiotViet, app tự lấy từ cột "Người bán").</p>' : '';
    return `<div class="dim" style="margin-bottom:6px">Thợ cắt</div>
      <div class="chips" style="flex-wrap:wrap">${ds.map(b => `
        <button class="chip${ui.barber === b.id ? ' on' : ''}" data-act="pickBarber" data-id="${b.id}">${esc(b.name)}${b.id === lastId ? ' <span style="opacity:.7">· lần trước</span>' : ''}</button>`).join('')}</div>`;
  },

  tongChon(ui){
    let t = 0;
    ui.sel.forEach((gia, id) => {
      const s = ui.services.find(x => x.id === id);
      t += s && s.price ? s.price : (Number(gia) || 0);
    });
    return t;
  },

  pickServices(ui){
    if (!ui.services) return '<div class="dim">Đang tải dịch vụ…</div>';
    const ds = ui.services.filter(s => s.active);
    if (!ds.length) return '<div class="dim">Chưa có dịch vụ nào. Chủ quán thêm ở Thiết lập → Dịch vụ.</div>';
    const giaTay = ds.filter(s => !s.price && ui.sel.has(s.id));
    return `<div class="svcs">${ds.map(s => `
      <button class="svc${ui.sel.has(s.id) ? ' on' : ''}${s.kind === 'cut' ? ' cut' : ''}" data-act="pick" data-id="${s.id}">
        <b>${esc(s.name)}</b><span>${s.price ? tien(s.price) : 'nhập giá'}</span></button>`).join('')}</div>
      ${giaTay.map(s => `<div class="field" style="margin-top:10px"><label>Giá ${esc(s.name)}</label>
        <input class="inp" inputmode="numeric" data-price="${s.id}" placeholder="vd. 249000"
               value="${esc(ui.sel.get(s.id) || '')}"></div>`).join('')}`;
  },

  visitRow(v, showCustomer){
    const huy = v.void_at !== null && v.void_at !== undefined;
    const src = v.source === 'import' ? 'KiotViet' : '';
    return `<div class="item${huy ? ' void' : ''}">
      <div class="grow">
        ${showCustomer ? `<button class="link" data-act="open" data-id="${v.customer_id}" style="padding:0">${esc(v.customer_name || '(chưa tên)')}</button>
          <span class="dim num"> ${esc(v.customer_phone || '')}</span><br>` : ''}
        <b>${esc(v.items.map(i => i.name).join(', ') || '—')}</b>
        <div class="sub num">${showCustomer ? '' : ngay(v.visit_date) + ' '}${esc(v.visit_time)} · ${tien(v.amount)}
          ${v.barber_name ? ` · <b class="tho">✂︎ ${esc(v.barber_name)}</b>` : ''}
          ${v.by_name && v.source !== 'import' ? ' · ' + esc(v.by_name) : ''}${src ? ' · ' + src : ''}
          ${v.kv_invoice ? ' · ' + esc(v.kv_invoice) : ''}</div>
        ${huy ? `<div class="sub" style="color:var(--bad)">Đã huỷ${v.void_by_name ? ' bởi ' + esc(v.void_by_name) : ''}: ${esc(v.void_reason || '')}</div>` : ''}
      </div>
      ${(v.flags || []).includes('NO_INVOICE') && !huy ? '<span class="badge bad" title="Đối soát không thấy hoá đơn KiotViet nào cùng ngày">không có HĐ</span>' : ''}
      ${v.can_void && (App.barbers || []).length ? `<select class="vbsel" data-vb="${v.id}" title="Đổi thợ">
        <option value="0">— thợ —</option>
        ${App.barbers.map(b => `<option value="${b.id}"${b.id === v.barber_id ? ' selected' : ''}>${esc(b.name)}</option>`).join('')}
      </select>` : ''}
      ${v.can_void ? `<button class="link bad" data-act="void" data-id="${v.id}">Huỷ</button>` : ''}
    </div>`;
  },

  cardOwner(d){
    const c = d.customer;
    return `<div class="card">
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

  /* ---------------- trong ngày ---------------- */

  day(d){
    const owner = API.isOwner();
    const con = d.visits.filter(v => !v.void_at);
    const tong = con.reduce((a, v) => a + v.amount, 0);
    return `<div class="wrap">
      ${head(owner ? 'Sổ ngày' : 'Hôm nay', false, owner
        ? `<input type="date" id="dayPick" class="inp" style="width:auto;padding:8px" value="${esc(d.date)}" max="${esc(App.today)}">`
        : `<button class="chip" data-act="reload">↻</button>`)}
      <div class="stats">
        <div class="stat"><div class="n">${con.length}</div><div class="l">lượt ghi</div></div>
        <div class="stat"><div class="n">${tienGon(tong)}</div><div class="l">tiền dịch vụ đã ghi</div></div>
        <div class="stat${d.gifts.length ? ' hot' : ''}"><div class="n">${d.gifts.length}</div><div class="l">quà đã trao</div></div>
        <div class="stat"><div class="n">${d.visits.length - con.length}</div><div class="l">lượt đã huỷ</div></div>
      </div>
      ${this.dayBarbers(con)}
      ${d.gifts.length ? `<div class="card"><h3>Quà đã trao</h3><div class="list">${d.gifts.map(g => `
        <button class="item" data-act="open" data-id="${g.customer_id}"><div class="grow"><b>${esc(g.gift)}</b>
          <div class="sub">${esc(g.name)} · ${g.time}${g.by ? ' · ' + esc(g.by) : ''}</div></div></button>`).join('')}</div></div>` : ''}
      <div class="card"><h3>Lượt ghé</h3>
        ${d.visits.length ? `<div class="list">${d.visits.map(v => this.visitRow(v, true)).join('')}</div>`
                          : '<div class="dim">Chưa có lượt nào.</div>'}
      </div>
    </div>`;
  },

  dayBarbers(con){
    if (!con.length || !(App.barbers || []).length && !con.some(v => v.barber_name)) return '';
    const dem = new Map();
    con.forEach(v => { const k = v.barber_name || '— chưa ghi thợ'; dem.set(k, (dem.get(k) || 0) + 1); });
    return `<div class="chips" style="flex-wrap:wrap">${[...dem].sort((a, b) => b[1] - a[1]).map(([k, n]) =>
      `<span class="chip${k[0] === '—' ? '' : ' on'}">✂︎ ${esc(k)} · ${n}</span>`).join('')}</div>`;
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
        <div class="dim">${owner ? 'Chủ quán' : 'Tài khoản quầy'} · ${esc(App.shop || '')}</div></div></div>
      ${owner ? `<div class="list" style="margin-bottom:12px">
        ${muc('go:programs', '🎁', 'Chương trình khuyến mãi', 'Mốc quà theo số lần cắt, uốn…')}
        ${muc('go:tiers', '🏅', 'Hạng thành viên', 'Ngưỡng lên hạng và quyền lợi')}
        ${muc('go:services', '✂︎', 'Dịch vụ', 'Giá, loại, mã hàng KiotViet')}
        ${muc('go:import', '📥', 'Nhập & đối soát KiotViet', 'Nạp lịch sử, tìm lượt quầy quên ghi hoặc ghi khống')}
        ${muc('go:barbers', '💈', 'Thợ cắt', 'Danh sách thợ, khách quen của từng thợ')}
        ${muc('go:users', '👤', 'Tài khoản quầy', 'Tạo, đổi mật khẩu, tắt')}
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
      <div class="stats">
        <div class="stat"><div class="n">${d.today.visits}</div><div class="l">lượt hôm nay</div></div>
        <div class="stat"><div class="n">${d.month.visits}</div><div class="l">lượt tháng này</div></div>
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
          <div class="dim" style="margin-top:6px">${d.month.voided} lượt bị huỷ trong tháng · tiền dịch vụ đã ghi ${tien(d.month.amount)}</div>
          <div class="dim">Đối soát gần nhất: ${esc(d.last_import || 'chưa có')}</div>
        </div>
      </div>
      ${d.flagged.length ? `<div class="card"><h3 style="color:var(--bad)">Lượt quầy ghi mà không có hoá đơn KiotViet (${d.flagged.length})</h3>
        <p class="note">Khách có lượt trong app nhưng hôm đó KiotViet không có hoá đơn nào gắn số của khách.
          Có thể thu ngân quên gắn khách vào hoá đơn — hoặc là lượt ghi khống. Xem rồi huỷ nếu sai.</p>
        <div class="list">${d.flagged.map(v => this.visitRow(Object.assign({}, v, {can_void: false}), true)).join('')}</div></div>` : ''}
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
    const so = {
      last:  (a, b) => String(b.last || '').localeCompare(String(a.last || '')),
      cuts:  (a, b) => b.cuts - a.cuts,
      spend: (a, b) => b.spend - a.spend,
      name:  (a, b) => a.name.localeCompare(b.name, 'vi'),
    }[st.sort || 'last'];
    rows.sort(so);
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
        <td class="num">${esc(c.phone)}</td>
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
      ${head('Chương trình khuyến mãi', true)}
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

  tiers(rows, dem){
    return `<div class="wrap">
      ${head('Hạng thành viên', true)}
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
          ${i > 0 ? `<div><label>Từ số lần cắt</label><input inputmode="numeric" data-tier="${i}" data-f="min_cuts" value="${t.min_cuts || ''}" placeholder="0 = không xét"></div>
          <div><label>Hoặc tổng chi từ (đ)</label><input inputmode="numeric" data-tier="${i}" data-f="min_spend" value="${t.min_spend || ''}" placeholder="0 = không xét"></div>` : ''}
        </div>
        <div style="margin-top:8px"><label>Đặc quyền — mỗi dòng một điều (hiện trên thẻ khách và tab Khách)</label>
          <textarea data-tier="${i}" data-f="perks" rows="4" placeholder="Giảm 10% sản phẩm&#10;Ưu tiên đặt lịch">${esc(t.perks)}</textarea></div>
      </div>`).join('')}
      <button class="btn" data-act="tierAdd" style="margin-bottom:10px">+ Thêm hạng</button>
      <button class="btn pri" data-act="saveTiers">Lưu các hạng</button>
    </div>`;
  },

  /* ---------------- dịch vụ ---------------- */

  services(rows){
    return `<div class="wrap">
      ${head('Dịch vụ', true)}
      <p class="note"><b>Loại</b> quyết định dịch vụ được đếm vào đâu: chỉ loại <b>Cắt tóc</b> tính vào mốc cắt và vào số lần cắt
        để lên hạng. <b>Mã KiotViet</b> (cách nhau dấu phẩy) để app nhận ra dòng hàng khi nhập file.
        Giá 0 = quầy tự nhập giá (sản phẩm). Đổi loại là mọi lượt cũ được xếp lại theo ngay.</p>
      ${rows.map((s, i) => `<div class="erow${s.active ? '' : ' void'}">
        <div class="grid2" style="margin-top:0">
          <div><label>Tên</label><input data-svc="${i}" data-f="name" value="${esc(s.name)}"></div>
          <div><label>Loại</label><select data-svc="${i}" data-f="kind">
            ${Object.entries(App.kinds).map(([k, n]) => `<option value="${k}"${s.kind === k ? ' selected' : ''}>${esc(n)}</option>`).join('')}
          </select></div>
          <div><label>Giá tính (đ)</label><input inputmode="numeric" data-svc="${i}" data-f="price" value="${s.price || ''}" placeholder="0 = nhập tay"></div>
          <div><label>Mã KiotViet</label><input data-svc="${i}" data-f="kv_codes" value="${esc(s.kv_codes)}" autocapitalize="characters"></div>
        </div>
        <div class="row" style="margin-top:8px">
          <label class="check grow"><input type="checkbox" data-svc="${i}" data-f="active"${s.active ? ' checked' : ''}> Hiện ở quầy</label>
          ${i > 0 ? `<button class="link" data-act="svcUp" data-i="${i}">↑ Lên</button>` : ''}
        </div>
      </div>`).join('')}
      <button class="btn" data-act="svcAdd" style="margin-bottom:10px">+ Thêm dịch vụ</button>
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
        <div class="dim">${s.walkin} hoá đơn khách lẻ (không số điện thoại) được bỏ qua.</div>
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

  users(rows){
    return `<div class="wrap">
      ${head('Tài khoản', true)}
      <p class="note">Tài khoản quầy dùng chung: tra khách, ghi lượt hôm nay, trao quà, huỷ lượt vừa ghi trong
        ${App.undoMinutes} phút. Không xem được số điện thoại đầy đủ, không sửa được gì khác.
        Muốn biết ai ghi lượt nào thì tạo mỗi người một tài khoản.</p>
      ${rows.map(u => `<form class="erow" data-user="${u.id}">
        <div class="row"><b class="grow">${esc(u.name)}</b>
          <span class="badge">${u.role === 'owner' ? 'chủ' : 'quầy'}</span>
          ${u.active ? '' : '<span class="badge bad">đã tắt</span>'}</div>
        <div class="dim">${u.last_seen ? 'Dùng gần nhất ' + new Date(u.last_seen * 1000).toLocaleString('vi-VN') : 'Chưa đăng nhập'}</div>
        <div class="grid2">
          <div><label>Tên hiển thị</label><input name="name" value="${esc(u.name)}"></div>
          <div><label>Tên đăng nhập</label><input name="username" value="${esc(u.username)}" autocapitalize="off"></div>
          <div><label>Mật khẩu mới (để trống = giữ)</label><input name="password" autocapitalize="off" autocomplete="new-password"></div>
          <div><label>Trạng thái</label><select name="active"${u.role === 'owner' ? ' disabled' : ''}>
            <option value="1"${u.active ? ' selected' : ''}>Đang dùng</option><option value="0"${u.active ? '' : ' selected'}>Tắt</option></select></div>
        </div>
        <button class="btn sm pri" type="submit" style="margin-top:10px">Lưu</button>
      </form>`).join('')}
      <form class="erow" data-user="0">
        <b>Thêm tài khoản quầy</b>
        <div class="grid2">
          <div><label>Tên hiển thị</label><input name="name" placeholder="vd. Quầy"></div>
          <div><label>Tên đăng nhập</label><input name="username" placeholder="vd. quay" autocapitalize="off"></div>
          <div><label>Mật khẩu</label><input name="password" autocapitalize="off" autocomplete="new-password"></div>
        </div>
        <button class="btn sm pri" type="submit" style="margin-top:10px">Tạo</button>
      </form>
    </div>`;
  },

  audit(rows){
    const ten = {login: 'Đăng nhập', visit_add: 'Ghi lượt', visit_void: 'Huỷ lượt', reward_give: 'Trao quà',
      reward_ungive: 'Hoàn quà', customer_create: 'Thêm khách', customer_update: 'Sửa khách',
      services_save: 'Sửa dịch vụ', tiers_save: 'Sửa hạng', program_save: 'Sửa chương trình',
      program_del: 'Xoá chương trình', program_off: 'Tắt chương trình', import: 'Nhập KiotViet',
      user_save: 'Sửa tài khoản', change_password: 'Đổi mật khẩu'};
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
