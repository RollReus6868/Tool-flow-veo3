// ==================== VEO AUTOMATION V2 - WORKER MODE ====================
// This script runs in the Flow page context. 
// It receives commands from the Side Panel and executes automation logic.

console.log('[VEO Automation] Content script loaded (Worker Mode)');

// If loaded inside an iframe (TVC Tool), attempt to hide the top header
console.log('[Veo] Content V2 Script Loaded');

    if (window !== window.top) {
        let maskInjected = false;

        // 0. Inject CSS to hide header and left sidebar instantly
        try {
            const style = document.createElement('style');
            style.id = 'veo-iframe-cleaner-style';
            style.textContent = `
                header, 
                flow-tile-view-header, 
                .header-base, 
                [role="banner"],
                mat-sidenav,
                .project-sidenav,
                flow-project-nav-list,
                mat-nav-list[role="navigation"],
                .mat-drawer.mat-sidenav {
                    display: none !important;
                }

                mat-sidenav-content, 
                .mat-drawer-content,
                .has-header-offset {
                    margin-left: 0 !important;
                    padding-left: 0 !important;
                    margin-top: 0 !important;
                    padding-top: 0 !important;
                }
            `;
            (document.head || document.documentElement).appendChild(style);
        } catch(e) {}

        // Advanced JS cleaner to find and hide the sidebar and maximize the embedded app container
        const layoutCleanerInterval = setInterval(() => {
            // 1. Hide the global black top header
            const headers = document.querySelectorAll('header, flow-tile-view-header, [role="banner"]');
            headers.forEach(h => h.style.setProperty('display', 'none', 'important'));

            // 2. Hide the left sidebar by tag / class
            const sidebars = document.querySelectorAll('mat-sidenav, .project-sidenav, flow-project-nav-list, mat-nav-list[role="navigation"]');
            sidebars.forEach(s => s.style.setProperty('display', 'none', 'important'));

            const sidenavContents = document.querySelectorAll('mat-sidenav-content, .mat-drawer-content');
            sidenavContents.forEach(c => {
                c.style.setProperty('margin-left', '0px', 'important');
                c.style.setProperty('padding-left', '0px', 'important');
            });

            // 3. Fallback scan via Material / Google symbols
            const icons = document.querySelectorAll('mat-icon, i.google-symbols, span.google-symbols, .google-symbols');
            for (let icon of icons) {
                const text = (icon.textContent || '').trim();
                if (text === 'dashboard' || text === 'left_panel_open' || text === 'left_panel_close' || text === 'image' || text === 'person' || text === 'videocam' || text === 'accessibility_new') {
                    let parent = icon.parentElement;
                    let depth = 0;
                    while (parent && depth < 12) {
                        const rect = parent.getBoundingClientRect();
                        // Sidebar is usually tall and narrow on the left edge
                        if (rect.width > 20 && rect.width < 280 && rect.height > window.innerHeight * 0.4 && rect.left < 50) {
                            // Prevent hiding sidebars inside modals/dialogs
                            if (parent.closest('[role="dialog"], dialog, [role="presentation"], [class*="modal"], [class*="dialog"], [data-radix-popper-content-wrapper]')) {
                                break;
                            }

                            parent.style.setProperty('display', 'none', 'important');
                            break;
                        }
                        parent = parent.parentElement;
                        depth++;
                    }
                }
            }

            // 4. Expand the iframe to fill the screen powerfully
            const appIframe = document.querySelector('iframe');
            if (appIframe) {
                appIframe.style.setProperty('position', 'fixed', 'important');
                appIframe.style.setProperty('top', '0', 'important');
                appIframe.style.setProperty('left', '0', 'important');
                appIframe.style.setProperty('z-index', '999999', 'important');
                appIframe.style.setProperty('width', '100vw', 'important');
                appIframe.style.setProperty('height', '100vh', 'important');
                appIframe.style.setProperty('margin', '0', 'important');
                appIframe.style.setProperty('padding', '0', 'important');
                appIframe.style.setProperty('border', 'none', 'important');
                
                // Try to hide the inner header inside the iframe
                try {
                    const iDoc = appIframe.contentDocument;
                    if (iDoc && !iDoc.getElementById('veo-iframe-style')) {
                        const style = iDoc.createElement('style');
                        style.id = 'veo-iframe-style';
                        style.textContent = `
                            header { display: none !important; }
                            nav { display: none !important; }
                            [role="banner"] { display: none !important; }
                        `;
                        iDoc.head.appendChild(style);
                    }
                } catch(e) {
                    // Cross-origin restriction might apply
                }
            }

            // 5. Fade out loading mask if injected
            const existingMask = document.getElementById('veo-loading-mask');
            if (existingMask && !existingMask.dataset.fading) {
                existingMask.dataset.fading = 'true';
                setTimeout(() => {
                    existingMask.style.opacity = '0';
                    setTimeout(() => existingMask.remove(), 500);
                }, 800);
            }
        }, 500);
    }

// Local fork: Authorization-header interception intentionally removed.
window.veoAuthToken = null;


// Local fork: network/WIZ response interception removed.
window.veoWizAt = null;
window.veoWizFSid = null;
window.lastBatchexecuteUrl = null;
window.lastBatchexecuteAtToken = null;
window.veoSniffedMediaIds = [];
window.veoSniffedMediaMap = {};

// ==================== CONSTANTS ====================
const PAGE_SESSION_ID = Math.random().toString(36).substring(2);

const STATUS = {
  WAITING: 'WAITING',      // Chờ paste
  PASTING: 'PASTING',      // Đang paste
  CREATING: 'CREATING',    // Đang tạo (có %)
  COMPLETED: 'COMPLETED',  // Đã xong
  ERROR: 'ERROR'           // Lỗi
};

const PASTE_DELAY = 5000;
const MAX_RETRIES = 5;
const CHECK_INTERVAL = 3000;
const SCROLL_INTERVAL = 10000;
const BATCH_SIZE = 5;
const MAX_DOWNLOAD_CONCURRENT = 4;

// ==================== STATE MANAGEMENT ====================
let state = {
  isRunning: false,
  prompts: [],
  settings: {
    addIndex: true,
    autoRename: true,
    maxRetries: 5,
    pasteDelay: 20000,
    outputCount: 2,
    autoDownload: true,
    downloadQuality: '1080p',
    mode: 'text-to-video',
    model: 'veo-3.1-fast',
    aspectRatio: '16:9',
    duration: '8',
    downloadFolder: 'VeoVideos',
    language: 'vi',
    randomScroll: false,
    // Chốt chặn mất mạng (1.10.0): 'auto' = nghi ngờ thì kiểm chứng bằng request
    // thật | 'off' = không bao giờ dừng vì navigator.onLine.
    networkGuard: 'auto',
    // Đa tab (1.7.0). Mặc định TẮT để hành vi giống bản 1.6.1.
    multiTab: false,
    multiTabStagger: 0,      // giây giãn cách giữa các lần bấm "Tạo" của mọi tab
    multiTabMode: 'split'    // 'split' = chia danh sách | 'independent' = mỗi tab một dự án
  },
  currentPromptIndex: 0,
  processedCount: 0, // Not strictly used in logic but good for stats
  errorCount: 0,
  downloadedCount: 0,
  activeDownloads: 0,
  videos: [],
  // For saving/loading
  projectName: '',
  startTime: 0,
  _existingCards: new Set(),
  // Watchdog for detecting stuck automation
  _lastActivityTime: Date.now(),
  _lastCompletedCount: 0
};

let uiLock = false;

async function acquireUILock(reason) {
  let waited = 0;
  while (uiLock) {
      await wait(100);
      waited += 100;
      if (waited > 60000) {
          uiLock = false; // Force release after 60s
          break;
      }
  }
  uiLock = true;
}

function releaseUILock() {
  uiLock = false;
}

// Global Map to track waiting downloads
let pendingDownloads = new Map();
// FIX: startAutomation() gán downloadQueue/activeDownloads nhưng chưa bao giờ
// khai báo -> tạo biến global ngầm (sloppy mode). Khai báo tường minh.
let downloadQueue = [];
let activeDownloads = 0;

// ══════════════════════════ ĐA TAB (1.7.0) ══════════════════════════
// Mỗi tab Flow là một content script độc lập. Ba thứ dùng chung toàn trình
// duyệt phải được điều phối qua background: hàng đợi tên file tải xuống, cờ
// trạng thái chạy (để tự F5 không lẫn dự án của tab khác) và nhịp bấm "Tạo".
let veoTabId = null;      // tabId thật do background cấp
let veoTabSlot = 1;       // số thứ tự tab (1,2,3…) dùng để đặt tên dự án
let downloadLockHeld = false;
let lockRenewTimer = null;

async function bg(action, payload = {}) {
    try {
        return await chrome.runtime.sendMessage({ action, ...payload });
    } catch (e) {
        return null;
    }
}

async function registerTab() {
    // Thử lại vài lần: service worker MV3 có thể đang khởi động lại, và nếu
    // không có tabId thì hai tab sẽ dùng chung khoá trạng thái 'single'.
    for (let attempt = 0; attempt < 5; attempt++) {
        const res = await bg('REGISTER_TAB');
        if (res?.ok) {
            veoTabId = res.tabId;
            veoTabSlot = res.slot || 1;
            return res;
        }
        await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
    return null;
}

/** Báo tiến độ tab này cho background để Side Panel vẽ danh sách đa tab. */
function reportTabStatus(extra = {}) {
    const creating = state.videos.filter(v => v.status === STATUS.CREATING || v.status === STATUS.PASTING).length;
    const done = state.videos.filter(v => v.status === STATUS.COMPLETED).length;
    const error = state.videos.filter(v => v.status === STATUS.ERROR).length;
    bg('TAB_STATUS', {
        data: {
            running: !!state.isRunning,
            projectName: state.projectName || '',
            total: state.videos.length,
            done, creating, error,
            hidden: document.visibilityState !== 'visible',
            ...extra
        }
    });
}

/** Bật/tắt chế độ đa tab (mặc định TẮT -> hành vi y như 1.6.1). */
function isMultiTab() {
    return state.settings?.multiTab === true;
}

// ───────────────── cờ trạng thái chạy, tách riêng theo tab ─────────────────
// Bản cũ dùng hai khoá đơn activeRunningProject/autoResumeProject cho cả trình
// duyệt: chạy 2 tab thì sau bước tự F5, tab này khôi phục dự án của tab kia.
async function setRunState(patch) {
    try {
        const { veoRunState = {} } = await chrome.storage.local.get('veoRunState');
        const key = String(veoTabId || 'single');
        veoRunState[key] = { ...(veoRunState[key] || {}), ...patch };
        await chrome.storage.local.set({ veoRunState });
    } catch (e) { /* noop */ }
}

async function getRunState() {
    try {
        const { veoRunState = {} } = await chrome.storage.local.get('veoRunState');
        return veoRunState[String(veoTabId || 'single')] || {};
    } catch (e) { return {}; }
}

async function clearRunState(keys) {
    try {
        const { veoRunState = {} } = await chrome.storage.local.get('veoRunState');
        const key = String(veoTabId || 'single');
        if (!veoRunState[key]) return;
        if (!keys) delete veoRunState[key];
        else keys.forEach(k => { delete veoRunState[key][k]; });
        await chrome.storage.local.set({ veoRunState });
    } catch (e) { /* noop */ }
}

// ─────────────────────────── khoá tải xuống chung ───────────────────────────
// chrome.downloads KHÔNG cho biết file tải về thuộc tab nào, nên nếu hai tab
// cùng tải thì tên file bị đổi chéo cho nhau. Vì vậy pha tải phải tuần tự:
// tab nào tới lượt thì giữ khoá, xong mới nhả cho tab kế tiếp. Việc TẠO video
// (phần tốn thời gian) vẫn chạy song song nên gần như không mất tốc độ.
async function acquireDownloadLock(reason = '') {
    if (downloadLockHeld) return true;
    const DEADLINE = 420000;            // 7 phút rồi tự giành, không để đứng hình
    let waited = 0;
    let warned = false;
    for (;;) {
        const res = await bg('ACQUIRE_DOWNLOAD_LOCK');
        // Không có background (môi trường test) -> coi như lấy được khoá.
        if (!res || res.ok) {
            downloadLockHeld = true;
            if (lockRenewTimer) clearInterval(lockRenewTimer);
            lockRenewTimer = setInterval(() => { bg('RENEW_DOWNLOAD_LOCK'); }, 15000);
            return true;
        }
        if (!warned) {
            warned = true;
            addLog('info', `🔒 Tab khác đang tải xuống, xếp hàng chờ${reason ? ` (${reason})` : ''}...`);
        }
        if (waited >= DEADLINE) {
            addLog('warning', '⚠️ Chờ khoá tải xuống quá lâu, tự giành khoá để không đứng hình.');
            downloadLockHeld = true;
            return true;
        }
        const pause = Math.min(3000, Math.max(500, res.waitMs || 1500));
        await wait(pause);
        waited += pause;
    }
}

async function releaseDownloadLock() {
    if (lockRenewTimer) { clearInterval(lockRenewTimer); lockRenewTimer = null; }
    if (!downloadLockHeld) return;
    downloadLockHeld = false;
    await bg('RELEASE_DOWNLOAD_LOCK');
}

// ═════════════════ CHẨN ĐOÁN GIAO DIỆN FLOW (1.8.0) ═════════════════
// Tiện ích này không dùng API chính thức nào của Google (Flow không có API),
// nên nó phải "đọc" giao diện web: tìm ô nhập, nút bấm, thẻ video qua
// class/thuộc tính HTML. Hễ Google đổi giao diện là các phép tìm đó trượt, và
// trước 1.8.0 biểu hiện chỉ là "bot đứng im" hoặc timeout chung chung — rất
// khó biết vỡ ở đâu.
//
// Lớp này làm ba việc:
//   1. Ưu tiên selector do CHÍNH NGƯỜI DÙNG chọn (tự vá không cần chờ ai).
//   2. Đếm số lần dò trượt; quá ngưỡng thì báo rõ "vỡ ở bước nào" thay vì treo.
//   3. Tự thu thập danh sách phần tử ứng viên (HTML rút gọn) để xuất báo cáo,
//      đủ để viết lại selector mới mà không cần người dùng tự mò F12.

/** Các phần tử DOM then chốt. Thứ tự này cũng là thứ tự hiển thị trong panel. */
const UI_TARGETS = [
  {
    key: 'promptEditor',
    label: 'Ô nhập prompt',
    hint: 'Ô gõ prompt ở dưới cùng trang Flow.',
    kind: 'single', scope: 'document', critical: true,
    native: () => findPromptTextareaNative(),
    candidates: () => visibleAll('[contenteditable="true"], textarea, [role="textbox"], .ProseMirror, [data-slate-editor]')
  },
  {
    key: 'createBtn',
    label: 'Nút Tạo (mũi tên gửi)',
    hint: 'Nút bấm để bắt đầu tạo video/ảnh, cạnh ô nhập prompt.',
    kind: 'single', scope: 'document', critical: true,
    native: () => findCreateButtonNative(),
    candidates: () => {
      // Nút gửi nằm ở nửa dưới màn hình, cạnh ô nhập -> lọc bớt cho báo cáo gọn.
      const all = visibleAll('button, [role="button"]');
      const lower = all.filter(b => b.getBoundingClientRect().top > window.innerHeight * 0.4);
      return lower.length ? lower : all;   // lọc hết thì trả về tất cả
    }
  },
  {
    key: 'searchBox',
    label: 'Ô tìm kiếm',
    hint: 'Ô tìm kiếm trên thanh công cụ, dùng để lọc thẻ trước khi tải.',
    kind: 'single', scope: 'document', critical: false,
    native: () => findFlowSearchBoxNative(),
    candidates: () => visibleAll('input')
  },
  {
    key: 'tile',
    label: 'Thẻ video / ảnh',
    hint: 'Khung chứa mỗi video hoặc ảnh đã tạo trong lưới kết quả.',
    kind: 'list', scope: 'document', critical: true,
    native: () => getOuterTilesNative(),
    // Lưới trống là chuyện BÌNH THƯỜNG (dự án mới, chưa tạo gì) -> chỉ coi là
    // vỡ khi đang chạy và đã có thẻ đáng lẽ phải thấy.
    expectWhen: () => !!state.isRunning && state.videos.some(v =>
      v.status === STATUS.CREATING || v.status === STATUS.COMPLETED),
    candidates: () => visibleAll('flow-tile-container, flow-image-tile, flow-video-tile, [data-tile-id], a[href*="/edit/workflow/"]')
  },
  {
    key: 'downloadBtn',
    label: 'Nút ⋮ trên thẻ',
    hint: 'Nút ba chấm trên mỗi thẻ, mở menu Tải xuống / Đổi tên.',
    kind: 'list', scope: 'card', critical: true,
    native: (card) => findDownloadButtonsInCardNative(card),
    expectWhen: () => getOuterTiles().length > 0,
    candidates: () => {
      const tile = getOuterTiles()[0];
      return tile ? visibleAll('button, [role="button"]', tile) : [];
    }
  },
  {
    key: 'settingsBtn',
    label: 'Nút cài đặt mô hình (1x/2x)',
    hint: 'Nút chọn model và số lượng đầu ra, cạnh ô nhập prompt.',
    kind: 'single', scope: 'document', critical: false,
    native: () => findSettingsDropdownButtonNative(),
    candidates: () => visibleAll('button[aria-haspopup], button[aria-expanded]')
  }
];

function targetOf(key) { return UI_TARGETS.find(t => t.key === key) || null; }

/** Phần tử đang hiện trên màn hình (bỏ phần tử ẩn / nằm trong thẻ kết quả). */
function isOnScreen(el) {
  if (!el || !el.getBoundingClientRect) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  try {
    const st = window.getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') return false;
  } catch (e) { /* jsdom */ }
  return true;
}

function visibleAll(selector, root = document) {
  let list = [];
  try { list = Array.from(root.querySelectorAll(selector)); } catch (e) { return []; }
  return list.filter(isOnScreen);
}

// ───────────────────────── sức khoẻ từng phần tử ─────────────────────────
const MISS_LIMIT = 3;              // trượt liên tiếp bấy nhiêu lần thì báo vỡ
const BREAK_LOG_COOLDOWN = 300000; // không spam log: 5 phút/lần cho mỗi phần tử
const uiHealth = {};               // { [key]: {misses, okAt, missAt, via, brokeAt} }

function healthOf(key) {
  if (!uiHealth[key]) uiHealth[key] = { misses: 0, okAt: 0, missAt: 0, via: null, brokeAt: 0 };
  return uiHealth[key];
}

function markTargetOk(key, via) {
  const h = healthOf(key);
  h.misses = 0;
  h.okAt = Date.now();
  h.via = via;
}

function recordTargetMiss(key) {
  const t = targetOf(key);
  const h = healthOf(key);
  // Có phần tử đáng lẽ KHÔNG tồn tại ở thời điểm này (lưới trống, chưa mở
  // menu…) -> không tính là trượt, tránh báo động sai.
  if (t?.expectWhen && !t.expectWhen()) return;

  h.misses++;
  h.missAt = Date.now();
  if (h.misses >= MISS_LIMIT) reportUiBreak(key);
}

/** Báo "có thể Google đã đổi giao diện" ở đúng bước bị vỡ. */
function reportUiBreak(key) {
  const t = targetOf(key);
  const h = healthOf(key);
  if (!t) return;
  if (Date.now() - (h.brokeAt || 0) < BREAK_LOG_COOLDOWN) return;
  h.brokeAt = Date.now();

  addLog('error',
    `🔧 KHÔNG TÌM THẤY "${t.label}" sau ${h.misses} lần thử — rất có thể Google Flow đã đổi giao diện ở bước này. ` +
    `Mở Cài đặt → Chẩn đoán giao diện Flow: bấm "Chọn trên trang" để tự chỉ lại phần tử này, ` +
    `hoặc "Tải báo cáo .txt" rồi gửi cho Claude để vá.`);

  const snapshot = {
    key,
    label: t.label,
    at: Date.now(),
    misses: h.misses,
    url: location.href,
    override: resolveSelector(key) || null,
    candidates: dumpCandidates(key, 12)
  };
  saveDiagnostics(snapshot);
  bg('UI_BREAK', { data: { key, label: t.label, misses: h.misses } });
  reportTabStatus({ uiBreak: key });
}

/** Mô tả gọn một phần tử: đủ để viết lại selector, đủ ngắn để bỏ vào báo cáo. */
function describeEl(el) {
  if (!el) return null;
  const attr = (n) => { try { return el.getAttribute(n) || ''; } catch (e) { return ''; } };
  const cls = String(el.className || '');
  return {
    tag: (el.tagName || '').toLowerCase(),
    id: el.id || '',
    cls: cls.length > 120 ? cls.slice(0, 120) + '…' : cls,
    role: attr('role'),
    aria: attr('aria-label'),
    haspopup: attr('aria-haspopup'),
    ph: attr('placeholder'),
    text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
    selector: (() => { try { return generateSelector(el); } catch (e) { return ''; } })(),
    html: (() => {
      try {
        const h = (el.outerHTML || '').replace(/\s+/g, ' ');
        return h.length > 240 ? h.slice(0, 240) + '…' : h;
      } catch (e) { return ''; }
    })()
  };
}

/** Danh sách ứng viên chung: dùng khi danh sách riêng của phần tử rỗng. */
function genericCandidates() {
  return visibleAll([
    'button', '[role="button"]', 'input', 'textarea',
    '[contenteditable="true"]', '[role="textbox"]', '[role="menuitem"]',
    '[aria-haspopup]', 'flow-tile-container', '[data-tile-id]'
  ].join(', '));
}

function dumpCandidates(key, limit = 12) {
  const t = targetOf(key);
  let els = [];
  try { els = (t?.candidates ? t.candidates() : []) || []; } catch (e) { els = []; }

  // QUAN TRỌNG: báo cáo rỗng thì vô dụng. Khi Google đổi UI, chính bộ lọc
  // riêng của phần tử (ví dụ "nút nằm ở nửa dưới màn hình") cũng có thể loại
  // hết ứng viên — lúc đó rơi về danh sách chung để báo cáo vẫn có cái mà đọc.
  if (!els.length) els = genericCandidates();

  return els.slice(0, limit).map(describeEl).filter(Boolean);
}

async function saveDiagnostics(entry) {
  try {
    const { veoUiDiagnostics = {} } = await chrome.storage.local.get('veoUiDiagnostics');
    veoUiDiagnostics[entry.key] = entry;
    // Giữ tối đa 6 mục gần nhất để không phình storage (kho chỉ ~10MB).
    const keys = Object.keys(veoUiDiagnostics);
    if (keys.length > 6) {
      keys.sort((a, b) => (veoUiDiagnostics[a].at || 0) - (veoUiDiagnostics[b].at || 0));
      keys.slice(0, keys.length - 6).forEach(k => { delete veoUiDiagnostics[k]; });
    }
    await chrome.storage.local.set({ veoUiDiagnostics });
  } catch (e) { /* chẩn đoán là best-effort, không được làm hỏng automation */ }
}

// ──────────────── bọc các hàm dò: override trước, mặc định sau ────────────────
// Người dùng chọn lại phần tử trong panel -> selector đó được ưu tiên tuyệt đối,
// nên khi Flow đổi UI họ tự vá được ngay, không phải chờ bản cập nhật.
function findViaOverride(key, root = document) {
  const sel = resolveSelector(key);
  if (!sel) return null;
  const els = visibleAll(sel, root);
  return els.length ? els : null;
}

function findTargetSingle(key, nativeFn, root = document) {
  const over = findViaOverride(key, root);
  if (over) { markTargetOk(key, 'override'); return over[0]; }

  let el = null;
  try { el = nativeFn(); } catch (e) { el = null; }
  if (el) { markTargetOk(key, 'builtin'); return el; }

  recordTargetMiss(key);
  return null;
}

function findTargetList(key, nativeFn, root = document) {
  const over = findViaOverride(key, root);
  if (over) { markTargetOk(key, 'override'); return over; }

  let els = [];
  try { els = nativeFn() || []; } catch (e) { els = []; }
  if (els.length) { markTargetOk(key, 'builtin'); return els; }

  recordTargetMiss(key);
  return [];
}

function findPromptTextarea()       { return findTargetSingle('promptEditor', findPromptTextareaNative); }
function findCreateButton()         { return findTargetSingle('createBtn',    findCreateButtonNative); }
function findFlowSearchBox()        { return findTargetSingle('searchBox',    findFlowSearchBoxNative); }
function findSettingsDropdownButton() { return findTargetSingle('settingsBtn', findSettingsDropdownButtonNative); }
function getOuterTiles()            { return findTargetList('tile', getOuterTilesNative); }
function findDownloadButtonsInCard(card) {
  if (!card) return [];
  return findTargetList('downloadBtn', () => findDownloadButtonsInCardNative(card), card);
}

// ─────────────────────── tự kiểm tra toàn bộ giao diện ───────────────────────
/**
 * Kiểm tra từng phần tử một lượt. `deep` = mở thử menu ⋮ của thẻ đầu tiên để
 * đọc danh sách mục menu (chỉ bấm mở rồi Escape, không bấm mục nào), vì chữ
 * trên menu ("Tải xuống", "Đổi tên"…) cũng là thứ Google có thể đổi.
 */
async function runUiSelfTest(deep = true) {
  const rows = [];
  for (const t of UI_TARGETS) {
    const override = resolveSelector(t.key);
    let found = null, count = 0, via = null;

    if (override) {
      const root = t.scope === 'card' ? (getOuterTilesNative()[0] || document) : document;
      const els = visibleAll(override, root);
      if (els.length) { found = els[0]; count = els.length; via = 'override'; }
    }
    if (!found) {
      try {
        const res = t.scope === 'card'
          ? t.native(getOuterTilesNative()[0] || null)
          : t.native();
        const arr = Array.isArray(res) ? res : (res ? [res] : []);
        if (arr.length) { found = arr[0]; count = arr.length; via = 'builtin'; }
      } catch (e) { /* coi như không tìm thấy */ }
    }

    const expected = t.expectWhen ? t.expectWhen() : true;
    rows.push({
      key: t.key,
      label: t.label,
      hint: t.hint,
      critical: !!t.critical,
      ok: !!found,
      // Không tìm thấy nhưng đúng ra chưa thể tồn tại (lưới trống…) -> bỏ qua,
      // không tô đỏ để người dùng không hoảng vô cớ.
      skipped: !found && !expected,
      count,
      via,
      override: override || null,
      element: found ? describeEl(found) : null,
      candidates: found ? [] : dumpCandidates(t.key, 12)
    });
  }

  let menu = null;
  if (deep) menu = await probeCardMenu();

  const report = {
    at: Date.now(),
    version: (chrome.runtime.getManifest?.().version) || '',
    url: location.href,
    title: document.title,
    tileCount: getOuterTilesNative().length,
    rows,
    menu
  };
  lastSelfTest = report;
  return report;
}

let lastSelfTest = null;

/** Mở menu ⋮ của thẻ đầu tiên, đọc các mục, rồi đóng lại bằng Escape. */
async function probeCardMenu() {
  // Đang giữa một thao tác của automation (đang dán prompt / đang tải) thì
  // KHÔNG chen vào mở menu, sẽ phá luồng đang chạy.
  if (uiLock) {
    return { ok: false, reason: 'Bot đang thao tác trên trang nên tạm chưa mở menu để kiểm tra. Hãy tạm dừng bot rồi kiểm tra lại.' };
  }

  const tile = getOuterTilesNative()[0];
  if (!tile) return { ok: false, reason: 'Lưới đang trống — hãy tạo ít nhất một video/ảnh rồi kiểm tra lại.' };

  const btn = findDownloadButtonsInCard(tile)[0];
  if (!btn) return { ok: false, reason: 'Không tìm thấy nút ⋮ trên thẻ, nên không mở được menu để đọc.' };

  try {
    closeAnyOpenMenu();
    await wait(200);
    btn.click();
    await wait(900);
    const items = getOpenMenuItems().map(el => ({
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
      aria: el.getAttribute('aria-label') || ''
    }));
    closeAnyOpenMenu();
    await wait(200);
    return items.length
      ? { ok: true, items }
      : { ok: false, reason: 'Bấm được nút ⋮ nhưng không đọc được mục menu nào (menu có thể đã đổi cấu trúc).' };
  } catch (e) {
    try { closeAnyOpenMenu(); } catch (_) {}
    return { ok: false, reason: 'Lỗi khi mở menu: ' + e.message };
  }
}

/** Giãn nhịp bấm "Tạo" giữa các tab (tránh đụng hạn mức khi dùng chung 1 account). */
async function awaitCreateSlot() {
    if (!isMultiTab()) return;
    const gap = Math.max(0, Number(state.settings.multiTabStagger) || 0) * 1000;
    if (!gap) return;
    const res = await bg('ACQUIRE_CREATE_SLOT', { gapMs: gap });
    const waitMs = Math.min(120000, Math.max(0, res?.waitMs || 0));
    if (waitMs > 0) {
        addLog('info', `⏱️ Giãn nhịp đa tab: chờ ${Math.round(waitMs / 1000)}s trước khi tạo.`);
        await wait(waitMs);
    }
}

// ==================== MESSAGE LISTENER ====================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'START_AUTOMATION') {
    handleStart(message.data);
  } else if (message.action === 'PAUSE_AUTOMATION') {
    state.isRunning = false;
    clearRunState(['active']);
    addLog('warning', '⏸️ Paused');
  } else if (message.action === 'RESUME_AUTOMATION') {
    if (!state.isRunning) {
      state.isRunning = true;
      addLog('success', '▶️ Resumed');
      mainLoop();
    }
  } else if (message.action === 'RESUME_LOADED_PROJECT') {
    // FIX: gọi handleResume() để đồng bộ activeRunningProject + báo
    // AUTOMATION_RESUMED cho Side Panel (bản cũ copy-paste thiếu 2 bước này
    // nên sau F5 nút vẫn hiện "Tiếp tục" dù bot đã chạy).
    handleResume(message.data || {});
  } else if (message.action === 'STOP_AUTOMATION') {
    state.isRunning = false;
    state.paused = false;
    clearRunState();
    addLog('warning', '⏹️ Đã dừng automation theo yêu cầu.');
    saveProject();
    reportTabStatus({ phase: 'stopped' });
    // Dừng giữa pha tải thì phải nhả khoá, nếu không các tab khác chờ tới khi
    // khoá hết hạn (45s) mới chạy tiếp được.
    releaseDownloadLock();
    chrome.runtime.sendMessage({ action: 'AUTOMATION_STOPPED' }).catch(() => {});
  } else if (message.action === 'RESET_AUTOMATION') {
    resetState();
  } else if (message.action === 'LOAD_PROJECT') {
    loadProject(message.data.projectName);
  } else if (message.action === 'DELETE_PROJECT') {
    deleteProject(message.data.projectName);
  } else if (message.action === 'UPDATE_SETTINGS') {
    state.settings = { ...state.settings, ...message.data };

  } else if (message.action === 'ENFORCE_GROUP_MODE') {
    if (message.data && message.data.zoomLevel) {
      applyPageZoom(message.data.zoomLevel);
    } else {
      applyPageZoom();
    }
    switchToGridView(false);
  } else if (message.action === 'START_PICKING') {
    startElementPicking(message.data.targetType);

  // ───────── Chẩn đoán giao diện (1.8.0) ─────────
  } else if (message.action === 'RUN_UI_SELFTEST') {
    runUiSelfTest(message.data?.deep !== false)
      .then((report) => sendResponse({ ok: true, report }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;   // trả lời không đồng bộ

  } else if (message.action === 'GET_UI_HEALTH') {
    // Trạng thái nhanh (không quét lại DOM) để panel vẽ badge.
    sendResponse({
      ok: true,
      health: UI_TARGETS.map(t => ({
        key: t.key, label: t.label, critical: !!t.critical,
        override: resolveSelector(t.key) || null,
        ...healthOf(t.key)
      })),
      lastSelfTest
    });

  } else if (message.action === 'CLEAR_UI_HEALTH') {
    UI_TARGETS.forEach(t => { delete uiHealth[t.key]; });
    chrome.storage.local.remove('veoUiDiagnostics').catch(() => {});
    addLog('info', '🧹 Đã xoá lịch sử chẩn đoán giao diện.');
    sendResponse({ ok: true });

  } else if (message.action === 'UPLOAD_IMAGES_TO_FLOW') {
    handleUploadImages(message.data, sendResponse);
    return true;   // trả lời không đồng bộ
  } else if (message.action === 'CHECK_ASSET_NAMES') {
    handleCheckAssetNames(message.data, sendResponse);
    return true;
  }
});

// FIX (1.6.0): bản cũ đặt document.body.style.zoom ĐỒNG THỜI với
// chrome.tabs.setZoom() trong background => zoom bị nhân đôi (0.8 × 0.8 = 64%),
// chữ nhỏ xíu và toạ độ getBoundingClientRect() lệch khiến click hụt nút.
// Nay chỉ dùng tab zoom (chuẩn của Chrome), body zoom luôn được ép về 1.
function applyPageZoom(zoomVal) {
  try {
    document.body.style.zoom = '';
    document.documentElement.style.zoom = '';

    if (window.location.search.includes('veo_extra_window=true') || window !== window.top) {
      return;
    }
    const zoom = parseFloat(zoomVal || state.settings?.zoomLevel || '0.8') || 0.8;
    chrome.runtime.sendMessage({ action: 'SET_TAB_ZOOM', zoom }).catch(() => {});
  } catch (e) {}
}

let _hasConfiguredGroupView = false;
async function switchToGridView(force = false) {
  await applyGroupViewSettings(force);
}

async function applyGroupViewSettings(force = false) {
  try {
    applyPageZoom();
    if (_hasConfiguredGroupView && !force) return;

    // 1. Kiểm tra xem dropdown cài đặt hiển thị đã mở chưa
    let dropdown = document.querySelector('.dropdown-content');
    let settingsGearBtn = null;

    if (!dropdown || dropdown.offsetParent === null) {
      // Tìm nút bánh răng cài đặt trên toolbar (thử tối đa 5 lần nếu trang đang khởi tạo)
      for (let attempt = 0; attempt < 5; attempt++) {
        const buttons = Array.from(document.querySelectorAll('button'));
        settingsGearBtn = buttons.find(b => {
          const icon = b.querySelector('mat-icon, i');
          const iconText = (icon?.textContent || '').trim();
          const aria = (b.getAttribute('aria-label') || b.getAttribute('title') || '').toLowerCase();
          return (['settings_2', 'settings'].includes(iconText) || aria.includes('cài đặt lưới') || aria.includes('grid setting')) && b.offsetParent !== null;
        });
        if (settingsGearBtn) break;
        await wait(300);
      }

      if (settingsGearBtn) {
        settingsGearBtn.click();
        await wait(350);
        dropdown = document.querySelector('.dropdown-content');
      }
    }

    if (!dropdown) {
      // Fallback nếu không mở được dropdown
      const iconEls = document.querySelectorAll('i.google-symbols, i.material-icons, mat-icon');
      for (const icon of iconEls) {
        const iconText = (icon.textContent || '').trim().toLowerCase();
        if (['campaign_all', 'settings_2'].includes(iconText)) {
          const btn = icon.closest('button');
          if (btn && btn.offsetParent !== null) {
            btn.click();
            await wait(300);
            break;
          }
        }
      }
      return;
    }

    // 2. Chế độ xem: Chọn "Theo nhóm" (icon: campaign_all hoặc text "Theo nhóm")
    const groupToggleBtn = dropdown.querySelector('mat-button-toggle#mat-button-toggle-1 button') ||
      Array.from(dropdown.querySelectorAll('mat-button-toggle')).find(t => {
        const txt = (t.textContent || '').toLowerCase();
        const icon = t.querySelector('mat-icon');
        return txt.includes('theo nhóm') || (icon && icon.textContent.trim() === 'campaign_all');
      })?.querySelector('button');

    if (groupToggleBtn) {
      const isChecked = groupToggleBtn.getAttribute('aria-checked') === 'true' || 
                        groupToggleBtn.closest('mat-button-toggle')?.classList.contains('mat-button-toggle-checked');
      if (!isChecked) {
        groupToggleBtn.click();
        await wait(200);
      }
    }

    // 3. Kích thước lưới: Chọn "N" (Nhỏ)
    const sizeGroups = dropdown.querySelectorAll('flow-toggles');
    let sizeGroup = null;
    for (const fg of sizeGroups) {
      const aria = (fg.getAttribute('aria-label') || '').toLowerCase();
      if (aria.includes('kích thước') || aria.includes('size')) {
        sizeGroup = fg;
        break;
      }
    }
    const targetSizeContainer = sizeGroup || dropdown;
    const nBtn = targetSizeContainer.querySelector('mat-button-toggle#mat-button-toggle-2 button') ||
      Array.from(targetSizeContainer.querySelectorAll('mat-button-toggle')).find(t => {
        const txt = (t.querySelector('.toggle-text')?.textContent || t.textContent || '').trim();
        return txt === 'N';
      })?.querySelector('button');

    if (nBtn) {
      const isChecked = nBtn.getAttribute('aria-checked') === 'true' || 
                        nBtn.closest('mat-button-toggle')?.classList.contains('mat-button-toggle-checked');
      if (!isChecked) {
        nBtn.click();
        await wait(200);
      }
    }

    // 4. Các nút gạt (Slide toggles) chuẩn theo yêu cầu:
    // a. "Âm thanh khi di chuột" -> TẮT (false)
    const soundToggle = dropdown.querySelector('button[name="sound-on-hover"]');
    if (soundToggle && soundToggle.getAttribute('aria-checked') === 'true') {
      soundToggle.click();
      await wait(100);
    }

    // b. "Trả về video không có âm thanh" -> TẮT (false)
    const silentToggle = dropdown.querySelector('button[name="return-silent-videos"]');
    if (silentToggle && silentToggle.getAttribute('aria-checked') === 'true') {
      silentToggle.click();
      await wait(100);
    }

    // c. "Hiện thông tin chi tiết về ô" -> BẬT (true)
    const detailsToggle = dropdown.querySelector('button[name="show-tile-details"]');
    if (detailsToggle && detailsToggle.getAttribute('aria-checked') !== 'true') {
      detailsToggle.click();
      await wait(100);
    }

    // d. "Xoá câu lệnh sau khi gửi" -> BẬT (true)
    const clearPromptToggle = dropdown.querySelector('button[name="clear-prompt-on-submit"]');
    if (clearPromptToggle && clearPromptToggle.getAttribute('aria-checked') !== 'true') {
      clearPromptToggle.click();
      await wait(100);
    }

    // 5. Đóng dropdown lại (nhấn Escape và click backdrop nếu có)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    const backdrop = document.querySelector('.cdk-overlay-backdrop');
    if (backdrop) backdrop.click();
    await wait(200);
    _hasConfiguredGroupView = true;
    addLog('success', '👥 Đã thiết lập chuẩn: Chế độ [Theo nhóm], Kích thước [N], Chi tiết ô [BẬT], Xoá prompt [BẬT]');
  } catch (e) {
    console.warn('[VEO] applyGroupViewSettings error:', e);
  }
}




// ==================== ELEMENT PICKER ====================
let isPicking = false;
let pickingTarget = null;
let hoverOverlay = null;
let glassPane = null; // Full screen event blocker
let pickBanner = null; // (1.8.0) bảng hướng dẫn hiện trên trang khi đang chọn

function handlePickEscape(e) {
  if (!isPicking) return;
  if (e.key !== 'Escape' && e.key !== 'Esc') return;
  e.preventDefault();
  e.stopPropagation();
  stopPicking();
  addLog('warning', '↩️ Đã huỷ chế độ chọn phần tử.');
  chrome.runtime.sendMessage({ action: 'PICK_CANCELLED' }).catch(() => {});
}

function startElementPicking(targetType) {
  if (isPicking) return;
  isPicking = true;
  pickingTarget = targetType;
  document.body.style.cursor = 'crosshair';

  // (1.8.0) Bảng hướng dẫn ngay trên trang: bản cũ chỉ ghi vào Log nên người
  // dùng bấm "Chọn trên trang" rồi không biết mình đang ở chế độ chọn.
  const t = targetOf(targetType);
  pickBanner = document.createElement('div');
  pickBanner.id = 'veo-pick-banner';
  pickBanner.style.cssText = `
    position: fixed !important; top: 12px !important; left: 50% !important;
    transform: translateX(-50%) !important; z-index: 2147483647 !important;
    background: #0ea5e9 !important; color: #fff !important;
    padding: 10px 16px !important; border-radius: 10px !important;
    font: 600 13px/1.4 'Segoe UI', system-ui, sans-serif !important;
    box-shadow: 0 8px 24px rgba(0,0,0,.35) !important; pointer-events: none !important;
    max-width: 90vw !important; text-align: center !important;
  `;
  pickBanner.textContent = t
    ? `👇 Hãy bấm vào: ${t.label} — ${t.hint}  (Esc để huỷ)`
    : `👇 Hãy bấm vào phần tử cần chọn (Esc để huỷ)`;
  document.body.appendChild(pickBanner);
  document.addEventListener('keydown', handlePickEscape, true);

  // 1. Visual Overlay (Highlight) - Pointer events NONE
  hoverOverlay = document.createElement('div');
  hoverOverlay.id = 'veo-hover-overlay';
  hoverOverlay.style.position = 'absolute';
  hoverOverlay.style.border = '2px solid #0ea5e9';
  hoverOverlay.style.background = 'rgba(14, 165, 233, 0.2)';
  hoverOverlay.style.pointerEvents = 'none'; // CRITICAL: Pass through logic
  hoverOverlay.style.zIndex = '2147483647'; // Topmost visual
  hoverOverlay.style.transition = 'all 0.05s';
  document.body.appendChild(hoverOverlay);

  // 2. Add document-level listeners (Capture Phase)
  // We do NOT use a glass pane anymore, to allow :hover on elements
  document.addEventListener('mousemove', handleDocumentMove, true); // Capture
  document.addEventListener('click', handleDocumentClick, true); // Capture
  document.addEventListener('mouseover', handleDocumentHover, true); // To help with some elements

  addLog('info', `👇 Click an element for: ${targetType} (Hover enabled)`);
}

function handleDocumentMove(e) {
  if (!isPicking) return;
  // We don't block anything here, just track
}

function handleDocumentHover(e) {
  if (!isPicking) return;
  const el = e.target;
  if (el === hoverOverlay || el.id === 'veo-hover-overlay') return;

  const rect = el.getBoundingClientRect();
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

  if (hoverOverlay) {
    hoverOverlay.style.top = (rect.top + scrollTop) + 'px';
    hoverOverlay.style.left = (rect.left + scrollLeft) + 'px';
    hoverOverlay.style.width = rect.width + 'px';
    hoverOverlay.style.height = rect.height + 'px';

    if (pickingTarget === 'cardContainer') {
      hoverOverlay.style.border = '2px dashed #facc15';
    } else {
      hoverOverlay.style.border = '2px solid #0ea5e9';
    }
  }
}

function handleDocumentClick(e) {
  if (!isPicking) return;

  // Stop default action immediately
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();

  let element = e.target;
  const target = pickingTarget;
  const spec = targetOf(target);

  // (1.8.0) Leo lên phần tử ĐÚNG NGHĨA tuỳ theo thứ đang chọn, vì người dùng
  // thường bấm vào icon/chữ bên trong chứ không phải đúng khung cần lấy.
  if (target === 'tile') {
    // Lấy khung thẻ ngoài cùng, không lấy cái ảnh/nút bên trong.
    element = element.closest('flow-tile-container, flow-image-tile, flow-video-tile, [data-tile-id]')
           || element.closest('div[class*="tile"], div[class*="card"]')
           || element;
  } else if (target === 'promptEditor') {
    element = element.closest('[contenteditable="true"], textarea, [role="textbox"]') || element;
  } else {
    const interactiveEl = element.closest('button, a, div[role="button"], span[role="button"], [role="menuitem"]');
    if (interactiveEl) element = interactiveEl;
  }

  // Selector của phần tử NẰM TRONG thẻ (nút ⋮) phải chạy được bằng
  // card.querySelectorAll(), nên sinh tương đối so với thẻ chứa nó.
  let scopeRoot = document;
  if (spec?.scope === 'card') {
    scopeRoot = element.closest('flow-tile-container, flow-image-tile, flow-video-tile, [data-tile-id]') || document;
  }

  const selector = generateSelector(element, scopeRoot);
  let matches = 0;
  try { matches = scopeRoot.querySelectorAll(selector).length; } catch (e2) { matches = 0; }

  addLog('success', `✅ Đã chọn "${spec?.label || target}": ${selector} (khớp ${matches} phần tử)`);

  stopPicking();

  chrome.runtime.sendMessage({
    action: 'PICK_RESULT',
    data: {
      targetType: target,
      selector,
      matches,
      scoped: spec?.scope === 'card',
      element: describeEl(element)
    }
  }).catch(() => { });

  return false;
}

function stopPicking() {
  isPicking = false;
  pickingTarget = null;
  document.body.style.cursor = 'default';

  if (hoverOverlay) hoverOverlay.remove();
  if (pickBanner) { pickBanner.remove(); pickBanner = null; }
  document.removeEventListener('keydown', handlePickEscape, true);

  // Remove document listeners
  document.removeEventListener('mousemove', handleDocumentMove, true);
  document.removeEventListener('click', handleDocumentClick, true);
  document.removeEventListener('mouseover', handleDocumentHover, true);
}

// ─────────────────── SINH SELECTOR (viết lại ở 1.8.0) ───────────────────
// Bản cũ trả về ngay `#id` hoặc `.class` đầu tiên, nên rất dễ sinh ra selector
// CHỈ ĐÚNG MỘT LẦN: Angular/Material đặt id động (`mat-menu-panel-3`), Radix
// đặt id kiểu `radix-:r7:`, và nhiều class là hash build (`x1f6kntn`) sẽ đổi
// ở lần deploy sau. Nay: thử nhiều phương án, ưu tiên thuộc tính bền
// (aria-label, role, data-*, tên custom element), rồi KIỂM CHỨNG lại trên DOM
// thật trước khi trả về.

/** id trông như do framework sinh ra -> không dùng làm selector. */
function isVolatileId(id = '') {
  return !id
    || /\d{2,}/.test(id)                    // mat-menu-panel-12
    || /^radix-|^:r|:$/.test(id)            // radix-:r7:
    || /^(mat|cdk|ng)-/.test(id)
    || id.length > 40;
}

/** class trông như hash build -> bỏ. */
function isVolatileClass(c = '') {
  if (!c) return true;
  if (/^(sc-|css-|jsx-|emotion-)/.test(c)) return true;
  if (/^(ng-|cdk-|mdc-)?(hover|active|focus|selected|open|hidden|disabled|animating|entering|leaving)/.test(c)) return true;
  if (/^ng-(tns|star|trigger|animat)/.test(c)) return true;
  // hash kiểu x1f6kntn / a8Kd92 / _1x2y3z: có cả chữ và số, không có dấu gạch
  if (/^_?[a-z0-9]{6,}$/i.test(c) && /\d/.test(c) && !/-/.test(c)) return true;
  return false;
}

function stableClasses(el) {
  const raw = String(el.className || '');
  if (!raw) return [];
  return raw.split(/\s+/).filter(c => c && !isVolatileClass(c)).slice(0, 3);
}

function cssEscapeValue(v = '') {
  return String(v).replace(/["\\]/g, '\\$&');
}

/**
 * Sinh selector cho `el`.
 * @param {Element} el
 * @param {Element} [root] Gốc để kiểm chứng. Với phần tử nằm TRONG thẻ video
 *   (nút ⋮), phải truyền chính thẻ đó: selector sẽ được chạy bằng
 *   card.querySelectorAll(...) nên không được phụ thuộc đường dẫn từ <body>.
 */
function generateSelector(el, root = document) {
  if (!el || el.nodeType !== 1) return '';
  const tag = el.tagName.toLowerCase();
  const attrs = (n) => { try { return el.getAttribute(n); } catch (e) { return null; } };

  const cands = [];
  const push = (s) => { if (s && !cands.includes(s)) cands.push(s); };

  // 1. id ổn định
  if (el.id && !isVolatileId(el.id)) push(`#${el.id}`);

  // 2. custom element của Flow (flow-tile-container…) — bền nhất trong thực tế
  if (tag.includes('-')) push(tag);

  // 3. thuộc tính mô tả ngữ nghĩa
  const aria = attrs('aria-label');
  const role = attrs('role');
  const ph = attrs('placeholder');
  const testId = attrs('data-testid') || attrs('data-test-id') || attrs('data-qa');
  if (testId) push(`[data-testid="${cssEscapeValue(testId)}"]`);
  if (ph) push(`${tag}[placeholder="${cssEscapeValue(ph)}"]`);
  if (aria && aria.length <= 60) push(`${tag}[aria-label="${cssEscapeValue(aria)}"]`);
  for (const n of ['data-slate-editor', 'contenteditable', 'aria-haspopup', 'aria-multiline']) {
    const v = attrs(n);
    if (v !== null && v !== '') push(`${tag}[${n}="${cssEscapeValue(v)}"]`);
  }
  if (role) {
    const cls0 = stableClasses(el)[0];
    push(cls0 ? `${tag}[role="${cssEscapeValue(role)}"].${cls0}` : `${tag}[role="${cssEscapeValue(role)}"]`);
  }

  // 4. class ổn định (kết hợp tag cho chắc)
  const cls = stableClasses(el);
  if (cls.length) {
    push(`${tag}.${cls.join('.')}`);
    push(`${tag}.${cls[0]}`);
    push(`.${cls.join('.')}`);
  }

  // Kiểm chứng: selector phải khớp ĐÚNG phần tử này và không quét quá rộng.
  const scope = (root && root.querySelectorAll) ? root : document;
  for (const s of cands) {
    try {
      const hits = Array.from(scope.querySelectorAll(s));
      if (hits.includes(el) && hits.length <= 30) return s;
    } catch (e) { /* selector không hợp lệ -> thử phương án sau */ }
  }

  // 5. Hết cách: đường dẫn cấu trúc, TƯƠNG ĐỐI so với root (dừng ở root).
  const path = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && cur !== scope && cur !== document.body) {
    let part = cur.tagName.toLowerCase();
    if (cur.id && !isVolatileId(cur.id)) { path.unshift(`${part}#${cur.id}`); break; }
    let nth = 1, sib = cur;
    while ((sib = sib.previousElementSibling)) {
      if (sib.tagName.toLowerCase() === part) nth++;
    }
    if (nth !== 1) part += `:nth-of-type(${nth})`;
    path.unshift(part);
    cur = cur.parentElement;
    if (path.length >= 6) break;   // đủ sâu, dài hơn thì càng dễ vỡ
  }
  return path.join(' > ');
}


// ==================== HELPER FUNCTIONS ====================

// Helper: Log to Side Panel
function addLog(type, message) {
  console.log(`[VEO ${type.toUpperCase()}] ${message}`);
  try {
    chrome.runtime.sendMessage({ action: 'LOG', type, message }).catch(() => { });
  } catch(e) {}
}

// Helper: Update UI (stats & table)
function updateUI() {
  const creating = state.videos.filter(v => v.status === STATUS.CREATING || v.status === STATUS.PASTING).length;
  const completed = state.videos.filter(v => v.status === STATUS.COMPLETED).length;
  const error = state.videos.filter(v => v.status === STATUS.ERROR).length;

  try {
    chrome.runtime.sendMessage({
      action: 'UPDATE_STATS',
      data: { creating, completed, error }
    }).catch(() => { });
  } catch(e) {
    console.warn("VEO Extension Context Invalidated. Please refresh the page.");
  }

  sendTableUpdate();
}

// FIX (1.6.0): bản cũ dựng chuỗi HTML rồi Side Panel parse lại bằng DOMParser
// và chỉ lấy textContent — nên tooltip, màu sắc, pill đều bị mất, và prompt bị
// cắt cứng còn 30 ký tự. Nay gửi DỮ LIỆU THUẦN (JSON) và để Side Panel render,
// prompt được truyền NGUYÊN VĂN, không giới hạn ký tự.
function sendTableUpdate() {
  const rows = state.videos.map((v) => ({
    index: v.promptIndex,
    prompt: v.promptText || '',          // full text, KHÔNG cắt
    status: v.status,
    progress: (v.progress > 2) ? Math.round(v.progress) : 0,
    error: v.error || null,
    missingTiles: !!v._isMissingTiles,
    stuck: !!v._isStuck,
    retries: v.retries || 0,
    downloadedCount: v.downloadedCount || 0,
    totalVideos: v.totalVideos || 0,
    downloaded: !!v.downloaded,
    downloadError: !!(v._downloadError || v._downloadFinalFailed),
    renamed: !!v.renamedOnCloud,
    renameSkipped: !!(v._renameError || v._renameSkipped),
    mediaType: v.mediaType || null,
    subVideos: (v.subVideos || []).map(sv => ({
      status: sv.status,
      progress: (sv.progress > 2) ? Math.round(sv.progress) : 0
    }))
  }));

  chrome.runtime.sendMessage({
    action: 'UPDATE_TABLE_DATA',
    data: {
      rows,
      autoDownload: !!state.settings.autoDownload,
      autoRename: state.settings.autoRename !== false,
      isRunning: !!state.isRunning,
      projectName: state.projectName || null,
      startTime: state.startTime || 0
    }
  }).catch(() => { });
}

function resetState() {
  state.isRunning = false;
  state.prompts = [];
  state.videos = [];
  state.startTime = 0; // Reset timer
  state.projectName = null; // Clear project name

  // FIX: reset mà không xoá cờ auto-resume thì lần F5 sau bot lại tự chạy dự án
  // cũ; và hàng đợi tên file còn sót sẽ đặt sai tên cho lần chạy mới.
  chrome.storage.local.remove(['veoState']);
  clearRunState();
  chrome.runtime.sendMessage({ action: 'CLEAR_FILENAME_QUEUE' }).catch(() => {});

  updateUI();
  addLog('success', '✅ Reset complete!');

  // Sync UI
  chrome.runtime.sendMessage({
    action: 'AUTOMATION_STOPPED'
  }).catch(() => { });
}

async function wait(ms) {
  return new Promise(resolve => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (!state.isRunning) {
        clearInterval(interval);
        resolve(); // break early
      }
      if (Date.now() - start >= ms) {
        clearInterval(interval);
        resolve();
      }
    }, 100);
  });
}

// ==================== START HANDLER ====================
function handleStart(data) {
  if (state.isRunning) return;

  // RESET STATE FOR NEW BATCH
  state.videos = [];
  state.currentIndex = 0;
  state.isPaused = false;
  state._shutdownTriggered = false;
  state._hasReloadedBeforeDownload = false;
  state._hasReloadedAfterRename = false;
  state._hasDownloadedZip = false;
  saveProject(); // Lỗi undefined do clearProject không tồn tại, đổi thành saveProject() để lưu state rỗng

  state.prompts = data.prompts || [];
  state.settings = { ...state.settings, ...data.settings };

  startAutomation(data.videosToCreate);
}

function handleResume(data) {
  if (state.isRunning) return;
  if (!state.videos || state.videos.length === 0) {
      addLog('error', '❌ Không có dữ liệu video để tiếp tục!');
      chrome.runtime.sendMessage({ action: 'AUTOMATION_STOPPED' }).catch(() => {});
      return;
  }

  state.settings = { ...state.settings, ...(data.settings || {}) };
  state.isRunning = true;
  state._shutdownTriggered = false;
  if (state.projectName) setRunState({ active: state.projectName });
  
  chrome.runtime.sendMessage({ action: 'AUTOMATION_RESUMED' }).catch(() => {});
  
  addLog('success', `▶️ LÊN ĐƯỜNG! Đang tiếp tục dự án: ${state.projectName}`);
  updateUI();
  
  if (state.settings.runMode !== 'image') {
    switchToVideoMode().then(() => mainLoop());
  } else {
    mainLoop();
  }
}

// ==================== AUTOMATION LOGIC ====================

let isEnforcingGroupMode = false;
async function startAutomation(videosToCreate) {
  if (state.isRunning) return;

  if (!videosToCreate || videosToCreate.length === 0) {
    addLog('error', 'No prompts to process!');
    return;
  }
  
  // --- CROSS-MODE MISMATCH CHECK ---
  const url = window.location.href.toLowerCase();
  const isVideoSite = url.includes('video-generation') || document.title.toLowerCase().includes('video');
  const isImageSite = url.includes('image-generation') || document.title.toLowerCase().includes('imagen');

  if (state.settings.runMode === 'video' && isImageSite && !isVideoSite) {
    addLog('error', '🚨 LỖI NGHIÊM TRỌNG: Bạn chọn [Tạo Video] trên Tool, nhưng trang web rành rành là [Tạo Ảnh]! Bot tự động dừng để tránh vòng lặp tải xuống vô tận. Kẻo sai lè.');
    // Broadcast stop out
    chrome.runtime.sendMessage({ action: 'AUTOMATION_STOPPED' }).catch(() => {});
    return;
  }
  if (state.settings.runMode === 'image' && isVideoSite && !isImageSite) {
    addLog('error', '🚨 LỖI NGHIÊM TRỌNG: Bạn chọn [Tạo Ảnh] trên Tool, nhưng trang web rành rành là [Tạo Video]! Bot tự động dừng ngay. Vui lòng chuyển đổi trên website cho khớp.');
    chrome.runtime.sendMessage({ action: 'AUTOMATION_STOPPED' }).catch(() => {});
    return;
  }
  // ---------------------------------

  // Clear old videos (fresh start)
  state.videos = [];
  
  // Reset ZIP download flag for the new project run
  state._hasDownloadedZip = false;

  // Create project name
  // (1.7.0) Gắn số thứ tự tab khi chạy đa tab: hai tab dùng chung một tên dự án
  // sẽ ghi đè dữ liệu của nhau trong veoProjects.
  const tabTag = isMultiTab() ? `_T${veoTabSlot}` : '';
  state.projectName = state.projectName || `Project_${new Date().toISOString().slice(0, 10)}_${Date.now()}${tabTag}`;

  // Reset download queue
  downloadQueue = [];
  activeDownloads = 0;
  // FIX: hàng đợi tên file ở background có thể còn tên rác từ lần chạy trước
  // (thẻ bị skip / download thất bại) khiến MỌI file của lần chạy mới bị đặt
  // sai tên theo kiểu lệch một nhịp. Xoá sạch trước khi bắt đầu.
  try { await chrome.runtime.sendMessage({ action: 'CLEAR_FILENAME_QUEUE' }); } catch (e) {}

  // Store existing cards snapshot so we don't map to old generations
  state._existingCards = new Set();
  state._existingTileIds = new Set(getAllTileIds());
  addLog('info', `Starting fresh (ignoring ${state._existingTileIds.size} existing tiles)`);

  for (const item of videosToCreate) {
    state.videos.push({
      id: `video_${Date.now()}_${item.index}`,
      promptText: item.text,
      promptIndex: item.index, // Display index (1-based)
      promptId: `pid_${Date.now()}_${item.index}`, // UNIQUE ID for DOM locking (data-fe-grid-id)
      status: STATUS.WAITING,
      progress: 0,
      retries: 0,
      cardElement: null,
      cardElements: [],
      trackedTileIds: [],
      _preClickTileIds: null,
      error: null,
      expectedVideos: state.settings.outputCount || 1, // Expected number of videos
      downloadedCount: 0,
      downloaded: false,
      _downloadQueued: false,
      _groupContainer: null,    // GROUP CONTAINER: the div wrapping all tiles for this prompt
      _preClickGroups: null,    // snapshot of groups before Create click
      createdAt: Date.now()
    });
  }

  if (state.videos.length === 0) {
    addLog('warning', '⚠️ No prompts to process!');
    return;
  }

  state.isRunning = true;
  state.startTime = Date.now(); // Start timer
  state._shutdownTriggered = false; // Reset shutdown flag
  if (state.projectName) setRunState({ active: state.projectName });
  addLog('success', `🚀 Starting automation: ${state.videos.length} prompts`);
  updateUI();
  reportTabStatus({ phase: 'running' });
  saveProject();

  // Only switch to Video mode if NOT in image mode (avoid overriding user's Nano Banana/Image selection)
  if (state.settings.runMode !== 'image') {
    await switchToVideoMode();
  } else {
    addLog('info', '🖼️ Image mode detected — skipping switchToVideoMode to keep Nano Banana active.');
  }
  mainLoop();
}

// Helper to check if the current tab is the active tab in its window.
//
// FIX (1.6.0): bản cũ gửi CHECK_TAB_ACTIVE sang background — nhưng background
// KHÔNG có handler cho action này. chrome.runtime.sendMessage vì vậy không bao
// giờ gọi callback, Promise treo mãi và mainLoop đứng im vĩnh viễn (bug "bot
// tự dừng không rõ nguyên nhân").
// Nay ưu tiên document.visibilityState (đọc tức thì, không cần round-trip) và
// chỉ hỏi background như phương án phụ, kèm timeout cứng để không thể treo.
async function isTabActive() {
  // Tab đang hiển thị => chắc chắn đang active. Không cần hỏi background.
  if (document.visibilityState === 'visible' && document.hasFocus?.() !== false) return true;
  if (document.visibilityState === 'visible') return true;

  // (1.7.0) CHẾ ĐỘ ĐA TAB: tab bị ẩn vẫn được chạy.
  // Lưu ý quan trọng về Chrome: một tab ở CỬA SỔ KHÁC vẫn là 'visible' (nên
  // mỗi cửa sổ một tab Flow là bố cục chạy tốt nhất); còn tab bị ẩn trong cùng
  // một cửa sổ sẽ bị Chrome hãm timer rất nặng -> chạy chậm, dễ timeout. Ta
  // không chặn nữa, nhưng có bộ dò throttle (checkThrottle) để cảnh báo.
  if (isMultiTab()) return true;

  try {
    const answer = await Promise.race([
      chrome.runtime.sendMessage({ action: 'CHECK_TAB_ACTIVE' }),
      new Promise(resolve => setTimeout(() => resolve(true), 2000))
    ]);
    return answer !== false;
  } catch (e) {
    return true; // mất kết nối extension -> không được chặn automation
  }
}

// ─────────────── dò Chrome hãm (throttle) tab bị ẩn ───────────────
// Chrome hạ tần suất setTimeout của tab ẩn xuống có thể còn ~1 lần/phút. Nếu
// một lệnh chờ 1s mà thực tế mất hơn 5s thì automation gần như đứng: cảnh báo
// để người dùng tách tab đó ra cửa sổ riêng (cửa sổ riêng KHÔNG bị hãm).
let throttleWarnedAt = 0;
async function checkThrottle() {
  if (!isMultiTab()) return false;
  if (document.visibilityState === 'visible') return false;

  const t0 = Date.now();
  await new Promise(r => setTimeout(r, 1000));
  const drift = Date.now() - t0;
  const throttled = drift > 5000;

  if (throttled) {
    reportTabStatus({ throttled: true });
    if (Date.now() - throttleWarnedAt > 120000) {
      throttleWarnedAt = Date.now();
      addLog('warning', `🐢 Chrome đang hãm tab này vì nó bị ẩn (1 giây thực tế mất ${(drift / 1000).toFixed(1)}s). ` +
        `Hãy KÉO TAB NÀY RA MỘT CỬA SỔ RIÊNG rồi để cửa sổ đó hiện trên màn hình — tab ở cửa sổ khác không bị hãm.`);
    }
  } else {
    reportTabStatus({ throttled: false });
  }
  return throttled;
}

// ==================== TẢI XUỐNG: MỘT BƯỚC ====================
// (1.6.1) Gộp hai khối tải/tải-lại vốn bị copy-paste gần như y hệt trong
// mainLoop thành một hàm, để chế độ "tải ngay sau khi tạo" dùng lại được mà
// không phải nhân bản thêm lần nữa.

/**
 * Bật/tắt chế độ tải ngay.
 *  - true       : luôn tải ngay sau khi mỗi prompt tạo xong
 *  - false      : gom lại, tải hết ở cuối (hành vi cũ)
 *  - 'auto'     : bật cho chế độ Ảnh, tắt cho Video (mặc định)
 */
function isImmediateDownload() {
  const s = state.settings || {};
  if (s.downloadZip) return false;
  if (!s.autoDownload) return false;
  const v = s.downloadImmediately;
  if (v === true) return true;
  if (v === false) return false;
  return s.runMode === 'image';   // 'auto' hoặc chưa đặt
}

/** Lọc thẻ của một prompt bằng ô Tìm kiếm của Flow rồi bốc thẻ đang hiện. */
async function isolateTilesViaSearch(video, label) {
  const searchBox = findFlowSearchBox();
  if (!searchBox) return null;

  const filterText = buildSearchFilterText(video);
  addLog('info', `🔍 Kích hoạt bộ lọc tìm kiếm${label}: "${filterText}"`);

  // Mở rộng khung search nếu đang thu gọn
  searchBox.focus();
  searchBox.click();
  const siblingBtn = searchBox.parentElement?.querySelector('button');
  if (siblingBtn && siblingBtn.textContent.includes('search')) siblingBtn.click();
  await wait(500);

  await setNativeValue(searchBox, filterText);
  await wait(500);
  for (const type of ['keydown', 'keyup']) {
    searchBox.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  }
  await wait(2500); // đợi Angular render lại danh sách đã lọc

  let visibleTiles = getOuterTiles().filter(t => t.offsetParent !== null || t.offsetWidth > 0);
  for (let attempt = 0; attempt < 3 && visibleTiles.length === 0; attempt++) {
    await wait(1000);
    visibleTiles = getOuterTiles().filter(t => t.offsetParent !== null || t.offsetWidth > 0);
  }

  if (visibleTiles.length > 0) {
    video.cardElements = visibleTiles;
    video.trackedTileIds = visibleTiles.map(t => extractTileId(t) || t.getAttribute('data-tile-id')).filter(Boolean);
    video.totalVideos = visibleTiles.length;
    addLog('success', `[${video.promptIndex}] 🔗 Đã bốc ${visibleTiles.length} thẻ từ bộ lọc Search${label}!`);
  } else {
    addLog('warning', `[${video.promptIndex}] Bộ lọc Search trống không, hãy cẩn thận!`);
  }
  return searchBox;
}

/** Tải media cho MỘT prompt. Trả về true nếu đã làm việc gì (để mainLoop `continue`). */
async function tryDownloadStep(waitingDownload, errorDownload) {
  const isRetry = waitingDownload.length === 0;
  const video = waitingDownload[0] || errorDownload[0];
  if (!video) return false;

  if (isRetry) {
    video.downloadRetries = (video.downloadRetries || 0) + 1;
    video._downloadError = false; // xoá cờ lỗi để thử lại
    addLog('warning', `🔄 Thử lại tải [${video.promptIndex}] (lần ${video.downloadRetries}/${state.settings.maxRetries})`);
  } else {
    addLog('info', `📥 Bắt đầu tải tệp [${video.promptIndex}]...`);
  }

  // (1.7.0) KHOÁ TẢI XUỐNG DÙNG CHUNG GIỮA CÁC TAB.
  // chrome.downloads không mang tabId, nên hai tab tải cùng lúc sẽ đổi tên file
  // chéo cho nhau. Chỉ một tab được vào pha tải tại một thời điểm.
  await acquireDownloadLock(`prompt ${video.promptIndex}`);
  await acquireUILock(isRetry ? 'download-retry' : 'download');
  let searchBox = null;
  try {
    searchBox = await isolateTilesViaSearch(video, isRetry ? ' (Retry)' : '');
    await startDownloadForVideo(video);
  } catch (e) {
    video._downloadError = true;
    if (!isRetry) video.downloadRetries = (video.downloadRetries || 0) + 1;
    addLog('error', `[${video.promptIndex}] Lỗi tải: ${e.message}`);
  } finally {
    if (searchBox) {
      await setNativeValue(searchBox, '');
      addLog('info', '🧹 Đã trả lại giao diện gốc...');
      await wait(1500);
    }
    releaseUILock();
    await releaseDownloadLock();   // nhả khoá cho tab kế tiếp
  }
  await wait(3000);
  return true;
}

// ==================== CHỐT CHẶN MẠNG (1.10.0) ====================
// `navigator.onLine` KHÔNG kiểm tra Internet. Nó chỉ đọc lại trạng thái card
// mạng mà Chrome nhận từ hệ điều hành (trên Windows là NLA). Nó kẹt ở `false`
// trong khi mọi request thật vẫn chạy bình thường, ở rất nhiều tình huống đời
// thường:
//   • máy ngủ / hibernate rồi thức dậy — Chrome chốt "offline" tới sự kiện
//     card mạng kế tiếp mới mở lại;
//   • VPN hoặc card mạng ảo (WireGuard/TAP, Hyper-V, VMware, VirtualBox) bật tắt;
//   • đổi mạng Wi-Fi ↔ LAN, hoặc Wi-Fi nhảy giữa hai điểm phát;
//   • chạy trên VPS / Remote Desktop — loại card mạng ở đó Chrome thường không
//     nhận ra, nên `onLine` là `false` VĨNH VIỄN.
//
// Bản 1.9.0 tin thẳng vào nó: `mainLoop` `continue` vô hạn nên bot chết hẳn
// (không tạo, không tải, không đổi tên) mà vẫn ghi log mỗi 5 giây × mỗi tab,
// ngập cả khung Log và không có cách nào bỏ qua.
//
// Từ 1.10.0: `onLine = false` chỉ là NGHI NGỜ. Phải gọi thật một request tới
// chính Flow rồi mới dám kết luận là mất mạng.

const NET_PROBE_TIMEOUT_MS = 8000;    // hết thời gian chờ cho một lần dò
const NET_PROBE_GAP_FAIL_MS = 15000;  // dò lại sau chừng này khi lần trước hỏng
const NET_PROBE_GAP_OK_MS = 60000;    // dò lại thưa hơn khi đã biết là báo động giả
const NET_SLEEP_MS = 5000;            // ngủ giữa hai lần thử khi mất mạng thật
const NET_RELOG_MS = 60000;           // nhắc lại log mất mạng tối đa 1 phút/lần

const net = {
  offlineSince: 0,        // 0 = đang coi như có mạng
  lastLogAt: 0,
  lastProbeAt: 0,
  lastProbeOk: true,
  lastReason: '',
  falseAlarmLogged: false
};

/** Dịch lỗi fetch sang chữ tiếng Việt cụ thể — không bao giờ báo chung chung. */
function describeNetError(e) {
  if (e && e.name === 'AbortError') {
    return `hết thời gian chờ (quá ${Math.max(1, Math.round(NET_PROBE_TIMEOUT_MS / 1000))} giây)`;
  }
  const m = String((e && e.message) || e || '');
  if (/Failed to fetch|NetworkError|network error/i.test(m)) {
    return 'không gửi được request tới Flow (mất mạng hoặc DNS lỗi)';
  }
  return m || 'lỗi không rõ';
}

/**
 * Dò mạng THẬT: gọi một tệp nhỏ CÙNG ORIGIN với Flow.
 * Cùng origin nên không vướng CORS và không cần thêm host_permissions.
 * Máy chủ trả 404 vẫn tính là CÓ MẠNG — muốn nhận được mã lỗi thì request đã
 * phải đi tới nơi rồi.
 */
async function probeNetwork() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NET_PROBE_TIMEOUT_MS);
  try {
    await fetch(`${location.origin}/favicon.ico?_=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: ctrl.signal
    });
    net.lastReason = '';
    return true;
  } catch (e) {
    net.lastReason = describeNetError(e);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Ghi nhận đã có mạng trở lại và dọn trạng thái. */
function noteNetworkBack() {
  if (net.offlineSince) {
    const secs = Math.round((Date.now() - net.offlineSince) / 1000);
    addLog('success', `🌐 Có mạng trở lại sau ${secs} giây. Bot chạy tiếp.`);
  }
  net.offlineSince = 0;
  net.lastLogAt = 0;
  net.falseAlarmLogged = false;
}

/**
 * Trả về `true` nếu được phép chạy tiếp.
 * Trả về `false` nghĩa là MẤT MẠNG THẬT — người gọi phải ngủ rồi thử lại.
 */
async function networkGateOk() {
  // Người dùng chọn bỏ qua hẳn (VPS / Remote Desktop hay báo sai vĩnh viễn).
  if (state.settings.networkGuard === 'off') return true;

  if (navigator.onLine) {
    noteNetworkBack();
    return true;
  }

  // onLine = false → chưa vội tin, dò thật nhưng có giãn nhịp.
  const now = Date.now();
  const gap = net.lastProbeOk ? NET_PROBE_GAP_OK_MS : NET_PROBE_GAP_FAIL_MS;
  if (now - net.lastProbeAt >= gap) {
    net.lastProbeAt = now;
    net.lastProbeOk = await probeNetwork();
  }

  if (net.lastProbeOk) {
    if (!net.falseAlarmLogged) {
      net.falseAlarmLogged = true;
      addLog('warning',
        '⚠️ Chrome báo mất mạng nhưng vẫn gọi được Flow — bỏ qua cảnh báo sai và chạy tiếp. ' +
        '(Hay gặp sau khi máy ngủ dậy, đổi Wi-Fi/VPN, hoặc chạy trên VPS/Remote Desktop. ' +
        'Muốn tắt hẳn chốt này: Cài đặt → Nhịp chạy & Retry → Chốt chặn mất mạng.)');
    }
    if (net.offlineSince) { net.offlineSince = 0; net.lastLogAt = 0; }
    return true;
  }

  // Mất mạng thật — ngủ đông, nhưng log GỘP chứ không lặp mỗi 5 giây.
  if (!net.offlineSince) net.offlineSince = now;
  net.falseAlarmLogged = false;
  if (now - net.lastLogAt >= NET_RELOG_MS) {
    net.lastLogAt = now;
    const mins = Math.floor((now - net.offlineSince) / 60000);
    const since = mins >= 1 ? ` (đã ${mins} phút)` : '';
    addLog('warning', `⚠️ Mất mạng thật — ${net.lastReason}. Bot ngủ đông chờ kết nối${since}...`);
  }
  return false;
}

// Tỉnh lại NGAY khi hệ điều hành báo có mạng, thay vì đợi hết nhịp dò.
// Chỉ đặt lại mốc thời gian, không ghi log ở đây — để `networkGateOk()` là nơi
// duy nhất phát log, tránh báo trùng hai dòng.
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('online', () => { net.lastProbeAt = 0; net.lastProbeOk = true; });
  window.addEventListener('offline', () => { net.lastProbeAt = 0; });
}

// ==================== MAIN LOOP ====================
async function mainLoop() {
  while (state.isRunning) {
    state.settings.maxRetries = (!isNaN(parseInt(state.settings.maxRetries)) ? parseInt(state.settings.maxRetries) : 3);
    
    const pasting = state.videos.filter(v => v.status === STATUS.PASTING);
    const creating = state.videos.filter(v => v.status === STATUS.CREATING);
    const waiting = state.videos.filter(v => v.status === STATUS.WAITING);
    const errors = state.videos.filter(v => v.status === STATUS.ERROR && (v.retries || 0) < state.settings.maxRetries);
    
    // Tải xuống cho những video đã tạo xong nhưng chưa tải đủ
    const waitingDownload = state.videos.filter(v => v.status === STATUS.COMPLETED && !v.downloaded && (v.downloadedCount || 0) < (v.totalVideos || 0) && !v._downloadError);
    // Tải lại cho những video đã tải lỗi
    const errorDownload = state.videos.filter(v => v.status === STATUS.COMPLETED && !v.downloaded && v._downloadError && (v.downloadRetries || 0) < state.settings.maxRetries);

    let delay = 20000;
    if (state.settings.pasteDelayMin && state.settings.pasteDelayMax) {
      const min = state.settings.pasteDelayMin * 1000;
      const max = state.settings.pasteDelayMax * 1000;
      delay = Math.floor(Math.random() * (max - min + 1)) + min;
    }
    
    // Nếu là prompt cuối cùng thì không cần chờ lâu
    if (waiting.length === 1 && pasting.length === 0 && creating.length === 0 && errors.length === 0) {
      delay = 2000;
    }    
    
    // ── KIỂM TRA MẠNG & ACTIVE TAB TRƯỚC KHI THỰC THI ──
    // (1.10.0) Không tin thẳng `navigator.onLine` nữa — xem khối "CHỐT CHẶN
    // MẠNG" ở trên để biết vì sao.
    if (!(await networkGateOk())) {
        await wait(NET_SLEEP_MS);
        continue;
    }
    
    // Kiểm tra xem User có đang chuyển sang tab khác trong cùng cửa sổ không
    // (Chế độ đa tab: isTabActive() luôn true, thay bằng dò throttle bên dưới.)
    if (!(await isTabActive())) {
        addLog('warning', '⚠️ Bạn đã chuyển sang Tab khác! Bot tạm ngủ để tránh lỗi. Vui lòng quay lại Tab này để tiếp tục...');
        await wait(3000);
        continue;
    }

    // Đa tab: cứ ~60s kiểm tra xem Chrome có đang hãm tab ẩn này không.
    if (isMultiTab() && Date.now() - (state._lastThrottleCheck || 0) > 60000) {
        state._lastThrottleCheck = Date.now();
        await checkThrottle();
    }

    if (uiLock) {
      await wait(1000);
      continue;
    }

    // ── GIAI ĐOẠN 1.5: MODULE ĐỔI TÊN ĐỘC LẬP (Independent Rename Module) ──
    // Chạy độc lập hoàn toàn, dù user có chọn tải xuống hay không tải xuống!
    if (state.settings.autoRename !== false) {
      const waitingRename = state.videos.filter(v => v.status === STATUS.COMPLETED && !v.renamedOnCloud && !v._renameError && !v._renameSkipped);
      if (waitingRename.length > 0) {
        const video = waitingRename[0];
        addLog('info', `⏳ [Đổi tên độc lập] Đang đổi tên cho prompt [${video.promptIndex}]...`);
        await acquireUILock('rename');
        try {
          await renameMediaOnCloud(video);
        } catch (rErr) {
          video._renameError = true;
          video._renameSkipped = true;
          addLog('warning', `[${video.promptIndex}] Lỗi đổi tên: ${rErr.message}`);
        } finally {
          releaseUILock();
        }
        await wait(1000);
        continue;
      }
    }

    // ── GIAI ĐOẠN 1.6 (1.6.1): TẢI NGAY SAU KHI TẠO XONG ──
    // Đặt TRƯỚC giai đoạn dán prompt mới: prompt nào vừa xong là tải liền, thay
    // vì đợi tạo hết cả danh sách rồi mới tải hàng loạt ở cuối. Rất hữu ích cho
    // chế độ Ảnh (tạo nhanh, tải nhanh) và giảm rủi ro thẻ bị cuộn ảo làm mất.
    if (isImmediateDownload() && (waitingDownload.length > 0 || errorDownload.length > 0)) {
      if (await tryDownloadStep(waitingDownload, errorDownload)) continue;
    }

    // ── GIAI ĐOẠN 1: Tạo mới toàn bộ ──
    if (waiting.length > 0) {
      const video = waiting[0];
      addLog('info', `🆕 Đang tạo mới: [${video.promptIndex}]`);
      // (1.7.0) Giãn nhịp giữa các tab: hạn mức tạo của Flow tính theo TÀI KHOẢN
      // nên nhiều tab bấm "Tạo" cùng lúc dễ bị dồn lỗi. Chỉ chờ khi bật đa tab
      // và người dùng đặt khoảng giãn > 0.
      await awaitCreateSlot();
      await acquireUILock('paste-new');
      try {
        await pastePrompt(video);
        state._promptsPastedSinceLastSweep = (state._promptsPastedSinceLastSweep || 0) + 1;
      } finally {
        releaseUILock();
      }
      // --- CHECKPOINT 10 PROMPT (Xử lý cuốn chiếu & Chống Stuck) ---
      const isEndOfBatch = waiting.length === 0;
      const shouldCheckpoint = (state._promptsPastedSinceLastSweep || 0) >= 10 || isEndOfBatch;
      
      if (shouldCheckpoint && creating.length > 0) {
          const now = Date.now();
          const latestPromptIndex = state.videos.reduce((max, v) => (v.status !== STATUS.WAITING && v.status !== STATUS.QUEUED) ? Math.max(max, v.promptIndex) : max, 0);
          
          let hasLocalMissing = false;
          
          // 1. Cắt tỉa (Pruning) - Đánh fail các thẻ cách xa >= 10 prompt
          for (const v of creating) {
              const distance = latestPromptIndex - v.promptIndex;
              if (distance >= 10) {
                  const timeoutLimit = state.settings.runMode === 'image' ? 120000 : (v.promptText?.includes('upscale') ? 180000 : 300000);
                  if (v._createStartTime && (now - v._createStartTime > timeoutLimit)) {
                      v.status = STATUS.ERROR;
                      v.error = "Timeout: Bị bỏ lại phía sau quá 10 prompt và quá thời gian chờ.";
                      addLog('error', `[${v.promptIndex}] Lỗi: Bị bỏ lại >10 prompt và quá hạn. Đánh FAIL tự động.`);
                      continue;
                  }
              }
              
              if (v._isMissingTiles || v._isStuck) {
                  hasLocalMissing = true;
              }
          }
          
          // --- RESTORE LOCAL SWEEP (Cuộn cục bộ tìm thẻ ẩn) ---
          if (hasLocalMissing) {
              addLog('info', `🧹 [CHECKPOINT] Kích hoạt rà soát sau khi dán ${state._promptsPastedSinceLastSweep || 'hết'} prompt. Cuộn XUỐNG tìm thẻ...`);
              
              // Nhả focus khỏi ô nhập liệu để cuộn được
              if (document.activeElement) document.activeElement.blur();
              document.body.focus();
              document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
              
              // Cuộn lặp lại tối đa 60s để tìm thẻ
              const sweepStartTime = Date.now();
              let lastScrollTop = -1;
              let scrollAttempts = 0;
              
              while (Date.now() - sweepStartTime < 60000 && scrollAttempts < 30) {
                  const currentMissing = state.videos.filter(v => v.status === STATUS.CREATING && (v._isMissingTiles || v._isStuck));
                  if (currentMissing.length === 0) {
                      addLog('success', `✅ [CHECKPOINT] Đã chốt xong toàn bộ trạng thái thẻ trong đợt này!`);
                      break;
                  }
                  
                  // Cuộn XUỐNG
                  if (typeof veoScrollBy === 'function') veoScrollBy(1000);
                  else window.scrollBy({ top: 1000, behavior: 'smooth' });
                  
                  scrollAttempts++;
                  await wait(2000);
                  
                  // Kiểm tra xem có kẹt ở cuối trang không
                  const newScrollTop = window.scrollY || document.documentElement.scrollTop;
                  if (newScrollTop === lastScrollTop) {
                      addLog('warning', `⚠️ [CHECKPOINT] Đã cuộn kịch sàn nhưng vẫn còn ${currentMissing.length} thẻ bị khuất/kẹt. Bỏ qua để dán tiếp.`);
                      break; // Đã cuộn kịch sàn
                  }
                  lastScrollTop = newScrollTop;
              }
          }
          
          state._promptsPastedSinceLastSweep = 0;
      }
      await wait(delay); // Đợi Paste Delay
      continue;
    }

    // ── GIAI ĐOẠN 2: CHỜ TOÀN BỘ TIẾN TRÌNH TẠO KẾT THÚC ──
    // Phải chờ tất cả Video đang chạy ngầm hoàn tất (thành công hoặc lỗi) mới được phép Retry!
    if (pasting.length > 0 || creating.length > 0) {
      if (Math.random() < 0.2) {
          addLog('info', `⏳ Đang chờ ${creating.length + pasting.length} tiến trình tạo ngầm hoàn tất...`);
      }
      
      // --- RESTORE BATCH SWEEP (Xử lý cuốn chiếu & Chống Stuck) ---
      const missingVideos = creating.filter(v => v._isMissingTiles || v._isStuck);
      // NGĂN CHẶN XUNG ĐỘT (FIX v1.5.6): Tuyệt đối không cuộn xuống Sweep nếu đang có thẻ vừa dán (PASTING) chờ lấy ID!
      if (missingVideos.length > 0 && pasting.length === 0) {
          if ((state._promptsPastedSinceLastSweep || 0) >= 5 || waiting.length === 0) {
              const now = Date.now();
              if (!state._lastSweepTime || (now - state._lastSweepTime > 60000)) { // 1 phút sweep 1 lần nếu stuck
                  state._lastSweepTime = now;
                  const reason = missingVideos.some(v => v._isStuck) ? 'cứu stuck' : 'tìm thẻ ẩn';
                  addLog('info', `🧹 [BATCH SWEEP] Kích hoạt rà soát sau khi dán ${state._promptsPastedSinceLastSweep || 'hết'} prompt. Cuộn trang để ${reason}...`);
                  
                  // NEW FIX: Cuộn nhiều nấc cho đến khi tìm thấy thẻ hoặc kịch sàn (giống Local Sweep)
                  const sweepStartTime = Date.now();
                  let lastScrollTop = -1;
                  let scrollAttempts = 0;
                  
                  while (Date.now() - sweepStartTime < 30000 && scrollAttempts < 20) {
                      const currentMissing = state.videos.filter(v => (v.status === STATUS.CREATING || v.status === STATUS.PASTING) && (v._isMissingTiles || v._isStuck));
                      if (currentMissing.length === 0) {
                          addLog('success', `✅ [BATCH SWEEP] Đã tìm thấy tất cả thẻ ẩn!`);
                          break;
                      }
                      
                      if (typeof veoScrollBy === 'function') veoScrollBy(1000);
                      else window.scrollBy({ top: 1000, behavior: 'smooth' });
                      
                      scrollAttempts++;
                      await wait(2000); // Đợi 2s cho DOM render và monitorCards quét 1 nhịp
                      
                      const newScrollTop = window.scrollY || document.documentElement.scrollTop;
                      if (newScrollTop === lastScrollTop) {
                          addLog('warning', `⚠️ [BATCH SWEEP] Đã cuộn kịch sàn nhưng vẫn còn thẻ khuất. Vui lòng kiểm tra lại.`);
                          break;
                      }
                      lastScrollTop = newScrollTop;
                  }
                  
                  state._promptsPastedSinceLastSweep = 0;
                  await wait(2000);
                  continue;
              }
          }
      }

      await wait(3000);
      continue;
    }

    // ── GIAI ĐOẠN 3: Thử lại các lỗi tạo (Sau khi đã tạo hết 1 vòng) ──
    const anyErrors = state.videos.filter(v => v.status === STATUS.ERROR);

    if (errors.length > 0) {
      let candidates = errors.filter(v => v.promptIndex > (state._lastRetriedPromptIndex || 0));
      if (candidates.length === 0) candidates = errors;
      
      const video = candidates[0];
      state._lastRetriedPromptIndex = video.promptIndex;
      video.retries = (video.retries || 0) + 1;
      
      addLog('warning', `🔄 Đang thử lại tạo: [${video.promptIndex}] (Lần ${video.retries}/${state.settings.maxRetries})`);
      await acquireUILock('paste-retry');
      try {
        await pastePrompt(video);
      } finally {
        releaseUILock();
      }
      await wait(delay);
      continue;
    }



    if (state.settings.autoDownload || state.settings.downloadZip) {
      if (state.settings.downloadZip) {
          if (!state._hasDownloadedZip) {
              state._hasDownloadedZip = true;
              addLog('info', '📦 Bắt đầu tải toàn bộ dự án dưới dạng ZIP...');
              await acquireDownloadLock('ZIP');   // tuần tự hoá với các tab khác
              await acquireUILock('download-zip');
              try {
                  await downloadProjectAsZip();
                   // Đánh dấu đã tải + cập nhật downloadedCount để cột 'Đã tải' hiển thị đúng
                   state.videos.forEach(v => {
                       if (v.status === STATUS.COMPLETED) {
                           v.downloaded = true;
                           v.downloadedCount = v.totalVideos || v.expectedVideos || v.downloadedCount || 0;
                       }
                   });
                   saveProject(); // Lưu ngay để reload không chạy lại
                   addLog('success', '✅ Tải ZIP thành công! Đã cập nhật cột Đã tải.');
               } catch (e) {
                   state._zipRetries = (state._zipRetries || 0) + 1;
                   addLog('error', '❌ Lỗi tải ZIP lần ' + state._zipRetries + '/3: ' + e.message);
                   if (state._zipRetries >= 3) {
                       addLog('error', 'Qua so lan retry ZIP. Dung tai - KHONG fallback sang Tai Le.');
                       state._hasDownloadedZip = true;
                   } else {
                       state._hasDownloadedZip = false;
                       addLog('warning', 'Se thu tai ZIP lai sau 5 giay...');
                   }
               } finally {
                   releaseUILock();
                   await releaseDownloadLock();
               }
               await wait(5000);
          }
      } else {
        const hasAnyDownloadWork = waitingDownload.length > 0 || errorDownload.length > 0;

        // --- TỰ ĐỘNG F5 ĐỂ DỌN THẺ LỖI TRƯỚC KHI TẢI HÀNG LOẠT ---
        // KHÔNG làm điều này ở chế độ "tải ngay": reload giữa lúc vừa tạo xong
        // sẽ mất thẻ vừa sinh ra và phải dò lại từ đầu.
        if (hasAnyDownloadWork && !state._hasReloadedBeforeDownload && !isImmediateDownload()) {
            state._hasReloadedBeforeDownload = true;
            addLog('info', '🔄 Chuẩn bị Tải Xuống! Tự động Reload trang (F5) để dọn sạch các thẻ lỗi khỏi màn hình...');
            await saveProject();
            await setRunState({ autoResume: state.projectName, active: state.projectName });
            await wait(2000);
            location.reload();
            return; // Ngừng vòng lặp để trình duyệt load lại
        }

        if (await tryDownloadStep(waitingDownload, errorDownload)) continue;
      } // End of else (legacy download)
    }

    // ── KẾT THÚC TOÀN BỘ ──
    const remainingWork = state.videos.filter(v =>
        v.status === STATUS.WAITING ||
        v.status === STATUS.PASTING ||
        v.status === STATUS.CREATING ||
        (v.status === STATUS.ERROR && (v.retries || 0) < state.settings.maxRetries) ||
        (state.settings.autoRename !== false && v.status === STATUS.COMPLETED && !v.renamedOnCloud && !v._renameError && !v._renameSkipped) ||
        ((state.settings.autoDownload || state.settings.downloadZip) && v.status === STATUS.COMPLETED && !v.downloaded && !v._downloadFinalFailed && (!v._downloadError || (v.downloadRetries || 0) < state.settings.maxRetries))
    );
    
    if (remainingWork.length === 0) {
        // --- AUDIT FINAL MEDIA ---
        if (state.settings.autoDownload) {
            let hasMissingMedia = false;
            for (const v of state.videos) {
                if (v.status === STATUS.COMPLETED && !v.downloaded && !v._downloadFinalFailed) {
                    v._finalAuditRetries = (v._finalAuditRetries || 0) + 1;
                    if (v._finalAuditRetries <= 3) {
                        v._downloadError = false;
                        v._downloadFinalFailed = false;
                        v.downloadRetries = 0;
                        hasMissingMedia = true;
                        addLog('warning', `⚠️ AUDIT CUỐI: Dự án ${v.promptIndex} tải thiếu. Retry toàn diện lần ${v._finalAuditRetries}/3...`);
                    } else {
                         v._downloadFinalFailed = true; // Đánh dấu vĩnh viễn thất bại để loại khỏi vòng lặp
                         addLog('error', `🚫 Dự án ${v.promptIndex} đã thất bại tải xuống hoàn toàn sau mọi nỗ lực Audit.`);
                    }
                }
            }
            if (hasMissingMedia) {
                addLog('info', '♻️ Kích hoạt lại vòng lặp để sửa lỗi tải thiếu.');
                await wait(2000);
                continue; 
            }
        }

        // --- RELOAD LÚC KẾT THÚC (F5) ĐỂ ĐỒNG BỘ TÊN FILE LÊN CLOUD ---
        // Nếu user tắt Tự Động Tải, web vẫn cần F5 1 lần để lưu các file đã đổi tên trên server.
        // Nếu user đã Bật Tự Động Tải, web đã được F5 ở bước trước khi tải rồi, không reload thừa.
        if (!state._hasReloadedBeforeDownload && !state._hasReloadedAtEnd) {
            state._hasReloadedAtEnd = true;
            addLog('info', '🔄 Hoàn tất tạo thẻ! Tự động Reload trang (F5) để đồng bộ tên file lên Cloud...');
            await saveProject();
            await setRunState({ autoResume: state.projectName, active: state.projectName });
            await wait(2000);
            location.reload();
            return;
        }

        const total = state.videos.length;
        const successCount = state.videos.filter(v => v.status === STATUS.COMPLETED).length;
        
        const failedCreation = state.videos.filter(v => v.status === STATUS.ERROR).map(v => v.promptIndex);
        const failedRename = state.videos.filter(v => v._renameError || v._renameSkipped).map(v => v.promptIndex);
        const failedDownload = state.videos.filter(v => v._downloadError || v._downloadFinalFailed).map(v => v.promptIndex);

        let summaryMsg = `✅ TỔNG KẾT DỰ ÁN:\n- Tạo thành công: ${successCount}/${total} prompt.`;
        let htmlSummary = `<b>✅ TỔNG KẾT DỰ ÁN:</b><br>- Tạo thành công: <b>${successCount}/${total}</b> prompt.`;
        
        if (failedCreation.length > 0) {
            summaryMsg += `\n❌ Lỗi tạo Video (Bỏ qua): Prompt số [${failedCreation.join(', ')}].`;
            htmlSummary += `<br><span style="color: #ef4444;">❌ Lỗi tạo Video (Bỏ qua): Prompt số [${failedCreation.join(', ')}].</span>`;
        }
        if (failedRename.length > 0) {
            summaryMsg += `\n⚠️ Lỗi Đổi Tên (Bỏ qua): Prompt số [${failedRename.join(', ')}] -> Hãy tự đổi tên thủ công các file này.`;
            htmlSummary += `<br><span style="color: #fbbf24;">⚠️ Lỗi Đổi Tên (Bỏ qua): Prompt số [${failedRename.join(', ')}] -> Hãy tự đổi tên thủ công các file này.</span>`;
        }
        if (failedDownload.length > 0 && (state.settings.autoDownload || state.settings.downloadZip)) {
            summaryMsg += `\n📥 Lỗi Tải Xuống (Bỏ qua): Prompt số [${failedDownload.join(', ')}].`;
            htmlSummary += `<br><span style="color: #3b82f6;">📥 Lỗi Tải Xuống (Bỏ qua): Prompt số [${failedDownload.join(', ')}].</span>`;
        }

        state.isRunning = false;
        addLog('success', summaryMsg);
        updateUI();
        await saveProject();
        await clearRunState();
        chrome.runtime.sendMessage({ action: 'AUTOMATION_STOPPED', summary: htmlSummary }).catch(() => { });

        // Kích hoạt CheckShutdown (nó sẽ tự xử lý tắt script/PC)
        await checkAutoShutdown();
        return;
    }

    addLog('info', `💤 Idle... waiting for tasks to sync.`);
    await wait(3000);
  }
}

/**
 * Tách các thẻ @Tên của Character Sync ra khỏi câu lệnh.
 * @param {string} originalPrompt câu lệnh gốc do người dùng nhập
 * @param {boolean} stripTag  true  -> XOÁ HẲN thẻ khỏi câu lệnh gửi Flow
 *                            false -> bỏ dấu @ nhưng giữ tên (hành vi gốc)
 * @returns {{text: string, chars: string[]}}
 *
 * stripTag=true dành cho tính năng Ảnh → Video: tên ảnh ("01", "02"…) chỉ là mã
 * tham chiếu tới kho ảnh, để nó lọt vào prompt sẽ làm Flow hiểu sai nội dung.
 */
function applyCharSyncTags(originalPrompt, stripTag) {
  const src = String(originalPrompt || '');
  const matches = Array.from(src.matchAll(/@([\p{L}\p{N}_]+)/gu));
  const chars = [...new Set(matches.map(m => m[1]))];

  const text = stripTag
    ? src.replace(/@([\p{L}\p{N}_]+)/gu, ' ').replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim()
    : src.replace(/@([\p{L}\p{N}_]+)/gu, '$1');

  return { text, chars };
}

// ==================== PASTE PROMPT ====================
async function pastePrompt(video) {
  try {
    addLog('info', `[${video.promptIndex}] 🔍 Starting paste...`);
    video._pasteTime = Date.now();
    video._sniffStartIndex = window.veoSniffedMediaIds ? window.veoSniffedMediaIds.length : 0;

    // ── UI MODE VALIDATION ──
    const modeBtn = findSettingsDropdownButton();
    if (modeBtn) {
      const btnText = modeBtn.textContent.trim().toLowerCase();
      // Flow's Video mode always contains "video". Image mode (Nano Banana, Imagen) doesn't.
      const isUIVideo = btnText.includes('video');
      
      if (state.settings.runMode === 'video' && !isUIVideo) {
        alert(`🚨 LỖI GIAO DIỆN:\n\nBạn đang chọn chế độ [Treo Video] trên Extension.\nNhưng Web của Google lại đang là [${modeBtn.textContent.trim()}].\n\nBot đã dừng! Vui lòng nhấp vào chữ [${modeBtn.textContent.trim()}] trên web và đổi thành thẻ [Video] trước khi chạy tiếp.`);
        state.isRunning = false;
        chrome.runtime.sendMessage({ action: 'AUTOMATION_STOPPED' }).catch(() => {});
        throw new Error(`Bot tự động dừng: Sai chế độ giao diện (Yêu cầu Video).`);
      }
      if (state.settings.runMode === 'image' && isUIVideo) {
        alert(`🚨 LỖI GIAO DIỆN:\n\nBạn đang chọn chế độ [Treo Ảnh] trên Extension.\nNhưng Web của Google lại đang là [${modeBtn.textContent.trim()}].\n\nBot đã dừng! Vui lòng nhấp vào chữ [${modeBtn.textContent.trim()}] trên web và đổi thành thẻ Tạo Ảnh (ví dụ: Nano Banana Pro) trước khi chạy tiếp.`);
        state.isRunning = false;
        chrome.runtime.sendMessage({ action: 'AUTOMATION_STOPPED' }).catch(() => {});
        throw new Error(`Bot tự động dừng: Sai chế độ giao diện (Yêu cầu Ảnh).`);
      }
    }

    // Clear stale state from previous attempt so UI shows fresh/retrying state
    video.error = null;
    video.subVideos = [];         // clears old pills
    video.cardElement = null;
    video.cardElements = [];      // legacy compat
    video.trackedTileIds = [];    // clear old tile IDs
    // KEEP video.promptId — it persists across retries for DOM locking
    video._preClickTileIds = null;
    video._groupContainer = null; // clear old group container reference
    video.progress = 0;
    video.status = STATUS.WAITING;
    updateUI();

    // ── STEP 1: Find the prompt textarea ──
    const textarea = findPromptTextarea();
    if (!textarea) {
      addLog('error', `[${video.promptIndex}] ❌ Textarea not found!`);
      throw new Error('Textarea not found');
    }
    addLog('info', `[${video.promptIndex}] ✅ Found textarea`);

    // ── PRE-STEP: Parse @Characters ──
    // FIX: Always use original prompt from state.prompts so retries don't lose the @ tags
    let originalPrompt = state.prompts && state.prompts[video.promptIndex - 1] ? state.prompts[video.promptIndex - 1] : (video._originalPrompt || video.promptText);
    video._originalPrompt = originalPrompt;
    let textToPaste = originalPrompt;
    let requiredChars = [];
    
    if (state.settings.keyframeSync) {
        // Detect new format: (@start, @end, ...) at the beginning of the prompt. Ignore any extra tags inside ()
        const match = originalPrompt.match(/^\s*\(\s*@?([\p{L}\p{N}_-]+)\s*,\s*@?([\p{L}\p{N}_-]+)[^\)]*\)\s*([\s\S]*)/u);
        if (match) {
            requiredChars = [match[1], match[2]];
            textToPaste = match[3]; // The actual prompt text without the tags
        } else {
            // Fallback to old format: @start ... @end anywhere in text. Only take max 2.
            const matches = Array.from(originalPrompt.matchAll(/@([\p{L}\p{N}_-]+)/gu));
            requiredChars = [...new Set(matches.map(m => m[1]))].slice(0, 2);
            
            requiredChars.forEach(char => {
                textToPaste = textToPaste.replace(new RegExp(`@${char}(?![\\p{L}\\p{N}_-])`, 'gu'), char);
            });
        }
        
        if (requiredChars.length < 2) {
            addLog('error', `[${video.promptIndex}] ❌ Lỗi Khung hình: Bạn cần dùng cú pháp (@bắt_đầu, @kết_thúc) ở đầu Prompt!`);
        }
        
        video.promptText = textToPaste;
    } else if (state.settings.charSync) {
        const parsed = applyCharSyncTags(originalPrompt, state.settings.charSyncStripTag);
        requiredChars = parsed.chars;

        if (requiredChars.length === 0) {
            addLog('info', `[${video.promptIndex}] ℹ️ Prompt không có tag @Tên, bỏ qua bước gắn nhân vật.`);
        }

        textToPaste = parsed.text;

        // CẬP NHẬT LẠI PROMPT TEXT GỐC ĐỂ VÒNG LẶP THEO DÕI (monitorCards) CÓ THỂ ĐỌC ĐÚNG CHỮ
        video.promptText = textToPaste;
    }

    if (state.settings.addIndex) {
      const displayIndex = getPromptIndexNumber(video.promptIndex);
      textToPaste = `${displayIndex}. ${textToPaste}`;
    }
    video.pastedPromptText = textToPaste;

    
    // Helper to safely switch tabs in popup and return the search input
    const switchToTabAndGetSearchInput = async (tabWords, waitFunc) => {
        const findSearchInput = async () => {
            const searchWords = ['tìm kiếm', 'search', '검색', '検索', '搜索', '搜尋', 'rechercher', 'buscar', 'поиск'];
            for (let i = 0; i < 30; i++) {
                const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"]'));
                const searchInput = inputs.find(input => {
                    if (!input.offsetParent) return false;
                    const p = (input.placeholder || '').toLowerCase();
                    const a = (input.getAttribute('aria-label') || '').toLowerCase();
                    return searchWords.some(w => p.includes(w) || a.includes(w));
                });
                if (searchInput) return searchInput;
                await waitFunc(100);
            }
            return null;
        };

        let searchInput = await findSearchInput();
        if (!searchInput) return null; // popup didn't open or search not found

        const allElements = Array.from(document.querySelectorAll('*')).reverse();
        let targetTab = null;
        for (const el of allElements) {
            if (!el.offsetParent) continue;
            for (const child of el.childNodes) {
                if (child.nodeType === Node.TEXT_NODE) {
                    const txt = (child.textContent || '').trim().toLowerCase();
                    if (tabWords.includes(txt)) {
                        const clickable = el.closest('button, div[role="menuitem"], div[role="tab"], li, a, mat-list-item, [role="tab"]');
                        if (clickable) {
                            targetTab = clickable;
                            break;
                        }
                    }
                }
            }
            if (targetTab) break;
        }

        if (targetTab) {
            // Check if already selected
            const isSelected = targetTab.getAttribute('aria-selected') === 'true' || targetTab.classList.contains('selected') || targetTab.classList.contains('active');
            if (!isSelected) {
                targetTab.scrollIntoView({ behavior: 'smooth', block: 'center' });
                ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
                    targetTab.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, buttons: 1 }));
                });
                targetTab.click();
                await waitFunc(800);
                searchInput = await findSearchInput(); // re-find after tab switch
            }
        }
        return searchInput;
    };

    // ── STEP 1.5: Character/Reference Image Selection ──
    if (state.settings.charSync && !state.settings.keyframeSync && requiredChars.length > 0) {
      try {
        for (let charName of requiredChars) {
          const addBtnRaw = document.querySelector('.add-menu-trigger, .add-menu-icon, flow-add-menu button, mat-icon.add-menu-icon');
          const addBtn = addBtnRaw 
              ? (addBtnRaw.closest('button, [role="button"], flow-add-menu') || addBtnRaw)
              : Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"]')).find(b => 
                  b.classList.contains('add-menu-trigger') || 
                  (b.querySelector('mat-icon, i.google-symbols')?.textContent || '').trim() === 'add' || 
                  (b.querySelector('i.google-symbols')?.textContent || '').includes('add_2') ||
                  b.textContent.trim() === 'add'
              );
          
          if (!addBtn) throw new Error("Không tìm thấy nút dấu [+] trên giao diện");
          
          addLog('info', `[${video.promptIndex}] 🧑 Tìm nhân vật: ${charName}...`);
          addBtn.click();
          
          // Wait up to 2 seconds for the popup menu to render
          let menuRendered = false;
          for (let i = 0; i < 20; i++) {
              await wait(100);
              if (document.querySelector('input[type="text"], input[type="search"], button, [role="menuitem"]')) {
                  menuRendered = true;
                  break;
              }
          }

          // Switch to "Hình ảnh" (Images) Tab to find characters securely
          const allTabs = Array.from(document.querySelectorAll('.add-menu-popover-container [role="tab"], .cdk-overlay-container [role="tab"], mat-list-item[role="tab"]'));
          const imageTab = allTabs.find(t => {
              const icon = t.querySelector('mat-icon, i.google-symbols');
              return icon && icon.textContent.trim() === 'image';
          });
          const charTab = allTabs.find(t => {
              const icon = t.querySelector('mat-icon, i.google-symbols');
              return icon && icon.textContent.trim() === 'accessibility_new';
          });
          
          const forceClickTab = (el, isMenuTab = false) => {
              if (!el) return;
              if (isMenuTab) {
                  const isSelected = el.getAttribute('aria-selected') === 'true' || el.classList.contains('selected') || el.classList.contains('active');
                  if (isSelected) return;
              }
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
                  el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, buttons: 1 }));
              });
              el.click();
          };

          if (imageTab) {
              forceClickTab(imageTab, true);
              await wait(800);
          }

          // Find input search robustly (wait up to 3 seconds)
          let searchInput = null;
          const searchWords = ['tìm kiếm', 'search', '검색', '検索', '搜索', '搜尋', 'rechercher', 'buscar', 'поиск'];
          for (let i = 0; i < 30; i++) {
              const inputs = Array.from(document.querySelectorAll('.add-menu-popover-container input.search-input, .cdk-overlay-container input.search-input, .add-menu-popover-container input[type="text"], .add-menu-popover-container input[type="search"], .cdk-overlay-container input[type="text"]'));
              searchInput = inputs.find(input => {
                  if (!input.offsetParent) return false;
                  if (input.classList.contains('search-input')) return true;
                  const p = (input.placeholder || '').toLowerCase();
                  const a = (input.getAttribute('aria-label') || '').toLowerCase();
                  return searchWords.some(w => p.includes(w) || a.includes(w));
              });
              
              if (searchInput) break;
              await wait(100);
          }

          if (searchInput) {
              await setNativeValue(searchInput, charName);
              await wait(1500); // wait for filter to apply (increased to 1.5s for slower machines)
              
              let charItems = Array.from(document.querySelectorAll('button.asset-item, div.asset-item-container, div[data-item-index]'));
              
              // Fallback to "Nhân vật" tab if no results in "Hình ảnh"
              if (charItems.length === 0 && charTab) {
                  addLog('info', `[${video.promptIndex}] 🧑 Không thấy ảnh, thử tìm trong tab Nhân vật...`);
                  forceClickTab(charTab);
                  await wait(800);
                  await setNativeValue(searchInput, charName); // Ensure search is still applied
                  await wait(1500);
                  charItems = Array.from(document.querySelectorAll('button.asset-item, div.asset-item-container, div[data-item-index]'));
              }

              if (charItems.length > 0) {
                  let targetItem = null;
                  const cleanCharName = charName.toLowerCase().replace(/\.(jpeg|jpg|png|webp|mp4|mov|gif)/gi, '').trim();

                  for (const item of charItems) {
                      let textToUse = item.innerText || item.textContent || "";
                      // Remove all known metadata text that appears on the card in 9 languages
                      const cleanText = textToUse.toLowerCase().replace(/(check_circle|check|done|movie|image|hình ảnh|nhân vật|video|캐릭터|이미지|동영상|画像|キャラクター|動画|图片|图像|角色|视频|圖片|影片|personnage|vidéo|personaje|vídeo|персонаж|изображение)/gi, '').replace(/\.(jpeg|jpg|png|webp|mp4|mov|gif)/gi, '').trim();
                      if (cleanText === cleanCharName) {
                          targetItem = item;
                          break;
                      }
                  }

                  if (!targetItem) {
                      addLog('warning', `⚠️ Không tìm thấy ảnh khớp 100% với tên: ${charName}. Tự động chọn ảnh đầu tiên tìm được.`);
                      targetItem = charItems[0];
                  }

                  let isSelected = targetItem.getAttribute('aria-selected') === 'true' || targetItem.getAttribute('aria-checked') === 'true';
                  const icon = targetItem.querySelector('i.google-symbols');
                  if (icon && (icon.textContent.includes('check') || icon.textContent.includes('done'))) {
                      isSelected = true;
                  }

                  const enterEventDict = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
                  const forceClickItem = (el) => {
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      const clickable = el.querySelector('[role="button"], [role="checkbox"], button, div') || el;
                      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
                          clickable.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, buttons: 1 }));
                      });
                      clickable.click();
                  };

                  if (isSelected) {
                      forceClickItem(targetItem); // click once to deselect if somehow selected but we need to trigger state? Actually just leave it or toggle it.
                      await wait(400);
                  }
                  
                  // ALWAYS use force click directly on the item, rather than pressing Enter on the search box
                  forceClickItem(targetItem);
                  await wait(400);
                  // Ensure it registers by dispatching Enter on it as well
                  targetItem.focus();
                  targetItem.dispatchEvent(new KeyboardEvent('keydown', enterEventDict));
                  targetItem.dispatchEvent(new KeyboardEvent('keypress', enterEventDict));
                  targetItem.dispatchEvent(new KeyboardEvent('keyup', enterEventDict));
                  await wait(400);



                  // CẦN CLICK VÀO NÚT "Thêm vào câu lệnh"
                  const addBtns = Array.from(document.querySelectorAll('.add-menu-popover-container button.detail-add-to-prompt-btn, .cdk-overlay-container button.detail-add-to-prompt-btn, .add-menu-popover-container button, .cdk-overlay-container button')).filter(b => {
                      if (b.classList.contains('detail-add-to-prompt-btn')) return true;
                      const txt = b.textContent.trim().toLowerCase();
                      return txt.includes('thêm vào câu lệnh') || txt.includes('add to prompt') || txt === 'thêm';
                  });
                  if (addBtns.length > 0) {
                      addBtns[addBtns.length - 1].click();
                  } else {
                      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
                  }
                  
                  addLog('success', `[${video.promptIndex}] 🧑 Đã đính kèm ảnh: ${charName}`);
                  await wait(800);
              } else {
                  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
                  throw new Error(`Kho Flow thiếu ảnh nhân vật: ${charName}`);
              }
          } else {
              addLog('error', `[${video.promptIndex}] ❌ Không tìm thấy ô tìm kiếm (Search Box) trong bảng chọn Nhân vật.`);
              throw new Error("Không tìm thấy ô tìm kiếm Hình ảnh/Nhân vật. Giao diện Flow có thể đã bị thay đổi hoặc đổi ngôn ngữ (do máy chậm hoặc lỗi mạng).");
          }
        }
      } catch (err) {
          addLog('error', `[${video.promptIndex}] ❌ Lỗi Đồng nhất Nhân vật: ${err.message}`);
          throw err; 
      }
    }

    // ── STEP 1.5b: Keyframe Image Selection ──
    if (state.settings.keyframeSync) {
      if (requiredChars.length < 2) {
          addLog('error', `[${video.promptIndex}] ❌ Lỗi Khung hình: Bạn cần gắn thẻ 2 ảnh (@bắt_đầu @kết_thúc) trong Prompt!`);
          throw new Error(`Cần 2 thẻ @ảnh cho chế độ Khung hình`);
      }
      try {
        // Define logic to find the Start/End buttons structurally
        const findKeyframeBtn = async (isStart) => {
            for (let i = 0; i < 50; i++) {
                const swapIcons = Array.from(document.querySelectorAll('mat-icon, i.google-symbols')).filter(i => i.textContent.includes('swap_horiz'));
                if (swapIcons.length > 0) {
                    const swapBtn = swapIcons[0].closest('button, [role="button"]');
                    if (swapBtn && swapBtn.parentElement) {
                        const children = Array.from(swapBtn.parentElement.children);
                        const swapIdx = children.indexOf(swapBtn);
                        if (swapIdx > 0 && swapIdx < children.length - 1) {
                            let targetEl = isStart ? children[swapIdx - 1] : children[swapIdx + 1];
                            const btn = targetEl.tagName === 'BUTTON' ? targetEl : (targetEl.querySelector('button, [role="button"]') || targetEl);
                            if (btn && btn.offsetParent !== null) return btn;
                        }
                    }
                }
                
                // Fallback: look for empty-chip or media-chip directly
                const chips = Array.from(document.querySelectorAll('.keyframe-container > *'));
                if (chips.length >= 3) {
                    let targetEl = isStart ? chips[0] : chips[chips.length - 1];
                    const btn = targetEl.tagName === 'BUTTON' ? targetEl : (targetEl.querySelector('button, [role="button"]') || targetEl);
                    if (btn && btn.offsetParent !== null) return btn;
                }
                
                await wait(100);
            }
            return null;
        };

        const selectImageForBtn = async (btn, imgName) => {
          if (!btn) return;
          addLog('info', `[${video.promptIndex}] 🎞️ Tìm ảnh cho ${btn.textContent.trim()}: ${imgName}...`);
          
          const forceClickTab = (el, isMenuTab = false) => {
              if (!el) return;
              if (isMenuTab) {
                  const isSelected = el.getAttribute('aria-selected') === 'true' || el.classList.contains('selected') || el.classList.contains('active');
                  if (isSelected) return;
              }
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              const clickable = el.querySelector('button, [role="button"]') || el;
              
              const rect = clickable.getBoundingClientRect();
              const cx = rect.left + rect.width / 2;
              const cy = rect.top + rect.height / 2;
              
              ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
                  clickable.dispatchEvent(new MouseEvent(type, { 
                      bubbles: true, cancelable: true, view: window, 
                      clientX: cx, clientY: cy, buttons: 1 
                  }));
              });
              
              if (clickable !== el) el.click();
              
              clickable.focus();
              clickable.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
              clickable.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
          };

          forceClickTab(btn, false);
          await wait(1000); // wait for popup

          // Modal defaults to images, no need to switch tabs
          // Just wait a little extra for the modal to fully render
          await wait(800);

          // Find input search robustly (wait up to 3 seconds)
          let searchInput = null;
          const searchWords = ['tìm kiếm', 'search', '검색', '検索', '搜索', '搜尋', 'rechercher', 'buscar', 'поиск'];
          for (let i = 0; i < 30; i++) {
              const inputs = Array.from(document.querySelectorAll('.add-menu-popover-container input.search-input, .cdk-overlay-container input.search-input, .add-menu-popover-container input[type="text"], .add-menu-popover-container input[type="search"], .cdk-overlay-container input[type="text"]'));
              searchInput = inputs.find(input => {
                  if (!input.offsetParent) return false;
                  if (input.classList.contains('search-input')) return true;
                  const p = (input.placeholder || '').toLowerCase();
                  const a = (input.getAttribute('aria-label') || '').toLowerCase();
                  return searchWords.some(w => p.includes(w) || a.includes(w));
              });
              
              if (searchInput) break;
              await wait(100);
          }

          if (searchInput) {
              await setNativeValue(searchInput, imgName);
              await wait(1500); // wait for filter to apply
              
              let charItems = Array.from(document.querySelectorAll('button.asset-item, div.asset-item-container, div[data-item-index]'));
              
              // Fallback to "Nhân vật" tab if no results in "Hình ảnh"
              if (charItems.length === 0 && charTab) {
                  addLog('info', `[${video.promptIndex}] 🎞️ Không thấy ảnh, thử tìm trong tab Nhân vật...`);
                  forceClickTab(charTab);
                  await wait(800);
                  await setNativeValue(searchInput, imgName);
                  await wait(1500);
                  charItems = Array.from(document.querySelectorAll('button.asset-item, div.asset-item-container, div[data-item-index]'));
              }

              if (charItems.length > 0) {
                  // Find the item with EXACT matching text
                  let targetItem = null;
                  const cleanImgName = imgName.toLowerCase().replace(/\.(jpeg|jpg|png|webp|mp4|mov|gif)/gi, '').trim();

                  for (const item of charItems) {
                      let textToUse = item.innerText || item.textContent || "";
                      const cleanText = textToUse.toLowerCase().replace(/(check_circle|check|done|movie|image|hình ảnh|nhân vật|video|캐릭터|이미지|동영상|画像|キャラクター|動画|图片|图像|角色|视频|圖片|影片|personnage|vidéo|personaje|vídeo|персонаж|изображение)/gi, '').replace(/\.(jpeg|jpg|png|webp|mp4|mov|gif)/gi, '').trim();
                      if (cleanText === cleanImgName) {
                          targetItem = item;
                          break;
                      }
                  }

                  if (!targetItem) {
                      addLog('warning', `⚠️ Không tìm thấy ảnh khớp 100% với tên: ${imgName}. Tự động chọn ảnh đầu tiên tìm được.`);
                      targetItem = charItems[0];
                  }

                  let isSelected = targetItem.getAttribute('aria-selected') === 'true' || targetItem.getAttribute('aria-checked') === 'true';
                  const icon = targetItem.querySelector('i.google-symbols');
                  if (icon && (icon.textContent.includes('check') || icon.textContent.includes('done'))) {
                      isSelected = true;
                  }

                  const enterEventDict = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
                  const forceClickItem = (el) => {
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      const clickable = el.querySelector('[role="button"], [role="checkbox"], button, div') || el;
                      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
                          clickable.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, buttons: 1 }));
                      });
                      clickable.click();
                  };

                  if (isSelected) {
                      forceClickItem(targetItem);
                      await wait(400);
                  }
                  
                  forceClickItem(targetItem);
                  await wait(400);
                  targetItem.focus();
                  targetItem.dispatchEvent(new KeyboardEvent('keydown', enterEventDict));
                  targetItem.dispatchEvent(new KeyboardEvent('keypress', enterEventDict));
                  targetItem.dispatchEvent(new KeyboardEvent('keyup', enterEventDict));
                  await wait(400);

                  // CẦN CLICK VÀO NÚT "Thêm vào câu lệnh"
                  const addBtns = Array.from(document.querySelectorAll('.add-menu-popover-container button.detail-add-to-prompt-btn, .cdk-overlay-container button.detail-add-to-prompt-btn, .add-menu-popover-container button, .cdk-overlay-container button')).filter(b => {
                      if (b.classList.contains('detail-add-to-prompt-btn')) return true;
                      const txt = b.textContent.trim().toLowerCase();
                      const addWords = ['thêm', 'add', '추가', '追加', '添加', '新增', 'ajouter', 'añadir', 'agregar', 'добавить'];
                      return addWords.some(w => txt.includes(w));
                  });
                  if (addBtns.length > 0) {
                      const addBtn = addBtns[addBtns.length - 1];
                      const rect = addBtn.getBoundingClientRect();
                      const cx = rect.left + rect.width / 2;
                      const cy = rect.top + rect.height / 2;
                      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
                          addBtn.dispatchEvent(new MouseEvent(type, { 
                              bubbles: true, cancelable: true, view: window, 
                              clientX: cx, clientY: cy, buttons: 1 
                          }));
                      });
                      if (document.activeElement !== addBtn) addBtn.focus();
                      addBtn.click();
                  } else {
                      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
                  }
                  
                  addLog('success', `[${video.promptIndex}] 🎞️ Đã đính kèm ảnh: ${imgName}`);
                  await wait(800);
              } else {
                  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
                  throw new Error(`Kho Flow thiếu ảnh khung hình: ${imgName}`);
              }
          } else {
              addLog('error', `[${video.promptIndex}] ❌ Không tìm thấy ô tìm kiếm (Search Box) cho Khung hình.`);
              throw new Error("Không tìm thấy ô tìm kiếm Khung hình. Giao diện Flow có thể đã bị thay đổi.");
          }
        };

        if (requiredChars[0]) {
            const currentStartBtn = await findKeyframeBtn(true);
            if (currentStartBtn) {
                await selectImageForBtn(currentStartBtn, requiredChars[0]);
            } else {
                addLog('error', `[${video.promptIndex}] ❌ Không tìm thấy nút Bắt đầu (Start) để click.`);
                throw new Error("Không tìm thấy nút Bắt đầu trên giao diện.");
            }
        }
        
        await wait(1000); // Wait for the first popup to fully close and DOM to re-render

        if (requiredChars[1]) {
            // Re-fetch endBtn because the DOM re-renders after the first image is selected
            const currentEndBtn = await findKeyframeBtn(false);
            if (currentEndBtn) {
                await selectImageForBtn(currentEndBtn, requiredChars[1]);
            } else {
                addLog('error', `[${video.promptIndex}] ❌ Không tìm thấy nút Kết thúc (End) để click.`);
                throw new Error("Không tìm thấy nút Kết thúc trên giao diện.");
            }
        }
      } catch (err) {
          addLog('error', `[${video.promptIndex}] ❌ Lỗi Khung hình: ${err.message}`);
          throw err; 
      }
    }

    // ── STEP 1.6: Voice Selection ──
    if (state.settings.runMode !== 'image' && state.settings.voiceSync && state.settings.voiceSelect && !state.settings.keyframeSync) {
      try {
          const addBtnRaw = document.querySelector('.add-menu-trigger, .add-menu-icon, flow-add-menu button, mat-icon.add-menu-icon');
          const addBtn = addBtnRaw 
              ? (addBtnRaw.closest('button, [role="button"], flow-add-menu') || addBtnRaw)
              : Array.from(document.querySelectorAll('button, div[role="button"], span[role="button"]')).find(b => 
                  b.classList.contains('add-menu-trigger') || 
                  (b.querySelector('mat-icon, i.google-symbols')?.textContent || '').trim() === 'add' || 
                  (b.querySelector('i.google-symbols')?.textContent || '').includes('add_2') ||
                  b.textContent.trim() === 'add'
              );
          
          if (!addBtn) throw new Error("Không tìm thấy nút dấu [+] trên giao diện");
          
          addLog('info', `[${video.promptIndex}] 🎙️ Tìm giọng nói: ${state.settings.voiceSelect}...`);
          addBtn.click();
          await wait(1000); // wait for popup

          // Switch to Voice Tab
          const allTabs = Array.from(document.querySelectorAll('.add-menu-popover-container [role="tab"], .cdk-overlay-container [role="tab"], mat-list-item[role="tab"]'));
          const voiceTab = allTabs.find(t => {
              const icon = t.querySelector('mat-icon, i.google-symbols');
              return icon && icon.textContent.trim() === 'voice_selection';
          }) || allTabs[3]; // Fallback to index 3 if icon not found

          if (voiceTab) {
              const forceClickTab = (el, isMenuTab = false) => {
                  if (!el) return;
                  if (isMenuTab) {
                      const isSelected = el.getAttribute('aria-selected') === 'true' || el.classList.contains('selected') || el.classList.contains('active');
                      if (isSelected) return;
                  }
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
                      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, buttons: 1 }));
                  });
                  el.click();
              };
              forceClickTab(voiceTab, true);
              await wait(800);
          }

          // Find input search
          let searchInput = null;
          const searchWords = ['tìm kiếm', 'search', '검색', '検索', '搜索', '搜尋', 'rechercher', 'buscar', 'поиск'];
          for (let i = 0; i < 30; i++) {
              const inputs = Array.from(document.querySelectorAll('.add-menu-popover-container input.search-input, .cdk-overlay-container input.search-input, .add-menu-popover-container input[type="text"], .add-menu-popover-container input[type="search"], .cdk-overlay-container input[type="text"]'));
              searchInput = inputs.find(input => {
                  if (!input.offsetParent) return false;
                  if (input.classList.contains('search-input')) return true;
                  const p = (input.placeholder || '').toLowerCase();
                  const a = (input.getAttribute('aria-label') || '').toLowerCase();
                  return searchWords.some(w => p.includes(w) || a.includes(w));
              });
              if (searchInput) break;
              await wait(100);
          }

          if (searchInput) {
              await setNativeValue(searchInput, state.settings.voiceSelect);
              await wait(1500); // wait for filter to apply
              
              const voiceItems = Array.from(document.querySelectorAll('button.asset-item, div.asset-item-container, div[data-item-index]'));
              if (voiceItems.length > 0) {
                  const forceClickItem = (el) => {
                      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      const clickable = el.querySelector('[role="button"], [role="checkbox"], button, div') || el;
                      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(type => {
                          clickable.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, buttons: 1 }));
                      });
                      clickable.click();
                  };
                                    // Phục hồi lại cơ chế hoạt động hoàn hảo của bản 1.4.7: Enter ngay trên ô Search để auto-select
                  const enterEventDict = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
                  searchInput.focus();
                  searchInput.dispatchEvent(new KeyboardEvent('keydown', enterEventDict));
                  searchInput.dispatchEvent(new KeyboardEvent('keypress', enterEventDict));
                  searchInput.dispatchEvent(new KeyboardEvent('keyup', enterEventDict));
                  
                  await wait(500);
                  
                  // Ngoài ra click phòng hờ vào item
                  forceClickItem(voiceItems[0]);
                  await wait(500);

                  addLog('success', `[${video.promptIndex}] 🎙️ Đã chọn giọng: ${state.settings.voiceSelect}`);
                  await wait(800); 
                  
                  // CẦN CLICK VÀO NÚT "Thêm vào câu lệnh" cho Voice (nếu có)
                  const addBtns = Array.from(document.querySelectorAll('.add-menu-popover-container button.detail-add-to-prompt-btn, .cdk-overlay-container button.detail-add-to-prompt-btn, .add-menu-popover-container button, .cdk-overlay-container button')).filter(b => {
                      if (b.classList.contains('detail-add-to-prompt-btn')) return true;
                      const txt = b.textContent.trim().toLowerCase();
                      return txt.includes('thêm vào câu lệnh') || txt.includes('add to prompt') || txt === 'thêm';
                  });
                  if (addBtns.length > 0) {
                      addBtns[addBtns.length - 1].click();
                  } else {
                      // Nhấn Escape để đóng bảng chọn giọng nói (Google tự động lưu khi bấm Escape nếu không có nút thêm)
                      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
                  }
                  await wait(500);
              } else {
                  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
                  throw new Error(`Kho Flow thiếu giọng nói: ${state.settings.voiceSelect}`);
              }
          } else {
              addLog('error', `[${video.promptIndex}] ❌ Không tìm thấy ô tìm kiếm (Search Box) cho Giọng nói.`);
              throw new Error("Không tìm thấy ô tìm kiếm Giọng nói. Giao diện Flow có thể đã bị thay đổi.");
          }
      } catch (err) {
          addLog('error', `[${video.promptIndex}] ❌ Lỗi Chọn Giọng nói: ${err.message}`);
          throw err;
      }
    }

    // ── STEP 2: Paste text using execCommand insertText ──
    // Note: User should set their preferred settings (Video mode, aspect, count)
    // ONCE manually on Flow. Extension keeps those settings as-is.
    await setNativeValue(textarea, textToPaste);
    await wait(500);
    // Force Angular/ProseMirror to detect the change and enable the Create button
    textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    await wait(300);

    // ── STEP 3: Verify paste ──
    const zeroWidthAfter = textarea.querySelector('[data-slate-zero-width]');
    if (zeroWidthAfter) {
      addLog('warning', `[${video.promptIndex}] ⚠️ Zero-width still present - Slate may not have accepted text`);
      // Don't throw - continue and try to click Create anyway
    } else {
      addLog('info', `[${video.promptIndex}] 📝 Paste verified by Slate ✅`);
    }


    // ── STEP 5: Find and click Create button ──
    // Editor is still focused from paste step (we did NOT blur)
    const createBtn = findCreateButton();
    if (!createBtn) {
      addLog('error', `[${video.promptIndex}] ❌ Create button not found!`);
      throw new Error('Create button not found');
    }
    
    // Đột phá: Ép nút Create bật lên (trường hợp Angular không tự nhận diện được chữ trong ProseMirror)
    createBtn.disabled = false;
    createBtn.removeAttribute('disabled');
    createBtn.classList.remove('mat-mdc-button-disabled');
    
    addLog('info', `[${video.promptIndex}] ✅ Found create button`);

    // Snapshot TOP TILES before clicking Create.
    // New generations always appear at the top of the grid.
    // We only need to monitor the first few tiles to find the new IDs.
    // This is immune to lazy-rendered history at the bottom.
    video._preClickTopIds = new Set(
        getOuterTiles().slice(0, 10).map(t => t.getAttribute('data-tile-id'))
    );
    // ── Snapshot Grid Containers before click ──
    // This is the MOST ROBUST way to track batches. We snapshot all existing grid containers.
    // When a new one appears, we tag it with our promptId so monitorCards never mixes them up.
    // Chỉ lấy grid NGOÀI CÙNG: Flow lồng .batch-tiles-section trong
    // flow-grid-tile-container, nếu lấy cả hai thì "đóng dấu" sai phần tử và
    // monitorCards không tìm lại được thẻ.
    const getGridContainers = () => Array.from(
      document.querySelectorAll('.batch-tiles-section, flow-grid-tile-container')
    ).filter(el => !el.parentElement?.closest('.batch-tiles-section, flow-grid-tile-container'));
    video._preClickGrids = new Set(getGridContainers());
    // ANTI-FALSE-POSITIVE: Save text fingerprints of ALL existing grids.
    // These persist even when DOM elements are recycled by virtual scroll.
    // monitorCards text matching will skip any grid whose fingerprint matches this snapshot.
    video._preClickGridSnapshot = new Set(
        getGridContainers().map(gc => gc.textContent.substring(0, 200))
    );
    // ── Also snapshot image count for IMAGE MODE (Nano Banana) detection ──
    // ── KHÁC content-v2.js (sửa ở 2.8.2) — xem README mục 0a ─────────────
    //  Dòng này TRƯỚC ĐÂY đếm bằng '[data-tile-id] img, a[href*="/edit/"] img'
    //  (chỉ ảnh NẰM TRONG thẻ), trong khi hai chỗ đếm lại sau khi bấm (xem
    //  currentImageCount và currentImageCount2 ở dưới) đã bỏ '[data-tile-id]'
    //  "để chạy được với giao diện mới" — tức là đếm MỌI ảnh trên trang.
    //
    //  So một số nhỏ với một số lớn thì newImg gần như LUÔN true: nó đếm cả
    //  logo, avatar, icon. Engine vì thế kết luận "✅ Create accepted" cho mọi
    //  prompt, kể cả khi cú bấm Tạo chẳng vào đâu, rồi đi chờ thẻ kết quả
    //  không bao giờ tới — treo im lặng, không một dòng lỗi. Đúng triệu chứng
    //  nhật ký 22/09: newTile=false, txtCleared=false, newImg=true ở CẢ 6 tab.
    //
    //  Chữa: đếm TRƯỚC và SAU bằng CÙNG một bộ lọc, nên hiệu số lại có nghĩa.
    video._preClickImageCount = document.querySelectorAll('img, a[href*="/edit/"] img').length;
    // ── Click Create via MAIN world injection ──
    // Isolated world clicks are ignored by React. Route through background.js.
    addLog('info', `[${video.promptIndex}] 🖱️ Clicking Create via MAIN world...`);
    const clickResult = await chrome.runtime.sendMessage({
      action: 'INJECT_CLICK_CREATE',
      data: { tabId: null }
    });

    if (!clickResult || !clickResult.ok) {
      addLog('warning', `[${video.promptIndex}] ⚠️ INJECT_CLICK_CREATE issue: ${clickResult?.error || 'unknown'}`);
      // Fall back to direct click as last resort
      createBtn.click();
    } else {
      addLog('info', `[${video.promptIndex}] 🖱️ Create clicked (wasDisabled: ${clickResult.wasDisabled})`);
    }

    // ── STEP 6: Verify Create was accepted (Dynamic Polling) ──
    // Strategy 1: New video tile appeared (data-tile-id) → Video mode
    // Strategy 2: Textarea was cleared by Flow after submit → any mode
    // Strategy 3: New image count increased → Image mode
    let clickAccepted = false;
    let hasNewVideoTile = false;
    let textareaCleared = false;
    let hasNewImageCard = false;
    let currentText = "";
    let isInDOM = false;

    // Đoạn mồi ngắn (60 ký tự) để nhận diện thẻ: Flow luôn rút gọn prompt dài
    // khi hiển thị, so khớp 150 ký tự như bản cũ gần như luôn trượt.
    const cleanPrompt = video.promptText.replace(/\s+/g, ' ').trim().toLowerCase().substring(0, 60);

    // Poll up to 10 seconds (10 x 1s) to allow slow networks to process the click
    for (let check = 0; check < 10; check++) {
        await wait(1000);

        const currentTopIds = getOuterTiles().slice(0, 10).map(t => t.getAttribute('data-tile-id'));
        hasNewVideoTile = currentTopIds.some(id => id && !video._preClickTopIds.has(id));

        const freshTextarea = findPromptTextarea() || textarea;
        isInDOM = document.body.contains(freshTextarea);
        currentText = (isInDOM ? freshTextarea : textarea).textContent.replace(/\uFEFF/g, '').trim();
        
        // NEW UI Fix: The placeholder 'Bạn muốn tạo những gì?' or 'What do you want to create?' is inside the textContent!
        // We consider it cleared if it's empty, <= 2 chars, or matches known placeholders.
        textareaCleared = currentText.length <= 2 || 
                          currentText.includes('Bạn muốn tạo những gì') || 
                          currentText.includes('What do you want to create');

        const preClickImageCount = video._preClickImageCount || 0;
        const currentImageCount = document.querySelectorAll('img, a[href*="/edit/"] img').length; // Removed [data-tile-id] to work with new UI
        hasNewImageCard = currentImageCount > preClickImageCount;

        // ── THE ULTIMATE CHECK: Did a NEW grid container appear? ──
        const currentGrids = getGridContainers();
        const newGrids = currentGrids.filter(g => !video._preClickGrids.has(g));
        
        let hasNewBatch = false;
        let hasNewPendingTile = false;

        if (newGrids.length > 0) {
            // STAMP IT! This permanently links this grid container to our promptId.
            // monitorCards will instantly pick this up.
            newGrids[0].setAttribute('data-fe-grid-id', video.promptId);
            hasNewBatch = true;
            addLog('success', `[${video.promptIndex}] 🎯 Successfully stamped new grid with ID ${video.promptId}`);
        } else {
            // Fallback: Text matching (Risky if prompts are very similar!)
            hasNewBatch = Array.from(document.querySelectorAll('.batch-tiles-section .subtitle, .batch-tiles-section .text-part')).some(el => {
                return (el.textContent || '').replace(/\s+/g, ' ').toLowerCase().includes(cleanPrompt);
            });
            hasNewPendingTile = !hasNewBatch && Array.from(document.querySelectorAll('flow-pending-tile .subtitle')).some(el => {
                return (el.textContent || '').replace(/\s+/g, ' ').toLowerCase().includes(cleanPrompt);
            });
        }

        if (hasNewVideoTile || textareaCleared || (state.settings.runMode === 'image' && hasNewImageCard) || hasNewBatch || hasNewPendingTile) {
            clickAccepted = true;
            break;
        }
    }

    // Diagnostic log to see exactly which check triggered
    addLog('info', `[${video.promptIndex}] 🔎 Verify: newTile=${hasNewVideoTile}, txtCleared=${textareaCleared}(len=${currentText.length}), newImg=${hasNewImageCard}, newBatch=${clickAccepted && !hasNewVideoTile && !textareaCleared && !hasNewImageCard}, inDOM=${isInDOM}`);

    // Nếu chưa có thẻ mới XUẤT HIỆN, VÀ chữ vẫn còn nguyên trong khung -> Mới được phép Click Lại
    if (!clickAccepted) {
      addLog('warning', `[${video.promptIndex}] ⚠️ Cú click Tạo bị kẹt, đang thử khôi phục...`);

      // ── PHASE A: Re-focus browser tab (user may have been typing in another app) ──
      try { window.focus(); } catch(e) {}
      await wait(500);

      // ── PHASE B: Verify textarea still has OUR prompt ──
      const freshTextarea = findPromptTextarea() || textarea;
      freshTextarea.focus();
      await wait(300);
      
      const currentContent = (document.body.contains(freshTextarea) ? freshTextarea : textarea)
          .textContent.replace(/\uFEFF/g, '').trim();
      const ourPromptSnippet = video.promptText.substring(0, 50).replace(/\s+/g, ' ').trim();
      const textareaHasOurPrompt = currentContent.includes(ourPromptSnippet);
      
      // ── PHASE C: If textarea is empty or corrupted, RE-PASTE our prompt ──
      if (!textareaHasOurPrompt && currentContent.length <= 5) {
          addLog('warning', `[${video.promptIndex}] ⚠️ Textarea trống/sai. Re-paste prompt...`);
          try {
              freshTextarea.focus();
              // Select all and delete existing content
              document.execCommand('selectAll', false, null);
              document.execCommand('delete', false, null);
              await wait(200);
              // Re-paste original prompt
              await setNativeValue(freshTextarea, textToPaste);
              await wait(500);
              freshTextarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
              freshTextarea.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
              freshTextarea.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
              await wait(300);
              addLog('info', `[${video.promptIndex}] ✅ Re-paste thành công`);
          } catch(e) {
              addLog('error', `[${video.promptIndex}] ❌ Re-paste thất bại: ${e.message}`);
          }
      } else if (textareaHasOurPrompt) {
          addLog('info', `[${video.promptIndex}] ✅ Textarea vẫn chứa đúng prompt gốc, chỉ cần click lại`);
          // Wake up React state by typing a space
          try {
              freshTextarea.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
              document.execCommand('insertText', false, ' ');
              freshTextarea.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }));
              freshTextarea.dispatchEvent(new Event('input', { bubbles: true }));
              await wait(500);
          } catch(e) {}
      }

      // ── PHASE D: Re-enable Create button and click again ──
      const retryBtn = findCreateButton();
      if (retryBtn) {
          retryBtn.disabled = false;
          retryBtn.removeAttribute('disabled');
          retryBtn.classList.remove('mat-mdc-button-disabled');
      }

      addLog('info', `[${video.promptIndex}] 🖱️ Retry: Clicking Create lần 2...`);
      const clickResult2 = await chrome.runtime.sendMessage({
        action: 'INJECT_CLICK_CREATE',
        data: { tabId: null }
      });
      await wait(2000);

      const finalTopIds = getOuterTiles().slice(0, 10).map(t => t.getAttribute('data-tile-id'));
      const hasNewTileFinal = finalTopIds.some(id => id && !video._preClickTopIds.has(id));
      const freshTextarea2 = findPromptTextarea() || textarea;
      currentText = (document.body.contains(freshTextarea2) ? freshTextarea2 : textarea).textContent.replace(/\uFEFF/g, '').trim();
      const textareaCleared2 = currentText.length <= 2 || 
                                currentText.includes('Bạn muốn tạo những gì') || 
                                currentText.includes('What do you want to create');
      const currentImageCount2 = document.querySelectorAll('img, a[href*="/edit/"] img').length;
      const hasNewImageCard2 = currentImageCount2 > (video._preClickImageCount || 0);
      const hasNewBatchFinal = Array.from(document.querySelectorAll('.batch-tiles-section .subtitle, flow-pending-tile .subtitle, flow-pending-tile')).some(el => {
          return (el.textContent || '').replace(/\s+/g, ' ').toLowerCase().includes(cleanPrompt);
      });

      addLog('info', `[${video.promptIndex}] 🔎 Retry verify: newTile=${hasNewTileFinal}, txtCleared=${textareaCleared2}(len=${currentText.length}), newImg=${hasNewImageCard2}`);

      if (state.settings.runMode !== 'image' && !hasNewTileFinal && !textareaCleared2 && !hasNewImageCard2 && !hasNewBatchFinal && currentText.length > 5) {
        throw new Error('Nút Tạo không nhận lệnh sau 2 lần bấm (có thể do lỗi Giao diện hoặc nội dung cấm)');
      }
    }

    // ── STEP 7: Mark as creating — tile discovery happens in monitorCards ──
    // We purposely do NOT search for tile IDs here. monitorCards runs every 2s
    // and will discover tiles as they appear, handling staggered rendering and
    // div→<a> transitions without any timing race conditions.
    video._expectedVideoCount = getExpectedVideoCount();
    addLog('info', `[${video.promptIndex}] ✅ Create accepted — monitoring for ${video._expectedVideoCount} tiles...`);

    // ── Success ──
    video.status = STATUS.CREATING;
    video.sessionStarted = PAGE_SESSION_ID;
    video._createStartTime = Date.now();
    video._lastProgress = 0;
    video._lastProgressTime = Date.now();
    // CRITICAL FIX: Do NOT increment retries on success!
    updateUI();
    saveProject();

    // ── CRITICAL: Scroll to TOP to keep new grid in viewport ──
    // Prevents virtual scroll from unmounting the newly stamped grid.
    // Without this, user scrolling can cause data-fe-grid-id stamp to be lost.
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const scrollContainers = [
        document.querySelector('c-wiz[data-is-scrollable="true"]'),
        document.querySelector('[role="main"]')
    ];
    for (const sc of scrollContainers) {
        if (sc && typeof sc.scrollTo === 'function') sc.scrollTo({ top: 0, behavior: 'smooth' });
        else if (sc) sc.scrollTop = 0;
    }
    await wait(800);
  } catch (error) {
    video.status = STATUS.ERROR;
    video.error = error.message;
    video._pasteTime = null;
    addLog('error', `[${video.promptIndex}] ${error.message}`);
    updateUI();
  } finally {
    releaseUILock();
  }
}

// UI LOCK is defined at top of file

// ==================== GROUP STATUS AGGREGATOR ====================
// Reads status from EACH individual card in video.cardElements[]
// and aggregates into a single status object for the whole prompt.
function getGroupStatus(video) {
  const elements = (video.cardElements && video.cardElements.length > 0)
    ? video.cardElements.filter(el => document.body.contains(el))
    : (video.cardElement && document.body.contains(video.cardElement) ? [video.cardElement] : []);

  if (elements.length === 0) {
    return { status: 'CREATING', progress: video.progress || 2, videos: [], error: null };
  }

  // Get status from EACH individual card slot
  const perSlot = elements.map((el, i) => {
    const s = getCardStatus(el, video.promptText);
    // If getCardStatus returned no sub-videos, synthesize one from top-level
    const videos = s.videos && s.videos.length > 0
      ? s.videos
      : [{ id: i, status: s.status, progress: s.progress || 0 }];
    return { status: s.status, progress: s.progress || 0, videos, error: s.error };
  });

  const allSlotStatuses = perSlot.flatMap(s => s.videos);
  
  const allDone = allSlotStatuses.every(v => v.status === 'COMPLETED');
  const allError = allSlotStatuses.every(v => v.status === 'ERROR');
  const anyDone = allSlotStatuses.some(v => v.status === 'COMPLETED');
  const allFinished = allSlotStatuses.every(v => v.status === 'COMPLETED' || v.status === 'ERROR');
  const anyQueued = allSlotStatuses.some(v => v.status === 'QUEUED');

  let finalStatus = 'CREATING';
  if (allError) {
    finalStatus = 'ERROR';
  } else if (anyDone && allFinished) {
    // Nếu ít nhất 1 video đã thành công và số còn lại đã xong/lỗi -> Bỏ qua lỗi, báo Thành công chung
    finalStatus = 'COMPLETED';
  } else if (allDone) {
    finalStatus = 'COMPLETED';
  } else if (anyQueued) {
    finalStatus = 'QUEUED';
  }

  const avgProgress = Math.round(
    allSlotStatuses.reduce((sum, v) => sum + (v.progress || 0), 0) / (allSlotStatuses.length || 1)
  );

  return {
    status: finalStatus,
    progress: avgProgress,
    videos: allSlotStatuses,
    error: allError ? (perSlot.find(p => p.error)?.error || 'Lỗi toàn bộ Video') : null
  };
}

function recoverLostTiles(video) {
  // Filter out tiles claimed by OTHER active/completed videos from this session
  const allClaimedIds = new Set(
      state.videos.filter(v => v !== video).flatMap(v => v.trackedTileIds || [])
  );

  let foundCard = null;
  if (state.settings.addIndex) {
      const displayIndex = getPromptIndexNumber(video.promptIndex);
      const indexedPrompt = `${displayIndex}. ${video.promptText.replace(/^\d+[\.\)]\s*/, '')}`;
      foundCard = findNewCardByPrompt(indexedPrompt, true, true, allClaimedIds);
  }
  if (!foundCard) {
      foundCard = findNewCardByPrompt(video.promptText, true, true, allClaimedIds); // Fallback tìm không kèm STT
  }
  if (!foundCard) return [];

  const outermostTile = foundCard.closest('[data-tile-id]');
  if (!outermostTile) return [];

  const group = getGroupContainer(outermostTile);
  let recoveredTiles = [];
  if (group) {
      recoveredTiles = getOuterTilesWithin(group);
  } else {
      recoveredTiles = [outermostTile];
  }

  recoveredTiles = recoveredTiles.filter(t => {
      const id = t.getAttribute('data-tile-id');
      return id && !allClaimedIds.has(id);
  });

  if (recoveredTiles.length > 0) {
      video.trackedTileIds = recoveredTiles.map(t => t.getAttribute('data-tile-id'));
      addLog('success', `[${video.promptIndex}] 🔗 Nối lại luồng sau Reload thành công! (${recoveredTiles.length} thẻ)`);
  }
  return recoveredTiles;
}

// ==================== MONITOR CARDS ====================
let _isMonitoring = false;
async function monitorCards() {
  if (!state.isRunning || _isMonitoring) return;
  _isMonitoring = true;
  
  // FIX: Timeout bảo vệ 30s — nếu monitorCards treo (API call không trả về),
  // buộc reset lock để lần chạy tiếp không bị chặn vĩnh viễn.
  const _monitorTimeout = setTimeout(() => {
      if (_isMonitoring) {
          console.warn('[VEO] monitorCards timeout 30s — force reset lock');
          _isMonitoring = false;
      }
  }, 30000);
  
  try {

  for (const video of state.videos) {
    if (video.status === STATUS.WAITING) continue;
    if (video.status === STATUS.COMPLETED && video.downloaded) continue;

    // ── Tile Discovery: Batch Tracking (New UI) & Positional (Old UI) ──
    const expectedCount = video._expectedVideoCount || getExpectedVideoCount();
    let currentTiles = [];
    let expectedLength = 0;
    
    // NEW UI vs OLD UI Check
    // New Angular UI uses Web Components: flow-tile-container, flow-pending-tile, flow-image-tile, flow-batch-info
    // IMPORTANT: CSS classes like .batch-tiles-section, .subtitle, .loading-percentage may NOT exist at runtime
    // despite appearing in Angular template HTML dumps. We must use tag-based selectors.
    const isNewUI = document.querySelector('flow-tile-container') !== null || document.querySelector('flow-pending-tile') !== null || document.querySelector('.batch-tiles-section') !== null || document.querySelector('flow-grid-tile-container') !== null;
    // Use a longer snippet (120 chars) to prevent mismatch between similar prompts.
    // Strip leading numbers from BOTH the prompt text and the grid text so they can match!
    const cleanPromptRaw = video.promptText.replace(/\s+/g, ' ').trim().toLowerCase();
    const cleanPromptSnippet = cleanPromptRaw.replace(/^\d+[\.\-]?\s*/, '');
    const expectedDisplayIndex = getPromptIndexNumber(video.promptIndex);
    
    if (isNewUI) {
        // --- NEW UI DISCOVERY (Angular Flow 2025) ---
        // TRUTH: EVERY generation job (1 or N images) is wrapped in ONE <flow-grid-tile-container>.
        // The text prompt is inside this grid container.
        // Inside this grid container, the actual cards are either <flow-tile-container> (done) or <flow-pending-tile> (generating).
        
        let matchingGrid = null;
        
        // 1. 🎯 NEW ROBUST CHECK: Try to find the explicitly stamped grid
        // pastePrompt now assigns data-fe-grid-id to the new grid immediately after clicking Create.
        // If we find it, we know with 100% certainty this grid belongs to this prompt.
        if (video.promptId) {
            matchingGrid = document.querySelector(`.batch-tiles-section[data-fe-grid-id="${video.promptId}"], flow-grid-tile-container[data-fe-grid-id="${video.promptId}"]`);
        }

        if (!matchingGrid) {
            // Get all grids and REVERSE them to prefer the NEWEST grid (which Google Flow appends at the bottom).
            // This prevents locking onto an old grid.
            // FIX (1.6.0): bản cũ chỉ quét '.batch-tiles-section'. Flow 2025 dùng
            // <flow-grid-tile-container>, nên khi grid chưa được "đóng dấu"
            // data-fe-grid-id thì KHÔNG BAO GIỜ tìm lại được thẻ sau khi F5
            // (mất thẻ, báo "Đang dò tìm" mãi rồi timeout).
            const allGridContainers = Array.from(
                document.querySelectorAll('.batch-tiles-section, flow-grid-tile-container')
            ).filter(el => !el.parentElement?.closest('.batch-tiles-section, flow-grid-tile-container')).reverse();

            // FIX BUG 3: Exclude grids ONLY by data-fe-grid-id attribute.
            // DO NOT use cardElements (stale DOM references cause false negatives).
            const claimedGrids = new Set();
            for (const v of state.videos) {
                if (v !== video && v.promptId) {
                    const claimed = document.querySelector(`.batch-tiles-section[data-fe-grid-id="${v.promptId}"], flow-grid-tile-container[data-fe-grid-id="${v.promptId}"]`);
                    if (claimed) claimedGrids.add(claimed);
                }
            }

            for (const gc of allGridContainers) {
                if (claimedGrids.has(gc)) continue; // Skip grids claimed by other videos
                
                // If this grid is already explicitly locked to another promptId, skip it
                if (gc.hasAttribute('data-fe-grid-id') && gc.getAttribute('data-fe-grid-id') !== video.promptId) continue;
            
                // CRITICAL FIX: If we are REDISCOVERING a grid (already trackedBatch) and we HAVE workflowIds,
                // we MUST strictly match by workflowIds to prevent stealing another prompt's grid!
                if (video.trackedBatch && video.workflowIds && video.workflowIds.length > 0) {
                    const hasMyTile = video.workflowIds.some(id => gc.querySelector(`[data-tile-id="${id}"]`));
                    if (hasMyTile) {
                        matchingGrid = gc;
                        if (video.promptId) gc.setAttribute('data-fe-grid-id', video.promptId);
                        break;
                    }
                    continue; // Skip this grid if it doesn't contain our IDs
                }

            // Flow adds "1. ", "2. " prefix to prompt text in the grid.
            // If the text is truncated like "1. luffy 3D...", it will fail to match "luffy 3d animation"
            // because "luffy 3d animation" does NOT include "1. luffy 3D". We MUST strip the prefix!
            const gcTextRaw = (gc.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const gcIndexMatch = gcTextRaw.match(/^(\d+)[\.\)]\s*/);

            // FIX BẢO VỆ STT: Khi bật addIndex, thẻ trên Flow mang STT cụ thể (ví dụ 15. , 16. ).
            // Tuyệt đối không cho phép video nhận vơ grid mang STT khác!
            if (state.settings.addIndex && gcIndexMatch) {
                const gcIndex = parseInt(gcIndexMatch[1]);
                if (gcIndex !== expectedDisplayIndex) {
                    continue; // Skip: Grid này mang STT khác, không phải của prompt này!
                }
            }

            const gcText = gcTextRaw.replace(/^\d+\.\s*/, ''); // removes "1. "

            // FIX (1.6.0): prompt DÀI (hoặc nhiều dòng) bị Flow rút gọn khi hiển
            // thị, nên so khớp "chứa toàn bộ prompt" luôn thất bại. Nay so khớp
            // theo ĐOẠN MỒI 60 ký tự đầu — đủ phân biệt các prompt khác nhau mà
            // không phụ thuộc độ dài prompt.
            const promptProbe = cleanPromptSnippet.slice(0, 60);
            const gcCore = gcText.replace(/…|\.\.\./g, '').trim();
            const textMatched =
                (promptProbe.length > 0 && gcText.includes(promptProbe)) ||
                gcText.includes(cleanPromptSnippet) ||
                (gcCore.length >= 12 && cleanPromptSnippet.includes(gcCore.slice(0, 60)));

            if (textMatched) {
                // CRITICAL FIX: If we haven't tracked this batch yet, we MUST ensure we don't accidentally
                // lock onto an OLD, already-completed grid from a previous manual run.
                // A new job will always have pending tiles initially.
                if (!video.trackedBatch) {
                    const hasPending = gc.querySelector('flow-pending-tile') !== null;
                    if (!hasPending) {
                        continue; // Skip this old grid! It's already done, so it can't be our new job.
                    }
                    // ANTI-FALSE-POSITIVE: Also skip grids that existed BEFORE we clicked Create.
                    // This prevents matching old grids with similar prompt text.
                    if (video._preClickGridSnapshot && video._preClickGridSnapshot.has(gc.textContent.substring(0, 200))) {
                        continue; // This grid existed before our click — not our new job!
                    }
                }

                matchingGrid = gc;
                // Lock this grid to this video!
                if (video.promptId) {
                    gc.setAttribute('data-fe-grid-id', video.promptId);
                }
                break; // Found the newest unclaimed grid!
            }
        }
        } // Closing brace for if (!matchingGrid)

        if (matchingGrid) {
            // Extract the actual cards (pending or completed)
            // Flow UI uses a mix of flow-tile-container, flow-pending-tile, flow-image-tile, flow-video-tile.
            // Some might wrap each other. To get exactly the top-level cards, we query all,
            // then filter out any that are children of another matched node.
            const allNodes = Array.from(matchingGrid.querySelectorAll('flow-tile-container, flow-pending-tile, flow-image-tile, flow-video-tile'));
            currentTiles = allNodes.filter(node => {
                let parent = node.parentElement;
                while (parent && parent !== matchingGrid) {
                    if (allNodes.includes(parent)) return false;
                    parent = parent.parentElement;
                }
                return true;
            });
            
            // Đảm bảo gán ID (fe_id_) để phục hồi DOM khi bị cuộn mất (Virtual Scroll)
            video.trackedTileIds = video.trackedTileIds || [];
            currentTiles.forEach((tile, idx) => {
                let id = tile.getAttribute('data-tile-id') || extractTileId(tile) || getIdFromNgCtx(tile);
                if (!id) {
                    if (video.trackedTileIds[idx]) {
                        id = video.trackedTileIds[idx];
                    } else {
                        id = `fe_id_${crypto.randomUUID()}`;
                        video.trackedTileIds[idx] = id;
                        addLog('info', `[${video.promptIndex}] 🎴 New tile at top: ${id.substring(0, 15)}...`);
                    }
                }
                
                // Luôn cập nhật lại data-tile-id để nếu lấy được ID xịn sẽ override ID fe_id_ cũ
                tile.setAttribute('data-tile-id', id);
                
                if (video.trackedTileIds[idx] !== id) {
                    video.trackedTileIds[idx] = id;
                }
            });
            
            // DYNAMIC EXPECTED LENGTH: Do not hardcode to expectedCount because the user might have clicked "x2" instead of "x4".
            // Adapt to whatever Flow actually spawned!
            if (currentTiles.length > 0) {
                video._maxSeenTiles = Math.max(video._maxSeenTiles || 0, currentTiles.length);
                expectedLength = video._maxSeenTiles;
            } else {
                expectedLength = expectedCount;
            }
            
            video.trackedBatch = true;
            if (!video.notifiedBatch) {
                const isVideo = matchingGrid.querySelector('flow-video-tile') !== null;
                video.mediaType = isVideo ? 'videos' : 'ảnh';
                addLog('info', `[${video.promptIndex}] 🎴 Tìm thấy thẻ Lưới (Grid) chứa prompt! (${currentTiles.length} ${video.mediaType})`);
                video.notifiedBatch = true;
            }
        } else if (video.trackedBatch) {
            // Found before, but missing now (virtualization)
            expectedLength = video._maxSeenTiles || expectedCount;
            currentTiles = []; // forces _isMissingTiles = true
        }
    } else {
        // --- OLD UI DISCOVERY ---
        if (video._preClickTopIds && (video.status === STATUS.CREATING || video.status === STATUS.PASTING)) {
          // Look at the top 10 tiles for any NEW IDs that weren't there before we clicked
          const topTiles = getOuterTiles().slice(0, 10);
          
          const newIdsAtTop = topTiles
            .filter(t => {
              const id = t.getAttribute('data-tile-id');
              if (!id || video._preClickTopIds.has(id)) return false;
              
              const tileText = (t.textContent || '').replace(/\s+/g, ' ').toLowerCase();
              // Đoạn mồi 60 ký tự (xem ghi chú ở trên) để prompt dài vẫn khớp.
              const probe = cleanPromptSnippet.slice(0, 60);
              return probe.length > 0 && tileText.includes(probe);
            })
            .map(t => t.getAttribute('data-tile-id'));

          // Exclude IDs already claimed by other active videos
          const claimed = new Set(
            state.videos.filter(v => v !== video).flatMap(v => v.trackedTileIds || [])
          );
          
          const candidates = newIdsAtTop.filter(id => !claimed.has(id));
          const currentTracked = new Set(video.trackedTileIds || []);

          for (const id of candidates) {
            if (!currentTracked.has(id) && (video.trackedTileIds || []).length < expectedCount) {
              video.trackedTileIds = [...(video.trackedTileIds || []), id];
              currentTracked.add(id);
              addLog('info', `[${video.promptIndex}] 🎴 New tile at top: ${id.substring(0, 15)}... (${video.trackedTileIds.length}/${expectedCount})`);
            }
          }
        }

        expectedLength = video.trackedTileIds ? video.trackedTileIds.length : 0;
        currentTiles = (video.trackedTileIds || [])
          .map(id => getTileById(id))
          .filter(el => el && document.body.contains(el));
    }

    // --- LOCK TRẠNG THÁI (STATE LOCK) ---
    // Nếu đã hoàn tất (COMPLETED) hoặc LỖI (ERROR), tuyệt đối KHÔNG ĐƯỢC PHÉP hạ cấp hay cập nhật lại giao diện.
    if (video.status === STATUS.COMPLETED || video.status === STATUS.ERROR) {
        continue; 
    }

    // ── HELPER: Lay workflowId tu sniffer neu chua co ──
    // Giai quyet chicken-and-egg: workflowIds chi gan khi COMPLETED, nhung can wfId de detect COMPLETED qua API
    function ensureWorkflowId(vid) {
        let wfId = (vid.workflowIds || [])[0];
        if (!wfId && typeof vid._sniffStartIndex === 'number' && window.veoSniffedMediaIds) {
            const sniffed = window.veoSniffedMediaIds[vid._sniffStartIndex];
            if (sniffed) {
                vid.workflowIds = [sniffed];
                wfId = sniffed;
            }
        }
        return wfId;
    }

    // ── API STATUS CHECK: Goi batchexecute jwpduf kiem tra trang thai ──
    async function tryApiStatusCheck(vid) {
        const wfId = ensureWorkflowId(vid);
        if (!wfId) return false;
        if (vid._lastApiCheck && Date.now() - vid._lastApiCheck < 15000) return false;
        vid._lastApiCheck = Date.now();
        try {
            const apiResult = await checkWorkflowStatusViaAPI(wfId);
            if (apiResult && apiResult.isCompleted) {
                vid.status = STATUS.COMPLETED;
                vid.progress = 100;
                vid._isMissingTiles = false;
                vid._isStuck = false;
                if (apiResult.mediaId) {
                    vid.workflowIds = vid.workflowIds || [];
                    if (!vid.workflowIds.includes(apiResult.mediaId))
                        vid.workflowIds.push(apiResult.mediaId);
                }
                addLog('success', `[${vid.promptIndex}] ✅ Tạo xong! (Thẻ nằm ngoài màn hình nhưng hệ thống xác nhận thành công)`);
                saveProject();
                return true;
            }
            if (Math.random() < 0.15) {
                addLog('info', `[${vid.promptIndex}] ⏳ Thẻ nằm ngoài màn hình. Đang kiểm tra tiến độ qua hệ thống... (chưa xong)`);
            }
        } catch(e) { /* silent */ }
        return false;
    }

    // CASE 1: The bi che khuat boi Virtual Scroll (da tung track, nhung gio bi an)
    if (expectedLength > 0 && currentTiles.length < expectedLength) {
        video._isMissingTiles = true;

        // API POLLING thay vi bo qua hoan toan
        if (await tryApiStatusCheck(video)) continue;

        // Timeout cung BACKUP
        const missingTime = Date.now() - (video._createStartTime || Date.now());
        const missingTimeout = state.settings.runMode === 'image' ? 120000 : 300000;
        if (video._createStartTime && missingTime > missingTimeout) {
            video.status = STATUS.ERROR;
            video.error = `Quá ${Math.round(missingTimeout/60000)} phút không hoàn thành. Sẽ thử lại tự động.`;
            addLog('error', `[${video.promptIndex}] ❌ Đã chờ ${Math.round(missingTimeout/60000)} phút mà chưa xong. Đánh lỗi để thử lại tự động.`);
        }
        continue;
    } else {
        video._isMissingTiles = false;
    }

    // CASE 2: Chua co the nao spawn (trackedTileIds rong)
    if (currentTiles.length === 0) {
      if (video.status === STATUS.CREATING || video.status === STATUS.PASTING) {
          
          if (expectedLength === 0) {
              // ── CHƯA CÓ THẺ NÀO SPAWN (HOẶC VỪA TẠO NHƯNG BỊ USER CUỘN KHUẤT MẤT) ──
              
              // NEW v1.5.6: ÉP CUỘN LÊN TOP ĐỂ HỐT ID NẾU THẺ BỊ KHUẤT NGAY TỪ ĐẦU
              // Vì Google luôn đẻ thẻ mới ở trên cùng, nếu ta không thấy thẻ đâu, khả năng cao User đã lỡ tay cuộn chuột xuống!
              const currentScroll = window.scrollY || document.documentElement.scrollTop;
              if (currentScroll > 100) {
                  addLog('warning', `[${video.promptIndex}] ⚠️ Không thấy thẻ mới! Ép cuộn lên Top để bắt ID...`);
                  window.scrollTo(0, 0);
                  await wait(1000); // Đợi DOM ở Top render
                  continue; // Quay lại đầu vòng lặp để monitorCards quét lại DOM và bắt ID
              }
              
              // Kể cả khi đã cuộn lên Top mà vẫn không thấy (lag server), thử gọi API (chỉ gọi được nếu sniffer đã bắt được gói tin mạng)
              if (await tryApiStatusCheck(video)) continue;

              // Timeout cu
              const maxWait = state.settings.runMode === 'image' ? 60000 : 120000;
              if (video._createStartTime && Date.now() - video._createStartTime > maxWait) {
                  video.status = STATUS.ERROR;
                  video.error = `Timeout: Không tìm thấy thẻ nào được tạo ra sau ${Math.round(maxWait/1000)}s`;
                  addLog('error', `[${video.promptIndex}] Lỗi: Google Flow không đẻ ra thẻ nào sau ${Math.round(maxWait/1000)}s!`);
              } else if (Math.random() < 0.1) {
                  addLog('info', `[${video.promptIndex}] ⏳ Đang chờ thẻ video mới xuất hiện trên giao diện...`);
              }
              continue; // Bo qua phan duoi vi chua co the
          }

          // ── RECOVERY FALLBACK (ĐÃ TỪNG CÓ THẺ NHƯNG BỊ CHE KHUẤT VÀ TẢI LẠI TRANG) ──
          // Chỉ gọi khi được load lại từ một session cũ (ví dụ F5 reload trang)
          if (video.sessionStarted !== PAGE_SESSION_ID) {
              const recovered = recoverLostTiles(video);
              if (recovered.length > 0) {
                  currentTiles.push(...recovered);
                  video.sessionStarted = PAGE_SESSION_ID; // Đánh dấu đã phục hồi, không gọi lại nữa
              } else {
                  // Đang tải lại từ session cũ nhưng không tìm thấy thẻ -> Đợi Sweep xử lý
                  continue;
              }
          } else {
              // Là session hiện tại -> Mất thẻ 100% là do ảo hóa DOM. Batch Sweep ở mainLoop sẽ lo liệu.
              continue;
          }
      } else {
          continue;
      }
    }

    // Pass live elements to getGroupStatus
    video.cardElements = currentTiles;
    video.cardElement = currentTiles[0];

    // Aggregate status from each individual tile
    const cardStatus = getGroupStatus(video);

    // Update sub-videos info
    video.subVideos = cardStatus.videos;

    // Check if any video is upscaling
    const hasUpscaling = video.subVideos && video.subVideos.some(v => v.status === 'UPSCALING');

    if (cardStatus.status === 'ERROR' && (!video.subVideos || video.subVideos.every(v => v.status === 'ERROR'))) {
      const timeSinceCreate = Date.now() - (video._createStartTime || 0);
      if (timeSinceCreate > 6000) {
          if (video.status !== STATUS.ERROR) {
            video.status = STATUS.ERROR;
            video.error = cardStatus.error;
            addLog('error', `[${video.promptIndex}] Error: ${cardStatus.error}`);
          }
      } else {
          video.status = STATUS.CREATING;
      }
    } else if (cardStatus.status === 'CREATING' || cardStatus.status === 'QUEUED' || hasUpscaling) {
      video.status = STATUS.CREATING;

      // Update progress if changed
      // We use average progress from all videos
      if (cardStatus.progress > (video._maxProgress || -1)) {
          video._maxProgress = cardStatus.progress;
          video._lastProgressTime = Date.now();
          video._isStuck = false; // Reset stuck flag
        }
        video._lastProgress = cardStatus.progress;
        // FIX BUG 4: Progress Floor — progress chỉ được tăng, KHÔNG BAO GIỜ được giảm.
        // Ngăn chặn trường hợp quét nhầm card khác hoặc DOM stale trả về progress thấp hơn.
        const newProgress = Math.round(cardStatus.progress);
        if (cardStatus.status === 'QUEUED' && (video.progress || 0) > 50) {
            // Có khả năng nhận nhầm grid — KHÔNG áp dụng Progress Floor
            addLog('warning', `[${video.promptIndex}] ⚠️ Phát hiện progress giảm đột ngột (${video.progress}% → ${newProgress}%). Có thể nhận nhầm grid.`);
            // Giữ nguyên progress cũ, KHÔNG ghi đè
        } else {
            video.progress = Math.max(video.progress || 0, newProgress);
        }
        
        // Stuck Detection: AI Video generation can easily stay at the same % for 30-60 seconds.
        if (state.settings.runMode !== 'image' && !hasUpscaling && cardStatus.status !== 'QUEUED') {
            const timeStuck = Date.now() - (video._lastProgressTime || Date.now());
            
            // CƠ CHẾ CHỐNG STUCK: Báo cho Batch Sweep cuộn trang tới video này để "đánh thức" nó!
            if (timeStuck > 60000) {
                video._isStuck = true; 
            }
            
            // Timeout cứng nếu treo quá lâu (đã tăng lên 180s để chừa thời gian cho Sweep đánh thức)
            if (timeStuck > 180000) {
                video.status = STATUS.ERROR;
                video.error = `Stuck (${video.progress}%) > 180s`;
                addLog('error', `[${video.promptIndex}] Stuck at ${video.progress}% for 180s. Marked as Error.`);
            }
        }

      // Total Timeout: If creating takes > 5 phút (300s) for video, 2 phút (120s) for image
      // Extend timeout if upscaling (3 mins per video is enough)
      const timeoutLimit = state.settings.runMode === 'image' ? 120000 : (hasUpscaling ? 180000 : 300000);
      if (video._createStartTime && cardStatus.status !== 'QUEUED' && (Date.now() - video._createStartTime > timeoutLimit)) {
        video.status = STATUS.ERROR;
        video.error = hasUpscaling ? 'Upscale Timeout (> 3m)' : (state.settings.runMode === 'image' ? 'Timeout (> 2m)' : 'Timeout (> 5m)');
        addLog('error', `[${video.promptIndex}] Creation timed out.`);
      }

      // ABSOLUTE TIMEOUT: Bất kể trạng thái gì, nếu quá 6 phút → FAIL
      const ABSOLUTE_TIMEOUT = 360000; // 6 phút
      if (video._createStartTime && (Date.now() - video._createStartTime > ABSOLUTE_TIMEOUT)) {
          video.status = STATUS.ERROR;
          video.error = 'Absolute Timeout (> 6m)';
          addLog('error', `[${video.promptIndex}] ❌ Absolute timeout 6 phút. Buộc đánh lỗi.`);
      }

      // Nếu đang QUEUED và CHƯA BẮT ĐẦU CHẠY (progress = 0), update thời gian bắt đầu để reset đồng hồ timeout
      // Tuyệt đối KHÔNG reset nếu đang chạy dở (progress > 0) để tránh bị reset hẹn giờ oan!
      if (cardStatus.status === 'QUEUED' && (video.progress || 0) === 0) {
          video._createStartTime = Date.now();
          video._lastProgressTime = Date.now();
      }

    } else if (cardStatus.status === 'COMPLETED') {
      const completedCount = (cardStatus.videos || []).filter(v => v.status === 'COMPLETED').length;
      const prevTotal = video.totalVideos || 0;
      video.totalVideos = completedCount;

      if (video.totalVideos !== prevTotal) {
        addLog('info', `[${video.promptIndex}] Videos ready: ${video.totalVideos}`);
      }

      if (video.status !== STATUS.COMPLETED) {
        video.status = STATUS.COMPLETED;
        video.progress = 100;
        
        // ── BẮT WORKFLOW ID (ƯU TIÊN: SNIFFER, FALLBACK: DOM) ──
        video.workflowIds = [];
        
        // Cực kỳ quan trọng: CHỈ LƯU NHỮNG CARD DONE! BỎ QUA CARD FAIL!
        const successfulTiles = currentTiles ? currentTiles.filter(t => !getCardStatus(t).isFailed) : [];
        video.cardElements = successfulTiles;
        video.totalVideos = successfulTiles.length;
        
        // 1. ƯU TIÊN: Bắt từ Network Sniffer (IDs mới từ sau khi paste)
        if (window.veoSniffedMediaIds && window.veoSniffedMediaIds.length > 0) {
            const startIdx = (typeof video._sniffStartIndex === 'number') ? video._sniffStartIndex : 0;
            const newSniffed = window.veoSniffedMediaIds.slice(startIdx);
            if (newSniffed.length > 0) {
                const count = Math.max(successfulTiles.length, 1);
                video.workflowIds = newSniffed.slice(0, count);
                addLog('info', `[${video.promptIndex}] 🆔 Sniffer bắt ${video.workflowIds.length}/${count} ID: ${video.workflowIds.map(id=>id.substring(0,8)).join(', ')} (pool=${newSniffed.length})`);
            }
        }
        
        // 2. FALLBACK: Quét DOM tìm a[href*="/edit/"] hoặc ancestor
        if ((!video.workflowIds || video.workflowIds.length === 0) && successfulTiles.length > 0) {
            let ids = [];
            for (let retry = 0; retry < 10; retry++) {
                ids = [];
                for (let tile of successfulTiles) {
                    // Check child link
                    let aTag = tile.querySelector('a[href*="/edit/"]');
                    if (!aTag) aTag = tile.closest('a[href*="/edit/"]');
                    if (aTag) {
                        const m = aTag.href.match(/\/edit\/(?:workflow\/)?([a-z0-9\-]{36})/i);
                        if (m) { ids.push(m[1]); continue; }
                    }
                    // Check data-media-id
                    const mediaEl = tile.querySelector('[data-media-id]') || (tile.getAttribute('data-media-id') ? tile : null);
                    if (mediaEl) { ids.push(mediaEl.getAttribute('data-media-id')); continue; }
                    // Check data-tile-id (non-fe_id format)
                    const dtid = tile.getAttribute('data-tile-id');
                    if (dtid && !dtid.startsWith('fe_id_')) { ids.push(dtid); continue; }
                }
                if (ids.length === successfulTiles.length) break;
                await wait(200);
            }
            if (ids.length > 0) {
                video.workflowIds = ids;
                addLog('info', `[${video.promptIndex}] 🆔 DOM bắt ${ids.length} ID: ${ids.map(id=>id.substring(0,8)).join(', ')}`);
            }
        }
        
        // 3. FALLBACK CUỐI: Lấy từ pool sniffed gần nhất
        if ((!video.workflowIds || video.workflowIds.length === 0) && window.veoSniffedMediaIds && window.veoSniffedMediaIds.length > 0) {
            const count = Math.max(successfulTiles.length, 1);
            video.workflowIds = window.veoSniffedMediaIds.slice(-count);
            addLog('info', `[${video.promptIndex}] 🆔 Pool cuối: ${video.workflowIds.map(id=>id.substring(0,8)).join(', ')}`);
        }
        
        addLog('success', `[${video.promptIndex}] Completed! (${video.totalVideos} ${video.mediaType || 'media'}, captured ${video.workflowIds.length} IDs)`);
        saveProject();
      }
    }
  }

  // Removed checkAutoShutdown() from here. mainLoop is the only source of truth for completion.
  
  updateUI();
  } finally {
      clearTimeout(_monitorTimeout);
      _isMonitoring = false;
  }
}

// ==================== AUTO STOP & SHUTDOWN ====================
async function checkAutoShutdown() {
  // Hàm này giờ chỉ chịu trách nhiệm tắt máy tính (PC) khi được mainLoop gọi
  if (!state.settings.autoShutdown) {
    addLog('info', '✅ Automation hoàn tất. Auto-shutdown: TẮT');
    return;
  }

  // Prevent multiple shutdown triggers
  if (state._shutdownTriggered) return;

  // (1.7.0) ĐA TAB: tab nào xong trước cũng KHÔNG được tắt máy khi tab khác còn
  // đang chạy — nếu không sẽ giết luôn phần việc của các tab kia. Chờ tới khi
  // background xác nhận mọi tab đã xong (kiểm tra lại mỗi 30s, tối đa 6 giờ).
  if (isMultiTab()) {
    const DEADLINE = Date.now() + 6 * 60 * 60 * 1000;
    let announced = false;
    for (;;) {
      const res = await bg('CAN_SHUTDOWN');
      if (!res || res.ok) break;
      if (!announced) {
        announced = true;
        const names = (res.waiting || []).map(t => `tab ${t.slot || t.tabId} (${t.done}/${t.total})`).join(', ');
        addLog('info', `⏸️ Tab này đã xong nhưng CHƯA tắt máy vì còn: ${names}. Sẽ chờ cho tới khi tất cả xong.`);
      }
      if (Date.now() > DEADLINE) {
        addLog('warning', '⚠️ Chờ các tab khác quá 6 giờ — bỏ qua lệnh tắt máy cho an toàn.');
        return;
      }
      await wait(30000);
    }
    if (announced) addLog('success', '✅ Tất cả các tab đã hoàn tất. Tiếp tục quy trình tắt máy.');
    if (state._shutdownTriggered) return;   // tab khác đã kích hoạt trong lúc chờ
  }

  state._shutdownTriggered = true;

  if (state.settings.downloadZip) {
      addLog('info', '⏳ Chờ thông báo nén ZIP xuất hiện và biến mất...');
      
      let toastFound = false;
      let trackedToastText = '';
      
      // Chờ toast xuất hiện (tối đa 15s)
      for (let i = 0; i < 15; i++) {
          // Các toast thông báo thường có role=alert, role=status, aria-live=polite hoặc aria-live=assertive, hoặc data-sonner-toast
          const toastSelector = '[role="alert"], [role="status"], [aria-live="polite"], [aria-live="assertive"], [class*="toast"], [class*="snackbar"], [data-sonner-toast]';
          const toasts = Array.from(document.querySelectorAll(toastSelector));
          for (const toast of toasts) {
              const text = toast.textContent.toLowerCase().trim();
              if (text.length > 5 && text.length < 150) {
                  // Chỉ cần chứa 1 vài từ khóa báo hiệu đang xử lý
                  if (text.includes('đang') || text.includes('chuẩn bị') || text.includes('nén') || text.includes('download') || text.includes('prepar') || text.includes('zip') || text.includes('mục xuống')) {
                      toastFound = true;
                      trackedToastText = text; // Lưu lại chính xác text của toast để theo dõi
                      break;
                  }
              }
          }
          if (toastFound) break;
          await wait(1000);
      }
      
      if (toastFound) {
          addLog('info', `🔄 Đã bắt được tiến trình: "${trackedToastText.substring(0, 50)}...". Đang chờ hoàn tất...`);
          let waitCycles = 0;
          const toastSelector = '[role="alert"], [role="status"], [aria-live="polite"], [aria-live="assertive"], [class*="toast"], [class*="snackbar"], [data-sonner-toast]';
          
          while (waitCycles < 600) { // Tối đa chờ 20 phút (600 * 2s)
              // Kiểm tra xem đoạn text đó còn xuất hiện trên màn hình không
              const isStillVisible = Array.from(document.querySelectorAll(toastSelector))
                  .some(el => el.textContent.toLowerCase().trim() === trackedToastText);
              
              if (!isStillVisible) {
                  // Wait 2s and double check to prevent false positives from flickering
                  await wait(2000);
                  const doubleCheck = Array.from(document.querySelectorAll(toastSelector))
                      .some(el => el.textContent.toLowerCase().trim() === trackedToastText);
                  if (!doubleCheck) break; // Thực sự đã mất toast -> tải xong
              }
              await wait(2000);
              waitCycles++;
          }
          if (waitCycles >= 600) {
              addLog('error', '⏳ Hết thời gian chờ 20 phút tải ZIP, có thể bị lỗi, tự động bỏ qua.');
          } else {
              addLog('success', '✅ Quá trình nén ZIP trên server đã hoàn tất!');
          }
      } else {
          // Tính toán thời gian chờ dự phòng dựa trên số lượng prompt
          const promptCount = (state.prompts && state.prompts.length > 0) ? state.prompts.length : 50;
          let backupWaitMinutes = Math.ceil(promptCount / 50);
          
          // Video nặng hơn ảnh rất nhiều nên nếu là mode Video -> x2 thời gian chờ nén
          const isVideoMode = state.settings.runMode === 'video';
          if (isVideoMode) {
              backupWaitMinutes *= 2;
          }
          
          const backupWaitMs = backupWaitMinutes * 60000;
          const modeName = isVideoMode ? "Video" : "Ảnh";
          
          addLog('warning', `⚠️ Không tìm thấy thông báo tải ZIP. Bật đếm giờ dự phòng: Chờ ${backupWaitMinutes} phút (${promptCount} prompts - Mode ${modeName})...`);
          await wait(backupWaitMs); 
      }
      await wait(8000); // Thêm 8s buffer cho trình duyệt xử lý lưu file vật lý vào máy
  }

  let delay = 60; // Trả lại 60s cơ bản để user có đủ thời gian thấy bảng đếm ngược và hủy nếu muốn

  addLog('warning', `💤 Auto-shutdown đã bật - Máy sẽ tắt sau ${delay} giây...`);
  addLog('info', '⚠️ Chạy "shutdown /a" trong CMD để hủy');

  // Show cancel button
  chrome.runtime.sendMessage({
    action: 'SHUTDOWN_TRIGGERED'
  }).catch(() => { });

  chrome.runtime.sendMessage({
    action: 'TRIGGER_SHUTDOWN',
    data: { delay: delay }
  }).catch(() => { });
}


// ==================== WATCHDOG (ĐÃ BỎ) ====================
// FIX (1.6.0): checkWatchdog() cũ là code chết và SAI:
//  - không hề được đăng ký ở init() nên chưa bao giờ chạy;
//  - so sánh v.cardElement === card trong khi cardElement luôn bị xoá lúc lưu;
//  - đọc status.hasError / status.totalVideos — hai thuộc tính getCardStatus()
//    KHÔNG trả về, nên nếu có chạy thì sẽ đánh sai trạng thái toàn bộ thẻ.
// Chống treo giờ do monitorCards (timeout theo thẻ) + BATCH SWEEP ở mainLoop lo.

// ==================== ELEMENT FINDERS ====================

function findFlowSearchBoxNative() {
    // Tìm các thẻ input loại text hoặc search
    const inputs = Array.from(document.querySelectorAll('input[type="text"], input[type="search"]'));
    for (const input of inputs) {
        if (!input.offsetParent) continue; // Bỏ qua input đang bị ẩn!
        
        // Cách 1: Kiểm tra placeholder/aria-label
        const p = (input.placeholder || '').toLowerCase();
        const a = (input.getAttribute('aria-label') || '').toLowerCase();
        if (p.includes('search') || a.includes('search') || p.includes('tìm kiếm') || a.includes('tìm kiếm')) {
            return input;
        }

        // Cách 2: (Cho Flow 2025) Kiểm tra xem thẻ form/div chứa nó có cái icon kính lúp "search" hay "arrow_back" không
        const wrapper = input.closest('form') || input.parentElement;
        if (wrapper) {
            const icons = wrapper.querySelectorAll('i, .google-symbols');
            for (const icon of icons) {
                const txt = icon.textContent.trim().toLowerCase();
                if (txt === 'search' || txt === 'arrow_back') {
                    // addLog('info', `[Search Box] Tìm thấy ô Tìm kiếm qua Icon '${txt}'.`); // Không comment quá nhiều
                    return input;
                }
            }
        }
    }
    
    // Fallback: Tìm thẻ input text cuối cùng trên màn hình.
    // Vì ô báo "Tên project" thường xuất hiện đầu tiên (Bên trái), ô Search xuất hiện ở giữa/cuối.
    const visibleInputs = inputs.filter(i => i.offsetParent);
    if (visibleInputs.length > 0) {
        const fallback = visibleInputs[visibleInputs.length - 1];
        addLog('warning', `[Search Box] Đã dùng Fallback tìm ô input text cuỐI CÙNG.`);
        return fallback;
    }
    return null;
}

function getIdFromNgCtx(el) {
  if (!el) return null;
  const projectId2 = ((window.location.href.match(/project\/([a-z0-9\-]+)/i)||[])[1]||'').toLowerCase();
  const uuidRe = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const checkStr = (s) => {
      if (typeof s !== 'string') return null;
      if (uuidRe.test(s) && s.toLowerCase() !== projectId2) return s.toLowerCase();
      const m2 = s.match(/\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i);
      if (m2 && m2[1].toLowerCase() !== projectId2) return m2[1].toLowerCase();
      return null;
  };
  let cur = el;
  for (let depth = 0; depth < 4 && cur; depth++, cur = cur.parentElement) {
      try {
          const lv = cur.__ngContext__;
          if (!lv || !Array.isArray(lv)) continue;
          const comp = lv[8];
          if (!comp || typeof comp !== 'object') continue;
          const candidates2 = [
              comp.workflowId, comp.id, comp.mediaId,
              comp.workflow?.id, comp.workflow?.workflowId, comp.workflow?.name,
              comp.media?.id, comp.media?.name,
              comp.item?.id, comp.card?.id,
              comp.name, comp.resourceName,
          ];
          for (const v of candidates2) {
              const r = checkStr(v);
              if (r) return r;
          }
      } catch(e) {}
  }
  return null;
}

// Returns the OUTERMOST [data-tile-id] elements — one per video slot.
// Covers ALL card states:
//  - Completed: <a href="/edit/..."> wraps a <video>
//  - Error:     <div class="sc-25d34a31-0"> with 'Không thành công'
//  - Generating: <div> with % text
// We identify the outer tile by checking its parent has no [data-tile-id] ancestor.
function extractTileId(tile) {
  if (!tile) return null;
  if (tile.getAttribute('data-tile-id')) return tile.getAttribute('data-tile-id');
  if (tile.getAttribute('data-media-id')) return tile.getAttribute('data-media-id');
  const a = tile.matches('a[href*="/edit/"]') ? tile : tile.querySelector('a[href*="/edit/"]');
  if (a && a.getAttribute('href')) {
    const m = a.getAttribute('href').match(/\/edit\/(?:workflow\/)?([a-z0-9\-]{36})/i);
    if (m) return m[1];
  }
  const img = tile.querySelector('img[data-media-id]');
  if (img && img.getAttribute('data-media-id')) return img.getAttribute('data-media-id');
  return null;
}

function getOuterTilesNative() {
  // 1. New Google Flow UI (Angular custom elements)
  const containers = Array.from(document.querySelectorAll('flow-tile-container'));
  if (containers.length > 0) {
    return containers.filter(el => el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0);
  }
  
  const tiles = Array.from(document.querySelectorAll('flow-image-tile, flow-video-tile'));
  if (tiles.length > 0) {
    return tiles.filter(el => el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0);
  }

  // 2. Legacy Flow UI with data-tile-id
  const legacy = Array.from(document.querySelectorAll('[data-tile-id]'))
    .filter(el => !el.parentElement?.closest('[data-tile-id]'));
  if (legacy.length > 0) return legacy;

  // 3. Fallback to links with edit workflow
  return Array.from(document.querySelectorAll('a[href*="/edit/workflow/"]'))
    .map(a => a.closest('div[class*="tile"], div[class*="card"], [class*="container"]') || a)
    .filter(el => el.offsetParent !== null || el.offsetWidth > 0);
}

// Same as getOuterTiles but scoped to a specific container element.
function getOuterTilesWithin(container) {
  if (!container) return [];
  const containers = Array.from(container.querySelectorAll('flow-tile-container'));
  if (containers.length > 0) return containers;
  
  const tiles = Array.from(container.querySelectorAll('flow-image-tile, flow-video-tile'));
  if (tiles.length > 0) return tiles;

  return Array.from(container.querySelectorAll('[data-tile-id]'))
    .filter(el => !el.parentElement?.closest('[data-tile-id]'));
}

// ── NEW: Tile ID string helpers ──────────────────────────────────────────────
// Returns deduplicated list of all tile ID strings currently in the DOM.
function getAllTileIds() {
  const seen = new Set();
  const result = [];
  const tiles = getOuterTiles();
  for (const el of tiles) {
    const id = extractTileId(el);
    if (id && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

// Query the CURRENT DOM element for a tile ID (always returns outermost wrapper,
// regardless of whether Flow has replaced div→a for that tile).
function getTileById(id) {
  if (!id) return null;
  let el = document.querySelector(`[data-tile-id="${id}"]`);
  if (el) return el;
  el = document.querySelector(`[data-media-id="${id}"]`);
  if (el) return el.closest('flow-tile-container') || el;
  el = document.querySelector(`a[href*="${id}"]`);
  if (el) return el.closest('flow-tile-container') || el;
  return null;
}

// ── GROUP CONTAINER: the div that wraps ALL tiles + prompt text for ONE Create click ──
// DOM structure (from observed HTML):
//   GROUP-OUTER div (sc-5c6add13-1)
//     GROUP-INNER div (sc-5c6add13-2)   ← we track THIS
//       TILES-CONTAINER div (sc-5c6add13-4)
//         slot div (height:154px)
//           [data-tile-id] outer tile
//       ...prompt text section...
//
// We walk UP from an outer tile 4 levels to reach GROUP-INNER.
// If the count is wrong due to DOM changes we try levels 3-6 and pick the one
// that contains ONLY the expected number of tiles (x2 or x4).
function getGroupContainer(outerTile) {
  if (!outerTile) return null;
  let el = outerTile;
  for (let i = 0; i < 8; i++) {
    el = el.parentElement;
    if (!el || el === document.body) return null;
    if (el.closest('[data-tile-id]')) continue; // skip if we're inside a tile

    // CRITICAL: count OUTER tiles only (not nested inside [data-tile-id]).
    // Completed tiles have outer+inner both with data-tile-id.
    // Using total count would find the slot-wrapper (1 completed tile = 2 data-tile-id)
    // which incorrectly satisfies >=2. We need >= 2 OUTER tiles.
    const outerCount = getOuterTilesWithin(el).length;

    if (outerCount >= 2) {
      const parentEl = el.parentElement;
      if (!parentEl) return el;
      const parentOuterCount = getOuterTilesWithin(parentEl).length;
      // Group container: parent has MORE outer tiles than us (parent = grid level)
      if (parentOuterCount > outerCount) return el;
    }
  }
  return null;
}

// Get all current generation group containers on the page
function getAllGroupContainers() {
  const outerTiles = getOuterTiles();
  if (!outerTiles.length) return [];
  const groups = new Set();
  for (const tile of outerTiles) {
    const g = getGroupContainer(tile);
    if (g) groups.add(g);
  }
  return Array.from(groups);
}
// ────────────────────────────────────────────────────────────────────────────

// Helper to handle legacy (string) and new (object) selector formats and safely validate CSS syntax
function resolveSelector(key) {
  if (!state.settings.selectors) return null;
  const val = state.settings.selectors[key];
  if (!val) return null;
  
  let selectorString = null;
  if (typeof val === 'string') selectorString = val;
  else if (typeof val === 'object' && val.selector) selectorString = val.selector;
  
  if (!selectorString || selectorString.trim() === '') return null;
  
  // Validate that the custom selector does not crash the DOM parser!
  try {
    document.createDocumentFragment().querySelectorAll(selectorString);
    return selectorString;
  } catch (err) {
    addLog('warning', `Custom selector is invalid CSS syntax: [${key}] = "${selectorString}". Falling back to native UI scan.`);
    return null;
  }
}

function findNewCardByPrompt(promptText, ignoreExistingCards = false, reverseOrder = false, allClaimedIds = null) {
  const fullPromptClean = (promptText || '').replace(/\s+/g, ' ').trim().toLowerCase();
  // Đoạn mồi 60 ký tự: khớp được cả prompt siêu dài / nhiều dòng đã bị Flow rút gọn.
  const cleanPromptSnippet = fullPromptClean.substring(0, 60);

  function getCardText(card) {
    let t = (card.innerText || card.textContent || '').replace(/\s+/g, ' ').toLowerCase();
    // Thêm các thuộc tính ẩn có thể chứa full prompt
    const els = card.querySelectorAll('[alt], [title], [aria-label]');
    for (const el of els) {
        t += ' ' + (el.getAttribute('alt') || '');
        t += ' ' + (el.getAttribute('title') || '');
        t += ' ' + (el.getAttribute('aria-label') || '');
    }
    return t.replace(/\s+/g, ' ').toLowerCase();
  }

  function isCardClaimed(card) {
      if (!allClaimedIds) return false;
      const tile = card.closest('[data-tile-id]');
      if (!tile) return false;
      return allClaimedIds.has(tile.getAttribute('data-tile-id'));
  }

  function findInList(nodeList) {
    let list = Array.from(nodeList);
    if (reverseOrder) list.reverse(); // Tìm từ dưới lên trên (cũ nhất trước)

    // Pass 1: Tìm khớp chính xác TOÀN BỘ prompt (Full match)
    for (const card of list) {
      if (!ignoreExistingCards && state._existingCards && state._existingCards.has(card)) continue;
      if (!card.offsetParent) continue;
      if (isCardClaimed(card)) continue;
      const text = getCardText(card);
      if (text.includes(fullPromptClean)) return card;
    }

    // Pass 2: Fallback tìm theo 150 ký tự đầu (Prefix match)
    for (const card of list) {
      if (!ignoreExistingCards && state._existingCards && state._existingCards.has(card)) continue;
      if (!card.offsetParent) continue;
      if (isCardClaimed(card)) continue;
      const text = getCardText(card);
      if (text.includes(cleanPromptSnippet)) return card;
    }
    return null;
  }

  // Strategy 1: Find <a> cards that contain the prompt text
  let found = findInList(document.querySelectorAll('a[href]'));
  if (found) return found;

  // Strategy 2: Old role="article"
  found = findInList(document.querySelectorAll('[role="article"]'));
  if (found) return found;

  // Strategy 3: Any visible block containing prompt text + video/progress indicators
  const allDivs = Array.from(document.querySelectorAll('div[class]'));
  if (reverseOrder) allDivs.reverse();

  for (const div of allDivs) {
    if (!ignoreExistingCards && state._existingCards && state._existingCards.has(div)) continue;
    if (div.isContentEditable || div.getAttribute('data-slate-editor')) continue;
    
    const text = getCardText(div);
    if (!text.includes(cleanPromptSnippet)) continue;
    
    const hasMedia = div.querySelector('video, img');
    // ── 2. Check for Generating State (Percentage) ──
    let percentValues = [];

    // NEW UI Priority: Directly check .loading-percentage elements (Angular Flow 2025)
    const loadingPercentEls = div.querySelectorAll('.loading-percentage');
    for (const el of loadingPercentEls) {
      const t = el.textContent.trim();
      const m = t.match(/(\d{1,3})\s*%/);
      if (m) {
        const val = parseInt(m[1]);
        if (val >= 0 && val <= 100) percentValues.push(val);
      }
    }

    // Also check for flow-pending-tile presence (still generating even if no % shown yet)
    const hasPendingTile = div.querySelector('flow-pending-tile') !== null;

    // OLD UI / Fallback: Scan all leaf text nodes for percentage patterns
    if (percentValues.length === 0 && !hasPendingTile) {
      const allTextEls = div.querySelectorAll('*');
      for (const el of allTextEls) {
        if (el.children.length > 0) continue;
        const t = el.textContent.trim();
        const m = t.match(/(\d{1,3})\s*%/);
        if (m) percentValues.push(parseInt(m[1]));
      }
    }

    const hasPercent = percentValues.length > 0;
    if (hasMedia || hasPercent || hasPendingTile) {
      const rect = div.getBoundingClientRect();
      if (rect.width > 100 && rect.height > 100) return div;
    }
  }

  return null;
}

// Helper to paste text into a Slate.js contenteditable editor.
// Method: Synthetic ClipboardEvent (Ctrl+V paste simulation) - the only way
// that properly updates Slate's internal React state.
async function setNativeValue(element, value) {
  const tag = element.tagName.toLowerCase();
  const isNativeInput = (tag === 'textarea' || tag === 'input');
  const isContentEditable = element.isContentEditable;

  if (isNativeInput) {
    try {
      const proto = tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (nativeSetter) {
        nativeSetter.call(element, value);
      } else {
        element.value = value;
      }
    } catch (e) {
      element.value = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;

  } else if (isContentEditable) {
    // ==================== SLATE.JS: Main World Injection approach ====================
    // PROBLEM: execCommand from a content script (isolated world) fires beforeinput
    // events with isTrusted=false. Slate checks isTrusted and ignores them.
    //
    // SOLUTION: Route through background.js which uses chrome.scripting.executeScript
    // with world:'MAIN'. Code running in MAIN world fires TRUSTED events that Slate accepts.

    addLog('info', '[Slate] Injecting paste via MAIN world (background.js)...');

    element.scrollIntoView({ block: 'center' });
    await wait(200);

    // Send to background which calls chrome.scripting.executeScript({world:'MAIN'})
    const result = await chrome.runtime.sendMessage({
      action: 'INJECT_PASTE',
      data: { text: value, tabId: null } // background uses sender.tab.id automatically
    });

    await wait(600);

    if (!result || !result.ok) {
      addLog('error', `[Slate] INJECT_PASTE failed: ${result?.error || 'unknown'}`);
      return false;
    }

    addLog('info', `[Slate] Paste result: ok=${result.ok}, hasZeroWidth=${result.hasZeroWidth}`);

    if (result.hasZeroWidth) {
      addLog('warning', '[Slate] zero-width still present — Slate may not have updated state, but continuing...');
    } else {
      addLog('info', '[Slate] ✅ Slate accepted text (zero-width gone)');
    }

    return !result.hasZeroWidth; // true = success

  } else {
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
}

// ── Helper: read expected video count from Flow UI 'Video x2/x4' button ──
// This caps card discovery so we don't claim cards from adjacent prompts.
function getExpectedVideoCount() {
  // Mặc định: chế độ video sinh 1 cái, chế độ image sinh 4 cái
  const defaultCount = state.settings.runMode === 'video' ? 1 : 4;
  
  // The button text looks like: "Video ▶ crop_16_9 x2" or "x4"
  const allBtns = document.querySelectorAll('button');
  for (const btn of allBtns) {
    if (btn.closest('[role="article"]')) continue;
    const txt = btn.textContent || '';
    const match = txt.match(/x(\d+)/);
    if (match && btn.querySelector('i')?.textContent?.includes('crop')) {
      return parseInt(match[1]) || defaultCount;
    }
  }
  return defaultCount;
}


// ==================== API STATUS CHECK (v1.5.3) ====================
// Gọi batchexecute RPC `jwpduf` (same-origin) để kiểm tra trạng thái workflow
// khi thẻ bị Virtual Scroll ẩn khỏi DOM.
// Pattern giống rename API (mYWVGd) — cùng endpoint, cùng cách gọi.
// Response: data[1] === null → CREATING, data[1] !== null → COMPLETED
async function checkWorkflowStatusViaAPI(_workflowId) {
  // Local-safe fork: completion is detected from the rendered Flow DOM only.
  return null;
}

// Xác định phần tử có đang bị ẩn thật hay không.
// FIX (1.6.0): bản cũ dùng `offsetParent === null` để kết luận "bị ẩn". Nhưng
// MỌI phần tử position:fixed đều có offsetParent = null, nên chữ "Hàng đợi" /
// "Không thành công" nằm trong overlay fixed của Flow bị bỏ qua => bot đọc sai
// trạng thái thẻ (tưởng đang tạo trong khi thực tế đã lỗi hoặc đang chờ).
function isNodeHidden(el) {
  try {
    const st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return true;
    if (st.position === 'fixed') return false;
    const r = el.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) return false;
    return el.offsetParent === null && el.offsetWidth === 0 && el.offsetHeight === 0;
  } catch (e) {
    return false;
  }
}

function getCardStatus(card) {
  if (card.hasAttribute('data-veo-ignored')) {
      return { status: 'COMPLETED', progress: 100, videos: [], error: null };
  }

  // ── 0. Thẻ LỖI / ĐANG CHỜ phải được xét TRƯỚC thẻ hoàn tất ──
  // FIX (1.6.0): bản cũ xét "hoàn tất" đầu tiên và tính cả số nút ⋮ làm số media
  // (`completedCount = downloadBtns.length`). Thẻ đang render/pending cũng có nút
  // ⋮ nên bị báo COMPLETED quá sớm => bot nhảy sang bước tải khi video chưa
  // xong, dẫn tới "tải thiếu file" và retry vô ích.
  if (card.querySelector('flow-error-tile') || card.tagName.toLowerCase() === 'flow-error-tile' || card.querySelector('.error-tile')) {
    return { status: 'ERROR', error: 'Tạo thất bại (flow-error-tile)', progress: 0, videos: [], isFailed: true };
  }

  // ── 1. Check for Completed State (Videos or Images) ──
  const videoEls = card.querySelectorAll('video');
  // Chỉ những media THỰC SỰ có nguồn mới được tính là hoàn tất.
  const realVideos = Array.from(videoEls).filter(v => {
    const src = v.getAttribute('src') || v.currentSrc || (v.querySelector('source')?.getAttribute('src') || '');
    return !!src;
  });
  const editLinks = card.querySelectorAll('a[href*="/edit/"]');
  let completedCount = realVideos.length > 0 ? realVideos.length : (videoEls.length > 0 ? videoEls.length : 0);

  // Image check: Flow 2025 Image tiles become clickable links without video tags.
  if (completedCount === 0) {
    const isLink = card.tagName.toLowerCase() === 'a' || editLinks.length > 0;
    const imgEls = Array.from(card.querySelectorAll('img')).filter(img => {
      const src = img.getAttribute('src') || img.src || '';
      return src && !src.startsWith('data:image/gif');
    });
    if (isLink && imgEls.length > 0) {
       completedCount = 1;
    }
  }

  // NEW UI Image check: Angular tiles may have <img> without being links.
  // Instead of relying on hasPendingTile (which might remain hidden in DOM and cause 96% stuck),
  // we strictly check if the img tag has a real generated image URL from Google Flow.
  if (completedCount === 0) {
    const imgEls = Array.from(card.querySelectorAll('img')).filter(img => {
        const src = img.getAttribute('src') || img.src || '';
        return src.includes('flow-content.google/image') || src.includes('googleusercontent.com');
    });
    if (imgEls.length > 0) {
       completedCount = 1;
    }
  }

  if (completedCount > 0) {
    // Nếu vẫn còn thẻ pending bên trong thì chưa xong hẳn (x2/x4 render lệch nhịp).
    const stillPending = card.querySelector('flow-pending-tile');
    if (!stillPending) {
      return {
        status: 'COMPLETED',
        progress: 100,
        // FIX: Array().fill(obj) dùng CHUNG một object -> sửa 1 phần tử là sửa hết.
        videos: Array.from({ length: completedCount }, (_, i) => ({ id: i, status: 'COMPLETED', progress: 100 })),
        error: null
      };
    }
  }

  // FIX BUG 1: Detect mat-icon warning — Google Flow shows this icon on failed generations
  const warningIcon = card.querySelector('mat-icon.error-icon');
  if (warningIcon && (warningIcon.textContent || '').trim().toLowerCase() === 'warning') {
    return { status: 'ERROR', error: 'Generation Failed (warning icon)', progress: 0, videos: [], isFailed: true };
  }

  // ── 2. Check for Generating State (Percentage) ──
  let percentValues = [];

  // STRATEGY (New UI & Ultimate Fallback):
  // Since the prompt text is safely OUTSIDE the card (in the grid header), 
  // ANY percentage text found inside the card's textContent MUST be the progress indicator.
  // This safely pierces normal elements even if they have children (like SVG icons next to the text).
  const cardText = card.textContent || '';
  const percentMatches = cardText.match(/(\d{1,3})\s*%/g);
  if (percentMatches) {
    for (const m of percentMatches) {
      const val = parseInt(m);
      if (val >= 0 && val <= 100) percentValues.push(val);
    }
  }

  // Backup Strategy just in case they use shadow DOM that is closed, 
  // though typically Flow's percent text is slotted or light DOM.
  if (percentValues.length === 0) {
    const loadingPercentEls = card.querySelectorAll('.loading-percentage, [data-progress]');
    for (const lpEl of loadingPercentEls) {
      const t = lpEl.textContent.trim() || lpEl.getAttribute('data-progress') || '';
      const m = t.match(/(\d{1,3})\s*%/);
      if (m) {
        const val = parseInt(m[1]);
        if (val >= 0 && val <= 100) percentValues.push(val);
      }
    }
  }
  
  percentValues = [...new Set(percentValues)];

  if (percentValues.length > 0) {
    const avg = percentValues.reduce((a, b) => a + b, 0) / percentValues.length;
    const isUpscaling = cardText.toLowerCase().includes('upscaling');
    if (isUpscaling) {
      return { status: 'UPSCALING', progress: 99, videos: [{ id: 0, status: 'UPSCALING', progress: 99 }], error: null };
    }
    return { 
      status: 'CREATING', 
      progress: avg, 
      videos: percentValues.map((p, i) => ({ id: i, status: 'CREATING', progress: p })),
      error: null 
    };
  }

  // ── 3. Check for Queued State ──
  const isQueued = [card, ...Array.from(card.querySelectorAll('*'))]
    .some(d => {
      if (d.children.length > 0) return false;
      if (d !== card && isNodeHidden(d)) return false;
      const t = d.textContent.trim().toLowerCase();
      return t.includes('hàng đợi') || t.includes('queued') || t.includes('đang chuẩn bị') || t.includes('preparing') || t.includes('in queue');
    });

  if (isQueued) {
    return { status: 'QUEUED', progress: 0, videos: [{ id: 0, status: 'QUEUED', progress: 0 }], error: null };
  }

  // ── 4. Check for Strict Error State (Only if no Progress and no Queued) ──
  // Use exact match to avoid false positives if prompt contains "thử lại" etc.
  const isError = [card, ...Array.from(card.querySelectorAll('*'))].some(d => {
      if (d.children.length > 0) return false;
      if (d !== card && isNodeHidden(d)) return false;
      const t = d.textContent.trim().toLowerCase();
      return t.includes('không thành công') || 
             t.includes('tạo thất bại') || 
             t.includes('generation failed') || 
             t.includes("couldn't generate") || 
             t.includes("can't generate") || 
             t.includes('có lỗi xảy ra') || 
             t.includes('an error occurred');
  });

  if (isError) {
      return { status: 'ERROR', error: 'Không thành công (Policy/Error)', progress: 0, videos: [] };
  }

  // NEW UI: flow-pending-tile is present → card is generating, just hasn't shown % yet
  if (card.tagName.toLowerCase() === 'flow-pending-tile' || card.querySelector('flow-pending-tile')) {
    return { status: 'CREATING', progress: 2, videos: [{ id: 0, status: 'CREATING', progress: 2 }], error: null };
  }

  // Case A: No percentage AND no video AND no error AND no queue → still initializing / waiting
  return { status: 'CREATING', progress: 2, videos: [], error: null };
}

  // 1. Find all video slots in the card

function findPromptTextareaNative() {
  // ==================== HARDCODED FLOW UI SELECTOR (2025) ====================
  // Priority 0: New Google Flow UI (August 2024+) uses ProseMirror instead of Slate
  const prosemirrorEditors = document.querySelectorAll('.ProseMirror[contenteditable="true"]');
  for (const el of prosemirrorEditors) {
    if (el.offsetParent !== null && !el.closest('[role="article"]')) {
      addLog('info', '[ProseMirror] Found new prompt editor');
      return el;
    }
  }

  // KEY INSIGHT: The page has TWO Slate editors:
  //   1. Search box (top) - does NOT have aria-multiline="true"
  //   2. Prompt editor (bottom) - HAS aria-multiline="true" AND zindex="-1"
  // We MUST check for aria-multiline="true" to get the correct one.

  // Priority 1: Most specific - aria-multiline=true (ONLY on prompt editor, not search)
  const multilineEditors = document.querySelectorAll(
    'div[data-slate-editor="true"][role="textbox"][contenteditable="true"][aria-multiline="true"]'
  );
  for (const el of multilineEditors) {
    if (el.offsetParent !== null && !el.closest('[role="article"]')) {
      addLog('info', '[Slate] Found via aria-multiline=true (prompt editor)');
      return el;
    }
  }

  // Priority 2: zindex="-1" is also unique to the prompt editor
  const zIndexEditors = document.querySelectorAll(
    'div[data-slate-editor="true"][contenteditable="true"][zindex="-1"]'
  );
  for (const el of zIndexEditors) {
    if (el.offsetParent !== null && !el.closest('[role="article"]')) {
      addLog('info', '[Slate] Found via zindex=-1 (prompt editor)');
      return el;
    }
  }

  // Priority 3: Placeholder text match - "Bạn muốn tạo gì?" is only on prompt editor
  const placeholders = document.querySelectorAll('[data-slate-placeholder="true"]');
  for (const p of placeholders) {
    const txt = p.textContent || '';
    if (txt.includes('tạo gì') || txt.includes('Bạn muốn') || txt.includes('What would') || txt.includes('create') || txt.includes('Create')) {
      const editor = p.closest('[data-slate-editor="true"]') || p.closest('[contenteditable="true"]');
      if (editor && editor.offsetParent !== null && !editor.closest('[role="article"]')) {
        addLog('info', '[Slate] Found via placeholder text match');
        return editor;
      }
    }
  }

  // Priority 4: Fall back to LAST Slate editor in DOM (search is usually first, prompt is last)
  const allEditors = document.querySelectorAll(
    'div[data-slate-editor="true"][role="textbox"][contenteditable="true"]'
  );
  const editorArr = Array.from(allEditors).filter(
    el => el.offsetParent !== null && !el.closest('[role="article"]')
  );
  if (editorArr.length > 0) {
    // Pick the LAST one - search is first in DOM, prompt editor is last
    const el = editorArr[editorArr.length - 1];
    addLog('info', `[Slate] Found via last-in-DOM fallback (${editorArr.length} candidates)`);
    return el;
  }



  return null;
}

function findCreateButtonNative() {
  // ==================== HARDCODED FLOW UI SELECTOR (2025) ====================
  // Priority 0: New Google Flow UI (August 2024+)
  const newBtn = document.querySelector('button.generate-icon-button');
  if (newBtn && newBtn.offsetParent !== null && !newBtn.closest('[role="article"]')) {
    addLog('info', '[Create] Found new generate button');
    return newBtn;
  }

  // NOTE: There are TWO buttons with span "Tạo":
  //   1. add_2 icon + aria-haspopup="dialog" → "Add media/input" button (WRONG)
  //   2. arrow_forward icon, no aria-haspopup="dialog" → REAL Create video button (CORRECT)
  // Must check icon to distinguish them!

  // Strategy: Find the Slate editor's parent container, then find arrow_forward button inside
  // Must skip editors inside result cards (role="article") — after image generation,
  // those cards may contain their own Slate editors and querySelector() picks them first!
  let editorEl = null;
  const allEds = document.querySelectorAll(
    'div[data-slate-editor="true"][aria-multiline="true"], div[data-slate-editor="true"][zindex="-1"]'
  );
  for (const ed of allEds) {
    if (!ed.closest('[role="article"]') && ed.offsetParent !== null) {
      editorEl = ed;
      break;
    }
  }

  if (editorEl) {
    // Walk up to find the top-level prompt bar container (contains editor + create button)
    let container = editorEl.parentElement;
    for (let i = 0; i < 15; i++) {
      if (!container) break;
      // Find an arrow_forward button inside this container
      const icons = container.querySelectorAll('i.google-symbols, i[class*="google-symbols"], mat-icon, i.material-icons');
      for (const icon of icons) {
        if (icon.textContent.trim() === 'arrow_forward') {
          const btn = icon.closest('button');
          if (btn && btn.offsetParent !== null) {
            addLog('info', '[Create] Found via editor container → arrow_forward icon');
            return btn;
          }
        }
      }
      container = container.parentElement;
    }
  }

  // Priority 2: Global search for arrow_forward button NOT inside a card
  const icons = document.querySelectorAll('i.google-symbols, i[class*="google-symbols"]');
  for (const icon of icons) {
    if (icon.textContent.trim() === 'arrow_forward') {
      const btn = icon.closest('button');
      if (btn && btn.offsetParent !== null && !btn.closest('[role="article"]')) {
        addLog('info', '[Create] Found via arrow_forward icon (global)');
        return btn;
      }
    }
  }

  // Priority 3: "Tạo" span + must have arrow_forward icon (NOT add_2)
  const allButtons = document.querySelectorAll('button');
  for (const btn of allButtons) {
    if (!btn.offsetParent || btn.closest('[role="article"]')) continue;
    // Must have arrow_forward icon — filters out add_2 button
    const icon = btn.querySelector('i.google-symbols, i[class*="google-symbols"]');
    if (!icon || icon.textContent.trim() !== 'arrow_forward') continue;
    const spans = btn.querySelectorAll('span');
    for (const span of spans) {
      const style = span.getAttribute('style') || '';
      const txt = span.textContent.trim();
      if ((txt === 'Tạo' || txt === 'Create') && style.includes('overflow')) {
        addLog('info', `[Create] Found via hidden span + arrow_forward: "${txt}"`);
        return btn;
      }
    }
  }

  return null;
}

// Removed duplicate findDownloadButtonsInCard

// switchToGridView is defined at top of file (with dag9 settings_2 support)

// ==================== SWITCH TO VIDEO MODE ====================
async function switchToVideoMode() {
  // ==================== HARDCODED FLOW UI SELECTOR (2025) ====================
  // From live DOM: buttons inside settings dropdown have aria-controls ending in "-VIDEO"
  // This is called ONCE at startup (not per-prompt), because the mode persists.
  // NOTE: The settings dropdown must be OPEN first - but at startup it's closed.
  // Since the settings menu is a DROPDOWN (not always visible), we rely on applyFlowSettings()
  // to handle the Video mode selection per-prompt instead.
  // This function only tries to find Video tab on the main UI (if it's visible).
  try {
    // Look for Video tab button in the main visible UI (not in dropdown)
    // In some Flow UI versions, mode tabs are always visible on page
    const videoTabBtns = document.querySelectorAll('[role="tab"][aria-controls$="-VIDEO"], [role="tab"][aria-controls*="-VIDEO"]');
    for (const btn of videoTabBtns) {
      // Must not be inside a Radix dropdown (which is hidden at startup)
      const isInDropdown = btn.closest('[data-radix-menu-content], [role="menu"], [data-radix-popper-content-wrapper]');
      if (!isInDropdown && btn.offsetParent) {
        const isActive = btn.getAttribute('aria-selected') === 'true' || btn.getAttribute('data-state') === 'active';
        if (!isActive) {
          btn.click();
          await wait(500);
          addLog('info', '🎬 Switched to Video mode (main UI tab)');
        } else {
          addLog('info', '🎬 Already in Video mode');
        }
        return;
      }
    }
    addLog('info', '🎬 Video mode will be applied per-prompt via settings dropdown');
  } catch (e) {
    addLog('warning', `switchToVideoMode error: ${e.message}`);
  }
}

// ==================== APPLY FLOW SETTINGS (PER PROMPT) ====================
// Opens the settings dropdown and selects the correct options:
// - Video mode (not Image)
// - Aspect ratio (Landscape/Portrait)
// - Output count (x1/x2/x3/x4)
// Uses Radix UI dropdown with aria-controls attribute matching.
async function applyFlowSettings() {
  try {
    // Step 1: Find the settings button (Video□x2) and click with FULL mouse events
    // Radix UI requires a convincing pointer sequence to open dropdown
    const settingsBtn = findSettingsDropdownButton();
    if (!settingsBtn) {
      addLog('warning', '[Settings] Settings button not found, skipping');
      return;
    }

    // Full mouse event sequence (not just .click()) - needed for Radix UI
    const btnRect = settingsBtn.getBoundingClientRect();
    const bx = btnRect.left + btnRect.width / 2;
    const by = btnRect.top + btnRect.height / 2;
    const bOpts = { bubbles: true, cancelable: true, clientX: bx, clientY: by };

    settingsBtn.dispatchEvent(new PointerEvent('pointerover', { ...bOpts, pointerType: 'mouse' }));
    settingsBtn.dispatchEvent(new MouseEvent('mouseover', bOpts));
    settingsBtn.dispatchEvent(new PointerEvent('pointerdown', { ...bOpts, pointerType: 'mouse' }));
    settingsBtn.dispatchEvent(new MouseEvent('mousedown', bOpts));
    await wait(50);
    settingsBtn.dispatchEvent(new PointerEvent('pointerup', { ...bOpts, pointerType: 'mouse' }));
    settingsBtn.dispatchEvent(new MouseEvent('mouseup', bOpts));
    settingsBtn.dispatchEvent(new MouseEvent('click', bOpts));
    settingsBtn.click(); // Also call native click as fallback

    addLog('info', '[Settings] Clicked settings button');
    await wait(800);

    // Step 2: Wait up to 5 seconds for dropdown to appear
    let dropdown = null;
    let isNewUI = false;
    for (let i = 0; i < 10; i++) {
      // Old UI
      dropdown = document.querySelector('[data-radix-menu-content][data-state="open"]');
      if (!dropdown) dropdown = document.querySelector('[data-radix-menu-content]');
      // New UI
      if (!dropdown) {
        dropdown = document.querySelector('flow-prompt-box-settings');
        if (dropdown) isNewUI = true;
      }
      if (dropdown) break;
      await wait(500);
    }

    if (!dropdown) {
      addLog('warning', '[Settings] Dropdown did not open');
      return;
    }

    addLog('info', `[Settings] Dropdown is open (${isNewUI ? 'New UI' : 'Old UI'}), applying settings...`);

    const aspectRatio = state.settings.aspectRatio || '16:9';
    const outputCount = String(state.settings.outputCount || 2);

    if (isNewUI) {
      // === NEW UI LOGIC (August 2024+) ===
      const findToggleBtn = (text) => {
        const spans = Array.from(dropdown.querySelectorAll('span.toggle-text'));
        const span = spans.find(el => el.textContent.trim().toLowerCase() === text.toLowerCase());
        return span ? span.closest('mat-button-toggle') : null;
      };

      const clickToggleBtn = async (btn, name) => {
        if (btn && !btn.classList.contains('mat-button-toggle-checked')) {
          const btnEl = btn.querySelector('button');
          if (btnEl) {
            btnEl.click();
            addLog('info', `[Settings] Selected ${name}`);
            await wait(300);
          }
        } else if (btn) {
          addLog('info', `[Settings] Already selected ${name}`);
        }
      };

      // 1. Select Video mode
      await clickToggleBtn(findToggleBtn('video'), 'Video mode');
      // 2. Select Aspect Ratio
      await clickToggleBtn(findToggleBtn(aspectRatio), `Aspect Ratio: ${aspectRatio}`);
      // 3. Select Output Count
      await clickToggleBtn(findToggleBtn(`x${outputCount}`), `Output Count: x${outputCount}`);

    } else {
      // === OLD UI LOGIC ===
      // Step 3: Select VIDEO mode
      // Buttons have: role="tab" aria-controls="radix-:rXX:-content-VIDEO"
      
      // Video mode button
      const videoTabBtn = dropdown.querySelector('[role="tab"][aria-controls$="-content-VIDEO"]');
      if (videoTabBtn) {
        const isVideoActive = videoTabBtn.getAttribute('aria-selected') === 'true' || videoTabBtn.getAttribute('data-state') === 'active';
        if (!isVideoActive) {
          const checkSuccess = async () => videoTabBtn.getAttribute('aria-selected') === 'true' || videoTabBtn.getAttribute('data-state') === 'active';
          await clickWithRetry(videoTabBtn, checkSuccess, 3, 1000);
          addLog('info', '[Settings] Selected Video mode');
        } else {
          addLog('info', '[Settings] Already in Video mode');
        }
      }

      // Step 4: Select Aspect Ratio
      // Landscape = aria-controls$="-LANDSCAPE", Portrait = "-PORTRAIT"
      const wantPortrait = (aspectRatio === '9:16');
      const aspectTarget = wantPortrait ? '-content-PORTRAIT' : '-content-LANDSCAPE';
      const aspectBtn = dropdown.querySelector(`[role="tab"][aria-controls$="${aspectTarget}"]`);
      if (aspectBtn) {
        const isActive = aspectBtn.getAttribute('aria-selected') === 'true' || aspectBtn.getAttribute('data-state') === 'active';
        if (!isActive) {
          const checkSuccess = async () => aspectBtn.getAttribute('aria-selected') === 'true' || aspectBtn.getAttribute('data-state') === 'active';
          await clickWithRetry(aspectBtn, checkSuccess, 3, 1000);
          addLog('info', `[Settings] Selected aspect ratio: ${aspectRatio}`);
        }
      }

      // Step 5: Select Output Count (x1/x2/x3/x4)
      // Buttons have: role="tab" aria-controls ending in "-content-1", "-content-2", etc.
      const countBtn = dropdown.querySelector(`[role="tab"][aria-controls$="-content-${outputCount}"]`);
      if (countBtn) {
        const isActive = countBtn.getAttribute('aria-selected') === 'true' || countBtn.getAttribute('data-state') === 'active';
        if (!isActive) {
          const checkSuccess = async () => countBtn.getAttribute('aria-selected') === 'true' || countBtn.getAttribute('data-state') === 'active';
          await clickWithRetry(countBtn, checkSuccess, 3, 1000);
          addLog('info', `[Settings] Selected output count: x${outputCount}`);
        }
      }
    }

    // Step 6: Close the dropdown by pressing Escape or clicking outside
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(400);
    addLog('info', '[Settings] Settings applied ✅');

  } catch (e) {
    addLog('warning', `[Settings] applyFlowSettings error: ${e.message}`);
  }
}

// Find the settings/options button that opens the Flow dropdown
// Confirmed from DOM: The "Video □ x2" button has aria-haspopup="menu"
// and contains div[data-type="button-overlay"] - this is UNIQUE to this button!
function findSettingsDropdownButtonNative() {
  // Priority 1: New Google Flow UI (August 2024+)
  const newBtn = document.querySelector('button.settings-trigger-button');
  if (newBtn && newBtn.offsetParent !== null && !newBtn.closest('[role="article"]')) {
    return newBtn;
  }

  const candidates = document.querySelectorAll('button[aria-haspopup="menu"]');

  for (const btn of candidates) {
    if (!btn.offsetParent || btn.closest('[role="article"]')) continue;
    const txt = btn.textContent.toLowerCase();
    
    // Mode button always has 'video', 'banana', 'imagen' and 'x'
    if (txt.includes('video') || txt.includes('banana') || txt.includes('imagen')) {
       // Check if it has a multiplier like 1x, 2x, 4x, etc.
       if (txt.match(/\d+x/)) {
           return btn;
       }
    }
  }

  // Priority 2: Just look for '1x', '2x', '3x', '4x' in any menu button
  for (const btn of candidates) {
    if (!btn.offsetParent || btn.closest('[role="article"]')) continue;
    const txt = btn.textContent.toLowerCase();
    if (txt.match(/\d+x/)) return btn;
  }

  return null;
}

// Helper: Find the ⋮ (3-dot more_vert) menu button within a specific card
function findDownloadButtonsInCardNative(card) {
  if (!card) return [];
  const isVis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

  // ── Strategy 1: Direct Angular Material Menu Trigger or User-defined selector ──
  const userSelector = resolveSelector('downloadBtn');
  if (userSelector) {
    const userBtns = card.querySelectorAll(userSelector);
    if (userBtns.length > 0) return Array.from(userBtns);
  }

  const menuTriggers = Array.from(card.querySelectorAll('button.mat-mdc-menu-trigger, button[aria-haspopup="menu"]'));
  if (menuTriggers.length > 0) return menuTriggers;

  const results = [];

  // ── Strategy 2: Buttons inside card with more_vert / more_horiz ──
  for (const btn of card.querySelectorAll('button')) {
    const text = btn.textContent.trim().toLowerCase();
    const label = (btn.getAttribute('aria-label') || btn.title || '').toLowerCase();
    // Material icon text content (includes check because text can be 'more_vert Khác')
    if (text.includes('more_vert') || text.includes('more_horiz') || text === '⋮' || text === '⋯') {
      results.push(btn); continue;
    }
    // aria-label (supports both 'tuỳ' and 'tùy')
    if (label.includes('more') || label.includes('tuỳ') || label.includes('tùy') || label.includes('option') || label.includes('khác')) {
      results.push(btn); continue;
    }
    // aria-haspopup
    if (btn.getAttribute('aria-haspopup')) {
      results.push(btn); continue;
    }
    // Span/icon/mat-icon children with more_vert
    const spans = btn.querySelectorAll('span, i, svg, mat-icon');
    for (const s of spans) {
      const st = s.textContent.trim();
      if (st === 'more_vert' || st === 'more_horiz' || st === '⋮') {
        results.push(btn); break;
      }
    }
  }

  if (results.length > 0) {
    // addLog('info', `Found ${results.length} menu (3-dots) buttons in card`); // Ẩn log để tránh spam
    return results;
  }

  // ── Strategy 3: Position-based — button in top-right area of card ──
  // Nút ⋮ thường nằm ở góc trên phải của card (trong 40% trên, 30% phải)
  const cardRect = card.getBoundingClientRect();
  if (cardRect.width > 0 && cardRect.height > 0) {
    const topZone  = cardRect.top + cardRect.height * 0.45;
    const rightZone = cardRect.left + cardRect.width * 0.65;
    for (const btn of card.querySelectorAll('button')) {
      if (!isVis(btn)) continue;
      const r = btn.getBoundingClientRect();
      if (r.top < topZone && r.left > rightZone) {
        // addLog('info', `Found 3-dot button via position (top=${Math.round(r.top)}, left=${Math.round(r.left)})`); // Ẩn log tránh spam
        return [btn];
      }
    }
  }

  // addLog('info', `Found 0 download buttons in card (Strategy 4)`); // Đã ẩn log này để tránh gây hiểu nhầm
  return [];
}

// ==================== DOWNLOAD LOGIC (SIMPLIFIED) ====================
// Flow UI uses Radix UI for its drop-downs. Radix relies on Pointer events to manage menu states.
// BUT Google's proprietary React actions (like the actual download sequence) rely on native onClick.

// Trả về các mục menu ĐANG MỞ (hỗ trợ Radix, Angular Material CDK và menu thuần).
// Bản cũ dùng document.querySelectorAll('[role="menuitem"]') toàn trang nên hay
// bắt cả mục của menu đã đóng còn sót trong DOM -> click vào hư không.
function getOpenMenuItems() {
  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = window.getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
  };

  const panels = Array.from(document.querySelectorAll(
    '.mat-mdc-menu-panel, .cdk-overlay-pane, [data-radix-menu-content], [role="menu"]'
  )).filter(isVisible);

  const out = [];
  const push = (el) => { if (isVisible(el) && !out.includes(el)) out.push(el); };

  for (const panel of panels) {
    panel.querySelectorAll('[role="menuitem"], [role="menuitemradio"], button.mat-mdc-menu-item').forEach(push);
  }

  if (out.length === 0) {
    document.querySelectorAll('[role="menuitem"], [role="menuitemradio"]').forEach(push);
  }
  return out;
}

// Đóng mọi menu/overlay đang mở. Nếu bỏ sót, menu cũ sẽ che thẻ kế tiếp và
// vòng lặp tải xuống bị kẹt ở thẻ đó.
function closeAnyOpenMenu() {
  try {
    for (const target of [document, document.body]) {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
      target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
    }
    const backdrop = document.querySelector('.cdk-overlay-backdrop, .cdk-overlay-transparent-backdrop');
    if (backdrop) backdrop.click();
  } catch (e) {}
}

// Opens DropdownMenu trigger (supports both legacy Radix UI and Angular Material MDC)
function radixOpenMenu(element) {
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const opts = { view: window, bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  
  element.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', button: 0, buttons: 1 }));
  element.dispatchEvent(new MouseEvent('mousedown', { ...opts, button: 0, buttons: 1 }));
  element.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse', button: 0, buttons: 0 }));
  element.dispatchEvent(new MouseEvent('mouseup', { ...opts, button: 0, buttons: 0 }));
  
  // CRITICAL FIX: Angular Material MDC requires a real 'click' event.
  // We MUST call stopPropagation() so the click doesn't bubble up to the video card container,
  // which would otherwise open the video detail modal (large overlay).
  const clickEvent = new MouseEvent('click', { ...opts });
  clickEvent.stopPropagation();
  element.dispatchEvent(clickEvent);
}

// Submenu expansion (supports keyboard a11y, mouseenter, and click for Angular Material)
function radixKeyboardExpandSubmenu(element) {
  if (!element) return;
  
  if (typeof element.focus === 'function') {
    element.focus();
  }

  const kbOpts = { view: window, bubbles: true, cancelable: true };
  
  // ArrowRight and Enter are standard Radix Submenu Expansion bindings
  element.dispatchEvent(new KeyboardEvent('keydown', { ...kbOpts, key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 }));
  element.dispatchEvent(new KeyboardEvent('keyup', { ...kbOpts, key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 }));

  element.dispatchEvent(new KeyboardEvent('keydown', { ...kbOpts, key: 'Enter', code: 'Enter', keyCode: 13 }));
  element.dispatchEvent(new KeyboardEvent('keyup', { ...kbOpts, key: 'Enter', code: 'Enter', keyCode: 13 }));
}

// ==================== ROBUST CLICK ====================
// Tránh lỗi click hụt do lag UI, click xong đợi 2s, nếu checkSuccessFn false thì click lại
async function clickWithRetry(element, checkSuccessFn, maxRetries = 3, retryDelay = 2000) {
    if (!element) return false;
    for (let i = 0; i < maxRetries; i++) {
        try {
            radixOpenMenu(element);
            element.click();
        } catch (e) {}
        
        await wait(retryDelay);
        if (await checkSuccessFn()) {
            return true;
        } else {
            addLog('warning', `⚠️ Click không phản hồi, đang thử lại (Lần ${i + 1}/${maxRetries})...`);
        }
    }
    return false;
}

// Each video downloads its own files sequentially - no global queue

async function startDownloadForVideo(video) {
  if (!video || !state.settings.autoDownload) return;
  if (video._isDownloading) {
    addLog('info', `[${video.promptIndex}] Already downloading, skip`);
    return;
  }
  if (video.downloaded) {
    return;
  }

  video._isDownloading = true;
  const promptIndex = video.promptIndex;

  addLog('info', `[${promptIndex}] 🎬 Starting sequential download...`);

  try {
    let tiles = video.cardElements || [];
    
    // Recovery Phase: If tiles are empty (or dead JSON objects from saveProject), reconstruct them from trackedTileIds string array
    if (tiles.length === 0 || !(tiles[0] instanceof Element || tiles[0] instanceof Node)) {
        if (video.trackedTileIds && video.trackedTileIds.length > 0) {
            tiles = new Array(video.trackedTileIds.length).fill(null);
            addLog('info', `[${promptIndex}] Hydrating ${tiles.length} tile slots from tracking memory.`);
        }
    }

    if (!tiles || tiles.length === 0) throw new Error('No generated tiles found for this prompt');

    const startFrom = video.downloadedCount || 0;
    const totalToDownload = tiles.length;
    video.totalVideos = totalToDownload; // Sync total videos if not set

    if (startFrom >= totalToDownload) {
      addLog('info', `[${promptIndex}] All videos already downloaded (${startFrom}/${totalToDownload})`);
      video.downloaded = true;
      video._isDownloading = false;
      return;
    }

    addLog('info', `[${promptIndex}] Will download ${totalToDownload - startFrom} videos (from ${startFrom + 1} to ${totalToDownload})`);

    // Download each video tile ONE BY ONE
    for (let i = startFrom; i < totalToDownload; i++) {
      const videoNum = i + 1;
      addLog('info', `[${promptIndex}] 📥 Downloading ${videoNum}/${totalToDownload}...`);

      try {
        let tile = tiles[i];

        // If the tile element is missing, invalid (e.g. from JSON), or detached from DOM
        if (!tile || !(tile instanceof Node) || !document.body.contains(tile)) {
          const tileId = video.trackedTileIds && video.trackedTileIds[i];
          if (tileId) tile = getTileById(tileId);
        }

        // Check if the tile is a failed generation (no media) to skip it gracefully!
        // ONLY call querySelector if it's actually a valid DOM Node
        const hasMedia = tile && (tile instanceof Node) && (typeof tile.querySelector === 'function') && tile.querySelector('video, img, a[href^="/edit/"]');
        if (tile && (tile instanceof Node) && !hasMedia) {
             addLog('warning', `[${promptIndex}] Video ${videoNum}/${totalToDownload} bị lỗi từ Google (Không thể tạo video). Đã skip.`);
             video.downloadedCount = (video.downloadedCount || 0) + 1; // Đánh dấu là đã xử lý
             continue; // Bỏ qua mượt mà, tải video còn lại!
        }

        // If STILL missing, physically scroll up to force React to remount it!
        if (!tile || !(tile instanceof Node) || !document.body.contains(tile)) {
          addLog('warning', `[${promptIndex}] Tile detached (Virtualized DOM). Scrolling up to recover...`);
          let recovered = false;
          
          for (let s = 0; s < 30; s++) { // Try up to 30 scrolls
            const tileId = video.trackedTileIds && video.trackedTileIds[i];
            if (tileId) tile = getTileById(tileId);
            
            if (tile && (tile instanceof Node) && document.body.contains(tile)) {
              recovered = true;
              break;
            }
            
            // Scroll up by 800px per tick on all probable scroll containers
            window.scrollBy({ top: -1000, behavior: 'auto' });
            const scrollContainers = [
                document.querySelector('c-wiz[data-is-scrollable="true"]'),
                document.documentElement,
                document.body,
                document.querySelector('[role="main"]')
            ];
            for (const sc of scrollContainers) {
                if (sc && typeof sc.scrollBy === 'function') {
                    sc.scrollBy({ top: -1000, behavior: 'auto' });
                } else if (sc) {
                    sc.scrollTop -= 1000;
                }
            }
            await wait(600);
          }
          
          if (!recovered) {
             throw new Error('Tile DOM element lost (Scroll recovery failed)');
          }
          
          // Update the tiles array reference so subsequent logic uses the correct native node
          tiles[i] = tile;
          video.cardElements = tiles; // Save it back to state too just in case
        }

        tile.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await wait(1000);


        // ── MỞ MENU TẢI XUỐNG BẰNG RIGHT CLICK (THEO YÊU CẦU USER) ──
        // Lệnh hover cũ không còn mở được nút 3 chấm do Google Flow đã đổi UI.
        // Ta sẽ giả lập hover vào thẻ, sau đó gọi trực tiếp Right Click (contextmenu) để mở menu tải xuống.
        const rect = tile.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
            throw new Error('Tile has no size (hidden or detached).');
        }
        const bx = rect.left + rect.width / 2;
        const by = rect.top + rect.height / 2;
        const bOpts = { view: window, bubbles: true, cancelable: true, clientX: bx, clientY: by };

        // 1. Giả lập Hover
        tile.dispatchEvent(new PointerEvent('pointerover', { ...bOpts, pointerType: 'mouse' }));
        tile.dispatchEvent(new MouseEvent('mouseover', bOpts));
        tile.dispatchEvent(new MouseEvent('mouseenter', bOpts));
        await wait(500);

        // 2. Mở Context Menu (Right Click)
        const ctxEvent = new MouseEvent('contextmenu', { 
            ...bOpts,
            button: 2, 
            buttons: 2 // CRITICAL: Angular Material check 'buttons === 2' to detect right-click correctly
        });
        
        // TUYỆT ĐỐI KHÔNG dùng ctxEvent.stopPropagation() vì Flow bắt sự kiện right-click ở cấp cao hơn.
        // Nếu stopPropagation() thì Flow sẽ hiểu nhầm là Left Click và mở tung thẻ ảnh lên!
        tile.dispatchEvent(ctxEvent);
        await wait(1500); // Chờ menu xổ ra

        const suffix = videoNum.toString();
        const targetFilenameBase = generateFileName(video, suffix, totalToDownload);

        // --- PHASE 1: TÌM MỤC "TẢI XUỐNG" TRONG MENU VỪA MỞ ---
        const mainMenuItems = getOpenMenuItems();
        const downloadItem = mainMenuItems.find(el => {
          const icon = el.querySelector('i.google-symbols, .google-symbols, .material-icons, mat-icon, i');
          const iconText = icon ? icon.textContent.trim().toLowerCase() : '';
          if (iconText === 'download' || iconText === 'file_download' || iconText === 'save_alt') return true;

          const textContent = el.textContent.toLowerCase();
          return textContent.includes('download') || textContent.includes('tải') || textContent.includes('lưu');
        });

        if (!downloadItem) {
          closeAnyOpenMenu();
          addLog('error', `[${promptIndex}] ❌ Không thấy mục "Tải xuống" trong menu của thẻ. Giao diện Flow có thể đã đổi — dùng Cài đặt → Hiệu chỉnh selector.`);
          throw new Error('Không thấy mục Tải xuống trong menu thẻ');
        }

        await wait(500);

        // Mở submenu chất lượng bằng phím (không .click() để tránh click xuyên
        // xuống thẻ bên dưới, vốn làm Flow mở modal chi tiết và chặn vòng lặp).
        radixKeyboardExpandSubmenu(downloadItem);
        await wait(2000);

        // --- PHASE 2: XÁC ĐỊNH ĐỊNH DẠNG TRƯỚC KHI ĐĂNG KÝ TÊN FILE ---
        // FIX QUAN TRỌNG (1.6.0): bản cũ gửi SET_NEXT_FILENAME *trước* khi kiểm
        // tra định dạng. Nếu thẻ bị bỏ qua (`continue`) thì cái tên đã nằm trong
        // hàng đợi của background và không ai lấy ra => TẤT CẢ file tải sau đó
        // bị đặt lệch tên một nhịp. Nay: kiểm tra trước, đăng ký tên sau.
        const submenuItems = getOpenMenuItems().filter(el => el !== downloadItem && !el.contains(downloadItem));
        const qualityItems = submenuItems.length > 0 ? submenuItems : getOpenMenuItems().filter(el => el !== downloadItem);

        if (qualityItems.length > 0) {
            // FIX (1.6.0): bản cũ coi "4K" là dấu hiệu của VIDEO. Nhưng menu tải
            // ẢNH của Flow cũng có "Tăng lên 4K" => isVideoFormat = true, thẻ ảnh
            // KHÔNG bị bỏ qua, rồi lại không tìm thấy mục "1080p" => văng lỗi
            // "Failed to select quality" và retry vô ích tới hết số lần thử.
            // Nay tính ĐIỂM hai bên và bỏ "4K" ra khỏi bằng chứng vì nó lưỡng nghĩa.
            let videoScore = 0;
            let imageScore = 0;

            for (const item of qualityItems) {
                const text = (item.textContent || '').toLowerCase();
                if (/\b\d{3,4}\s*p\b/.test(text)) videoScore += 2;              // 1080p, 720p, 270p…
                if (/\bfps\b|\bmp4\b/.test(text)) videoScore += 1;
                if (/gốc|goc|original|nguyên bản|nguyen ban|tăng lên|tang len|upscale|phóng to/.test(text)) imageScore += 1;
                if (/\b[12]\s*k\b/.test(text)) imageScore += 1;                  // 1K, 2K
                if (/\bpng\b|\bjpe?g\b|\bwebp\b/.test(text)) imageScore += 2;
            }

            const wrongFormat =
                (state.settings.runMode === 'video' && imageScore > videoScore) ? 'Ảnh' :
                (state.settings.runMode === 'image' && videoScore > imageScore) ? 'Video' : null;

            if (wrongFormat) {
                addLog('warning', `[${promptIndex}] ⚠️ Bỏ qua thẻ này: định dạng là ${wrongFormat} nhưng đang chạy chế độ ${state.settings.runMode === 'video' ? 'Video' : 'Ảnh'}.`);
                tile.setAttribute('data-veo-ignored', 'true');
                video.totalVideos = Math.max(0, (video.totalVideos || 0) - 1);
                saveProject();
                closeAnyOpenMenu();
                await wait(1000);
                continue; // Không có tên nào bị treo trong hàng đợi -> không lệch tên.
            }
        }

        // --- PHASE 3: ĐĂNG KÝ TÊN FILE VỚI CHROME (ép tên khi tải) ---
        let filenameRegistered = false;
        if (targetFilenameBase) {
            try {
                await chrome.runtime.sendMessage({ action: 'SET_NEXT_FILENAME', filename: targetFilenameBase });
                filenameRegistered = true;
                addLog('info', `[${promptIndex}] 🏷️ Tên file sẽ dùng: ${targetFilenameBase}`);
            } catch (e) {
                addLog('warning', `[${promptIndex}] Không gửi được tên file (${e.message}) — Chrome sẽ giữ tên gốc của Google.`);
            }
        }

        // --- PHASE 4: CHỌN CHẤT LƯỢNG ---
        const targetQualityRaw = state.settings.downloadQuality || '1080p';
        let clicked = false;

        const qualityMap = {
            '1080p': '1080p', '720p': '720p', '4k': '4k', '270p': '270p',
            'img_4k': '4k', 'img_2k': '2k', 'img_1k': '1k'
        };
        const tq = (qualityMap[targetQualityRaw] || targetQualityRaw).toLowerCase();

        if (qualityItems.length > 0) {
          for (const item of qualityItems) {
            const text = item.textContent.toLowerCase();
            if (text.includes(tq) ||
                (targetQualityRaw === 'img_1k' && (text.includes('1k') || text.includes('gốc') || text.includes('original'))) ||
                (targetQualityRaw === 'img_4k' && text.includes('4k')) ||
                (targetQualityRaw === 'img_2k' && text.includes('2k'))) {
              item.click();
              clicked = true;
              addLog('info', `[${promptIndex}] Đã chọn độ phân giải: ${targetQualityRaw}`);
              break;
            }
          }

          // Fallback hạ cấp chất lượng theo bậc, thay vì chỉ 1080p -> 720p.
          if (!clicked) {
            const ladder = {
              '4k': ['1080p', '720p', '270p'],
              '1080p': ['720p', '270p', '4k'],
              '720p': ['1080p', '270p', '4k'],
              '270p': ['720p', '1080p', '4k'],
              'img_4k': ['2k', '1k', 'gốc', 'original'],
              'img_2k': ['1k', 'gốc', 'original', '4k'],
              'img_1k': ['gốc', 'original', '2k', '4k']
            }[targetQualityRaw] || [];
            for (const alt of ladder) {
              const hit = qualityItems.find(it => it.textContent.toLowerCase().includes(alt));
              if (hit) {
                hit.click();
                clicked = true;
                addLog('warning', `[${promptIndex}] Không có ${targetQualityRaw}, dùng "${alt}" thay thế.`);
                break;
              }
            }
          }
        } else {
          // Không có submenu chất lượng: chính mục "Tải xuống" đã kích hoạt tải.
          clicked = true;
          addLog('info', `[${promptIndex}] Đã bấm Tải xuống (menu không có mục chất lượng).`);
        }

        if (!clicked) {
          // Rút tên ra khỏi hàng đợi để không làm lệch tên các file sau.
          if (filenameRegistered) {
            try { await chrome.runtime.sendMessage({ action: 'UNSET_NEXT_FILENAME', filename: targetFilenameBase }); } catch (e) {}
          }
          closeAnyOpenMenu();
          throw new Error('Không chọn được chất lượng tải xuống');
        }

        // ================= ĐỒNG BỘ VỚI CHROME DOWNLOADS =================
        // Flow kéo file từ server bằng Ajax trước khi gọi Native Download.
        // Phải chờ đúng file của mình vào Chrome Downloads, nếu chạy tiếp ngay
        // thì thứ tự hàng đợi tên file bị phá.
        if (filenameRegistered) {
            addLog('info', `[${promptIndex}] ⏳ Đang chờ máy chủ xuất file (thường 3-15s)...`);
            const started = await new Promise((resolve) => {
                let timeout;
                const listener = (msg) => {
                    if (msg && msg.action === 'DOWNLOAD_STARTED' && msg.filename === targetFilenameBase) {
                        chrome.runtime.onMessage.removeListener(listener);
                        clearTimeout(timeout);
                        resolve(true);
                    }
                };
                chrome.runtime.onMessage.addListener(listener);
                timeout = setTimeout(() => {
                    chrome.runtime.onMessage.removeListener(listener);
                    resolve(false);
                }, 120000);
            });

            if (started) {
                addLog('success', `[${promptIndex}] ⬇️ Đã vào Chrome Downloads: ${targetFilenameBase}`);
            } else {
                // FIX: hết thời gian chờ => tên vẫn treo trong hàng đợi background
                // và sẽ bị gán cho file KHÁC. Phải rút ra rồi mới tính là lỗi.
                try { await chrome.runtime.sendMessage({ action: 'UNSET_NEXT_FILENAME', filename: targetFilenameBase }); } catch (e) {}
                closeAnyOpenMenu();
                throw new Error(`Chờ 120s mà Google chưa xuất file (${targetFilenameBase})`);
            }
        } else {
            addLog('success', `[${promptIndex}] Đã gửi lệnh tải (giữ tên gốc).`);
            await wait(3000);
        }

        video.downloadedCount = (video.downloadedCount || 0) + 1;
        updateUI();
        saveProject();

        if (i < totalToDownload - 1) await wait(2000);

        } catch (error) {
          closeAnyOpenMenu();
          addLog('error', `[${promptIndex}] Media ${videoNum}/${totalToDownload} lỗi: ${error.message}`);
          throw error;
        }
    }

    if (video.downloadedCount >= video.totalVideos) {
      video.downloaded = true;
      addLog('success', `[${promptIndex}] 🎉 All complete!`);
      saveProject(); // Bắt buộc phải lưu LẠI cờ downloaded=true vào bộ nhớ!
    }

  } catch (error) {
    addLog('error', `[${promptIndex}] Download failed: ${error.message}`);
    throw error; // Rethrow to mainLoop to actually trigger retries and prevent infinite loop!
  } finally {
    video._isDownloading = false;
    updateUI();
  }
}

// Chuỗi dùng để lọc trên ô Tìm kiếm của Flow.
// FIX (1.6.0): bản cũ nhồi NGUYÊN prompt vào ô search. Với prompt dài (vài trăm
// đến vài nghìn ký tự) Flow trả về 0 kết quả => "Bộ lọc Search trống không" =>
// không tải được file nào. Nay chỉ lấy đoạn đầu đủ để định danh.
const SEARCH_FILTER_MAX = 80;
function buildSearchFilterText(video) {
  const displayIndex = getPromptIndexNumber(video.promptIndex);
  const body = String(video.promptText || '').replace(/\s+/g, ' ').trim();
  const head = body.length > SEARCH_FILTER_MAX ? body.slice(0, SEARCH_FILTER_MAX).trim() : body;
  return (state.settings.addIndex ? `${displayIndex}. ${head}` : head).trim();
}

function getPromptIndexNumber(promptIndex) {
    const s = state.settings || {};
    const mode = s.renameMode || 'default';
    if (mode === 'custom_list') {
        return promptIndex; // For custom_list, just fallback to sequential 1,2,3 for prefixing the prompt text in Flow UI
    }
    const startIndex = parseInt(s.renameStartIndex) || 1;
    return startIndex + promptIndex - 1;
}

// ─── Bỏ dấu tiếng Việt ───
// Chrome ÂM THẦM BỎ QUA tên file có ký tự ngoài ASCII (xem ghi chú trong
// background.js), nên background luôn chuyển tự trước khi đặt tên trên đĩa.
// Hàm này dùng khi người dùng chọn "bỏ dấu ở cả tên trên Flow" để tên trong
// Flow và tên file trên máy khớp nhau.
const VI_ACCENT_MAP = {
    'à':'a','á':'a','ạ':'a','ả':'a','ã':'a','â':'a','ầ':'a','ấ':'a','ậ':'a','ẩ':'a','ẫ':'a',
    'ă':'a','ằ':'a','ắ':'a','ặ':'a','ẳ':'a','ẵ':'a',
    'è':'e','é':'e','ẹ':'e','ẻ':'e','ẽ':'e','ê':'e','ề':'e','ế':'e','ệ':'e','ể':'e','ễ':'e',
    'ì':'i','í':'i','ị':'i','ỉ':'i','ĩ':'i',
    'ò':'o','ó':'o','ọ':'o','ỏ':'o','õ':'o','ô':'o','ồ':'o','ố':'o','ộ':'o','ổ':'o','ỗ':'o',
    'ơ':'o','ờ':'o','ớ':'o','ợ':'o','ở':'o','ỡ':'o',
    'ù':'u','ú':'u','ụ':'u','ủ':'u','ũ':'u','ư':'u','ừ':'u','ứ':'u','ự':'u','ử':'u','ữ':'u',
    'ỳ':'y','ý':'y','ỵ':'y','ỷ':'y','ỹ':'y',
    'đ':'d'
};

function deaccentVi(input) {
    let s = String(input || '').replace(/[À-ỹ]/g, (ch) => {
        const lower = ch.toLowerCase();
        const mapped = VI_ACCENT_MAP[lower];
        if (!mapped) return ch;
        return ch === lower ? mapped : mapped.toUpperCase();
    });
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    return s;
}

// Chuẩn hoá một đoạn text thành phần tên file an toàn cho Windows/macOS/Linux.
function toSafeFileChunk(text, maxLen) {
    let raw = String(text || '');
    // asciiMode = 'both' -> bỏ dấu ngay từ đây để tên trên Flow cũng khớp.
    if ((state.settings?.asciiMode || 'file') === 'both') raw = deaccentVi(raw);

    let out = raw
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[^\p{L}\p{N}_-]/gu, '_')
        .replace(/_+/g, '_')
        .replace(/^_+/, '');
    // maxLen <= 0 => KHÔNG giới hạn ký tự.
    if (maxLen > 0 && out.length > maxLen) out = out.slice(0, maxLen);
    return out.replace(/_+$/, '');
}

function generateFileName(video, suffix, totalItems) {
    const s = state.settings || {};
    const mode = s.renameMode || 'default';
    const startIndex = parseInt(s.renameStartIndex) || 1;
    const promptIndex = video.promptIndex;

    // Độ dài tối đa phần lấy từ prompt. 0 = "không giới hạn" theo ý người dùng,
    // nhưng vẫn phải chặn trần cứng 150 vì Windows giới hạn đường dẫn ~260 ký
    // tự — vượt quá là Chrome tự cắt tên hoặc tải lỗi.
    const HARD_MAX = 150;
    let maxLen = s.renameMaxLen;
    maxLen = (maxLen === '' || maxLen === undefined || maxLen === null) ? 30 : parseInt(maxLen, 10);
    if (Number.isNaN(maxLen) || maxLen <= 0) maxLen = HARD_MAX;
    if (maxLen > HARD_MAX) maxLen = HARD_MAX;

    // ── Số thứ tự của prompt này (ưu tiên số mà Flow đang hiển thị trên thẻ) ──
    const seqOf = (v) => {
        const m = String(v.promptText || '').match(/^(\d+)[\)\.]\s*/);
        return m ? parseInt(m[1], 10) : (startIndex + v.promptIndex - 1);
    };

    // ── CHẾ ĐỘ MỚI (1.6.1): CHỈ SỐ THỨ TỰ ──
    // Ví dụ: pad=3, prefix="Canh_", suffix="" -> Canh_001, Canh_002…
    if (mode === 'index_only') {
        let pad = parseInt(s.renameIndexPad, 10);
        if (Number.isNaN(pad) || pad < 1) pad = 2;
        if (pad > 8) pad = 8;

        const num = String(seqOf(video)).padStart(pad, '0');
        // CẨN THẬN: tham số `suffix` của hàm là SỐ THỨ TỰ MEDIA (1,2,3…),
        // khác với renameSuffix do người dùng nhập — không được đặt trùng tên.
        const userPrefix = toSafeFileChunk(s.renamePrefix || '', 40);
        const userSuffix = toSafeFileChunk(s.renameSuffix || '', 40);

        const joinPart = (a, b) => (a && b) ? `${a}_${b}` : (a || b);
        let base = joinPart(joinPart(userPrefix, num), userSuffix) || num;

        return totalItems === 1 ? base : `${base}_${suffix}`;
    }

    // Custom List Mode
    if (mode === 'custom_list' && s.renameCustomList) {
        const lines = String(s.renameCustomList).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const customName = lines[promptIndex - 1];
        if (customName) {
            // Tên do user tự đặt: không cắt theo maxLen của prompt, chỉ chặn trần an toàn.
            const safeCustomName = toSafeFileChunk(customName, 150) || `media_${promptIndex}`;
            return totalItems === 1 ? safeCustomName : `${safeCustomName}_${suffix}`;
        }
    }

    // Default Mode
    let basePrefix;
    const matchPrefix = String(video.promptText || '').match(/^(\d+)[\)\.]\s*/);
    if (matchPrefix) {
        basePrefix = matchPrefix[1];
    } else {
        basePrefix = (startIndex + promptIndex - 1).toString();
    }

    const prefix = basePrefix.padStart(2, '0');
    const rawBody = String(video.promptText || '').replace(/^(\d+)[\)\.]\s*/, '');
    // FIX: prompt chỉ gồm dấu câu / emoji sẽ cho safePrompt = '' -> tên file
    // thành "05_" hoặc "05__1". Có fallback để luôn có tên hợp lệ.
    const safePrompt = toSafeFileChunk(rawBody, maxLen) || `prompt_${promptIndex}`;

    return totalItems === 1 ? `${prefix}_${safePrompt}` : `${prefix}_${safePrompt}_${suffix}`;
}

// Local fork: original internal-API Cloud rename implementation removed.
// A UI-only rename implementation is declared near the end of this file.

async function downloadProjectAsZip() {
    addLog('info', '🔍 Đang tìm nút ⋮ Menu Dự Án trong header...');

    // ── TÌM TRỰC TIẾP NÚT ⋮ (more_vert) TRONG HEADER ──
    // Thay vì duyệt tất cả menu buttons từ trái sang phải (chậm, click nhầm),
    // ta filter chính xác: icon more_vert + không trong card + ở vùng header (top < 150px)
    //
    // Dựa trên UI Flow: header chứa [filter] [+] [film] [settings] [?] [⋮]
    // Chỉ nút ⋮ (more_vert) mới có "Tải dự án xuống" trong menu của nó.

    const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter(b => b.offsetParent !== null) // Chỉ visible buttons
        .filter(b => !b.closest('[data-tile-id]') && !b.closest('[role="article"]')); // Không trong card

    // Helper: kiểm tra button có icon more_vert hoặc aria-label phù hợp
    const hasMoreVert = (btn) => {
        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        if (label.includes('lựa chọn khác') || label.includes('more options') || label.includes('tùy chọn') || label.includes('tuỳ chọn')) return true;
        const icons = btn.querySelectorAll('i, span, svg, mat-icon');
        for (const ic of icons) {
            if (ic.textContent.trim() === 'more_vert') return true;
        }
        return btn.textContent.trim() === 'more_vert';
    };

    let globalMenuBtn = null;

    // Ưu tiên 1: Tìm nút more_vert trong header zone (top < 150px của viewport)
    // → Đây chính xác là nút ⋮ góc phải trên cùng
    const headerBtns = allBtns
        .filter(b => hasMoreVert(b))
        .map(b => ({ btn: b, rect: b.getBoundingClientRect() }))
        .filter(({ rect }) => rect.top >= 0 && rect.top < 150 && rect.width > 0);

    if (headerBtns.length > 0) {
        // Nếu có nhiều more_vert trong header, lấy cái RIGHTMOST (nút ⋮ trên cùng bên phải cạnh Settings/Avatar)
        headerBtns.sort((a, b) => b.rect.right - a.rect.right);
        globalMenuBtn = headerBtns[0].btn;
        addLog('info', `🎯 Tìm thấy nút ⋮ trong header (top=${Math.round(headerBtns[0].rect.top)}px, right=${Math.round(headerBtns[0].rect.right)}px)`);
    }

    // Fallback: Nếu header zone không có → lấy nút more_vert RIGHTMOST trên trang
    // (không trong card) — thường vẫn đúng vì nút ⋮ dự án ở góc phải nhất
    if (!globalMenuBtn) {
        const allMoreVert = allBtns
            .filter(b => hasMoreVert(b))
            .map(b => ({ btn: b, rect: b.getBoundingClientRect() }))
            .filter(({ rect }) => rect.width > 0)
            .sort((a, b) => b.rect.right - a.rect.right);

        if (allMoreVert.length > 0) {
            globalMenuBtn = allMoreVert[0].btn;
            addLog('warning', `⚠️ Không tìm thấy trong header zone — dùng rightmost more_vert làm fallback`);
        }
    }

    if (!globalMenuBtn) {
        throw new Error("Không tìm thấy nút ⋮ (more_vert) ngoài header của trang Flow");
    }

    // ── MỞ MENU ──
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await wait(300);

    radixOpenMenu(globalMenuBtn);
    globalMenuBtn.click(); // Fallback native click cho Angular Material
    await wait(1500);

    // ── TÌM OPTION "TẢI DỰ ÁN XUỐNG" (NÚT ĐẦU TIÊN TRONG MENU) ──
    const menuItems = Array.from(document.querySelectorAll('.mat-mdc-menu-panel [role="menuitem"], [role="menu"] [role="menuitem"], [role="menuitem"], [role="menuitemradio"]'));
    let foundDownloadItem = null;

    for (const item of menuItems) {
        const text = item.textContent.toLowerCase();
        const icon = item.querySelector('i.google-symbols, .google-symbols, i, svg, mat-icon');

        if (text.includes('tải dự án') || text.includes('download project') ||
            text.includes('tải xuống') || text.includes('zip') ||
            text.includes('tải tất cả') || text.includes('download all')) {
            foundDownloadItem = item;
            break;
        }
        if (icon && (icon.textContent.trim() === 'download' || icon.textContent.trim() === 'file_download')) {
            foundDownloadItem = item;
            break;
        }
    }

    // Theo đúng cấu trúc menu: Option đầu tiên luôn là "Tải dự án xuống"
    if (!foundDownloadItem && menuItems.length > 0) {
        foundDownloadItem = menuItems[0];
        addLog('info', `🎯 Đã chọn option đầu tiên trong menu dự án: "${foundDownloadItem.textContent.trim()}"`);
    }

    if (!foundDownloadItem) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        throw new Error("Mở được menu ⋮ nhưng không thấy option 'Tải dự án xuống' — UI Flow có thể đã thay đổi");
    }

    addLog('success', `✅ Tìm thấy "Tải dự án xuống", đang click...`);
    const checkSuccess = async () => {
        return !document.body.contains(foundDownloadItem) || foundDownloadItem.getAttribute('data-state') === 'closed';
    };
    const success = await clickWithRetry(foundDownloadItem, checkSuccess, 3, 2000);
    if (!success) {
        throw new Error("Không thể click vào nút tải xuống (hụt 3 lần).");
    }
}

// Removed legacy triggerDownloadIfNeeded logic

// ==================== PROJECT SAVE/LOAD ====================
async function saveProject() {
  if (!state.projectName) {
    if (state.prompts.length > 0) {
      // Auto-generate name if not set
      const date = new Date().toISOString().slice(0, 10);
      state.projectName = `AutoSave_${date}_${Date.now()}`;
    } else {
      return;
    }
  }

  // Create clean copy without DOM elements and ephemeral runtime states
  //
  // (1.7.0) CHỐNG ĐẦY BỘ NHỚ: mỗi video lưu lại nguyên văn promptText, mà
  // prompts[] cũng đã có đúng chuỗi đó -> nội dung prompt bị lưu HAI LẦN.
  // Với prompt dài (JSON kịch bản 15k ký tự chẳng hạn) và N tab cùng ghi vào
  // chung kho 10MB của chrome.storage.local thì quota vỡ rất nhanh. Chỉ lưu
  // promptText khi nó KHÁC prompts[promptIndex-1]; loadProject dựng lại sau.
  const cleanVideos = state.videos.map(v => {
    const { cardElement, _existingCards, _isDownloading, _downloadQueued, _preClickTopIds, ...rest } = v;
    const canonical = state.prompts?.[(v.promptIndex || 0) - 1];
    if (canonical !== undefined && canonical === rest.promptText) delete rest.promptText;
    return rest;
  });

  const projectData = {
    name: state.projectName,
    timestamp: Date.now(),
    prompts: state.prompts,
    videos: cleanVideos,
    settings: state.settings,
    _hasReloadedBeforeDownload: state._hasReloadedBeforeDownload || false,
    _hasReloadedAfterRename: state._hasReloadedAfterRename || false,
    _hasReloadedAtEnd: state._hasReloadedAtEnd || false,
    startTime: state.startTime // Save start time for elapsed calculation
  };

  try {
    // Save to storage (shared)
    let { veoProjects = {} } = await chrome.storage.local.get('veoProjects');
    
    // FIX (1.6.0): khối cũ chỉ dọn bộ nhớ khi cờ "gói FREE" bật — cờ đó KHÔNG
    // BAO GIỜ được gán trong bản local, nên việc dọn bộ nhớ chưa từng chạy và
    // chrome.storage.local (giới hạn ~10MB) cứ thế đầy dần rồi automation chết
    // giữa đường với lỗi quota. Nay dọn theo dung lượng thực tế, giữ lại 10 dự
    // án mới nhất và luôn giữ dự án đang chạy.
    const bytesInUse = await new Promise(resolve => {
        if (chrome.storage?.local?.getBytesInUse) chrome.storage.local.getBytesInUse(null, resolve);
        else resolve(0);
    });

    // FIX (1.7.0): bản 1.6.1 chỉ giữ 10 dự án mới nhất, nhưng KHÔNG xét dự án
    // NẶNG bao nhiêu. Người dùng dán prompt khổng lồ (JSON kịch bản ~15k ký tự)
    // thì 10 dự án vẫn vượt 10MB và automation lại chết với lỗi quota. Nay dọn
    // theo DUNG LƯỢNG THỰC: giữ các dự án mới nhất cho tới khi tổng ≤ ngân sách.
    if (bytesInUse > 6500000) {
        const BUDGET = 4500000;   // chừa chỗ cho settings, hàng đợi, lần ghi này
        const sorted = Object.values(veoProjects)
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        const sizeOf = (p) => { try { return JSON.stringify(p).length; } catch (e) { return 0; } };
        const activeSize = sizeOf(projectData);

        const pruned = {};
        let used = activeSize;
        if (state.projectName) pruned[state.projectName] = veoProjects[state.projectName] || projectData;

        for (const p of sorted) {
            if (!p?.name || p.name === state.projectName) continue;
            const sz = sizeOf(p);
            if (used + sz > BUDGET) continue;        // bỏ dự án này (và các cũ hơn nếu vẫn quá)
            pruned[p.name] = p;
            used += sz;
        }

        const removed = Object.keys(veoProjects).length - Object.keys(pruned).length;
        if (removed > 0) {
            veoProjects = pruned;
            addLog('warning', `🗑️ Bộ nhớ gần đầy (${(bytesInUse / 1048576).toFixed(1)}MB) — đã tự xoá ${removed} dự án cũ để lấy chỗ. ` +
                `Dự án đang chạy luôn được giữ lại.`);
        }
        // Chính dự án đang chạy đã quá to: dọn bao nhiêu cũng không cứu được.
        if (activeSize > BUDGET) {
            addLog('warning', `⚠️ Dự án đang chạy chiếm ~${(activeSize / 1048576).toFixed(1)}MB — quá lớn cho kho 10MB của Chrome. ` +
                `Nguyên nhân gần như luôn là prompt quá dài (dán nguyên JSON/kịch bản). Hãy tách prompt ngắn lại hoặc chia thành nhiều lần chạy.`);
        }
    }

    veoProjects[state.projectName] = projectData;
    await chrome.storage.local.set({ veoProjects });
    if (state.isRunning && state.projectName) {
      setRunState({ active: state.projectName });
    }

    // Notify Side Panel to update dropdown
    chrome.runtime.sendMessage({
      action: 'SAVE_PROJECT',
      data: projectData
    }).catch(() => { });
    
    return true;
  } catch (error) {
    if (error.message && error.message.toLowerCase().includes('quota')) {
      if (state.isRunning) {
        addLog('error', '⛔ BỘ NHỚ LƯU TRỮ ĐÃ ĐẦY! Vui lòng bấm vào Quản lý dự án để xóa bớt các dự án cũ.');
        state.isRunning = false;
        chrome.runtime.sendMessage({ action: 'AUTOMATION_STOPPED', summary: '⛔ Dừng do đầy bộ nhớ' }).catch(() => { });
      }
    } else {
      console.error("Lỗi khi lưu project:", error);
    }
    return false;
  }
}

async function loadProject(projectName, isAutoResuming = false) {
  const { veoProjects = {} } = await chrome.storage.local.get('veoProjects');
  const project = veoProjects[projectName];
  if (!project) return;

  state.projectName = project.name;
  state.prompts = project.prompts;
  state.videos = project.videos.map(v => {
      // 🛠️ AUTO-HEAL: Vá lỗi desync state cũ khi bị hụt mất cờ downloaded
      const healedDownloaded = v.downloaded || (v.totalVideos > 0 && (v.downloadedCount || 0) >= v.totalVideos);
      // (1.7.0) saveProject không lưu lại promptText khi nó trùng với
      // prompts[promptIndex-1] (tiết kiệm ~1/2 dung lượng). Dựng lại ở đây.
      const restoredText = v.promptText || (project.prompts || [])[(v.promptIndex || 0) - 1] || '';
      return {
          ...v,
          promptText: restoredText,
          downloaded: healedDownloaded,
          promptId: v.promptId || `pid_${Date.now()}_${v.promptIndex}`, // Auto-heal for old saves
          cardElement: null, 
          _isDownloading: false,
          _downloadQueued: false, 
          _preClickTopIds: null 
      };
  });
  state.settings = { ...state.settings, ...project.settings };
  state._hasReloadedBeforeDownload = project._hasReloadedBeforeDownload || false;
  state._hasReloadedAfterRename = project._hasReloadedAfterRename || false;
  state._hasReloadedAtEnd = project._hasReloadedAtEnd || false;
  state.startTime = project.startTime || 0; // Restore start time

  // Determine if project has pending tasks
  const isFinished = state.videos.every(v => {
      if (v.status !== 'COMPLETED') return false;
      if (state.settings.autoDownload) {
          if (!v.downloaded && !v._downloadFinalFailed) {
              return false;
          }
      }
      return true;
  });

  chrome.runtime.sendMessage({
    action: 'PROJECT_LOADED',
    data: {
      prompts: state.prompts,
      settings: state.settings,
      projectName: state.projectName,
      startTime: state.startTime,
      isFinished: isFinished,
      isRunning: isAutoResuming || state.isRunning
    }
  }).catch(() => { });

  updateUI();
  addLog('success', `📂 Loaded project: ${projectName}`);
}

async function deleteProject(projectName) {
  const { veoProjects = {} } = await chrome.storage.local.get('veoProjects');
  delete veoProjects[projectName];
  await chrome.storage.local.set({ veoProjects });

  // Notify side panel to refresh dropdown
  chrome.runtime.sendMessage({
    action: 'PROJECT_DELETED',
    data: { projectName }
  }).catch(() => { });

  addLog('success', `Deleted project: ${projectName}`);
}

// ============================================================================
// ẢNH → VIDEO: ĐẨY ẢNH TỪ MÁY LÊN KHO CỦA FLOW  (thử nghiệm, 1.6.1)
// ----------------------------------------------------------------------------
// Vì sao làm kiểu này:
//  - File/Blob KHÔNG truyền được qua chrome.runtime.sendMessage (message bị
//    serialize sang JSON), nên Side Panel đọc ảnh thành data: URL rồi gửi từng
//    ảnh sang đây; content script dựng lại File và gán vào ô upload của Flow.
//  - Ta KHÔNG mở hộp thoại chọn tệp từ đây: Chrome đòi user-gesture trong
//    trang. Hộp thoại chọn folder được mở ở Side Panel (đúng cú click của
//    người dùng), còn ở đây chỉ gán thẳng `input.files` — không cần gesture.
// ============================================================================

/** Tìm ô <input type="file"> của Flow; nếu chưa mount thì mở menu [+] để nó xuất hiện. */
async function findFlowUploadInput(openMenuIfNeeded = true) {
  const pick = () => {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'))
      .filter(i => !i.closest('#veo-extra-tools-overlay'));
    // Ưu tiên ô nhận ảnh
    return inputs.find(i => (i.getAttribute('accept') || '').includes('image'))
        || inputs.find(i => i.multiple)
        || inputs[0]
        || null;
  };

  let input = pick();
  if (input || !openMenuIfNeeded) return input;

  // Mở menu [+] để Flow mount ô upload
  const addBtnRaw = document.querySelector('.add-menu-trigger, .add-menu-icon, flow-add-menu button, mat-icon.add-menu-icon');
  const addBtn = addBtnRaw
    ? (addBtnRaw.closest('button, [role="button"], flow-add-menu') || addBtnRaw)
    : Array.from(document.querySelectorAll('button, div[role="button"]')).find(b =>
        b.classList.contains('add-menu-trigger') ||
        (b.querySelector('mat-icon, i.google-symbols')?.textContent || '').trim() === 'add' ||
        (b.querySelector('i.google-symbols')?.textContent || '').includes('add_2'));

  if (addBtn) {
    addBtn.click();
    for (let i = 0; i < 25 && !input; i++) {
      await wait(200);
      input = pick();
    }
  }
  return input;
}

async function dataUrlToFile(dataUrl, name, type) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], name, { type: type || blob.type || 'image/png' });
}

/**
 * Nhận một LÔ ảnh (mỗi ảnh: {name, type, dataUrl}) và gán vào ô upload của Flow.
 * Trả về {ok, uploaded, error} qua sendResponse.
 */
async function handleUploadImages(payload, sendResponse) {
  const images = Array.isArray(payload?.images) ? payload.images : [];
  if (!images.length) { sendResponse({ ok: false, error: 'Không có ảnh nào được gửi tới.' }); return; }

  await acquireUILock('upload-images');
  try {
    const input = await findFlowUploadInput(true);
    if (!input) {
      sendResponse({ ok: false, error: 'Không tìm thấy ô tải ảnh lên của Flow. Hãy mở menu [+] → tab Hình ảnh một lần rồi thử lại.' });
      return;
    }

    const files = [];
    for (const img of images) {
      try {
        files.push(await dataUrlToFile(img.dataUrl, img.name, img.type));
      } catch (e) {
        addLog('warning', `Không dựng lại được ảnh ${img.name}: ${e.message}`);
      }
    }
    if (!files.length) { sendResponse({ ok: false, error: 'Không dựng lại được ảnh nào.' }); return; }

    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);

    // Gán trực tiếp vào input rồi phát sự kiện để Angular/React nhận.
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    addLog('success', `⬆️ Đã đẩy ${files.length} ảnh vào ô tải lên của Flow: ${files.map(f => f.name).join(', ').slice(0, 160)}`);
    await wait(1500);
    sendResponse({ ok: true, uploaded: files.length, names: files.map(f => f.name) });
  } catch (e) {
    addLog('error', `Lỗi đẩy ảnh lên Flow: ${e.message}`);
    sendResponse({ ok: false, error: e.message });
  } finally {
    releaseUILock();
  }
}

/** Kiểm tra xem kho ảnh của Flow có sẵn các tên ảnh mà người dùng sắp dùng hay không. */
async function handleCheckAssetNames(payload, sendResponse) {
  const names = Array.isArray(payload?.names) ? payload.names : [];
  if (!names.length) { sendResponse({ ok: false, error: 'Chưa có tên ảnh nào để kiểm tra.' }); return; }

  await acquireUILock('check-assets');
  try {
    const input = await findFlowUploadInput(true);   // mở menu [+] để có ô tìm kiếm
    const searchWords = ['tìm kiếm', 'search'];
    let searchInput = null;
    for (let i = 0; i < 25 && !searchInput; i++) {
      const inputs = Array.from(document.querySelectorAll(
        '.add-menu-popover-container input.search-input, .cdk-overlay-container input.search-input, ' +
        '.add-menu-popover-container input[type="text"], .cdk-overlay-container input[type="text"]'));
      searchInput = inputs.find(inp => {
        if (!inp.offsetParent) return false;
        if (inp.classList.contains('search-input')) return true;
        const p = (inp.placeholder || '').toLowerCase();
        const a = (inp.getAttribute('aria-label') || '').toLowerCase();
        return searchWords.some(w => p.includes(w) || a.includes(w));
      });
      if (!searchInput) await wait(200);
    }

    if (!searchInput) {
      closeAnyOpenMenu();
      sendResponse({ ok: false, error: 'Không tìm thấy ô tìm kiếm trong menu [+]. Giao diện Flow có thể đã đổi.', hasUploadInput: !!input });
      return;
    }

    const found = [];
    const missing = [];
    for (const name of names) {
      await setNativeValue(searchInput, name);
      await wait(900);
      const items = Array.from(document.querySelectorAll('button.asset-item, div.asset-item-container, div[data-item-index]'));
      const target = items.find(it => {
        const txt = (it.innerText || it.textContent || '').toLowerCase()
          .replace(/(check_circle|check|done|movie|image|hình ảnh|nhân vật|video)/gi, '')
          .replace(/\.(jpe?g|png|webp|gif|mp4|mov)/gi, '').trim();
        return txt === name.toLowerCase();
      });
      (target ? found : missing).push(name);
    }

    await setNativeValue(searchInput, '');
    closeAnyOpenMenu();
    sendResponse({ ok: true, found, missing, hasUploadInput: !!input });
  } catch (e) {
    closeAnyOpenMenu();
    sendResponse({ ok: false, error: e.message });
  } finally {
    releaseUILock();
  }
}

// ==================== INIT ====================
function init() {
  if (window !== window.top || window.location.search.includes('veo_extra_window=true')) {
    return; // Không chạy automation polling hay auto-resume trong iframe hoặc popup Extra Tools
  }
  setInterval(monitorCards, CHECK_INTERVAL);
  setInterval(simulateScroll, SCROLL_INTERVAL);
  // Watchdog removed for smarter native processing constraints

  // (1.7.0) Đăng ký tab với background TRƯỚC, để biết tabId của chính mình rồi
  // mới đọc cờ chạy riêng của tab đó (chạy nhiều tab thì cờ chung sẽ lẫn nhau).
  bootWithTabId();

  // Báo tiến độ tab này cho Side Panel danh sách đa tab (nhẹ, 3s/lần).
  setInterval(() => { if (veoTabId) reportTabStatus(); }, 3000);
}

async function bootWithTabId() {
  await registerTab();

  const [{ veoSettings, autoResumeProject, activeRunningProject }, runState] = await Promise.all([
    chrome.storage.local.get(['veoSettings', 'autoResumeProject', 'activeRunningProject']),
    getRunState()
  ]);

  if (veoSettings) {
    state.settings = { ...state.settings, ...veoSettings };
  }

  // Cờ riêng của tab này; nếu chưa có thì chấp nhận cờ chung của bản ≤1.6.1
  // (chỉ một lần, để bản cũ đang chạy dở không bị mất dự án khi cập nhật).
  const legacy = autoResumeProject || activeRunningProject;
  const projectToResume = runState.autoResume || runState.active || legacy || null;

  {
    if (projectToResume) {
        // Xoá cờ tự động chạy ngay để tránh vòng lặp F5 nếu có lỗi
        clearRunState(['autoResume']);
        if (legacy) chrome.storage.local.remove(['autoResumeProject']);

        state.isRunning = true;
        // Báo Sidepanel cập nhật UI "Đang chạy" ngay lập tức để không bị giật sang nút Tiếp tục
        chrome.runtime.sendMessage({ action: 'AUTOMATION_RESUMED' }).catch(() => {});
        
        // Đợi 3 giây cho React xây dựng xong DOM của Flow trước khi Resume
        setTimeout(() => {
            loadProject(projectToResume, true).then(() => {
                if (state.projectName) {
                    addLog('info', `🔄 Tự động khôi phục quá trình Tải cho dự án: ${state.projectName}`);
                    state.isRunning = true;
                    setRunState({ active: state.projectName });
                    // Báo Sidepanel cập nhật UI "Đang chạy"
                    chrome.runtime.sendMessage({ action: 'AUTOMATION_RESUMED' }).catch(() => {});
                    chrome.runtime.sendMessage({
                        action: 'UPDATE_PROGRESS',
                        data: {
                            projectName: state.projectName,
                            summary: 'Đang Tải Xuống (Auto-Resume)...',
                            isRunning: true
                        }
                    }).catch(() => {});
                    mainLoop(); // Kích hoạt chạy tiếp
                }
            });
        }, 3000);
    }
  }
}


function veoScrollBy(amount) {
    window.scrollBy({ top: amount, behavior: 'smooth' });
    const scrollContainers = [
        document.querySelector('c-wiz[data-is-scrollable="true"]'),
        document.querySelector('div[role="main"]'),
        document.querySelector('.Oa106d'),
        document.querySelector('c-wiz[role="main"]')
    ];
    for (const sc of scrollContainers) {
        if (sc && typeof sc.scrollBy === 'function') {
            sc.scrollBy({ top: amount, behavior: 'smooth' });
        }
    }
}

function simulateScroll() {
  if (!state.isRunning) return;
  if (!state.settings.randomScroll) return; // Chỉ chạy khi bật tính năng này
  
  if (Math.random() < 0.3) {
    const scrollAmount = (Math.random() * 300 - 50); // Cuộn lên hoặc xuống một chút
    
    // Thử cuộn trên window trước
    veoScrollBy(scrollAmount);
  }
}

init();


// ============================================================================
// EXTRA TOOLS IN-PAGE OVERLAY (SAME-ORIGIN)
// ============================================================================
let extraToolsOverlay = null;
let extraToolsTabBar = null;
let extraToolsIframeContainer = null;
let extraToolsOpenTabs = [];

function createExtraToolsOverlay() {
    if (extraToolsOverlay) return;

    try {
        document.body.style.zoom = '1';
        document.documentElement.style.zoom = '1';
    } catch(e) {}

    extraToolsOverlay = document.createElement('div');
    extraToolsOverlay.id = 'veo-extra-tools-overlay';
    extraToolsOverlay.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        max-width: 100vw !important;
        max-height: 100vh !important;
        margin: 0 !important;
        padding: 0 !important;
        box-sizing: border-box !important;
        background-color: #0f172a !important;
        z-index: 2147483647 !important;
        display: flex !important;
        flex-direction: column !important;
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif !important;
    `;

    // Tab Bar
    extraToolsTabBar = document.createElement('div');
    extraToolsTabBar.style.cssText = `
        display: flex; background: #0f172a; padding: 8px 10px 0 10px;
        overflow-x: auto; border-bottom: 1px solid #334155; flex-shrink: 0;
    `;

    // Iframe Container
    extraToolsIframeContainer = document.createElement('div');
    extraToolsIframeContainer.style.cssText = `
        flex: 1 !important;
        position: relative !important;
        background: #0f172a !important;
        width: 100% !important;
        height: 100% !important;
        min-height: 0 !important;
        overflow: hidden !important;
    `;

        
    // Warning Header
    const warningHeader = document.createElement('div');
    warningHeader.style.cssText = `
        background: #1e293b; color: #fbbf24;
        padding: 6px 15px; font-size: 13px; font-weight: bold;
        border-bottom: 1px solid #334155; display: flex; align-items: center; flex-shrink: 0;
    `;
    const marquee = document.createElement('marquee');
    marquee.scrollAmount = 5;
    marquee.textContent = '⚠️ LƯU Ý: Tùy thuộc vào loại tài khoản Google (Free, Pro, Ultra) bạn đang dùng mà tốc độ và lượt gọi Agent (AI) sẽ bị giới hạn theo quy định của Google Flow. (NOTE: Depending on your Google account type, Agent/AI calls may be limited by Google Flow policies.)';
    warningHeader.appendChild(marquee);
    extraToolsOverlay.appendChild(warningHeader);

    extraToolsOverlay.appendChild(extraToolsTabBar);
    extraToolsOverlay.appendChild(extraToolsIframeContainer);

    (document.documentElement || document.body).appendChild(extraToolsOverlay);
}

function openExtraToolTab(url, title) {
    if (!extraToolsOverlay) createExtraToolsOverlay();
    extraToolsOverlay.style.display = 'flex';

    // Check if tab exists
    const existingIndex = extraToolsOpenTabs.findIndex(t => t.url === url);
    if (existingIndex !== -1) {
        switchExtraToolTab(url);
        return;
    }

    // Create Tab
    const tabEl = document.createElement('div');
    tabEl.style.cssText = `
        background: #1e293b; color: #94a3b8;
        padding: 8px 16px; border-radius: 8px 8px 0 0;
        margin-right: 6px; cursor: pointer; display: flex; align-items: center;
        gap: 10px; font-size: 14px; border: 1px solid #334155; border-bottom: none;
        white-space: nowrap; user-select: none;
    `;
    tabEl.innerHTML = `<span>${title}</span><span class="tab-close" style="color:#ef4444;font-weight:bold;margin-left:8px;">✕</span>`;

    // Create Iframe
    const iframeEl = document.createElement('iframe');
    iframeEl.src = url;
    iframeEl.style.cssText = `
        width: 100% !important; height: 100% !important; border: none !important; position: absolute !important; top: 0 !important; left: 0 !important; display: none; background: #0f172a !important;
    `;
    iframeEl.allow = "camera; microphone; clipboard-read; clipboard-write; display-capture; fullscreen; geolocation";

    tabEl.onclick = (e) => {
        if (e.target.classList.contains('tab-close')) closeExtraToolTab(url);
        else switchExtraToolTab(url);
    };

    extraToolsTabBar.appendChild(tabEl);
    extraToolsIframeContainer.appendChild(iframeEl);

    extraToolsOpenTabs.push({ url, title, tabEl, iframeEl });
    switchExtraToolTab(url);
}

function switchExtraToolTab(url) {
    extraToolsOpenTabs.forEach(t => {
        if (t.url === url) {
            t.tabEl.style.background = '#06b6d4';
            t.tabEl.style.color = '#ffffff';
            t.tabEl.style.borderTop = '3px solid #0891b2';
            t.iframeEl.style.display = 'block';
            document.title = 'EXTRA TOOLS (FREE FLOW AUTOMATION - VEO AUTOMATION)';
        } else {
            t.tabEl.style.background = '#1e293b';
            t.tabEl.style.color = '#94a3b8';
            t.tabEl.style.borderTop = '1px solid #334155';
            t.iframeEl.style.display = 'none';
        }
    });
}

function closeExtraToolTab(url) {
    const index = extraToolsOpenTabs.findIndex(t => t.url === url);
    if (index !== -1) {
        const t = extraToolsOpenTabs[index];
        t.tabEl.remove();
        t.iframeEl.remove();
        extraToolsOpenTabs.splice(index, 1);

        if (extraToolsOpenTabs.length > 0) {
            switchExtraToolTab(extraToolsOpenTabs[extraToolsOpenTabs.length - 1].url);
        } else {
            if (window === window.top && window.location.search.includes('veo_extra_window=true')) {
                chrome.runtime.sendMessage({ action: 'CLOSE_CURRENT_TAB' });
            } else {
                extraToolsOverlay.style.display = 'none';
                document.title = 'EXTRA TOOLS (FREE FLOW AUTOMATION - VEO AUTOMATION)';
            }
        }
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'OPEN_EXTRA_TOOL_OVERLAY') {
        if (window !== window.top) return;

        openExtraToolTab(message.url, message.title);
        sendResponse({ ok: true });
    }
});

// Auto-load if opened in dedicated popup
if (window === window.top && window.location.search.includes('veo_extra_window=true')) {
    const urlParams = new URLSearchParams(window.location.search);
    const initUrl = urlParams.get('tool_url');
    const initTitle = urlParams.get('tool_title') || 'Tiện ích';
    
    if (initUrl) {
        document.title = 'EXTRA TOOLS (FREE FLOW AUTOMATION - VEO AUTOMATION)';
        setTimeout(() => {
            openExtraToolTab(initUrl, initTitle);
        }, 500);
    }
}

// Persistent Title Fixer
var desiredTitle = '';
setInterval(() => {
    if (window === window.top && window.location.search.includes('veo_extra_window=true') && document.title !== 'EXTRA TOOLS (FREE FLOW AUTOMATION - VEO AUTOMATION)') {
        document.title = 'EXTRA TOOLS (FREE FLOW AUTOMATION - VEO AUTOMATION)';
    }
}, 500);

// Local fork: internal rename API self-test removed.

// Tự động kích hoạt Thu phóng 80% và Lưới ô khi trang Flow sẵn sàng
setTimeout(() => {
    try {
        if (window.location.search.includes('veo_extra_window=true') || window !== window.top) {
            return;
        }
        applyPageZoom();
        switchToGridView();
    } catch(e) {}
}, 1500);

// ============================================================================
// LOCAL-FORK SECURITY OVERRIDES
// These declarations intentionally replace the original internal-API helpers.
// This fork never intercepts Flow Authorization headers and never calls private
// workflow status/rename endpoints. Rename is attempted through the visible UI.
// ============================================================================
async function localHydrateTilesForRename(video) {
  let tiles = Array.isArray(video.cardElements)
    ? video.cardElements.filter(t => t instanceof Node && document.body.contains(t))
    : [];

  if ((!tiles || tiles.length === 0) && Array.isArray(video.trackedTileIds)) {
    tiles = video.trackedTileIds.map(id => getTileById(id)).filter(Boolean);
  }

  // Last-resort recovery: use Flow search to isolate the prompt and grab visible tiles.
  if (!tiles || tiles.length === 0) {
    const searchBox = findFlowSearchBox();
    if (searchBox) {
      const filterText = buildSearchFilterText(video);
      try {
        await setNativeValue(searchBox, filterText);
        searchBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        searchBox.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        await wait(1800);
        tiles = getOuterTiles().filter(t => t.offsetParent !== null || t.offsetWidth > 0);
      } finally {
        await setNativeValue(searchBox, '');
        await wait(500);
      }
    }
  }
  return tiles || [];
}

const RENAME_WORDS = ['rename', 'đổi tên', 'doi ten', 'sửa tên', 'sua ten', 'edit name', '이름 바꾸기', '名前を変更', '重命名'];
function findRenameMenuItem() {
  // FIX (1.6.0): bản cũ quét [role="menuitem"] TOÀN TRANG nên bắt cả mục của
  // menu đã đóng còn sót trong DOM -> click vào phần tử vô hình, rename im lặng
  // thất bại. Nay chỉ xét menu đang mở (getOpenMenuItems).
  return getOpenMenuItems().find(el => {
    const text = (el.textContent || '').trim().toLowerCase();
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    return RENAME_WORDS.some(w => text.includes(w) || label.includes(w));
  });
}

async function localOpenRenameMenu(tile) {
  if (!tile) return false;
  closeAnyOpenMenu();
  tile.scrollIntoView({ block: 'center', behavior: 'smooth' });
  await wait(500);

  const rect = tile.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const opts = { view: window, bubbles: true, cancelable: true, clientX: cx, clientY: cy };

  // Strategy 1: context menu (current Flow UI commonly exposes Rename here).
  try {
    tile.dispatchEvent(new PointerEvent('pointerover', { ...opts, pointerType: 'mouse' }));
    tile.dispatchEvent(new MouseEvent('mouseover', opts));
    tile.dispatchEvent(new MouseEvent('mouseenter', opts));
    await wait(350);
    tile.dispatchEvent(new MouseEvent('contextmenu', { ...opts, button: 2, buttons: 2 }));
  } catch (_) {}
  await wait(900);

  let renameItem = findRenameMenuItem();

  // Strategy 2: tile 3-dot menu.
  if (!renameItem) {
    closeAnyOpenMenu();
    await wait(250);
    const menuBtns = findDownloadButtonsInCard(tile);
    for (const menuBtn of menuBtns.slice(0, 3)) {
      try { radixOpenMenu(menuBtn); } catch (_) {}
      await wait(900);
      renameItem = findRenameMenuItem();
      if (renameItem) break;
      closeAnyOpenMenu();
      await wait(200);
    }
  }

  if (!renameItem) {
    closeAnyOpenMenu();
    return false;
  }

  try { renameItem.click(); } catch (_) { radixOpenMenu(renameItem); }
  await wait(800);
  return true;
}

async function renameMediaOnCloud(video) {
  addLog('info', `[${video.promptIndex}] ✏️ Đổi tên qua giao diện Flow (Local Safe Mode)...`);
  let tiles = await localHydrateTilesForRename(video);
  if (!tiles.length) {
    video._renameError = true;
    video._renameSkipped = true;
    video._renameErrorReason = 'Không tìm thấy tile trên DOM';
    addLog('warning', `[${video.promptIndex}] Không tìm thấy tile để đổi tên. File tải xuống vẫn được đổi tên cục bộ.`);
    return false;
  }

  video.totalVideos = video.totalVideos || tiles.length;
  let successCount = 0;

  for (let i = 0; i < tiles.length; i++) {
    let tile = tiles[i];
    if ((!tile || !document.body.contains(tile)) && video.trackedTileIds?.[i]) {
      tile = getTileById(video.trackedTileIds[i]);
    }
    if (!tile) continue;

    const newName = generateFileName(video, String(i + 1), tiles.length);
    const opened = await localOpenRenameMenu(tile);
    if (!opened) {
      addLog('warning', `[${video.promptIndex}] Không thấy mục Rename cho tile ${i + 1}; bỏ qua Cloud rename.`);
      continue;
    }

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'INJECT_RENAME_INPUT',
        data: { newName }
      });
      if (result && result.ok) {
        successCount++;
        addLog('success', `[${video.promptIndex}] ✅ Đổi tên UI: ${newName}`);
      } else {
        addLog('warning', `[${video.promptIndex}] Rename UI chưa xác nhận (${result?.error || 'unknown'}).`);
      }
    } catch (e) {
      addLog('warning', `[${video.promptIndex}] Rename UI lỗi: ${e.message}`);
    }
    closeAnyOpenMenu();
    await wait(500);
  }

  if (successCount === tiles.length) {
    video.renamedOnCloud = true;
    video._renameError = false;
    video._renameSkipped = false;
    addLog('success', `[${video.promptIndex}] ✅ Đã đổi tên ${successCount}/${tiles.length} tile qua UI.`);
    saveProject();
    return true;
  }

  // Do not loop forever. Local download filename enforcement remains active.
  video.renamedOnCloud = false;
  video._renameError = true;
  video._renameSkipped = true;
  video._renameErrorReason = `UI rename ${successCount}/${tiles.length}`;
  addLog('warning', `[${video.promptIndex}] Cloud rename ${successCount}/${tiles.length}. Khi tải, Chrome vẫn ép tên file theo Prompt.`);
  saveProject();
  return false;
}
