/* ============================================================
   Flow Automation Local — Side Panel 1.6.0
   ------------------------------------------------------------
   Thay đổi chính so với 1.5.6:
   - Prompt KHÔNG còn giới hạn ký tự, hỗ trợ prompt nhiều dòng
     qua 4 kiểu dấu phân cách.
   - Nhập / Xuất danh sách prompt bằng file .txt (có kéo–thả).
   - Bảng tiến trình nhận DỮ LIỆU JSON từ content script và tự
     render (bản cũ nhận HTML rồi bóc textContent nên mất hết
     tooltip/màu và cắt prompt còn 30 ký tự).
   - Sửa lỗi "Đến dòng" không đặt được giá trị 1.
   - Log DOM được giới hạn số dòng (bản cũ chỉ giới hạn mảng JS,
     DOM phình vô hạn gây tụt FPS sau vài giờ chạy).
   ============================================================ */

'use strict';

const DEFAULT_SETTINGS = {
  runMode: 'video',
  mode: 'text-to-video',
  model: 'veo-3.1-fast',
  aspectRatio: '16:9',
  duration: '8',
  outputCount: 2,
  pasteDelayMin: 20,
  pasteDelayMax: 30,
  maxRetries: 5,
  addIndex: true,
  autoRename: true,
  renameMode: 'default',
  renameStartIndex: '1',
  renameCustomList: '',
  renameMaxLen: 30,          // 0 = không giới hạn
  renameIndexPad: 2,         // số chữ số khi đặt tên theo STT
  renamePrefix: '',
  renameSuffix: '',
  asciiMode: 'file',         // 'file' = chỉ tên file bỏ dấu | 'both' = cả Flow
  dlMode: 'single',
  autoDownload: true,
  downloadZip: false,
  downloadQuality: '1080p',
  downloadImmediately: 'auto', // 'auto' | true | false
  downloadSubfolder: '',
  activeProjectName: '',
  charSyncStripTag: false,
  randomScroll: false,
  charSync: false,
  keyframeSync: false,
  voiceSync: false,
  voiceSelect: 'Achernar',
  autoShutdown: false,
  zoomLevel: '0.8',
  promptSeparator: 'line',   // line | blank | dash | eq
  theme: 'dark',
  language: 'vi',
  // ─── Ảnh → Video ───
  i2vPrompt: '',
  i2vFrom: 1,
  i2vTo: 10,
  i2vPad: 2,
  i2vNamePrefix: '',
  i2vNameSuffix: '',
  i2vUsePromptList: false,
  i2vStripTag: true,
  // ─── Chốt chặn mất mạng (1.10.0) ───
  // 'auto' = nghi mất mạng thì kiểm chứng bằng request thật tới Flow
  // 'off'  = không bao giờ dừng vì navigator.onLine (VPS / Remote Desktop)
  networkGuard: 'auto',
  // ─── Đa tab (1.7.0) ───
  multiTab: false,
  multiTabMode: 'split',     // 'split' = chia danh sách | 'independent' = mỗi tab một dự án
  multiTabStagger: 0,        // giây giãn cách giữa các lần bấm "Tạo" của mọi tab
  // ─── Kiểm tra bản mới (1.9.0) ───
  updateCheckEnabled: true,
  updateCheckUrl: '',        // '' = dùng địa chỉ mặc định trong background.js
  selectors: {}
};

const MAX_LOG_ROWS = 600;

const ui = (id) => document.getElementById(id);

const app = {
  prompts: [],
  settings: { ...DEFAULT_SETTINGS },
  isRunning: false,
  paused: false,
  endTouched: false,
  loadedProject: false,
  startTime: 0,
  elapsedTimer: null,
  logs: [],
  logFilter: 'all',
  statusFilter: 'all',
  tableRows: [],
  tableMeta: { autoDownload: true },
  expanded: new Set(),
  projects: [],
  diag: null,                // báo cáo chẩn đoán giao diện gần nhất (1.8.0)
  update: null,              // trạng thái kiểm tra bản mới gần nhất (1.9.0)
  // ─── Đa tab (1.7.0) ───
  flowTabs: [],              // danh sách tab Flow do background báo về
  selectedTabId: null,       // tab đang được xem/điều khiển trong panel này
  tabStates: {},             // { [tabId]: {rows, meta, stats, running, projectName} }
  tabPollTimer: null
};

/* ============================ helpers ============================ */

function isFlowUrl(url = '') {
  return /^https:\/\/(?:[^/]+\.)?flow\.google\.com\//.test(url) ||
         /^https:\/\/labs\.google(?:\.com)?\/fx\//.test(url);
}

let toastTimer = null;
function toast(message, kind = '') {
  const el = ui('toast');
  el.textContent = message;
  el.className = `toast ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

function fmtNumber(n) {
  return new Intl.NumberFormat('vi-VN').format(n);
}

/* ============================== logs ============================== */

function logRowEl({ type, message, time }) {
  const el = document.createElement('div');
  el.className = `log ${type || 'info'}`;
  el.dataset.type = type || 'info';
  const t = document.createElement('span');
  t.className = 't';
  t.textContent = `[${time}] `;
  el.appendChild(t);
  el.appendChild(document.createTextNode(message));
  return el;
}

function log(type, message) {
  const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  const entry = { type: type || 'info', message: String(message), time };
  app.logs.push(entry);
  if (app.logs.length > 2000) app.logs.splice(0, app.logs.length - 2000);

  if (entry.type === 'error') {
    const badge = ui('logBadge');
    const n = (parseInt(badge.textContent, 10) || 0) + 1;
    badge.textContent = String(n);
    badge.classList.remove('hidden');
  }

  const box = ui('logs');
  if (!box) return;
  if (app.logFilter !== 'all' && app.logFilter !== entry.type) return;

  box.appendChild(logRowEl(entry));
  // FIX: giới hạn số node trong DOM, không chỉ giới hạn mảng JS.
  while (box.childElementCount > MAX_LOG_ROWS) box.removeChild(box.firstElementChild);
  if (ui('autoScrollLogs')?.checked) box.scrollTop = box.scrollHeight;
}

function renderLogs() {
  const box = ui('logs');
  box.textContent = '';
  const rows = app.logs.filter(l => app.logFilter === 'all' || l.type === app.logFilter);
  for (const l of rows.slice(-MAX_LOG_ROWS)) box.appendChild(logRowEl(l));
  box.scrollTop = box.scrollHeight;
}

/* ========================= prompt parsing ========================= */

const SEPARATOR_HINTS = {
  line:  'Mỗi dòng là một prompt',
  blank: 'Ngắt prompt bằng một dòng trống',
  dash:  'Ngắt prompt bằng dòng chỉ có ---',
  eq:    'Ngắt prompt bằng dòng chỉ có ==='
};

/**
 * Tách text thành danh sách prompt.
 * KHÔNG giới hạn độ dài mỗi prompt và giữ nguyên xuống dòng bên trong
 * prompt (với các kiểu blank/dash/eq).
 */
function parsePrompts(text, mode) {
  const raw = String(text || '').replace(/\r\n?/g, '\n');
  if (!raw.trim()) return [];

  if (mode === 'line') {
    return raw.split('\n').map(s => s.trim()).filter(Boolean);
  }

  let blocks;
  if (mode === 'dash') blocks = raw.split(/^[ \t]*-{3,}[ \t]*$/m);
  else if (mode === 'eq') blocks = raw.split(/^[ \t]*={3,}[ \t]*$/m);
  else blocks = raw.split(/\n[ \t]*\n+/);            // blank line

  return blocks.map(b => b.replace(/^\n+|\n+$/g, '').trim()).filter(Boolean);
}

function joinPrompts(list, mode) {
  if (mode === 'line') return list.join('\n');
  if (mode === 'dash') return list.join('\n---\n');
  if (mode === 'eq') return list.join('\n===\n');
  return list.join('\n\n');
}

function refreshPromptStats() {
  const mode = ui('promptSeparator').value;
  app.prompts = parsePrompts(ui('promptsInput').value, mode);

  const totalChars = app.prompts.reduce((a, p) => a + p.length, 0);
  const longest = app.prompts.reduce((a, p) => Math.max(a, p.length), 0);

  ui('promptCount').textContent = `${fmtNumber(app.prompts.length)} prompt`;
  ui('promptChars').textContent = app.prompts.length
    ? `${fmtNumber(totalChars)} ký tự · dài nhất ${fmtNumber(longest)}`
    : '0 ký tự';
  ui('separatorHint').textContent = SEPARATOR_HINTS[mode] || '';
  ui('previewCount').textContent = String(app.prompts.length);

  const end = ui('endIndex');
  end.max = Math.max(1, app.prompts.length);
  // FIX: bản cũ dùng điều kiện `|| endIndex.value === '1'` nên người dùng KHÔNG
  // THỂ đặt "Đến dòng = 1" — cứ nhập 1 là bị nhảy về số prompt cuối.
  // Nay chỉ tự điều chỉnh khi người dùng CHƯA tự sửa ô này, hoặc khi giá trị
  // vượt quá số prompt hiện có.
  const endVal = Number.parseInt(end.value, 10);
  if (!Number.isInteger(endVal) || endVal < 1 || endVal > app.prompts.length || !app.endTouched) {
    end.value = String(Math.max(1, app.prompts.length));
  }

  renderPreview();
  updateRangeInfo();
}

function renderPreview() {
  const ol = ui('promptPreview');
  ol.textContent = '';
  app.prompts.slice(0, 300).forEach((p) => {
    const li = document.createElement('li');
    li.textContent = p.length > 240 ? p.slice(0, 240) + '…' : p;
    const len = document.createElement('span');
    len.className = 'plen';
    len.textContent = `(${fmtNumber(p.length)} kt)`;
    li.appendChild(len);
    ol.appendChild(li);
  });
  if (app.prompts.length > 300) {
    const li = document.createElement('li');
    li.className = 'plen';
    li.textContent = `… và ${fmtNumber(app.prompts.length - 300)} prompt nữa`;
    ol.appendChild(li);
  }
}

/* Hỗ trợ cả "1,3,7" và dải "10-15". */
function parseIndexList(value, total) {
  const out = new Set();
  for (const part of String(value || '').split(',')) {
    const chunk = part.trim();
    if (!chunk) continue;
    const range = chunk.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range) {
      let a = parseInt(range[1], 10), b = parseInt(range[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) if (i >= 1 && i <= total) out.add(i);
    } else {
      const n = parseInt(chunk, 10);
      if (Number.isInteger(n) && n >= 1 && n <= total) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function selectedJobs() {
  const total = app.prompts.length;
  if (!total) return [];

  if (ui('useCustomRange').checked) {
    return parseIndexList(ui('customIndices').value, total)
      .map(index => ({ index, text: app.prompts[index - 1] }));
  }

  let start = Math.max(1, Number.parseInt(ui('startIndex').value, 10) || 1);
  let end = Number.parseInt(ui('endIndex').value, 10);
  if (!Number.isInteger(end) || end < 1) end = total;
  end = Math.min(total, end);
  if (end < start) end = start;

  const out = [];
  for (let i = start; i <= end; i++) out.push({ index: i, text: app.prompts[i - 1] });
  return out;
}

function updateRangeInfo() {
  const jobs = selectedJobs();
  ui('rangeInfo').textContent = `${fmtNumber(app.prompts.length)} tổng · ${fmtNumber(jobs.length)} được chọn`;
}

/* ============================ settings ============================ */

function gatherSettings() {
  const dlMode = ui('downloadMode').value;
  const runMode = document.querySelector('input[name="runMode"]:checked')?.value || 'video';

  const floor = runMode === 'image' ? 10 : 20;
  let min = Math.max(floor, Number.parseInt(ui('delayMin').value, 10) || floor);
  let max = Math.max(min, Number.parseInt(ui('delayMax').value, 10) || min);

  let maxLen = Number.parseInt(ui('renameMaxLen').value, 10);
  if (Number.isNaN(maxLen) || maxLen < 0) maxLen = 0;
  if (maxLen > 150) maxLen = 150;

  let idxPad = Number.parseInt(ui('renameIndexPad').value, 10);
  if (Number.isNaN(idxPad) || idxPad < 1) idxPad = 2;
  if (idxPad > 8) idxPad = 8;

  const dlNow = ui('downloadImmediately').value;

  app.settings = {
    ...app.settings,
    runMode,
    aspectRatio: ui('aspectRatio').value,
    outputCount: Number.parseInt(ui('outputCount').value, 10) || 2,
    pasteDelayMin: min,
    pasteDelayMax: max,
    maxRetries: Math.max(0, Number.parseInt(ui('maxRetries').value, 10) || 0),
    randomScroll: ui('randomScroll').checked,
    addIndex: ui('addIndex').checked,
    charSync: ui('charSync').checked,
    charSyncStripTag: ui('charSyncStripTag').checked,
    keyframeSync: runMode === 'video' && ui('keyframeSync').checked,
    voiceSync: runMode === 'video' && ui('voiceSync').checked,
    voiceSelect: ui('voiceSelect').value,
    autoRename: ui('autoRename').checked,
    renameMode: ui('renameMode').value,
    renameStartIndex: ui('renameStartIndex').value || '1',
    renameCustomList: ui('renameCustomList').value,
    renameMaxLen: maxLen,
    renameIndexPad: idxPad,
    renamePrefix: ui('renamePrefix').value.trim(),
    renameSuffix: ui('renameSuffix').value.trim(),
    asciiMode: ui('asciiMode').value,
    dlMode,
    autoDownload: dlMode !== 'none',
    downloadZip: dlMode === 'zip',
    downloadQuality: ui('downloadQuality').value,
    downloadImmediately: dlNow === 'true' ? true : (dlNow === 'false' ? false : 'auto'),
    downloadSubfolder: ui('downloadSubfolder').value.trim(),
    autoShutdown: ui('autoShutdown').checked,
    zoomLevel: ui('zoomLevel').value,
    promptSeparator: ui('promptSeparator').value,
    theme: document.documentElement.dataset.theme || 'dark',
    // Ảnh → Video
    i2vPrompt: ui('i2vPrompt').value,
    i2vFrom: Number.parseInt(ui('i2vFrom').value, 10) || 0,
    i2vTo: Number.parseInt(ui('i2vTo').value, 10) || 0,
    i2vPad: Math.min(6, Math.max(1, Number.parseInt(ui('i2vPad').value, 10) || 2)),
    i2vNamePrefix: ui('i2vNamePrefix').value.trim(),
    i2vNameSuffix: ui('i2vNameSuffix').value.trim(),
    i2vUsePromptList: ui('i2vUsePromptList').checked,
    i2vStripTag: ui('i2vStripTag').checked,
    // Chốt chặn mất mạng (1.10.0)
    networkGuard: ui('networkGuard').value === 'off' ? 'off' : 'auto',
    // Đa tab (1.7.0)
    multiTab: ui('multiTab').checked,
    multiTabMode: ui('multiTabMode').value,
    multiTabStagger: Math.min(600, Math.max(0, Number.parseInt(ui('multiTabStagger').value, 10) || 0)),
    // Kiểm tra bản mới (1.9.0)
    updateCheckEnabled: ui('updateCheckEnabled').checked,
    updateCheckUrl: ui('updateCheckUrl').value.trim(),
    language: 'vi'
  };

  ui('delayMin').value = String(min);
  ui('delayMax').value = String(max);
  ui('renameMaxLen').value = String(maxLen);
  ui('renameIndexPad').value = String(idxPad);
  updateRenamePreview();
  return app.settings;
}

/* ───────── Xem trước tên file (chạy đúng logic của content script) ───────── */

// Bỏ dấu tiếng Việt — bản rút gọn của hàm trong background.js, chỉ để xem trước.
const VI_PREVIEW_MAP = {
  'à':'a','á':'a','ạ':'a','ả':'a','ã':'a','â':'a','ầ':'a','ấ':'a','ậ':'a','ẩ':'a','ẫ':'a',
  'ă':'a','ằ':'a','ắ':'a','ặ':'a','ẳ':'a','ẵ':'a',
  'è':'e','é':'e','ẹ':'e','ẻ':'e','ẽ':'e','ê':'e','ề':'e','ế':'e','ệ':'e','ể':'e','ễ':'e',
  'ì':'i','í':'i','ị':'i','ỉ':'i','ĩ':'i',
  'ò':'o','ó':'o','ọ':'o','ỏ':'o','õ':'o','ô':'o','ồ':'o','ố':'o','ộ':'o','ổ':'o','ỗ':'o',
  'ơ':'o','ờ':'o','ớ':'o','ợ':'o','ở':'o','ỡ':'o',
  'ù':'u','ú':'u','ụ':'u','ủ':'u','ũ':'u','ư':'u','ừ':'u','ứ':'u','ự':'u','ử':'u','ữ':'u',
  'ỳ':'y','ý':'y','ỵ':'y','ỷ':'y','ỹ':'y','đ':'d'
};
function deaccentPreview(input) {
  let s = String(input || '').replace(/[À-ỹ]/g, (ch) => {
    const lower = ch.toLowerCase();
    const m = VI_PREVIEW_MAP[lower];
    if (!m) return ch;
    return ch === lower ? m : m.toUpperCase();
  });
  try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
  return s.replace(/[^\x20-\x7E]/g, '_');
}

function safeChunkPreview(text, maxLen) {
  let out = String(text || '').replace(/\s+/g, ' ').trim()
    .replace(/[^\p{L}\p{N}_-]/gu, '_').replace(/_+/g, '_').replace(/^_+/, '');
  if (maxLen > 0 && out.length > maxLen) out = out.slice(0, maxLen);
  return out.replace(/_+$/, '');
}

function updateRenamePreview() {
  const box = ui('renamePreview');
  if (!box) return;

  const mode = ui('renameMode').value;
  const start = Number.parseInt(ui('renameStartIndex').value, 10) || 1;
  const samplePrompt = app.prompts[0] || 'Con mèo bay trên mây xanh';
  let base;

  if (mode === 'index_only') {
    let pad = Number.parseInt(ui('renameIndexPad').value, 10);
    if (Number.isNaN(pad) || pad < 1) pad = 2;
    if (pad > 8) pad = 8;
    const num = String(start).padStart(pad, '0');
    const pre = safeChunkPreview(ui('renamePrefix').value, 40);
    const suf = safeChunkPreview(ui('renameSuffix').value, 40);
    const join = (a, b) => (a && b) ? `${a}_${b}` : (a || b);
    base = join(join(pre, num), suf) || num;
  } else if (mode === 'custom_list') {
    const first = String(ui('renameCustomList').value || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)[0];
    base = first ? safeChunkPreview(first, 150) : `${String(start).padStart(2, '0')}_${safeChunkPreview(samplePrompt, 30)}`;
  } else {
    let maxLen = Number.parseInt(ui('renameMaxLen').value, 10);
    if (Number.isNaN(maxLen) || maxLen <= 0) maxLen = 150;
    base = `${String(start).padStart(2, '0')}_${safeChunkPreview(samplePrompt, maxLen) || 'prompt_1'}`;
  }

  // Tên trên đĩa LUÔN bị bỏ dấu (Chrome không nhận ký tự ngoài ASCII).
  const onDisk = deaccentPreview(base).replace(/_+/g, '_');
  const folder = previewSubfolder();
  const full = (folder ? folder + '/' : '') + onDisk + '.mp4';

  box.textContent = full;
  box.title = ui('asciiMode').value === 'both'
    ? 'Tên trên Flow và tên file giống nhau (đều đã bỏ dấu).'
    : `Tên trên Flow: ${base} — tên file trên máy: ${onDisk}`;
}

function previewSubfolder() {
  const raw = (ui('downloadSubfolder').value || '').trim();
  if (!raw) return '';
  const d = new Date();
  const dateStr = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
  return raw
    .replace(/^[a-zA-Z]:[\\/]+/, '').replace(/^[\\/]+/, '')
    .replace(/\{date\}/gi, dateStr)
    .replace(/\{project\}/gi, app.settings.activeProjectName || 'Project')
    .split(/[\\/]+/)
    .filter(p => p && p !== '.' && p !== '..')
    .map(p => deaccentPreview(p).replace(/[<>:"|?*]/g, '_').trim().replace(/^[\s.]+|[\s.]+$/g, ''))
    .filter(Boolean)
    .slice(0, 4)
    .join('/');
}

async function saveSettings() {
  gatherSettings();
  await chrome.storage.local.set({ veoSettings: app.settings });
  broadcastFlow('UPDATE_SETTINGS', app.settings).catch(() => {});
}

function applySettings(s) {
  app.settings = { ...DEFAULT_SETTINGS, ...(s || {}) };
  const set = (id, v) => { if (ui(id)) ui(id).value = (v === undefined || v === null) ? '' : v; };
  const check = (id, v) => { if (ui(id)) ui(id).checked = !!v; };

  document.documentElement.dataset.theme = app.settings.theme === 'light' ? 'light' : 'dark';

  const r = document.querySelector(`input[name="runMode"][value="${app.settings.runMode}"]`);
  if (r) r.checked = true;

  set('outputCount', app.settings.outputCount);
  set('aspectRatio', app.settings.aspectRatio);
  set('delayMin', app.settings.pasteDelayMin);
  set('delayMax', app.settings.pasteDelayMax);
  set('maxRetries', app.settings.maxRetries);
  set('zoomLevel', app.settings.zoomLevel || '0.8');
  set('voiceSelect', app.settings.voiceSelect);
  set('renameMode', app.settings.renameMode);
  set('renameStartIndex', app.settings.renameStartIndex);
  set('renameCustomList', app.settings.renameCustomList);
  set('renameMaxLen', app.settings.renameMaxLen ?? 30);
  set('renameIndexPad', app.settings.renameIndexPad ?? 2);
  set('renamePrefix', app.settings.renamePrefix || '');
  set('renameSuffix', app.settings.renameSuffix || '');
  set('asciiMode', app.settings.asciiMode || 'file');
  set('downloadMode', app.settings.dlMode || (app.settings.downloadZip ? 'zip' : (app.settings.autoDownload === false ? 'none' : 'single')));
  set('downloadQuality', app.settings.downloadQuality);
  set('downloadSubfolder', app.settings.downloadSubfolder || '');
  set('downloadImmediately', app.settings.downloadImmediately === true ? 'true'
    : (app.settings.downloadImmediately === false ? 'false' : 'auto'));
  set('promptSeparator', app.settings.promptSeparator || 'line');

  // Ảnh → Video
  set('i2vPrompt', app.settings.i2vPrompt || '');
  set('i2vFrom', app.settings.i2vFrom ?? 1);
  set('i2vTo', app.settings.i2vTo ?? 10);
  set('i2vPad', app.settings.i2vPad ?? 2);
  set('i2vNamePrefix', app.settings.i2vNamePrefix || '');
  set('i2vNameSuffix', app.settings.i2vNameSuffix || '');
  check('i2vUsePromptList', app.settings.i2vUsePromptList);
  check('i2vStripTag', app.settings.i2vStripTag !== false);

  // Chốt chặn mất mạng (1.10.0)
  set('networkGuard', app.settings.networkGuard === 'off' ? 'off' : 'auto');

  // Đa tab
  check('multiTab', app.settings.multiTab);
  set('multiTabMode', app.settings.multiTabMode || 'split');
  set('multiTabStagger', app.settings.multiTabStagger ?? 0);

  // Kiểm tra bản mới (1.9.0)
  check('updateCheckEnabled', app.settings.updateCheckEnabled !== false);
  set('updateCheckUrl', app.settings.updateCheckUrl || '');

  check('randomScroll', app.settings.randomScroll);
  check('addIndex', app.settings.addIndex !== false);
  check('charSync', app.settings.charSync);
  check('charSyncStripTag', app.settings.charSyncStripTag);
  check('keyframeSync', app.settings.keyframeSync);
  check('voiceSync', app.settings.voiceSync);
  check('autoRename', app.settings.autoRename !== false);
  check('autoShutdown', app.settings.autoShutdown);

  updateConditionalUI();
}

function updateConditionalUI() {
  ui('customIndices').classList.toggle('hidden', !ui('useCustomRange').checked);

  // Đa tab (1.7.0)
  const multi = ui('multiTab').checked;
  ui('multiTabBox').classList.toggle('hidden', !multi);
  ui('viewingTab').classList.toggle('hidden', !multi);
  const isSplit = ui('multiTabMode').value === 'split';
  ui('startAllBtn').classList.toggle('hidden', !isSplit);
  if (multi) { updateSplitPreview(); startTabPolling(); } else { stopTabPolling(); }

  const mode = ui('renameMode').value;
  ui('renameCustomList').classList.toggle('hidden', mode !== 'custom_list');
  ui('renameDefaultBox').classList.toggle('hidden', mode !== 'default');
  ui('renameIndexBox').classList.toggle('hidden', mode !== 'index_only');
  // "Số bắt đầu" chỉ có nghĩa ở hai chế độ đánh số.
  ui('renameStartIndex').closest('.field').classList.toggle('hidden', mode === 'custom_list');

  const dlMode = ui('downloadMode').value;
  ui('qualityBox').classList.toggle('hidden', dlMode !== 'single');
  // Tải ZIP thì Flow tự đặt tên và tự chọn nơi lưu -> hai ô này vô nghĩa.
  ui('downloadImmediately').closest('.field').classList.toggle('hidden', dlMode !== 'single');

  const isImage = document.querySelector('input[name="runMode"]:checked')?.value === 'image';
  ui('keyframeSync').disabled = isImage;
  ui('voiceSync').disabled = isImage;

  updateRenamePreview();
  updateI2vPreview();
}

/* ========================= tab messaging ========================= */

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function flowTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter(t => isFlowUrl(t.url || ''));
}

/**
 * Tab Flow mà panel này đang điều khiển.
 * (1.7.0) Ưu tiên tab người dùng CHỌN trong danh sách đa tab; nếu chưa chọn thì
 * giữ nguyên hành vi cũ: tab đang mở của cửa sổ này, rồi tới tab Flow bất kỳ.
 * Side Panel là của từng cửa sổ, nên mỗi cửa sổ tự điều khiển tab Flow của nó.
 */
async function targetFlowTab() {
  if (app.selectedTabId) {
    try {
      const t = await chrome.tabs.get(app.selectedTabId);
      if (t && isFlowUrl(t.url || '')) return t;
    } catch (e) { app.selectedTabId = null; }   // tab đã đóng
  }
  let tab = await activeTab();
  if (!tab || !isFlowUrl(tab.url || '')) {
    const tabs = await flowTabs();
    tab = tabs.find(t => t.active) || tabs[0];
  }
  return tab || null;
}

async function sendToActiveFlow(action, data = {}) {
  const tab = await targetFlowTab();
  if (!tab?.id) throw new Error('Không tìm thấy tab Google Flow. Hãy mở project Flow rồi thử lại.');
  await chrome.tabs.sendMessage(tab.id, { action, data });
  return tab;
}

/** Như sendToActiveFlow nhưng TRẢ VỀ phản hồi của content script. */
async function sendToActiveFlowAwait(action, data = {}, timeoutMs = 120000) {
  const tab = await targetFlowTab();
  if (!tab?.id) throw new Error('Không tìm thấy tab Google Flow. Hãy mở project Flow rồi thử lại.');

  return Promise.race([
    chrome.tabs.sendMessage(tab.id, { action, data }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Tab Flow không phản hồi (quá thời gian chờ).')), timeoutMs))
  ]);
}

async function broadcastFlow(action, data = {}) {
  const tabs = await flowTabs();
  await Promise.allSettled(tabs.filter(t => t.id).map(t => chrome.tabs.sendMessage(t.id, { action, data })));
}

/* ═════════════════ CHẨN ĐOÁN GIAO DIỆN (1.8.0) ═════════════════ */

/**
 * Vì tiện ích phải "đọc" giao diện web của Flow chứ không có API chính thức,
 * mỗi lần Google đổi UI là một số bước không tìm được phần tử. Khối này cho
 * người dùng: (1) biết bước nào đang vỡ, (2) tự chỉ lại phần tử ngay trên
 * trang, (3) xuất báo cáo đủ chi tiết để vá mà không cần mở F12.
 */
async function runDiagnostics() {
  const btn = ui('runDiagBtn');
  const list = ui('diagList');
  btn.disabled = true;
  btn.textContent = '⏳ Đang kiểm tra…';
  list.textContent = '';

  try {
    const res = await sendToActiveFlowAwait('RUN_UI_SELFTEST', { deep: ui('diagDeep').checked }, 60000);
    if (!res?.ok) throw new Error(res?.error || 'Tab Flow không trả về kết quả');
    app.diag = res.report;
    renderDiagnostics();

    const bad = res.report.rows.filter(r => !r.ok && !r.skipped);
    if (bad.length) {
      log('warning', `Chẩn đoán: ${bad.length} phần tử KHÔNG nhận diện được (${bad.map(r => r.label).join(', ')}).`);
      toast(`${bad.length} bước không nhận diện được`, 'err');
    } else {
      log('success', 'Chẩn đoán: tất cả phần tử đều nhận diện bình thường.');
      toast('Giao diện Flow vẫn khớp — không có vấn đề', 'ok');
      hideUiBreakBanner();
    }
  } catch (e) {
    log('error', 'Không kiểm tra được: ' + e.message);
    toast(e.message, 'err');
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'Không kết nối được tab Flow. Hãy mở tab Google Flow, F5 một lần rồi thử lại.';
    list.appendChild(p);
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 Kiểm tra giao diện';
  }
}

function renderDiagnostics() {
  const list = ui('diagList');
  list.textContent = '';
  const rep = app.diag;
  if (!rep) return;

  /* ── tóm tắt ── */
  const bad = rep.rows.filter(r => !r.ok && !r.skipped);
  const box = ui('diagSummary');
  box.classList.remove('hidden', 'on', 'off', 'unknown');
  box.textContent = '';
  const head = document.createElement('div');
  head.className = 'alertbox-head';
  const strong = document.createElement('strong');
  if (bad.length === 0) {
    box.classList.add('off');
    strong.textContent = '✅ Giao diện Flow vẫn khớp với tiện ích';
  } else if (bad.some(r => r.critical)) {
    box.classList.add('on');
    strong.textContent = `⛔ ${bad.length} phần tử quan trọng không nhận diện được`;
  } else {
    box.classList.add('unknown');
    strong.textContent = `⚠️ ${bad.length} phần tử phụ không nhận diện được`;
  }
  head.appendChild(strong);
  box.appendChild(head);

  const meta = document.createElement('p');
  meta.className = 'note';
  meta.textContent = `Kiểm tra lúc ${new Date(rep.at).toLocaleTimeString('vi-VN')} · ${rep.tileCount} thẻ trên lưới`
    + (rep.version ? ` · tiện ích ${rep.version}` : '');
  box.appendChild(meta);

  if (rep.menu) {
    const m = document.createElement('p');
    m.className = 'menudump';
    if (rep.menu.ok) {
      m.textContent = 'Mục trong menu ⋮ đọc được: ' + rep.menu.items.map(i => i.text || i.aria).filter(Boolean).join(' · ');
    } else {
      m.textContent = 'Kiểm tra sâu: ' + rep.menu.reason;
    }
    box.appendChild(m);
  }

  /* ── từng phần tử ── */
  for (const r of rep.rows) {
    const row = document.createElement('div');
    row.className = 'diagrow ' + (r.ok ? 'good' : (r.skipped ? 'skip' : 'bad'));

    const head2 = document.createElement('div');
    head2.className = 'diagrow-head';
    const label = document.createElement('span');
    label.className = 'dlabel';
    label.textContent = r.label + (r.critical ? '' : ' (phụ)');
    const state = document.createElement('span');
    state.className = 'dstate';
    state.textContent = r.ok
      ? `✅ ${r.count > 1 ? r.count + ' phần tử' : 'OK'}`
      : (r.skipped ? '⏭️ chưa kiểm tra được' : '❌ không tìm thấy');
    head2.appendChild(label);
    head2.appendChild(state);
    row.appendChild(head2);

    const hint = document.createElement('div');
    hint.className = 'dhint';
    hint.textContent = r.skipped
      ? r.hint + ' — hiện chưa có phần tử này trên trang (ví dụ lưới còn trống), hãy tạo một video rồi kiểm tra lại.'
      : r.hint;
    row.appendChild(hint);

    const via = document.createElement('div');
    via.className = 'dvia';
    via.textContent = r.override
      ? '⚙️ Đang dùng selector bạn đã chọn' + (r.ok ? '' : ' — nhưng selector này không khớp gì nữa')
      : (r.ok ? 'Đang dùng cách dò mặc định' : 'Chưa có selector riêng cho phần tử này');
    row.appendChild(via);

    if (r.override) {
      const sel = document.createElement('div');
      sel.className = 'dsel';
      sel.textContent = r.override;
      row.appendChild(sel);
    }

    const btns = document.createElement('div');
    btns.className = 'drow-btns';

    const pick = document.createElement('button');
    pick.className = 'pill-btn';
    pick.textContent = '🎯 Chọn trên trang';
    pick.onclick = () => startPick(r.key, r.label);
    btns.appendChild(pick);

    const manualBtn = document.createElement('button');
    manualBtn.className = 'pill-btn';
    manualBtn.textContent = '⌨ Nhập tay';
    btns.appendChild(manualBtn);

    if (r.override) {
      const clear = document.createElement('button');
      clear.className = 'pill-btn';
      clear.textContent = '✕ Xoá';
      clear.onclick = () => clearOneSelector(r.key, r.label);
      btns.appendChild(clear);
    }
    row.appendChild(btns);

    /* ô nhập selector bằng tay (ẩn tới khi bấm) */
    const manual = document.createElement('div');
    manual.className = 'manual hidden';
    const input = document.createElement('input');
    input.placeholder = 'Ví dụ: button.mat-mdc-menu-trigger';
    input.value = r.override || '';
    const save = document.createElement('button');
    save.className = 'pill-btn';
    save.textContent = 'Lưu';
    save.onclick = () => saveManualSelector(r.key, r.label, input.value);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
    manual.appendChild(input);
    manual.appendChild(save);
    row.appendChild(manual);
    manualBtn.onclick = () => { manual.classList.toggle('hidden'); if (!manual.classList.contains('hidden')) input.focus(); };

    /* ứng viên tìm thấy trên trang — gợi ý để chọn nhanh */
    if (!r.ok && r.candidates?.length) {
      const det = document.createElement('details');
      det.className = 'mini-details';
      const sum = document.createElement('summary');
      sum.textContent = `Xem ${r.candidates.length} phần tử ứng viên trên trang`;
      det.appendChild(sum);
      for (const c of r.candidates) {
        const line = document.createElement('div');
        line.className = 'dsel';
        line.style.cursor = 'pointer';
        line.title = 'Bấm để dùng selector này';
        const desc = [c.tag, c.aria && `aria="${c.aria}"`, c.role && `role=${c.role}`, c.text && `"${c.text}"`]
          .filter(Boolean).join(' · ');
        line.textContent = `${c.selector || '(không sinh được selector)'}  ←  ${desc}`;
        if (c.selector) line.onclick = () => saveManualSelector(r.key, r.label, c.selector);
        det.appendChild(line);
      }
      row.appendChild(det);
    }

    list.appendChild(row);
  }
}

async function startPick(key, label) {
  try {
    await sendToActiveFlow('START_PICKING', { targetType: key });
    toast(`Hãy bấm vào "${label}" trên trang Flow (Esc để huỷ)`, 'ok');
    log('info', `Đang chờ bạn chọn "${label}" trên trang Flow…`);
  } catch (e) {
    toast('Không mở được chế độ chọn: ' + e.message, 'err');
  }
}

async function saveManualSelector(key, label, raw) {
  const selector = String(raw || '').trim();
  if (!selector) { toast('Selector đang để trống', 'err'); return; }
  // Kiểm tra cú pháp ngay tại panel để không lưu vào thứ làm content script lỗi.
  try { document.createDocumentFragment().querySelectorAll(selector); }
  catch (e) { toast('Selector sai cú pháp CSS', 'err'); return; }

  app.settings.selectors = { ...(app.settings.selectors || {}), [key]: selector };
  await chrome.storage.local.set({ veoSettings: app.settings });
  await broadcastFlow('UPDATE_SETTINGS', app.settings).catch(() => {});
  log('success', `Đã lưu selector cho "${label}": ${selector}`);
  toast('Đã lưu selector', 'ok');
  runDiagnostics();
}

async function clearOneSelector(key, label) {
  const next = { ...(app.settings.selectors || {}) };
  delete next[key];
  app.settings.selectors = next;
  await chrome.storage.local.set({ veoSettings: app.settings });
  await broadcastFlow('UPDATE_SETTINGS', app.settings).catch(() => {});
  log('info', `Đã xoá selector riêng của "${label}" — quay lại cách dò mặc định.`);
  runDiagnostics();
}

function showUiBreakBanner(label, misses) {
  ui('uiBreakBanner').classList.remove('hidden');
  ui('uiBreakText').textContent =
    `Không tìm thấy "${label}" sau ${misses} lần thử. Bot có thể đứng ở bước này. ` +
    `Hãy mở chẩn đoán để tự chỉ lại phần tử, hoặc tải báo cáo .txt gửi cho Claude.`;
}

function hideUiBreakBanner() {
  ui('uiBreakBanner').classList.add('hidden');
}

/** Báo cáo .txt: đủ để viết lại selector mà không cần người dùng mở F12. */
function buildDiagReportText() {
  const rep = app.diag;
  const L = [];
  L.push('BÁO CÁO CHẨN ĐOÁN GIAO DIỆN — Flow Automation Local');
  L.push('='.repeat(64));
  L.push(`Thời điểm      : ${new Date().toLocaleString('vi-VN')}`);
  L.push(`Phiên bản tool : ${rep?.version || '(chưa kiểm tra)'}`);
  L.push(`Trang          : ${rep?.url || '-'}`);
  L.push(`Tiêu đề trang  : ${rep?.title || '-'}`);
  L.push(`Số thẻ trên lưới: ${rep?.tileCount ?? '-'}`);
  L.push(`User agent     : ${navigator.userAgent}`);
  L.push('');

  if (!rep) {
    L.push('CHƯA CHẠY KIỂM TRA — hãy bấm "Kiểm tra giao diện" trước khi tải báo cáo.');
    return L.join('\n');
  }

  L.push('KẾT QUẢ TỪNG PHẦN TỬ');
  L.push('-'.repeat(64));
  for (const r of rep.rows) {
    const st = r.ok ? 'OK' : (r.skipped ? 'BỎ QUA (chưa có trên trang)' : 'KHÔNG TÌM THẤY');
    L.push(`[${st}] ${r.label}  (key=${r.key}${r.critical ? ', quan trọng' : ''})`);
    L.push(`   mô tả     : ${r.hint}`);
    L.push(`   nguồn dò  : ${r.via || '-'}${r.override ? ` | selector người dùng: ${r.override}` : ''}`);
    if (r.ok && r.element) {
      L.push(`   số khớp   : ${r.count}`);
      L.push(`   phần tử   : <${r.element.tag}> id="${r.element.id}" class="${r.element.cls}"`);
      if (r.element.aria) L.push(`   aria-label: ${r.element.aria}`);
      L.push(`   selector đề xuất: ${r.element.selector}`);
    }
    if (!r.ok && r.candidates?.length) {
      L.push(`   ── ${r.candidates.length} phần tử ứng viên đang có trên trang ──`);
      r.candidates.forEach((c, i) => {
        L.push(`   ${String(i + 1).padStart(2)}. <${c.tag}>` +
          (c.id ? ` id="${c.id}"` : '') +
          (c.role ? ` role="${c.role}"` : '') +
          (c.aria ? ` aria-label="${c.aria}"` : '') +
          (c.haspopup ? ` aria-haspopup="${c.haspopup}"` : '') +
          (c.ph ? ` placeholder="${c.ph}"` : ''));
        if (c.cls) L.push(`       class : ${c.cls}`);
        if (c.text) L.push(`       text  : ${c.text}`);
        if (c.selector) L.push(`       selector: ${c.selector}`);
        if (c.html) L.push(`       html  : ${c.html}`);
      });
    }
    L.push('');
  }

  L.push('MENU ⋮ CỦA THẺ');
  L.push('-'.repeat(64));
  if (!rep.menu) L.push('(không chạy kiểm tra sâu)');
  else if (rep.menu.ok) rep.menu.items.forEach((i, n) => L.push(`  ${n + 1}. "${i.text}"${i.aria ? ` (aria="${i.aria}")` : ''}`));
  else L.push('  ' + rep.menu.reason);
  L.push('');

  L.push('SELECTOR NGƯỜI DÙNG ĐANG ĐẶT');
  L.push('-'.repeat(64));
  const sels = app.settings.selectors || {};
  const keys = Object.keys(sels);
  if (!keys.length) L.push('(chưa đặt selector nào — đang dùng cách dò mặc định)');
  else keys.forEach(k => L.push(`  ${k} = ${typeof sels[k] === 'string' ? sels[k] : JSON.stringify(sels[k])}`));
  L.push('');

  L.push('CÀI ĐẶT LIÊN QUAN');
  L.push('-'.repeat(64));
  L.push(`  chế độ chạy     : ${app.settings.runMode}`);
  L.push(`  đa tab          : ${app.settings.multiTab ? 'bật' : 'tắt'} (${app.settings.multiTabMode}, giãn ${app.settings.multiTabStagger}s)`);
  L.push(`  tự đổi tên      : ${app.settings.autoRename ? 'bật' : 'tắt'} (${app.settings.renameMode})`);
  L.push(`  tải xuống       : ${app.settings.dlMode}, thời điểm=${app.settings.downloadImmediately}`);
  L.push(`  chốt chặn mạng  : ${app.settings.networkGuard === 'off' ? 'bỏ qua hẳn' : 'tự động (kiểm chứng bằng request thật)'} · navigator.onLine lúc này=${navigator.onLine}`);
  L.push('');

  L.push('LOG GẦN NHẤT (100 dòng cuối)');
  L.push('-'.repeat(64));
  app.logs.slice(-100).forEach(l => L.push(`  [${l.time}] ${(l.type || 'info').toUpperCase()}: ${l.message}`));

  return L.join('\n');
}

function exportDiagReport() {
  const text = buildDiagReportText();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `flow-chan-doan-${stamp}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  log('success', 'Đã tải báo cáo chẩn đoán .txt — gửi file này cho Claude để vá.');
  toast('Đã tải báo cáo .txt', 'ok');
}

/* ═════════════════ KIỂM TRA BẢN MỚI (1.9.0) ═════════════════
   Panel KHÔNG tự gọi mạng: mọi việc fetch/so sánh/lưu do service worker làm
   (xem background.js), panel chỉ hỏi kết quả và hiển thị. Nhờ vậy mở nhiều
   panel/cửa sổ cũng chỉ có một nơi gọi mạng, và onStartup vẫn kiểm tra được
   khi chưa ai mở panel.
   ─────────────────────────────────────────────────────────────── */

/* Thời gian chờ tối đa cho một lời gọi tới background. PHẢI có: nếu service
   worker không phản hồi (MV3 kill worker, hoặc worker lỗi khi nạp) thì một
   promise treo vĩnh viễn sẽ chặn cả phần khởi tạo panel phía sau nó — panel
   đứng im, không bấm được tab nào. Đã bắt đúng hiện tượng này khi chụp ảnh
   giao diện bằng Chromium thật. */
const BG_TIMEOUT_MS = 5000;

function askBackground(action, data = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (res) => { if (!done) { done = true; resolve(res); } };
    const timer = setTimeout(
      () => finish({ ok: false, error: 'Background không phản hồi (hết thời gian chờ)' }),
      BG_TIMEOUT_MS
    );
    try {
      chrome.runtime.sendMessage({ action, ...data }, (res) => {
        // Bỏ qua lastError: worker vừa bị kill là chuyện bình thường ở MV3.
        void chrome.runtime.lastError;
        clearTimeout(timer);
        finish(res || { ok: false, error: 'Không nhận được phản hồi từ background' });
      });
    } catch (e) {
      clearTimeout(timer);
      finish({ ok: false, error: e?.message || String(e) });
    }
  });
}

function fmtCheckedAt(ts) {
  if (!ts) return 'Chưa kiểm tra lần nào.';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'Đã kiểm tra: vừa xong.';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `Đã kiểm tra: ${mins} phút trước.`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Đã kiểm tra: ${hours} giờ trước.`;
  return `Đã kiểm tra: ${new Date(ts).toLocaleString('vi-VN')}.`;
}

/** Suy ra trang repo từ địa chỉ raw, để có link tải dự phòng khi version.json
    không ghi downloadUrl. */
function repoPageFromRawUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (u.hostname !== 'raw.githubusercontent.com') return '';
    const [owner, repo] = u.pathname.replace(/^\//, '').split('/');
    return (owner && repo) ? `https://github.com/${owner}/${repo}` : '';
  } catch (e) { return ''; }
}

function updateDownloadTarget(st) {
  return st?.downloadUrl || repoPageFromRawUrl(st?.url || app.settings.updateCheckUrl) || '';
}

function showUpdateBanner(st) {
  const bits = [];
  if (st.publishedAt) bits.push(`phát hành ${st.publishedAt}`);
  bits.push(`bạn đang dùng ${st.current}`);
  ui('updateBannerTitle').textContent = `⬆ Có bản mới ${st.latest}`;
  ui('updateBannerText').textContent =
    (st.notes ? st.notes + ' — ' : '') + `(${bits.join(', ')}). ` +
    'Xem Cài đặt → ⬆ Cập nhật tiện ích để biết 3 bước thay thư mục.';
  ui('updateBanner').classList.remove('hidden');
  ui('updateBanner').dataset.version = st.latest;
}

function hideUpdateBanner() {
  ui('updateBanner').classList.add('hidden');
}

/** Chỉ hiện banner khi: có bản mới hơn VÀ người dùng chưa bấm "Để sau" cho
    đúng bản đó. */
function applyUpdateResult(st) {
  const newer = st.latest && compareVersionsUi(st.latest, st.current) === 1;
  if (newer && st.dismissedVersion !== st.latest) showUpdateBanner(st);
  else hideUpdateBanner();
  return newer;
}

/* Bản rút gọn của compareVersions trong background.js — panel cần so sánh để
   quyết định hiện banner mà không phải hỏi lại worker. */
function compareVersionsUi(a, b) {
  const p = (raw) => {
    const core = String(raw ?? '').trim().split(/[-+]/)[0];
    const arr = core.split('.').map(s => parseInt(s, 10));
    if (!arr.length || arr.some(n => !Number.isFinite(n) || n < 0)) return null;
    while (arr.length < 4) arr.push(0);
    return arr.slice(0, 4);
  };
  const x = p(a), y = p(b);
  if (!x || !y) return null;
  for (let i = 0; i < 4; i++) {
    if (x[i] > y[i]) return 1;
    if (x[i] < y[i]) return -1;
  }
  return 0;
}

function renderUpdateSection(st) {
  ui('updCurrent').textContent = st.current || '—';
  ui('updLatest').textContent = st.latest
    ? st.latest + (compareVersionsUi(st.latest, st.current) === 1 ? ' (mới hơn)' : ' (đang là mới nhất)')
    : 'chưa kiểm tra';
  ui('updCheckedAt').textContent = st.error
    ? `Lần kiểm tra gần nhất lỗi: ${st.error}`
    : fmtCheckedAt(st.lastCheckAt);
  ui('updOpenBtn').disabled = !updateDownloadTarget(st);
}

async function refreshUpdateUI() {
  const st = await askBackground('GET_UPDATE_STATE');
  if (!st?.ok) return;
  app.update = st;
  renderUpdateSection(st);
  applyUpdateResult(st);
}

/**
 * @param {boolean} force true = do người dùng bấm nút (bỏ qua throttle, có
 *        toast báo kết quả); false = tự động khi mở panel (im lặng).
 */
async function doUpdateCheck(force = false) {
  if (force) {
    ui('updCheckBtn').disabled = true;
    ui('updCheckBtn').textContent = '⏳ Đang kiểm tra…';
  }
  const r = await askBackground('CHECK_UPDATE', { force });
  if (force) {
    ui('updCheckBtn').disabled = false;
    ui('updCheckBtn').textContent = '🔄 Kiểm tra bản mới';
  }

  // Hợp nhất với state đã lưu để có dismissedVersion + url cho nút "Mở trang tải".
  const st = await askBackground('GET_UPDATE_STATE');
  const merged = { ...(st?.ok ? st : {}), ...r };
  app.update = merged;
  renderUpdateSection(merged);
  const newer = applyUpdateResult(merged);

  if (!force) return newer;

  if (r.status === 'error') {
    toast('Không kiểm tra được: ' + (r.error || 'lỗi không rõ'), 'err');
    log('error', `Kiểm tra bản mới thất bại: ${r.error || 'lỗi không rõ'}`);
  } else if (newer) {
    toast(`Có bản mới ${merged.latest}`, 'ok');
    log('success', `Có bản mới ${merged.latest} (đang dùng ${merged.current})`);
  } else {
    toast('Bạn đang dùng bản mới nhất', 'ok');
    log('info', `Đã là bản mới nhất (${merged.current})`);
  }
  return newer;
}

function openUpdateDownload() {
  const target = updateDownloadTarget(app.update || {});
  if (!target) { toast('Chưa có địa chỉ tải — kiểm tra bản mới trước', 'err'); return; }
  chrome.tabs.create({ url: target });
}

/* ═══════════════════════ ĐA TAB (1.7.0) ═══════════════════════ */

/**
 * Chia danh sách công việc thành n khối LIÊN TIẾP, giữ nguyên số thứ tự gốc.
 * Giữ index gốc là bắt buộc: tên file đánh theo số thứ tự (index_only) và các
 * log đều dựa vào nó — nếu đánh lại từ 1 cho từng tab thì các tab sẽ ghi ra
 * những file trùng tên nhau.
 * Chia liên tiếp (chứ không xen kẽ) để file của mỗi tab nằm gọn một dải số.
 */
function splitJobs(jobs, n) {
  const out = [];
  const count = Math.max(1, Math.min(n, jobs.length));
  const per = Math.floor(jobs.length / count);
  const extra = jobs.length % count;      // chia phần dư cho các tab đầu
  let pos = 0;
  for (let i = 0; i < count; i++) {
    const size = per + (i < extra ? 1 : 0);
    out.push(jobs.slice(pos, pos + size));
    pos += size;
  }
  return out;
}

function tabLabel(t) {
  // Tab chưa đăng ký (chưa nạp content script) chưa có số thứ tự -> hiện #id để
  // không ai đọc nhầm id thành số thứ tự tab.
  const n = t.slot ? `Tab ${t.slot}` : `Tab #${t.tabId}`;
  return t.windowId ? `${n} · cửa sổ ${t.windowId}` : n;
}

async function refreshFlowTabs() {
  let res = null;
  try { res = await chrome.runtime.sendMessage({ action: 'LIST_FLOW_TABS' }); } catch (e) { /* worker đang ngủ */ }
  app.flowTabs = res?.tabs || [];

  // Tab đang chọn đã đóng -> quay về tab Flow của cửa sổ này.
  if (app.selectedTabId && !app.flowTabs.some(t => t.tabId === app.selectedTabId)) {
    app.selectedTabId = null;
  }
  if (!app.selectedTabId) {
    const own = app.flowTabs.find(t => t.active) || app.flowTabs[0];
    app.selectedTabId = own?.tabId || null;
  }

  renderFlowTabs();
  updateSplitPreview();
}

function renderFlowTabs() {
  const box = ui('tabList');
  if (!box) return;
  ui('multiTabCount').textContent = `${app.flowTabs.length} tab Flow`;

  box.textContent = '';
  if (!app.flowTabs.length) {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'Chưa thấy tab Google Flow nào. Hãy mở Flow (nút “+ Cửa sổ” bên trên mở nhanh một cửa sổ mới).';
    box.appendChild(p);
    return;
  }

  for (const t of app.flowTabs) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'tabrow ' + (t.running ? 'run' : 'idle') + (t.throttled ? ' warn' : '') +
      (t.tabId === app.selectedTabId ? ' sel' : '');
    row.title = t.title || '';

    const dot = document.createElement('span');
    dot.className = 'tdot';
    row.appendChild(dot);

    const main = document.createElement('span');
    main.className = 'tmain';
    const name = document.createElement('span');
    name.className = 'tname';
    name.textContent = tabLabel(t);
    const sub = document.createElement('span');
    sub.className = 'tsub';
    const bits = [];
    if (!t.ready) bits.push('chưa nạp script (F5 tab đó)');
    else if (t.running) bits.push('đang chạy');
    else bits.push('rảnh');
    if (t.projectName) bits.push(t.projectName);
    if (t.holdsDownloadLock) bits.push('đang tải xuống');
    sub.textContent = bits.join(' · ');
    main.appendChild(name);
    main.appendChild(sub);
    row.appendChild(main);

    const prog = document.createElement('span');
    prog.className = 'tprog';
    prog.textContent = t.total ? `${t.done}/${t.total}` : '–';
    row.appendChild(prog);

    if (t.throttled) {
      const flag = document.createElement('span');
      flag.className = 'tflag';
      flag.textContent = '🐢';
      flag.title = 'Chrome đang hãm tab này vì nó bị ẩn — nên tách ra cửa sổ riêng.';
      row.appendChild(flag);
    }

    row.onclick = () => {
      app.selectedTabId = t.tabId;
      renderFlowTabs();
      showTabState(t.tabId);
    };
    box.appendChild(row);
  }

  const sel = app.flowTabs.find(t => t.tabId === app.selectedTabId);
  ui('viewingTab').textContent = sel ? tabLabel(sel).split(' ·')[0] : 'Tab –';
  // Nhãn nút Bắt đầu phụ thuộc số tab sẵn sàng -> cập nhật lại khi danh sách đổi.
  if (!app.isRunning) setRunning(false, app.paused);
}

function updateSplitPreview() {
  const el = ui('splitPreview');
  if (!el) return;
  if (!ui('multiTab').checked || ui('multiTabMode').value !== 'split') { el.textContent = ''; return; }

  const jobs = selectedJobs();
  const usable = app.flowTabs.filter(t => t.ready);
  if (!jobs.length || !usable.length) {
    el.textContent = jobs.length ? 'Chưa có tab Flow nào sẵn sàng.' : 'Chưa chọn prompt nào.';
    return;
  }
  const parts = splitJobs(jobs, usable.length);
  el.textContent = 'Sẽ chia: ' + parts.map((p, i) => {
    if (!p.length) return `${tabLabel(usable[i]).split(' ·')[0]}: —`;
    const a = p[0].index, b = p[p.length - 1].index;
    return `${tabLabel(usable[i]).split(' ·')[0]}: ${a}–${b} (${p.length})`;
  }).join(' · ');
}

/** Hiển thị bảng tiến trình của MỘT tab (mỗi tab có bảng riêng). */
function showTabState(tabId) {
  const st = app.tabStates[tabId];
  app.tableRows = st?.rows || [];
  app.tableMeta = st?.meta || { autoDownload: true, autoRename: true };
  ui('statCreating').textContent = st?.stats?.creating ?? 0;
  ui('statCompleted').textContent = st?.stats?.completed ?? 0;
  ui('statError').textContent = st?.stats?.error ?? 0;
  renderTable();
  renderOverall();
}

async function startAllTabs() {
  await saveSettings();
  refreshPromptStats();
  const jobs = selectedJobs();
  if (!jobs.length) { toast('Hãy nhập và chọn ít nhất một prompt', 'err'); return; }

  await refreshFlowTabs();
  const usable = app.flowTabs.filter(t => t.ready && !t.running);
  if (!usable.length) {
    toast('Không có tab Flow nào rảnh và đã nạp script', 'err');
    return;
  }

  const parts = splitJobs(jobs, usable.length);
  let started = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part.length) continue;
    try {
      await chrome.tabs.sendMessage(usable[i].tabId, {
        action: 'START_AUTOMATION',
        data: {
          // prompts giữ NGUYÊN danh sách đầy đủ để prompts[index-1] vẫn khớp
          // với promptIndex toàn cục (quan trọng cho đặt tên theo số thứ tự).
          prompts: app.prompts,
          videosToCreate: part,
          settings: app.settings
        }
      });
      started++;
      log('success', `${tabLabel(usable[i]).split(' ·')[0]}: nhận prompt ${part[0].index}–${part[part.length - 1].index} (${part.length}).`);
    } catch (e) {
      log('error', `${tabLabel(usable[i])}: không gửi được lệnh chạy (${e.message}).`);
    }
  }

  if (started) {
    app.startTime = Date.now();
    app.paused = false;
    app.loadedProject = false;
    ui('summary').classList.add('hidden');
    setRunning(true);
    startElapsed();
    toast(`Đã chia ${jobs.length} prompt cho ${started} tab`, 'ok');
  }
}

async function stopAllTabs() {
  await refreshFlowTabs();
  let n = 0;
  for (const t of app.flowTabs) {
    try { await chrome.tabs.sendMessage(t.tabId, { action: 'STOP_AUTOMATION', data: {} }); n++; } catch (e) {}
  }
  setRunning(false, false);
  stopElapsed();
  toast(n ? `Đã gửi lệnh dừng cho ${n} tab` : 'Không có tab nào để dừng', n ? 'ok' : 'err');
}

function startTabPolling() {
  if (app.tabPollTimer) return;
  refreshFlowTabs();
  app.tabPollTimer = setInterval(refreshFlowTabs, 3000);
}

function stopTabPolling() {
  if (!app.tabPollTimer) return;
  clearInterval(app.tabPollTimer);
  app.tabPollTimer = null;
}

let lastConnState = null;
async function checkConnection() {
  const tab = await activeTab();
  const dot = ui('connDot'), text = ui('connText'), detail = ui('connDetail');

  if (tab && isFlowUrl(tab.url || '')) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'UPDATE_SETTINGS', data: app.settings });
      dot.className = 'dot ok';
      text.textContent = 'Đã kết nối Google Flow';
      detail.textContent = tab.title || tab.url;
      lastConnState = 'ok';
    } catch (_) {
      dot.className = 'dot warn';
      text.textContent = 'Flow đã mở nhưng chưa nạp được script';
      detail.textContent = 'Hãy refresh (F5) tab Flow một lần.';
      lastConnState = 'stale';
    }
    return;
  }

  const tabs = await flowTabs();
  if (tabs.length) {
    dot.className = 'dot warn';
    text.textContent = `Có ${tabs.length} tab Flow ở nền`;
    detail.textContent = 'Chuyển sang tab Flow trước khi bắt đầu để giảm lỗi giao diện.';
    lastConnState = 'bg';
  } else {
    dot.className = 'dot bad';
    text.textContent = 'Chưa mở Google Flow';
    detail.textContent = 'Bấm nút ↗ ở góc phải để mở Flow.';
    lastConnState = 'none';
  }
}

/* ======================= run state / buttons ======================= */

function setRunning(running, paused = false) {
  app.isRunning = running;
  app.paused = paused;

  const b = ui('startBtn');
  if (!b) return;

  if (running) {
    b.textContent = '⏸ Tạm dừng';
    b.classList.add('paused');
  } else if (paused || app.loadedProject) {
    b.textContent = '▶ Tiếp tục';
    b.classList.remove('paused');
  } else {
    // (1.7.0) Ở chế độ chia danh sách, nói rõ nút này sẽ chạy cho tab nào để
    // không ai bấm "Bắt đầu" rồi lại bấm "Chạy tất cả" -> chạy trùng prompt.
    const ready = app.flowTabs.filter(t => t.ready).length;
    b.textContent = (app.settings.multiTab && app.settings.multiTabMode === 'split' && ready > 1)
      ? `▶ Bắt đầu (chia ${ready} tab)`
      : '▶ Bắt đầu';
    b.classList.remove('paused');
  }
  ui('stopBtn').disabled = !running && !paused;
}

function startElapsed() {
  if (!app.startTime) app.startTime = Date.now();
  clearInterval(app.elapsedTimer);
  const tick = () => {
    const s = Math.floor(Math.max(0, Date.now() - app.startTime) / 1000);
    const parts = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60];
    ui('elapsed').textContent = parts.map(v => String(v).padStart(2, '0')).join(':');
  };
  tick();
  app.elapsedTimer = setInterval(tick, 1000);
}

function stopElapsed() {
  clearInterval(app.elapsedTimer);
  app.elapsedTimer = null;
}

/* ====================== progress table render ====================== */

const STATUS_BADGE = {
  WAITING:   { cls: 'wait', label: 'Chờ' },
  PASTING:   { cls: 'run',  label: 'Đang dán' },
  CREATING:  { cls: 'run',  label: 'Đang tạo' },
  COMPLETED: { cls: 'done', label: 'Xong' },
  ERROR:     { cls: 'err',  label: 'Lỗi' }
};

function pillFor(sv) {
  const el = document.createElement('span');
  if (sv.status === 'COMPLETED')      { el.className = 'pill p-done'; el.textContent = '✓'; }
  else if (sv.status === 'ERROR')     { el.className = 'pill p-err';  el.textContent = '✕'; }
  else if (sv.status === 'UPSCALING') { el.className = 'pill p-up';   el.textContent = '⬆'; }
  else if (sv.status === 'CREATING')  { el.className = 'pill p-run';  el.textContent = sv.progress > 0 ? `${sv.progress}%` : '···'; }
  else if (sv.status === 'QUEUED')    { el.className = 'pill p-wait'; el.textContent = '⏳'; }
  else                                { el.className = 'pill p-wait'; el.textContent = '–'; }
  return el;
}

function renderTable() {
  const body = ui('progressBody');
  body.textContent = '';

  const rows = app.tableRows.filter(r => {
    if (app.statusFilter === 'all') return true;
    if (app.statusFilter === 'CREATING') return r.status === 'CREATING' || r.status === 'PASTING';
    return r.status === app.statusFilter;
  });

  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'empty';
    td.textContent = app.tableRows.length ? 'Không có dòng nào khớp bộ lọc.' : 'Chưa có tác vụ nào.';
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  for (const r of rows) {
    const tr = document.createElement('tr');
    if (r.status === 'ERROR') tr.className = 'row-err';
    else if (r.status === 'COMPLETED') tr.className = 'row-done';

    // #
    const tdIdx = document.createElement('td');
    tdIdx.className = 'idxcell';
    tdIdx.textContent = String(r.index);
    tr.appendChild(tdIdx);

    // prompt + status
    const tdMain = document.createElement('td');

    const pText = document.createElement('div');
    pText.className = 'ptext' + (app.expanded.has(r.index) ? ' expanded' : '');
    pText.textContent = r.prompt || '(prompt trống)';
    pText.title = 'Bấm để mở rộng / thu gọn toàn bộ prompt';
    pText.addEventListener('click', () => {
      if (app.expanded.has(r.index)) app.expanded.delete(r.index);
      else app.expanded.add(r.index);
      pText.classList.toggle('expanded');
    });
    tdMain.appendChild(pText);

    if ((r.prompt || '').length > 90) {
      const more = document.createElement('span');
      more.className = 'ptext-more';
      more.textContent = `${fmtNumber(r.prompt.length)} ký tự — bấm để xem đủ`;
      tdMain.appendChild(more);
    }

    const line = document.createElement('div');
    line.className = 'statusline';

    const badgeInfo = STATUS_BADGE[r.status] || STATUS_BADGE.WAITING;
    const badge = document.createElement('span');
    badge.className = `sbadge ${badgeInfo.cls}`;
    badge.textContent = (r.status === 'CREATING' && r.progress > 0) ? `${badgeInfo.label} ${r.progress}%` : badgeInfo.label;
    line.appendChild(badge);

    if (r.subVideos?.length) {
      const pills = document.createElement('span');
      pills.className = 'pills';
      r.subVideos.forEach(sv => pills.appendChild(pillFor(sv)));
      line.appendChild(pills);
    } else if (r.status === 'CREATING') {
      const hint = document.createElement('span');
      hint.className = 'sbadge warn';
      hint.textContent = r.missingTiles ? 'thẻ bị khuất' : (r.stuck ? 'đang kẹt' : 'đang dò thẻ');
      line.appendChild(hint);
    }

    if (r.status === 'COMPLETED' && app.tableMeta.autoRename) {
      const rn = document.createElement('span');
      if (r.renamed) { rn.className = 'sbadge done'; rn.textContent = '✎ đã đổi tên'; }
      else if (r.renameSkipped) { rn.className = 'sbadge warn'; rn.textContent = '✎ bỏ qua'; }
      if (rn.className) line.appendChild(rn);
    }

    if (r.downloadError) {
      const de = document.createElement('span');
      de.className = 'sbadge err';
      de.textContent = '⬇ lỗi tải';
      line.appendChild(de);
    }

    tdMain.appendChild(line);

    const bar = document.createElement('div');
    bar.className = 'rowbar' + (r.status === 'ERROR' ? ' err' : (r.status === 'COMPLETED' ? ' done' : ''));
    const fill = document.createElement('i');
    fill.style.width = `${r.status === 'COMPLETED' ? 100 : Math.max(0, Math.min(100, r.progress))}%`;
    bar.appendChild(fill);
    tdMain.appendChild(bar);

    if (r.error) {
      const err = document.createElement('span');
      err.className = 'errtext';
      err.textContent = r.error;
      tdMain.appendChild(err);
    }

    tr.appendChild(tdMain);

    // downloads
    const tdDl = document.createElement('td');
    tdDl.className = 'c-dl';
    tdDl.textContent = app.tableMeta.autoDownload
      ? `${r.downloadedCount}/${r.totalVideos || '?'}`
      : '–';
    tr.appendChild(tdDl);

    // retries
    const tdRt = document.createElement('td');
    tdRt.className = 'c-rt';
    tdRt.textContent = String(r.retries || 0);
    tr.appendChild(tdRt);

    body.appendChild(tr);
  }
}

function renderOverall() {
  const rows = app.tableRows;
  if (!rows.length) { ui('overallFill').style.width = '0%'; return; }
  const done = rows.filter(r => r.status === 'COMPLETED' || r.status === 'ERROR').length;
  ui('overallFill').style.width = `${Math.round((done / rows.length) * 100)}%`;
}

/* ============================ projects ============================ */

async function renderProjects() {
  const { veoProjects = {} } = await chrome.storage.local.get('veoProjects');
  app.projects = Object.values(veoProjects).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  drawProjects();

  if (chrome.storage.local.getBytesInUse) {
    const bytes = await chrome.storage.local.getBytesInUse(null);
    const mb = bytes / 1048576;
    ui('storageInfo').textContent =
      `Đang dùng ${mb.toFixed(2)} MB bộ nhớ trình duyệt (giới hạn khoảng 10 MB). ` +
      (mb > 6.5 ? 'Sắp đầy — hãy xoá dự án cũ.' : 'Còn thoải mái.');
  }
}

function drawProjects() {
  const box = ui('projectList');
  const q = (ui('projectSearch').value || '').trim().toLowerCase();
  box.textContent = '';

  const items = app.projects.filter(p => !q || String(p.name || '').toLowerCase().includes(q));

  if (!items.length) {
    const d = document.createElement('p');
    d.className = 'note';
    d.textContent = app.projects.length ? 'Không có dự án nào khớp từ khoá.' : 'Chưa có dự án đã lưu.';
    box.appendChild(d);
    return;
  }

  for (const p of items) {
    const done = (p.videos || []).filter(v => v.status === 'COMPLETED').length;
    const failed = (p.videos || []).filter(v => v.status === 'ERROR').length;

    const d = document.createElement('div');
    d.className = 'project';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = p.name || 'Project';

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent =
      `${fmtNumber((p.prompts || []).length)} prompt · ✓${done} · ✕${failed} · ` +
      new Date(p.timestamp || Date.now()).toLocaleString('vi-VN');

    const bs = document.createElement('div');
    bs.className = 'buttons';

    const load = document.createElement('button');
    load.className = 'mini-btn';
    load.textContent = 'Nạp lại';
    load.onclick = async () => {
      try {
        await sendToActiveFlow('LOAD_PROJECT', { projectName: p.name });
        log('info', `Đã yêu cầu nạp dự án: ${p.name}`);
        toast('Đang nạp dự án…');
      } catch (e) { toast(e.message, 'err'); }
    };

    const del = document.createElement('button');
    del.className = 'mini-btn danger';
    del.textContent = 'Xoá';
    del.onclick = async () => {
      if (!confirm(`Xoá dự án "${p.name}"?`)) return;
      const { veoProjects = {} } = await chrome.storage.local.get('veoProjects');
      delete veoProjects[p.name];
      await chrome.storage.local.set({ veoProjects });
      await broadcastFlow('DELETE_PROJECT', { projectName: p.name });
      renderProjects();
      toast('Đã xoá dự án', 'ok');
    };

    bs.append(load, del);
    d.append(title, meta, bs);
    box.appendChild(d);
  }
}

/* ======================= txt import / export ======================= */

async function importTxtFiles(fileList) {
  const files = Array.from(fileList || []).filter(f => f && /\.(txt|text)$/i.test(f.name) || f.type === 'text/plain');
  if (!files.length) { toast('Chỉ hỗ trợ file .txt', 'err'); return; }

  const chunks = [];
  for (const f of files) {
    try {
      const text = await f.text();
      chunks.push(text.replace(/^﻿/, ''));   // bỏ BOM
    } catch (e) {
      log('error', `Không đọc được ${f.name}: ${e.message}`);
    }
  }
  if (!chunks.length) { toast('Không đọc được file nào', 'err'); return; }

  const mode = ui('promptSeparator').value;
  const incoming = chunks.map(c => parsePrompts(c, mode)).flat();
  if (!incoming.length) {
    toast('File không có prompt nào (kiểm tra lại cách tách)', 'err');
    return;
  }

  const existing = app.prompts.slice();
  let merged = incoming;
  if (existing.length) {
    merged = confirm(
      `Đang có ${existing.length} prompt trong khung.\n\n` +
      `OK = THÊM ${incoming.length} prompt từ file vào cuối.\n` +
      `Cancel = THAY THẾ toàn bộ bằng ${incoming.length} prompt từ file.`
    ) ? existing.concat(incoming) : incoming;
  }

  ui('promptsInput').value = joinPrompts(merged, mode);
  refreshPromptStats();
  log('success', `Đã nạp ${incoming.length} prompt từ ${files.length} file .txt.`);
  toast(`Đã nạp ${incoming.length} prompt`, 'ok');
}

function exportTxt() {
  if (!app.prompts.length) { toast('Chưa có prompt nào để xuất', 'err'); return; }
  const mode = ui('promptSeparator').value;
  const content = joinPrompts(app.prompts, mode) + '\n';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const filename = `flow-prompts_${app.prompts.length}_${stamp}.txt`;

  // Side panel là trang extension bình thường nên dùng được Blob URL.
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);

  log('success', `Đã xuất ${app.prompts.length} prompt ra ${filename}`);
  toast('Đã xuất file .txt', 'ok');
}

function saveLogsTxt() {
  if (!app.logs.length) { toast('Chưa có log nào', 'err'); return; }
  const content = app.logs.map(l => `[${l.time}] [${l.type.toUpperCase()}] ${l.message}`).join('\n') + '\n';
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `flow-automation-log_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
  toast('Đã lưu log', 'ok');
}

/* ═══════════════════════════ ẢNH → VIDEO ═══════════════════════════ */

/** Danh sách mã ảnh theo cấu hình: từ..đến, số chữ số, tiền tố/hậu tố. */
function i2vImageNames() {
  const from = Number.parseInt(ui('i2vFrom').value, 10);
  const to = Number.parseInt(ui('i2vTo').value, 10);
  const pad = Math.min(6, Math.max(1, Number.parseInt(ui('i2vPad').value, 10) || 2));
  const pre = (ui('i2vNamePrefix').value || '').trim();
  const suf = (ui('i2vNameSuffix').value || '').trim();

  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) return [];
  if (to - from > 999) return [];   // chặn nhập sai kiểu 1..100000

  const out = [];
  for (let i = from; i <= to; i++) out.push(`${pre}${String(i).padStart(pad, '0')}${suf}`);
  return out;
}

/** Mã ảnh phải khớp regex @tag của Character Sync: chỉ chữ, số, gạch dưới. */
function i2vInvalidNames(names) {
  return names.filter(n => !/^[\p{L}\p{N}_]+$/u.test(n));
}

function i2vLineFor(name, index) {
  const usePromptList = ui('i2vUsePromptList').checked;
  const shared = (ui('i2vPrompt').value || '').trim();
  const perLine = usePromptList ? (app.prompts[index] || '').trim() : '';
  const body = perLine || shared;
  // Đặt mã ảnh ở CUỐI để câu lệnh đọc tự nhiên; Character Sync quét @tag ở mọi vị trí.
  return body ? `${body} @${name}` : `@${name}`;
}

function updateI2vPreview() {
  const box = ui('i2vPreview');
  if (!box) return;
  const names = i2vImageNames();
  ui('i2vCount').textContent = `${fmtNumber(names.length)} video`;

  if (!names.length) {
    box.textContent = 'Kiểm tra lại "Từ ảnh số" / "Đến ảnh số".';
    return;
  }
  const bad = i2vInvalidNames(names);
  if (bad.length) {
    box.textContent = `Mã ảnh không hợp lệ: ${bad.slice(0, 3).join(', ')} — chỉ dùng chữ, số và gạch dưới.`;
    return;
  }
  const line = i2vLineFor(names[0], 0);
  box.textContent = line.length > 220 ? line.slice(0, 220) + '…' : line;
}

function i2vGenerate() {
  const names = i2vImageNames();
  if (!names.length) { toast('Kiểm tra lại khoảng số ảnh', 'err'); return; }

  const bad = i2vInvalidNames(names);
  if (bad.length) {
    toast(`Mã ảnh không hợp lệ: ${bad[0]} (chỉ chữ, số, gạch dưới)`, 'err');
    return;
  }

  const usePromptList = ui('i2vUsePromptList').checked;
  const shared = (ui('i2vPrompt').value || '').trim();
  if (!shared && !usePromptList) {
    toast('Hãy nhập prompt chung cho mọi ảnh', 'err');
    return;
  }

  const existing = app.prompts.length;
  if (existing && !confirm(
    `Tab Chạy đang có ${existing} prompt.\n\n` +
    `Danh sách mới (${names.length} dòng) sẽ THAY THẾ toàn bộ. Tiếp tục?`
  )) return;

  const lines = names.map((n, i) => i2vLineFor(n, i));

  // Mỗi dòng là một prompt -> buộc kiểu tách "line" để không bị hiểu sai.
  ui('promptSeparator').value = 'line';
  ui('promptsInput').value = lines.join('\n');
  app.endTouched = false;
  refreshPromptStats();

  // Bật Character Sync (cơ chế đính kèm ảnh theo @tên) + chế độ Video.
  ui('charSync').checked = true;
  ui('keyframeSync').checked = false;
  const videoRadio = document.querySelector('input[name="runMode"][value="video"]');
  if (videoRadio) videoRadio.checked = true;
  ui('charSyncStripTag').checked = ui('i2vStripTag').checked;

  updateConditionalUI();
  saveSettings();

  // Chuyển sang tab Chạy
  document.querySelector('.tab[data-tab="run"]')?.click();

  log('success', `Đã sinh ${lines.length} prompt Ảnh → Video (${names[0]} … ${names[names.length - 1]}). Đã bật Character Sync.`);
  if (ui('renameMode').value === 'default' && !usePromptList) {
    log('warning', 'Mọi video dùng cùng một prompt nên tên file sẽ gần giống nhau — nên đổi sang Cài đặt → Đổi tên file → "Chỉ số thứ tự".');
  }
  toast(`Đã sinh ${lines.length} prompt — kiểm tra rồi bấm Bắt đầu`, 'ok');
}

/* ───────── Chọn folder ảnh & đẩy lên Flow (thử nghiệm) ───────── */

app.pickedImages = [];

function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function handlePickedFiles(fileList) {
  const files = Array.from(fileList || []).filter(f => /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name));
  if (!files.length) {
    ui('folderInfo').textContent = 'Không tìm thấy ảnh nào trong lựa chọn đó.';
    ui('uploadToFlowBtn').disabled = true;
    return;
  }
  // Sắp xếp theo số trong tên (01, 2, 10 -> 01, 2, 10) để thứ tự đúng như mong đợi.
  files.sort((a, b) => naturalCompare(a.name, b.name));
  app.pickedImages = files;

  const totalMb = files.reduce((s, f) => s + f.size, 0) / 1048576;
  ui('folderInfo').textContent =
    `${files.length} ảnh · ${totalMb.toFixed(1)} MB · thứ tự: ${files[0].name} → ${files[files.length - 1].name}`;
  ui('uploadToFlowBtn').disabled = false;

  const ol = ui('folderPreview');
  ol.textContent = '';
  files.slice(0, 60).forEach(f => {
    const li = document.createElement('li');
    li.textContent = f.name.replace(/\.[^.]+$/, '');
    const len = document.createElement('span');
    len.className = 'plen';
    len.textContent = `(${(f.size / 1024).toFixed(0)} KB)`;
    li.appendChild(len);
    ol.appendChild(li);
  });
  if (files.length > 60) {
    const li = document.createElement('li');
    li.className = 'plen';
    li.textContent = `… và ${files.length - 60} ảnh nữa`;
    ol.appendChild(li);
  }

  // Gợi ý khoảng số từ chính tên tệp đã chọn.
  const nums = files.map(f => (f.name.match(/(\d+)/) || [])[1]).filter(Boolean).map(Number);
  if (nums.length) {
    ui('i2vFrom').value = String(Math.min(...nums));
    ui('i2vTo').value = String(Math.max(...nums));
    const firstDigits = (files[0].name.match(/(\d+)/) || ['', ''])[1];
    if (firstDigits) ui('i2vPad').value = String(Math.min(6, Math.max(1, firstDigits.length)));
    updateI2vPreview();
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error('Không đọc được tệp'));
    fr.readAsDataURL(file);
  });
}

async function uploadPickedImagesToFlow() {
  if (!app.pickedImages.length) { toast('Chưa chọn ảnh nào', 'err'); return; }

  const btn = ui('uploadToFlowBtn');
  btn.disabled = true;
  const status = ui('folderInfo');

  // Gửi theo lô nhỏ: message của Chrome phải serialize sang JSON nên data URL
  // rất nặng; gửi cả 50 ảnh một lần dễ vượt giới hạn message.
  const BATCH = 3;
  let done = 0, failed = 0;

  try {
    for (let i = 0; i < app.pickedImages.length; i += BATCH) {
      const slice = app.pickedImages.slice(i, i + BATCH);
      const images = [];
      for (const f of slice) {
        try {
          images.push({ name: f.name, type: f.type, dataUrl: await readFileAsDataUrl(f) });
        } catch (e) {
          failed++;
          log('error', `Không đọc được ${f.name}: ${e.message}`);
        }
      }
      if (!images.length) continue;

      status.textContent = `Đang đẩy ${i + 1}–${Math.min(i + BATCH, app.pickedImages.length)} / ${app.pickedImages.length}…`;

      let res;
      try {
        res = await sendToActiveFlowAwait('UPLOAD_IMAGES_TO_FLOW', { images });
      } catch (e) {
        toast(e.message, 'err');
        log('error', `Đẩy ảnh thất bại: ${e.message}`);
        break;
      }

      if (res?.ok) {
        done += res.uploaded || images.length;
      } else {
        failed += images.length;
        log('error', `Flow không nhận ảnh: ${res?.error || 'không rõ lý do'}`);
        toast(res?.error || 'Flow không nhận ảnh', 'err');
        break;   // lỗi giao diện thì dừng, không spam tiếp
      }
      await new Promise(r => setTimeout(r, 1200));
    }
  } finally {
    btn.disabled = false;
  }

  status.textContent = `Đã đẩy ${done}/${app.pickedImages.length} ảnh lên Flow${failed ? ` · lỗi ${failed}` : ''}.`;
  if (done) {
    toast(`Đã đẩy ${done} ảnh lên Flow`, 'ok');
    log('success', `Đã đẩy ${done} ảnh lên kho Flow. Hãy kiểm tra trong menu [+] → Hình ảnh.`);
  }
}

async function i2vCheckAssets() {
  const names = i2vImageNames();
  if (!names.length) { toast('Kiểm tra lại khoảng số ảnh', 'err'); return; }

  const sample = names.slice(0, 12);   // chỉ dò mẫu để không mất quá nhiều thời gian
  const status = ui('i2vStatus');
  status.textContent = `Đang dò ${sample.length} mã ảnh đầu tiên trong kho Flow…`;

  try {
    const res = await sendToActiveFlowAwait('CHECK_ASSET_NAMES', { names: sample });
    if (!res?.ok) {
      status.textContent = `⚠️ ${res?.error || 'Không kiểm tra được.'}`;
      return;
    }
    if (res.missing.length === 0) {
      status.textContent = `✅ Tìm thấy đủ ${res.found.length}/${sample.length} mã ảnh mẫu trong kho Flow. Sinh danh sách là chạy được.`;
    } else {
      status.textContent =
        `⚠️ Thiếu ${res.missing.length}/${sample.length} mã: ${res.missing.slice(0, 8).join(', ')}` +
        `${res.missing.length > 8 ? '…' : ''}. Hãy tải các ảnh này lên Flow (Bước 1) hoặc kiểm tra lại tiền tố/số chữ số.`;
    }
  } catch (e) {
    status.textContent = `⚠️ ${e.message}`;
  }
}

/* ═════════════ KIỂM TRA "HỎI VỊ TRÍ LƯU" CỦA CHROME ═════════════ */

async function checkSaveAsSetting() {
  const box = ui('saveAsBox');
  const status = ui('saveAsStatus');
  const guide = ui('saveAsGuide');
  const btn = ui('checkSaveAsBtn');

  btn.disabled = true;
  box.className = 'alertbox';
  guide.classList.add('hidden');
  status.textContent = 'Đang kiểm tra… Nếu có hộp thoại chọn nơi lưu hiện ra, hãy bấm Cancel — đó chính là dấu hiệu cài đặt đang BẬT.';

  let res;
  try {
    res = await chrome.runtime.sendMessage({ action: 'PROBE_SAVE_AS_PROMPT' });
  } catch (e) {
    res = { status: 'unknown', reason: e.message };
  } finally {
    btn.disabled = false;
  }

  if (res?.status === 'off') {
    box.classList.add('off');
    status.textContent = '✅ Đang TẮT — Chrome tải thẳng về thư mục mặc định. Automation chạy bình thường.';
    log('success', 'Kiểm tra Chrome: "Hỏi vị trí lưu mỗi tệp" đang TẮT.');
  } else if (res?.status === 'on') {
    box.classList.add('on');
    status.textContent = '⛔ Đang BẬT — mỗi lần tải Chrome sẽ hiện hộp thoại chọn nơi lưu và automation sẽ bị treo ở đó. Hãy tắt theo 4 bước dưới đây.'
      + (res.note ? ` (${res.note})` : '');
    guide.classList.remove('hidden');
    log('warning', 'Kiểm tra Chrome: "Hỏi vị trí lưu mỗi tệp" đang BẬT — cần tắt trước khi chạy.');
  } else {
    box.classList.add('unknown');
    status.textContent = `⚠️ Chưa kết luận được. ${res?.reason || ''} Hãy kiểm tra thủ công theo các bước dưới.`;
    guide.classList.remove('hidden');
  }
}

/* ============================== start ============================== */

async function doStart() {
  try {
    await saveSettings();

    if (app.isRunning) {
      // (1.7.0) Đa tab: chỉ tạm dừng TAB ĐANG XEM. Bản cũ phát cho mọi tab nên
      // bấm tạm dừng ở một cửa sổ là dừng luôn việc của các cửa sổ khác.
      if (app.settings.multiTab) await sendToActiveFlow('PAUSE_AUTOMATION', {});
      else await broadcastFlow('PAUSE_AUTOMATION', {});
      setRunning(false, true);
      stopElapsed();
      log('warning', 'Đã gửi lệnh tạm dừng.');
      return;
    }

    // Chế độ chia danh sách + có nhiều tab sẵn sàng -> chia việc luôn.
    if (app.settings.multiTab && app.settings.multiTabMode === 'split'
        && app.flowTabs.filter(t => t.ready).length > 1) {
      await startAllTabs();
      return;
    }

    if (app.loadedProject) {
      await sendToActiveFlow('RESUME_LOADED_PROJECT', { settings: app.settings });
      app.loadedProject = false;
      setRunning(true);
      startElapsed();
      log('success', 'Tiếp tục dự án đã lưu.');
      return;
    }

    if (app.paused) {
      await sendToActiveFlow('RESUME_AUTOMATION', {});
      setRunning(true);
      startElapsed();
      log('success', 'Tiếp tục automation.');
      return;
    }

    refreshPromptStats();
    const jobs = selectedJobs();
    if (!jobs.length) {
      toast('Hãy nhập và chọn ít nhất một prompt', 'err');
      return;
    }
    if (lastConnState !== 'ok') {
      const proceed = confirm('Tab đang mở không phải Google Flow (hoặc script chưa sẵn sàng).\nVẫn thử bắt đầu?');
      if (!proceed) return;
    }

    app.startTime = Date.now();
    app.paused = false;
    app.loadedProject = false;
    ui('summary').classList.add('hidden');

    await sendToActiveFlow('START_AUTOMATION', {
      prompts: app.prompts,
      videosToCreate: jobs,
      settings: app.settings
    });

    setRunning(true);
    startElapsed();
    log('success', `Bắt đầu ${jobs.length} prompt.`);
    toast(`Đã bắt đầu ${jobs.length} prompt`, 'ok');
  } catch (e) {
    log('error', e.message);
    toast(e.message, 'err');
    setRunning(false, false);
  }
}

/* ========================= message listener ========================= */

chrome.runtime.onMessage.addListener((message, sender) => {
  const a = message?.action;

  // (1.7.0) Tin nhắn từ content script LUÔN kèm sender.tab.id, nên panel biết
  // nó của tab nào mà không cần content script tự khai. Chạy nhiều tab thì mỗi
  // tab có bảng tiến trình riêng; panel chỉ vẽ bảng của tab đang chọn.
  const fromTab = sender?.tab?.id || null;
  const multi = !!app.settings.multiTab;
  const isSelected = !multi || !fromTab || fromTab === app.selectedTabId;
  const tabPrefix = () => {
    if (!multi || !fromTab) return '';
    const t = app.flowTabs.find(x => x.tabId === fromTab);
    return `[T${t?.slot || fromTab}] `;
  };
  const stateFor = (id) => (app.tabStates[id] = app.tabStates[id] || { rows: [], meta: {}, stats: {} });

  if (a === 'LOG') {
    log(message.type || 'info', tabPrefix() + (message.message || ''));

  } else if (a === 'UPDATE_STATS') {
    if (fromTab) {
      const st = stateFor(fromTab);
      st.stats = { creating: message.data?.creating ?? 0, completed: message.data?.completed ?? 0, error: message.data?.error ?? 0 };
    }
    if (isSelected) {
      ui('statCreating').textContent = message.data?.creating ?? 0;
      ui('statCompleted').textContent = message.data?.completed ?? 0;
      ui('statError').textContent = message.data?.error ?? 0;
    }

  } else if (a === 'UPDATE_TABLE_DATA') {
    const d = message.data || {};
    const rows = Array.isArray(d.rows) ? d.rows : [];
    const meta = { autoDownload: !!d.autoDownload, autoRename: !!d.autoRename };
    if (fromTab) {
      const st = stateFor(fromTab);
      st.rows = rows; st.meta = meta; st.projectName = d.projectName || '';
    }
    if (!isSelected) return;      // bảng của tab khác: chỉ lưu, không vẽ
    app.tableRows = rows;
    app.tableMeta = meta;
    if (d.startTime && !app.startTime) { app.startTime = d.startTime; startElapsed(); }
    // Lưu tên dự án để biến {project} trong thư mục lưu dùng được.
    // Chỉ ghi khi THAY ĐỔI, tránh viết storage mỗi 3 giây.
    if (d.projectName && d.projectName !== app.settings.activeProjectName) {
      app.settings.activeProjectName = d.projectName;
      chrome.storage.local.set({ veoSettings: app.settings }).catch(() => {});
      updateRenamePreview();
    }
    renderTable();
    renderOverall();

  } else if (a === 'UPDATE_PROGRESS') {
    if (message.data?.isRunning && isSelected) {
      setRunning(true);
      if (!app.startTime) app.startTime = Date.now();
      startElapsed();
    }

  } else if (a === 'AUTOMATION_RESUMED') {
    if (!isSelected) return;
    setRunning(true);
    if (!app.startTime) app.startTime = Date.now();
    startElapsed();

  } else if (a === 'AUTOMATION_STOPPED') {
    // Đa tab: tab khác dừng thì KHÔNG được chuyển nút của panel về "Bắt đầu",
    // vì tab đang xem có thể vẫn đang chạy.
    if (!isSelected) {
      if (message.summary) log('warning', tabPrefix() + message.summary);
      renderProjects();
      return;
    }
    setRunning(false, false);
    app.paused = false;
    app.loadedProject = false;
    stopElapsed();
    if (message.summary) {
      const s = ui('summary');
      // Nội dung từ content script là HTML -> chỉ lấy text để tránh inject.
      const doc = new DOMParser().parseFromString(`<div>${message.summary}</div>`, 'text/html');
      s.textContent = (doc.body.textContent || '').trim();
      s.classList.remove('hidden');
    }
    renderProjects();

  } else if (a === 'PROJECT_LOADED') {
    const d = message.data || {};
    app.prompts = d.prompts || [];
    applySettings(d.settings || {});
    ui('promptsInput').value = joinPrompts(app.prompts, ui('promptSeparator').value);
    refreshPromptStats();
    app.startTime = d.startTime || 0;
    app.loadedProject = !d.isFinished && !d.isRunning;
    setRunning(!!d.isRunning, false);
    if (app.startTime) startElapsed();
    log('success', `Đã nạp dự án ${d.projectName || ''}`);

  } else if (a === 'SAVE_PROJECT' || a === 'PROJECT_DELETED') {
    renderProjects();

  } else if (a === 'PICK_RESULT') {
    // (1.8.0) Nhận selector cho BẤT KỲ phần tử nào trong sổ đăng ký, không
    // chỉ riêng nút ⋮ như bản cũ.
    const { targetType, selector, matches, element } = message.data || {};
    if (targetType && selector) {
      app.settings.selectors = { ...(app.settings.selectors || {}), [targetType]: selector };
      chrome.storage.local.set({ veoSettings: app.settings });
      broadcastFlow('UPDATE_SETTINGS', app.settings);
      log('success', `Đã lưu selector cho [${targetType}]: ${selector}` +
        (matches ? ` — khớp ${matches} phần tử` : ''));
      if (element?.aria || element?.text) {
        log('info', `   phần tử đã chọn: <${element.tag}> ${element.aria || element.text}`);
      }
      toast('Đã lưu selector — đang kiểm tra lại', 'ok');
      hideUiBreakBanner();
      runDiagnostics();
    } else if (targetType) {
      log('warning', `Không sinh được selector cho [${targetType}] — hãy thử bấm vào phần tử cha (khung ngoài) hoặc nhập tay.`);
      toast('Không sinh được selector, thử chọn khung ngoài', 'err');
    }

  } else if (a === 'PICK_CANCELLED') {
    toast('Đã huỷ chọn phần tử', '');

  } else if (a === 'UI_BREAK') {
    // Content script báo: dò trượt một phần tử quá nhiều lần.
    const d = message.data || {};
    showUiBreakBanner(d.label || d.key, d.misses || 0);
    ui('logBadge').classList.remove('hidden');

  } else if (a === 'SHUTDOWN_TRIGGERED') {
    ui('cancelShutdownBtn').classList.remove('hidden');
    ui('nativeStatus').textContent = 'Đã hẹn tắt máy. Bạn có thể hủy.';

  } else if (a === 'SHUTDOWN_CANCELLED') {
    ui('cancelShutdownBtn').classList.add('hidden');
    ui('nativeStatus').textContent = 'Đã hủy lệnh tắt máy.';
  }
});

/* ============================== boot ============================== */

document.addEventListener('DOMContentLoaded', async () => {
  const { veoSettings } = await chrome.storage.local.get('veoSettings');
  applySettings(veoSettings);
  refreshPromptStats();
  await checkConnection();
  await renderProjects();

  /* Kiểm tra bản mới (1.9.0) — TUYỆT ĐỐI không await ở đây.
     Phần khởi tạo phía dưới (gắn sự kiện cho các tab, các nút) phải chạy xong
     đã; nếu chờ background ở đây mà worker không phản hồi thì panel đứng im,
     không bấm được tab nào. Hiện kết quả đã lưu trước cho đỡ trống, rồi hỏi
     lại (worker tự throttle 6 giờ). */
  refreshUpdateUI()
    .then(() => {
      if (app.settings.updateCheckEnabled !== false) return doUpdateCheck(false);
    })
    .catch(() => {});

  /* --- tabs --- */
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => {
      const on = x === b;
      x.classList.toggle('active', on);
      x.setAttribute('aria-selected', String(on));
    });
    document.querySelectorAll('.tabpane').forEach(p => p.classList.remove('active'));
    ui(`tab-${b.dataset.tab}`).classList.add('active');
    if (b.dataset.tab === 'projects') renderProjects();
    if (b.dataset.tab === 'logs') {
      ui('logBadge').classList.add('hidden');
      ui('logBadge').textContent = '0';
      renderLogs();
    }
  }));

  /* --- theme --- */
  ui('themeBtn').onclick = () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    saveSettings();
  };

  ui('openFlowBtn').onclick = () => chrome.tabs.create({ url: 'https://flow.google.com/' });
  ui('refreshConnBtn').onclick = checkConnection;

  /* --- prompt list --- */
  ui('promptsInput').addEventListener('input', refreshPromptStats);
  ui('promptSeparator').addEventListener('change', () => { refreshPromptStats(); saveSettings(); });

  ui('importTxtBtn').onclick = () => ui('txtFileInput').click();
  ui('txtFileInput').addEventListener('change', async (e) => {
    await importTxtFiles(e.target.files);
    e.target.value = '';
  });
  ui('exportTxtBtn').onclick = exportTxt;

  ui('dedupeBtn').onclick = () => {
    const before = app.prompts.length;
    const seen = new Set();
    const out = [];
    for (const p of app.prompts) {
      const key = p.replace(/\s+/g, ' ').trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
    ui('promptsInput').value = joinPrompts(out, ui('promptSeparator').value);
    refreshPromptStats();
    const removed = before - out.length;
    toast(removed ? `Đã bỏ ${removed} prompt trùng` : 'Không có prompt trùng', removed ? 'ok' : '');
  };

  ui('clearPromptsBtn').onclick = () => {
    if (!app.prompts.length) return;
    if (!confirm(`Xoá toàn bộ ${app.prompts.length} prompt trong khung?`)) return;
    ui('promptsInput').value = '';
    refreshPromptStats();
  };

  /* drag & drop .txt */
  const dz = ui('dropZone');
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { stop(e); dz.classList.add('dragover'); }));
  ['dragleave', 'dragend'].forEach(ev => dz.addEventListener(ev, (e) => { stop(e); dz.classList.remove('dragover'); }));
  dz.addEventListener('drop', async (e) => {
    stop(e);
    dz.classList.remove('dragover');
    await importTxtFiles(e.dataTransfer?.files);
  });

  /* --- range --- */
  ['startIndex', 'endIndex', 'customIndices'].forEach(id => ui(id).addEventListener('input', updateRangeInfo));
  // Ghi nhận người dùng đã tự chỉnh "Đến dòng" để không tự ghi đè nữa.
  ui('endIndex').addEventListener('input', () => { app.endTouched = true; });
  ui('useCustomRange').onchange = () => { updateConditionalUI(); updateRangeInfo(); };
  document.querySelectorAll('.quickrange .pill-btn').forEach(b => b.addEventListener('click', () => {
    const total = Math.max(1, app.prompts.length);
    if (b.dataset.range === 'all') { ui('startIndex').value = 1; ui('endIndex').value = total; }
    if (b.dataset.range === 'first10') { ui('startIndex').value = 1; ui('endIndex').value = Math.min(10, total); }
    if (b.dataset.range === 'last10') { ui('startIndex').value = Math.max(1, total - 9); ui('endIndex').value = total; }
    app.endTouched = true;
    ui('useCustomRange').checked = false;
    updateConditionalUI();
    updateRangeInfo();
  }));

  /* --- status filter --- */
  document.querySelectorAll('#statusFilter .pill-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#statusFilter .pill-btn').forEach(x => x.classList.toggle('active', x === b));
    app.statusFilter = b.dataset.filter;
    renderTable();
  }));

  /* --- log filter --- */
  document.querySelectorAll('#logFilter .pill-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#logFilter .pill-btn').forEach(x => x.classList.toggle('active', x === b));
    app.logFilter = b.dataset.log;
    renderLogs();
  }));

  /* --- run controls --- */
  ui('startBtn').onclick = doStart;

  ui('stopBtn').onclick = async () => {
    if (!confirm('Dừng hẳn automation? Tiến trình đã lưu vẫn còn trong tab Dự án.')) return;
    await broadcastFlow('STOP_AUTOMATION', {});
    setRunning(false, false);
    stopElapsed();
    toast('Đã dừng automation');
  };

  ui('resetBtn').onclick = async () => {
    if (!confirm('Đặt lại tiến trình hiện tại? Danh sách prompt vẫn được giữ.')) return;
    await broadcastFlow('RESET_AUTOMATION', {});
    app.startTime = 0;
    app.paused = false;
    app.loadedProject = false;
    app.tableRows = [];
    setRunning(false, false);
    stopElapsed();
    ui('elapsed').textContent = '00:00:00';
    ui('summary').classList.add('hidden');
    ['statCreating', 'statCompleted', 'statError'].forEach(id => ui(id).textContent = '0');
    renderTable();
    renderOverall();
    toast('Đã đặt lại', 'ok');
  };

  /* --- settings autosave --- */
  const settingIds = [
    'outputCount', 'aspectRatio', 'delayMin', 'delayMax', 'maxRetries', 'randomScroll',
    'zoomLevel', 'addIndex', 'charSync', 'keyframeSync', 'voiceSync', 'voiceSelect',
    'charSyncStripTag', 'autoRename', 'renameMode', 'renameStartIndex', 'renameCustomList', 'renameMaxLen',
    'renameIndexPad', 'renamePrefix', 'renameSuffix', 'asciiMode',
    'downloadMode', 'downloadQuality', 'downloadImmediately', 'downloadSubfolder', 'autoShutdown',
    'i2vPrompt', 'i2vFrom', 'i2vTo', 'i2vPad', 'i2vNamePrefix', 'i2vNameSuffix',
    'i2vUsePromptList', 'i2vStripTag',
    'networkGuard',
    'multiTab', 'multiTabMode', 'multiTabStagger',
    'updateCheckEnabled', 'updateCheckUrl'
  ];
  settingIds.forEach(id => ui(id)?.addEventListener('change', () => { updateConditionalUI(); saveSettings(); }));

  // Các ô có xem trước trực tiếp: cập nhật ngay khi đang gõ, không đợi blur.
  ['renamePrefix', 'renameSuffix', 'renameIndexPad', 'renameStartIndex', 'renameMaxLen',
   'downloadSubfolder', 'renameCustomList'].forEach(id =>
    ui(id)?.addEventListener('input', updateRenamePreview));
  ['i2vPrompt', 'i2vFrom', 'i2vTo', 'i2vPad', 'i2vNamePrefix', 'i2vNameSuffix'].forEach(id =>
    ui(id)?.addEventListener('input', updateI2vPreview));
  ui('i2vUsePromptList').addEventListener('change', updateI2vPreview);

  /* --- Ảnh → Video --- */
  ui('i2vGenerateBtn').onclick = i2vGenerate;
  ui('i2vCheckBtn').onclick = i2vCheckAssets;
  ui('pickFolderBtn').onclick = () => ui('folderInput').click();
  ui('pickFilesBtn').onclick = () => ui('filesInput').click();
  ui('folderInput').addEventListener('change', (e) => { handlePickedFiles(e.target.files); e.target.value = ''; });
  ui('filesInput').addEventListener('change', (e) => { handlePickedFiles(e.target.files); e.target.value = ''; });
  ui('uploadToFlowBtn').onclick = uploadPickedImagesToFlow;

  /* --- đa tab (1.7.0) --- */
  ui('refreshTabsBtn').onclick = () => { refreshFlowTabs(); toast('Đã làm mới danh sách tab', 'ok'); };
  ui('openFlowWinBtn').onclick = async () => {
    try {
      const cur = await targetFlowTab();
      const r = await chrome.runtime.sendMessage({
        action: 'OPEN_FLOW_WINDOW',
        url: cur?.url && isFlowUrl(cur.url) ? cur.url : undefined
      });
      if (!r?.ok) throw new Error(r?.error || 'không mở được');
      toast('Đã mở cửa sổ Flow mới — đăng nhập/chọn project rồi bấm ↻', 'ok');
      setTimeout(refreshFlowTabs, 2500);
    } catch (e) {
      toast('Không mở được cửa sổ mới: ' + e.message, 'err');
    }
  };
  ui('startAllBtn').onclick = startAllTabs;
  ui('stopAllBtn').onclick = stopAllTabs;
  ['startIndex', 'endIndex', 'customIndices', 'promptsInput'].forEach(id =>
    ui(id)?.addEventListener('input', () => { if (ui('multiTab').checked) updateSplitPreview(); }));

  /* --- kiểm tra cài đặt tải xuống của Chrome --- */
  ui('checkSaveAsBtn').onclick = checkSaveAsSetting;
  ui('openDlSettingsBtn').onclick = async () => {
    try {
      const r = await chrome.runtime.sendMessage({ action: 'OPEN_DOWNLOAD_SETTINGS' });
      if (!r?.success) throw new Error(r?.error || 'không mở được');
      ui('saveAsGuide').classList.remove('hidden');
    } catch (e) {
      toast('Không mở được trang cài đặt — hãy tự vào chrome://settings/downloads', 'err');
    }
  };
  document.querySelectorAll('input[name="runMode"]').forEach(x =>
    x.addEventListener('change', () => { updateConditionalUI(); saveSettings(); }));

  /* zoom cần áp dụng ngay vào tab Flow */
  ui('zoomLevel').addEventListener('change', () => {
    broadcastFlow('ENFORCE_GROUP_MODE', { zoomLevel: ui('zoomLevel').value }).catch(() => {});
  });

  /* --- chẩn đoán giao diện (1.8.0) --- */
  /* --- kiểm tra bản mới (1.9.0) --- */
  ui('updCheckBtn').onclick = () => doUpdateCheck(true);
  ui('updOpenBtn').onclick = openUpdateDownload;
  ui('updateDownloadBtn').onclick = openUpdateDownload;
  ui('updateLaterBtn').onclick = async () => {
    const v = ui('updateBanner').dataset.version || app.update?.latest || '';
    hideUpdateBanner();
    await askBackground('DISMISS_UPDATE', { version: v });
    if (app.update) app.update.dismissedVersion = v;
    toast(`Sẽ không nhắc lại bản ${v}`, 'ok');
  };

  ui('runDiagBtn').onclick = runDiagnostics;
  ui('exportDiagBtn').onclick = exportDiagReport;
  ui('openDiagBtn').onclick = () => {
    // Nhảy sang tab Cài đặt và mở sẵn khối chẩn đoán.
    document.querySelector('.tab[data-tab="settings"]')?.click();
    ui('diagAcc').open = true;
    ui('diagAcc').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!app.diag) runDiagnostics();
  };
  ui('clearSelectorBtn').onclick = async () => {
    app.settings.selectors = {};
    await chrome.storage.local.set({ veoSettings: app.settings });
    broadcastFlow('UPDATE_SETTINGS', app.settings);
    await sendToActiveFlow('CLEAR_UI_HEALTH', {}).catch(() => {});
    hideUiBreakBanner();
    toast('Đã xoá toàn bộ selector đã chọn', 'ok');
    if (app.diag) runDiagnostics();
  };

  // Nếu lần chạy trước đã ghi nhận UI vỡ, hiện lại cảnh báo khi mở panel.
  try {
    const { veoUiDiagnostics = {} } = await chrome.storage.local.get('veoUiDiagnostics');
    const recent = Object.values(veoUiDiagnostics)
      .filter(d => Date.now() - (d.at || 0) < 24 * 3600 * 1000)
      .sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    if (recent) showUiBreakBanner(recent.label, recent.misses);
  } catch (e) { /* không quan trọng */ }

  /* --- native host --- */
  ui('testNativeBtn').onclick = async () => {
    ui('nativeStatus').textContent = 'Đang kiểm tra…';
    try {
      const r = await chrome.runtime.sendMessage({ action: 'TEST_NATIVE_HOST' });
      ui('nativeStatus').textContent = r?.success
        ? '✅ Native Host hoạt động bình thường.'
        : `⚠️ ${r?.error || 'Không kết nối được.'}`;
    } catch (e) {
      ui('nativeStatus').textContent = '⚠️ ' + e.message;
    }
  };
  ui('cancelShutdownBtn').onclick = async () => {
    await chrome.runtime.sendMessage({ action: 'CANCEL_SHUTDOWN' });
    ui('cancelShutdownBtn').classList.add('hidden');
  };

  /* --- settings import / export --- */
  ui('exportSettingsBtn').onclick = () => {
    gatherSettings();
    const blob = new Blob([JSON.stringify(app.settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flow-automation-settings.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 20000);
    toast('Đã xuất cài đặt', 'ok');
  };
  ui('importSettingsBtn').onclick = () => ui('settingsFileInput').click();
  ui('settingsFileInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object') throw new Error('Nội dung không hợp lệ');
      applySettings(parsed);
      await saveSettings();
      toast('Đã nhập cài đặt', 'ok');
    } catch (err) {
      toast(`File cài đặt lỗi: ${err.message}`, 'err');
    }
  });

  /* --- projects --- */
  ui('projectSearch').addEventListener('input', drawProjects);
  ui('deleteAllProjectsBtn').onclick = async () => {
    if (!confirm('Xoá TẤT CẢ dự án đã lưu? Không thể hoàn tác.')) return;
    await chrome.storage.local.remove(['veoProjects']);
    renderProjects();
    toast('Đã xoá tất cả dự án', 'ok');
  };

  /* --- logs --- */
  ui('clearLogsBtn').onclick = () => {
    app.logs = [];
    ui('logs').textContent = '';
    ui('logBadge').classList.add('hidden');
    ui('logBadge').textContent = '0';
  };
  ui('copyLogsBtn').onclick = async () => {
    const text = app.logs.map(l => `[${l.time}] [${l.type.toUpperCase()}] ${l.message}`).join('\n');
    try { await navigator.clipboard.writeText(text); toast('Đã copy log', 'ok'); }
    catch (e) { toast('Không copy được: ' + e.message, 'err'); }
  };
  ui('saveLogsBtn').onclick = saveLogsTxt;

  /* --- connection watcher --- */
  chrome.tabs.onActivated.addListener(checkConnection);
  chrome.tabs.onUpdated.addListener((_id, change) => { if (change.status === 'complete') checkConnection(); });
  setInterval(checkConnection, 6000);

  setRunning(false, false);
  renderTable();
  log('success', 'Sẵn sàng (Local Mode 1.6.0) — không dùng Firebase/GAS/OAuth, không đọc token.');
});
