// ============================================================================
//  downloads.js — TẢI VỀ VÀ ĐỔI TÊN THEO TỪNG TAB
//  --------------------------------------------------------------------------
//  LỖI CŨ CỦA BẢN TIỆN ÍCH (README 1.7.0): hai tab tải cùng lúc thì tên file bị
//  ĐỔI CHÉO. Nguyên nhân nằm ở chính Chrome: sự kiện
//  chrome.downloads.onDeterminingFilename đưa cho tiện ích một DownloadItem
//  KHÔNG CÓ trường tabId. Tiện ích không tài nào biết file đang tải là của tab
//  nào, nên chỉ còn cách lấy đại mục đầu hàng đợi — hai tab tải trùng nhịp là
//  lấy nhầm tên của nhau. Bản 1.7.0 phải dựng cả một cơ chế khoá để ép các tab
//  tải LẦN LƯỢT, đổi lại tốc độ đa tab giảm hẳn.
//
//  BẢN DESKTOP KHÔNG CÓ LỖI NÀY. Electron đưa thẳng webContents vào sự kiện:
//      session.on('will-download', (event, item, webContents) => …)
//  Biết chính xác tab nào tải file nào thì mỗi tab giữ hàng đợi riêng, không
//  cần khoá, và các tab TẢI SONG SONG ĐƯỢC THẬT.
// ============================================================================

const fs = require('fs');
const path = require('path');
const { sanitizeDownloadPath, sanitizeSubfolder, splitExtension } = require('./text-utils');

const SKIP = '__SKIP_RENAME__';

class DownloadManager {
  /**
   * @param {() => object} getSettings   đọc cài đặt hiện tại (veoSettings)
   * @param {(wcId:number) => object|null} findTabByWcId
   * @param {(tabId:string, payload:object) => void} notifyTab
   * @param {(level:string, msg:string, tabId?:string) => void} log
   */
  constructor({ getSettings, findTabByWcId, notifyTab, log, dirForTab }) {
    this.getSettings = getSettings;
    this.findTabByWcId = findTabByWcId;
    this.notifyTab = notifyTab;
    this.log = log;
    // Thư mục riêng theo tài khoản; trả null thì dùng thư mục mặc định.
    this.dirForTab = dirForTab || (() => null);
    /** @type {Map<string, string[]>} hàng đợi tên file RIÊNG cho từng tab */
    this.queues = new Map();
    this.downloadRoot = null;
  }

  setDownloadRoot(dir) {
    this.downloadRoot = dir;
  }

  queueFor(tabId) {
    if (!this.queues.has(tabId)) this.queues.set(tabId, []);
    return this.queues.get(tabId);
  }

  /** Engine gọi trước mỗi lần bấm tải: đặt trước tên cho file sắp tới. */
  pushName(tabId, filename) {
    const q = this.queueFor(tabId);
    q.push(filename);
    return q.length;
  }

  /** Huỷ một tên đã đặt trước (khi bước tải hỏng giữa chừng). */
  popName(tabId, filename) {
    const q = this.queueFor(tabId);
    for (let i = q.length - 1; i >= 0; i--) {
      if (q[i] === filename) { q.splice(i, 1); return true; }
      }
    return false;
  }

  clear(tabId) {
    if (tabId) this.queues.delete(tabId);
    else this.queues.clear();
  }

  /**
   * Nếu đường dẫn đã tồn tại thì thêm (1), (2)… — thay cho
   * conflictAction:'uniquify' của Chrome, vì setSavePath ghi đè không hỏi.
   */
  uniquify(fullPath) {
    if (!fs.existsSync(fullPath)) return fullPath;
    const dir = path.dirname(fullPath);
    const { stem, ext } = splitExtension(path.basename(fullPath));
    for (let i = 1; i < 1000; i++) {
      const candidate = path.join(dir, ext ? `${stem} (${i}).${ext}` : `${stem} (${i})`);
      if (!fs.existsSync(candidate)) return candidate;
    }
    return path.join(dir, `${stem}_${Date.now()}${ext ? '.' + ext : ''}`);
  }

  /**
   * Gắn vào một session. Gọi một lần cho session dùng chung của các tab Flow.
   */
  attach(ses) {
    ses.on('will-download', (event, item, webContents) => {
      // ── Đây là mấu chốt: biết ngay tab nào đang tải ──
      const tab = this.findTabByWcId(webContents.id);
      const tabId = tab ? tab.id : null;

      const settings = this.getSettings() || {};
      const subfolder = sanitizeSubfolder(settings.downloadSubfolder, settings);
      // Thư mục riêng của tài khoản được ưu tiên hơn thư mục mặc định.
      const root = this.dirForTab(tab) || this.downloadRoot || app_getDefaultDownloadDir();

      const original = item.getFilename();
      const { ext } = splitExtension(original);

      let chosen = null;
      if (tabId) {
        const q = this.queueFor(tabId);
        if (q.length > 0) chosen = q.shift();
      }

      let relative;
      if (chosen && chosen !== SKIP) {
        let stem = sanitizeDownloadPath(chosen);
        relative = ext && !stem.toLowerCase().endsWith('.' + ext.toLowerCase())
          ? `${stem}.${ext}`
          : stem;
      } else {
        relative = sanitizeDownloadPath(original);
      }

      if (subfolder) relative = `${subfolder}/${relative}`;

      const fullPath = this.uniquify(path.join(root, ...relative.split('/')));
      try {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      } catch (err) {
        this.log('error', `❌ Không tạo được thư mục tải: ${err.message}`, tabId);
      }

      item.setSavePath(fullPath);

      if (tabId) {
        this.notifyTab(tabId, {
          action: 'DOWNLOAD_STARTED',
          filename: chosen || original,
          appliedAs: path.basename(fullPath)
        });
      }

      item.once('done', (_e, state) => {
        if (state === 'completed') {
          this.log('success', `⬇️ Đã tải: ${path.basename(fullPath)}`, tabId);
          if (tabId) this.notifyTab(tabId, { action: 'DOWNLOAD_DONE', path: fullPath });
        } else {
          // Tải hỏng thì trả tên về ĐẦU hàng đợi của đúng tab đó, để lần thử
          // lại dùng lại tên cũ thay vì ăn mất tên của video kế tiếp.
          if (tabId && chosen && chosen !== SKIP) this.queueFor(tabId).unshift(chosen);
          this.log('error', `❌ Tải hỏng (${state}): ${path.basename(fullPath)}`, tabId);
          if (tabId) this.notifyTab(tabId, { action: 'DOWNLOAD_FAILED', state });
        }
      });
    });
  }
}

// Tách ra hàm riêng để không phải require('electron') ở đầu file lúc test bằng node thuần.
function app_getDefaultDownloadDir() {
  try {
    const { app } = require('electron');
    return app.getPath('downloads');
  } catch (_) {
    return path.join(require('os').homedir(), 'Downloads');
  }
}

module.exports = { DownloadManager, SKIP };
