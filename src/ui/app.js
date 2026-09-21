// ============================================================================
//  app.js — logic giao diện
//  Chạy trong renderer, nói chuyện với tiến trình chính qua window.flowApp.
// ============================================================================

const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const VOICES = ['Achernar','Achird','Algenib','Algieba','Alnilam','Aoede','Autonoe',
  'Callirrhoe','Charon','Despina','Enceladus','Erinome','Fenrir','Gacrux','Iapetus',
  'Kore','Laomedeia','Leda','Orus','Puck','Pulcherrima','Rasalgethi','Sadachbia',
  'Sadaltager','Schedar','Sulafat','Umbriel','Vindemiatrix','Zephyr','Zubenelgenubi'];

const app = {
  tabs: [],
  accounts: [],
  selectedTabs: new Set(),   // rỗng = dùng mọi tab sẵn sàng
  logs: [],
  rows: new Map(),
  projects: [],
  i2vFiles: [],
  running: false,
  stats: { total: 0, done: 0, failed: 0 }
};

// ══════════════════════════════════════════════════════════ ĐIỀU HƯỚNG

const PANE_TITLES = {
  overview: 'Tổng quan', run: 'Prompt và Cài đặt', i2v: 'Ảnh → Video',
  accounts: 'Tài khoản Flow', browser: 'Cửa sổ Flow',
  projects: 'Dự án', logs: 'Nhật ký'
};

let currentPane = 'overview';

function showPane(name) {
  currentPane = name;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.pane === name));
  $$('.pane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + name));
  $('#paneTitle').textContent = PANE_TITLES[name] || name;
  if (name === 'projects') loadProjects();
  requestAnimationFrame(syncBrowserBounds);
}

$$('.nav-item').forEach((b) => b.addEventListener('click', () => showPane(b.dataset.pane)));

/**
 * Báo cho tiến trình chính vùng hiển thị trình duyệt nằm ở đâu.
 * WebContentsView đặt theo toạ độ tuyệt đối trong cửa sổ nên mỗi lần đổi mục
 * hay đổi kích thước đều phải tính lại, nếu không nó che mất giao diện.
 */
function syncBrowserBounds() {
  const pane = $('#browserPane');
  const visible = currentPane === 'browser' && app.tabs.length > 0;
  const r = pane.getBoundingClientRect();
  window.flowApp.tabs.setPane(
    { x: r.left, y: r.top, width: r.width, height: r.height }, visible
  );
  $('#browserEmpty').classList.toggle('hidden', app.tabs.length > 0);
}
window.addEventListener('resize', syncBrowserBounds);

// ══════════════════════════════════════════════════════════ PROMPT

function parsePrompts(raw, mode) {
  const text = String(raw || '').replace(/\r\n/g, '\n');
  let parts;
  switch (mode) {
    case 'blank': parts = text.split(/\n\s*\n+/); break;
    case 'dash':  parts = text.split(/^\s*-{3,}\s*$/m); break;
    case 'eq':    parts = text.split(/^\s*={3,}\s*$/m); break;
    default:      parts = text.split('\n'); break;
  }
  return parts.map((p) => p.trim()).filter(Boolean);
}

const allPrompts = () => parsePrompts($('#promptsInput').value, $('#promptSeparator').value);

/**
 * "1,5,9-12,20" -> [1,5,9,10,11,12,20], bỏ số ngoài phạm vi, bỏ trùng.
 */
function parseIndexList(raw, total) {
  const out = new Set();
  for (const phan of String(raw || '').split(',')) {
    const s = phan.trim();
    if (!s) continue;
    const m = s.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) if (i >= 1 && i <= total) out.add(i);
    } else if (/^\d+$/.test(s)) {
      const i = parseInt(s, 10);
      if (i >= 1 && i <= total) out.add(i);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Prompt sẽ THẬT SỰ chạy, sau khi lọc theo khoảng hoặc danh sách tuỳ chọn.
 * Trả về mảng chuỗi ĐẦY ĐỦ (có chỗ trống ở các số bị bỏ) để engine tra
 * prompts[index-1] vẫn đúng, kèm danh sách số thứ tự được chọn.
 */
function selectedRange() {
  const tatCa = allPrompts();
  const total = tatCa.length;
  if (!total) return { prompts: [], indices: [] };

  let indices;
  if ($('#useCustomRange').checked) {
    indices = parseIndexList($('#customIndices').value, total);
  } else {
    let a = Math.max(1, parseInt($('#startIndex').value, 10) || 1);
    let b = parseInt($('#endIndex').value, 10);
    if (!Number.isInteger(b) || b < 1) b = total;
    b = Math.min(total, b);
    if (b < a) b = a;
    indices = [];
    for (let i = a; i <= b; i++) indices.push(i);
  }
  return { prompts: tatCa, indices };
}

function refreshPromptStats() {
  const list = allPrompts();
  const chars = list.reduce((s, p) => s + p.length, 0);
  const longest = list.reduce((m, p) => Math.max(m, p.length), 0);

  $('#promptCount').textContent   = `${list.length} prompt`;
  $('#promptChars').textContent   = `${chars.toLocaleString('vi-VN')} ký tự`;
  $('#promptLongest').textContent = `dài nhất: ${longest.toLocaleString('vi-VN')}`;

  const { indices } = selectedRange();
  $('#rangeInfo').textContent = indices.length === list.length
    ? `tất cả ${list.length}`
    : `${indices.length}/${list.length} prompt`;

  $('#stTotal').textContent = indices.length;
  $('#stTotalSub').textContent = indices.length === list.length
    ? 'trong danh sách' : `đã chọn (tổng ${list.length})`;

  app.stats.total = indices.length;
  $('#navPending').textContent = Math.max(0, indices.length - app.stats.done);
}

['#promptsInput', '#promptSeparator', '#startIndex', '#endIndex', '#customIndices']
  .forEach((s) => $(s).addEventListener('input', refreshPromptStats));

$('#useCustomRange').addEventListener('change', (e) => {
  $('#customIndicesWrap').classList.toggle('hidden', !e.target.checked);
  refreshPromptStats();
});

const dropTarget = $('#promptsInput');
dropTarget.addEventListener('dragover', (e) => e.preventDefault());
dropTarget.addEventListener('drop', async (e) => {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files || []).filter((f) => /\.(txt|text)$/i.test(f.name));
  if (!files.length) return;
  appendPrompts((await Promise.all(files.map((f) => f.text()))).join('\n'));
});

function appendPrompts(text) {
  const box = $('#promptsInput');
  box.value = box.value.trim() ? box.value.replace(/\s*$/, '\n') + text : text;
  refreshPromptStats();
}

$('#btnImport').addEventListener('click', async () => {
  const files = await window.flowApp.dialog.openTxt();
  if (!files || !files.length) return;
  appendPrompts(files.map((f) => f.content).join('\n'));
  pushLog('success', `📥 Đã nạp ${files.length} file .txt`);
});

$('#btnExport').addEventListener('click', async () => {
  const list = allPrompts();
  if (!list.length) return pushLog('warning', '⚠️ Danh sách prompt đang rỗng');
  const saved = await window.flowApp.dialog.saveTxt(list.join('\n'), 'prompts.txt');
  if (saved) pushLog('success', `💾 Đã lưu: ${saved}`);
});

$('#btnDedupe').addEventListener('click', () => {
  const list = allPrompts();
  const seen = new Set();
  const out = list.filter((p) => {
    const k = p.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
  const bo = list.length - out.length;
  const sep = { blank: '\n\n', dash: '\n---\n', eq: '\n===\n' }[$('#promptSeparator').value] || '\n';
  $('#promptsInput').value = out.join(sep);
  refreshPromptStats();
  pushLog(bo ? 'success' : 'info', bo ? `⧉ Đã bỏ ${bo} prompt trùng` : 'Không có prompt trùng');
});

$('#btnClear').addEventListener('click', () => {
  $('#promptsInput').value = '';
  refreshPromptStats();
});


// ══════════════════════════════════════════════════════════ HỘP THOẠI
//  Electron KHÔNG cài đặt window.prompt(): gọi vào là không hiện gì và trả
//  null ngay. Đó đúng là lý do nút "Thêm tài khoản" bấm như không có chuyện
//  gì xảy ra — hàm thoát sớm ở dòng kiểm tra kết quả. Nên phải tự dựng.

function hoiChu({ title, desc = '', value = '', okText = 'Đồng ý' }) {
  return new Promise((resolve) => {
    const mask = $('#modalMask');
    const inp = $('#modalInput');
    $('#modalTitle').textContent = title;
    $('#modalDesc').textContent = desc;
    $('#modalDesc').style.display = desc ? '' : 'none';
    $('#modalOk').textContent = okText;
    inp.value = value;
    inp.style.display = '';
    mask.classList.remove('hidden');
    setTimeout(() => { inp.focus(); inp.select(); }, 30);

    const xong = (kq) => {
      mask.classList.add('hidden');
      $('#modalOk').onclick = null;
      $('#modalCancel').onclick = null;
      inp.onkeydown = null;
      resolve(kq);
    };
    $('#modalOk').onclick = () => xong(inp.value.trim() || null);
    $('#modalCancel').onclick = () => xong(null);
    inp.onkeydown = (e) => {
      if (e.key === 'Enter') xong(inp.value.trim() || null);
      if (e.key === 'Escape') xong(null);
    };
  });
}

function hoiCo({ title, desc = '', okText = 'Đồng ý' }) {
  return new Promise((resolve) => {
    const mask = $('#modalMask');
    $('#modalTitle').textContent = title;
    $('#modalDesc').textContent = desc;
    $('#modalDesc').style.display = desc ? '' : 'none';
    $('#modalInput').style.display = 'none';
    $('#modalOk').textContent = okText;
    mask.classList.remove('hidden');

    const xong = (kq) => {
      mask.classList.add('hidden');
      $('#modalOk').onclick = null;
      $('#modalCancel').onclick = null;
      resolve(kq);
    };
    $('#modalOk').onclick = () => xong(true);
    $('#modalCancel').onclick = () => xong(false);
  });
}

// ══════════════════════════════════════════════════════════ TÀI KHOẢN

function renderAccounts() {
  const box = $('#accountList');
  box.innerHTML = '';

  for (const acc of app.accounts) {
    const tabsCua = app.tabs.filter((t) => t.accountId === acc.id);
    const sanSang = tabsCua.filter((t) => t.ready).length;

    const el = document.createElement('div');
    el.className = 'acc';
    el.innerHTML =
      `<div class="acc-avatar">${escapeHtml((acc.name || '?').trim().charAt(0).toUpperCase())}</div>
       <div class="acc-body">
         <div class="acc-name">${escapeHtml(acc.name)}
           <span class="pill"><i class="dot ${acc.loggedIn ? 'ok' : ''}"></i>${acc.loggedIn ? 'Đã đăng nhập' : 'Chưa đăng nhập'}</span>
           ${tabsCua.length ? `<span class="pill">${sanSang}/${tabsCua.length} tab sẵn sàng</span>` : ''}
         </div>
         <div class="acc-meta">${escapeHtml(acc.downloadDir || 'Dùng thư mục tải mặc định')}</div>
       </div>`;

    const act = document.createElement('div');
    act.className = 'acc-actions';

    const them = (nhan, cls, fn, title) => {
      const b = document.createElement('button');
      b.className = 'btn sm' + (cls ? ' ' + cls : '');
      b.textContent = nhan;
      if (title) b.title = title;
      b.addEventListener('click', fn);
      act.appendChild(b);
    };

    them('+ Mở tab', 'primary', async () => {
      app.tabs = await window.flowApp.tabs.create(acc.id);
      renderTabs(); showPane('browser'); syncBrowserBounds();
    });
    them('✎ Đổi tên', '', async () => {
      const ten = await hoiChu({ title: 'Đổi tên tài khoản', value: acc.name });
      if (ten) { await window.flowApp.accounts.rename(acc.id, ten); await loadAccounts(); }
    });
    them('📁 Thư mục', '', async () => {
      const dir = await window.flowApp.dialog.pickFolder();
      if (dir) { await window.flowApp.accounts.setDir(acc.id, dir); await loadAccounts(); }
    }, 'Thư mục tải riêng cho tài khoản này');
    them('🚪 Đăng xuất', '', async () => {
      const ok = await hoiCo({
        title: `Đăng xuất "${acc.name}"?`,
        desc: 'Cookie của RIÊNG tài khoản này sẽ bị xoá. Các tài khoản khác không bị đụng tới.',
        okText: 'Đăng xuất'
      });
      if (!ok) return;
      const r = await window.flowApp.accounts.logout(acc.id);
      pushLog(r.ok ? 'warning' : 'error', r.ok ? `🚪 Đã đăng xuất "${acc.name}"` : `❌ ${r.error}`);
      await loadAccounts();
    });
    if (app.accounts.length > 1) {
      them('🗑 Xoá', 'danger', async () => {
        const ok = await hoiCo({
          title: `Xoá hẳn tài khoản "${acc.name}"?`,
          desc: 'Mọi tab của tài khoản này sẽ bị đóng. Không hoàn tác được.',
          okText: 'Xoá'
        });
        if (!ok) return;
        const r = await window.flowApp.accounts.remove(acc.id);
        if (!r.ok) return pushLog('error', `❌ ${r.error}`);
        await loadAccounts();
      });
    }

    el.appendChild(act);
    box.appendChild(el);
  }

  // Ô chọn tài khoản trên thanh tab
  const sel = $('#newTabAccount');
  const giu = sel.value;
  sel.innerHTML = '';
  for (const acc of app.accounts) {
    const o = document.createElement('option');
    o.value = acc.id;
    o.textContent = acc.name;
    sel.appendChild(o);
  }
  if (giu && app.accounts.some((a) => a.id === giu)) sel.value = giu;

  $('#navAccounts').textContent = app.accounts.length;
}

async function loadAccounts() {
  app.accounts = await window.flowApp.accounts.list();
  renderAccounts();
}

$('#btnAddAccount').addEventListener('click', async () => {
  const ten = await hoiChu({
    title: 'Thêm tài khoản Flow',
    desc: 'Đặt tên gợi nhớ để phân biệt, ví dụ: Tài khoản chính, Acc phụ 1.',
    value: `Tài khoản ${app.accounts.length + 1}`,
    okText: 'Thêm'
  });
  if (!ten) return;
  const acc = await window.flowApp.accounts.create(ten);
  await loadAccounts();
  pushLog('success', `👤 Đã thêm "${acc.name}" — bấm "+ Mở tab" rồi đăng nhập Google`);
});

// ══════════════════════════════════════════════════════════ TAB

function renderTabs() {
  const strip = $('#tabChips');
  strip.innerHTML = '';

  for (const t of app.tabs) {
    const chip = document.createElement('div');
    chip.className = 'tabchip' + (t.active ? ' active' : '');
    chip.innerHTML = `<i class="dot ${t.ready ? 'ok' : 'warn'}"></i><span class="ttl">${escapeHtml(shortTitle(t))}</span>`;

    const x = document.createElement('button');
    x.className = 'x'; x.textContent = '×'; x.title = 'Đóng tab';
    x.addEventListener('click', async (e) => {
      e.stopPropagation();
      app.tabs = await window.flowApp.tabs.close(t.id);
      renderTabs(); renderAccounts(); syncBrowserBounds();
    });

    chip.addEventListener('click', async () => {
      app.tabs = await window.flowApp.tabs.activate(t.id);
      renderTabs(); syncBrowserBounds();
    });

    chip.appendChild(x);
    strip.appendChild(chip);
  }

  renderTabPicker();

  const sanSang = app.tabs.filter((t) => t.ready).length;
  $('#navTabs').textContent = app.tabs.length;
  $('#stRunning').textContent = app.tabs.filter((t) => t.busy).length;

  const dot = $('#connDot'), txt = $('#connText');
  if (!app.tabs.length)  { dot.className = 'dot';      txt.textContent = 'Chưa mở tab'; }
  else if (!sanSang)     { dot.className = 'dot warn'; txt.textContent = 'Tab chưa sẵn sàng'; }
  else                   { dot.className = 'dot ok';   txt.textContent = `${sanSang} tab sẵn sàng`; }
}

function renderTabPicker() {
  const picker = $('#tabPicker');
  picker.innerHTML = '';

  if (!app.tabs.length) {
    picker.innerHTML = '<span class="hint">Chưa có tab nào. Sang mục Tài khoản để mở tab.</span>';
    $('#assignHint').textContent = '—';
    return;
  }

  // Gom theo tài khoản để nhìn ra ngay tab nào của ai
  for (const acc of app.accounts) {
    const tabsCua = app.tabs.filter((t) => t.accountId === acc.id);
    if (!tabsCua.length) continue;

    const nhan = document.createElement('span');
    nhan.className = 'pill';
    nhan.style.cssText = 'background:transparent;border:0;color:var(--text-faint)';
    nhan.textContent = acc.name + ':';
    picker.appendChild(nhan);

    for (const t of tabsCua) {
      const b = document.createElement('button');
      const on = app.selectedTabs.has(t.id);
      b.className = 'btn sm' + (on ? ' primary' : '');
      b.textContent = t.ready ? t.id : `${t.id} (chưa sẵn sàng)`;
      b.disabled = !t.ready;
      b.addEventListener('click', () => {
        if (app.selectedTabs.has(t.id)) app.selectedTabs.delete(t.id);
        else app.selectedTabs.add(t.id);
        renderTabPicker();
      });
      picker.appendChild(b);
    }
  }

  const dung = chosenTabs();
  const soTk = new Set(dung.map((t) => t.accountId)).size;
  $('#assignHint').textContent = dung.length
    ? `${dung.length} tab · ${soTk} tài khoản`
    : 'chưa tab nào sẵn sàng';
}

/** Tab sẽ chạy: đã chọn, hoặc mọi tab sẵn sàng nếu chưa chọn gì. */
function chosenTabs() {
  const sanSang = app.tabs.filter((t) => t.ready);
  if (!app.selectedTabs.size) return sanSang;
  return sanSang.filter((t) => app.selectedTabs.has(t.id));
}

function shortTitle(t) {
  const acc = t.accountName ? t.accountName.split(' ').pop() : '';
  return `${t.id}${acc ? ' · ' + acc : ''}`;
}

$('#btnNewTab').addEventListener('click', async () => {
  const btn = $('#btnNewTab');
  btn.disabled = true;
  try {
    app.tabs = await window.flowApp.tabs.create($('#newTabAccount').value || null);
    renderTabs(); renderAccounts(); syncBrowserBounds();
  } finally { btn.disabled = false; }
});

$('#btnReloadTab').addEventListener('click', async () => {
  const a = app.tabs.find((t) => t.active);
  if (a) await window.flowApp.tabs.reload(a.id);
});

$('#btnReinject').addEventListener('click', async () => {
  const a = app.tabs.find((t) => t.active);
  if (!a) return pushLog('warning', '⚠️ Chưa mở tab Flow nào');
  const btn = $('#btnReinject'); btn.disabled = true;
  try {
    const r = await window.flowApp.tabs.reinject(a.id);
    if (!r.ok && r.error) pushLog('error', `❌ ${r.error}`);
  } finally { btn.disabled = false; }
});

$('#btnDiagnose').addEventListener('click', async () => {
  const a = app.tabs.find((t) => t.active);
  if (!a) return pushLog('warning', '⚠️ Chưa mở tab Flow nào');
  await window.flowApp.tabs.diagnose(a.id);
  showPane('logs');
});

// ══════════════════════════════════════════════════════════ CHẠY

$('#planMode').addEventListener('change', updatePlanHint);
function updatePlanHint() {
  $('#planModeHint').textContent = $('#planMode').value === 'account'
    ? 'Mỗi tài khoản ôm một dải số thứ tự liền mạch rồi tự chia cho các tab của nó — hợp khi muốn tách hạn mức hoặc tách kết quả theo tài khoản.'
    : 'Mọi tab đã chọn được coi như một dàn máy chung, chia liên tiếp cho tất cả. Xong sớm nhất.';
}

$('#btnStart').addEventListener('click', async () => {
  const { prompts, indices } = selectedRange();
  if (!indices.length) return pushLog('error', '❌ Chưa có prompt nào để chạy');

  const tabIds = chosenTabs().map((t) => t.id);
  if (!tabIds.length) {
    return pushLog('error', '❌ Không có tab nào rảnh. Tab đang chạy vẫn tiếp tục — mở thêm tab hoặc chờ.');
  }

  const settings = collectSettings();
  const chain = settings.runMode === 'image' ? buildChainPayload(prompts) : null;
  if ($('#chainEnabled').checked && settings.runMode !== 'image') {
    pushLog('warning', '⚠️ Tự nối ảnh→video chỉ chạy khi Chế độ chạy là "Tạo ảnh".');
  }
  // Mẻ video nối tiếp phải chạy bằng BỘ CÀI ĐẶT VIDEO, không phải bộ Ảnh mà
  // mẻ này đang dùng. Trước đây nó dùng lại y nguyên bộ Ảnh, nên video tải về
  // theo chất lượng ảnh và thư mục ảnh — log của người dùng ghi rõ:
  // "[1] Đã chọn độ phân giải: img_1k" trong lúc đang tải .mp4.
  if (chain) {
    chain.videoSettings = collectSettings('video');
    // Nói TRƯỚC khi chạy, không đợi tới lúc tiến trình chính tự tắt nó.
    // Đây là thứ đã làm hỏng trọn một mẻ 30 prompt: "Đồng bộ khung hình
    // đầu/cuối" đòi hai thẻ @ảnh, mà prompt của chuỗi chỉ có một.
    if ($('#keyframeSync').checked) {
      pushLog('warning',
        '⚠️ Mẻ video nối tiếp sẽ TỰ TẮT "Đồng bộ khung hình đầu/cuối" — ' +
        'nó đòi 2 thẻ @ảnh, còn chuỗi ảnh→video chỉ gắn 1 thẻ cho mỗi video.');
    }
  }

  const res = await window.flowApp.run.start({ prompts, indices, tabIds, chain, settings,
    planMode: $('#planMode').value });
  if (!res.ok) return pushLog('error', `❌ ${res.error}`);

  renderTabProgress(await window.flowApp.run.stats());
});

$('#btnPause').addEventListener('click',  () => window.flowApp.run.pause(chosenOrAll()));
$('#btnResume').addEventListener('click', () => window.flowApp.run.resume(chosenOrAll()));
$('#btnStop').addEventListener('click',   () => window.flowApp.run.stop(chosenOrAll()));

/** Tab đã chọn, hoặc rỗng = áp cho tất cả. */
function chosenOrAll() {
  return app.selectedTabs.size ? [...app.selectedTabs] : [];
}

/**
 * Chỉ phản ánh trạng thái chung lên thanh trên cùng.
 *
 * Cố ý KHÔNG khoá nút Bắt đầu nữa: lỗi cũ là giao việc cho tab 1 xong thì nút
 * bị khoá toàn cục, không giao được cho tab 2. Việc chặn tab đang bận đã do
 * tiến trình chính lo (nó bỏ qua tab busy), nên giao diện để mở là đúng.
 */
function setRunning(on, paused = false) {
  app.running = on;
  $('#btnPause').disabled  = !on || paused;
  $('#btnResume').disabled = !paused && !on;
  $('#btnStop').disabled   = !on;

  const dot = $('#runDot'), txt = $('#runText');
  if (!on)         { dot.className = 'dot';      txt.textContent = 'Đang nghỉ'; }
  else if (paused) { dot.className = 'dot warn'; txt.textContent = 'Tạm dừng'; }
  else             { dot.className = 'dot ok';   txt.textContent = 'Đang chạy'; }
}

// ══════════════════════════════════════════════════════════ CÀI ĐẶT
//  Bản đồ này port nguyên từ readSettings() của tiện ích 1.10.0 — engine chỉ
//  hiểu đúng những khoá này, đặt sai tên là nó lặng lẽ dùng mặc định.

// Các ô CHUNG cho cả hai chế độ.
const FIELDS = [
  'aspectRatio','outputCount','delayMin','delayMax','maxRetries',
  'networkGuard','multiTabStagger','voiceSelect','downloadDir',
  'promptSeparator','startIndex','endIndex','customIndices','planMode',
  'i2vPrompt','i2vFrom','i2vTo','i2vPad','i2vNamePrefix','i2vNameSuffix',
  'faFrom','faTo','faPad','faPrefix','faSuffix','faPrompt',
  'chainPrompt','chainNameSource'
];
const SWITCHES = [
  'addIndex','randomScroll','charSync','charSyncStripTag','keyframeSync',
  'voiceSync','autoShutdown','useCustomRange','autoScrollLogs','randomDelay',
  'i2vUsePromptList','i2vStripTag','chainEnabled','chainSkipIfFailed'
];

// ── Cài đặt tải về + đổi tên: MỘT BỘ RIÊNG cho Video, MỘT BỘ RIÊNG cho Ảnh ──
//
//  Vì sao tách: engine chỉ hiểu MỘT bộ khoá (downloadMode, renameMode,
//  renameIndexPad…). Trước đây giao diện cũng chỉ có một bộ, nên ai vừa chạy
//  ảnh vừa chạy video phải chỉnh qua chỉnh lại mỗi lần đổi chế độ — và chuỗi
//  ảnh→video thì không chỉnh kịp, vì mẻ video nối tiếp ngay lập tức.
//
//  Nay giao diện giữ hai bộ, còn collectSettings() chọn đúng bộ theo chế độ
//  rồi dựng ra bộ khoá phẳng mà engine đọc. Engine không biết gì về chuyện này.
const TAI_VE_FIELDS = [
  'downloadMode','downloadImmediately','subfolder',
  'renameMode','renameMaxLen','renameIndexPad','renamePrefix','renameSuffix',
  'renameStartIndex','renameCustomList','asciiMode'
];
const TAI_VE_SWITCHES = ['autoRename'];

// ── Chế độ an toàn ────────────────────────────────────────────────────────
//
//  Gom riêng thành một object con (settings.anToan) chứ không rải phẳng vào
//  settings: engine KHÔNG đọc mấy khoá này — chúng là việc của tiến trình
//  chính. Để lẫn vào thì mỗi lần đọc cài đặt lại phải nhớ khoá nào của ai.
//
//  Ánh xạ ô giao diện → tên khoá bên src/main/an-toan.js.
const AN_TOAN_SO = {
  anToanNguong:  'nguong',
  anToanCuaSo:   'cuaSoPhut',
  anToanNghi:    'nghiPhut',
  anToanToiDa:   'nghiToiDaPhut',
  anToanCuMoi:   'cuMoi',
  anToanGiaiLao: 'giaiLaoPhut'
};
const AN_TOAN_BAT = { anToanBat: 'bat', anToanNhanDoi: 'nhanDoi' };

function docAnToan() {
  const a = {};
  for (const id in AN_TOAN_SO)  { const el = document.getElementById(id); if (el) a[AN_TOAN_SO[id]]  = el.value; }
  for (const id in AN_TOAN_BAT) { const el = document.getElementById(id); if (el) a[AN_TOAN_BAT[id]] = el.checked; }
  return a;
}

function datAnToan(a) {
  if (!a) return;
  for (const id in AN_TOAN_SO)  { const el = document.getElementById(id); if (el && a[AN_TOAN_SO[id]] !== undefined)  el.value   = a[AN_TOAN_SO[id]]; }
  for (const id in AN_TOAN_BAT) { const el = document.getElementById(id); if (el && a[AN_TOAN_BAT[id]] !== undefined) el.checked = !!a[AN_TOAN_BAT[id]]; }
}

// ── Model video ───────────────────────────────────────────────────────────
//
//  Cũng gom thành object con (settings.chonModel) vì engine KHÔNG đọc — tiến
//  trình chính đọc (src/main/model.js) để tự bấm hộp chọn model trên Flow.
const MODEL_O = {
  modelChinh:   'chinh',
  modelPhu:     'phu',
  modelXenKe:   'xenKeMoi',
  modelDuPhong: 'duPhong',
  modelThuLai:  'thuLaiPhut'
};

function docChonModel() {
  const m = {};
  for (const id in MODEL_O) { const el = document.getElementById(id); if (el) m[MODEL_O[id]] = el.value.trim(); }
  return m;
}

function datChonModel(m) {
  if (!m) return;
  for (const id in MODEL_O) {
    const el = document.getElementById(id);
    if (el && m[MODEL_O[id]] !== undefined && m[MODEL_O[id]] !== null) el.value = m[MODEL_O[id]];
  }
  goiYXenKe();
}

/** Nói bằng lời xen kẽ đang đặt ra sao — con số trơn dễ hiểu nhầm. */
function goiYXenKe() {
  const out = document.getElementById('modelXenKeHint');
  if (!out) return;
  const n = parseInt((document.getElementById('modelXenKe') || {}).value, 10) || 0;
  const phu = ((document.getElementById('modelPhu') || {}).value || '').trim();
  const chinh = ((document.getElementById('modelChinh') || {}).value || '').trim() || 'model đang chọn trên Flow';
  if (!phu || n < 2) { out.textContent = 'Đang tắt. N = 2 là luân phiên 1–1 (chính, phụ, chính, phụ…).'; return; }
  const mau = [];
  for (let i = 1; i <= Math.min(6, Math.max(4, n + 1)); i++) mau.push(i % n === 0 ? 'phụ' : 'chính');
  out.innerHTML = `Mỗi ${n} prompt có 1 prompt dùng <b>${escapeHtml(phu)}</b>, còn lại dùng <b>${escapeHtml(chinh)}</b>` +
    ` — thứ tự: ${mau.join(', ')}…`;
}

/** Đọc bộ cài đặt tải về của MỘT chế độ ('Video' hoặc 'Image'). */
function docBoTaiVe(hau) {
  const b = {};
  for (const k of TAI_VE_FIELDS) {
    const el = document.getElementById(k + hau);
    if (el) b[k] = el.value;
  }
  for (const k of TAI_VE_SWITCHES) {
    const el = document.getElementById(k + hau);
    if (el) b[k] = el.checked;
  }
  const cl = document.getElementById('downloadQuality' + hau);
  b.downloadQuality = cl ? cl.value : (hau === 'Image' ? 'img_2k' : '1080p');
  return b;
}

/**
 * Gom cài đặt thành bộ khoá PHẲNG mà flow-engine.js đọc.
 *
 * @param {'video'|'image'} [epCheDo]  ép dùng bộ của chế độ này thay vì chế độ
 *        đang chọn. Chuỗi ảnh→video cần nó: mẻ ảnh chạy bằng bộ Ảnh, rồi mẻ
 *        video nối tiếp phải chạy bằng bộ Video — hai bộ khác nhau hoàn toàn.
 */
function collectSettings(epCheDo) {
  const s = {};
  for (const id of FIELDS)   { const el = document.getElementById(id); if (el) s[id] = el.value; }
  for (const id of SWITCHES) { const el = document.getElementById(id); if (el) s[id] = el.checked; }

  const runMode = epCheDo
    || (document.querySelector('input[name="runMode"]:checked') || {}).value
    || 'video';
  s.runMode = runMode;

  // ── Những khoá engine đọc nhưng KHÔNG có ô riêng ────────────────────
  // Nhịp dán: engine đọc pasteDelayMin/Max (giây). Tắt ngẫu nhiên thì đặt
  // hai đầu bằng nhau — engine bốc số trong khoảng [min,max] nên min==max
  // chính là "chờ cố định", không phải thêm nhánh xử lý riêng.
  let min = Math.max(1, parseInt(s.delayMin, 10) || 20);
  let max = s.randomDelay ? Math.max(min, parseInt(s.delayMax, 10) || 30) : min;
  s.pasteDelayMin = min;
  s.pasteDelayMax = max;

  // Thu phóng tab Flow: bỏ ô chọn (không ai chỉnh, mà chỉnh sai thì engine
  // nhìn hụt thẻ). Cố định 80% — mức đã dùng làm mặc định từ đầu.
  s.zoomLevel = '0.8';

  // ── multiTab: LUÔN bật ở bản desktop ───────────────────────────────
  //
  //  Ghi chú cũ trong README bảo engine "không đọc" khoá này. Sai: isMultiTab()
  //  đọc nó, và bảy chỗ trong engine gọi isMultiTab(). Quan trọng nhất:
  //
  //    • Tên dự án được gắn hậu tố _T<slot>. Không có nó thì mấy tab dùng
  //      chung MỘT tên dự án và ghi đè dữ liệu của nhau — đúng lỗi thật: cả ba
  //      tab cùng nạp "Project_2026-09-19_1789834930959", tab1 tự F5 xong thì
  //      khôi phục nhầm mẻ video của tab2.
  //    • isTabActive() trả true ngay, khỏi phải hỏi rồi chờ hết 2 giây.
  //    • Tab xong trước không tắt máy khi tab khác còn chạy.
  //    • Giãn nhịp bấm "Tạo" giữa các tab (multiTabStagger) mới có tác dụng.
  //
  //  Ở bản desktop MỌI tab đều là WebContentsView ẩn, nên các nhánh "đa tab"
  //  của engine luôn là nhánh đúng — kể cả khi đang mở đúng một tab.
  s.multiTab = true;

  // ── Lấy đúng bộ tải về của chế độ đang chạy ────────────────────────
  const bo = docBoTaiVe(runMode === 'image' ? 'Image' : 'Video');
  Object.assign(s, bo);
  s.downloadSubfolder = bo.subfolder || '';
  delete s.subfolder;

  // Một ô "Cách tải" gánh ba khoá của engine.
  s.autoDownload = s.downloadMode !== 'none';
  s.downloadZip  = s.downloadMode === 'zip';
  s.dlMode       = s.downloadMode;

  // downloadImmediately là ba trạng thái: true / false / 'auto'
  s.downloadImmediately = s.downloadImmediately === 'true' ? true
    : (s.downloadImmediately === 'false' ? false : 'auto');

  // Hai thứ này chỉ có nghĩa ở chế độ video — giữ đúng cách tiện ích làm,
  // nếu không ở chế độ ảnh engine sẽ đi tìm nút giọng nói không hề tồn tại.
  s.keyframeSync = runMode === 'video' && !!s.keyframeSync;
  s.voiceSync    = runMode === 'video' && !!s.voiceSync;

  s.outputCount     = parseInt(s.outputCount, 10) || 2;
  s.maxRetries      = Math.max(0, parseInt(s.maxRetries, 10) || 0);
  s.multiTabStagger = Math.min(600, Math.max(0, parseInt(s.multiTabStagger, 10) || 0));
  s.networkGuard    = s.networkGuard === 'off' ? 'off' : 'auto';
  s.language        = 'vi';

  // Engine không đọc khoá này — tiến trình chính đọc, để tự cho nghỉ khi Flow
  // bắt đầu coi mình là máy. Gửi kèm để nó luôn theo đúng ô người dùng vừa đặt.
  s.anToan = docAnToan();
  s.chonModel = docChonModel();
  return s;
}

/** Gom TẤT CẢ để lưu ra đĩa — gồm cả hai bộ tải về, không chỉ bộ đang dùng. */
function collectForSave() {
  const s = {};
  for (const id of FIELDS)   { const el = document.getElementById(id); if (el) s[id] = el.value; }
  for (const id of SWITCHES) { const el = document.getElementById(id); if (el) s[id] = el.checked; }
  for (const hau of ['Video', 'Image']) {
    for (const k of TAI_VE_FIELDS.concat(TAI_VE_SWITCHES, ['downloadQuality'])) {
      const el = document.getElementById(k + hau);
      if (el) s[k + hau] = (el.type === 'checkbox') ? el.checked : el.value;
    }
  }
  s.runMode = (document.querySelector('input[name="runMode"]:checked') || {}).value || 'video';
  s.anToan  = docAnToan();
  s.chonModel = docChonModel();
  return s;
}

function applySettings(s) {
  if (!s) return;
  for (const id of FIELDS) {
    const el = document.getElementById(id);
    if (el && s[id] !== undefined && s[id] !== null) el.value = s[id];
  }
  for (const id of SWITCHES) {
    const el = document.getElementById(id);
    if (el && s[id] !== undefined) el.checked = !!s[id];
  }
  const r = document.querySelector(`input[name="runMode"][value="${s.runMode || 'video'}"]`);
  if (r) r.checked = true;

  datAnToan(s.anToan);
  datChonModel(s.chonModel);

  // ── Hai bộ tải về ─────────────────────────────────────────────────
  // Bản cũ lưu MỘT bộ khoá phẳng (downloadMode, renameMode…). File cài đặt
  // của người đang dùng bản cũ vẫn phải mở được, nên khoá nào chưa có bản
  // tách đôi thì lấy tạm giá trị cũ cho CẢ HAI bộ. Không làm vậy thì nâng
  // cấp xong mọi cài đặt đổi tên về mặc định — mất công chỉnh lại từ đầu.
  const CU = { subfolder: { Video: 'subfolderVideo', Image: 'subfolderImage' } };
  for (const hau of ['Video', 'Image']) {
    for (const k of TAI_VE_FIELDS.concat(TAI_VE_SWITCHES, ['downloadQuality'])) {
      const el = document.getElementById(k + hau);
      if (!el) continue;
      let v = s[k + hau];
      if (v === undefined || v === null) {
        const khoaCu = (CU[k] && CU[k][hau]) || k;      // downloadQuality* đã tách sẵn từ 2.3
        v = s[khoaCu];
      }
      if (v === undefined || v === null) continue;
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = String(v);
    }
  }

  if (s.pasteDelayMin) $('#delayMin').value = s.pasteDelayMin;
  if (s.pasteDelayMax) $('#delayMax').value = s.pasteDelayMax;

  syncConditionalFields();
}

/** Ẩn/hiện các ô chỉ có nghĩa trong một số lựa chọn. */
function syncConditionalFields() {
  for (const hau of ['Video', 'Image']) {
    const md = $('#renameMode' + hau), wrap = $('#renameCustomListWrap' + hau);
    if (md && wrap) wrap.classList.toggle('hidden', md.value !== 'custom_list');
  }
  $('#customIndicesWrap').classList.toggle('hidden', !$('#useCustomRange').checked);
  $('#chainBox').classList.toggle('hidden', !$('#chainEnabled').checked);
  if (typeof refreshChainPreview === 'function') refreshChainPreview();
  if (typeof refreshRenamePreview === 'function') refreshRenamePreview();

  // Làm MỜ chứ không ẩn: ẩn đi để lại một khoảng trống giữa hàng, nhìn như
  // giao diện vỡ. Mờ thì người dùng vẫn thấy ô đó tồn tại và hiểu vì sao tắt.
  const nn = $('#randomDelay').checked;
  $('#delayMax').disabled = !nn;
  $('#delayMaxWrap').style.opacity = nn ? '' : '.4';
  $('#delayHint').textContent = nn
    ? 'Mỗi lần tạo xong, app chờ một khoảng NGẪU NHIÊN trong đoạn trên rồi mới tạo tiếp — nhịp bấm không đều đặn như máy, đỡ bị Flow để ý.'
    : 'Đang chờ CỐ ĐỊNH đúng số giây tối thiểu sau mỗi lần tạo.';

  updatePlanHint();
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  // Lưu bằng collectForSave chứ KHÔNG phải collectSettings: collectSettings
  // đã trộn phẳng theo chế độ đang chạy, lưu bản đó là bộ của chế độ kia
  // biến mất sau một lần khởi động lại.
  saveTimer = setTimeout(() => window.flowApp.settings.save(collectForSave()), 400);
}

// Mọi ô cài đặt — kể cả hai bộ tải về — đều tự lưu và tự cập nhật xem trước.
const MOI_O_CAI_DAT = [...FIELDS, ...SWITCHES];
for (const hau of ['Video', 'Image']) {
  for (const k of TAI_VE_FIELDS.concat(TAI_VE_SWITCHES, ['downloadQuality'])) {
    MOI_O_CAI_DAT.push(k + hau);
  }
}
MOI_O_CAI_DAT.forEach((id) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', () => { syncConditionalFields(); scheduleSave(); });
});
$$('input[name="runMode"]').forEach((el) =>
  el.addEventListener('change', () => { syncConditionalFields(); scheduleSave(); }));
Object.keys(MODEL_O).forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', () => { goiYXenKe(); scheduleSave(); });
  el.addEventListener('input', goiYXenKe);
});

// ── Đọc danh sách model thẳng từ trang Flow ───────────────────────────────
//  Vừa để điền gợi ý đúng chữ Flow đang dùng, vừa là phép thử nhanh "app có
//  bấm được hộp chọn model không" — trước khi giao cả mẻ cho nó.
$('#btnDocModel').addEventListener('click', async () => {
  const out = $('#docModelKq');
  const ids = tabsCuaMucCheDo();
  const id = ids[0] || ((app.tabs || []).find((t) => t.ready) || {}).id;
  if (!id) { out.textContent = 'Mở một tab Flow ở mục Tài khoản trước đã.'; return; }
  out.textContent = `Đang đọc hộp chọn model trên ${id}…`;
  const r = await window.flowApp.tabs.listModels(id);
  if (!r || !r.ok) {
    out.innerHTML = `❌ ${escapeHtml((r && r.lyDo) || 'không rõ lý do')}. ` +
      `Chi tiết đã ghi vào Nhật ký — gửi dòng đó kèm ảnh chụp nếu cần sửa.`;
    return;
  }
  const dl = $('#dsModel');
  dl.innerHTML = r.ds.map((t) => `<option value="${escapeHtml(t)}">`).join('');
  out.innerHTML = `✅ ${escapeHtml(id)} — Flow đang có: ` + r.ds.map((t) => `<b>${escapeHtml(t)}</b>`).join(' · ') +
    (r.dangChon ? `<br>Đang chọn: <b>${escapeHtml(r.dangChon)}</b>` : '');
});

// ── Đặt nhịp chạy "hiền" theo số tab ──────────────────────────────────────
//
//  Con số lấy từ tiến trình chính (app:run:nhipAnToan) chứ không tính ở đây.
//  Một bản sao thứ hai của mấy con số này là một chỗ nữa để lệch, mà lệch thì
//  người dùng nhìn ô thấy một đằng, máy chạy một nẻo.
$('#btnNhipAnToan').addEventListener('click', async () => {
  const soTab = Math.max(1, (app.tabs || []).length);
  const n = await window.flowApp.run.nhipAnToan(soTab);
  if (!n) return;

  $('#randomDelay').checked  = !!n.randomDelay;
  $('#delayMin').value       = n.delayMin;
  $('#delayMax').value       = n.delayMax;
  $('#multiTabStagger').value= n.multiTabStagger;
  $('#randomScroll').checked = !!n.randomScroll;
  $('#maxRetries').value     = n.maxRetries;
  const ng = $('#networkGuard'); if (ng) ng.value = n.networkGuard;
  syncConditionalFields();                 // mở/khoá ô Giãn cách tối đa cho khớp

  $('#nhipAnToanKq').innerHTML =
    `Đã đặt theo <b>${soTab} tab</b>: dán cách nhau <b>${n.delayMin}–${n.delayMax} giây</b>, ` +
    `các tab bấm Tạo lệch nhau <b>${n.multiTabStagger} giây</b>, bật cuộn trang ngẫu nhiên, ` +
    `thử lại tối đa <b>${n.maxRetries}</b> lần.<br>` +
    `<i>Số lần thử lại hạ xuống là phần quan trọng nhất: lúc đang bị chặn, mỗi lần thử lại ` +
    `là một lần gõ cửa nữa vào đúng lúc không nên gõ.</i>`;
  scheduleSave();
});

$('#btnPickDir').addEventListener('click', async () => {
  const dir = await window.flowApp.dialog.pickFolder();
  if (dir) { $('#downloadDir').value = dir; scheduleSave(); }
});

$('#btnExportSettings').addEventListener('click', async () => {
  const p = await window.flowApp.dialog.saveTxt(
    JSON.stringify(collectForSave(), null, 2), 'flow-studio-cai-dat.json');
  if (p) pushLog('success', `💾 Đã xuất cài đặt: ${p}`);
});

$('#btnImportSettings').addEventListener('click', async () => {
  const files = await window.flowApp.dialog.openTxt();
  if (!files || !files.length) return;
  try {
    applySettings(JSON.parse(files[0].content));
    scheduleSave();
    pushLog('success', '📥 Đã nhập cài đặt');
  } catch (err) {
    pushLog('error', `❌ File cài đặt không đọc được: ${err.message}`);
  }
});

// ══════════════════════════════════════════════════════════ CHẨN ĐOÁN UI FLOW

$('#btnUiSelftest').addEventListener('click', async () => {
  const box = $('#uiHealthBox');
  box.textContent = '⏳ Đang dò 6 phần tử then chốt trên trang Flow…';
  const r = await window.flowApp.engine.uiSelftest();
  renderUiHealth(r);
});
$('#btnUiHealth').addEventListener('click', async () => {
  renderUiHealth(await window.flowApp.engine.uiHealth());
});
$('#btnUiClear').addEventListener('click', async () => {
  await window.flowApp.engine.uiClear();
  $('#uiHealthBox').textContent = 'Đã xoá ghi nhận.';
});

function renderUiHealth(r) {
  const box = $('#uiHealthBox');
  if (!r || r.ok === false) {
    box.innerHTML = `<span style="color:#fca5a5">❌ ${escapeHtml((r && r.error) || 'Chưa mở tab Flow nào')}</span>`;
    return;
  }
  const data = r.result || r.data || r;
  if (!data || typeof data !== 'object') {
    box.textContent = 'Engine chưa trả về dữ liệu — thử bấm "Kiểm tra 6 phần tử then chốt" trước.';
    return;
  }
  const dong = Object.entries(data).map(([k, v]) => {
    const ok = v === true || (v && (v.ok === true || v.found === true));
    return `<div>${ok ? '✅' : '❌'} ${escapeHtml(k)}${v && v.hint ? ' — ' + escapeHtml(v.hint) : ''}</div>`;
  });
  box.innerHTML = dong.length ? dong.join('') : 'Không có dữ liệu.';
}

// ══════════════════════════════════════════════════════════ DỰ ÁN

async function loadProjects() {
  const data = await window.flowApp.projects.list();
  app.projects = Array.isArray(data) ? data : [];
  renderProjects();
}

$('#btnRefreshProjects').addEventListener('click', loadProjects);
$('#projectSearch').addEventListener('input', renderProjects);

function renderProjects() {
  const tbody = $('#projectTable');
  const tim = $('#projectSearch').value.trim().toLowerCase();
  const ds = app.projects.filter((p) => !tim || String(p.name || '').toLowerCase().includes(tim));

  if (!ds.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">Chưa có dự án nào</td></tr>';
    return;
  }

  tbody.innerHTML = '';
  for (const p of ds) {
    const tr = document.createElement('tr');
    const xong = (p.videos || []).filter((v) => v.status === 'done' || v.status === 'success').length;
    tr.innerHTML =
      `<td class="wrap">${escapeHtml(p.name || '')}</td>` +
      `<td>${(p.videos || []).length}</td>` +
      `<td>${xong}</td>` +
      `<td>${p.timestamp ? new Date(p.timestamp).toLocaleString('vi-VN') : ''}</td>`;

    const td = document.createElement('td');
    const nap = document.createElement('button');
    nap.className = 'btn sm primary'; nap.textContent = '⏵ Nạp lại';
    nap.addEventListener('click', async () => {
      const r = await window.flowApp.projects.load(p.name);
      pushLog(r && r.ok !== false ? 'success' : 'error',
        r && r.ok !== false ? `📂 Đã nạp dự án "${p.name}"` : `❌ ${r.error}`);
    });
    const xoa = document.createElement('button');
    xoa.className = 'btn sm danger'; xoa.textContent = '🗑';
    xoa.style.marginLeft = '6px';
    xoa.addEventListener('click', async () => {
      if (!await hoiCo({ title: `Xoá dự án "${p.name}"?`, okText: 'Xoá' })) return;
      await window.flowApp.projects.remove(p.name);
      await loadProjects();
    });
    td.appendChild(nap); td.appendChild(xoa);
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

// ══════════════════════════════════════════════════════════ ẢNH → VIDEO

$('#btnPickImages').addEventListener('click', async () => {
  const r = await window.flowApp.dialog.pickImages();
  if (!r || !r.files || !r.files.length) return;
  app.i2vFiles = r.files;
  $('#i2vFolder').value = r.dir || '';
  $('#i2vFileInfo').textContent =
    `Đã chọn ${r.files.length} ảnh: ${r.files.slice(0, 3).map((f) => f.name).join(', ')}` +
    (r.files.length > 3 ? '…' : '');
  if (!parseInt($('#i2vTo').value, 10)) $('#i2vTo').value = r.files.length;
  scheduleSave();
});

$('#btnI2vCheck').addEventListener('click', async () => {
  const out = $('#i2vResult');
  if (!app.i2vFiles.length) { out.textContent = 'Hãy chọn thư mục ảnh trước.'; return; }
  out.textContent = '⏳ Đang kiểm tra tên ảnh…';
  const r = await window.flowApp.engine.checkAssetNames({
    files: app.i2vFiles.map((f) => f.name), settings: collectSettings()
  });
  out.innerHTML = r && r.ok === false
    ? `<span style="color:#fca5a5">❌ ${escapeHtml(r.error)}</span>`
    : `<span style="color:#86efac">✅ Đã kiểm tra ${app.i2vFiles.length} ảnh.</span>`;
});

$('#btnI2vUpload').addEventListener('click', async () => {
  const out = $('#i2vResult');
  if (!app.i2vFiles.length) { out.textContent = 'Hãy chọn thư mục ảnh trước.'; return; }
  out.textContent = `⏳ Đang tải ${app.i2vFiles.length} ảnh lên Flow…`;
  const r = await window.flowApp.engine.uploadImages({
    files: app.i2vFiles, settings: collectSettings(), prompts: allPrompts()
  });
  out.innerHTML = r && r.ok === false
    ? `<span style="color:#fca5a5">❌ ${escapeHtml(r.error)}</span>`
    : `<span style="color:#86efac">✅ Đã gửi yêu cầu tải ảnh lên Flow. Xem Nhật ký để theo dõi.</span>`;
  showPane('logs');
});


// ══════════════════════════════════════════════════════════ KHO ẢNH FLOW
//  Dùng khi ảnh ĐÃ nằm trong kho Flow (vừa tạo bằng chính tool, hoặc tải lên
//  từ trước). Không cần chọn file: chỉ khai mã ảnh, app sinh prompt
//  "<câu lệnh> @<mã ảnh>" — Character Sync của Flow tự lấy đúng ảnh ra dựng.

/** Dựng mã ảnh từ khoảng số. Ví dụ 1→3, pad 2, tiền tố "anh" -> anh01..anh03 */
function buildNames({ from, to, pad, prefix, suffix }) {
  const a = parseInt(from, 10), b = parseInt(to, 10);
  const p = Math.min(6, Math.max(1, parseInt(pad, 10) || 2));
  if (!Number.isInteger(a) || !Number.isInteger(b) || b < a) return [];
  if (b - a > 999) return [];
  const pre = String(prefix || '').trim(), suf = String(suffix || '').trim();
  const out = [];
  for (let i = a; i <= b; i++) out.push(`${pre}${String(i).padStart(p, '0')}${suf}`);
  return out;
}

/** Mã ảnh phải khớp cú pháp @tag: chỉ chữ, số, gạch dưới. */
function badNames(names) {
  return names.filter((n) => !/^[\p{L}\p{N}_]+$/u.test(n));
}

function flowAssetNames() {
  return buildNames({
    from: $('#faFrom').value, to: $('#faTo').value, pad: $('#faPad').value,
    prefix: $('#faPrefix').value, suffix: $('#faSuffix').value
  });
}

function refreshFlowAssets() {
  const names = flowAssetNames();
  $('#flowAssetCount').textContent = `${names.length} ảnh`;
  const sel = $('#faTab');
  const giu = sel.value;
  sel.innerHTML = '';
  for (const t of app.tabs.filter((x) => x.ready)) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = `${t.id}${t.accountName ? ' · ' + t.accountName : ''}`;
    sel.appendChild(o);
  }
  if (!sel.options.length) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = 'chưa có tab sẵn sàng';
    sel.appendChild(o);
  }
  if (giu && [...sel.options].some((o) => o.value === giu)) sel.value = giu;
}

['#faFrom', '#faTo', '#faPad', '#faPrefix', '#faSuffix']
  .forEach((k) => $(k).addEventListener('input', refreshFlowAssets));

// ══════════════════════════════════════════════════════════ CHẾ ĐỘ TRÊN FLOW
//
//  Phần TỰ ĐỘNG vẫn chạy trước mỗi mẻ và trước mỗi lần nối ảnh→video. Mục này
//  không thay thế nó, mà là đường chữa tay cho hai trường hợp:
//    1. Người dùng muốn đặt sẵn từ đầu, không phải chờ lúc chạy mới biết.
//    2. Google đổi giao diện làm phần tự động trượt — có nút bấm tay thì cả mẻ
//       không chết, thay vì ngồi đợi 5 lần thử rồi bỏ cuộc.
//  Flow nhớ chế độ theo từng dự án, nên đặt một lần là giữ nguyên.

function refreshModeTabs() {
  const sel = $('#modeTab');
  if (!sel) return;
  const giu = sel.value;
  sel.innerHTML = '';
  const san = app.tabs.filter((t) => t.ready);
  if (san.length > 1) {
    const o = document.createElement('option');
    o.value = '*'; o.textContent = `Tất cả ${san.length} tab đang sẵn sàng`;
    sel.appendChild(o);
  }
  for (const t of san) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = `${t.id}${t.accountName ? ' · ' + t.accountName : ''}`;
    sel.appendChild(o);
  }
  if (!sel.options.length) {
    const o = document.createElement('option');
    o.value = ''; o.textContent = 'chưa có tab sẵn sàng';
    sel.appendChild(o);
  }
  if (giu && [...sel.options].some((o) => o.value === giu)) sel.value = giu;
}

/** Tab mà mục chế độ đang nhắm tới. */
function tabsCuaMucCheDo() {
  const v = $('#modeTab').value;
  if (!v) return [];
  if (v === '*') return app.tabs.filter((t) => t.ready).map((t) => t.id);
  return [v];
}

const NHAN_CHE_DO = { video: '🎬 Tạo video', image: '🖼 Tạo ảnh' };

async function docCheDoTab(imLang = false) {
  const ids = tabsCuaMucCheDo();
  const ket = $('#flowModeResult');
  const pill = $('#flowModeNow');
  if (!ids.length) {
    pill.textContent = 'chưa có tab';
    if (!imLang) ket.textContent = 'Mở một tab Flow ở mục Tài khoản trước đã.';
    return;
  }

  const ds = [];
  for (const id of ids) {
    const r = await window.flowApp.tabs.getMode(id);
    ds.push({ id, mode: (r && r.ok) ? r.mode : null, lyDo: r && r.lyDo });
  }

  const khac = new Set(ds.map((d) => d.mode));
  pill.textContent = khac.size === 1
    ? (NHAN_CHE_DO[ds[0].mode] || 'chưa rõ')
    : `${ds.length} tab, khác nhau`;

  ket.innerHTML = ds.map((d) => `<b>${escapeHtml(d.id)}</b>: ` +
    (d.mode ? NHAN_CHE_DO[d.mode]
            : `chưa đọc được${d.lyDo ? ' (' + escapeHtml(d.lyDo) + ')' : ''}`)).join(' · ');
}

async function datCheDoTab(mode) {
  const ids = tabsCuaMucCheDo();
  const ket = $('#flowModeResult');
  if (!ids.length) { ket.textContent = 'Mở một tab Flow ở mục Tài khoản trước đã.'; return; }

  ket.textContent = `Đang đổi ${ids.length} tab sang ${NHAN_CHE_DO[mode]}…`;
  const phan = [];
  for (const id of ids) {
    const r = await window.flowApp.tabs.setMode(id, mode);
    phan.push(`<b>${escapeHtml(id)}</b>: ` + (r && r.ok
      ? (r.daDoi ? '✅ đã đổi' : '✅ vốn đã đúng')
      : `❌ ${escapeHtml((r && r.lyDo) || 'không rõ lý do')}`));
  }
  ket.innerHTML = phan.join(' · ');
  await docCheDoTab(true);
}

$('#btnModeVideo').addEventListener('click', () => datCheDoTab('video'));
$('#btnModeImage').addEventListener('click', () => datCheDoTab('image'));
$('#btnModeCheck').addEventListener('click', () => docCheDoTab());

$('#btnCheckFlowAssets').addEventListener('click', async () => {
  const out = $('#faResult');
  const names = flowAssetNames();
  if (!names.length) { out.textContent = 'Kiểm tra lại "Từ ảnh số" / "Đến ảnh số".'; return; }

  const xau = badNames(names);
  if (xau.length) {
    out.innerHTML = `<span style="color:#fca5a5">❌ Mã ảnh không hợp lệ: <b>${escapeHtml(xau[0])}</b> — chỉ được chữ, số, gạch dưới (không dấu cách, không gạch nối).</span>`;
    return;
  }

  out.textContent = `⏳ Đang dò ${Math.min(12, names.length)} mã đầu trong kho Flow…`;
  const r = await window.flowApp.engine.checkFlowAssets({ names, tabId: $('#faTab').value || null });

  if (r.ok === false) {
    out.innerHTML = `<span style="color:#fca5a5">❌ ${escapeHtml(r.error || 'Không kiểm tra được')}</span>`;
  } else if (Array.isArray(r.missing) && r.missing.length) {
    out.innerHTML = `<span style="color:#fcd34d">⚠️ Kho Flow của <b>${escapeHtml(r.tabId || '')}</b> thiếu ${r.missing.length}/${r.sampled} mã mẫu: ${escapeHtml(r.missing.slice(0, 8).join(', '))}</span>`;
  } else {
    out.innerHTML = `<span style="color:#86efac">✅ Kho Flow của <b>${escapeHtml(r.tabId || '')}</b> có đủ ${r.sampled}/${r.sampled} mã mẫu — sinh danh sách là chạy được.</span>`;
  }
});

$('#btnGenPrompts').addEventListener('click', async () => {
  const out = $('#faResult');
  const names = flowAssetNames();
  if (!names.length) { out.textContent = 'Kiểm tra lại "Từ ảnh số" / "Đến ảnh số".'; return; }

  const xau = badNames(names);
  if (xau.length) {
    out.innerHTML = `<span style="color:#fca5a5">❌ Mã ảnh không hợp lệ: <b>${escapeHtml(xau[0])}</b></span>`;
    return;
  }

  const chung = $('#faPrompt').value.trim();
  if (!chung) { out.textContent = 'Hãy nhập câu lệnh video dùng chung cho mọi ảnh.'; return; }

  const dangCo = allPrompts().length;
  if (dangCo) {
    const ok = await hoiCo({
      title: 'Thay toàn bộ danh sách prompt?',
      desc: `Đang có ${dangCo} prompt. Danh sách mới ${names.length} dòng sẽ THAY THẾ hết.`,
      okText: 'Thay'
    });
    if (!ok) return;
  }

  // Mã ảnh đặt CUỐI câu cho đọc tự nhiên; Character Sync quét @tag ở mọi vị trí.
  $('#promptSeparator').value = 'line';
  $('#promptsInput').value = names.map((n) => `${chung} @${n}`).join('\n');
  $('#startIndex').value = 1;
  $('#endIndex').value = '';
  refreshPromptStats();

  // Sinh prompt cho ảnh -> chắc chắn là mẻ VIDEO, và phải bật Character Sync,
  // nếu không Flow dựng video từ chữ chứ không dùng ảnh nào cả.
  const rv = document.querySelector('input[name="runMode"][value="video"]');
  if (rv) { rv.checked = true; rv.dispatchEvent(new Event('change')); }
  $('#charSync').checked = true;
  scheduleSave();

  out.innerHTML = `<span style="color:#86efac">✅ Đã sinh ${names.length} prompt, bật sẵn chế độ video + Character Sync. Chọn tab rồi bấm Bắt đầu.</span>`;
});

// ── Chuỗi ảnh → video ────────────────────────────────────────────────────
$('#chainEnabled').addEventListener('change', (e) => {
  $('#chainBox').classList.toggle('hidden', !e.target.checked);
  refreshChainPreview();
});

/**
 * Cho người dùng NHÌN THẤY mã ảnh trước khi chạy.
 *
 * Đây là bài học đắt nhất của bản 2.3.0: app in ra "(001 → 002)" còn kho Flow
 * hiện "01", "02" — hai thứ chỉ gặp nhau ở nhật ký sau khi mẻ ảnh đã chạy
 * xong hàng tiếng đồng hồ. Đặt ngay dưới ô chọn thì lệch một chữ số cũng lộ
 * ra trước khi bấm Bắt đầu.
 */
async function refreshChainPreview() {
  const box = $('#chainNamePreview');
  if (!box) return;
  if (!$('#chainEnabled').checked) { box.textContent = '—'; return; }

  const { prompts, indices } = selectedRange();
  if (!indices.length) {
    box.textContent = 'Chưa có prompt nào để xem trước mã ảnh.';
    return;
  }

  let names = [];
  if ($('#chainNameSource').value === 'range') {
    names = flowAssetNames();
  } else {
    try {
      const jobs = indices.map((i) => ({ index: i, text: prompts[i - 1] || '' }));
      const r = await window.flowApp.run.chainPreview({ settings: collectSettings('image'), jobs });
      if (!r || !r.ok) { box.textContent = 'Chưa xem trước được mã ảnh.'; return; }
      names = r.names || [];
    } catch (_) {
      box.textContent = 'Chưa xem trước được mã ảnh.';
      return;
    }
  }

  if (!names.length) { box.textContent = 'Không sinh được mã ảnh nào.'; return; }

  const xau = badNames(names);
  const vaiCai = names.slice(0, 4).join(', ') + (names.length > 4 ? `, … , ${names[names.length - 1]}` : '');
  box.innerHTML = xau.length
    ? `<span style="color:#fca5a5">⚠️ ${names.length} mã ảnh: <b>${vaiCai}</b> — ` +
      `${xau.length} mã chứa ký tự Character Sync không đọc được (@tag chỉ nhận chữ, số, gạch dưới). ` +
      `Sang "Tải về — Ảnh → Kiểu đặt tên", chọn "Chỉ số thứ tự".</span>`
    : `Mã ảnh sẽ dùng để nối (${names.length} ảnh): <b>${vaiCai}</b>. ` +
      `Phải trùng khít tên ảnh trong kho Flow thì Character Sync mới bắt đúng.`;
}

['#chainNameSource', '#renameModeImage', '#renameIndexPadImage', '#renamePrefixImage',
 '#renameSuffixImage', '#renameStartIndexImage', '#outputCount',
 '#faFrom', '#faTo', '#faPad', '#faPrefix', '#faSuffix']
  .forEach((sel) => { const el = $(sel); if (el) el.addEventListener('input', refreshChainPreview); });
$('#promptsInput').addEventListener('input', refreshChainPreview);

// ══════════════════════════════════════════════════════════ XEM TRƯỚC TÊN FILE
//
//  Mỗi ô đổi tên một mình thì vô hại; ghép lại mới ra cái tên thật, và cái
//  tên thật là thứ quyết định Character Sync có bắt đúng ảnh hay không. Xem
//  trước ngay tại chỗ chỉnh thì sai lệch lộ ra lập tức, không phải chạy xong
//  cả mẻ rồi mới biết.
//
//  Tính bằng IPC — cùng hàm tiến trình chính dùng lúc chạy (tenAnhTheoRename,
//  bản sao của generateFileName trong engine). Tính lại ở đây là tạo một bản
//  sao thứ hai để lệch nhau.
async function refreshRenamePreview() {
  const { prompts, indices } = selectedRange();
  const mau = indices.length
    ? indices.slice(0, 3).map((i) => ({ index: i, text: prompts[i - 1] || '' }))
    : [{ index: 1, text: 'một cảnh biển lúc hoàng hôn' }];

  for (const hau of ['Video', 'Image']) {
    const box = $('#renamePreview' + hau);
    if (!box) continue;
    const cach = $('#downloadMode' + hau);
    if (cach && cach.value === 'none') {
      box.textContent = 'Không tự tải — tên file do trình duyệt đặt.';
      continue;
    }
    if (!$('#autoRename' + hau).checked) {
      box.textContent = 'Tắt tự đổi tên — file giữ nguyên tên Flow đặt.';
      continue;
    }
    try {
      const r = await window.flowApp.run.chainPreview({
        settings: collectSettings(hau === 'Image' ? 'image' : 'video'),
        jobs: mau
      });
      if (!r || !r.ok || !r.names || !r.names.length) { box.textContent = 'Tên file sẽ là: —'; continue; }
      const duoi = hau === 'Image' ? '.jpeg' : '.mp4';
      const sub = ($('#subfolder' + hau).value || '').trim();
      const thuMuc = sub ? sub.replace(/\/+$/, '') + '/' : '';
      box.innerHTML = 'Tên file sẽ là: <b>' +
        r.names.slice(0, 3).map((n) => escapeHtml(thuMuc + n + duoi)).join('</b>, <b>') +
        '</b>' + (indices.length > 3 ? ' …' : '');
    } catch (_) {
      box.textContent = 'Tên file sẽ là: —';
    }
  }
}

// Bất cứ ô nào ảnh hưởng tới tên file đều vẽ lại phần xem trước.
for (const hau of ['Video', 'Image']) {
  for (const k of TAI_VE_FIELDS.concat(TAI_VE_SWITCHES)) {
    const el = $('#' + k + hau);
    if (el) el.addEventListener('input', refreshRenamePreview);
  }
}
['#promptsInput', '#startIndex', '#endIndex', '#customIndices', '#outputCount']
  .forEach((sel) => { const el = $(sel); if (el) el.addEventListener('input', refreshRenamePreview); });

/**
 * Gói thông tin chuỗi để gửi kèm lệnh chạy.
 *
 * Ở lối "auto" (mặc định) giao diện KHÔNG tự đánh số nữa: tiến trình chính
 * suy tên ảnh từ chính cài đặt đổi tên bằng tenAnhTheoRename() — bản sao của
 * generateFileName(), đúng hàm engine dùng khi đổi tên ảnh trên kho Flow.
 * Bản 2.3.0 tự đánh số ở đây nên sinh "001" trong khi Flow đặt "01".
 *
 * Ở lối "range" thì imageNames là danh sách người dùng tự khai, xếp THẲNG HÀNG
 * với danh sách prompt để mỗi tab lấy đúng phần của nó (xem main.js).
 */
function buildChainPayload(prompts) {
  if (!$('#chainEnabled').checked) return null;
  const videoPrompt = $('#chainPrompt').value.trim();
  if (!videoPrompt) {
    pushLog('warning', '⚠️ Bật tự nối ảnh→video nhưng chưa nhập câu lệnh video — bỏ qua phần nối.');
    return null;
  }

  const nameSource = $('#chainNameSource').value === 'range' ? 'range' : 'auto';
  let imageNames = null;

  if (nameSource === 'range') {
    imageNames = flowAssetNames();
    if (imageNames.length < prompts.length) {
      pushLog('warning',
        `⚠️ Khoảng mã ảnh chỉ có ${imageNames.length} mã nhưng có ${prompts.length} prompt — ` +
        `phần thừa sẽ không được nối.`);
    }
  } else if ($('#renameModeImage').value !== 'index_only') {
    // Ở chế độ đặt tên mặc định, tên ảnh là "05_mot_dam_may_troi..." — dài,
    // có dấu gạch dưới lẫn gạch nối, và @tag của Character Sync cắt ngay ở
    // ký tự đầu tiên không phải chữ/số/gạch dưới. Nối được về mặt kỹ thuật
    // nhưng Flow bắt nhầm ảnh, mà lỗi kiểu đó rất khó nhận ra khi xem lại.
    pushLog('warning',
      '⚠️ Tự nối ảnh→video chạy chắc nhất khi "Tải về — Ảnh → Kiểu đặt tên" ' +
      'đang để "Chỉ số thứ tự". Kiểu đặt tên hiện tại sinh ra mã ảnh dài, ' +
      'Character Sync dễ bắt nhầm ảnh.');
  }

  return {
    enabled: true,
    videoPrompt,
    nameSource,
    imageNames,
    skipIfFailed: $('#chainSkipIfFailed').checked
  };
}

// ══════════════════════════════════════════════════════════ TIẾN ĐỘ TỪNG TAB

function renderTabProgress(payload) {
  const box = $('#tabProgress');
  const perTab = (payload && payload.perTab) || [];

  if (!perTab.length) {
    box.innerHTML = '<p class="hint">Chưa có tab nào. Sang mục Tài khoản để mở tab.</p>';
    $('#tabProgSummary').textContent = 'chưa chạy';
    return;
  }

  box.innerHTML = '';
  for (const t of perTab) {
    const tong = t.assigned || 0;
    const xong = t.done || 0;

    // ── Phần trăm: tính cả phần đang dở ──────────────────────────────
    // Chỉ đếm prompt XONG thì thanh đứng im 30-60 giây mỗi lần tạo, nhìn như
    // treo. Cộng thêm phần trăm của cái đang tạo (engine gửi kèm) thì thanh
    // nhích đều và người dùng thấy máy vẫn đang làm việc.
    const dangLam = (t.running || 0) * ((t.tienTrinh || 0) / 100);
    const pct = tong ? Math.min(100, Math.round(((xong + dangLam) / tong) * 100)) : 0;

    // Đang nghỉ hạ nhiệt thì tab cũng "không chạy" — nhưng mẻ CHƯA xong, và
    // app sẽ tự bật lại. Không nói rõ thì người dùng tưởng hỏng và bấm Dừng.
    const pha = t.nghi ? ` · 🛡 đang nghỉ hạ nhiệt${t.nghiConLai ? ', còn ' + Math.ceil(t.nghiConLai / 60000) + ' phút' : ''}`
              : t.phase === 'image' ? ' · đang tạo ảnh, sẽ nối video'
              : t.phase === 'video' ? ' · đang dựng video từ ảnh' : '';

    // ── Trạng thái tải ───────────────────────────────────────────────
    // Tạo xong KHÔNG phải là đã tải: còn đổi tên trên Flow, chờ máy chủ xuất
    // file, rồi mới tải. Tách hẳn ra để không ai tắt app lúc file chưa về đĩa.
    const daTai = t.daTai || 0, canTai = t.canTai || 0, loiTai = t.loiTai || 0;
    let nhanTai, lopTai;
    if (loiTai)                      { nhanTai = `⚠ ${daTai}/${canTai} đã tải · ${loiTai} lỗi tải`; lopTai = 'err'; }
    else if (t.dangTai)              { nhanTai = `⬇ đang tải… ${daTai}/${canTai}`;                 lopTai = 'run'; }
    else if (canTai && daTai >= canTai) { nhanTai = `✓ đã tải đủ ${daTai}`;                         lopTai = 'ok'; }
    else if (canTai)                 { nhanTai = `${daTai}/${canTai} đã tải`;                       lopTai = ''; }
    else                             { nhanTai = 'chưa có gì để tải';                               lopTai = ''; }

    const dangTao = t.running
      ? `${t.running} đang tạo${t.tienTrinh ? ' · ' + t.tienTrinh + '%' : ''}`
      : '';

    const el = document.createElement('div');
    el.className = 'tprow' + (t.busy ? ' run' : '');
    el.innerHTML =
      `<div class="tprow-id">
         <div class="tprow-name"><i class="dot ${t.busy ? 'ok' : ''}"></i>${escapeHtml(t.tabId)}</div>
         <div class="tprow-acc">${escapeHtml(t.accountName || '')}${pha}</div>
       </div>
       <div class="tprow-bar">
         <div class="progress"><i style="width:${pct}%"></i></div>
         <div class="tprow-acc" style="margin-top:4px">
           ${xong}/${tong || '—'} · ${pct}%${dangTao ? ' · ' + dangTao : ''}
         </div>
         <div class="tprow-acc tai ${lopTai}" style="margin-top:2px">${nhanTai}</div>
       </div>
       <div class="tprow-nums">
         <span class="ok"><b>${xong}</b><span class="lbl">xong</span></span>
         <span class="run"><b>${t.running || 0}</b><span class="lbl">chạy</span></span>
         <span class="dl"><b>${daTai}</b><span class="lbl">đã tải</span></span>
         <span class="err"><b>${t.failed || 0}</b><span class="lbl">lỗi</span></span>
       </div>`;

    // Điều khiển RIÊNG cho từng tab — dừng tab này không đụng tab khác.
    const act = document.createElement('div');
    act.className = 'tprow-act';
    const them = (nhan, cls, fn, title) => {
      const b = document.createElement('button');
      b.className = 'btn sm' + (cls ? ' ' + cls : '');
      b.textContent = nhan; if (title) b.title = title;
      b.addEventListener('click', fn);
      act.appendChild(b);
    };
    if (t.busy) {
      them('⏸', '', () => window.flowApp.run.pause([t.tabId]), 'Tạm dừng riêng tab này');
      them('⏹', 'danger', () => window.flowApp.run.stop([t.tabId]), 'Dừng riêng tab này');
    } else {
      them('⏵', 'ok', () => window.flowApp.run.resume([t.tabId]), 'Chạy tiếp riêng tab này');
    }
    el.appendChild(act);
    box.appendChild(el);
  }

  const g = payload.tong || {};
  const dangChay = perTab.filter((t) => t.busy).length;
  const phanTai = g.canTai ? ` · ${g.daTai}/${g.canTai} đã tải` : '';
  $('#tabProgSummary').textContent = dangChay
    ? `${dangChay} tab đang chạy · ${g.done}/${g.assigned} xong${phanTai} · ${g.failed} lỗi`
    : (g.assigned ? `${g.done}/${g.assigned} xong${phanTai} · ${g.failed} lỗi` : 'chưa chạy');
}

$('#btnRefreshStats').addEventListener('click', async () => {
  renderTabProgress(await window.flowApp.run.stats());
});

// ══════════════════════════════════════════════════════════ NHẬT KÝ

function pushLog(level, message, tabId) {
  renderLogLine({ level, message, tabId, time: new Date().toLocaleTimeString('vi-VN', { hour12: false }) });
}

function renderLogLine(entry) {
  app.logs.push(entry);
  if (app.logs.length > 3000) app.logs.splice(0, app.logs.length - 3000);

  const box = $('#logBox');
  const duoiCung = box.scrollHeight - box.scrollTop - box.clientHeight < 40;

  const div = document.createElement('div');
  div.className = 'logline ' + (entry.level || 'info');
  const tag = entry.tabId ? `[${entry.tabId}] ` : '';
  div.innerHTML = `<span class="t">${entry.time}</span><span class="m">${escapeHtml(tag + entry.message)}</span>`;
  box.appendChild(div);

  while (box.children.length > 3000) box.removeChild(box.firstChild);
  if (duoiCung && $('#autoScrollLogs').checked) box.scrollTop = box.scrollHeight;
}

function logAsText() {
  return app.logs.map((l) => `[${l.time}] ${l.tabId ? '[' + l.tabId + '] ' : ''}${l.message}`).join('\n');
}

$('#btnClearLog').addEventListener('click', () => { app.logs = []; $('#logBox').innerHTML = ''; });
$('#btnCopyLog').addEventListener('click', () => {
  navigator.clipboard.writeText(logAsText()).then(() => pushLog('success', '⧉ Đã chép nhật ký vào clipboard'));
});
$('#btnSaveLog').addEventListener('click', async () => {
  const p = await window.flowApp.dialog.saveTxt(logAsText(), 'flow-studio-nhat-ky.txt');
  if (p) pushLog('success', `💾 Đã lưu nhật ký: ${p}`);
});

// ══════════════════════════════════════════════════════════ BẢNG TIẾN ĐỘ

// Engine gửi trạng thái CHỮ HOA (STATUS trong flow-engine.js):
// WAITING / PASTING / CREATING / COMPLETED / ERROR.
// Bản trước dò bằng chữ thường nên mọi dòng đều rơi về "Chờ" — bảng trông
// như đứng yên dù engine vẫn chạy.
const BADGE = {
  COMPLETED: ['ok',   'Xong'],
  ERROR:     ['err',  'Lỗi'],
  CREATING:  ['run',  'Đang tạo'],
  PASTING:   ['run',  'Đang dán'],
  WAITING:   ['wait', 'Chờ'],
  // giữ cả chữ thường cho dữ liệu cũ và cho kiểm thử
  done: ['ok', 'Xong'], success: ['ok', 'Xong'],
  error: ['err', 'Lỗi'], failed: ['err', 'Lỗi'],
  running: ['run', 'Đang chạy'], pending: ['wait', 'Chờ'], waiting: ['wait', 'Chờ']
};

/**
 * Trạng thái TẢI của một dòng — tách hẳn khỏi trạng thái TẠO.
 *
 * Hai thứ này khác nhau và người dùng cần thấy cả hai: Flow tạo xong rồi còn
 * phải đổi tên trên kho, chờ máy chủ xuất file, rồi mới tải. Nhật ký thật cho
 * thấy khoảng đó mất 15-40 giây mỗi cái. Gộp làm một là có lúc "Xong" mà file
 * chưa hề nằm trên đĩa.
 */
function trangThaiTai(row) {
  if (row.downloadError) return ['err', '⚠ Lỗi tải'];
  if (row.downloaded) {
    return ['ok', row.totalVideos > 1 ? `✓ Đã tải ${row.downloadedCount}/${row.totalVideos}` : '✓ Đã tải'];
  }
  if (row.status !== 'COMPLETED') return ['wait', '—'];
  if (row.downloadedCount > 0)    return ['run', `⬇ ${row.downloadedCount}/${row.totalVideos || '?'}`];
  return ['run', '⬇ Đang tải…'];
}

function renderTable() {
  const tbody = $('#progressTable');
  if (!app.rows.size) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Chưa có dữ liệu</td></tr>';
    $('#tableCount').textContent = '0 dòng';
    return;
  }

  tbody.innerHTML = '';
  for (const row of app.rows.values()) {
    const [cls, nhan] = BADGE[row.status] || BADGE[String(row.status || '').toLowerCase()] || BADGE.WAITING;
    const tab = app.tabs.find((t) => t.id === row.tabId);
    const tr = document.createElement('tr');
    // Phần trăm chỉ có nghĩa lúc đang tạo; xong rồi mà còn hiện 87% thì
    // người đọc tưởng dở dang.
    const pct = (cls === 'run' && row.progress > 0) ? ` ${row.progress}%` : '';

    const [clsTai, nhanTai] = trangThaiTai(row);

    tr.innerHTML =
      `<td>${row.index ?? ''}</td>` +
      `<td class="wrap">${escapeHtml(String(row.prompt || '').slice(0, 200))}</td>` +
      `<td>${escapeHtml(tab ? tab.accountName : '')}</td>` +
      `<td>${escapeHtml(row.tabId || '')}</td>` +
      `<td><span class="badge ${cls}">${nhan}${pct}</span></td>` +
      `<td><span class="badge ${clsTai}">${nhanTai}</span></td>`;
    tbody.appendChild(tr);
  }
  $('#tableCount').textContent = `${app.rows.size} dòng`;
}

function refreshCounters() {
  $('#stDone').textContent   = app.stats.done;
  $('#stFailed').textContent = app.stats.failed;
  $('#navDone').textContent  = app.stats.done;
  $('#navPending').textContent = Math.max(0, app.stats.total - app.stats.done);

  const pct = app.stats.total ? Math.round((app.stats.done / app.stats.total) * 100) : 0;
  $('#stDoneSub').textContent = `${pct}% tiến độ`;
  $('#progressBar').style.width = pct + '%';
  $('#progressText').textContent = app.stats.total
    ? `${app.stats.done}/${app.stats.total} prompt · ${app.stats.failed} lỗi`
    : 'Chưa chạy';
}

// ══════════════════════════════════════════════════════════ SỰ KIỆN TỪ MAIN

window.flowApp.on('log', renderLogLine);

window.flowApp.on('tabs', (list) => {
  app.tabs = list || [];
  for (const id of [...app.selectedTabs]) {
    if (!app.tabs.some((t) => t.id === id)) app.selectedTabs.delete(id);
  }
  renderTabs(); renderAccounts(); refreshFlowAssets(); refreshModeTabs(); syncBrowserBounds();
});

window.flowApp.on('accounts', (list) => { app.accounts = list || []; renderAccounts(); });

window.flowApp.on('stats', (d) => {
  renderTabProgress(d);
  const g = (d && d.tong) || {};
  app.stats.done   = g.done   || 0;
  app.stats.failed = g.failed || 0;
  if (g.assigned) app.stats.total = g.assigned;
  $('#stRunning').textContent = ((d && d.perTab) || []).filter((t) => t.busy).length;
  refreshCounters();
  setRunning(((d && d.perTab) || []).some((t) => t.busy));
});

window.flowApp.on('table', (d) => {
  for (const r of (Array.isArray(d.rows) ? d.rows : [])) {
    const key = `${d.tabId || ''}#${r.index ?? r.promptIndex}`;
    app.rows.set(key, {
      index: r.index ?? r.promptIndex,
      prompt: r.prompt ?? r.promptText,
      status: r.status, tabId: d.tabId,
      // Engine gửi sẵn cả bốn thứ này trong sendTableUpdate(); cột "Tên file"
      // cũ đọc r.filename — một trường engine KHÔNG hề gửi, nên cột đó xưa
      // nay luôn trống. Nay hiển thị đúng thứ engine có.
      progress: r.progress || 0,
      downloaded: !!r.downloaded,
      downloadError: !!r.downloadError,
      downloadedCount: r.downloadedCount || 0,
      totalVideos: r.totalVideos || 0
    });
  }
  renderTable();
});

window.flowApp.on('progress', (d) => {
  if (typeof d.done === 'number') app.stats.done = d.done;
  refreshCounters();
});

window.flowApp.on('run-state', (d) => {
  if (d && d.running === false && !app.tabs.some((t) => t.busy)) setRunning(false);
});

// ══════════════════════════════════════════════════════════ TIỆN ÍCH

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Móc cho kiểm thử tự động (tests/smoke.js) ──────────────────────────
window.__jsErrors = [];
window.addEventListener('error', (e) => window.__jsErrors.push(`${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) =>
  window.__jsErrors.push('Promise không bắt: ' + (e.reason && e.reason.message || e.reason)));

window.__testTable = (rows) => {
  app.rows.clear();
  rows.forEach((r, i) => app.rows.set('t#' + i, { ...r, tabId: r.tabId || 'tab1' }));
  app.stats.total = rows.length;
  app.stats.done = rows.filter((r) => r.status === 'done').length;
  app.stats.failed = rows.filter((r) => r.status === 'error').length;
  renderTable(); refreshCounters();
};
window.__testLog = (lv, m, tab) => pushLog(lv, m, tab);
window.__testProgress = (p) => renderTabProgress(p);
window.__flowAssetNames = () => flowAssetNames();
window.__badNames = (n) => badNames(n);
window.__hoiChu = hoiChu;
window.__buildChainPayload = buildChainPayload;
window.__testAccounts = (list) => { app.accounts = list; renderAccounts(); };
window.__collectSettings = collectSettings;
window.__parseIndexList = parseIndexList;

// ══════════════════════════════════════════════════════════ KHỞI ĐỘNG

(function initSync() {
  // Không await gì TRƯỚC khi gắn sự kiện — lỗi đã trả giá ở tiện ích 1.9.0:
  // panel await background lúc khởi tạo, worker không phản hồi là panel đứng im.
  const sel = $('#voiceSelect');
  for (const v of VOICES) {
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    sel.appendChild(o);
  }
  sel.size = 1;

  refreshPromptStats();
  renderTabs();
  renderTable();
  refreshCounters();
  setRunning(false);
  syncConditionalFields();
  refreshFlowAssets();
  refreshModeTabs();
  refreshChainPreview();
  refreshRenamePreview();
  renderTabProgress(null);
  syncBrowserBounds();
})();

(async function initAsync() {
  try {
    const { veoSettings } = await window.flowApp.settings.get();
    applySettings(veoSettings);
  } catch (_) {
    pushLog('warning', '⚠️ Chưa đọc được cài đặt đã lưu, đang dùng mặc định');
  }

  try { await loadAccounts(); } catch (_) {}

  try {
    const info = await window.flowApp.system.version();
    $('#verPill').textContent = 'v' + info.version;
    $('#sysInfo').innerHTML =
      `Phiên bản <b>${info.version}</b> · Electron ${info.electron} · Chromium ${info.chrome}<br>` +
      `Dữ liệu: <code>${escapeHtml(info.dataDir)}</code>`;
    $('#btnOpenData').addEventListener('click', () => window.flowApp.system.openPath(info.dataDir));
    $('#btnOpenLog').addEventListener('click',  () => info.logFile && window.flowApp.system.openPath(info.logFile));
  } catch (_) {}

  try { app.tabs = await window.flowApp.tabs.list(); renderTabs(); syncBrowserBounds(); } catch (_) {}

  try { veCapNhat(await window.flowApp.capNhat.trangThai()); } catch (_) {}
})();

// ══════════════════════════════════════════════════════════ CẬP NHẬT
//  Mọi quyết định (có bản mới không, tải, kiểm mã băm, cài kiểu gì) nằm ở
//  src/main/cap-nhat.js. Ở đây chỉ vẽ trạng thái và chuyển nút bấm.

const CHU_CAP_NHAT = {
  'chua-kiem':  'chưa kiểm',
  'dang-kiem':  'đang kiểm…',
  'moi-nhat':   'mới nhất',
  'co-ban-moi': 'có bản mới',
  'dang-tai':   'đang tải…',
  'da-tai':     'sẵn sàng cài',
  'loi':        'lỗi'
};

function veCapNhat(tt) {
  if (!tt) return;
  app.capNhat = tt;
  $('#capNhatPill').textContent = CHU_CAP_NHAT[tt.trangThai] || tt.trangThai;

  const coMoi = !!tt.phienBanMoi && ['co-ban-moi', 'dang-tai', 'da-tai'].includes(tt.trangThai);
  const pill = $('#pillCapNhat');
  pill.hidden = !coMoi;
  if (coMoi) pill.textContent = tt.trangThai === 'da-tai' ? `⬆ Cài bản ${tt.phienBanMoi}` : `⬆ Có bản ${tt.phienBanMoi}`;

  let dong;
  if (tt.trangThai === 'moi-nhat') dong = `Đang dùng bản mới nhất (<b>${escapeHtml(tt.phienBanHienTai)}</b>).`;
  else if (tt.trangThai === 'dang-tai') dong = `Đang tải bản <b>${escapeHtml(tt.phienBanMoi)}</b>… ${tt.tienDo || 0}%`;
  else if (tt.trangThai === 'da-tai') dong = `Bản <b>${escapeHtml(tt.phienBanMoi)}</b> đã tải xong, đã kiểm mã băm. ` +
    (tt.kieu === 'tu-dong' ? 'Bấm <b>Cài &amp; mở lại</b>, hoặc để app tự cài khi bạn thoát.' : escapeHtml(tt.lyDo || ''));
  else if (tt.trangThai === 'co-ban-moi') dong = `Có bản <b>${escapeHtml(tt.phienBanMoi)}</b> (đang dùng ${escapeHtml(tt.phienBanHienTai)}). ` +
    escapeHtml(tt.loi || (tt.kieu === 'thu-cong' ? tt.lyDo || '' : ''));
  else if (tt.trangThai === 'loi') dong = `⚠️ ${escapeHtml(tt.loi || 'không rõ lỗi')}`;
  else if (tt.trangThai === 'dang-kiem') dong = 'Đang hỏi GitHub…';
  else dong = 'App tự hỏi GitHub có bản mới không — lần đầu sau khi mở 20 giây, rồi 4 giờ một lần.';
  if (['thu-cong', 'mo-finder', 'mo-bo-cai'].includes(tt.kieu) && tt.trangThai !== 'moi-nhat' && tt.lyDo && !dong.includes(escapeHtml(tt.lyDo))) {
    dong += `<br><i>${escapeHtml(tt.lyDo)}</i>`;
  }
  $('#capNhatTrangThai').innerHTML = dong;

  const td = $('#capNhatTienDo');
  td.hidden = tt.trangThai !== 'dang-tai';
  $('#capNhatThanh').style.width = (tt.tienDo || 0) + '%';

  $('#btnCapNhatCai').disabled = tt.trangThai !== 'da-tai';
  $('#btnCapNhatCai').textContent = tt.kieu === 'tu-dong' ? '⬆ Cài & mở lại'
    : (tt.kieu === 'mo-bo-cai' ? '⬆ Mở bộ cài' : '📂 Mở file vừa tải');
  $('#btnCapNhatKiem').disabled = ['dang-kiem', 'dang-tai'].includes(tt.trangThai);

  const gc = $('#capNhatGhiChuWrap');
  gc.hidden = !(coMoi && tt.ghiChu);
  $('#capNhatGhiChu').textContent = tt.ghiChu || '';

  if (tt.caiDat) {
    $('#capNhatTuKiem').checked = !!tt.caiDat.tuKiem;
    $('#capNhatTuTai').checked  = !!tt.caiDat.tuTai;
    $('#capNhatTuCai').checked  = !!tt.caiDat.tuCaiKhiThoat;
  }
}

window.flowApp.on('cap-nhat', (tt) => veCapNhat({ ...(app.capNhat || {}), ...tt }));

$('#btnCapNhatKiem').addEventListener('click', async () => veCapNhat(await window.flowApp.capNhat.kiemTra()));
$('#btnCapNhatTrang').addEventListener('click', () => window.flowApp.capNhat.moTrang());
$('#pillCapNhat').addEventListener('click', () => {
  showPane('run');
  const the = $('#theCapNhat');
  if (the) the.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

$('#btnCapNhatCai').addEventListener('click', async () => {
  let r = await window.flowApp.capNhat.caiDat(false);
  if (r && r.canXacNhan) {
    const dongY = await hoiCo({ title: 'Cài bản mới ngay?', desc: r.lyDo + ' Vẫn cài bây giờ?', okText: 'Cài ngay' });
    if (!dongY) return;
    r = await window.flowApp.capNhat.caiDat(true);
  }
  if (r && !r.ok && r.lyDo) $('#capNhatTrangThai').innerHTML = escapeHtml(r.lyDo);
});

for (const [id, khoa] of [['capNhatTuKiem', 'tuKiem'], ['capNhatTuTai', 'tuTai'], ['capNhatTuCai', 'tuCaiKhiThoat']]) {
  $('#' + id).addEventListener('change', async (e) => {
    const tt = await window.flowApp.capNhat.luuCaiDat({ [khoa]: e.target.checked });
    if (tt) veCapNhat(tt);
  });
}
