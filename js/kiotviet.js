/* Đọc file Excel "Hóa đơn chi tiết" xuất từ KiotViet, ngay trong trình duyệt.

   Không dùng thư viện: file .xlsx chỉ là một tệp zip chứa vài tệp XML.
   Giải nén bằng DecompressionStream có sẵn trong trình duyệt, đọc XML bằng
   biểu thức chính quy (nhanh hơn dựng cây DOM cho tệp 4–5MB).

   Kết quả là danh sách HOÁ ĐƠN (gộp các dòng hàng cùng mã hoá đơn), dạng
   rút gọn để gửi lên máy chủ:
     {c: mã HĐ, t: 'YYYY-MM-DD HH:MM', p: SĐT, n: tên khách, k: mã KH,
      a: khách cần trả, i: [[mã hàng, tên hàng, số lượng, thành tiền], …]}

   Chạy được cả trong Node (để thử bằng tay) vì chỉ dùng Blob, Response và
   DecompressionStream.                                                   */

const KiotViet = {

  /* ---------- zip ---------- */

  async unzip(buf){
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    /* Tìm "cuối danh mục" từ cuối tệp ngược lên. */
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--){
      if (dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Đây không phải file Excel (.xlsx).');

    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++){
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method  = dv.getUint16(p + 10, true);
      const size    = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extra   = dv.getUint16(p + 30, true);
      const comment = dv.getUint16(p + 32, true);
      const local   = dv.getUint32(p + 42, true);
      const name    = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
      files[name] = {method, size, local};
      p += 46 + nameLen + extra + comment;
    }
    return {
      names: Object.keys(files),
      /* Giải nén từng tệp khi cần — file Excel có cả chục tệp mà chỉ dùng hai. */
      async text(name){
        const f = files[name];
        if (!f) return null;
        const l = f.local;
        const start = l + 30 + dv.getUint16(l + 26, true) + dv.getUint16(l + 28, true);
        const raw = buf.subarray(start, start + f.size);
        if (f.method === 0) return dec.decode(raw);
        if (f.method !== 8) throw new Error('File nén theo kiểu lạ, mở bằng Excel rồi lưu lại thử.');
        if (typeof DecompressionStream === 'undefined')
          throw new Error('Trình duyệt này cũ quá, không giải nén được. Dùng Chrome hoặc Safari bản mới.');
        const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return await new Response(stream).text();
      }
    };
  },

  /* ---------- xml ---------- */

  unxml(s){
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X'
        ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return {amp:'&', lt:'<', gt:'>', quot:'"', apos:"'"}[e.toLowerCase()];
    });
  },

  texts(xml){
    let s = '';
    const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    let m;
    while ((m = re.exec(xml))) s += m[1];
    return this.unxml(s);
  },

  colIndex(ref){
    const letters = ref.match(/^[A-Z]+/)[0];
    let n = 0;
    for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
    return n - 1;
  },

  sheetRows(xml, shared){
    const rows = [];
    /* Dòng trống có thể viết tắt <row r="5"/> — phải nhận cả kiểu đó, không
       thì nó nuốt luôn nội dung dòng kế tiếp. */
    const reRow = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
    const reCell = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let r;
    while ((r = reRow.exec(xml))){
      const row = [];
      let c;
      reCell.lastIndex = 0;
      while ((c = reCell.exec(r[1] || ''))){
        const attrs = c[1], body = c[2] || '';
        const ref = (attrs.match(/\br="([A-Z]+)\d+"/) || [])[1];
        const t   = (attrs.match(/\bt="(\w+)"/) || [])[1] || 'n';
        const v   = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = null;
        if (t === 'inlineStr') val = this.texts(body);
        else if (t === 's') val = v != null ? shared[Number(v)] : null;
        else if (v != null) val = t === 'n' ? Number(v) : this.unxml(v);
        row[ref ? this.colIndex(ref) : row.length] = val;
      }
      rows.push(row);
    }
    return rows;
  },

  /* ---------- đọc hoá đơn ---------- */

  fold(s){
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim().replace(/\s+/g, ' ');
  },

  /* Ngày trong Excel là số ngày kể từ 30/12/1899, phần lẻ là giờ — theo
     giờ địa phương của máy xuất file, nên đọc ra bằng getUTC* là đúng giờ
     VN, không bị cộng trừ múi giờ. Một số bản xuất lại để chữ
     "28/09/2026 12:41:00" — đọc được cả hai. */
  when(v){
    if (typeof v === 'number' && isFinite(v)){
      const d = new Date(Math.round((v - 25569) * 86400000));
      const p = n => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
    }
    const m = String(v || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (!m) return '';
    const p = n => String(n).padStart(2, '0');
    return `${m[3]}-${p(m[2])}-${p(m[1])} ${p(m[4] || 0)}:${p(m[5] || 0)}`;
  },

  /* Ô số điện thoại mà để kiểu số thì Excel nuốt mất số 0 đầu. Khách lưu
     hai số ("0901… / 0912…") thì lấy số đầu — ghép cả hai thành một dãy 20
     chữ số là tạo ra một khách không bao giờ tra được. */
  phone(v){
    let s = String(v == null ? '' : v).split(/[\/,;|]|\s-\s/)[0].replace(/\D/g, '');
    if (s.length > 11 && s[0] === '0') s = s.slice(0, 10);
    if (s.length === 9 && s[0] !== '0') s = '0' + s;
    return s;
  },

  async parse(buf){
    if (buf instanceof ArrayBuffer) buf = new Uint8Array(buf);
    const zip = await this.unzip(buf);

    let shared = [];
    const ss = await zip.text('xl/sharedStrings.xml');
    if (ss){
      const re = /<si>([\s\S]*?)<\/si>/g;
      let m;
      while ((m = re.exec(ss))) shared.push(this.texts(m[1]));
    }

    const CAN = {
      code: 'ma hoa don', time: 'thoi gian', kcode: 'ma khach hang', name: 'ten khach hang',
      phone: 'dien thoai', pay: 'khach can tra', status: 'trang thai',
      icode: 'ma hang', iname: 'ten hang', qty: 'so luong', total: 'thanh tien'
    };

    /* Lấy trang tính nào có cột "Mã hóa đơn" — tên tệp trang tính bên
       trong mỗi bản KiotViet đặt một kiểu (file này là sheet2.xml). */
    const sheets = zip.names.filter(n => /^xl\/worksheets\/[^/]+\.xml$/.test(n)).sort();
    let rows = null, col = null, headerAt = 0;
    for (const name of sheets){
      const r = this.sheetRows(await zip.text(name), shared);
      for (let h = 0; h < Math.min(r.length, 10); h++){
        const idx = {};
        (r[h] || []).forEach((v, i) => { const f = this.fold(v); if (!(f in idx)) idx[f] = i; });
        if ('ma hoa don' in idx){
          col = {};
          for (const k in CAN) col[k] = idx[CAN[k]];
          rows = r; headerAt = h;
          break;
        }
      }
      if (rows) break;
    }
    if (!rows) throw new Error('Không thấy cột "Mã hóa đơn" — có vẻ đây là file Danh sách khách hàng hoặc báo cáo khác. '
      + 'Cần xuất "Hóa đơn chi tiết" từ KiotViet.');
    /* File "Hóa đơn" thường (không chi tiết) cũng có cột Mã hóa đơn, nhưng
       không có số điện thoại lẫn dịch vụ — nhập vào là không biết ai cắt gì. */
    if (col.phone == null && col.icode == null)
      throw new Error('Đây là file "Hóa đơn" dạng tổng — không có số điện thoại và dịch vụ. '
        + 'Trong KiotViet chọn Xuất file → "Hóa đơn chi tiết".');
    const thieu = ['time', 'phone', 'pay', 'icode'].filter(k => col[k] == null);
    if (thieu.length) throw new Error('File thiếu cột: ' + thieu.map(k => CAN[k]).join(', ') + '.');

    const byCode = new Map();
    let huy = 0, lines = 0;
    for (let i = headerAt + 1; i < rows.length; i++){
      const r = rows[i];
      if (!r) continue;
      const code = String(r[col.code] || '').trim();
      if (!code) continue;
      lines++;
      if (col.status != null && this.fold(r[col.status]).includes('huy')){ huy++; continue; }
      let h = byCode.get(code);
      if (!h){
        h = {c: code, t: this.when(r[col.time]), p: this.phone(r[col.phone]),
             n: String(r[col.name] || '').trim(), k: String(r[col.kcode] || '').trim(),
             a: Number(r[col.pay]) || 0, i: []};
        byCode.set(code, h);
      }
      h.i.push([String(r[col.icode] || '').trim(), String(r[col.iname] || '').trim(),
                Number(r[col.qty]) || 1, Number(r[col.total]) || 0]);
    }

    const invoices = [...byCode.values()].filter(h => h.t);
    const dates = invoices.map(h => h.t.slice(0, 10)).sort();
    return {
      invoices, lines, cancelled: huy,
      from: dates[0] || null, to: dates[dates.length - 1] || null,
      withPhone: invoices.filter(h => h.p.length >= 9).length
    };
  }
};

if (typeof module !== 'undefined') module.exports = KiotViet;
