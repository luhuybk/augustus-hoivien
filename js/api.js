/* Nói chuyện với api/index.php.

   Mọi lệnh đều là POST JSON kèm token trong header. Token cất ở
   localStorage — máy tính bảng ở quầy mở app lên là vào thẳng, không
   bắt đăng nhập lại mỗi sáng.                                          */

const API = {
  url: 'api/index.php',
  token: null,
  user: null,

  load(){
    try{
      this.token = localStorage.getItem('memberhub.token');
      this.user  = JSON.parse(localStorage.getItem('memberhub.user') || 'null');
    }catch(e){}
    return this.token;
  },

  save(token, user){
    this.token = token; this.user = user;
    try{
      localStorage.setItem('memberhub.token', token);
      localStorage.setItem('memberhub.user', JSON.stringify(user));
    }catch(e){}
  },

  clear(){
    this.token = null; this.user = null;
    try{
      localStorage.removeItem('memberhub.token');
      localStorage.removeItem('memberhub.user');
    }catch(e){}
  },

  isOwner(){ return !!this.user && this.user.role === 'owner'; },

  /* Ném lỗi kèm câu tiếng Việt của máy chủ — chỗ gọi chỉ việc hiện ra.
     err.code / err.data giữ lại để chỗ gọi xử lý riêng vài trường hợp
     (vd. "số này đã có" thì mở luôn khách đó). */
  async call(action, data = {}){
    let res;
    try{
      res = await fetch(this.url, {
        method: 'POST',
        headers: Object.assign({'Content-Type': 'application/json'},
          this.token ? {'Authorization': 'Bearer ' + this.token} : {}),
        /* Token gửi thêm trong thân yêu cầu, phòng máy chủ nuốt header
           Authorization (Apache + FastCGI hay bị). */
        body: JSON.stringify(Object.assign({action}, this.token ? {_t: this.token} : {}, data))
      });
    }catch(e){
      throw new Error('Không có mạng. Kiểm tra wifi rồi thử lại.');
    }
    let j;
    try{ j = await res.json(); }
    catch(e){ throw new Error('Máy chủ trả về dữ liệu lạ (' + res.status + ').'); }

    /* Chỉ đăng xuất khi máy chủ nói đúng là hết phiên — 401 còn dùng cho
       "sai mật khẩu". */
    if (res.status === 401 && this.token && j.code === 'session_expired'){
      this.clear();
      if (window.App) App.render();
    }
    if (!j.ok){
      const err = new Error(j.error || 'Có lỗi xảy ra.');
      err.code = j.code; err.data = j;
      throw err;
    }
    return j;
  }
};
