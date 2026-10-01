/* Luồng app: đang ở màn hình nào, bấm nút thì làm gì.

   Không dùng khung nào cả — viết tay còn ngắn hơn đi cài thư viện, và
   máy tính bảng cũ ở quầy mở vẫn nhanh.

   Điều hướng là một chồng màn hình: thanh tab dưới đặt lại chồng, mở thẻ
   khách hay mục thiết lập thì đẩy thêm, nút ‹ thì rút ra.             */

const $ = s => document.querySelector(s);

function toast(msg, kind){
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (kind ? ' ' + kind : '');
  t.hidden = false;
  clearTimeout(toast._h);
  toast._h = setTimeout(() => { t.hidden = true; }, kind === 'bad' ? 5000 : 2600);
}

const App = {
  stack: [{name: 'lookup'}],
  kinds: {}, shop: '', today: '', undoMinutes: 15,
  services: null,
  barbers: null,          /* thợ đang làm — để chọn khi ghi lượt */
  look: {q: '', mode: 'num', rows: null, err: ''},
  cus: {q: '', tier: null, only: '', sort: 'last', limit: 100, barber: null},
  ui: {justGot: []},
  data: {},
  posData: {},
  pos: null,              /* hoá đơn đang lập — giữ nguyên khi chuyển tab qua lại */
  pay: {open: 0},
  mine: {month: ''},
  sched: {date: '', sel: 0, form: null, off: null, mode: 'day'},

  iso(x){ return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); },
  addDays(d, n){ const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return this.iso(x); },
  /* Thứ Hai của tuần chứa ngày d. */
  weekStart(d){ const x = new Date(d + 'T00:00:00'); return this.addDays(d, -((x.getDay() + 6) % 7)); },
  bills: {preset: 'today', from: '', to: '', q: '', barber: '', only: '', pay: '', src: '', limit: 200},

  get cur(){ return this.stack[this.stack.length - 1]; },

  /* Màn hình đủ rộng để đặt danh sách và thẻ khách cạnh nhau. */
  wide(){ return window.innerWidth >= 1200; },

  /* Đang mở thẻ khách từ Tra cứu / Khách hàng trên màn rộng → chia đôi. */
  splitFrom(){
    const prev = this.stack[this.stack.length - 2];
    return this.cur.name === 'card' && prev && (prev.name === 'lookup' || prev.name === 'customers') && this.wide()
      ? prev.name : null;
  },

  fold(s){
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
  },

  async start(){
    API.load();
    document.addEventListener('click',  e => this.onClick(e));
    document.addEventListener('submit', e => this.onSubmit(e));
    document.addEventListener('input',  e => this.onInput(e));
    document.addEventListener('change', e => this.onChange(e));
    document.addEventListener('keydown', e => this.onKey(e));
    /* Kéo cửa sổ hẹp lại / rộng ra thì đổi giữa chia đôi và một cột. */
    let rz;
    window.addEventListener('resize', () => {
      clearTimeout(rz);
      const w = this.wide();
      /* Chỉ vẽ lại màn có chia đôi. Vẽ lại màn Dịch vụ / Hạng là tải lại từ
         máy chủ — mất sạch chỗ đang sửa dở chỉ vì kéo cửa sổ. */
      rz = setTimeout(() => {
        if (w === this._wasWide) return;
        this._wasWide = w;
        if (['card', 'lookup', 'customers'].includes(this.cur.name)) this.render();
        else if (this.cur.name === 'pos') this.drawPos();
      }, 200);
    });
    this._wasWide = this.wide();
    if (API.token){
      try{ this.applyMe(await API.call('me')); }
      catch(e){ /* hết phiên thì API.call đã dọn token; lỗi mạng thì vẫn thử vẽ */ }
    }
    this.go(this.homeTab());
  },

  homeTab(){ return API.isOwner() ? 'dash' : API.isBarber() ? 'bsched' : 'pos'; },

  applyMe(r){
    this.kinds = r.kinds; this.shop = r.shop; this.today = r.today; this.undoMinutes = r.undo_minutes;
    API.save(API.token, r.user);
  },

  /* ---------------- điều hướng ---------------- */

  tabs(){
    if (API.isBarber()) return [['bsched', '📅', 'Lịch hẹn'], ['mine', '🧾', 'Hoá đơn'], ['more', '☰', 'Khác']];
    return API.isOwner()
      ? [['pos', '💳', 'Bán hàng'], ['sched', '📅', 'Lịch hẹn'], ['customers', '👥', 'Khách'], ['day', '📋', 'Sổ ngày'], ['bills', '🧾', 'Hoá đơn'],
         ['dash', '📊', 'Tổng quan'], ['payroll', '💰', 'Lương'], ['more', '⚙︎', 'Thiết lập']]
      : [['pos', '💳', 'Bán hàng'], ['sched', '📅', 'Lịch hẹn'], ['lookup', '🔎', 'Tra khách'], ['day', '📋', 'Báo cáo'], ['more', '☰', 'Khác']];
  },

  go(tab){ this.stack = [{name: tab}]; window.scrollTo(0, 0); return this.render(); },
  push(screen){ this.stack.push(screen); window.scrollTo(0, 0); return this.render(); },
  back(){
    if (this.stack.length > 1) this.stack.pop();
    return this.render();
  },

  /* Các lượt vẽ nối đuôi nhau: bấm nhanh hai mục mà để chạy song song thì
     lượt nào hỏi máy chủ lâu hơn sẽ đè lên lượt mới hơn. */
  render(){
    this._hang = (this._hang || Promise.resolve()).then(() => this._render()).catch(e => toast(e.message, 'bad'));
    return this._hang;
  },

  async _render(){
    const view = $('#view'), tabs = $('#tabs');
    if (!API.token){
      tabs.hidden = true;
      if (!this.shop) try{ this.shop = (await API.call('shop')).shop; }catch(e){}
      view.innerHTML = Views.login(this.shop);
      return;
    }
    if (!this.today) try{ this.applyMe(await API.call('me')); }catch(e){ if (!API.token) return this._render(); }

    const root = this.stack[0].name;
    tabs.hidden = false;
    /* Tên quán và gợi ý phím tắt chỉ hiện khi thanh tab thành thanh bên
       trái trên máy tính (CSS ẩn đi trên điện thoại). */
    tabs.innerHTML = `<div class="brand"><b>✂︎ Hội viên</b><small>${esc(this.shop)}</small></div>`
      + this.tabs().map(([id, ic, ten]) =>
      `<button data-act="tab" data-id="${id}" class="${root === id ? 'on' : ''}"><span>${ic}</span>${ten}</button>`).join('')
      + `<div class="hint"><kbd>/</kbd> tìm khách<br><kbd>Esc</kbd> đóng thẻ</div>`;

    const s = this.cur;
    switch (s.name){
      case 'lookup': {
        view.innerHTML = Views.lookup(this.look);
        const q = $('#q');
        /* Máy ở quầy: mở màn hình là gõ được ngay. Điện thoại thì thôi,
           bàn phím bật lên che nửa màn hình. */
        if (q && window.innerWidth >= 700) q.focus();
        if (this.look.rows && this.look.q) this.search(true);
        break;
      }
      case 'pos': {
        /* Mỗi lần vào lại tải dịch vụ / khuyến mãi — chủ vừa đổi giá ở máy
           khác thì quầy thấy ngay, khỏi lệch tiền lúc thanh toán. */
        this.posData = await API.call('pos_init');
        if (!this.pos) this.posReset();
        this.drawPos();
        const q = $('#posQ');
        if (q && window.innerWidth >= 700 && !this.pos.cus) q.focus();
        break;
      }
      case 'payroll': {
        this.data.payroll = await API.call('payroll', {month: s.month || (this.today || '').slice(0, 7)});
        view.innerHTML = Views.payroll(this.data.payroll, this.pay);
        break;
      }
      case 'bills': {
        if (!this.barbers) this.barbers = (await API.call('barbers')).rows.filter(b => b.active);
        if (!this.bills.from) this.billsPreset('today');
        this.data.bills = await this.billsFetch();
        view.innerHTML = Views.bills(this.bills, this.data.bills);
        break;
      }
      case 'sched': {
        const ui = this.sched;
        if (!ui.date) ui.date = this.today;
        if (ui.mode === 'week' || ui.mode === 'month'){
          /* Tuần: T2 → CN. Tháng: đủ các tuần chứa tháng đó (6 hàng tối đa). */
          let tu, den;
          if (ui.mode === 'week'){ tu = this.weekStart(ui.date); den = this.addDays(tu, 6); }
          else {
            const dau = ui.date.slice(0, 8) + '01';
            const cuoi = this.iso(new Date(Number(dau.slice(0, 4)), Number(dau.slice(5, 7)), 0));
            tu = this.weekStart(dau); den = this.addDays(this.weekStart(cuoi), 6);
          }
          this.data.schedRange = await API.call('book_range', {from: tu, to: den});
          view.innerHTML = Views.schedRange(this.data.schedRange, ui);
          break;
        }
        this.data.sched = await API.call('book_day', {date: ui.date});
        this.drawSched();
        break;
      }
      case 'bsched':
        view.innerHTML = Views.bookMine(await API.call('book_mine'));
        break;
      case 'bookset':
        view.innerHTML = Views.bookSet((await API.call('book_day', {date: this.today})).cfg);
        break;
      case 'backup':
        view.innerHTML = Views.backup(await API.call('backup_info'));
        break;
      case 'mine': {
        this.data.mine = await API.call('my_bills', this.mine.month ? {month: this.mine.month} : {});
        this.mine.month = this.data.mine.month;
        view.innerHTML = Views.mine(this.data.mine);
        break;
      }
      case 'promos':
        view.innerHTML = Views.promos((await API.call('promos')).rows);
        break;
      case 'card': {
        if (!this.barbers) this.barbers = (await API.call('barbers')).rows.filter(b => b.active);
        if (!this.data.card || this.data.card.customer.id !== s.id){
          this.data.card = await API.call('customer_get', {id: s.id});
          this.ui = {justGot: []};
        }
        const tu = this.splitFrom();
        if (tu){
          /* Cột trái vẽ lại từ dữ liệu đang có, không hỏi máy chủ lần nữa. */
          view.innerHTML = `<div class="split"><div class="pane-l">${this.leftHtml(tu)}</div>
            <div class="pane-r" id="cardPane"></div></div>`;
          if (tu === 'lookup' && this.look.rows && this.look.q) this.search(true);
        }
        this.drawCard();
        break;
      }
      case 'newCus':    view.innerHTML = Views.newCus(s.pre || {}); break;
      case 'day':
        /* Danh sách thợ để sửa thợ ngay trên dòng lượt vừa ghi nhầm. */
        if (!this.barbers) this.barbers = (await API.call('barbers')).rows.filter(b => b.active);
        this.data.day = await API.call('day', s.date ? {date: s.date} : {});
        if (!this.shiftUi || this.shiftUi.date !== this.data.day.date) this.shiftUi = {date: this.data.day.date};
        view.innerHTML = Views.day(this.data.day);
        this.shiftLive();
        break;
      case 'more': {
        let ts = null;
        if (!API.isOwner() && !API.isBarber()) try{ ts = (await API.call('tiers')).rows; }catch(e){}
        view.innerHTML = Views.more(ts);
        break;
      }
      case 'dash':
        view.innerHTML = Views.dash(await API.call('dashboard'));
        break;
      case 'customers': {
        const r = await API.call('customers_all');
        this.data.all = r.rows; this.data.tiers = r.tiers; this.data.barbersAll = r.barbers;
        this.drawCustomers();
        break;
      }
      case 'programs':
        this.data.programs = (await API.call('programs')).rows;
        view.innerHTML = Views.programs(this.data.programs);
        break;
      case 'programEdit': view.innerHTML = Views.programEdit(this.data.prog); break;
      case 'tiers': {
        const [t, all, sv] = await Promise.all([API.call('tiers'), API.call('customers_all'), API.call('services')]);
        this.data.tierEdit = t.rows.map(x => Object.assign({}, x));
        this.data.all = all.rows;
        this.data.round = t.round;
        this.data.svcRef = sv.rows.filter(x => x.active && x.price > 0 && x.discountable);
        this.drawTiers();
        break;
      }
      case 'services': {
        const r = await API.call('services');
        this.data.svcEdit = r.rows.map(x => Object.assign({}, x));
        this.data.svcGroups = r.groups.map(x => Object.assign({}, x));
        this.drawSvc();
        break;
      }
      case 'import':    view.innerHTML = Views.importView(this.data.imp || (this.data.imp = {})); break;
      case 'barbers': {
        this.data.barberEdit = (await API.call('barbers')).rows.map(x => Object.assign({}, x));
        view.innerHTML = Views.barbers(this.data.barberEdit);
        break;
      }
      case 'users': {
        const r = await API.call('users');
        view.innerHTML = Views.users(r.rows, r.barbers);
        break;
      }
      case 'audit':     view.innerHTML = Views.audit((await API.call('audit')).rows); break;
      case 'password':  view.innerHTML = Views.password(); break;
      default:          this.stack = [{name: 'lookup'}]; return this._render();
    }
  },

  drawSvc(){
    const y = window.scrollY;
    $('#view').innerHTML = Views.services(this.data.svcEdit, this.data.svcGroups);
    window.scrollTo(0, y);
  },

  /* Chốt ca: gõ tiền đầu ca / tiền đếm được → cập nhật "phải có" và
     chênh lệch ngay, không vẽ lại (bàn phím điện thoại khỏi sập). */
  shiftLive(){
    const d = this.data.day, ui = this.shiftUi;
    if (!d || !$('#shCount')) return;          // đã chốt: chỉ xem, không tính lại
    const n = v => Number(String(v == null ? '' : v).replace(/\D/g, '')) || 0;
    const mo = ui.opening != null ? n(ui.opening) : d.shift.opening;
    const exp = mo + d.shift.cash_sales + d.shift.moves - d.shift.tips_out;
    $('#shExp').innerHTML = tien(exp) + '<small>phải có trong tủ</small>';
    $('#shOpenF').innerHTML = tien(mo) + '<small>đầu ca</small>';
    $('#shOut').textContent = ui.counted ? tien(n(ui.counted) - n(ui.keep)) : '—';
    const box = $('#shDiff');
    if (ui.counted == null || ui.counted === ''){ box.className = 'diffbox'; box.textContent = 'Đếm tiền trong tủ rồi nhập vào ô trên.'; return; }
    const lech = n(ui.counted) - exp;
    box.className = 'diffbox ' + (lech === 0 ? 'ok' : 'bad');
    box.textContent = lech === 0 ? 'Chuẩn ✓ — khớp từng đồng' : (lech > 0 ? 'Dư ' : 'Thiếu ') + tien(Math.abs(lech)) + ' — kiểm lại, hoặc ghi lý do';
  },

  /* Vẽ lại thẻ khách tại chỗ mà không nhảy trang. */
  drawCard(){
    const y = window.scrollY;
    ($('#cardPane') || $('#view')).innerHTML = Views.card(this.data.card, this.ui);
    window.scrollTo(0, y);
  },

  /* ---------------- bán hàng ---------------- */

  posReset(){
    this.pos = {cus: null, q: '', rows: null, err: '', newCus: false, newPhone: '',
                barber: null, lines: [], promo: 0, tip: '', mdReason: '', pay: '', given: '', cashPart: '',
                note: '', date: this.today, done: null,
                /* Mã riêng của hoá đơn đang lập — mất mạng giữa chừng bấm lại
                   thì máy chủ trả hoá đơn cũ, không tạo hai lần. */
                ref: Date.now().toString(36) + Math.random().toString(36).slice(2, 10)};
  },

  /* Cùng công thức với mhQuote (api/lib.php) — đây chỉ để hiện trước;
     máy chủ tính lại và từ chối nếu lệch. */
  quote(){
    const st = this.pos, sv = this.posData.services || [];
    const lines = st.lines.map(l => {
      const s = sv.find(x => x.id === l.sid) || {price: 0, discountable: 0};
      return {svc: s, qty: l.qty, unit: s.price || Number(l.price) || 0,
              mdisc: l.mdOpen ? Number(String(l.mdisc || '').replace(/\D/g, '')) || 0 : 0};
    });
    const gross = lines.map(l => l.unit * l.qty);
    /* Món giảm thêm tay thì bỏ qua hạng / khuyến mãi. */
    const elig = lines.map((l, i) => l.svc.discountable && !l.mdisc ? i : -1).filter(i => i >= 0);
    const chia = (tong, chon) => {
      const ra = {};
      const sum = chon.reduce((a, i) => a + gross[i], 0);
      if (sum <= 0 || tong <= 0) return ra;
      tong = Math.min(tong, sum);
      let co = 0;
      chon.forEach((i, k) => { const d = k === chon.length - 1 ? tong - co : Math.floor(tong * gross[i] / sum); ra[i] = d; co += d; });
      return ra;
    };
    /* Giảm % → làm tròn giá sau giảm của từng món (xuống 5k / 10k…). */
    const [buoc, kieu] = this.posData.round || [1000, 'down'];
    const pct = p => {
      const ra = {};
      elig.forEach(i => {
        const u = lines[i].unit;
        let con = u - Math.round(u * p / 100000) * 1000;
        con = kieu === 'near' ? Math.round(con / buoc) * buoc : Math.floor(con / buoc) * buoc;
        ra[i] = (u - Math.max(0, Math.min(u, con))) * lines[i].qty;
      });
      return ra;
    };
    const tong = o => Object.values(o).reduce((a, b) => a + b, 0);
    const t = st.cus && !st.cus.walkin && st.cus.tier ? st.cus.tier : null;
    const tierPct = t ? t.disc_pct || 0 : 0;
    const tier = tierPct > 0 ? pct(tierPct) : {};
    const promo = (this.posData.promos || []).find(p => p.id === st.promo) || null;
    const pro = promo ? (promo.kind === 'pct' ? pct(promo.value) : chia(promo.value, elig)) : {};
    const laKm = tong(pro) > tong(tier);
    const dung = laKm ? pro : tier;
    let note = tong(dung) > 0 ? (laKm ? 'KM: ' + promo.name : 'Hạng ' + t.name + ' −' + tierPct + '%') : '';
    const disc = lines.map((l, i) => Math.min(gross[i], dung[i] || 0));
    const tay = lines.map((l, i) => Math.min(gross[i], l.mdisc));
    tay.forEach((d, i) => { if (d > 0) disc[i] = d; });
    const ra = {lines: lines.map((l, i) => ({net: gross[i] - disc[i], disc: disc[i], mdisc: tay[i]})), note,
                mdisc: tay.reduce((a, b) => a + b, 0),
                subtotal: gross.reduce((a, b) => a + b, 0), discount: disc.reduce((a, b) => a + b, 0)};
    ra.total = ra.subtotal - ra.discount;
    return ra;
  },

  /* Số đã gõ trong các ô tiền (có dấu chấm) → số nguyên. */
  posNums(){
    const n = v => Number(String(v || '').replace(/\D/g, '')) || 0;
    const st = this.pos;
    st.tipN = n(st.tip); st.givenN = n(st.given); st.cashPartN = n(st.cashPart);
  },

  drawPos(){
    this.posNums();
    const y = window.scrollY;
    const f = document.activeElement && document.activeElement.id;
    $('#view').innerHTML = Views.pos(this.pos, this.posData, this.quote());
    window.scrollTo(0, y);
    if (f && /^pos/.test(f)){ const i = document.getElementById(f); if (i){ i.focus(); try{ i.setSelectionRange(i.value.length, i.value.length); }catch(e){} } }
  },

  /* Gõ tip / tiền khách đưa: chỉ cập nhật mấy con số, không vẽ lại cả
     màn — vẽ lại là bàn phím điện thoại sập xuống sau mỗi chữ số. */
  posLive(){
    this.posNums();
    const st = this.pos, q = this.quote(), tong = q.total + st.tipN;
    const set = (sel, html) => { const e = $(sel); if (e) e.innerHTML = html; };
    set('#posTotal', tien(tong));
    set('#posSub', tien(q.subtotal));
    q.lines.forEach((l, i) => { set('#pnet' + i, tien(l.net)); set('#pdisc' + i, l.disc ? ' · −' + tienGon(l.disc) : ''); });
    const dr = $('#posDiscRow');
    if (dr) dr.style.display = q.discount - q.mdisc ? '' : 'none';
    set('#posDiscNote', 'Giảm · ' + esc(q.note));
    set('#posDiscAmt', '−' + tien(q.discount - q.mdisc));
    set('#posMdAmt', '−' + tien(q.mdisc));
    set('#posChange', Views.posChange(st, tong));
    set('#posCkPart', tien(Math.max(0, tong - st.cashPartN)));
    const nut = document.querySelector('[data-act="posCheckout"]');
    const thieu = Views.posMissing(st, this.posData, q);
    if (nut){ nut.disabled = !!thieu; nut.textContent = 'Thanh toán ' + tien(tong); }
    const w = $('#posWarn');
    if (w){ w.textContent = thieu; w.style.display = thieu ? '' : 'none'; }
  },

  async posPick(id){
    const c = await API.call('customer_get', {id});
    const gifts = [];
    c.rewards.forEach(p => p.pending.forEach(e => gifts.push(e.gift)));
    if (c.bday && c.bday.pending) gifts.push('🎂 ' + c.bday.gift);
    this.pos.cus = {id: c.customer.id, name: c.customer.name, phone: c.customer.phone, tier: c.tier.tier,
                    cuts: c.stats.cuts, last_barber_id: c.last_barber_id, gifts};
    /* Chọn sẵn thợ lượt trước — khách quen phần lớn ngồi lại ghế cũ. */
    if (!this.pos.barber && (this.posData.barbers || []).some(b => b.id === c.last_barber_id)) this.pos.barber = c.last_barber_id;
    this.drawPos();
  },

  async posSearch(){
    const st = this.pos, q = st.q.trim(), so = q.replace(/\D/g, '');
    if (!q){ st.rows = null; st.err = ''; return this.drawPosRes(); }
    const chu = /[^\d\s.\-]/.test(q);
    if (!chu && so.length < 4) return;
    if (!chu && so.length > 4 && so.length < 10) return;
    const luot = this._lp = (this._lp || 0) + 1;
    try{
      const r = await API.call('search', {q});
      if (luot !== this._lp) return;
      st.rows = r.rows; st.err = '';
    }catch(e){ if (luot !== this._lp) return; st.rows = null; st.err = e.message; }
    this.drawPosRes();
  },

  drawPosRes(){ const b = $('#posRes'); if (b) b.innerHTML = Views.posResults(this.pos); },

  async posCheckout(el){
    const st = this.pos;
    this.posNums();
    const q = this.quote();
    const tong = q.total + st.tipN;
    const cash = st.pay === 'cash' ? tong : st.pay === 'mix' ? st.cashPartN : 0;
    el.disabled = true;
    let r;
    try{ r = await API.call('bill_create', {
      customer_id: st.cus && !st.cus.walkin ? st.cus.id : 0,
      barber_id: st.barber || 0,
      items: st.lines.map((l, i) => ({service_id: l.sid, qty: l.qty, price: Number(l.price) || undefined, mdisc: q.lines[i].mdisc,
                                      detail: (l.detail || '').trim()})),
      promo_id: st.promo || 0, mdisc_reason: st.mdReason,
      tip: st.tipN, pay_cash: cash, pay_transfer: tong - cash, note: st.note,
      expect_total: q.total, date: API.isOwner() ? st.date : undefined, client_ref: st.ref, booking_id: st.booking || 0});
    }catch(err){
      /* Giá / hạng / khuyến mãi vừa đổi ở máy khác: tải lại rồi vẽ lại để
         quầy thấy số mới, bấm thanh toán lần nữa. */
      if (err.code === 'price_changed'){ this.posData = await API.call('pos_init'); this.drawPos(); }
      throw err;
    }
    st.done = r;
    st.change = st.pay === 'cash' && st.givenN > tong ? st.givenN - tong : 0;
    if (r.new_rewards && r.new_rewards.length) toast('🎁 Khách vừa đạt quà: ' + r.new_rewards.map(x => x.gift).join(', '), 'ok');
    else toast('Đã thanh toán', 'ok');
    this.data.card = null;
    window.scrollTo(0, 0);
    this.drawPos();
  },

  /* In qua khung ẩn — app thêm ra màn hình chính thì cửa sổ bật lên bị chặn. */
  printHtml(html){
    let f = $('#printFrame');
    if (f) f.remove();
    f = document.createElement('iframe');
    f.id = 'printFrame';
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
    setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); }, 250);
  },

  /* ---------------- lịch hẹn ---------------- */

  drawSched(){
    const y = window.scrollY;
    $('#view').innerHTML = Views.sched(this.data.sched, this.sched);
    window.scrollTo(0, y);
  },

  /* Chỉ vẽ lại khung form / chi tiết phía trên lưới — ô đang gõ giữ nguyên. */
  drawSchedPanel(){
    const p = $('#schedPanel'), d = this.data.sched, ui = this.sched;
    if (!p) return;
    const sel = d.rows.find(x => x.id === ui.sel);
    p.innerHTML = ui.form ? Views.bookForm(ui.form, d) : ui.off ? Views.offForm(ui.off, d) : sel ? Views.bookDetail(sel, d) : '';
  },

  bookOpen(f){
    this.sched.form = Object.assign({id: 0, date: this.sched.date || this.today, start: null, dur: 45, barber_id: 0,
                                     customer: null, name: '', phone: '', services: [], note: '', q: '', rows: null, slots: null, busy: ''}, f);
    this.sched.off = null;
    this.drawSchedPanel();
    const p = $('#schedPanel'); if (p) p.scrollIntoView({block: 'start', behavior: 'smooth'});
    this.bookSlots();
  },

  /* Giờ trống theo ngày / thợ / thời gian đang chọn. */
  async bookSlots(){
    const f = this.sched.form;
    if (!f) return;
    const luot = this._bs = (this._bs || 0) + 1;
    try{
      const r = await API.call('book_slots', {date: f.date, dur: f.dur, barber_id: f.barber_id, id: f.id});
      if (luot !== this._bs || this.sched.form !== f) return;
      f.slots = r.slots;
    }catch(e){ f.slots = []; }
    const b = $('#bkSlots'); if (b) b.innerHTML = Views.bkSlots(f);
  },

  bookDurAuto(){
    const f = this.sched.form, sv = this.data.sched.services;
    const tong = f.services.reduce((a, id) => a + ((sv.find(x => x.id === id) || {}).duration || 30), 0);
    f.dur = Math.max(15, Math.min(240, Math.ceil((tong || 45) / 15) * 15));
  },

  async bookSave(force){
    const f = this.sched.form;
    if (f.start == null) return toast('Chọn giờ.', 'bad');
    const data = {id: f.id, date: f.date, start: f.start, dur: f.dur, barber_id: f.barber_id, services: f.services,
                  note: f.note, force: force ? 1 : 0};
    if (f.customer) data.customer_id = f.customer.id;
    else if (!f.keepCus){ data.name = f.name.trim(); data.phone = f.phone.trim(); }
    else data.name = f.name;
    try{
      await API.call('book_save', data);
    }catch(e){
      if (e.code === 'busy'){ f.busy = e.message + ' Chọn giờ / thợ khác, hoặc bấm "Vẫn đặt".'; return this.drawSchedPanel(); }
      throw e;
    }
    toast(f.id ? 'Đã sửa lịch hẹn' : 'Đã đặt lịch ' + hm(f.start), 'ok');
    this.sched.date = f.date;
    this.sched.form = null;
    return this.render();
  },

  /* Khách đến → màn Bán hàng điền sẵn khách, thợ, dịch vụ của lịch. */
  async bookToPos(b){
    if (b.status === 'booked') await API.call('book_status', {id: b.id, status: 'arrived'});
    this.posReset();
    Object.assign(this.pos, {barber: b.barber_id, booking: b.id, bookingLabel: hm(b.start) + ' · ' + (b.name || ''),
                             lines: b.services.map(v => ({sid: v.id, qty: 1, price: 0}))});
    await this.go('pos');
    this.pos.lines = this.pos.lines.filter(l => (this.posData.services || []).some(x => x.id === l.sid));
    if (b.customer_id) return this.posPick(b.customer_id);
    Object.assign(this.pos, {newCus: true, newPhone: /^\d{10}$/.test(b.phone || '') ? b.phone : '', newName: b.name || ''});
    this.drawPos();
  },

  /* Tải bản sao lưu: máy chủ trả thẳng tệp, không phải JSON. */
  async backupGet(name){
    const res = await fetch(API.url, {method: 'POST', headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API.token},
                                      body: JSON.stringify({action: 'backup_download', name, _t: API.token})});
    if (!res.ok || (res.headers.get('Content-Type') || '').includes('json')){
      let m = 'Không tải được.'; try{ m = (await res.json()).error || m; }catch(e){}
      throw new Error(m);
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },

  /* Sổ hoá đơn: khoảng ngày nhanh, và hỏi máy chủ theo bộ lọc đang chọn. */
  billsPreset(k){
    const d = new Date(this.today + 'T00:00:00');
    const iso = x => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    const lui = n => { const x = new Date(d); x.setDate(x.getDate() - n); return iso(x); };
    const b = this.bills;
    b.preset = k; b.limit = 200;
    if (k === 'today'){ b.from = b.to = this.today; }
    else if (k === 'yday'){ b.from = b.to = lui(1); }
    else if (k === '7d'){ b.from = lui(6); b.to = this.today; }
    else if (k === 'month'){ b.from = this.today.slice(0, 8) + '01'; b.to = this.today; }
    else if (k === 'pmonth'){
      const x = new Date(d.getFullYear(), d.getMonth(), 0);
      b.from = iso(x).slice(0, 8) + '01'; b.to = iso(x);
    }
  },

  billsFetch(){
    const b = this.bills;
    return API.call('bills', {from: b.from, to: b.to, q: b.q, barber: b.barber, only: b.only, pay: b.pay, src: b.src, limit: b.limit});
  },

  /* Đổi bộ lọc: chỉ vẽ lại phần danh sách — ô tìm đang gõ giữ nguyên. */
  async billsReload(full){
    const luot = this._lb = (this._lb || 0) + 1;
    try{
      const d = await this.billsFetch();
      if (luot !== this._lb || this.cur.name !== 'bills') return;
      this.data.bills = d;
      if (full) $('#view').innerHTML = Views.bills(this.bills, d);
      else { const b = $('#billsBody'); if (b) b.innerHTML = Views.billsBody(d); }
    }catch(e){ toast(e.message, 'bad'); }
  },

  findBill(id){
    const ds = [].concat(this.pos && this.pos.done ? [this.pos.done.bill] : [], (this.data.bills || {}).rows || [],
                         ((this.data.bills || {}).reports_open || []).map(r => r.bill).filter(Boolean),
                         (this.data.mine || {}).rows || [], (this.data.mine || {}).unassigned || [],
                         (this.data.day || {}).visits || [], (this.data.card || {}).visits || []);
    return ds.find(v => v.id === id);
  },

  printPayroll(){
    const d = this.data.payroll;
    const t = d.rows.find(x => x.id === this.pay.open);
    const css = `body{font:13px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:16px;color:#000}
      table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:5px 8px;text-align:left}.r{text-align:right}
      .sec td{background:#eee;font-weight:700}.tot td{font-weight:700}.net td{font-weight:800;font-size:15px;background:#f6f0e0}.gap td{border:0;height:14px;padding:0}
      .badge,button{display:none}.dim{color:#555}h1{font-size:18px}`;
    if (t){
      return this.printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>Phiếu lương ${esc(t.name)}</title><style>${css}</style></head><body>
        <h1>${esc(this.shop)} — Phiếu lương ${esc(t.name)} · tháng ${esc(d.month.slice(5))}/${esc(d.month.slice(0, 4))}</h1>
        <p>${d.closed ? 'Đã chốt ' + new Date(d.closed.at * 1000).toLocaleString('vi-VN') : 'Tạm tính — chưa chốt'}</p>
        ${Views.paySheet(t, true)}
        <p style="margin-top:30px;display:flex;justify-content:space-around"><span>Người nhận</span><span>Chủ quán</span></p></body></html>`);
    }
    const dong = d.rows.map(t => `<tr><td>${esc(t.name)}</td><td>${t.bills}</td><td>${tien(t.base)}</td><td>${tien(t.wage)}</td>
      <td>${tien(t.comm)}</td><td>${d.tip_included ? tien(t.tip) : '—'}</td><td>${t.adj ? tien(t.adj) : ''}</td><td><b>${tien(t.total)}</b></td></tr>
      ${t.adjust.map(a => `<tr class="s"><td colspan="7">· ${esc(a.label)}</td><td>${tien(a.amount)}</td></tr>`).join('')}`).join('');
    this.printHtml(`<!doctype html><html><head><meta charset="utf-8"><title>Bảng lương ${esc(d.month)}</title><style>
      body{font:13px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:16px;color:#000}
      table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:5px 8px;text-align:right}
      td:first-child,th:first-child{text-align:left}.s td{border:0;color:#444;font-size:12px}h1{font-size:18px}
    </style></head><body><h1>${esc(this.shop)} — Bảng lương tháng ${esc(d.month.slice(5))}/${esc(d.month.slice(0, 4))}</h1>
      ${d.closed ? `<p>Đã chốt ${new Date(d.closed.at * 1000).toLocaleString('vi-VN')}</p>` : '<p>Tạm tính — chưa chốt</p>'}
      <table><tr><th>Thợ</th><th>HĐ</th><th>Lương cứng</th><th>Tiền công lượt</th><th>Hoa hồng SP</th><th>Tip</th><th>Thưởng/trừ</th><th>Tổng nhận</th></tr>
      ${dong}<tr><td colspan="7"><b>Tổng</b></td><td><b>${tien(d.rows.reduce((a, t) => a + t.total, 0))}</b></td></tr></table></body></html>`);
  },

  leftHtml(tu){
    return tu === 'lookup' ? Views.lookup(this.look)
      : Views.customers(this.data.all || [], this.data.tiers || [], this.cus, {compact: true});
  },

  drawCustomers(){
    const focus = document.activeElement && document.activeElement.id === 'cusQ';
    const trai = $('.split > .pane-l');
    if (trai && this.splitFrom() === 'customers') trai.innerHTML = this.leftHtml('customers');
    else $('#view').innerHTML = Views.customers(this.data.all, this.data.tiers, this.cus,
                                                {table: window.innerWidth >= 1024});
    if (focus){ const i = $('#cusQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  },

  /* Đếm thử: với ngưỡng đang gõ, mỗi hạng có bao nhiêu khách. Cùng luật
     với mhTierOf bên máy chủ — đạt một trong hai, ngưỡng 0 là không xét. */
  tierCounts(){
    const ts = this.data.tierEdit, dem = ts.map(() => 0);
    const dat = (t, c) => {
      const mc = Number(t.min_cuts) || 0, ms = Number(t.min_spend) || 0;
      if (mc <= 0 && ms <= 0) return true;
      return (mc > 0 && c.cuts >= mc) || (ms > 0 && c.spend >= ms);
    };
    (this.data.all || []).forEach(c => {
      if (!c.visits) return;
      let k = 0;
      ts.forEach((t, i) => { if (dat(t, c)) k = i; });
      dem[k]++;
    });
    return dem;
  },

  drawTiers(){
    const y = window.scrollY;
    $('#view').innerHTML = Views.tiers(this.data.tierEdit, this.tierCounts(), this.data.round, this.data.svcRef);
    window.scrollTo(0, y);
  },

  /* ---------------- tra cứu ---------------- */

  async search(quiet){
    const q = this.look.q.trim();
    const so = q.replace(/\D/g, '');
    if (!q){ this.look.rows = null; this.look.err = ''; return this.drawResults(); }
    if (this.look.mode === 'num' && so.length < 4) return;
    const luot = this._luot = (this._luot || 0) + 1;
    try{
      const r = await API.call('search', {q});
      if (luot !== this._luot) return;      // đã gõ tiếp, bỏ kết quả cũ
      this.look.rows = r.rows; this.look.err = '';
    }catch(e){
      if (luot !== this._luot) return;
      this.look.rows = null; this.look.err = e.message;
    }
    this.drawResults();
    /* Đúng một người khớp 4 số cuối thì vẫn để quầy bấm chọn — tự mở
       thẳng thì lỡ khách mới trùng đuôi số với khách cũ là ghi nhầm người. */
  },

  drawResults(){
    const box = $('#results');
    if (box && (this.cur.name === 'lookup' || this.splitFrom() === 'lookup')) box.innerHTML = Views.results(this.look);
  },

  /* Nút hai nhịp thay cho hộp confirm() — hộp thoại bị chặn khi app được
     thêm ra màn hình chính. Bấm lần đầu nút đổi chữ, bấm lần nữa mới làm. */
  hoiLai(el, hoi){
    if (el.dataset.sure === '1') return true;
    const cu = el.textContent;
    el.dataset.sure = '1';
    el.textContent = hoi;
    el.classList.add('hoi');
    setTimeout(() => {
      if (el.isConnected){ el.dataset.sure = ''; el.textContent = cu; el.classList.remove('hoi'); }
    }, 4000);
    return false;
  },

  /* ---------------- bấm ---------------- */

  async onClick(e){
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const id = Number(el.dataset.id);

    if (act === 'tab')    return this.go(el.dataset.id);
    if (act === 'back')   return this.back();
    if (act === 'reload') return this.render();
    if (act.startsWith('go:')){
      /* Vào lại màn Nhập thì bắt đầu sạch — để nguyên kết quả lần trước là
         có nút "Áp dụng" của một file cũ nằm chờ. */
      if (act === 'go:import') this.data.imp = {};
      return this.push({name: act.slice(3)});
    }

    try{
      switch (act){
        case 'mode':
          this.look = {q: '', mode: this.look.mode === 'num' ? 'text' : 'num', rows: null, err: ''};
          await this.render();
          $('#q').focus();
          return;
        case 'open':
          this.data.card = null;
          /* Đang chia đôi mà bấm khách khác ở cột trái: thay thẻ bên phải,
             không chồng thêm — không thì phải bấm ‹ mười lần mới về. */
          if (this.splitFrom()){
            this.stack[this.stack.length - 1] = {name: 'card', id};
            return this.render();
          }
          return this.push({name: 'card', id});
        case 'newCus': {
          /* Đang chia đôi thì bỏ thẻ bên phải trước — tạo xong khách mới là
             thẻ mới mở đúng chỗ đó, không chồng lên thẻ cũ. */
          if (this.splitFrom()) this.stack.pop();
          const so = this.look.q.replace(/\D/g, '');
          return this.push({name: 'newCus', pre: {phone: so.length >= 10 ? so : ''}});
        }
        /* ----- bán hàng ----- */
        case 'sellFor': {
          const c = this.data.card;
          this.posReset();
          this.pos.cus = {id: c.customer.id, name: c.customer.name, phone: c.customer.phone, tier: c.tier.tier,
                          cuts: c.stats.cuts, last_barber_id: c.last_barber_id,
                          gifts: [].concat(...c.rewards.map(p => p.pending.map(e => e.gift)), c.bday && c.bday.pending ? ['🎂 ' + c.bday.gift] : [])};
          this.pos.barber = c.last_barber_id;
          await this.go('pos');
          /* Thợ lượt trước đã nghỉ thì bỏ chọn. */
          if (!(this.posData.barbers || []).some(b => b.id === this.pos.barber)){ this.pos.barber = null; this.drawPos(); }
          return;
        }
        case 'posPick':     return await this.posPick(id);
        case 'posWalkin':   this.pos.cus = {walkin: true}; return this.drawPos();
        case 'posCusClear': Object.assign(this.pos, {cus: null, q: '', rows: null, err: ''}); return this.drawPos();
        case 'posNewCus': {
          const so = this.pos.q.replace(/\D/g, '');
          Object.assign(this.pos, {newCus: !this.pos.newCus, newPhone: so.length >= 10 ? so : ''});
          this.drawPos();
          const i = document.querySelector('#posNewCus [name=' + (this.pos.newPhone ? 'name' : 'phone') + ']');
          if (i) i.focus();
          return;
        }
        case 'posBarber':   this.pos.barber = this.pos.barber === id ? null : id; return this.drawPos();
        case 'posAdd': {
          const s = (this.posData.services || []).find(x => x.id === id);
          const l = this.pos.lines.find(x => x.sid === id);
          /* Dịch vụ giá cố định bấm lại là thêm số lượng; sản phẩm nhập giá
             thì mỗi lần bấm một dòng — hai món giá khác nhau. */
          if (l && s && s.price) l.qty++;
          else this.pos.lines.push({sid: id, qty: 1, price: 0});
          this.drawPos();
          /* Sản phẩm: gõ tên trước (chọn tên cũ là giá tự điền), rồi tới giá. */
          const o = s && s.kind === 'product' ? document.querySelectorAll('[data-pdetail]')
                  : s && !s.price ? document.querySelectorAll('[data-pprice]') : [];
          if (o.length) o[o.length - 1].focus();
          return;
        }
        /* ----- lịch hẹn ----- */
        case 'schedDay': {
          const k = Number(el.dataset.d), ui = this.sched;
          if (!k) ui.date = this.today;
          else if (ui.mode === 'week') ui.date = this.addDays(ui.date, 7 * k);
          else if (ui.mode === 'month'){ const x = new Date(ui.date.slice(0, 8) + '01T00:00:00'); x.setMonth(x.getMonth() + k); ui.date = this.iso(x); }
          else ui.date = this.addDays(ui.date, k);
          Object.assign(ui, {sel: 0, form: null, off: null});
          return this.render();
        }
        case 'schedMode':
          Object.assign(this.sched, {mode: el.dataset.k, sel: 0, form: null, off: null});
          return this.render();
        /* Từ tuần / tháng bấm một ngày (hay một lịch) → mở lịch ngày đó. */
        case 'schedGo':
          Object.assign(this.sched, {mode: 'day', date: el.dataset.d, sel: id || 0, form: null, off: null});
          await this.render();
          if (id){ const p = $('#schedPanel'); if (p) p.scrollIntoView({block: 'start'}); }
          return;
        case 'schedAt': {
          /* Bấm chỗ trống trên cột thợ → đặt lịch đúng thợ, đúng giờ (làm tròn theo bước). */
          if (e.target !== el && !e.target.classList.contains('sline')) return;
          const c = this.data.sched.cfg, r = el.getBoundingClientRect();
          const t = c.open + Math.floor((e.clientY - r.top) / 1.3 / c.step) * c.step;
          return this.bookOpen({barber_id: Number(el.dataset.b), start: Math.max(c.open, Math.min(c.close - 15, t))});
        }
        case 'schedSel':
          Object.assign(this.sched, {sel: id, form: null, off: null});
          this.drawSched();
          $('#schedPanel').scrollIntoView({block: 'start', behavior: 'smooth'});
          return;
        case 'schedClose': Object.assign(this.sched, {sel: 0, form: null, off: null}); return this.drawSched();
        case 'bookNew':  return this.bookOpen({});
        case 'offNew':   Object.assign(this.sched, {off: {date: this.sched.date}, form: null}); return this.drawSchedPanel();
        case 'offDel':
          if (!this.hoiLai(el, 'Bỏ?')) return;
          await API.call('book_off_del', {id});
          return this.render();
        case 'bookEdit': {
          const b = this.data.sched.rows.find(x => x.id === id);
          return this.bookOpen({id: b.id, date: b.date, start: b.start, dur: b.dur, barber_id: b.any ? 0 : b.barber_id,
                                services: b.services.map(v => v.id), note: b.note, keepCus: true, name: b.name, phone: b.phone});
        }
        case 'bookConfirm': case 'bookNoshow': case 'bookCancel': case 'bookBack': {
          const st = {bookConfirm: 'confirm', bookNoshow: 'noshow', bookCancel: 'cancel', bookBack: 'booked'}[act];
          if ((st === 'cancel' || st === 'noshow') && !this.hoiLai(el, 'Chắc chưa?')) return;
          await API.call('book_status', {id, status: st});
          toast({confirm: 'Đã xác nhận', noshow: 'Đã ghi không đến', cancel: 'Đã huỷ lịch', booked: 'Đã đặt lại'}[st], 'ok');
          return this.render();
        }
        case 'bookToPos': {
          const b = ((this.data.sched || {}).rows || []).concat(this.posData.bookings || []).find(x => x.id === id);
          if (b) return this.bookToPos(b);
          return;
        }
        case 'bkSvc': {
          const f = this.sched.form, k = f.services.indexOf(id);
          if (k >= 0) f.services.splice(k, 1); else f.services.push(id);
          this.bookDurAuto(); f.busy = '';
          this.drawSchedPanel();
          return this.bookSlots();
        }
        case 'bkBarber': this.sched.form.barber_id = id; this.sched.form.busy = ''; this.drawSchedPanel(); return this.bookSlots();
        case 'bkTime':   this.sched.form.start = Number(el.dataset.t); this.sched.form.busy = ''; return this.drawSchedPanel();
        case 'bkPick': {
          const f = this.sched.form, r = (f.rows || []).find(x => x.id === id);
          f.customer = r; f.rows = null; f.q = '';
          return this.drawSchedPanel();
        }
        case 'bkCusClear': Object.assign(this.sched.form, {customer: null, keepCus: false, name: '', phone: ''}); return this.drawSchedPanel();
        case 'bkSave':
          el.disabled = true;
          return await this.bookSave(!!el.dataset.force);
        case 'copyLink':
          try{ await navigator.clipboard.writeText($('#bookLink').textContent); toast('Đã chép link', 'ok'); }
          catch(err){ toast('Không chép được — bôi đen link rồi chép tay.', 'bad'); }
          return;
        case 'backupNow': {
          el.disabled = true; el.textContent = 'Đang sao lưu…';
          const r = (await API.call('backup_now', {mail: 1})).result;
          toast(r.ok && !r.error ? 'Đã sao lưu' + (r.mailed ? ' & gửi Gmail' : '') : 'Sao lưu lỗi: ' + r.error, r.ok && !r.error ? 'ok' : 'bad');
          return this.render();
        }
        case 'backupGet':
          el.disabled = true;
          await this.backupGet(el.dataset.name);
          el.disabled = false;
          return;
        /* Báo sai: mở ô ghi chú ngay trong chi tiết hoá đơn. */
        case 'repOpen': {
          const box = document.getElementById('rep' + el.dataset.k);
          if (box) box.innerHTML = Views.reportForm(id || 0, el.dataset.date || '');
          const ta = box && box.querySelector('textarea');
          if (ta) ta.focus();
          return;
        }
        case 'repReopen':
          await API.call('report_resolve', {id, reopen: 1});
          return this.render();
        case 'mineMonth':
          this.mine.month = el.dataset.m;
          return this.render();
        case 'billsPreset':
          this.billsPreset(el.dataset.k);
          return this.billsReload(true);
        case 'billsMore': {
          this.bills.limit += 300;
          const y = window.scrollY;
          await this.billsReload(false);
          window.scrollTo(0, y);
          return;
        }
        /* Giảm thêm tay một món: mở ô nhập số tiền giảm; bấm × là bỏ. */
        case 'posMd': {
          const i = Number(el.dataset.i), l = this.pos.lines[i];
          l.mdOpen = !l.mdOpen;
          if (!l.mdOpen) l.mdisc = '';
          this.drawPos();
          if (l.mdOpen){ const o = document.getElementById('posMd' + i); if (o) o.focus(); }
          return;
        }
        case 'posQty': {
          const i = Number(el.dataset.i), l = this.pos.lines[i];
          l.qty += Number(el.dataset.d);
          if (l.qty <= 0) this.pos.lines.splice(i, 1);
          return this.drawPos();
        }
        case 'posPay':
          this.pos.pay = el.dataset.k;
          this.drawPos();
          if (this.pos.pay === 'cash' && $('#posGiven') && window.innerWidth >= 700) $('#posGiven').focus();
          if (this.pos.pay === 'mix' && $('#posCashPart')) $('#posCashPart').focus();
          return;
        case 'posGivenSet': this.pos.given = el.dataset.v; return this.drawPos();
        /* await: trả thẳng promise thì lỗi máy chủ lọt khỏi try, quầy không
           thấy báo gì, nút kẹt ở mờ. */
        case 'posCheckout': return await this.posCheckout(el);
        case 'posReset':
          if (this.pos.lines.length && !this.pos.done && !this.hoiLai(el, 'Xoá thật?')) return;
          this.posReset();
          await this.render();
          return;
        case 'printBill': {
          const v = this.findBill(id);
          if (v) this.printHtml(Views.receipt(v, this.shop));
          return;
        }

        /* ----- lương ----- */
        case 'payOpen':
          this.pay.open = id;
          $('#view').innerHTML = Views.payroll(this.data.payroll, this.pay);
          return;
        case 'payAdjDel': {
          if (!this.hoiLai(el, 'Xoá?')) return;
          this.data.payroll = await API.call('payroll_adjust_del', {id});
          $('#view').innerHTML = Views.payroll(this.data.payroll, this.pay);
          return;
        }
        case 'payClose': {
          if (!this.hoiLai(el, 'Chốt thật? Bấm lần nữa')) return;
          const m = this.data.payroll.month;
          this.data.payroll = await API.call('payroll_close', {month: m, force: m >= this.today.slice(0, 7) ? 1 : 0});
          toast('Đã chốt lương tháng ' + m.slice(5), 'ok');
          $('#view').innerHTML = Views.payroll(this.data.payroll, this.pay);
          return;
        }
        case 'payReopen': {
          if (!this.hoiLai(el, 'Mở lại?')) return;
          this.data.payroll = await API.call('payroll_reopen', {month: this.data.payroll.month});
          $('#view').innerHTML = Views.payroll(this.data.payroll, this.pay);
          return;
        }
        case 'payPrint': return this.printPayroll();
        case 'payCopy': {
          el.disabled = true;
          const r = await API.call('payroll_adjust_copy', {month: this.data.payroll.month, barber_id: id});
          this.data.payroll = r;
          toast(r.copied ? 'Đã chép ' + r.copied + ' khoản' : 'Các khoản hằng tháng đã có đủ', 'ok');
          $('#view').innerHTML = Views.payroll(this.data.payroll, this.pay);
          return;
        }

        /* ----- chốt ca ----- */
        case 'shiftEdit':   this.shiftUi = {date: this.data.day.date, edit: true}; return this.render();
        case 'shiftCancel': this.shiftUi = {date: this.data.day.date}; return this.render();
        case 'shiftClose': {
          const ui = this.shiftUi, n = v => Number(String(v == null ? '' : v).replace(/\D/g, '')) || 0;
          if (ui.counted == null || ui.counted === '') return toast('Đếm tiền trong tủ rồi nhập vào ô "Tiền đếm được".', 'bad');
          el.disabled = true;
          const r = await API.call('shift_close', {date: this.data.day.date,
            opening: ui.opening != null ? n(ui.opening) : this.data.day.shift.opening,
            counted: n(ui.counted), keep: n(ui.keep), note: ui.note || ''});
          toast(r.diff === 0 ? 'Đã chốt ca — chuẩn ✓' : 'Đã chốt ca, lệch ' + tien(r.diff), r.diff === 0 ? 'ok' : '');
          this.shiftUi = {date: this.data.day.date};
          return this.render();
        }
        case 'moveDel': {
          if (!this.hoiLai(el, 'Bỏ?')) return;
          await API.call('cash_move_del', {id});
          return this.render();
        }
        case 'promoDel': {
          if (!this.hoiLai(el, 'Xoá?')) return;
          $('#view').innerHTML = Views.promos((await API.call('promo_del', {id})).rows);
          return;
        }
        case 'merge': {
          if (!this.hoiLai(el, 'Chắc chưa? Bấm lần nữa')) return;
          el.disabled = true;
          this.data.card = await API.call('customer_merge', {into: this.data.card.customer.id, from: id});
          Object.assign(this.ui, {mergeQ: '', mergeRows: null, mergeOpen: false});
          toast('Đã gộp khách', 'ok');
          this.drawCard();
          return this.refreshLeft();
        }
        case 'saveBday': {
          const box = $('#bdBox'), v = k => box.querySelector(`[data-bd="${k}"]`).value;
          if (!Number(v('day')) || !Number(v('month'))) return toast('Chọn ngày và tháng sinh.', 'bad');
          el.disabled = true;
          this.data.card = await API.call('customer_birthday', {id: this.data.card.customer.id,
                                                              day: v('day'), month: v('month'), year: v('year')});
          toast('Đã lưu ngày sinh', 'ok');
          this.drawCard();
          return this.refreshLeft();
        }
        case 'giveBday': {
          if (!this.hoiLai(el, 'Chắc chưa?')) return;
          el.disabled = true;
          this.data.card = await API.call('birthday_give', {customer_id: this.data.card.customer.id});
          toast('Đã ghi nhận trao quà sinh nhật', 'ok');
          this.drawCard();
          return this.refreshLeft();
        }
        case 'ungiveBday': {
          if (!this.hoiLai(el, 'Hoàn thật?')) return;
          this.data.card = await API.call('birthday_ungive', {customer_id: this.data.card.customer.id,
                                                            year: Number(el.dataset.year)});
          toast('Đã hoàn quà sinh nhật', 'ok');
          return this.drawCard();
        }
        case 'goNoBday':
          Object.assign(this.cus, {only: 'nobday', tier: null, barber: null, q: '', sort: 'last', limit: 100});
          return this.go('customers');
        case 'aliasDel': {
          if (!this.hoiLai(el, 'Bỏ?')) return;
          this.data.card = await API.call('alias_del', {phone: el.dataset.phone});
          toast('Đã bỏ số phụ', 'ok');
          return this.drawCard();
        }
        case 'give': {
          if (!this.hoiLai(el, 'Chắc chưa?')) return;
          el.disabled = true;
          this.data.card = await API.call('reward_give', {customer_id: this.data.card.customer.id,
                                                          program_id: Number(el.dataset.p), seq: Number(el.dataset.s)});
          this.ui.justGot = [];
          toast('Đã ghi nhận trao quà', 'ok');
          this.drawCard();
          return this.refreshLeft();
        }
        case 'ungive': {
          if (!this.hoiLai(el, 'Hoàn thật?')) return;
          this.data.card = await API.call('reward_ungive', {id});
          toast('Đã hoàn — quà hiện lại là chờ trao', 'ok');
          this.drawCard();
          return this.refreshLeft();
        }
        case 'void': {
          if (!this.hoiLai(el, 'Huỷ thật?')) return;
          el.disabled = true;
          const r = await API.call('visit_void', {id, reason: API.isOwner() ? 'Chủ quán huỷ' : ''});
          toast('Đã huỷ lượt', 'ok');
          if (this.cur.name === 'card'){ this.data.card = r; this.drawCard(); return this.refreshLeft(); }
          return this.render();
        }
        case 'theme': {
          const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
          document.documentElement.dataset.theme = t;
          $('#tc').content = t === 'light' ? '#f6f3ee' : '#0f0e0c';
          try{ localStorage.setItem('memberhub.theme', t); }catch(err){}
          return;
        }
        case 'logout':
          try{ await API.call('logout'); }catch(err){}
          API.clear();
          /* Máy quầy dùng chung: chủ đăng xuất xong thì danh sách khách (có
             số điện thoại đầy đủ) không được nằm lại trong bộ nhớ trang. */
          this.today = ''; this.data = {}; this.services = null; this.barbers = null; this.pos = null; this.posData = {};
          this.look = {q: '', mode: 'num', rows: null, err: ''};
          return this.go('pos');

        /* danh sách khách */
        case 'cf': {
          const k = el.dataset.k;
          if (k === 'all'){ this.cus.tier = null; this.cus.only = ''; }
          else if (k === 'tier'){ this.cus.tier = Number(el.dataset.v); this.cus.only = ''; }
          else { this.cus.only = this.cus.only === k ? '' : k; this.cus.tier = null; }
          this.cus.limit = 100;
          return this.drawCustomers();
        }
        case 'cs':   this.cus.sort = el.dataset.k; return this.drawCustomers();
        case 'cb':   this.cus.barber = id || null; this.cus.limit = 100; return this.drawCustomers();
        case 'more': this.cus.limit += 200; return this.drawCustomers();

        /* chương trình */
        case 'editProg': {
          const p = (this.data.programs || []).find(x => x.id === id);
          this.data.prog = p ? JSON.parse(JSON.stringify(p))
            : {id: 0, name: '', kind: 'cut', steps: [{at: 3, gift: ''}], repeat: 1, start_date: this.today, end_date: '', active: 1};
          return this.push({name: 'programEdit'});
        }
        case 'stepAdd': {
          const st = this.data.prog.steps;
          st.push({at: (st.length ? Number(st[st.length - 1].at) || 0 : 0) + 1, gift: ''});
          return this.render();
        }
        case 'stepDel': this.data.prog.steps.splice(Number(el.dataset.i), 1); return this.render();
        case 'saveProg': {
          el.disabled = true;
          const p = this.data.prog;
          await API.call('program_save', Object.assign({}, p, {steps: p.steps.map(s => ({at: Number(s.at), gift: s.gift}))}));
          toast('Đã lưu chương trình', 'ok');
          return this.back();
        }
        case 'delProg': {
          if (!this.hoiLai(el, 'Bấm lần nữa để xoá')) return;
          const r = await API.call('program_del', {id: this.data.prog.id});
          toast(r.kept ? 'Đã có khách nhận quà nên chỉ tắt chương trình, lịch sử giữ nguyên' : 'Đã xoá', 'ok');
          return this.back();
        }

        /* hạng */
        case 'tierAdd': {
          const ts = this.data.tierEdit, cuoi = ts[ts.length - 1] || {};
          ts.push({id: 0, name: 'Hạng mới', color: '#7a5cff', min_cuts: (Number(cuoi.min_cuts) || 0) + 10,
                   min_spend: (Number(cuoi.min_spend) || 0) + 2000000, perks: '', disc_pct: (Number(cuoi.disc_pct) || 0) + 5});
          return this.drawTiers();
        }
        case 'tierDel': this.data.tierEdit.splice(Number(el.dataset.i), 1); return this.drawTiers();
        case 'saveTiers': {
          el.disabled = true;
          await API.call('tiers_save', {rows: this.data.tierEdit});
          toast('Đã lưu hạng', 'ok');
          return this.back();
        }

        /* dịch vụ */
        case 'svcAdd': case 'svcAddIn': {
          const g = el.dataset.g || (this.data.svcGroups[0] || {}).code || 'A';
          this.data.svcEdit.push({id: 0, name: '', kind: g === 'D' ? 'product' : g === 'C' ? 'perm' : 'cut', price: 0, kv_codes: '',
                                  active: 1, wage: 0, comm_pct: 0, discountable: g === 'D' ? 0 : 1, grp: g, note: '',
                                  duration: g === 'D' ? 0 : g === 'B' ? 60 : g === 'C' ? 90 : 45, bookable: g === 'D' ? 0 : 1});
          return this.drawSvc();
        }
        case 'svcUp': {
          /* Đổi chỗ với dịch vụ đứng trước trong CÙNG nhóm. */
          const i = Number(el.dataset.i), a = this.data.svcEdit;
          let j = i - 1;
          while (j >= 0 && a[j].grp !== a[i].grp) j--;
          if (j >= 0) [a[j], a[i]] = [a[i], a[j]];
          return this.drawSvc();
        }
        case 'grpAdd': {
          const g = this.data.svcGroups, dung = new Set(g.map(x => x.code));
          let c = 'A'; while (dung.has(c)) c = String.fromCharCode(c.charCodeAt(0) + 1);
          g.push({code: c, name: 'Nhóm mới'});
          return this.drawSvc();
        }
        case 'grpDel': {
          const g = this.data.svcGroups, k = Number(el.dataset.i);
          if (this.data.svcEdit.some(x => x.grp === g[k].code)) return toast('Nhóm còn dịch vụ — chuyển dịch vụ sang nhóm khác trước.', 'bad');
          g.splice(k, 1);
          return this.drawSvc();
        }
        case 'saveSvc': {
          el.disabled = true;
          await API.call('services_save', {rows: this.data.svcEdit, groups: this.data.svcGroups});
          this.services = null;
          toast('Đã lưu dịch vụ — lượt cũ đã được xếp loại lại', 'ok');
          return this.back();
        }

        /* thợ cắt */
        case 'barberAdd':
          this.data.barberEdit.push({id: 0, name: '', kv_name: '', active: 1, base_salary: 0});
          return $('#view').innerHTML = Views.barbers(this.data.barberEdit);
        case 'saveBarbers': {
          el.disabled = true;
          await API.call('barbers_save', {rows: this.data.barberEdit});
          this.barbers = null;
          toast('Đã lưu thợ cắt', 'ok');
          return this.back();
        }
        case 'thoKhach':
          Object.assign(this.cus, {barber: id, tier: null, only: '', sort: 'cuts', q: '', limit: 100});
          return this.go('customers');

        case 'importGo':
          el.disabled = true;               // bấm hai lần là gửi hai lượt ghi
          return await this.importRun(true);
      }
    }catch(err){
      toast(err.message, 'bad');
      if (el.isConnected) el.disabled = false;
    }
  },

  async changeBarber(vid, bid){
    try{
      const r = await API.call('visit_barber', {id: vid, barber_id: bid});
      toast('Đã đổi thợ', 'ok');
      if (this.cur.name === 'card'){ this.data.card = r; this.drawCard(); }
      else this.render();
    }catch(e){ toast(e.message, 'bad'); this.render(); }
  },

  /* Cột trái (khi chia đôi) cập nhật theo: số lần cắt, huy hiệu 🎁… */
  async refreshLeft(){
    const tu = this.splitFrom();
    if (tu === 'lookup') return this.search(true);
    if (tu === 'customers'){
      try{ this.data.all = (await API.call('customers_all')).rows; this.drawCustomers(); }catch(e){}
    }
  },

  /* ---------------- nhập KiotViet ---------------- */

  /* Nhiều file (mỗi năm một file) gộp thành một lượt nhập. Hoá đơn trùng
     mã giữa các file chỉ giữ một. */
  async importFiles(files){
    files = [...files];
    const st = this.data.imp = {fileName: files.map(f => f.name).join(', '), fileCount: files.length,
                                busy: 'Đang đọc file…'};
    $('#view').innerHTML = Views.importView(st);
    try{
      const gop = {invoices: [], lines: 0, cancelled: 0, from: null, to: null, withPhone: 0};
      const daCo = new Set();
      for (const f of files){
        let r;
        try{ r = await KiotViet.parse(await f.arrayBuffer()); }
        catch(e){ throw new Error(f.name + ': ' + e.message); }
        r.invoices.forEach(h => { if (!daCo.has(h.c)){ daCo.add(h.c); gop.invoices.push(h); } });
        gop.lines += r.lines; gop.cancelled += r.cancelled;
        if (r.from && (!gop.from || r.from < gop.from)) gop.from = r.from;
        if (r.to && (!gop.to || r.to > gop.to)) gop.to = r.to;
      }
      gop.withPhone = gop.invoices.filter(h => h.p.length >= 9).length;
      st.file = gop;
      st.busy = 'Đang so với dữ liệu trong app…';
      $('#view').innerHTML = Views.importView(st);
      await this.importRun(false);
    }catch(e){
      st.busy = ''; st.err = e.message;
      $('#view').innerHTML = Views.importView(st);
    }
  },

  async importRun(commit){
    const st = this.data.imp;
    if (commit){ st.busy = 'Đang ghi…'; $('#view').innerHTML = Views.importView(st); }
    try{
      st.result = await API.call('import', {invoices: st.file.invoices, commit});
      st.busy = ''; st.err = '';
      if (commit){ toast('Đã nhập xong', 'ok'); this.services = null; this.barbers = null; }
    }catch(e){ st.busy = ''; st.err = e.message; }
    $('#view').innerHTML = Views.importView(st);
  },

  /* ---------------- phím tắt (máy tính) ---------------- */

  onKey(e){
    const dangGo = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || '');
    if (e.key === '/' && !dangGo){
      const o = $('#q') || $('#cusQ') || $('#posQ');
      if (o){ e.preventDefault(); o.focus(); o.select(); }
      return;
    }
    if (e.key === 'Escape' && this.cur.name === 'card' && API.token){
      e.preventDefault();
      if (document.activeElement) document.activeElement.blur();
      this.back();
    }
  },

  /* ---------------- gõ ---------------- */

  onInput(e){
    const t = e.target;
    if (t.id === 'q'){
      this.look.q = t.value;
      const so = t.value.replace(/\D/g, '');
      clearTimeout(this._tq);
      /* Đủ 4 số là tìm luôn, không bắt bấm Enter — khách đứng chờ. */
      if (this.look.mode === 'num'){
        if (so.length === 4 || so.length >= 10) this.search();
        else if (!so){ this.look.rows = null; this.look.err = ''; this.drawResults(); }
      } else {
        this._tq = setTimeout(() => this.search(), 300);
      }
      return;
    }
    if (t.id === 'mergeQ'){
      this.ui.mergeQ = t.value; this.ui.mergeOpen = true;
      clearTimeout(this._tm);
      this._tm = setTimeout(async () => {
        const q = t.value.trim();
        let rows = null;
        if (q.replace(/\D/g, '').length >= 4 || (q.length >= 2 && /\D/.test(q))){
          try{ rows = (await API.call('search', {q})).rows; }catch(err){ rows = []; }
        }
        this.ui.mergeRows = rows;
        const box = $('#mergeRes');
        if (box) box.innerHTML = Views.mergeResults(rows, this.data.card.customer.id);
      }, 300);
      return;
    }
    if (t.id === 'bkQ'){
      const f = this.sched.form; f.q = t.value;
      clearTimeout(this._tk);
      const q = t.value.trim(), so = q.replace(/\D/g, '');
      const go = so.length === 4 || so.length >= 10 || (/[^\d\s.\-]/.test(q) && q.length >= 2);
      if (!q){ f.rows = null; f.err = ''; }
      if (!go){ const b = $('#bkRes'); if (b) b.innerHTML = Views.bkResults(f); return; }
      this._tk = setTimeout(async () => {
        try{ f.rows = (await API.call('search', {q})).rows; f.err = ''; }catch(err){ f.rows = null; f.err = err.message; }
        const b = $('#bkRes'); if (b) b.innerHTML = Views.bkResults(f);
      }, 300);
      return;
    }
    if (t.id === 'bkName' || t.id === 'bkPhone' || t.id === 'bkNote'){
      this.sched.form[{bkName: 'name', bkPhone: 'phone', bkNote: 'note'}[t.id]] = t.value;
      return;
    }
    if (t.id === 'bQ'){
      this.bills.q = t.value; this.bills.limit = 200;
      clearTimeout(this._tb);
      this._tb = setTimeout(() => this.billsReload(false), 350);
      return;
    }
    if (t.id === 'cusQ'){
      this.cus.q = t.value; this.cus.limit = 100;
      clearTimeout(this._tc);
      this._tc = setTimeout(() => this.drawCustomers(), 200);
      return;
    }
    if (t.id === 'posQ'){
      this.pos.q = t.value;
      clearTimeout(this._tp);
      const so = t.value.replace(/\D/g, '');
      if (/[^\d\s.\-]/.test(t.value)) this._tp = setTimeout(() => this.posSearch(), 300);
      else if (so.length === 4 || so.length >= 10 || !so) this.posSearch();
      return;
    }
    if (/^sh(Open|Count|Keep|Note)$/.test(t.id)){
      if (t.dataset.money !== undefined) this.dinhDangTien(t);
      this.shiftUi[{shOpen: 'opening', shCount: 'counted', shKeep: 'keep', shNote: 'note'}[t.id]] = t.value;
      return this.shiftLive();
    }
    if (t.closest && t.closest('#moveForm, #payAdjForm, #kpiForm')){
      if (t.dataset.money !== undefined) this.dinhDangTien(t);
      return;
    }
    if (this.pos && t.closest && t.closest('.poswrap')){
      if (t.dataset.money !== undefined) this.dinhDangTien(t);
      if (t.dataset.pprice !== undefined){
        this.pos.lines[Number(t.dataset.pprice)].price = Number(t.value.replace(/\D/g, '')) || 0;
        /* Giá đổi thì giảm giá và thành tiền từng dòng đổi theo — vẽ lại khi
           rời ô (change), lúc đang gõ chỉ cập nhật tổng. */
      }
      if (t.dataset.pmd !== undefined) this.pos.lines[Number(t.dataset.pmd)].mdisc = t.value;
      if (t.dataset.pdetail !== undefined){
        /* Chọn đúng tên đã bán trước đây → điền giá lần bán gần nhất nếu ô giá còn trống. */
        const i = Number(t.dataset.pdetail), l = this.pos.lines[i];
        l.detail = t.value;
        const ds = (this.posData.product_names || {})[l.sid] || [];
        const cu = ds.find(x => x.name.toLowerCase() === t.value.trim().toLowerCase());
        if (cu && cu.price && !l.price){
          l.price = cu.price;
          const o = document.querySelector(`[data-pprice="${i}"]`);
          if (o) o.value = soTien(cu.price);
        }
      }
      const k = {posTip: 'tip', posGiven: 'given', posCashPart: 'cashPart', posMdReason: 'mdReason', posNote: 'note'}[t.id];
      if (k) this.pos[k] = t.value;
      return this.posLive();
    }
    this.bindField(t);
  },

  onChange(e){
    const t = e.target;
    if (t.id === 'kvFile' && t.files.length) return this.importFiles(t.files);
    if (t.id === 'dayPick'){ this.cur.date = t.value; return this.render(); }
    if (t.id === 'schedDate' && t.value){ Object.assign(this.sched, {date: t.value, sel: 0, form: null, off: null}); return this.render(); }
    if (/^bk(Dur|Date|Time)$/.test(t.id) && this.sched.form){
      const f = this.sched.form;
      if (t.id === 'bkDur') f.dur = Number(t.value);
      if (t.id === 'bkDate' && t.value) f.date = t.value;
      if (t.id === 'bkTime' && t.value){ const [h, m] = t.value.split(':').map(Number); f.start = h * 60 + m; }
      f.busy = '';
      this.drawSchedPanel();
      if (t.id !== 'bkTime') this.bookSlots();
      return;
    }
    if (t.id === 'mineMonth' && t.value){ this.mine.month = t.value; return this.render(); }
    if (t.id === 'payMonth' && t.value){ this.cur.month = t.value; this.pay.open = 0; return this.render(); }
    if (t.id === 'roundStep' || t.id === 'roundMode'){
      return API.call('setting_save', {key: t.id === 'roundStep' ? 'disc_round' : 'disc_round_mode', value: t.value})
        .then(r => { this.data.round = [t.id === 'roundStep' ? Number(t.value) : this.data.round[0],
                                        t.id === 'roundMode' ? t.value : this.data.round[1]];
                     toast('Đã lưu cách làm tròn', 'ok'); this.drawTiers(); })
        .catch(e => toast(e.message, 'bad'));
    }
    if (/^b(From|To|Barber|Only|Pay|Src)$/.test(t.id)){
      const k = t.id.slice(1).toLowerCase(), b = this.bills;
      b[k] = t.value; b.limit = 200;
      if (k === 'from' || k === 'to'){ b.preset = ''; if (!t.value) return; }
      return this.billsReload(k === 'from' || k === 'to');
    }
    if (t.id === 'posPromo'){ this.pos.promo = Number(t.value); return this.drawPos(); }
    if (t.id === 'posDate'){ this.pos.date = t.value; return; }

    if (t.dataset.vb) return this.changeBarber(Number(t.dataset.vb), Number(t.value));
    this.bindField(t);
  },

  /* Ô trong các bảng sửa nhiều dòng ghi thẳng vào mảng đang sửa — vẽ lại
     (thêm/bớt dòng) không làm mất chữ vừa gõ ở dòng khác. */
  bindField(t){
    if (t.dataset.money !== undefined) this.dinhDangTien(t);
    const val = t.type === 'checkbox' ? (t.checked ? 1 : 0) : t.value;
    if (t.dataset.pf){
      this.data.prog[t.dataset.pf] = t.dataset.pf === 'active' ? Number(val) : val;
    } else if (t.dataset.step){
      this.data.prog.steps[Number(t.dataset.step)][t.dataset.f] = val;
    } else if (t.dataset.tier){
      const row = this.data.tierEdit[Number(t.dataset.tier)];
      row[t.dataset.f] = /^min_|^disc_pct$/.test(t.dataset.f) ? Number(String(val).replace(/\D/g, '')) || 0 : val;
      if (t.dataset.f === 'disc_pct'){ const b = $('#tierPreview'); if (b) b.innerHTML = Views.tierPreview(this.data.tierEdit, this.data.round, this.data.svcRef); }
      if (/^min_/.test(t.dataset.f)){
        const dem = this.tierCounts();
        dem.forEach((n, i) => { const b = document.getElementById('tc' + i); if (b) b.textContent = n + ' khách'; });
      }
    } else if (t.dataset.bb){
      this.data.barberEdit[Number(t.dataset.bb)][t.dataset.f] = t.dataset.f === 'base_salary' ? Number(String(val).replace(/\D/g, '')) || 0 : val;
    } else if (t.dataset.grp){
      const g = this.data.svcGroups[Number(t.dataset.grp)], cu = g.code;
      g[t.dataset.f] = t.dataset.f === 'code' ? t.value.trim().toUpperCase() : t.value;
      /* Đổi mã nhóm thì dịch vụ trong nhóm đi theo. */
      if (t.dataset.f === 'code') this.data.svcEdit.forEach(x => { if (x.grp === cu) x.grp = g.code; });
    } else if (t.dataset.svc){
      const row = this.data.svcEdit[Number(t.dataset.svc)];
      row[t.dataset.f] = t.dataset.f === 'price' || t.dataset.f === 'wage' || t.dataset.f === 'duration' ? Number(String(val).replace(/\D/g, '')) || 0
        : t.dataset.f === 'comm_pct' ? Number(String(val).replace(',', '.')) || 0 : val;
    }
  },

  /* Gõ tiền thì tự chèn dấu chấm ngăn cách ngay trong ô: "2000000" thành
     "2.000.000". Con trỏ giữ đúng chỗ theo số chữ số đứng sau nó — không
     thì mỗi lần chèn dấu con trỏ nhảy về cuối, sửa số ở giữa rất khó. */
  dinhDangTien(t){
    const cu = t.value, vt = t.selectionStart == null ? cu.length : t.selectionStart;
    const sauConTro = cu.slice(vt).replace(/\D/g, '').length;
    const so = cu.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    const moi = so ? Number(so).toLocaleString('vi-VN') : '';
    if (moi === cu) return;
    t.value = moi;
    let p = moi.length, dem = 0;
    while (p > 0 && dem < sauConTro){ p--; if (/\d/.test(moi[p])) dem++; }
    try{ t.setSelectionRange(p, p); }catch(e){}
  },

  /* ---------------- biểu mẫu ---------------- */

  async onSubmit(e){
    const f = e.target;
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f).entries());
    const nut = f.querySelector('[type=submit]');
    try{
      if (f.id === 'searchForm') return this.search();
      if (nut) nut.disabled = true;

      if (f.id === 'loginForm'){
        const r = await API.call('login', {username: v.username.trim(), password: v.password.trim()});
        API.save(r.token, r.user);
        this.today = '';
        return this.go(this.homeTab());
      }
      if (f.id === 'newCusForm'){
        try{
          const r = await API.call('customer_create', {name: v.name, phone: v.phone});
          toast('Đã thêm khách', 'ok');
          this.stack.pop();
          this.data.card = null;
          return this.push({name: 'card', id: r.id});
        }catch(err){
          if (err.code === 'exists'){
            toast(err.message + ' Mở thẻ khách đó.', '');
            this.stack.pop();
            this.data.card = null;
            return this.push({name: 'card', id: err.data.id});
          }
          throw err;
        }
      }
      if (f.id === 'posNewCus'){
        let id;
        try{ id = (await API.call('customer_create', {name: v.name, phone: v.phone})).id; toast('Đã thêm khách', 'ok'); }
        catch(err){ if (err.code !== 'exists') throw err; id = err.data.id; toast(err.message, ''); }
        this.pos.newCus = false;
        return await this.posPick(id);
      }
      if (f.id === 'payAdjForm'){
        this.data.payroll = await API.call('payroll_adjust_add', {month: this.data.payroll.month,
                                           barber_id: Number(f.dataset.barber), label: v.label, sign: Number(v.sign),
                                           qty: Number(v.qty) || 1, rate: Number(String(v.rate).replace(/\D/g, '')),
                                           recurring: v.recurring ? 1 : 0});
        toast('Đã thêm', 'ok');
        $('#view').innerHTML = Views.payroll(this.data.payroll, this.pay);
        return;
      }
      if (f.id === 'kpiForm'){
        const n = k => Number(String(v[k] || '').replace(/\D/g, '')) || 0;
        await API.call('payroll_kpi_save', {month: this.data.payroll.month, barber_id: Number(f.dataset.barber),
                                            cuts: n('cuts'), combo: n('combo'), chem: n('chem'), prod: n('prod')});
        toast('Đã lưu KPI', 'ok');
        return this.render();
      }
      if (f.id === 'offForm'){
        const p = x => { if (!x) return null; const [h, m] = x.split(':').map(Number); return h * 60 + m; };
        const r = await API.call('book_off_add', {barber_id: Number(v.barber_id), date: v.date,
                                                  start: p(v.start) ?? 0, end: p(v.end) ?? 1440, note: v.note});
        toast(r.clash ? `Đã lưu — ${r.clash} lịch hẹn rơi vào giờ nghỉ, nhớ dời / báo khách` : 'Đã lưu giờ nghỉ', r.clash ? 'bad' : 'ok');
        this.sched.off = null; this.sched.date = v.date;
        return this.render();
      }
      if (f.id === 'bookSetForm'){
        await API.call('book_settings_save', {open: v.open, close: v.close, step: Number(v.step), days: Number(v.days),
          notice: Number(v.notice), noshow_block: Number(v.noshow_block), msg: v.msg, online: f.online.checked ? 1 : 0,
          closed_days: [...f.querySelectorAll('[name=cd]:checked')].map(x => Number(x.value))});
        toast('Đã lưu cài đặt đặt lịch', 'ok');
        return;
      }
      if (f.classList.contains('repForm')){
        await API.call('report_add', {visit_id: Number(f.dataset.vid) || 0, date: v.date || f.dataset.date || undefined, note: v.note});
        toast('Đã gửi báo cho chủ quán', 'ok');
        return this.render();
      }
      if (f.classList.contains('resForm')){
        await API.call('report_resolve', {id: Number(f.dataset.id), reply: v.reply});
        toast('Đã đánh dấu xử lý xong', 'ok');
        return this.render();
      }
      if (f.id === 'moveForm'){
        await API.call('cash_move_add', {date: this.data.day.date, note: v.note,
                                         amount: Number(v.sign) * (Number(String(v.amount).replace(/\D/g, '')) || 0)});
        return this.render();
      }
      if (f.dataset.promo !== undefined){
        const r = await API.call('promo_save', Object.assign({}, v, {id: Number(f.dataset.promo),
                                  value: Number(String(v.value).replace(/\D/g, '')), active: Number(v.active)}));
        toast('Đã lưu khuyến mãi', 'ok');
        $('#view').innerHTML = Views.promos(r.rows);
        return;
      }
      if (f.id === 'cusEditForm'){
        this.data.card = await API.call('customer_update', Object.assign({id: this.data.card.customer.id}, v));
        toast('Đã lưu', 'ok');
        return this.drawCard();
      }
      if (f.id === 'pwForm'){
        await API.call('change_password', v);
        toast('Đã đổi mật khẩu', 'ok');
        return this.back();
      }
      if (f.dataset.user !== undefined){
        await API.call('user_save', Object.assign({id: Number(f.dataset.user)}, v,
                                                  {active: v.active === undefined ? 1 : Number(v.active)}));
        toast('Đã lưu tài khoản', 'ok');
        return this.render();
      }
    }catch(err){
      toast(err.message, 'bad');
    }finally{
      if (nut && nut.isConnected) nut.disabled = false;
    }
  }
};

App.start();
