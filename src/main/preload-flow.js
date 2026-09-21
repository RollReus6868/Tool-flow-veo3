// ============================================================================
//  preload-flow.js — cầu nối giữa trang Flow và tiến trình chính
//  --------------------------------------------------------------------------
//  Preload chạy trong isolated world và CÓ ipcRenderer; engine chạy trong main
//  world và KHÔNG có. contextBridge là đường hợp lệ duy nhất nối hai bên.
//  Chỉ phơi đúng ba hàm, không phơi ipcRenderer trần.
// ============================================================================

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__flowBridge', {
  /** Thay chrome.runtime.sendMessage — gửi lên tiến trình chính, chờ trả lời. */
  send: (message) => ipcRenderer.invoke('flow:message', message),

  /** Thay chrome.storage.local.* */
  storage: (op, arg) => ipcRenderer.invoke('flow:storage', { op, arg }),

  /** Nhận message một chiều do tiến trình chính đẩy xuống. */
  onDispatch: (callback) => {
    ipcRenderer.on('flow:dispatch', (_event, message) => {
      try { callback(message); } catch (err) { console.error('[bridge]', err); }
    });
  }
});
