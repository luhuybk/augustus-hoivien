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
  ui: {sel: new Map(), justGot: [], date: ''},
  data: {},

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
      }, 200);
    });
    this._wasWide = this.wide();
    if (API.token){
      try{ this.applyMe(await API.call('me')); }
      catch(e){ /* hết phiên thì API.call đã dọn token; lỗi mạng thì vẫn thử vẽ */ }
    }
    this.go(API.isOwner() ? 'dash' : 'lookup');
  },

  applyMe(r){
    this.kinds = r.kinds; this.shop = r.shop; this.today = r.today; this.undoMinutes = r.undo_minutes;
    API.save(API.token, r.user);
  },

  /* ---------------- điều hướng ---------------- */

  tabs(){
    return API.isOwner()
      ? [['lookup', '🔎', 'Quầy'], ['customers', '👥', 'Khách'], ['dash', '📊', 'Tổng quan'],
         ['day', '📋', 'Sổ ngày'], ['more', '⚙︎', 'Thiết lập']]
      : [['lookup', '🔎', 'Tra cứu'], ['day', '📋', 'Hôm nay'], ['more', '☰', 'Khác']];
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
      case 'card': {
        if (!this.services) this.services = (await API.call('services')).rows;
        if (!this.barbers) this.barbers = (await API.call('barbers')).rows.filter(b => b.active);
        if (!this.data.card || this.data.card.customer.id !== s.id){
          this.data.card = await API.call('customer_get', {id: s.id});
          /* Chọn sẵn thợ của lượt trước — khách quen phần lớn ngồi lại đúng
             ghế cũ. Thợ đó đã nghỉ thì để trống cho quầy chọn. */
          const lb = this.data.card.last_barber_id;
          this.ui = {sel: new Map(), justGot: [], date: this.today,
                     barber: this.barbers.some(b => b.id === lb) ? lb : null};
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
        view.innerHTML = Views.day(this.data.day);
        break;
      case 'more': {
        let ts = null;
        if (!API.isOwner()) try{ ts = (await API.call('tiers')).rows; }catch(e){}
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
        const [t, all] = await Promise.all([API.call('tiers'), API.call('customers_all')]);
        this.data.tierEdit = t.rows.map(x => Object.assign({}, x));
        this.data.all = all.rows;
        this.drawTiers();
        break;
      }
      case 'services': {
        const r = await API.call('services');
        this.data.svcEdit = r.rows.map(x => Object.assign({}, x));
        view.innerHTML = Views.services(this.data.svcEdit);
        break;
      }
      case 'import':    view.innerHTML = Views.importView(this.data.imp || (this.data.imp = {})); break;
      case 'barbers': {
        this.data.barberEdit = (await API.call('barbers')).rows.map(x => Object.assign({}, x));
        view.innerHTML = Views.barbers(this.data.barberEdit);
        break;
      }
      case 'users':     view.innerHTML = Views.users((await API.call('users')).rows); break;
      case 'audit':     view.innerHTML = Views.audit((await API.call('audit')).rows); break;
      case 'password':  view.innerHTML = Views.password(); break;
      default:          this.stack = [{name: 'lookup'}]; return this._render();
    }
  },

  /* Vẽ lại thẻ khách tại chỗ (chọn dịch vụ, gõ giá…) mà không nhảy trang. */
  drawCard(){
    const y = window.scrollY;
    ($('#cardPane') || $('#view')).innerHTML = Views.card(this.data.card, Object.assign({services: this.services}, this.ui));
    window.scrollTo(0, y);
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
    $('#view').innerHTML = Views.tiers(this.data.tierEdit, this.tierCounts());
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
        case 'pick': {
          const sel = this.ui.sel;
          if (sel.has(id)) sel.delete(id); else sel.set(id, '');
          this.ui.justGot = [];
          return this.drawCard();
        }
        /* await ở đây: trả thẳng promise thì lỗi máy chủ (vd. "đã cắt hôm
           nay rồi") lọt khỏi try, quầy không thấy báo gì, nút kẹt ở mờ. */
        case 'addVisit': return await this.addVisit(el);
        case 'pickBarber':
          this.ui.barber = this.ui.barber === id ? null : id;
          return this.drawCard();
        case 'merge': {
          if (!this.hoiLai(el, 'Chắc chưa? Bấm lần nữa')) return;
          el.disabled = true;
          this.data.card = await API.call('customer_merge', {into: this.data.card.customer.id, from: id});
          Object.assign(this.ui, {mergeQ: '', mergeRows: null, mergeOpen: false});
          toast('Đã gộp khách', 'ok');
          this.drawCard();
          return this.refreshLeft();
        }
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
          this.today = ''; this.data = {}; this.services = null; this.barbers = null;
          this.look = {q: '', mode: 'num', rows: null, err: ''};
          return this.go('lookup');

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
                   min_spend: (Number(cuoi.min_spend) || 0) + 2000000, perks: ''});
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
        case 'svcAdd':
          this.data.svcEdit.push({id: 0, name: '', kind: 'cut', price: 0, kv_codes: '', active: 1});
          return $('#view').innerHTML = Views.services(this.data.svcEdit);
        case 'svcUp': {
          const i = Number(el.dataset.i), a = this.data.svcEdit;
          [a[i - 1], a[i]] = [a[i], a[i - 1]];
          return $('#view').innerHTML = Views.services(a);
        }
        case 'saveSvc': {
          el.disabled = true;
          await API.call('services_save', {rows: this.data.svcEdit});
          this.services = null;
          toast('Đã lưu dịch vụ — lượt cũ đã được xếp loại lại', 'ok');
          return this.back();
        }

        /* thợ cắt */
        case 'barberAdd':
          this.data.barberEdit.push({id: 0, name: '', kv_name: '', active: 1});
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

  async addVisit(el){
    const items = [];
    for (const [sid] of this.ui.sel){
      const inp = document.querySelector(`[data-price="${sid}"]`);
      items.push({service_id: sid, price: inp ? Number(inp.value.replace(/\D/g, '')) : undefined});
    }
    if (!items.length) return;
    el.disabled = true;
    const d = $('#visitDate');
    const r = await API.call('visit_add', Object.assign({customer_id: this.data.card.customer.id, items,
                                                         barber_id: this.ui.barber || 0},
                                                        d && d.value ? {date: d.value} : {}));
    this.data.card = r;
    this.ui.sel = new Map();
    this.ui.justGot = r.new_rewards || [];
    if (this.ui.justGot.length){
      toast('🎁 Khách vừa đạt quà: ' + this.ui.justGot.map(x => x.gift).join(', '), 'ok');
      window.scrollTo(0, 0);
    } else toast('Đã ghi lượt', 'ok');
    this.drawCard();
    this.refreshLeft();
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
      const o = $('#q') || $('#cusQ');
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
    if (t.id === 'cusQ'){
      this.cus.q = t.value; this.cus.limit = 100;
      clearTimeout(this._tc);
      this._tc = setTimeout(() => this.drawCustomers(), 200);
      return;
    }
    if (t.dataset.price){
      this.ui.sel.set(Number(t.dataset.price), t.value);
      const b = document.querySelector('[data-act="addVisit"]');
      if (b) b.textContent = 'Ghi lượt · ' + tien(Views.tongChon(Object.assign({services: this.services}, this.ui)));
      return;
    }
    this.bindField(t);
  },

  onChange(e){
    const t = e.target;
    if (t.id === 'kvFile' && t.files.length) return this.importFiles(t.files);
    if (t.id === 'dayPick'){ this.cur.date = t.value; return this.render(); }
    if (t.id === 'visitDate'){ this.ui.date = t.value; return; }
    if (t.dataset.vb) return this.changeBarber(Number(t.dataset.vb), Number(t.value));
    this.bindField(t);
  },

  /* Ô trong các bảng sửa nhiều dòng ghi thẳng vào mảng đang sửa — vẽ lại
     (thêm/bớt dòng) không làm mất chữ vừa gõ ở dòng khác. */
  bindField(t){
    const val = t.type === 'checkbox' ? (t.checked ? 1 : 0) : t.value;
    if (t.dataset.pf){
      this.data.prog[t.dataset.pf] = t.dataset.pf === 'active' ? Number(val) : val;
    } else if (t.dataset.step){
      this.data.prog.steps[Number(t.dataset.step)][t.dataset.f] = val;
    } else if (t.dataset.tier){
      const row = this.data.tierEdit[Number(t.dataset.tier)];
      row[t.dataset.f] = /^min_/.test(t.dataset.f) ? Number(String(val).replace(/\D/g, '')) || 0 : val;
      if (/^min_/.test(t.dataset.f)){
        const dem = this.tierCounts();
        dem.forEach((n, i) => { const b = document.getElementById('tc' + i); if (b) b.textContent = n + ' khách'; });
      }
    } else if (t.dataset.bb){
      this.data.barberEdit[Number(t.dataset.bb)][t.dataset.f] = val;
    } else if (t.dataset.svc){
      const row = this.data.svcEdit[Number(t.dataset.svc)];
      row[t.dataset.f] = t.dataset.f === 'price' ? Number(String(val).replace(/\D/g, '')) || 0 : val;
    }
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
        return this.go(r.user.role === 'owner' ? 'dash' : 'lookup');
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
