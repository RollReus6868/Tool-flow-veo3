// ============================================================================
//  store.js — thay thế chrome.storage.local
//  --------------------------------------------------------------------------
//  Tiện ích Chrome cất cài đặt và dự án trong chrome.storage.local. Bản desktop
//  cất vào một file JSON nằm cạnh dữ liệu người dùng, nên:
//    • gỡ/cài lại app KHÔNG mất cài đặt (khác hẳn gỡ tiện ích trên Chrome);
//    • đọc/ghi được bằng Notepad khi cần cứu dữ liệu;
//    • không bị MV3 giết service worker rồi mất trạng thái.
//
//  Ghi theo kiểu ghi-file-tạm-rồi-đổi-tên (atomic) để mất điện giữa chừng
//  không làm hỏng file cài đặt.
// ============================================================================

const fs = require('fs');
const path = require('path');

class Store {
  constructor(filePath, onWarn) {
    this.filePath = filePath;
    this.data = {};
    this.flushTimer = null;
    this.onWarn = onWarn || null;
    this.prettyPrint = true;     // tự tắt khi file lớn, xem flushNow()
    this.daCanhBao = false;
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      this.data = JSON.parse(raw) || {};
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // File hỏng: giữ lại bản lỗi để còn cứu, rồi bắt đầu lại từ rỗng.
        try {
          fs.renameSync(this.filePath, this.filePath + '.hong-' + Date.now());
        } catch (_) {}
      }
      this.data = {};
    }
  }

  // chrome.storage.local.get(keys) — nhận null | string | string[] | object
  get(keys) {
    if (keys === null || keys === undefined) return { ...this.data };

    if (typeof keys === 'string') {
      return this.data[keys] !== undefined ? { [keys]: this.data[keys] } : {};
    }

    if (Array.isArray(keys)) {
      const out = {};
      for (const k of keys) if (this.data[k] !== undefined) out[k] = this.data[k];
      return out;
    }

    // Dạng object = có giá trị mặc định cho từng khoá
    const out = {};
    for (const [k, fallback] of Object.entries(keys)) {
      out[k] = this.data[k] !== undefined ? this.data[k] : fallback;
    }
    return out;
  }

  set(items) {
    Object.assign(this.data, items);
    this.scheduleFlush();
    return true;
  }

  remove(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) delete this.data[k];
    this.scheduleFlush();
    return true;
  }

  clear() {
    this.data = {};
    this.scheduleFlush();
    return true;
  }

  // Gom nhiều lần ghi trong 250ms thành một lần chạm đĩa. Engine gọi
  // saveProject() rất dày khi chạy nhiều tab; ghi thẳng mỗi lần sẽ nghẽn ổ đĩa.
  scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushNow();
    }, 250);
  }

  flushNow() {
    const tmp = this.filePath + '.tmp';
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });

      // Không dùng thụt lề khi file đã lớn: với 427 prompt, phần thụt lề
      // chiếm thêm hàng MB và mỗi lần lưu lại phải ghi hết chừng ấy xuống đĩa.
      const raw = JSON.stringify(this.data, null, this.prettyPrint ? 2 : 0);
      if (raw.length > 2 * 1024 * 1024) this.prettyPrint = false;

      fs.writeFileSync(tmp, raw, 'utf8');
      fs.renameSync(tmp, this.filePath);
      this.checkSize(raw.length);
    } catch (err) {
      console.error('[store] Không ghi được file cài đặt:', err.message);
    }
  }

  /**
   * Canh dung lượng — phiên bản hợp lý cho môi trường desktop.
   *
   * Lớp giả lập chrome.storage cố ý báo "đã dùng 0 byte" để engine thôi tự xoá
   * dự án cũ theo hạn mức 10MB của Chrome (hạn mức đó không tồn tại ở đây).
   * Nhưng vô hiệu một chốt an toàn thì phải dựng chốt thay thế: đĩa không phải
   * vô hạn, và một file cài đặt phình tới hàng trăm MB làm mỗi lần lưu chậm
   * thấy rõ. Ngưỡng đặt cao gấp mấy chục lần mức dùng bình thường nên người
   * dùng thường sẽ không bao giờ thấy dòng này.
   */
  checkSize(bytes) {
    const MB = 1024 * 1024;
    if (bytes < 400 * MB) { this.daCanhBao = false; return; }
    if (this.daCanhBao) return;                 // nói một lần, không lải nhải
    this.daCanhBao = true;
    const msg =
      `⚠️ File dữ liệu đã tới ${(bytes / MB).toFixed(0)}MB. Mỗi lần lưu sẽ chậm dần. ` +
      `Vào Cài đặt → Mở thư mục dữ liệu rồi xoá bớt dự án cũ nếu thấy ì.`;
    console.warn('[store] ' + msg);
    if (typeof this.onWarn === 'function') this.onWarn(msg);
  }

  // Gọi lúc app thoát để không mất 250ms cuối.
  close() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushNow();
  }
}

module.exports = { Store };
