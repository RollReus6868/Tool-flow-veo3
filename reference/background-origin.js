// ==================== BACKGROUND SERVICE WORKER ====================
// Flow Automation Local — local-first. No token sniffing, no remote backend.
//
// FIX LOG (1.6.0):
//  - `shutdownSuccess` không được khai báo trong TRIGGER_SHUTDOWN -> ReferenceError
//    khiến fallback .bat không bao giờ chạy. Đã khai báo lại.
//  - Thiếu handler CHECK_TAB_ACTIVE: content script await mãi không có phản hồi
//    -> mainLoop treo vĩnh viễn. Đã thêm handler.
//  - Hàng đợi tên file (pendingFilenames) nằm trong RAM của service worker.
//    MV3 kill worker sau ~30s idle -> mất hàng đợi -> file tải về mất tên.
//    Đã chuyển sang chrome.storage.session (bền theo phiên browser).
//  - Tách phần mở rộng file sai khi item.filename không có dấu chấm.
//  - onDeterminingFilename không gọi suggest() nếu storage lỗi -> treo download.
//  - Message listener luôn `return true` -> mọi sendMessage của caller không bao
//    giờ resolve. Nay chỉ giữ kênh mở cho handler async thật sự.
//  - Rename input: chỉ hỗ trợ Radix portal; Flow 2025 dùng Angular Material CDK
//    overlay -> không tìm thấy ô nhập. Đã bổ sung selector CDK/mat-menu.

const NATIVE_HOST = 'com.veo.automation.native';
const FILENAME_QUEUE_KEY = 'veoPendingFilenames';
const FLOW_URL_RE = /^https:\/\/(?:[^/]+\.)?flow\.google\.com\/|^https:\/\/labs\.google(?:\.com)?\/fx\//;

let countdownInterval = null;
/** In-memory mirror of the persisted queue. Always re-read before use. */
let pendingFilenames = [];
let queueReady = null;

// ---------------------------------------------------------------- queue utils
async function loadQueue() {
    try {
        const store = chrome.storage.session || chrome.storage.local;
        const data = await store.get(FILENAME_QUEUE_KEY);
        pendingFilenames = Array.isArray(data[FILENAME_QUEUE_KEY]) ? data[FILENAME_QUEUE_KEY] : [];
    } catch (e) {
        pendingFilenames = [];
    }
    return pendingFilenames;
}

async function saveQueue() {
    try {
        const store = chrome.storage.session || chrome.storage.local;
        await store.set({ [FILENAME_QUEUE_KEY]: pendingFilenames });
    } catch (e) { /* storage full / unavailable — keep RAM copy */ }
}

function ensureQueue() {
    if (!queueReady) queueReady = loadQueue();
    return queueReady;
}
ensureQueue();

/** Mục hàng đợi cũ là chuỗi; bản 1.7 dùng {tabId, filename} để dọn theo tab. */
function normalizeQueue() {
    pendingFilenames = pendingFilenames.map((e) =>
        (e && typeof e === 'object') ? e : { tabId: null, filename: String(e) }
    );
}

// ═══════════════════════════════ ĐA TAB (1.7.0) ═══════════════════════════════
// Vì sao cần cả một lớp điều phối: mỗi tab Flow chạy một content script riêng,
// nhưng CÓ BA THỨ DÙNG CHUNG toàn trình duyệt và sẽ đánh nhau nếu chạy 2+ tab:
//   1. chrome.downloads — DownloadItem KHÔNG mang tabId, nên không thể biết file
//      vừa tải là của tab nào. => phải TUẦN TỰ HOÁ pha tải bằng một khoá chung.
//   2. Các cờ trạng thái chạy (activeRunningProject/autoResumeProject) trước đây
//      là biến đơn => sau khi bot tự F5, các tab khôi phục sai dự án của nhau.
//   3. Hạn mức tạo video của Flow tính theo TÀI KHOẢN, nên nhiều tab cùng bấm
//      "Tạo" một lúc dễ bị dồn lỗi => cần cổng giãn nhịp toàn cục.
const TABS_KEY = 'veoTabRegistry';
const LOCK_KEY = 'veoDownloadLock';
const PACE_KEY = 'veoPaceNextCreateAt';
const LOCK_TTL = 45000;   // chủ khoá phải gia hạn trước mốc này
const LOCK_MAX = 300000;  // chặn trên tuyệt đối, kể cả khi vẫn gia hạn

function sessionStore() {
    return chrome.storage.session || chrome.storage.local;
}

async function sessGet(key, fallback) {
    try {
        const data = await sessionStore().get(key);
        return (data && data[key] !== undefined) ? data[key] : fallback;
    } catch (e) { return fallback; }
}

async function sessSet(key, value) {
    try { await sessionStore().set({ [key]: value }); } catch (e) { /* noop */ }
}

/** Nối tiếp các thao tác đọc-sửa-ghi để hai tab không ghi đè nhau. */
let coordChain = Promise.resolve();
function serialize(fn) {
    const run = coordChain.then(fn, fn);
    // Không để một lỗi làm đứt chuỗi cho các lời gọi sau.
    coordChain = run.then(() => {}, () => {});
    return run;
}

async function tabExists(tabId) {
    if (!tabId) return false;
    try { await chrome.tabs.get(tabId); return true; } catch (e) { return false; }
}

async function getRegistry() {
    return await sessGet(TABS_KEY, {}) || {};
}

/** Bỏ khỏi registry những tab đã đóng (worker có thể ngủ, bỏ sót onRemoved). */
async function pruneRegistry() {
    const reg = await getRegistry();
    const ids = Object.keys(reg);
    if (!ids.length) return reg;
    const alive = await Promise.all(ids.map((id) => tabExists(Number(id))));
    let changed = false;
    ids.forEach((id, i) => { if (!alive[i]) { delete reg[id]; changed = true; } });
    if (changed) await sessSet(TABS_KEY, reg);
    return reg;
}

async function patchTab(tabId, patch) {
    if (!tabId) return null;
    return serialize(async () => {
        const reg = await getRegistry();
        const prev = reg[tabId] || { tabId };
        reg[tabId] = { ...prev, ...patch, tabId, updatedAt: Date.now() };
        await sessSet(TABS_KEY, reg);
        return reg[tabId];
    });
}

async function forgetTab(tabId) {
    return serialize(async () => {
        const reg = await getRegistry();
        delete reg[tabId];
        await sessSet(TABS_KEY, reg);

        // Dọn tên file còn treo của tab đã đóng, nếu không các file của tab khác
        // sẽ bị đặt tên lệch một nhịp.
        await loadQueue();
        normalizeQueue();
        const before = pendingFilenames.length;
        pendingFilenames = pendingFilenames.filter((e) => e.tabId !== tabId);
        if (pendingFilenames.length !== before) await saveQueue();

        // Nhả khoá tải nếu tab đóng đúng lúc đang giữ.
        const lock = await sessGet(LOCK_KEY, null);
        if (lock && lock.tabId === tabId) await sessSet(LOCK_KEY, null);

        // Xoá cờ chạy riêng của tab đó.
        try {
            const { veoRunState = {} } = await chrome.storage.local.get('veoRunState');
            if (veoRunState[tabId]) {
                delete veoRunState[tabId];
                await chrome.storage.local.set({ veoRunState });
            }
        } catch (e) { /* noop */ }
    });
}

chrome.tabs.onRemoved.addListener((tabId) => { forgetTab(tabId); });

/** Số thứ tự tab (1,2,3…) để đặt tên dự án không trùng giữa các tab. */
async function assignSlot(tabId) {
    const reg = await getRegistry();
    const used = new Set(Object.values(reg).map((t) => t.slot).filter(Boolean));
    if (reg[tabId]?.slot) return reg[tabId].slot;
    let slot = 1;
    while (used.has(slot)) slot++;
    return slot;
}

// ───────────────────────────── khoá tải xuống ─────────────────────────────
async function acquireDownloadLock(tabId) {
    return serialize(async () => {
        const now = Date.now();
        const lock = await sessGet(LOCK_KEY, null);

        if (lock && lock.tabId && lock.tabId !== tabId) {
            const stale = (now - (lock.renewedAt || lock.at || 0)) > LOCK_TTL;
            const tooOld = (now - (lock.at || 0)) > LOCK_MAX;
            const ownerAlive = stale || tooOld ? await tabExists(lock.tabId) : true;
            if (!stale && !tooOld && ownerAlive) {
                return { ok: false, ownerTabId: lock.tabId, waitMs: 1500 };
            }
            // Chủ cũ chết hoặc treo quá lâu -> thu hồi khoá.
        }

        const fresh = { tabId, at: (lock && lock.tabId === tabId) ? lock.at : now, renewedAt: now };
        await sessSet(LOCK_KEY, fresh);
        return { ok: true, ownerTabId: tabId };
    });
}

async function renewDownloadLock(tabId) {
    return serialize(async () => {
        const lock = await sessGet(LOCK_KEY, null);
        if (!lock || lock.tabId !== tabId) return { ok: false };
        lock.renewedAt = Date.now();
        await sessSet(LOCK_KEY, lock);
        return { ok: true };
    });
}

async function releaseDownloadLock(tabId) {
    return serialize(async () => {
        const lock = await sessGet(LOCK_KEY, null);
        if (lock && lock.tabId && lock.tabId !== tabId) return { ok: false, ownerTabId: lock.tabId };
        await sessSet(LOCK_KEY, null);
        return { ok: true };
    });
}

/** Ai đang giữ khoá tải -> để gửi DOWNLOAD_STARTED đúng một tab. */
async function currentLockOwner() {
    const lock = await sessGet(LOCK_KEY, null);
    if (!lock || !lock.tabId) return null;
    if ((Date.now() - (lock.renewedAt || lock.at || 0)) > LOCK_TTL) return null;
    return lock.tabId;
}

// ─────────────────────── cổng giãn nhịp thao tác "Tạo" ───────────────────────
// Đặt CHỖ trước (không chỉ đọc mốc cuối) để 3 tab hỏi cùng lúc vẫn nhận 3 mốc
// cách nhau đúng gapMs, thay vì cùng nhận waitMs = 0.
async function reserveCreateSlot(gapMs) {
    const gap = Math.max(0, Number(gapMs) || 0);
    if (!gap) return { waitMs: 0 };
    return serialize(async () => {
        const now = Date.now();
        const nextAt = Math.max(now, Number(await sessGet(PACE_KEY, 0)) || 0);
        await sessSet(PACE_KEY, nextAt + gap);
        return { waitMs: Math.max(0, nextAt - now) };
    });
}

// ------------------------------------------------------------------ lifecycle
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        // FIX (1.6.1): chỉ ghi khi CHƯA có gì. Kiểu đọc-rồi-ghi (dù có merge)
        // vẫn là read-modify-write không nguyên tử: nếu Side Panel lưu cài đặt
        // trong đúng khoảng giữa hai bước, bản ghi của nó bị xoá sạch.
        // (Đã bắt được đúng hiện tượng này khi test trên Chromium thật.)
        try {
            const { veoSettings } = await chrome.storage.local.get('veoSettings');
            if (!veoSettings) await chrome.storage.local.set({ veoSettings: { language: 'vi' } });
        } catch (e) { /* noop */ }
    }

    if (details.reason === 'update' || details.reason === 'install') {
        // Reload Flow tabs so the new content script is actually injected.
        chrome.tabs.query({}, (tabs) => {
            (tabs || []).forEach((tab) => {
                if (tab.url && FLOW_URL_RE.test(tab.url)) {
                    chrome.tabs.reload(tab.id).catch(() => {});
                }
            });
        });
    }
});

// setPanelBehavior phải gọi ở top-level: nếu chỉ gọi trong onInstalled thì
// một số phiên bản Chrome mất thiết lập sau khi worker bị kill.
if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onStartup?.addListener(() => {
    // Phiên browser mới: hàng đợi tên file, registry tab và khoá tải của phiên
    // trước đều đã vô nghĩa (tabId cũ không còn tồn tại).
    pendingFilenames = [];
    saveQueue();
    sessSet(TABS_KEY, {});
    sessSet(LOCK_KEY, null);
    sessSet(PACE_KEY, 0);
});

// ------------------------------------------------------- download file naming
function splitExtension(filename = '') {
    const base = String(filename).split(/[\\/]/).pop() || '';
    const dot = base.lastIndexOf('.');
    // Chỉ coi là phần mở rộng khi có dấu chấm KHÔNG ở đầu và đuôi <= 5 ký tự.
    if (dot > 0 && base.length - dot - 1 > 0 && base.length - dot - 1 <= 5) {
        return { stem: base.slice(0, dot), ext: base.slice(dot + 1) };
    }
    return { stem: base, ext: '' };
}

// ─────────────────────── ASCII hoá tên file (QUAN TRỌNG) ───────────────────────
// PHÁT HIỆN QUA THỰC NGHIỆM (Chromium, 1.6.1): `suggest({filename})` bị Chrome
// **âm thầm bỏ qua** nếu tên chứa BẤT KỲ ký tự ngoài ASCII — file sẽ giữ nguyên
// tên gốc của Google. Đây là lý do tên file tiếng Việt có dấu "không đổi được":
//     "01_Con_mèo_bay_trên_mây"  -> Chrome bỏ -> "download.mp4"
//     "01_Con_meo_bay_tren_may"  -> Chrome nhận
// (Chrome kiểm tra qua net::IsSafePortablePathComponent, trong đó có IsStringASCII.)
// Vì vậy tên file BẮT BUỘC phải được chuyển tự sang ASCII trước khi suggest().
const VI_MAP = {
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

function toAsciiName(input = '') {
    let s = String(input);
    // 1. Bỏ dấu tiếng Việt (bảng riêng vì NFD không tách được đ/ơ/ư ổn định).
    s = s.replace(/[À-ỹ]/g, (ch) => {
        const lower = ch.toLowerCase();
        const mapped = VI_MAP[lower];
        if (!mapped) return ch;
        return ch === lower ? mapped : mapped.toUpperCase();
    });
    // 2. Bỏ dấu các ngôn ngữ Latin khác (é, ü, ñ…) bằng NFD.
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    // 3. Mọi ký tự ngoài ASCII còn lại (CJK, emoji…) -> '_' vì Chrome sẽ từ chối.
    s = s.replace(/[^\x20-\x7E]/g, '_');
    return s;
}

// Làm sạch MỘT đoạn của đường dẫn (tên thư mục hoặc tên file, không có '/').
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
function sanitizeSegment(segment = '', maxLen = 120) {
    let s = toAsciiName(segment)
        .replace(/[<>:"/\\|?*-]/g, '_')
        .replace(/_+/g, '_')
        .trim();
    // Chrome từ chối đoạn có khoảng trắng/dấu chấm ở đầu hoặc cuối.
    s = s.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '');
    if (s.length > maxLen) s = s.slice(0, maxLen).replace(/[\s._]+$/, '');
    if (WINDOWS_RESERVED.test(s)) s = `_${s}`;
    return s;
}

/**
 * Làm sạch cả đường dẫn tương đối (cho phép thư mục con).
 * FIX (1.6.1): bản 1.6.0 thay luôn '/' thành '_' nên KHÔNG THỂ tạo thư mục con.
 * Nay làm sạch theo từng đoạn và giữ '/', đồng thời chặn '..' thoát ra ngoài
 * thư mục Downloads (Chrome sẽ từ chối cả đường dẫn nếu có).
 */
function sanitizeDownloadPath(name = '', maxDepth = 5) {
    const parts = String(name).split(/[\\/]+/);
    const out = [];
    for (const part of parts) {
        if (part === '.' || part === '..' || part === '') continue;
        const clean = sanitizeSegment(part, out.length === parts.length - 1 ? 150 : 60);
        if (clean) out.push(clean);
        if (out.length >= maxDepth) break;
    }
    if (out.length === 0) return 'flow_media';
    return out.join('/');
}

// Giữ lại tên cũ để phần còn lại của file không phải sửa.
function sanitizeForDisk(name = '') {
    return sanitizeDownloadPath(name);
}

/**
 * Thư mục lưu do người dùng chọn.
 * GIỚI HẠN CỦA CHROME: extension KHÔNG thể chọn ổ đĩa / đường dẫn tuyệt đối.
 * `suggest()` chỉ nhận đường dẫn TƯƠNG ĐỐI so với thư mục Tải xuống mặc định.
 * Nên ở đây chỉ nhận thư mục con, và cắt bỏ mọi tiền tố kiểu "C:\", "/home/...".
 * Hỗ trợ 2 biến: {date} = ngày hôm nay, {project} = tên dự án đang chạy.
 */
function sanitizeSubfolder(raw, settings) {
    if (!raw) return '';
    let s = String(raw).trim();
    if (!s) return '';

    // Bỏ đường dẫn tuyệt đối (Windows "D:\", UNC "\\\\server", POSIX "/home").
    s = s.replace(/^[a-zA-Z]:[\\/]+/, '').replace(/^[\\/]+/, '');

    const today = new Date();
    const dateStr = [today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, '0'),
        String(today.getDate()).padStart(2, '0')].join('-');
    s = s.replace(/\{date\}/gi, dateStr)
         .replace(/\{project\}/gi, settings?.activeProjectName || 'Project');

    const clean = sanitizeDownloadPath(s, 4);
    return clean === 'flow_media' ? '' : clean;
}

function notifyFlowTabs(payload) {
    chrome.tabs.query({}, (tabs) => {
        (tabs || []).forEach((tab) => {
            if (!tab.id) return;
            if (tab.url && !FLOW_URL_RE.test(tab.url)) return;
            chrome.tabs.sendMessage(tab.id, payload).catch(() => {});
        });
    });
}

/**
 * Gửi tin về tải xuống cho ĐÚNG tab đang giữ khoá tải.
 * Chạy nhiều tab mà phát tán cho tất cả thì tab nào cũng tưởng file là của mình
 * (hai tab có thể sinh cùng một tên khi đặt tên theo số thứ tự) -> báo sai.
 */
function notifyDownloadTab(preferredTabId, payload) {
    if (preferredTabId) {
        chrome.tabs.sendMessage(preferredTabId, payload).catch(() => notifyFlowTabs(payload));
        return;
    }
    notifyFlowTabs(payload);
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    // suggest() PHẢI được gọi đúng một lần, kể cả khi có lỗi, nếu không
    // download sẽ treo vĩnh viễn ở trạng thái "đang xác định tên".
    let answered = false;
    const answer = (filename) => {
        if (answered) return;
        answered = true;
        try {
            suggest({ filename, conflictAction: 'uniquify' });
        } catch (e) {
            try { suggest(); } catch (_) {}
        }
    };
    const safety = setTimeout(() => answer(item.filename), 8000);

    // Tệp của phép thử "hỏi vị trí lưu": tuyệt đối KHÔNG lấy tên từ hàng đợi,
    // nếu không sẽ ăn mất tên của video kế tiếp.
    if (probeUrlInFlight && item.url === probeUrlInFlight) {
        clearTimeout(safety);
        answer(item.filename);
        return true;
    }

    ensureQueue()
        .then(() => Promise.all([loadQueue(), chrome.storage.local.get('veoSettings'), currentLockOwner()]))
        .then(([, { veoSettings }, lockOwner]) => {
            normalizeQueue();
            let finalName = item.filename;
            const subfolder = sanitizeSubfolder(veoSettings?.downloadSubfolder, veoSettings);

            if (pendingFilenames.length > 0) {
                // Pha tải đã được tuần tự hoá bằng khoá, nên mục đầu hàng đợi
                // chắc chắn thuộc tab đang giữ khoá; vẫn ưu tiên mục của chủ
                // khoá để an toàn khi khoá vừa bị thu hồi.
                let pos = 0;
                if (lockOwner) {
                    const owned = pendingFilenames.findIndex((e) => e.tabId === lockOwner);
                    if (owned >= 0) pos = owned;
                }
                const entry = pendingFilenames.splice(pos, 1)[0];
                const nextName = entry.filename;
                const ownerTabId = entry.tabId || lockOwner || null;
                saveQueue();

                if (nextName === '__SKIP_RENAME__') {
                    notifyDownloadTab(ownerTabId, { action: 'DOWNLOAD_STARTED', filename: '__SKIP_RENAME__' });
                    // Vẫn xếp vào thư mục con nếu người dùng đã chọn.
                    if (subfolder) {
                        const base = String(item.filename).split(/[\\/]/).pop();
                        finalName = `${subfolder}/${sanitizeDownloadPath(base)}`;
                    }
                } else {
                    const { ext } = splitExtension(item.filename);
                    let stem = sanitizeDownloadPath(nextName);
                    if (subfolder && !stem.includes('/')) stem = `${subfolder}/${stem}`;
                    finalName = ext
                        ? (stem.toLowerCase().endsWith(`.${ext.toLowerCase()}`) ? stem : `${stem}.${ext}`)
                        : stem;
                    notifyDownloadTab(ownerTabId, { action: 'DOWNLOAD_STARTED', filename: nextName, appliedAs: finalName });
                }
            } else if (subfolder) {
                // Không có tên trong hàng đợi nhưng vẫn muốn gom vào thư mục con.
                const base = String(item.filename).split(/[\\/]/).pop();
                finalName = `${subfolder}/${sanitizeDownloadPath(base)}`;
            }

            clearTimeout(safety);
            answer(finalName);
        })
        .catch(() => {
            clearTimeout(safety);
            answer(item.filename);
        });

    return true; // async suggest
});

chrome.downloads.onChanged.addListener((delta) => {
    if (!delta.state || delta.state.current !== 'complete') return;
    chrome.downloads.search({ id: delta.id }, (results) => {
        const item = results && results[0];
        if (!item) return;
        const url = item.url || '';
        const referrer = item.referrer || '';
        const finalUrl = item.finalUrl || '';
        const looksLikeFlow =
            url.includes('googleusercontent.com') ||
            finalUrl.includes('googleusercontent.com') ||
            referrer.includes('labs.google') ||
            referrer.includes('flow.google.com') ||
            url.startsWith('blob:');
        if (!looksLikeFlow) return;
        const basename = String(item.filename || '').split(/[\\/]/).pop();
        currentLockOwner().then((owner) => {
            notifyDownloadTab(owner, { action: 'DOWNLOAD_COMPLETE', filename: basename });
        });
    });
});

// ============================ MAIN-WORLD INJECTED FUNCTIONS ==================
// Content scripts chạy ở isolated world nên event có isTrusted=false, Slate /
// ProseMirror / React bỏ qua. Ta phải inject vào world MAIN.

async function mainWorldPaste(textToInsert) {
    try {
        let editorEl = null;

        const pickVisible = (nodes) => {
            for (const ed of nodes) {
                if (ed.closest('[role="article"]')) continue;
                const r = ed.getBoundingClientRect();
                if (ed.offsetParent !== null || (r.width > 0 && r.height > 0)) return ed;
            }
            return null;
        };

        editorEl = pickVisible(document.querySelectorAll('.ProseMirror[contenteditable="true"]'));

        if (!editorEl) {
            editorEl = pickVisible(document.querySelectorAll(
                'div[data-slate-editor="true"][contenteditable="true"][aria-multiline="true"], ' +
                'div[data-slate-editor="true"][contenteditable="true"][zindex="-1"], ' +
                'div[data-slate-editor="true"][role="textbox"][contenteditable="true"]'
            ));
        }

        if (!editorEl) return { ok: false, error: 'Prompt editor not found' };

        editorEl.click();
        editorEl.focus();
        await new Promise(r => setTimeout(r, 150));

        const range = document.createRange();
        range.selectNodeContents(editorEl);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        await new Promise(r => setTimeout(r, 50));

        // Prompt nhiều dòng: dùng ClipboardEvent paste để editor tự tách đoạn,
        // execCommand('insertText') với '\n' hay bị editor bỏ qua ký tự newline.
        const isMultiline = /\r|\n/.test(textToInsert);

        const pasteViaClipboard = () => {
            const dt = new DataTransfer();
            dt.setData('text/plain', textToInsert);
            const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
            return editorEl.dispatchEvent(ev);
        };

        if (editorEl.classList.contains('ProseMirror')) {
            let ok = false;
            if (!isMultiline) ok = document.execCommand('insertText', false, textToInsert);
            if (!ok) pasteViaClipboard();
        } else {
            if (isMultiline) {
                pasteViaClipboard();
                await new Promise(r => setTimeout(r, 120));
            }
            if (!isMultiline || (editorEl.textContent || '').trim().length === 0) {
                editorEl.dispatchEvent(new InputEvent('beforeinput', {
                    bubbles: true, cancelable: true,
                    inputType: 'insertReplacementText', data: textToInsert
                }));
                await new Promise(r => setTimeout(r, 100));

                if (editorEl.querySelector('[data-slate-zero-width]')) {
                    editorEl.dispatchEvent(new InputEvent('beforeinput', {
                        bubbles: true, cancelable: true,
                        inputType: 'insertText', data: textToInsert
                    }));
                    await new Promise(r => setTimeout(r, 100));
                }
            }
        }

        editorEl.dispatchEvent(new Event('input', { bubbles: true }));
        editorEl.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise(r => setTimeout(r, 60));

        const hasZeroWidth = !!editorEl.querySelector('[data-slate-zero-width]');
        const editorText = editorEl.textContent || '';
        const normalize = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
        const expected = normalize(textToInsert);
        const got = normalize(editorText);
        // So khớp 60 ký tự đầu là đủ tin cậy mà không phụ thuộc độ dài prompt.
        const probe = expected.slice(0, 60);
        const matched = probe.length === 0 ? true : got.includes(probe);

        return {
            ok: !hasZeroWidth && matched,
            hasZeroWidth,
            matched,
            editorLength: editorText.length,
            expectedLength: textToInsert.length,
            method: isMultiline ? 'clipboard-paste' : 'insertText/beforeinput'
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function mainWorldClickCreate() {
    try {
        let btn = null;

        const newBtn = document.querySelector('button.generate-icon-button');
        if (newBtn && newBtn.offsetParent !== null && !newBtn.closest('[role="article"]')) {
            btn = newBtn;
        }

        if (!btn) {
            let editorEl = null;
            const allEditors = document.querySelectorAll(
                '.ProseMirror[contenteditable="true"], ' +
                'div[data-slate-editor="true"][aria-multiline="true"], ' +
                'div[data-slate-editor="true"][zindex="-1"]'
            );
            for (const ed of allEditors) {
                if (!ed.closest('[role="article"]') && ed.offsetParent !== null) { editorEl = ed; break; }
            }

            if (editorEl) {
                let container = editorEl.parentElement;
                for (let i = 0; i < 15 && container && !btn; i++) {
                    const iconEls = container.querySelectorAll('i.google-symbols, i[class*="google-symbols"], mat-icon');
                    for (const icon of iconEls) {
                        if (icon.textContent.trim() === 'arrow_forward') {
                            const candidate = icon.closest('button');
                            if (candidate && candidate.offsetParent !== null) { btn = candidate; break; }
                        }
                    }
                    container = container.parentElement;
                }
            }

            if (!btn) {
                const iconEls = document.querySelectorAll('i.google-symbols, i[class*="google-symbols"], mat-icon');
                for (const icon of iconEls) {
                    if (icon.textContent.trim() === 'arrow_forward') {
                        const candidate = icon.closest('button');
                        if (candidate && candidate.offsetParent !== null && !candidate.closest('[role="article"]')) {
                            btn = candidate; break;
                        }
                    }
                }
            }
        }

        if (!btn) return { ok: false, error: 'Create button not found' };

        const style = window.getComputedStyle(btn);
        const isDisabled = btn.disabled ||
            btn.getAttribute('aria-disabled') === 'true' ||
            style.pointerEvents === 'none' ||
            parseFloat(style.opacity) < 0.5;

        // Chỉ dùng MỘT cơ chế click: nếu bắn cả .click() + MouseEvent + Keyboard
        // thì Flow submit 3-4 lần cho cùng một prompt.
        let reactClicked = false;
        try {
            const invokeReact = (el) => {
                for (const key in el) {
                    if (key.startsWith('__reactProps$') || key.startsWith('__reactEventHandlers$')) {
                        const props = el[key];
                        if (props && typeof props.onClick === 'function') {
                            props.onClick({
                                preventDefault() {}, stopPropagation() {},
                                nativeEvent: { isTrusted: true }, isTrusted: true,
                                type: 'click', target: el, currentTarget: el
                            });
                            reactClicked = true;
                            return true;
                        }
                    }
                }
                return false;
            };
            if (!invokeReact(btn)) {
                const iconEl = btn.querySelector('i, svg, mat-icon');
                if (iconEl) invokeReact(iconEl);
            }
        } catch (e) { /* noop */ }

        if (!reactClicked) {
            btn.focus();
            btn.click();
        }

        return { ok: true, wasDisabled: isDisabled, method: reactClicked ? 'react-fiber-onClick' : 'native-click' };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function mainWorldRenameInput(nameToSet) {
    try {
        const isVisible = (el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        };

        // Flow 2025 dùng Angular Material CDK overlay; bản cũ dùng Radix portal.
        // Phải quét CẢ HAI, nếu không rename luôn thất bại trên UI mới.
        const OVERLAY_SELECTORS = [
            '[data-radix-popper-content-wrapper]',
            '.cdk-overlay-pane',
            '.mat-mdc-menu-panel',
            '.mat-mdc-dialog-container',
            '[role="dialog"]',
            '[role="menu"]'
        ];
        const overlays = [];
        for (const sel of OVERLAY_SELECTORS) {
            document.querySelectorAll(sel).forEach(el => { if (!overlays.includes(el)) overlays.push(el); });
        }

        let input = null;
        let inputDebug = '';

        for (const ov of overlays) {
            const candidate = ov.querySelector('input[type="text"], input:not([type]), textarea');
            if (candidate && isVisible(candidate)) {
                input = candidate;
                inputDebug = `overlay:${ov.className || ov.tagName}`;
                break;
            }
        }

        if (!input) {
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && isVisible(activeEl)) {
                input = activeEl;
                inputDebug = 'activeElement';
            }
        }

        if (!input) {
            const candidates = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'))
                .filter(isVisible)
                .filter(inp => inp.getBoundingClientRect().top > 100)
                .filter(inp => {
                    const ph = (inp.getAttribute('placeholder') || '').toLowerCase();
                    const al = (inp.getAttribute('aria-label') || '').toLowerCase();
                    const bad = ['search', 'tìm kiếm', 'tim kiem'];
                    return !bad.some(w => ph.includes(w) || al.includes(w));
                });
            if (candidates.length > 0) {
                input = candidates[0];
                inputDebug = 'below-header';
            }
        }

        if (!input) return { ok: false, error: 'Không tìm thấy ô nhập tên (rename input)' };

        const container = overlays.find(ov => ov.contains(input)) || input.parentElement;

        // React/Angular chỉ hiện nút ✓ khi có hover -> dùng chính handler của
        // framework, không spam native event (gây treo UI).
        let el = input.parentElement;
        while (el && el !== document.body) {
            const pk = Object.keys(el).find(k => k.startsWith('__reactProps$'));
            if (pk) {
                const rp = el[pk];
                const opts = { bubbles: false, cancelable: true, type: 'pointerenter' };
                if (rp?.onPointerEnter) rp.onPointerEnter(opts);
                else if (rp?.onMouseEnter) rp.onMouseEnter({ ...opts, type: 'mouseenter' });
            }
            try { el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); } catch (_) {}
            if (el === container) break;
            el = el.parentElement;
        }
        await new Promise(r => setTimeout(r, 300));

        const ir = input.getBoundingClientRect();
        const cOpts = {
            view: window, bubbles: true, cancelable: true,
            clientX: ir.left + ir.width - 8, clientY: ir.top + ir.height / 2
        };
        input.dispatchEvent(new PointerEvent('pointerdown', { ...cOpts, button: 0, buttons: 1 }));
        input.dispatchEvent(new MouseEvent('mousedown', { ...cOpts, button: 0, buttons: 1 }));
        input.focus();
        input.dispatchEvent(new PointerEvent('pointerup', { ...cOpts, button: 0, buttons: 0 }));
        input.dispatchEvent(new MouseEvent('mouseup', { ...cOpts, button: 0, buttons: 0 }));
        input.dispatchEvent(new MouseEvent('click', { ...cOpts, button: 0, buttons: 0 }));
        await new Promise(r => setTimeout(r, 180));

        let method = '';
        try {
            input.select();
            const ok = document.execCommand('insertText', false, nameToSet);
            await new Promise(r => setTimeout(r, 180));
            if (ok && input.value === nameToSet) method = 'execCommand';
        } catch (_) {}

        if (!method) {
            const proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (nativeSetter) nativeSetter.call(input, nameToSet);
            else input.value = nameToSet;
            input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: nameToSet }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(r => setTimeout(r, 180));
            method = 'nativeSetter';
        }

        if (input.value !== nameToSet) {
            return { ok: false, error: `Không đặt được giá trị (hiện tại: "${input.value}")` };
        }

        // --- Xác nhận: tìm nút ✓ / Lưu trong cùng overlay ---
        let confirmed = false;
        let confirmVia = '';
        const scope = container || document;
        const btns = Array.from(scope.querySelectorAll('button, [role="button"]'));

        for (const b of btns) {
            b.style.setProperty('opacity', '1', 'important');
            b.style.setProperty('visibility', 'visible', 'important');
            b.style.setProperty('pointer-events', 'auto', 'important');
        }

        let targetBtn = null;
        for (const b of btns) {
            const txt = (b.textContent || '').trim().toLowerCase();
            const lbl = (b.getAttribute('aria-label') || '').toLowerCase();
            if (['check', 'done', 'check_circle', 'lưu', 'luu', 'save', 'ok', 'xong'].includes(txt)) {
                targetBtn = b; confirmVia = `text:${txt}`; break;
            }
            if (/confirm|save|rename|đổi tên|doi ten|lưu|apply/.test(lbl)) {
                targetBtn = b; confirmVia = `aria:${lbl}`; break;
            }
            const icon = b.querySelector('i, mat-icon, .google-symbols');
            const it = icon ? (icon.textContent || '').trim().toLowerCase() : '';
            if (it === 'check' || it === 'done' || it === 'check_circle') {
                targetBtn = b; confirmVia = `icon:${it}`; break;
            }
        }

        if (!targetBtn) {
            const inputRight = input.getBoundingClientRect().right;
            for (const b of btns) {
                const r = b.getBoundingClientRect();
                if (r.width > 0 && r.left > inputRight - 6) { targetBtn = b; confirmVia = 'position-right'; break; }
            }
        }

        if (targetBtn) {
            try { targetBtn.click(); confirmed = true; await new Promise(r => setTimeout(r, 350)); }
            catch (e) { confirmVia = `click-error:${e.message}`; }
        }

        if (!confirmed) {
            // Enter là fallback cuối: nhiều dialog rename của Flow submit bằng Enter.
            for (const type of ['keydown', 'keypress', 'keyup']) {
                input.dispatchEvent(new KeyboardEvent(type, {
                    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
                }));
            }
            confirmVia = 'fallback-enter';
            await new Promise(r => setTimeout(r, 350));
            confirmed = true;
        }

        return { ok: true, method, inputDebug, confirmed, confirmVia, value: nameToSet };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/* ═══════════════ KIỂM TRA SETTING "HỎI VỊ TRÍ LƯU MỖI TỆP" ═══════════════
 * Chrome KHÔNG cung cấp API đọc pref `download.prompt_for_download`, nên ta
 * phải suy ra bằng một phép thử: tải một tệp text 22 byte từ data: URL.
 *
 * Số liệu hiệu chỉnh đo thực tế trên Chromium (xem README):
 *   - Khi KHÔNG hỏi vị trí: download đạt state='complete' và có filename
 *     trong ~22-50ms.
 *   - Khi ĐANG hỏi vị trí: Chrome dừng ở bước xác định đích, item giữ
 *     state='in_progress', filename RỖNG, KHÔNG có error, cho tới khi người
 *     dùng chọn xong.
 *   - Khi download bị chặn vì lý do khác: state='interrupted' và CÓ error
 *     (ví dụ USER_CANCELED, FILE_ACCESS_DENIED) -> phải phân biệt, nếu không
 *     sẽ báo nhầm là "đang bật".
 */
let probeUrlInFlight = null;

async function probeSaveAsPrompt() {
    const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const url = 'data:text/plain;charset=utf-8,' + encodeURIComponent('flow-automation-check-' + nonce);
    probeUrlInFlight = url;

    let id;
    try {
        id = await new Promise((res, rej) => {
            // KHÔNG truyền saveAs -> để pref của Chrome tự quyết định.
            chrome.downloads.download({ url, filename: 'flow_automation_check.txt' }, (dlId) => {
                if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
                else res(dlId);
            });
        });
    } catch (e) {
        probeUrlInFlight = null;
        return { status: 'unknown', reason: `Không tạo được phép thử: ${e.message}` };
    }

    const read = () => new Promise(r => chrome.downloads.search({ id }, (items) => r(items && items[0])));

    let verdict = null;
    let last = null;
    const DEADLINE = 2600;
    const PROMPT_AFTER = 1400;     // gấp ~28 lần thời gian hoàn tất bình thường (~50ms)
    const HUMAN_CANCEL_MS = 600;   // ngưỡng "có bàn tay con người" cho USER_CANCELED
    const t0 = Date.now();

    while (Date.now() - t0 < DEADLINE) {
        const it = await read();
        last = it;
        if (!it) { await new Promise(r => setTimeout(r, 100)); continue; }

        if (it.state === 'complete' || (it.filename && it.filename.length > 0)) {
            verdict = { status: 'off' };
            break;
        }
        if (it.state === 'interrupted') {
            const elapsed = Date.now() - t0;
            // USER_CANCELED có HAI nguyên nhân rất khác nhau:
            //  a) người dùng bấm Cancel trên hộp thoại chọn nơi lưu  -> setting ĐANG BẬT
            //  b) download bị chặn từ gốc (chính sách, phần mềm diệt virus,
            //     hoặc trình duyệt đang bị điều khiển tự động)        -> KHÔNG kết luận được
            // Phân biệt bằng THỜI GIAN: trường hợp (b) trả về sau ~10ms, trong
            // khi không người nào tắt được hộp thoại dưới 600ms.
            // (Đã kiểm chứng: Chromium bị chặn download trả USER_CANCELED sau 10ms.)
            if (it.error === 'USER_CANCELED' && elapsed >= HUMAN_CANCEL_MS) {
                verdict = { status: 'on', note: 'Phép thử bị hủy sau ' + Math.round(elapsed) + 'ms — gần như chắc chắn bạn đã đóng hộp thoại chọn nơi lưu.' };
            } else {
                verdict = {
                    status: 'unknown',
                    reason: `Download bị ngắt sau ${Math.round(elapsed)}ms (${it.error || 'không rõ'}) — có thể do chính sách máy, phần mềm bảo mật hoặc trình duyệt đang bị điều khiển tự động.`
                };
            }
            break;
        }
        if (it.state === 'in_progress' && !it.filename && !it.error && Date.now() - t0 > PROMPT_AFTER) {
            verdict = { status: 'on' };
            break;
        }
        await new Promise(r => setTimeout(r, 100));
    }

    if (!verdict) {
        verdict = last && last.state === 'in_progress' && !last.filename
            ? { status: 'on' }
            : { status: 'unknown', reason: `Hết thời gian chờ (state=${last?.state || 'không rõ'}).` };
    }

    // ── Dọn dẹp: hủy nếu còn treo, xoá tệp thật, xoá khỏi lịch sử tải ──
    try {
        const it = await read();
        if (it && it.state === 'in_progress') await new Promise(r => chrome.downloads.cancel(id, () => r()));
        if (it && it.state === 'complete') await new Promise(r => chrome.downloads.removeFile(id, () => { void chrome.runtime.lastError; r(); }));
        await new Promise(r => chrome.downloads.erase({ id }, () => r()));
    } catch (e) { /* dọn dẹp là best-effort */ }

    probeUrlInFlight = null;
    return verdict;
}

function runInMainWorld(tabId, func, args, sendResponse) {
    chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args })
        .then((results) => sendResponse(results?.[0]?.result || { ok: false, error: 'Script injection failed' }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
}

// ================================ MESSAGE ROUTER ==============================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const action = message?.action;

    // ---- FIX: trước đây thiếu handler này nên content script await mãi
    // (chrome.runtime.sendMessage không bao giờ resolve) -> mainLoop treo cứng.
    if (action === 'CHECK_TAB_ACTIVE') {
        const tabId = sender.tab?.id;
        if (!tabId) { sendResponse(true); return false; }
        chrome.tabs.get(tabId)
            .then((tab) => sendResponse(!!tab && tab.active !== false))
            .catch(() => sendResponse(true));
        return true;
    }

    if (action === 'SET_NEXT_FILENAME') {
        const owner = sender.tab?.id || message.tabId || null;
        ensureQueue().then(loadQueue).then(() => {
            normalizeQueue();
            pendingFilenames.push({ tabId: owner, filename: message.filename });
            return saveQueue();
        }).then(() => sendResponse({ success: true, queueSize: pendingFilenames.length }))
          .catch((e) => sendResponse({ success: false, error: e.message }));
        return true;
    }

    // Dùng khi một thẻ bị bỏ qua (sai định dạng) sau khi đã đăng ký tên file:
    // nếu không rút tên ra khỏi hàng đợi thì TẤT CẢ file sau đó bị lệch tên.
    if (action === 'UNSET_NEXT_FILENAME') {
        const owner = sender.tab?.id || message.tabId || null;
        ensureQueue().then(loadQueue).then(() => {
            normalizeQueue();
            // Chỉ rút tên CỦA CHÍNH TAB ĐÓ, không được chạm hàng đợi tab khác.
            for (let i = pendingFilenames.length - 1; i >= 0; i--) {
                const e = pendingFilenames[i];
                if (e.filename === message.filename && (!owner || !e.tabId || e.tabId === owner)) {
                    pendingFilenames.splice(i, 1);
                    break;
                }
            }
            return saveQueue();
        }).then(() => sendResponse({ success: true, queueSize: pendingFilenames.length }))
          .catch((e) => sendResponse({ success: false, error: e.message }));
        return true;
    }

    // ───────────────────────── ĐA TAB (1.7.0) ─────────────────────────
    if (action === 'REGISTER_TAB') {
        const tabId = sender.tab?.id || null;
        if (!tabId) { sendResponse({ ok: false, error: 'No tab context' }); return false; }
        pruneRegistry()
            .then(() => assignSlot(tabId))
            .then((slot) => patchTab(tabId, {
                slot,
                windowId: sender.tab?.windowId || null,
                url: sender.tab?.url || '',
                title: sender.tab?.title || '',
                running: false
            }))
            .then((entry) => sendResponse({ ok: true, tabId, slot: entry?.slot || 1, windowId: entry?.windowId || null }))
            .catch((e) => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    if (action === 'TAB_STATUS') {
        const tabId = sender.tab?.id || message.tabId || null;
        if (!tabId) { sendResponse({ ok: false }); return false; }
        patchTab(tabId, {
            ...(message.data || {}),
            url: sender.tab?.url || undefined,
            title: sender.tab?.title || undefined,
            windowId: sender.tab?.windowId || undefined
        }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
        return true;
    }

    // Side Panel gọi để vẽ danh sách tab Flow + tiến độ từng tab.
    if (action === 'LIST_FLOW_TABS') {
        Promise.all([
            new Promise((r) => chrome.tabs.query({}, (t) => r(t || []))),
            pruneRegistry(),
            sessGet(LOCK_KEY, null)
        ]).then(([tabs, reg, lock]) => {
            const out = tabs
                .filter((t) => t.id && t.url && FLOW_URL_RE.test(t.url))
                .map((t) => {
                    const r = reg[t.id] || {};
                    return {
                        tabId: t.id,
                        windowId: t.windowId,
                        active: !!t.active,
                        title: t.title || t.url,
                        url: t.url,
                        ready: !!reg[t.id],
                        slot: r.slot || null,
                        projectName: r.projectName || '',
                        running: !!r.running,
                        phase: r.phase || '',
                        total: r.total || 0,
                        done: r.done || 0,
                        creating: r.creating || 0,
                        error: r.error || 0,
                        hidden: !!r.hidden,
                        throttled: !!r.throttled,
                        updatedAt: r.updatedAt || 0,
                        holdsDownloadLock: !!(lock && lock.tabId === t.id)
                    };
                })
                .sort((a, b) => (a.windowId - b.windowId) || (a.tabId - b.tabId));
            sendResponse({ ok: true, tabs: out });
        }).catch((e) => sendResponse({ ok: false, error: e.message, tabs: [] }));
        return true;
    }

    if (action === 'ACQUIRE_DOWNLOAD_LOCK') {
        const tabId = sender.tab?.id || message.tabId || null;
        if (!tabId) { sendResponse({ ok: true }); return false; }
        acquireDownloadLock(tabId).then(sendResponse).catch(() => sendResponse({ ok: true }));
        return true;
    }

    if (action === 'RENEW_DOWNLOAD_LOCK') {
        const tabId = sender.tab?.id || message.tabId || null;
        renewDownloadLock(tabId).then(sendResponse).catch(() => sendResponse({ ok: false }));
        return true;
    }

    if (action === 'RELEASE_DOWNLOAD_LOCK') {
        const tabId = sender.tab?.id || message.tabId || null;
        releaseDownloadLock(tabId).then(sendResponse).catch(() => sendResponse({ ok: false }));
        return true;
    }

    if (action === 'ACQUIRE_CREATE_SLOT') {
        reserveCreateSlot(message.gapMs)
            .then(sendResponse)
            .catch(() => sendResponse({ waitMs: 0 }));
        return true;
    }

    // Tắt máy chỉ được phép khi MỌI tab đã xong, nếu không tab xong trước sẽ
    // tắt máy giữa lúc các tab khác đang chạy.
    if (action === 'CAN_SHUTDOWN') {
        const tabId = sender.tab?.id || message.tabId || null;
        pruneRegistry().then((reg) => {
            const others = Object.values(reg).filter((t) => t.tabId !== tabId && t.running);
            sendResponse({
                ok: others.length === 0,
                waiting: others.map((t) => ({ tabId: t.tabId, slot: t.slot, done: t.done, total: t.total }))
            });
        }).catch(() => sendResponse({ ok: true, waiting: [] }));
        return true;
    }

    // Nút "Mở thêm cửa sổ Flow" trong Side Panel.
    if (action === 'OPEN_FLOW_WINDOW') {
        const url = FLOW_URL_RE.test(String(message.url || '')) ? message.url : 'https://labs.google/fx/vi/tools/flow';
        chrome.windows.create({ url, focused: true })
            .then((w) => sendResponse({ ok: true, windowId: w?.id || null }))
            .catch((e) => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    if (action === 'PROBE_SAVE_AS_PROMPT') {
        probeSaveAsPrompt()
            .then(sendResponse)
            .catch((e) => sendResponse({ status: 'unknown', reason: e.message }));
        return true;
    }

    if (action === 'OPEN_DOWNLOAD_SETTINGS') {
        // Đã kiểm chứng: extension MỞ ĐƯỢC chrome://settings/downloads bằng tabs.create
        // (tabs.update sang chrome:// thì bị chặn).
        chrome.tabs.create({ url: 'chrome://settings/downloads' })
            .then(() => sendResponse({ success: true }))
            .catch((e) => sendResponse({ success: false, error: e.message }));
        return true;
    }

    if (action === 'CLEAR_FILENAME_QUEUE') {
        // 1.7.0: CHỈ xoá tên của tab gọi. Bản cũ xoá sạch hàng đợi nên khi tab
        // thứ hai bắt đầu chạy, nó cuốn luôn tên file đang chờ của tab thứ nhất.
        const owner = sender.tab?.id || message.tabId || null;
        const all = message.all === true || !owner;
        ensureQueue().then(loadQueue).then(() => {
            normalizeQueue();
            pendingFilenames = all ? [] : pendingFilenames.filter((e) => e.tabId !== owner);
            return saveQueue();
        }).then(() => sendResponse({ success: true, queueSize: pendingFilenames.length }))
          .catch(() => sendResponse({ success: false }));
        return true;
    }

    if (action === 'SET_TAB_ZOOM') {
        const zoom = parseFloat(message.zoom || 0.8) || 0.8;
        const targetTabId = message.tabId || sender.tab?.id || null;
        if (targetTabId) {
            chrome.tabs.setZoom(targetTabId, zoom)
                .then(() => sendResponse({ success: true, zoom }))
                .catch(() => sendResponse({ success: false }));
            return true;
        }
        chrome.tabs.query({ url: ['*://flow.google.com/*', '*://*.flow.google.com/*', '*://labs.google/*'] }, (tabs) => {
            if (tabs && tabs.length) {
                tabs.forEach(t => chrome.tabs.setZoom(t.id, zoom).catch(() => {}));
                sendResponse({ success: true, zoom });
            } else {
                sendResponse({ success: false });
            }
        });
        return true;
    }

    if (action === 'CLOSE_CURRENT_TAB') {
        if (sender.tab?.id) chrome.tabs.remove(sender.tab.id).catch(() => {});
        sendResponse({ success: true });
        return false;
    }

    if (action === 'TEST_NATIVE_HOST') {
        let replied = false;
        const reply = (payload) => { if (!replied) { replied = true; sendResponse(payload); } };
        try {
            const port = chrome.runtime.connectNative(NATIVE_HOST);
            const timer = setTimeout(() => {
                reply({ success: false, error: 'Không có phản hồi từ Native Host (timeout 8s).' });
                try { port.disconnect(); } catch (_) {}
            }, 8000);

            port.onMessage.addListener(() => {
                clearTimeout(timer);
                reply({ success: true, message: 'Native Host phản hồi bình thường.' });
                try { port.disconnect(); } catch (_) {}
            });

            port.onDisconnect.addListener(() => {
                clearTimeout(timer);
                const error = chrome.runtime.lastError;
                if (!error) { reply({ success: false, error: 'Native Host đóng kết nối mà không trả lời.' }); return; }
                let msg = 'Kết nối thất bại: ';
                if (error.message.includes('Specified native messaging host not found')) msg += 'Chưa cài Native Host (chạy install_native_host.ps1)';
                else if (error.message.includes('Access is denied')) msg += 'Bị chặn quyền — chạy script với quyền Administrator';
                else if (error.message.includes('forbidden') || error.message.includes('Invalid extension ID')) msg += 'Extension ID không khớp — cài lại Native Host với ID hiện tại';
                else msg += error.message;
                reply({ success: false, error: msg });
            });

            port.postMessage({ action: 'ping' });
        } catch (error) {
            reply({ success: false, error: error.message });
        }
        return true;
    }

    if (action === 'TRIGGER_SHUTDOWN') {
        const delay = message.data?.delay || 60;
        // FIX: biến này trước đây không được khai báo trong scope -> đọc nó
        // trong onDisconnect gây ReferenceError, fallback .bat không bao giờ chạy.
        let shutdownSuccess = false;

        let remaining = delay;
        if (countdownInterval) clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            remaining -= 10;
            if (remaining > 0) {
                chrome.runtime.sendMessage({
                    action: 'LOG', type: 'warning',
                    message: `⏱️ Sẽ tắt máy sau ${remaining}s... (chạy "shutdown /a" để hủy)`
                }).catch(() => {});
            } else {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
        }, 10000);

        try {
            chrome.runtime.sendMessage({ action: 'LOG', type: 'info', message: '🔌 Đang kết nối Native Host...' }).catch(() => {});
            const port = chrome.runtime.connectNative(NATIVE_HOST);

            port.onMessage.addListener((response) => {
                if (response?.success) {
                    shutdownSuccess = true;
                    chrome.notifications.create({
                        type: 'basic', iconUrl: 'icons/icon128.png',
                        title: 'Flow Automation hoàn tất ✅',
                        message: `Đã xong toàn bộ prompt. Máy sẽ tắt sau ${delay}s. Chạy "shutdown /a" để hủy.`,
                        priority: 2
                    }, () => void chrome.runtime.lastError);
                    chrome.runtime.sendMessage({ action: 'LOG', type: 'success', message: '✅ Đã lên lịch tắt máy qua Native Host.' }).catch(() => {});
                } else if (response?.error) {
                    chrome.runtime.sendMessage({ action: 'LOG', type: 'error', message: `❌ Native Host lỗi: ${response.error}` }).catch(() => {});
                    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
                    fallbackShutdownBatch(delay);
                }
            });

            port.onDisconnect.addListener(() => {
                const error = chrome.runtime.lastError;
                if (error && !shutdownSuccess) {
                    let msg = '❌ Không kết nối được Native Host: ';
                    if (error.message.includes('Specified native messaging host not found')) msg += 'chưa cài hoặc chưa đăng ký Registry';
                    else if (error.message.includes('Access is denied')) msg += 'thiếu quyền — chạy lại script cài đặt với quyền Admin';
                    else if (error.message.includes('Invalid extension ID')) msg += 'Extension ID không khớp';
                    else msg += error.message;
                    chrome.runtime.sendMessage({ action: 'LOG', type: 'error', message: msg }).catch(() => {});
                    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
                    fallbackShutdownBatch(delay);
                }
            });

            port.postMessage({ action: 'shutdown', delay });
        } catch (error) {
            chrome.runtime.sendMessage({ action: 'LOG', type: 'error', message: `❌ Lỗi kết nối Native Host: ${error.message}` }).catch(() => {});
            if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
            fallbackShutdownBatch(delay);
        }
        sendResponse({ success: true });
        return false;
    }

    if (action === 'CANCEL_SHUTDOWN') {
        if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
        let replied = false;
        const reply = (p) => { if (!replied) { replied = true; sendResponse(p); } };
        try {
            const port = chrome.runtime.connectNative(NATIVE_HOST);
            const timer = setTimeout(() => reply({ success: false, error: 'timeout' }), 8000);
            port.onMessage.addListener((response) => {
                clearTimeout(timer);
                if (response?.success) {
                    chrome.runtime.sendMessage({ action: 'LOG', type: 'success', message: '✅ Đã hủy lệnh tắt máy!' }).catch(() => {});
                    chrome.runtime.sendMessage({ action: 'SHUTDOWN_CANCELLED' }).catch(() => {});
                    reply({ success: true });
                } else {
                    chrome.runtime.sendMessage({ action: 'LOG', type: 'error', message: `❌ Hủy thất bại: ${response?.message || response?.error || 'không rõ'}` }).catch(() => {});
                    reply({ success: false });
                }
                try { port.disconnect(); } catch (_) {}
            });
            port.onDisconnect.addListener(() => { clearTimeout(timer); reply({ success: false, error: 'disconnected' }); });
            port.postMessage({ action: 'cancel_shutdown' });
        } catch (error) {
            chrome.runtime.sendMessage({ action: 'LOG', type: 'error', message: `❌ Hủy thất bại: ${error.message}` }).catch(() => {});
            reply({ success: false, error: error.message });
        }
        return true;
    }

    if (action === 'INJECT_PASTE') {
        const targetTabId = message.data?.tabId || sender.tab?.id;
        if (!targetTabId) { sendResponse({ ok: false, error: 'No tabId' }); return false; }
        runInMainWorld(targetTabId, mainWorldPaste, [message.data.text], sendResponse);
        return true;
    }

    if (action === 'INJECT_CLICK_CREATE') {
        const targetTabId = message.data?.tabId || sender.tab?.id;
        if (!targetTabId) { sendResponse({ ok: false, error: 'No tabId' }); return false; }
        runInMainWorld(targetTabId, mainWorldClickCreate, [], sendResponse);
        return true;
    }

    if (action === 'INJECT_RENAME_INPUT') {
        const targetTabId = message.data?.tabId || sender.tab?.id;
        if (!targetTabId) { sendResponse({ ok: false, error: 'No tabId' }); return false; }
        runInMainWorld(targetTabId, mainWorldRenameInput, [message.data.newName], sendResponse);
        return true;
    }

    // Broadcast (LOG / UPDATE_STATS / UPDATE_TABLE_DATA ...): side panel tự nghe,
    // background không cần trả lời. Trả về false để kênh đóng ngay, tránh rò rỉ.
    return false;
});

function fallbackShutdownBatch(delay) {
    const batchContent = [
        '@echo off',
        'echo ========================================',
        'echo Flow Automation Local - Auto Shutdown',
        'echo ========================================',
        'echo.',
        'echo Da xong toan bo prompt!',
        `echo May se tat sau ${delay} giay...`,
        'echo.',
        'echo De HUY: chay "shutdown /a" trong CMD',
        'echo ========================================',
        'echo.',
        `shutdown /s /t ${delay}`,
        ''
    ].join('\r\n');

    const dataUrl = 'data:text/plain;charset=utf-8,' + encodeURIComponent(batchContent);

    // Đẩy cờ SKIP vào đầu hàng đợi để file .bat không bị ép tên của video.
    ensureQueue().then(loadQueue).then(() => {
        pendingFilenames.unshift('__SKIP_RENAME__');
        return saveQueue();
    }).finally(() => {
        chrome.downloads.download({ url: dataUrl, filename: 'Flow_AutoShutdown.bat', saveAs: false }, () => {
            void chrome.runtime.lastError;
            chrome.notifications.create({
                type: 'basic', iconUrl: 'icons/icon128.png',
                title: 'Flow Automation hoàn tất',
                message: 'Đã xong! Chạy Flow_AutoShutdown.bat để tắt máy.',
                priority: 2
            }, () => void chrome.runtime.lastError);
            chrome.runtime.sendMessage({
                action: 'LOG', type: 'warning',
                message: '⚠️ Không dùng được Native Host. Đã tải Flow_AutoShutdown.bat — chạy thủ công để tắt máy.'
            }).catch(() => {});
        });
    });
}

// -------------------------------------------------------------- tab zoom sync
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;
    if (!tab.url || !FLOW_URL_RE.test(tab.url)) return;

    if (tab.url.includes('veo_extra_window=true')) {
        chrome.tabs.setZoomSettings(tabId, { scope: 'per-tab' })
            .then(() => chrome.tabs.setZoom(tabId, 1.0))
            .catch(() => {});
        return;
    }

    chrome.storage.local.get(['veoSettings'], (result) => {
        const zoom = parseFloat(result?.veoSettings?.zoomLevel || 0.8) || 0.8;
        chrome.tabs.setZoom(tabId, zoom).catch(() => {});
    });
});

/* ══════════════════════════════════════════════════════════════════════════
   KIỂM TRA BẢN MỚI (1.9.0)
   --------------------------------------------------------------------------
   Vì sao làm kiểu này: tiện ích cài bằng "Tải tiện ích đã giải nén" (Load
   unpacked) nên Chrome KHÔNG có cơ chế tự cập nhật — cơ chế đó chỉ chạy với
   tiện ích cài từ Chrome Web Store. Extension cũng không được phép tự ghi đè
   file của chính nó trên ổ đĩa. Nên cái làm được là: đọc một file JSON nhỏ ở
   xa, so với version trong manifest, rồi BÁO cho người dùng kèm link tải. Việc
   giải nén thay thư mục vẫn phải làm tay (cài đặt/dự án đã lưu không mất, vì
   chúng nằm trong chrome.storage.local).

   Toàn bộ logic đặt ở service worker (không đặt ở Side Panel) để:
     - chỉ có MỘT nơi gọi mạng, tránh nhiều tab/panel cùng gọi;
     - onStartup kiểm tra được ngay khi mở browser, không cần mở panel.
   ══════════════════════════════════════════════════════════════════════════ */

const UPDATE_KEY = 'veoUpdate';
const UPDATE_DEFAULT_URL =
    'https://raw.githubusercontent.com/RollReus6868/flow-automation/main/version.json';
/* Chỉ cho phép các host đã khai trong host_permissions của manifest. Nhập URL
   ngoài danh sách này thì fetch sẽ bị Chrome chặn, nên chặn sớm và báo rõ. */
const UPDATE_ALLOWED_HOSTS = ['raw.githubusercontent.com', 'gist.githubusercontent.com'];
const UPDATE_THROTTLE_MS = 6 * 60 * 60 * 1000;   // mở panel nhiều lần không gọi mạng liên tục
const UPDATE_TIMEOUT_MS = 10000;

/**
 * Tách version thành mảng số để so sánh. Chấp nhận 2–4 phần và cả đuôi
 * pre-release ("1.9.0-beta.2" -> [1,9,0]); phần chữ bị bỏ qua vì chỉ cần biết
 * bản nào MỚI HƠN, không cần xếp hạng pre-release.
 */
function parseVersion(raw) {
    const core = String(raw ?? '').trim().split(/[-+]/)[0];
    const parts = core.split('.').map(s => parseInt(s, 10));
    if (!parts.length || parts.some(n => !Number.isFinite(n) || n < 0)) return null;
    while (parts.length < 4) parts.push(0);
    return parts.slice(0, 4);
}

/** -1: a < b | 0: bằng | 1: a > b | null: không parse được */
function compareVersions(a, b) {
    const x = parseVersion(a), y = parseVersion(b);
    if (!x || !y) return null;
    for (let i = 0; i < 4; i++) {
        if (x[i] > y[i]) return 1;
        if (x[i] < y[i]) return -1;
    }
    return 0;
}

function currentVersion() {
    try { return chrome.runtime.getManifest().version; } catch (e) { return '0.0.0'; }
}

/** URL có nằm trên host được manifest cho phép không. */
function isUpdateUrlAllowed(raw) {
    try {
        const u = new URL(String(raw));
        return u.protocol === 'https:' && UPDATE_ALLOWED_HOSTS.includes(u.hostname);
    } catch (e) { return false; }
}

async function getUpdateState() {
    const got = await chrome.storage.local.get(UPDATE_KEY);
    const st = got?.[UPDATE_KEY] || {};
    return {
        lastCheckAt: st.lastCheckAt || 0,
        latest: st.latest || '',
        notes: st.notes || '',
        downloadUrl: st.downloadUrl || '',
        publishedAt: st.publishedAt || '',
        error: st.error || '',
        dismissedVersion: st.dismissedVersion || '',
        notifiedVersion: st.notifiedVersion || ''
    };
}

async function patchUpdateState(patch) {
    const cur = await getUpdateState();
    const next = { ...cur, ...patch };
    await chrome.storage.local.set({ [UPDATE_KEY]: next });
    return next;
}

async function updateCheckUrl() {
    const { veoSettings } = await chrome.storage.local.get('veoSettings');
    const raw = String(veoSettings?.updateCheckUrl || '').trim();
    return raw || UPDATE_DEFAULT_URL;
}

async function updateCheckEnabled() {
    const { veoSettings } = await chrome.storage.local.get('veoSettings');
    // Mặc định BẬT: người dùng mới cài chưa có veoSettings vẫn được báo bản mới.
    return veoSettings?.updateCheckEnabled !== false;
}

/**
 * Tải version.json. Không throw ra ngoài — luôn trả {ok, ...} để nơi gọi hiển
 * thị được lỗi cụ thể (mất mạng / repo đổi tên / JSON sai) thay vì im lặng.
 */
async function fetchLatestVersion(url) {
    if (!isUpdateUrlAllowed(url)) {
        return { ok: false, error: `URL không được phép (chỉ nhận https trên ${UPDATE_ALLOWED_HOSTS.join(' hoặc ')})` };
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), UPDATE_TIMEOUT_MS);
    try {
        // cache-buster: raw.githubusercontent.com trả Cache-Control max-age=300,
        // không có tham số này thì vừa push xong vẫn đọc ra bản cũ.
        const bust = url + (url.includes('?') ? '&' : '?') + '_=' + Date.now();
        const res = await fetch(bust, { signal: ctrl.signal, cache: 'no-store' });
        if (!res.ok) return { ok: false, error: `Máy chủ trả mã ${res.status}` };
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); }
        catch (e) { return { ok: false, error: 'File version.json không phải JSON hợp lệ' }; }
        const version = String(data?.version ?? '').trim();
        if (!parseVersion(version)) {
            return { ok: false, error: 'File version.json thiếu trường "version" hợp lệ' };
        }
        return {
            ok: true,
            version,
            notes: String(data?.notes ?? '').slice(0, 500),
            downloadUrl: String(data?.downloadUrl ?? '').trim(),
            publishedAt: String(data?.publishedAt ?? '').trim()
        };
    } catch (e) {
        const msg = e?.name === 'AbortError'
            ? 'Hết thời gian chờ (10 giây) — kiểm tra kết nối mạng'
            : (e?.message || 'Không gọi được mạng');
        return { ok: false, error: msg };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Kiểm tra và lưu kết quả.
 * @param {boolean} force  true = bỏ qua throttle (nút bấm tay).
 * @returns {{status:'new'|'latest'|'error'|'skipped', ...}}
 */
async function checkForUpdate({ force = false } = {}) {
    const current = currentVersion();
    const st = await getUpdateState();

    if (!force) {
        if (!(await updateCheckEnabled())) {
            return { status: 'skipped', reason: 'disabled', current };
        }
        if (Date.now() - st.lastCheckAt < UPDATE_THROTTLE_MS) {
            // Dùng lại kết quả đã lưu, không gọi mạng.
            const cmp = st.latest ? compareVersions(st.latest, current) : null;
            return {
                status: cmp === 1 ? 'new' : (st.latest ? 'latest' : 'skipped'),
                reason: 'cached', cached: true, current,
                latest: st.latest, notes: st.notes,
                downloadUrl: st.downloadUrl, publishedAt: st.publishedAt,
                dismissedVersion: st.dismissedVersion
            };
        }
    }

    const url = await updateCheckUrl();
    const got = await fetchLatestVersion(url);

    if (!got.ok) {
        await patchUpdateState({ lastCheckAt: Date.now(), error: got.error });
        return { status: 'error', error: got.error, current, latest: st.latest };
    }

    await patchUpdateState({
        lastCheckAt: Date.now(), error: '',
        latest: got.version, notes: got.notes,
        downloadUrl: got.downloadUrl, publishedAt: got.publishedAt
    });

    const cmp = compareVersions(got.version, current);
    return {
        status: cmp === 1 ? 'new' : 'latest',
        current, latest: got.version, notes: got.notes,
        downloadUrl: got.downloadUrl, publishedAt: got.publishedAt,
        dismissedVersion: st.dismissedVersion
    };
}

/** Thông báo hệ thống — chỉ MỘT lần cho mỗi version, để không làm phiền. */
async function notifyUpdateOnce(result) {
    if (result?.status !== 'new' || !result.latest) return false;
    const st = await getUpdateState();
    if (st.notifiedVersion === result.latest) return false;
    await patchUpdateState({ notifiedVersion: result.latest });
    try {
        chrome.notifications.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icons/icon128.png'),
            title: `Flow Automation Local ${result.latest} đã có`,
            message: (result.notes || 'Mở Side Panel → tab Cài đặt để xem cách cập nhật.').slice(0, 200)
        });
    } catch (e) { /* notifications có thể bị tắt ở cấp hệ điều hành */ }
    return true;
}

// Mở browser: kiểm tra một lần (không chờ panel được mở).
chrome.runtime.onStartup?.addListener(() => {
    checkForUpdate().then(notifyUpdateOnce).catch(() => {});
});

/* Listener RIÊNG cho nhóm hành động cập nhật: trả undefined với action lạ để
   không tranh chấp với listener chính ở trên. */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const action = message?.action;

    if (action === 'CHECK_UPDATE') {
        checkForUpdate({ force: !!message.force })
            .then(async (r) => {
                if (!message.force) await notifyUpdateOnce(r);
                sendResponse({ ok: true, ...r });
            })
            .catch((e) => sendResponse({ ok: false, status: 'error', error: e?.message || String(e) }));
        return true;
    }

    if (action === 'GET_UPDATE_STATE') {
        Promise.all([getUpdateState(), updateCheckUrl()])
            .then(([st, url]) => sendResponse({
                ok: true, ...st, current: currentVersion(),
                url, defaultUrl: UPDATE_DEFAULT_URL
            }))
            .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
        return true;
    }

    // "Để sau": ẩn banner cho ĐÚNG version đó, bản sau vẫn báo lại.
    if (action === 'DISMISS_UPDATE') {
        patchUpdateState({ dismissedVersion: String(message.version || '') })
            .then(() => sendResponse({ ok: true }))
            .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
        return true;
    }

    return undefined;
});
