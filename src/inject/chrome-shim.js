// ============================================================================
//  chrome-shim.js — GIẢ LẬP chrome.* CHO MÔI TRƯỜNG ELECTRON
//  --------------------------------------------------------------------------
//  Đây là mẩu code làm nên toàn bộ việc "chuyển tool": nhờ nó mà flow-engine.js
//  (6.430 dòng, chính là content-v2.js của tiện ích 1.10.0) chạy lại được gần
//  như NGUYÊN VẸN, không phải viết lại logic dò DOM đã tốn bao công thử lửa.
//
//  Engine chỉ dùng đúng 4 nhóm API của Chrome:
//      chrome.runtime.sendMessage   (38 chỗ)
//      chrome.storage.local         (19 chỗ)
//      chrome.runtime.onMessage     (5 chỗ)
//      chrome.runtime.getManifest   (1 chỗ)
//  Tất cả đều bắc cầu về tiến trình chính của Electron qua window.__flowBridge
//  (do preload-flow.js phơi ra bằng contextBridge).
//
//  File này chạy trong MAIN WORLD của trang Flow.
// ============================================================================

(function () {
  'use strict';

  if (window.chrome && window.chrome.__flowShim) return;   // đã tiêm rồi

  const bridge = window.__flowBridge;
  if (!bridge) {
    console.error('[shim] Thiếu __flowBridge — preload chưa chạy?');
    return;
  }

  const TAB_ID = window.__FLOW_TAB_ID || 'tab?';

  // ── Danh sách người nghe message từ tiến trình chính ────────────────────
  const listeners = [];

  /**
   * Tiến trình chính gọi hàm này (qua executeJavaScript) để đẩy message xuống
   * engine — thay cho chrome.tabs.sendMessage.
   */
  /**
   * Xoá sạch người nghe cũ trước khi tiêm một bản engine mới.
   *
   * Lớp giả lập này chỉ lắp MỘT lần cho mỗi tài liệu (đầu file có kiểm tra
   * __flowShim rồi thoát sớm), nhưng engine thì có thể tiêm lại nhiều lần.
   * Không dọn thì mảng listeners cứ dài thêm, và mỗi lệnh gửi xuống bị xử lý
   * nhiều lần — nhìn từ nhật ký là các dòng log giống hệt nhau lặp lại.
   */
  window.__flowShimReset = function () {
    listeners.length = 0;
    return true;
  };

  window.__flowShimDispatch = function (message) {
    let answered = false;
    let result = undefined;
    const sendResponse = (r) => { if (!answered) { answered = true; result = r; } };
    const sender = { tab: { id: TAB_ID }, id: 'flow-studio' };

    for (const fn of [...listeners]) {
      try {
        fn(message, sender, sendResponse);
      } catch (err) {
        console.error('[shim] Người nghe message lỗi:', err);
      }
    }
    return { ok: true, result };
  };

  // ── chrome.storage.local ────────────────────────────────────────────────
  // Hỗ trợ cả hai lối gọi: await get(keys) và get(keys, callback).
  function storageCall(op, arg, callback) {
    const p = bridge.storage(op, arg);
    if (typeof callback === 'function') {
      p.then((res) => callback(res)).catch(() => callback(undefined));
      return undefined;
    }
    return p;
  }

  const storageLocal = {
    get: (keys, cb) => storageCall('get', keys === undefined ? null : keys, cb),
    set: (items, cb) => storageCall('set', items, cb),
    remove: (keys, cb) => storageCall('remove', keys, cb),
    clear: (cb) => storageCall('clear', null, cb),
    // ── Cố ý luôn trả 0 ──────────────────────────────────────────────────
    // Engine dùng hàm này ở ĐÚNG MỘT chỗ: canh hạn mức ~10MB của
    // chrome.storage.local. Vượt ngưỡng là nó TỰ XOÁ các dự án cũ để lấy chỗ.
    //
    // Bản desktop ghi ra file JSON, KHÔNG có trần 10MB nào. Trả số thật ở đây
    // nghĩa là mỗi lần lưu, engine lại xoá bớt dự án của người dùng để tránh
    // một hạn mức không tồn tại — mất dữ liệu mà chẳng được gì. Người dùng có
    // 427 prompt (~8,7 triệu ký tự) chạm ngưỡng này ngay từ lần lưu đầu tiên.
    //
    // Trả 0 không phải nói dối: câu hỏi là "đã dùng bao nhiêu hạn mức", mà ở
    // đây không có hạn mức. Chính engine cũng mặc định resolve(0) khi không
    // đọc được API này — đúng ý "không có thông tin hạn mức thì đừng dọn".
    //
    // Chỗ canh dung lượng thật cho bản desktop nằm ở src/main/store.js.
    getBytesInUse: (_keys, cb) => {
      if (typeof cb === 'function') { cb(0); return undefined; }
      return Promise.resolve(0);
    }
  };

  // ── chrome.runtime ──────────────────────────────────────────────────────
  const runtime = {
    id: 'flow-studio-desktop',

    // Engine gọi cả hai kiểu: await sendMessage(msg) và sendMessage(msg, cb).
    sendMessage(message, callback) {
      const p = bridge.send(message).catch((err) => {
        console.error('[shim] sendMessage lỗi:', err);
        return { success: false, error: String(err && err.message || err) };
      });
      if (typeof callback === 'function') {
        p.then((res) => callback(res));
        return undefined;
      }
      return p;
    },

    onMessage: {
      addListener(fn) {
        if (typeof fn === 'function' && !listeners.includes(fn)) listeners.push(fn);
      },
      removeListener(fn) {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      },
      hasListener(fn) {
        return listeners.includes(fn);
      }
    },

    getManifest() {
      return { name: 'Flow Automation Studio', version: window.__FLOW_APP_VERSION || '2.0.0' };
    },

    getURL(p) {
      return 'flow-studio://' + String(p || '').replace(/^\//, '');
    },

    // Engine kiểm tra chrome.runtime.lastError sau vài lời gọi callback.
    get lastError() { return undefined; }
  };

  // ── Lắp vào window ──────────────────────────────────────────────────────
  const shim = {
    __flowShim: true,
    runtime,
    storage: { local: storageLocal },

    // Engine chỉ nhắc chrome.scripting / chrome.tabs trong GHI CHÚ, không gọi
    // thật. Vẫn để sẵn bản rỗng để lỡ có nhánh code hiếm nào chạm tới thì báo
    // lỗi rõ ràng thay vì "undefined is not a function".
    scripting: {
      executeScript() {
        return Promise.reject(new Error('chrome.scripting không dùng ở bản desktop — engine chạy sẵn trong main world'));
      }
    },
    tabs: {
      setZoom: (_id, factor) => bridge.send({ action: 'SET_TAB_ZOOM', zoom: factor })
    },
    notifications: {
      create: (_id, opts, cb) => {
        bridge.send({ action: 'NOTIFY', title: opts && opts.title, message: opts && opts.message });
        if (typeof cb === 'function') cb('noop');
      }
    }
  };

  window.chrome = Object.assign(window.chrome || {}, shim);

  // ── Chặn hộp thoại chặn luồng ───────────────────────────────────────────
  // Engine gọi alert() ở đúng hai chỗ: khi phát hiện chế độ giao diện Flow
  // không khớp chế độ chạy. Ở tiện ích Chrome thì người dùng đang nhìn tab đó
  // nên bấm OK là xong. Ở đây tab Flow chạy trong khung nhúng, nhiều khi bị
  // giấu sau giao diện app — alert() bật lên là ĐỨNG NGUYÊN cả tab: mọi lệnh
  // executeJavaScript sau đó treo, tab kẹt vĩnh viễn, nhìn từ ngoài y như app
  // chết. Với 4-5 tab chạy song song thì đó là hỏng cả mẻ.
  //
  // Nội dung cảnh báo KHÔNG bị nuốt: nó được đẩy về Nhật ký của app qua cùng
  // đường mà engine vẫn dùng, nên người dùng vẫn đọc được, chỉ là không phải
  // đi bấm OK cho từng tab.
  try {
    window.alert = function (msg) {
      const t = String(msg || '').replace(/\s*\n\s*/g, ' ').trim();
      console.warn('[alert bị chặn]', t);
      try {
        bridge.send({ action: 'LOG', type: 'warning', message: `⚠️ Flow cảnh báo: ${t}` });
      } catch (_) {}
    };
    window.confirm = function (msg) {
      console.warn('[confirm bị chặn, trả true]', String(msg || ''));
      return true;
    };
    window.print = function () {};
  } catch (_) {}

  // Nhận message do tiến trình chính đẩy xuống qua IPC (đường thứ hai, dùng
  // cho thông báo một chiều như DOWNLOAD_STARTED).
  if (typeof bridge.onDispatch === 'function') {
    bridge.onDispatch((message) => {
      try { window.__flowShimDispatch(message); } catch (err) { console.error(err); }
    });
  }

  console.log('[shim] chrome.* đã sẵn sàng cho', TAB_ID);
})();
