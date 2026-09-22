// ============================================================================
//  Flow Automation Studio — tiến trình chính
//  --------------------------------------------------------------------------
//  Thay vai trò của background.js (service worker MV3) trong bản tiện ích.
//  Khác biệt căn bản: tiến trình này SỐNG SUỐT PHIÊN CHẠY. Chrome giết service
//  worker khi rảnh — đó là lý do bản tiện ích phải cất mọi trạng thái vào
//  chrome.storage và vẫn thỉnh thoảng mất nhịp. Ở đây không có chuyện đó.
// ============================================================================

const { app, BrowserWindow, ipcMain, session, dialog, shell, Notification, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn, execFile } = require('child_process');

const { Store } = require('./src/main/store');
const { TabManager, FLOW_URL } = require('./src/main/tabs');
const { DownloadManager, SKIP } = require('./src/main/downloads');
const { pastePrompt, typeIntoFocused, ensureDebugger } = require('./src/main/paste');
const { buildJobs, splitJobs, buildStartMessage, planRun, planRunJobs, buildImageNames,
        buildI2vNames, invalidI2vNames, buildI2vPrompts,
        tenAnhTheoRename, caiDatChuoiVideo } = require('./src/main/jobs');
const anToan = require('./src/main/an-toan');
const modelKH = require('./src/main/model');
const { BoCapNhat, layRepo } = require('./src/main/cap-nhat');

const APP_VERSION = require('./package.json').version;

const { AccountManager } = require('./src/main/accounts');

let mainWindow = null;
let tabManager = null;
let downloadManager = null;
let accountManager = null;
let store = null;
let boCapNhat = null;

/** Các phiên đã gắn bộ theo dõi tải — gắn hai lần là mỗi file xử lý hai lượt. */
const daGanTai = new Set();

/**
 * Mốc thời gian được phép bấm "Tạo" tiếp, theo TỪNG TÀI KHOẢN Flow.
 *
 * Giãn nhịp là để một tài khoản không bị Flow chặn vì mấy tab cùng bấm một
 * lúc. Hai tài khoản khác nhau thì chẳng liên quan gì tới nhau, nên xếp hàng
 * chung sẽ làm chậm vô cớ.
 */
const nhipTao = new Map();

// ============================================================================
//  CHẾ ĐỘ AN TOÀN — tự nghỉ khi Flow bắt đầu coi mình là máy
//  --------------------------------------------------------------------------
//  Lý do và giới hạn của cách làm này viết trong src/main/an-toan.js. Ở đây
//  chỉ là phần nối dây: nghe bảng tiến độ, đếm lỗi, và khi đủ dấu hiệu thì
//  tạm dừng CẢ TÀI KHOẢN rồi hẹn giờ chạy lại.
//
//  Nghỉ theo TÀI KHOẢN chứ không theo tab: Google đếm theo tài khoản, nên để
//  một tab nghỉ mà hai tab kia vẫn gõ cửa thì coi như không nghỉ.
// ============================================================================

/** Cài đặt an toàn đang áp dụng (giao diện gửi lên mỗi lần bấm Chạy). */
let caiDatAnToan = anToan.chuanHoaCaiDat({});

/** accountId → sổ theo dõi (xem anToan.soMoi). */
const soAnToan = new Map();

/** accountId → đồng hồ hẹn chạy lại. */
const henChayLai = new Map();

function soAnToanCua(accountId) {
  const khoa = accountId || '(khong-ro)';
  if (!soAnToan.has(khoa)) soAnToan.set(khoa, anToan.soMoi());
  return soAnToan.get(khoa);
}

function tabCungTaiKhoan(accountId) {
  if (!tabManager) return [];
  return tabManager.tabs.filter((t) => (t.accountId || '(khong-ro)') === (accountId || '(khong-ro)'));
}

/**
 * Đếm prompt vừa hỏng, và nếu đủ dấu hiệu thì cho cả tài khoản nghỉ.
 * Gọi từ nhánh UPDATE_TABLE_DATA.
 */
async function theoDoiAnToan(tab, rows) {
  if (!tab || !caiDatAnToan.bat) return;

  const so = soAnToanCua(tab.accountId);
  if (!tab._daDemLoi) tab._daDemLoi = new Set();

  const moi = anToan.loiMoi(rows, tab._daDemLoi);
  if (moi.length) {
    const bayGio = Date.now();
    for (let i = 0; i < moi.length; i++) so.moc.push(bayGio);
    // Engine gắn cho mọi thẻ hỏng cùng một câu chung chung, nên chữ trong
    // trường `error` hiếm khi đủ để kết luận. Vẫn nghe, phòng khi Flow đổi.
    if (moi.some((m) => m.chacChan)) so.coCauChan = true;

    // Hỏi thẳng trang Flow: có đang hiện câu "hoạt động bất thường" không?
    // Chỉ hỏi khi ĐÃ có lỗi, để không quét DOM mỗi vài giây suốt buổi.
    if (!so.coCauChan) {
      const doc = await doCanhBaoTrenTrang(tab);
      if (doc && doc.co) {
        so.coCauChan = true;
        logToUi('error',
          `🚫 [${tab.id}] Flow đang báo: "${(doc.viDu || '').slice(0, 120)}"`);
      }
    }
  }

  const qd = anToan.canNghi(so, Date.now(), caiDatAnToan);
  if (qd.nghi) {
    // Đang chạy Lower Priority và có model dự phòng: tránh Lower Priority một
    // lúc và chạy tiếp bằng dự phòng, thay vì cho cả tài khoản nghỉ.
    if (await thuChuyenDuPhong(tab.accountId, qd)) return;
    await batDauNghi(tab.accountId, anToan.thoiGianNghi(so.soLanBiChan, caiDatAnToan), qd);
    return;
  }

  // Giải lao định kỳ — phòng bệnh, tính theo tổng prompt đã xong của tài khoản.
  const xong = tabCungTaiKhoan(tab.accountId)
    .reduce((t, x) => t + ((x.stats && x.stats.done) || 0), 0);
  const gl = anToan.canGiaiLao(so, xong, caiDatAnToan);
  if (gl.nghi) {
    so.mocGiaiLao = gl.daXong;
    await batDauNghi(tab.accountId, caiDatAnToan.giaiLaoPhut * 60000,
      { lyDo: gl.lyDo, giaiLao: true });
  }
}

/** Đọc trang Flow xem có câu cảnh báo không. Không bấm gì, chỉ đọc. */
async function doCanhBaoTrenTrang(tab) {
  if (!tab || !tab.ready || !tab.view || tab.view.webContents.isDestroyed()) return null;
  try {
    return await tab.view.webContents.executeJavaScript(
      'window.__flowDoCanhBao ? window.__flowDoCanhBao() : null', true);
  } catch (err) {
    return null;
  }
}

/** Tạm dừng mọi tab của một tài khoản, rồi hẹn giờ chạy lại. */
async function batDauNghi(accountId, ms, qd) {
  const so = soAnToanCua(accountId);
  if (so.dangNghi) return;

  const ds = tabCungTaiKhoan(accountId).filter((t) => t.busy);
  if (!ds.length) return;                 // không tab nào đang chạy thì nghỉ gì

  so.dangNghi = true;
  so.nghiDen  = Date.now() + ms;
  if (!qd.giaiLao) so.soLanBiChan += 1;

  const ten = ds[0].accountName || accountId || 'tài khoản';
  logToUi(qd.giaiLao ? 'info' : 'error',
    (qd.giaiLao ? '☕ ' : '🛑 ') +
    `[${ten}] ${qd.giaiLao ? 'Nghỉ giải lao' : 'TẠM DỪNG để hạ nhiệt'}: ${qd.lyDo}. ` +
    `Sẽ tự chạy lại sau ${anToan.doDai(ms)}.`);

  if (!qd.giaiLao && !qd.chacChan) {
    logToUi('warning',
      `   (Chưa đọc được đúng câu "hoạt động bất thường" trên trang — có thể ` +
      `chỉ là vài prompt bị chặn vì nội dung. Nghỉ cho chắc vẫn hơn cố chạy.)`);
  }

  for (const t of ds) {
    t.nghiAnToan = true;                  // chặn chuỗi ảnh→video nhầm nhịp
    try { await tabManager.dispatch(t.id, { action: 'PAUSE_AUTOMATION' }); } catch (_) {}
  }

  sendUi('stats', { ...tabStatsPayload() });

  const cu = hchen(accountId);
  if (cu) clearTimeout(cu);
  henChayLai.set(accountId, setTimeout(() => ketThucNghi(accountId), ms));
}

function hchen(accountId) {
  return henChayLai.get(accountId || '(khong-ro)');
}

/** Hết giờ nghỉ: xoá sổ lỗi cũ rồi cho chạy tiếp. */
async function ketThucNghi(accountId) {
  const so = soAnToanCua(accountId);
  henChayLai.delete(accountId || '(khong-ro)');
  if (!so.dangNghi) return;

  so.dangNghi = false;
  so.nghiDen  = 0;
  so.coCauChan = false;
  so.moc.length = 0;          // bắt đầu đếm lại từ đầu, không mang nợ cũ sang

  const ds = tabCungTaiKhoan(accountId).filter((t) => t.nghiAnToan);
  const ten = (ds[0] && ds[0].accountName) || accountId || 'tài khoản';
  logToUi('success', `▶ [${ten}] Hết giờ nghỉ — chạy tiếp.`);

  for (const t of ds) {
    t.nghiAnToan = false;
    try { await tabManager.dispatch(t.id, { action: 'RESUME_AUTOMATION' }); } catch (_) {}
  }
  sendUi('stats', { ...tabStatsPayload() });
}

/** Bỏ mọi lịch nghỉ của một tài khoản (người dùng bấm Dừng hẳn). */
function huyNghi(accountId) {
  const khoa = accountId || '(khong-ro)';
  const t = henChayLai.get(khoa);
  if (t) clearTimeout(t);
  henChayLai.delete(khoa);
  const so = soAnToan.get(khoa);
  if (so) { so.dangNghi = false; so.nghiDen = 0; }
  for (const tab of tabCungTaiKhoan(accountId)) tab.nghiAnToan = false;
}

// ============================================================================
//  MODEL VIDEO — chọn model, xen kẽ, và dự phòng khi Lower Priority bị chặn
//  --------------------------------------------------------------------------
//  Lý do và giới hạn viết ở src/main/model.js. Ở đây là phần nối dây:
//
//    • Trước mỗi prompt MỚI, engine hỏi xin "lượt bấm Tạo"
//      (ACQUIRE_CREATE_SLOT) và ĐỨNG CHỜ câu trả lời. Đó là khoảnh khắc duy
//      nhất engine không đụng vào giao diện — đổi model đúng lúc ấy thì không
//      giẫm chân nó. Engine chỉ hỏi khi giãn cách > 0, nên có kế hoạch model
//      thì ép giãn cách tối thiểu 1 giây.
//    • Prompt THỬ LẠI không đi qua lượt đó — nó dùng model đang chọn. Nên khi
//      chuyển dự phòng, đổi ngay model trên trang: lần thử lại chạy bằng dự
//      phòng, không gõ lại vào Lower Priority.
//    • Lower Priority bị chặn là chuyện của TÀI KHOẢN, như mọi thứ khác ở chế
//      độ an toàn.
// ============================================================================

/** accountId → { den: mốc hết tránh, soLan: đã bị chặn mấy lần } */
const lpChan = new Map();

function lpDangChan(accountId) {
  const x = lpChan.get(accountId || '(khong-ro)');
  return !!(x && x.den > Date.now());
}

const cho = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Chọn model trên trang Flow của một tab. Luôn đọc lại trên trang chứ không
 * tin bộ nhớ: người dùng có thể vừa tự bấm đổi.
 */
async function datModel(tab, ten, lyDo) {
  if (!tab || !tab.ready || !ten) return { ok: false, lyDo: 'Tab chưa sẵn sàng' };
  let r;
  try {
    r = await tab.view.webContents.executeJavaScript(
      `window.__flowSetModel ? window.__flowSetModel(${JSON.stringify(ten)}) : null`, true);
  } catch (err) {
    r = { ok: false, lyDo: err.message };
  }
  if (!r) r = { ok: false, lyDo: 'Trình chọn model chưa được tiêm vào tab' };
  if (r.ok) {
    tab.modelHienTai = r.model || ten;
    if (r.daDoi) {
      logToUi('info',
        `🎚 [${tab.id}] Model → ${tab.modelHienTai}` +
        (r.tinDung != null ? ` (${r.tinDung} credit mỗi lần tạo)` : '') +
        (lyDo ? ` · ${lyDo}` : ''), tab.id);
    }
  } else {
    tab.modelHienTai = null;
    logToUi('warning',
      `⚠️ [${tab.id}] Không đổi được model sang "${ten}": ${r.lyDo}. ` +
      `Tab chạy tiếp bằng model đang chọn trên trang.`, tab.id);
    if (r.chiTiet) logToUi('info', `   ↳ chẩn đoán: ${JSON.stringify(r.chiTiet)}`, tab.id);
  }
  return r;
}

/** Đọc model đang chọn. */
async function docModel(tab) {
  if (!tab || !tab.ready) return null;
  try {
    return await tab.view.webContents.executeJavaScript(
      'window.__flowGetModel ? window.__flowGetModel() : null', true);
  } catch (_) { return null; }
}

/**
 * Nhận kế hoạch model cho MỘT tab lúc giao việc. Trả về bộ cài đặt gửi cho
 * engine (có thể đã ép giãn cách tối thiểu 1 giây).
 */
async function chuanBiModel(tab, settings) {
  tab.keHoachModel = null;
  tab.demPromptMoi = 0;
  tab.modelHienTai = null;
  tab.loiModel = 0;
  if (!settings || settings.runMode !== 'video') return settings;

  const k = modelKH.chuanHoaKeHoach(settings.chonModel);
  if (!modelKH.coHieuLuc(k)) return settings;

  // Không đặt model chính thì "chính" là model đang chọn sẵn trên trang —
  // phải đọc ra, nếu không sau một prompt xen kẽ app không biết quay về đâu.
  if (!k.chinh) {
    const g = await docModel(tab);
    if (g && g.ok && g.model) {
      k.chinh = g.model;
      tab.modelHienTai = g.model;
    } else {
      logToUi('warning',
        `⚠️ [${tab.id}] Không đọc được model đang chọn trên Flow` +
        (g && g.lyDo ? ` (${g.lyDo})` : '') + ` — hãy điền ô "Model chính" cho chắc.`, tab.id);
    }
  }
  tab.keHoachModel = k;
  logToUi('info', `🎚 [${tab.id}] Model: ${modelKH.moTaKeHoach(k)}`, tab.id);
  if (lpDangChan(tab.accountId) && k.duPhong) {
    const x = lpChan.get(tab.accountId || '(khong-ro)');
    logToUi('info',
      `   ↳ Lower Priority của tài khoản này còn tránh thêm ${anToan.doDai(x.den - Date.now())} — ` +
      `prompt mới chạy bằng ${k.duPhong}.`, tab.id);
  }
  return { ...settings, multiTabStagger: Math.max(1, Number(settings.multiTabStagger) || 0) };
}

/**
 * Lower Priority vừa bị chặn: đổi các tab đang chạy nó của tài khoản này sang
 * dự phòng, thay vì cho cả tài khoản nghỉ.
 * @returns {boolean} true = đã xử lý xong, KHÔNG cần nghỉ nữa
 */
async function thuChuyenDuPhong(accountId, qd) {
  const khoa = accountId || '(khong-ro)';
  const ds = tabCungTaiKhoan(accountId).filter((t) =>
    t.busy && t.keHoachModel && modelKH.nenChuyenDuPhong(t.keHoachModel, t.modelHienTai));
  if (!ds.length) return false;

  const so = soAnToanCua(accountId);
  if (so.dangChuyenModel) return true;       // đang đổi dở, đừng đổi chồng
  so.dangChuyenModel = true;

  try {
    const cu = lpChan.get(khoa) || { soLan: 0 };
    const soLan = cu.soLan + 1;
    const ms = modelKH.thoiGianTranhLp(soLan, ds[0].keHoachModel.thuLaiPhut);
    lpChan.set(khoa, { den: Date.now() + ms, soLan });

    const ten = ds[0].accountName || accountId || 'tài khoản';
    const duPhong = ds[0].keHoachModel.duPhong;
    logToUi('error',
      `🚫 [${ten}] Lower Priority bị Flow chặn (${qd.lyDo}). Ngừng gửi Lower Priority ` +
      `${anToan.doDai(ms)}, chuyển sang ${duPhong} (tốn credit) và chạy tiếp.`);

    // Lỗi vừa rồi là của Lower Priority — không tính vào hạn mức của model mới.
    so.moc.length = 0;
    so.coCauChan = false;

    // Tạm dừng để đổi model mà không giẫm chân engine, rồi chạy lại.
    for (const t of ds) {
      t.nghiAnToan = true;                  // chặn chuỗi ảnh→video nhầm nhịp
      try { await tabManager.dispatch(t.id, { action: 'PAUSE_AUTOMATION' }); } catch (_) {}
    }
    sendUi('stats', { ...tabStatsPayload() });
    await cho(6000);                          // cho vòng lặp đang dở của engine dừng hẳn

    const hong = [];
    for (const t of ds) {
      let r = null;
      for (let lan = 1; lan <= 3 && !(r && r.ok); lan++) {
        r = await datModel(t, duPhong, 'Lower Priority bị chặn');
        if (!(r && r.ok)) await cho(4000);
      }
      if (!(r && r.ok)) hong.push(t);
    }

    if (hong.length) {
      logToUi('error',
        `❌ [${ten}] Không đổi được sang ${duPhong} — cho tài khoản nghỉ như chế độ an toàn.`);
      for (const t of ds) t.nghiAnToan = false;
      return false;                           // để batDauNghi lo tiếp
    }

    for (const t of ds) {
      // Người dùng bấm Tạm dừng / Dừng hẳn trong lúc đang đổi thì huyNghi()
      // đã hạ cờ này — KHÔNG được tự bật dậy một tab họ vừa cố ý dừng.
      if (!t.nghiAnToan) continue;
      t.nghiAnToan = false;
      try { await tabManager.dispatch(t.id, { action: 'RESUME_AUTOMATION' }); } catch (_) {}
    }
    logToUi('success', `▶ [${ten}] Chạy tiếp bằng ${duPhong}.`);
    sendUi('stats', { ...tabStatsPayload() });
    return true;
  } finally {
    so.dangChuyenModel = false;
  }
}

/**
 * Gắn bộ theo dõi tải cho phiên của MỘT tài khoản.
 *
 * Mỗi tài khoản là một session riêng, mà sự kiện 'will-download' gắn theo
 * session — nên phải gắn cho từng phiên, không phải một lần cho cả app.
 * Quên gắn thì tab của tài khoản đó tải file mà không ai đổi tên cho.
 */
function attachDownloadsFor(acc) {
  if (!acc || daGanTai.has(acc.partition)) return;
  const ses = session.fromPartition(acc.partition);
  downloadManager.attach(ses);
  daGanTai.add(acc.partition);
}

/**
 * Gom số liệu của MỌI tab để giao diện vẽ bảng tiến độ theo từng tab.
 *
 * Ngoài ba con số cũ (chạy / xong / lỗi) còn có hai thứ người dùng hỏi tới:
 *
 *   tienTrinh — phần trăm trung bình của những prompt ĐANG tạo. Engine gửi
 *               v.progress cho từng dòng; không gom lại thì thanh tiến độ chỉ
 *               nhảy theo số prompt xong, đứng im suốt 30-60 giây mỗi lần tạo
 *               và nhìn như treo.
 *
 *   taiVe     — đã tải được bao nhiêu media. Tạo xong KHÔNG có nghĩa là đã
 *               tải: đổi tên trên Flow, chờ máy chủ xuất file, rồi mới tải —
 *               cả chuỗi đó mất thêm vài chục giây, và đó mới là lúc file thật
 *               sự nằm trên đĩa.
 */
function tabStatsPayload() {
  const perTab = tabManager.tabs.map((t) => ({
    tabId: t.id,
    accountId: t.accountId,
    accountName: t.accountName,
    busy: !!t.busy,
    assigned: t.assigned || 0,
    phase: (t.chain && t.chain.phase) || null,
    // Đang nghỉ hạ nhiệt: giao diện cần biết để hiện "đang nghỉ · còn 8 phút"
    // thay vì "đã dừng" — hai cái nhìn giống nhau nhưng nghĩa khác hẳn.
    nghi: !!t.nghiAnToan,
    nghiConLai: t.nghiAnToan
      ? Math.max(0, (soAnToanCua(t.accountId).nghiDen || 0) - Date.now())
      : 0,
    ...(t.stats || { running: 0, done: 0, failed: 0 }),
    ...(t.tienDo || { tienTrinh: 0, daTai: 0, canTai: 0, loiTai: 0, dangTai: false })
  }));
  const tong = perTab.reduce((a, t) => ({
    running: a.running + t.running,
    done:    a.done + t.done,
    failed:  a.failed + t.failed,
    assigned: a.assigned + t.assigned,
    daTai:   a.daTai + (t.daTai || 0),
    canTai:  a.canTai + (t.canTai || 0)
  }), { running: 0, done: 0, failed: 0, assigned: 0, daTai: 0, canTai: 0 });
  return { perTab, tong };
}

/**
 * Rút phần tiến độ chi tiết ra từ bảng dữ liệu engine gửi lên.
 *
 * Engine đã gửi sẵn mọi thứ cần trong sendTableUpdate(): progress, downloaded,
 * downloadedCount, totalVideos, downloadError. Việc ở đây chỉ là gom lại —
 * không hỏi thêm engine câu nào, nên không tốn thêm nhịp nào.
 */
function rutTienDo(rows) {
  const ds = Array.isArray(rows) ? rows : [];
  const dangChay = ds.filter((r) => r.status === 'CREATING' || r.status === 'PASTING');

  // Trung bình phần trăm của những cái đang chạy. Không có cái nào đang chạy
  // thì để 0 — giao diện tự hiểu là đang chờ giữa hai lần tạo.
  const tienTrinh = dangChay.length
    ? Math.round(dangChay.reduce((a, r) => a + (r.progress || 0), 0) / dangChay.length)
    : 0;

  return {
    tienTrinh,
    daTai:  ds.filter((r) => r.downloaded).length,
    canTai: ds.filter((r) => r.status === 'COMPLETED').length,
    loiTai: ds.filter((r) => r.downloadError).length,
    dangTai: ds.some((r) => r.status === 'COMPLETED' && !r.downloaded && !r.downloadError)
  };
}

// ============================================================================
//  CHUỖI ẢNH → VIDEO TỰ ĐỘNG
//  --------------------------------------------------------------------------
//  Cách làm thủ công tốn một nhịp chờ người: tạo xong cả mẻ ảnh, người dùng
//  phải ngồi canh, rồi mới tự tay sinh danh sách prompt video và bấm chạy lại.
//  Với 400 ảnh thì nhịp chờ đó là vô nghĩa.
//
//  Ở đây mỗi TAB mang theo một "chuỗi việc" riêng:
//      tab.chain = { phase: 'image', imageNames: [...], videoSettings: {...} }
//  Khi engine của chính tab đó báo AUTOMATION_STOPPED (mẻ ảnh xong), app tự:
//     1. dựng danh sách prompt video "<câu lệnh> @<mã ảnh>"
//     2. đổi sang chế độ video + bật Character Sync
//     3. giao lại đúng TAB ĐÓ chạy tiếp
//
//  Vì trạng thái nằm trên từng tab nên nhiều tab và nhiều tài khoản chạy chuỗi
//  của riêng mình cùng lúc, không ai đụng ai.
// ============================================================================

/**
 * Đảm bảo tab đang ở đúng chế độ Image/Video trước khi giao việc.
 *
 * Người dùng vốn phải tự tay bấm đổi sang Video trước mỗi mẻ video — nhất là
 * khi nối tiếp từ mẻ ảnh trên CÙNG một tab. switchToVideoMode() của engine
 * không với tới được vì cặp nút Image/Video nay nằm trong bảng thả xuống, nên
 * ta có trình đổi riêng (src/inject/flow-mode.js).
 */
async function datCheDo(tab, mode, imLang = false) {
  if (!tab || !tab.ready) return { ok: false, lyDo: 'Tab chưa sẵn sàng' };
  try {
    const r = await tab.view.webContents.executeJavaScript(
      `window.__flowSetMode && window.__flowSetMode(${JSON.stringify(mode)})`, true);
    if (!r) return { ok: false, lyDo: 'Trình đổi chế độ chưa được tiêm' };
    if (r.ok && r.daDoi) logToUi('success', `🎛 [${tab.id}] Đã tự đổi Flow sang chế độ ${mode}`);
    else if (!r.ok && !imLang) {
      logToUi('warning',
        `⚠️ [${tab.id}] Không tự đổi được sang chế độ ${mode}: ${r.lyDo}. Hãy đổi tay trên trang Flow.`);
      // Chụp lại những gì trình đổi nhìn thấy. Không có mẩu này thì mỗi lần
      // Google đổi giao diện lại phải xin người dùng ảnh chụp màn hình mới
      // đoán được — đã mất một vòng như vậy ở bản 2.3.0.
      if (r.chiTiet) logToUi('info', `   ↳ chẩn đoán: ${JSON.stringify(r.chiTiet)}`);
    }
    return r;
  } catch (err) {
    return { ok: false, lyDo: err.message };
  }
}

/**
 * Đổi chế độ, KIÊN TRÌ chờ.
 *
 * Dùng cho chuỗi ảnh→video: đây là lúc người dùng đi vắng (cả tính năng sinh
 * ra để khỏi ngồi canh), nên thất bại là mất trắng cả mẻ. Thử lại nhiều lần
 * cách nhau mươi giây: nếu Google chỉ chậm dựng bảng thì lần sau sẽ được, còn
 * nếu người dùng tình cờ ngồi cạnh và tự bấm đổi thì lần dò kế tiếp đọc ra
 * ngay "đã ở chế độ video" và chuỗi chạy tiếp như thường.
 */
async function datCheDoKienTri(tab, mode, soLan = 5, cachNhau = 12000) {
  for (let lan = 1; lan <= soLan; lan++) {
    const r = await datCheDo(tab, mode, lan < soLan);
    if (r && r.ok) return r;
    if (lan < soLan) {
      logToUi('warning',
        `⏳ [${tab.id}] Chưa đổi được sang chế độ ${mode} (lần ${lan}/${soLan}) — ` +
        `thử lại sau ${Math.round(cachNhau / 1000)} giây. ` +
        `Bạn có thể tự bấm đổi trên trang Flow, app sẽ nhận ra và chạy tiếp.`);
      await new Promise((r2) => setTimeout(r2, cachNhau));
      if (!tab.ready) return { ok: false, lyDo: 'Tab đã đóng' };
    }
  }
  return { ok: false, lyDo: `Đã thử ${soLan} lần, Flow vẫn không sang chế độ ${mode}` };
}

async function chayTiepChuoi(tab) {
  const chain = tab.chain;
  if (!chain || chain.phase !== 'image') return;
  if (tab.busy) return;                       // engine chưa dừng hẳn, để nhịp sau
  if (tab.nghiAnToan) return;                 // đang nghỉ hạ nhiệt, chưa xong mẻ ảnh

  tab.chain = null;                           // chỉ nối MỘT lần, tránh lặp vô tận

  const names = chain.imageNames || [];
  if (!names.length) {
    logToUi('warning', `⚠️ [${tab.id}] Chuỗi ảnh→video: không có mã ảnh nào để nối tiếp`);
    return;
  }

  const thatBai = (tab.stats && tab.stats.failed) || 0;
  if (thatBai && chain.skipIfFailed) {
    logToUi('warning',
      `⚠️ [${tab.id}] Mẻ ảnh có ${thatBai} lỗi — DỪNG chuỗi ảnh→video để bạn xem lại. ` +
      `Tắt "chỉ nối khi mẻ ảnh sạch lỗi" nếu muốn chạy tiếp bất chấp.`);
    return;
  }

  const prompts = buildI2vPrompts(names, chain.videoPrompt, chain.perImagePrompts);
  const { settings, daTat } = caiDatChuoiVideo(chain.videoSettings);

  logToUi('success',
    `🔗 [${tab.id}] Mẻ ảnh xong — tự nối sang video cho ${prompts.length} ảnh ` +
    `(${names[0]} → ${names[names.length - 1]})`);
  // Nói thẳng cái gì bị tắt. Im lặng sửa cài đặt của người dùng là kiểu tử tế
  // sai chỗ: lần sau họ lại bật lên và lại không hiểu vì sao.
  for (const t of daTat) {
    logToUi('warning', `⚠️ [${tab.id}] Mẻ video nối tiếp TỰ TẮT: ${t}`);
  }

  tab.assigned = prompts.length;
  tab.stats = { running: 0, done: 0, failed: 0 };
  tab.tienDo = null;
  tab.chain = { phase: 'video' };
  sendUi('stats', { tabId: tab.id, ...tabStatsPayload() });

  // Đổi giao diện Flow sang Video TRƯỚC khi giao việc — nếu không, engine dán
  // prompt video vào lúc Flow vẫn đang ở chế độ Image và sinh ra ảnh.
  //
  // KHÔNG giao việc khi chưa đổi được: engine có chốt chặn riêng, gặp sai chế
  // độ là nó dừng ngay giữa chừng ("Bot tự động dừng: Sai chế độ giao diện").
  // Giao vào lúc đó chỉ đổi một thất bại im lặng lấy một thất bại ồn ào, mà
  // mẻ ảnh vẫn nằm đó chưa được nối.
  const doi = await datCheDoKienTri(tab, 'video');
  if (!doi.ok) {
    tab.chain = null;
    tab.assigned = 0;
    sendUi('stats', { tabId: tab.id, ...tabStatsPayload() });
    logToUi('error',
      `❌ [${tab.id}] Dừng chuỗi ảnh→video: ${doi.lyDo}. ` +
      `Ảnh đã tạo xong vẫn còn nguyên trong kho Flow — bạn đổi tay sang chế độ ` +
      `Video rồi bấm Bắt đầu với danh sách câu lệnh video là chạy tiếp được.`);
    return;
  }

  const jobs = prompts.map((text, i) => ({ index: i + 1, text }));
  const caiDatTab = await chuanBiModel(tab, settings);
  await tabManager.dispatch(tab.id, buildStartMessage(prompts, jobs, caiDatTab));
}

// ── Ghi log: vừa đẩy lên giao diện, vừa ghi ra file để còn gửi đi khi gặp lỗi ──
let logStream = null;

function logToUi(level, message, tabId) {
  const stamp = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  const line = tabId ? `[${stamp}] [${tabId}] ${message}` : `[${stamp}] ${message}`;

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ui:log', { level, message, tabId, time: stamp });
  }
  try { logStream && logStream.write(line + '\n'); } catch (_) {}
  console.log(line);
}

function sendUi(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ui:' + channel, payload);
  }
}

// ============================================================================
//  BỘ ĐỊNH TUYẾN MESSAGE TỪ ENGINE
//  Thay cho chrome.runtime.onMessage.addListener trong background.js.
//  Tên các action giữ nguyên để engine không phải sửa một dòng nào.
// ============================================================================

async function handleEngineMessage(message, senderWc) {
  const action = message && message.action;
  const tab = tabManager.findByWcId(senderWc.id);
  const tabId = tab ? tab.id : null;

  switch (action) {
    // ── Ghi log và số liệu lên giao diện ────────────────────────────────
    case 'LOG':
      logToUi(message.type || 'info', message.message, tabId);
      return { success: true };

    // ── Số liệu tiến độ ────────────────────────────────────────────────
    // Engine gửi { creating, completed, error } — KHÔNG phải { done, failed }.
    // Bản trước đọc sai tên trường nên bảng tiến độ đứng yên ở 0 dù engine
    // vẫn đang chạy ngon. Đổi tên ngay tại đây, một chỗ duy nhất.
    case 'UPDATE_STATS': {
      const d = message.data || {};
      if (tab) {
        tab.stats = {
          running:   d.creating  || 0,
          done:      d.completed || 0,
          failed:    d.error     || 0
        };
      }
      sendUi('stats', { tabId, ...tabStatsPayload() });
      return { success: true };
    }

    // ── Bảng tiến độ ───────────────────────────────────────────────────
    // Engine gửi data = { rows, autoDownload, autoRename, isRunning, ... }.
    // Bản trước truyền CẢ OBJECT vào chỗ rows, nên giao diện nhận một object
    // chứ không phải mảng và bảng Tổng quan không vẽ được dòng nào — đúng
    // triệu chứng "trang tổng quan không hoạt động".
    case 'UPDATE_TABLE_DATA': {
      const d = message.data || {};
      const hangs = Array.isArray(d.rows) ? d.rows : [];
      if (tab) tab.tienDo = rutTienDo(hangs);
      // isRunning ở đây là nguồn tin CẬY NHẤT về việc tab có đang chạy không:
      // startAutomation() KHÔNG gửi AUTOMATION_RESUMED (chỉ handleResume mới
      // gửi), nên nếu chỉ nghe sự kiện đó thì mẻ chạy mới không bao giờ được
      // đánh dấu là bận — và nút Tạm dừng/Dừng hẳn nằm im không bấm được.
      if (tab && typeof d.isRunning === 'boolean' && tab.busy !== d.isRunning) {
        tab.busy = d.isRunning;
        sendUi('tabs', tabManager.list());
        sendUi('stats', { tabId, ...tabStatsPayload() });
        // Đang nghỉ hạ nhiệt thì isRunning cũng là false — nhưng mẻ CHƯA xong.
        // Không chặn ở đây thì chuỗi ảnh→video nổ ngay giữa giờ nghỉ, và mẻ
        // video chạy vào đúng lúc Google đang khó chịu nhất.
        if (!d.isRunning && !tab.nghiAnToan) setTimeout(() => chayTiepChuoi(tab), 1500);
      }
      // Canh chừng dấu hiệu bị chặn. Không await: bảng tiến độ phải trả lời
      // engine ngay, còn việc đếm lỗi chậm vài trăm mili-giây không sao.
      if (tab) theoDoiAnToan(tab, hangs).catch(() => {});
      sendUi('table', { tabId, rows: hangs });
      // Bảng tiến độ đọc từ payload stats, nên phải đẩy lại mỗi lần bảng đổi —
      // nếu không thì phần trăm và số đã tải chỉ nhúc nhích khi có prompt xong.
      sendUi('stats', { tabId, ...tabStatsPayload() });
      return { success: true };
    }

    case 'UPDATE_PROGRESS':
      sendUi('progress', { tabId, ...message.data });
      return { success: true };

    // ── DÁN PROMPT — đường đã sửa, không còn bị cắt ─────────────────────
    case 'INJECT_PASTE': {
      if (!tab) return { ok: false, error: 'Không xác định được tab gửi yêu cầu' };
      const text = (message.data && message.data.text) || '';
      const result = await pastePrompt(
        tab.view.webContents,
        text,
        (lvl, msg) => logToUi(lvl, msg, tabId)
      );
      // Engine đọc trường hasZeroWidth để biết Slate đã nhận chưa.
      return { ok: result.ok, hasZeroWidth: !result.ok, error: result.error, ...result };
    }

    case 'INJECT_CLICK_CREATE': {
      if (!tab) return { ok: false, error: 'Không xác định được tab' };
      try {
        const r = await tab.view.webContents.executeJavaScript('window.__flowClickCreate()', true);
        return r;
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    case 'INJECT_RENAME_INPUT': {
      if (!tab) return { ok: false, error: 'Không xác định được tab' };
      const newName = (message.data && message.data.newName) || '';
      try {
        // Dùng lại hàm dò ô nhập nguyên văn của tiện ích, nhưng bơm chữ bằng
        // đường CDP để tên dài cũng vào đủ.
        const found = await tab.view.webContents.executeJavaScript(
          `window.__flowRenameInput(${JSON.stringify(newName)})`, true
        );
        return found;
      } catch (err) {
        return { ok: false, error: err.message };
      }
    }

    // ── Hàng đợi tên file — theo TỪNG TAB, không còn đổi chéo ───────────
    case 'SET_NEXT_FILENAME': {
      if (!tabId) return { success: false, error: 'Không rõ tab' };
      const size = downloadManager.pushName(tabId, message.filename);
      return { success: true, queueSize: size };
    }

    case 'UNSET_NEXT_FILENAME': {
      if (!tabId) return { success: false };
      downloadManager.popName(tabId, message.filename);
      return { success: true };
    }

    case 'CLEAR_FILENAME_QUEUE':
      downloadManager.clear(message.all ? null : tabId);
      return { success: true };

    // ── Trạng thái chạy ────────────────────────────────────────────────
    case 'AUTOMATION_RESUMED':
      if (tab) tab.busy = true;
      sendUi('tabs', tabManager.list());
      sendUi('run-state', { tabId, running: true });
      return { success: true };

    case 'AUTOMATION_STOPPED': {
      if (tab) tab.busy = false;
      sendUi('tabs', tabManager.list());
      sendUi('run-state', { tabId, running: false });
      // Mẻ ảnh vừa xong mà tab này có đặt chuỗi ảnh→video thì nối tiếp ngay.
      if (tab) setTimeout(() => chayTiepChuoi(tab), 1500);
      return { success: true };
    }

    // ── KHOÁ TẢI XUỐNG — luôn cấp ngay ────────────────────────────────
    // Engine mang theo cơ chế khoá từ bản tiện ích: Chrome đưa DownloadItem
    // KHÔNG có tabId, nên hai tab tải cùng lúc là tên file đổi chéo. Cách chữa
    // duy nhất bên đó là ép các tab tải LẦN LƯỢT bằng một khoá chung.
    //
    // Bản desktop không cần khoá: Electron đưa thẳng webContents vào sự kiện
    // 'will-download' nên mỗi tab có hàng đợi tên riêng (xem downloads.js).
    //
    // Nhưng KHÔNG trả lời cũng không được. acquireDownloadLock() đọc `res.ok`;
    // trả về {success:false} như trước là engine hiểu "tab khác đang giữ khoá"
    // rồi chờ ĐÚNG 420 giây mới tự giành. Đó chính là khoảng trống 7 phút
    // 04:14 → 04:21 trong nhật ký người dùng, và là lý do các lượt tải kế tiếp
    // dồn ứ. Cấp ngay là hết, đồng thời các tab tải song song thật.
    case 'ACQUIRE_DOWNLOAD_LOCK':
      return { ok: true };

    case 'RENEW_DOWNLOAD_LOCK':
    case 'RELEASE_DOWNLOAD_LOCK':
      return { ok: true };

    // ── Đăng ký tab ────────────────────────────────────────────────────
    //
    //  ĐÂY LÀ CHỖ ĐÃ LÀM BA TAB ĐÈ DỰ ÁN CỦA NHAU.
    //
    //  Engine gọi REGISTER_TAB ngay lúc khởi động để xin tabId và số thứ tự.
    //  Action này TRƯỚC ĐÂY không được xử lý, nên nó rơi vào nhánh mặc định,
    //  engine thử lại 5 lần rồi bỏ cuộc với veoTabId = null. Hậu quả dây
    //  chuyền, đọc thẳng từ flow-engine.js:
    //
    //    setRunState() / getRunState() dùng khoá String(veoTabId || 'single')
    //    -> cả ba tab ghi chung MỘT khoá 'single'.
    //
    //  Nên khi tab1 tự F5 sau bước đổi tên, nó đọc trạng thái chạy mà tab2 và
    //  tab3 vừa ghi đè, rồi khôi phục NHẦM dự án của tab khác. Nhật ký thật:
    //  cả ba tab cùng nạp "Project_2026-09-19_1789834930959", và tab1 chạy
    //  tiếp mẻ video của tab2 dù chuỗi của chính nó chưa hề bắt đầu.
    //
    //  Lưu ý: engine chỉ gắn hậu tố _T<slot> vào tên dự án khi settings.multiTab
    //  bật (isMultiTab()). Ghi chú cũ trong README bảo engine "không đọc" khoá
    //  multiTab là SAI — nó đọc ở 7 chỗ. Xem collectSettings() trong app.js.
    case 'REGISTER_TAB':
      if (!tab) return { ok: false, error: 'Không nhận ra tab gửi lệnh' };
      return { ok: true, tabId: tab.id, slot: tab.slot || 1 };

    // Engine báo tiến độ để Side Panel của tiện ích vẽ danh sách đa tab. Ở bản
    // desktop, số liệu đã về qua UPDATE_STATS / UPDATE_TABLE_DATA rồi, nên chỉ
    // cần nhận cho có lệ — trả success để engine đừng coi là lỗi kết nối.
    case 'TAB_STATUS':
      return { success: true };

    // Giãn nhịp bấm "Tạo" giữa các tab dùng chung một tài khoản Flow.
    // Engine đọc res.waitMs; trả 0 nghĩa là "bấm luôn".
    case 'ACQUIRE_CREATE_SLOT': {
      // Engine đang ĐỨNG CHỜ câu trả lời trước khi dán prompt mới — lúc duy
      // nhất đổi model mà không giẫm chân nó (xem khối MODEL VIDEO ở đầu file).
      if (tab && tab.keHoachModel) {
        tab.demPromptMoi = (tab.demPromptMoi || 0) + 1;
        const { model, lyDo } = modelKH.modelChoPrompt(
          tab.keHoachModel, tab.demPromptMoi, lpDangChan(tab.accountId));
        // Đổi khi khác model hiện tại hoặc chưa rõ đang ở model nào. Cùng
        // model thì vẫn đọc lại trên trang mỗi 10 prompt, phòng người dùng tự
        // bấm đổi giữa chừng — đọc lại là mở/đóng bảng cài đặt, không rẻ.
        const canDoi = model && (!tab.modelHienTai ||
          !modelKH.cungModel(tab.modelHienTai, model) || tab.demPromptMoi % 10 === 0);
        if (canDoi) {
          const r = await datModel(tab, model, lyDo);
          tab.loiModel = r && r.ok ? 0 : (tab.loiModel || 0) + 1;
          // Hỏng 3 lần liền là giao diện Flow đã khác thứ app biết — thôi
          // bấm, để khỏi mở/đóng bảng vô ích trước mọi prompt còn lại.
          if (tab.loiModel >= 3) {
            logToUi('error',
              `❌ [${tab.id}] 3 lần liền không đổi được model — tắt kế hoạch model cho mẻ này, ` +
              `chạy tiếp bằng model đang chọn. Gửi dòng "chẩn đoán" ở trên để sửa.`, tab.id);
            tab.keHoachModel = null;
          }
        }
      }
      const gap = Math.max(0, Number(message.gapMs) || 0);
      if (!gap) return { waitMs: 0 };
      const acc = tab && tab.accountId ? tab.accountId : 'chung';
      const truoc = nhipTao.get(acc) || 0;
      const moc = Math.max(Date.now(), truoc + gap);
      nhipTao.set(acc, moc);
      return { waitMs: Math.max(0, moc - Date.now()) };
    }

    // Tab nào xong trước cũng KHÔNG được tắt máy khi tab khác còn chạy.
    case 'CAN_SHUTDOWN': {
      const conChay = tabManager.tabs.filter((t) => t.busy && t.id !== tabId);
      if (!conChay.length) return { ok: true };
      return {
        ok: false,
        waiting: conChay.map((t) => ({
          slot: t.slot, tabId: t.id,
          done: (t.stats && t.stats.done) || 0,
          total: t.assigned || 0
        }))
      };
    }

    case 'CHECK_TAB_ACTIVE':
      return { active: tabId === tabManager.activeId, tabId };

    case 'CLOSE_CURRENT_TAB':
      if (tabId) setTimeout(() => tabManager.close(tabId), 100);
      return { success: true };

    case 'SET_TAB_ZOOM':
      if (tab) {
        const z = parseFloat(message.zoom) || 0.8;
        tab.view.webContents.setZoomFactor(z);
      }
      return { success: true };

    // ── Dự án ──────────────────────────────────────────────────────────
    case 'SAVE_PROJECT':
    case 'PROJECT_LOADED':
    case 'PROJECT_DELETED':
      sendUi('run-state', { tabId, project: message.data || null, action });
      return { success: true };

    // Người dùng vừa bấm vào một phần tử trên trang Flow (hoặc bấm Esc).
    // Trước đây hai action này bị đẩy chung vào 'run-state' rồi giao diện bỏ
    // qua — selector người dùng vừa chỉ bị NÉM ĐI. Nay có kênh riêng để giao
    // diện lưu lại vào settings.selectors. Xem README mục 0a.
    case 'PICK_RESULT':
      logToUi('success',
        `🎯 Đã chỉ lại "${(message.data && message.data.targetType) || '?'}": ` +
        `${(message.data && message.data.selector) || ''} ` +
        `(khớp ${(message.data && message.data.matches) || 0} phần tử)`, tabId);
      sendUi('ui-pick', { tabId, action, data: message.data || null });
      return { success: true };

    case 'PICK_CANCELLED':
      sendUi('ui-pick', { tabId, action, data: null });
      return { success: true };

    // Engine vừa kết luận một phần tử đã vỡ. Trước đây action này rơi vào
    // nhánh default ("Action chưa hỗ trợ") nên app không biết gì — người dùng
    // chỉ thấy một dòng log đỏ trôi qua giữa hàng trăm dòng khác. Nay đẩy
    // thẳng lên mục Chẩn đoán để nó tự sáng đèn.
    case 'UI_BREAK':
      sendUi('ui-break', { tabId, data: message.data || null });
      return { success: true };

    // ── Tắt máy khi xong ───────────────────────────────────────────────
    case 'TRIGGER_SHUTDOWN': {
      const delay = parseInt(message.delay, 10) || 60;
      if (process.platform === 'win32') {
        logToUi('warning', `⚠️ Sẽ tắt máy sau ${delay} giây. Huỷ bằng lệnh: shutdown /a`, tabId);
        exec(`shutdown /s /t ${delay}`, (err) => {
          if (err) logToUi('error', `❌ Không gọi được lệnh tắt máy: ${err.message}`, tabId);
        });
      } else if (process.platform === 'darwin') {
        // macOS không có "shutdown sau N giây" cho tài khoản thường (lệnh
        // shutdown đòi sudo). Nhờ System Events tắt máy — đường này đi qua hộp
        // thoại tắt máy bình thường của macOS, nên app nào chưa lưu sẽ hỏi lại.
        // Lần đầu macOS hỏi quyền "điều khiển System Events": bấm Cho phép.
        logToUi('warning', `⚠️ Sẽ tắt máy sau ${delay} giây. Muốn huỷ: thoát app trước lúc đó.`, tabId);
        setTimeout(() => {
          exec(`osascript -e 'tell application "System Events" to shut down'`, (err) => {
            if (err) logToUi('error', `❌ macOS không cho tắt máy: ${err.message}. Vào Cài đặt hệ thống → Quyền riêng tư & Bảo mật → Tự động hoá, bật System Events cho Flow Automation Studio.`, tabId);
          });
        }, delay * 1000);
      } else {
        logToUi('warning', 'Tắt máy tự động chỉ hỗ trợ Windows và macOS.', tabId);
      }
      return { success: true };
    }

    case 'SHUTDOWN_TRIGGERED':
      return { success: true };

    case 'NOTIFY':
      try {
        new Notification({
          title: message.title || 'Flow Automation Studio',
          body: message.message || ''
        }).show();
      } catch (_) {}
      return { success: true };

    default:
      return { success: false, error: `Action chưa hỗ trợ: ${action}` };
  }
}

// ============================================================================
//  IPC
// ============================================================================

function registerIpc() {
  // ── Từ engine trong trang Flow ─────────────────────────────────────────
  ipcMain.handle('flow:message', async (event, message) => {
    try {
      return await handleEngineMessage(message, event.sender);
    } catch (err) {
      logToUi('error', `❌ Lỗi xử lý ${message && message.action}: ${err.message}`);
      return { success: false, ok: false, error: err.message };
    }
  });

  ipcMain.handle('flow:storage', async (_event, { op, arg }) => {
    switch (op) {
      case 'get':    return store.get(arg);
      case 'set':    return store.set(arg) && undefined;
      case 'remove': return store.remove(arg) && undefined;
      case 'clear':  return store.clear() && undefined;
      case 'bytes':  return Buffer.byteLength(JSON.stringify(store.get(arg) || {}), 'utf8');
      default:       return undefined;
    }
  });

  // ── Từ giao diện app ───────────────────────────────────────────────────
  ipcMain.handle('app:tabs:list',     ()          => tabManager.list());
  ipcMain.handle('app:tabs:create', async (_e, accountId) => {
    await tabManager.create(accountId || null);
    return tabManager.list();
  });

  // ── Tài khoản ──────────────────────────────────────────────────────────
  const guiDsTaiKhoan = async () => {
    const ds = accountManager.list();
    for (const a of ds) a.loggedIn = await accountManager.isLoggedIn(a.id);
    sendUi('accounts', ds);
    return ds;
  };

  ipcMain.handle('app:acc:list', guiDsTaiKhoan);

  ipcMain.handle('app:acc:create', async (_e, name) => {
    const acc = accountManager.create(name);
    // Phiên mới cần gắn bộ theo dõi tải NGAY, nếu không tab đầu tiên của tài
    // khoản này tải file mà không ai đổi tên cho.
    attachDownloadsFor(acc);
    await guiDsTaiKhoan();
    return acc;
  });

  ipcMain.handle('app:acc:rename', async (_e, { id, name }) => {
    accountManager.rename(id, name);
    for (const t of tabManager.tabs) {
      if (t.accountId === id) t.accountName = name;
    }
    sendUi('tabs', tabManager.list());
    return guiDsTaiKhoan();
  });

  ipcMain.handle('app:acc:remove', async (_e, id) => {
    // Đóng hết tab của tài khoản trước, nếu không chúng thành tab mồ côi trỏ
    // vào một phiên không còn ai quản.
    for (const t of tabManager.ofAccount(id)) tabManager.close(t.id);
    const r = accountManager.remove(id);
    await guiDsTaiKhoan();
    return r;
  });

  ipcMain.handle('app:acc:logout', async (_e, id) => {
    for (const t of tabManager.ofAccount(id)) tabManager.close(t.id);
    const r = await accountManager.logout(id);
    await guiDsTaiKhoan();
    return r;
  });

  ipcMain.handle('app:acc:dir', async (_e, { id, dir }) => {
    accountManager.setDownloadDir(id, dir);
    return guiDsTaiKhoan();
  });

  // ── Dự án ──────────────────────────────────────────────────────────────
  ipcMain.handle('app:proj:list', () => {
    const { veoProjects } = store.get('veoProjects');
    return Object.values(veoProjects || {});
  });

  ipcMain.handle('app:proj:load', async (_e, name) => {
    const tab = tabManager.find(tabManager.activeId);
    if (!tab) return { ok: false, error: 'Chưa mở tab Flow nào để nạp dự án vào' };
    return tabManager.dispatch(tab.id, { action: 'LOAD_PROJECT', data: { projectName: name } });
  });

  ipcMain.handle('app:proj:remove', async (_e, name) => {
    const tab = tabManager.find(tabManager.activeId);
    if (tab) await tabManager.dispatch(tab.id, { action: 'DELETE_PROJECT', data: { projectName: name } });
    // Xoá luôn ở kho, để không cần tab vẫn dọn được.
    const { veoProjects } = store.get('veoProjects');
    if (veoProjects && veoProjects[name]) {
      delete veoProjects[name];
      store.set({ veoProjects });
    }
    return { ok: true };
  });

  // ── Lệnh gửi thẳng cho engine ──────────────────────────────────────────
  const guiChoTabDangMo = async (message) => {
    const tab = tabManager.find(tabManager.activeId) ||
                tabManager.tabs.find((t) => t.ready);
    if (!tab) return { ok: false, error: 'Chưa mở tab Flow nào' };
    if (!tab.ready) return { ok: false, error: 'Tab chưa sẵn sàng — bấm "Gắn lại engine"' };
    return tabManager.dispatch(tab.id, message);
  };

  ipcMain.handle('app:eng:ui-selftest', () => guiChoTabDangMo({ action: 'RUN_UI_SELFTEST' }));
  ipcMain.handle('app:eng:ui-health',   () => guiChoTabDangMo({ action: 'GET_UI_HEALTH' }));
  ipcMain.handle('app:eng:ui-clear',    () => guiChoTabDangMo({ action: 'CLEAR_UI_HEALTH' }));

  // ══════════════════════════════════════════════════════════════════════
  //  CHỈ LẠI PHẦN TỬ FLOW BẰNG TAY — ba lệnh dưới đây là phần BỊ BỎ SÓT
  //  khi chuyển từ tiện ích Chrome sang desktop. Xem README mục 0a.
  //  --------------------------------------------------------------------
  //  Engine đã mang sẵn cả cơ chế: nhận START_PICKING để bật chế độ "bấm
  //  vào phần tử", gửi PICK_RESULT kèm selector sinh ra, và ưu tiên
  //  settings.selectors[key] TRƯỚC selector mặc định (resolveSelector).
  //
  //  Nhưng bản desktop chưa bao giờ nối vào: không ai gửi START_PICKING,
  //  PICK_RESULT về tới thì bị bỏ đi, và settings.selectors không hề được
  //  gom vào bộ cài đặt. Nên câu báo lỗi của engine — "bấm Chọn trên trang
  //  hoặc Tải báo cáo .txt" — chỉ tới hai cái nút KHÔNG TỒN TẠI, và người
  //  dùng không có cách nào tự vá khi Google đổi giao diện (22/09/2026).
  // ══════════════════════════════════════════════════════════════════════

  ipcMain.handle('app:eng:ui-pick', (_e, targetType) =>
    guiChoTabDangMo({ action: 'START_PICKING', data: { targetType } }));

  // Đẩy selector người dùng vừa chỉ xuống MỌI tab đang sẵn sàng, để có tác
  // dụng ngay trong mẻ đang chạy chứ không phải chờ lần Bắt đầu sau.
  // Engine đọc UPDATE_SETTINGS bằng { ...state.settings, ...message.data }.
  ipcMain.handle('app:eng:selectors-push', async (_e, selectors) => {
    const ds = tabManager.tabs.filter((t) => t.ready);
    if (!ds.length) return { ok: false, error: 'Chưa có tab Flow nào sẵn sàng' };
    for (const t of ds) {
      try {
        await tabManager.dispatch(t.id, {
          action: 'UPDATE_SETTINGS',
          data: { selectors: selectors || {} }
        });
      } catch (_) { /* tab đang đóng thì bỏ qua, không làm vỡ cả vòng */ }
    }
    return { ok: true, soTab: ds.length };
  });

  // Xuất báo cáo chẩn đoán ra .txt để gửi đi vá. Gộp HAI nguồn:
  //   • bản tự kiểm ngay lúc này (RUN_UI_SELFTEST) — có danh sách ứng viên
  //     kèm outerHTML, đủ để viết lại selector mới;
  //   • bản engine TỰ CHỤP đúng lúc nó trượt (veoUiDiagnostics trong kho dữ
  //     liệu) — quý hơn, vì nó chụp trang ở đúng thời điểm hỏng.
  ipcMain.handle('app:eng:ui-report', async () => {
    const tuKiem = await guiChoTabDangMo({ action: 'RUN_UI_SELFTEST' });
    const { veoUiDiagnostics } = store.get('veoUiDiagnostics');

    const chu = [
      '════════ BÁO CÁO CHẨN ĐOÁN GIAO DIỆN FLOW ════════',
      `Thời điểm xuất : ${new Date().toLocaleString('vi-VN')}`,
      `Phiên bản app  : ${app.getVersion()}`,
      `Hệ điều hành   : ${process.platform} ${process.arch}`,
      '',
      'Gửi NGUYÊN file này đi để được vá. Không có thông tin đăng nhập',
      'nào trong đây — chỉ có cấu trúc HTML của trang Flow.',
      '',
      '──────── 1. TỰ KIỂM NGAY LÚC XUẤT BÁO CÁO ────────',
      JSON.stringify(tuKiem, null, 2),
      '',
      '──────── 2. ENGINE TỰ CHỤP LÚC NÓ TRƯỢT ────────',
      (veoUiDiagnostics && Object.keys(veoUiDiagnostics).length)
        ? JSON.stringify(veoUiDiagnostics, null, 2)
        : '(chưa có bản chụp nào — hoặc đã bị nút "Xoá ghi nhận" dọn mất)',
      ''
    ].join('\n');

    const duongDan = path.join(app.getPath('userData'), 'flow-studio-chan-doan.txt');
    try {
      fs.writeFileSync(duongDan, chu, 'utf8');
    } catch (err) {
      return { ok: false, error: `Không ghi được file báo cáo: ${err.message}` };
    }
    logToUi('success', `📄 Đã xuất báo cáo chẩn đoán: ${duongDan}`);
    return { ok: true, duongDan };
  });

  // ── Hợp đồng dữ liệu của hai lệnh ảnh ──────────────────────────────────
  // Đọc thẳng từ flow-engine.js, KHÔNG đoán theo tên biến bên ngoài:
  //   handleCheckAssetNames(payload) đọc  payload.names   -> mảng CHUỖI
  //   handleUploadImages(payload)    đọc  payload.images  -> [{dataUrl,name,type}]
  // Gửi sai tên trường là engine trả "Không có ảnh nào được gửi tới" — đúng
  // kiểu lỗi đã từng làm nút Bắt đầu im lặng không làm gì.
  ipcMain.handle('app:eng:check-assets', (_e, data) =>
    guiChoTabDangMo({
      action: 'CHECK_ASSET_NAMES',
      data: { names: buildImageNames(data), settings: data.settings || {} }
    }));

  /**
   * Dò xem những mã ảnh này đã có trong kho Flow chưa — dò trên ĐÚNG tab chỉ
   * định, vì mỗi tài khoản có kho ảnh riêng. Chỉ lấy mẫu 12 mã đầu cho nhanh,
   * giống cách bản tiện ích làm; dò cả 400 mã thì mất vài phút mà chẳng thêm
   * thông tin gì.
   */
  ipcMain.handle('app:eng:check-flow-assets', async (_e, { names = [], tabId = null } = {}) => {
    const tab = tabId ? tabManager.find(tabId)
                      : (tabManager.find(tabManager.activeId) || tabManager.tabs.find((t) => t.ready));
    if (!tab) return { ok: false, error: 'Chưa mở tab Flow nào' };
    if (!tab.ready) return { ok: false, error: `${tab.id} chưa sẵn sàng — bấm "Gắn lại engine"` };

    const mau = names.slice(0, 12);
    if (!mau.length) return { ok: false, error: 'Chưa có mã ảnh nào để kiểm tra' };

    logToUi('info', `🔍 [${tab.id}] Dò ${mau.length} mã ảnh đầu tiên trong kho Flow…`);
    const r = await tabManager.dispatch(tab.id, { action: 'CHECK_ASSET_NAMES', data: { names: mau } });
    const kq = (r && r.result) || r || {};

    if (kq.ok === false) {
      logToUi('error', `❌ [${tab.id}] ${kq.error || 'Không kiểm tra được'}`);
    } else if (Array.isArray(kq.missing)) {
      if (!kq.missing.length) {
        logToUi('success',
          `✅ [${tab.id}] Kho Flow có đủ ${mau.length}/${mau.length} mã ảnh mẫu — sinh danh sách là chạy được`);
      } else {
        logToUi('warning',
          `⚠️ [${tab.id}] Kho Flow thiếu ${kq.missing.length}/${mau.length} mã: ` +
          kq.missing.slice(0, 8).join(', '));
      }
    }
    return { ...kq, tabId: tab.id, sampled: mau.length };
  });

  ipcMain.handle('app:eng:upload-images', async (_e, data) => {
    // Trang web không mở được đường dẫn ổ đĩa, nên phải đọc ảnh thành data URL
    // rồi đưa tận tay; engine dựng ngược lại thành File để nhét vào ô tải lên.
    const images = [];
    for (const f of (data.files || []).slice(0, 500)) {
      try {
        const buf = fs.readFileSync(f.path);
        const ext = path.extname(f.name).slice(1).toLowerCase() || 'png';
        const mime = 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
        images.push({
          name: f.name,
          type: mime,
          dataUrl: `data:${mime};base64,${buf.toString('base64')}`
        });
      } catch (err) {
        logToUi('error', `❌ Không đọc được ảnh ${f.name}: ${err.message}`);
      }
    }
    if (!images.length) return { ok: false, error: 'Không đọc được ảnh nào' };

    logToUi('info', `🖼 Đang gửi ${images.length} ảnh sang Flow…`);
    const r = await guiChoTabDangMo({
      action: 'UPLOAD_IMAGES_TO_FLOW',
      data: { images, settings: data.settings || {}, prompts: data.prompts || [] }
    });

    // Engine báo lỗi này khi chưa ai mở ô tải ảnh của Flow lần nào — nói lại
    // cho người dùng bằng đúng các bước cần bấm, thay vì để họ tự đoán.
    const loi = r && (r.error || (r.result && r.result.error));
    if (loi) logToUi('error', `❌ ${loi}`);
    return r;
  });
  ipcMain.handle('app:tabs:close',    (_e, id)    => { tabManager.close(id); return tabManager.list(); });
  ipcMain.handle('app:tabs:activate', (_e, id)    => { tabManager.setActive(id); return tabManager.list(); });
  ipcMain.handle('app:tabs:reload',   (_e, id)    => tabManager.reload(id));

  // Tiêm lại engine bằng tay, không phải tải lại cả trang Flow.
  ipcMain.handle('app:tabs:reinject', async (_e, id) => {
    const tab = tabManager.find(id || tabManager.activeId);
    if (!tab) return { ok: false, error: 'Chưa mở tab Flow nào' };
    await tabManager.injectEngine(tab, 'bấm tay');
    return { ok: tab.ready };
  });

  ipcMain.handle('app:tabs:diagnose', async (_e, id) => {
    const target = id || tabManager.activeId;
    const d = await tabManager.diagnose(target);
    if (!d.ok) {
      logToUi('error', `❌ Chẩn đoán thất bại: ${d.error}`);
      return d;
    }
    const v = (b) => (b ? '✅' : '❌');
    logToUi('info', '── CHẨN ĐOÁN TAB ' + d.tabId + ' ──');
    logToUi('info', `   Địa chỉ: ${d.url}`);
    logToUi(d.urlKhop ? 'info' : 'error',
      `   ${v(d.urlKhop)} Địa chỉ có phải trang Flow không`);
    logToUi(d.coBridge ? 'info' : 'error',
      `   ${v(d.coBridge)} Cầu nối preload (__flowBridge)`);
    logToUi(d.coStorage ? 'info' : 'error',
      `   ${v(d.coStorage)} Lớp giả lập chrome.storage`);
    logToUi(d.coDispatch ? 'info' : 'error',
      `   ${v(d.coDispatch)} Kênh nhận lệnh (__flowShimDispatch)`);
    logToUi(d.coEngine ? 'info' : 'error',
      `   ${v(d.coEngine)} Engine dò DOM`);
    logToUi(d.coClickCreate ? 'info' : 'error',
      `   ${v(d.coClickCreate)} Hàm bấm nút Tạo`);
    logToUi(d.coONhapPrompt ? 'info' : 'warning',
      `   ${v(d.coONhapPrompt)} Tìm thấy ô nhập prompt trên trang`);
    return d;
  });

  ipcMain.on('app:tabs:pane', (_e, { rect, visible }) => {
    if (!rect) return;
    tabManager.setPaneBounds({
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.round(rect.width), height: Math.round(rect.height)
    }, !!visible);
  });

  ipcMain.handle('app:run:start', async (_e, payload) => {
    const {
      prompts = [], indices = null, settings = {},
      tabIds = [], planMode = 'split'
    } = payload || {};
    store.set({ veoSettings: settings });
    downloadManager.setDownloadRoot(settings.downloadDir || app.getPath('downloads'));

    // Chế độ an toàn: nhận cài đặt mới, và xoá sổ lỗi của lần chạy trước —
    // lỗi cũ không nên tính vào hạn mức của mẻ mới.
    caiDatAnToan = anToan.chuanHoaCaiDat(settings.anToan);
    for (const t of tabManager.tabs) t._daDemLoi = new Set();
    if (caiDatAnToan.bat) {
      logToUi('info',
        `🛡 Chế độ an toàn: bật — ${caiDatAnToan.nguong} prompt hỏng trong ` +
        `${caiDatAnToan.cuaSoPhut} phút là tạm dừng ${caiDatAnToan.nghiPhut} phút` +
        (caiDatAnToan.cuMoi ? `; giải lao ${caiDatAnToan.giaiLaoPhut} phút sau mỗi ${caiDatAnToan.cuMoi} prompt` : '') + '.');
    } else {
      logToUi('warning',
        '🛡 Chế độ an toàn: TẮT — gặp "hoạt động bất thường" sẽ không tự dừng, ' +
        'và engine vẫn thử lại nên cả mẻ có thể cháy trong vài phút.');
    }

    // ── CHỈ giao cho tab ĐANG RẢNH ────────────────────────────────────
    // Lỗi cũ: nút Bắt đầu bị khoá toàn cục sau lần chạy đầu, nên giao việc cho
    // tab 1 xong là không giao được cho tab 2 nữa. Nay mỗi tab là một đơn vị
    // độc lập: tab nào đang chạy thì bỏ qua, tab nào rảnh thì nhận việc mới.
    const dangChay = tabManager.tabs.filter((t) => t.busy).map((t) => t.id);
    let targets = (tabIds.length ? tabIds : tabManager.tabs.map((t) => t.id))
      .filter((id) => {
        const t = tabManager.find(id);
        return t && t.ready && !t.busy;
      });

    // Chưa tab nào sẵn sàng thì THỬ TIÊM LẠI trước khi bỏ cuộc. Trang Flow có
    // thể vừa chuyển màn hình kiểu SPA và engine chưa kịp bám lại — bắt người
    // dùng tự mò trong khi máy tự sửa được là dở.
    if (!targets.length && tabManager.tabs.some((t) => !t.busy)) {
      logToUi('info', '⏳ Chưa tab nào sẵn sàng — đang thử gắn lại engine…');
      for (const t of tabManager.tabs) {
        if (!t.busy) await tabManager.maybeInject(t, 'trước khi chạy');
      }
      targets = (tabIds.length ? tabIds : tabManager.tabs.map((t) => t.id))
        .filter((id) => { const t = tabManager.find(id); return t && t.ready && !t.busy; });
    }

    if (!targets.length) {
      if (dangChay.length) {
        return {
          ok: false,
          error: `Các tab đã chọn đang bận (${dangChay.join(', ')}). ` +
                 `Mở thêm tab hoặc chọn tab khác — tab đang chạy vẫn tiếp tục bình thường.`
        };
      }
      return {
        ok: false,
        error: tabManager.tabs.length
          ? 'Tab Flow đã mở nhưng engine chưa bám được. Sang mục Cửa sổ Flow bấm "Chẩn đoán" để xem hỏng ở đâu.'
          : 'Chưa mở tab Flow nào. Sang mục Tài khoản bấm "+ Mở tab" và đăng nhập trước.'
      };
    }

    // ── Lọc theo dải prompt người dùng chọn ───────────────────────────
    // prompts giữ NGUYÊN danh sách đầy đủ (engine tra prompts[index-1]), chỉ
    // danh sách VIỆC mới bị lọc. Đó là lý do hai thứ này tách rời nhau.
    const tabObjs = targets.map((id) => tabManager.find(id)).filter(Boolean);
    let ke = planRun(prompts, tabObjs, planMode);

    if (Array.isArray(indices) && indices.length && indices.length < prompts.length) {
      const chon = new Set(indices);
      // Lọc trước rồi mới chia, nếu không tab nào rơi vào vùng bị bỏ sẽ nhận
      // phần rỗng trong khi tab khác ôm hết việc.
      const loc = prompts.map((t, i) => ({ index: i + 1, text: t })).filter((j) => chon.has(j.index));
      ke = planRunJobs(loc, tabObjs, planMode);
    }

    if (!ke.length) return { ok: false, error: 'Không có prompt nào rơi vào dải đã chọn' };

    const results = [];
    for (const { tabId, part } of ke) {
      const tab = tabManager.find(tabId);

      // ── Ghi nhận việc của RIÊNG tab này ─────────────────────────────
      // Bảng tiến độ đọc từ đây, nên mỗi tab báo cáo độc lập kể cả khi các
      // tab khác đang chạy mẻ hoàn toàn khác.
      tab.assigned = part.length;
      tab.stats = { running: 0, done: 0, failed: 0 };
      tab.tienDo = null;
      tab.chain = null;

      // Chuỗi ảnh→video: nhớ mã ảnh của ĐÚNG phần việc tab này nhận, để khi
      // mẻ ảnh xong nó tự nối tiếp phần của chính nó, không đụng tab khác.
      if (payload.chain && payload.chain.enabled && settings.runMode === 'image') {
        // ── Mã ảnh phải khớp TÊN THẬT Flow sẽ đặt ─────────────────────
        // Mặc định: suy thẳng từ cài đặt đổi tên bằng tenAnhTheoRename(),
        // bản sao của generateFileName() — đúng hàm engine dùng khi đổi tên
        // ảnh trên kho Flow. Bản trước để giao diện tự đánh số nên sinh ra
        // "001" trong khi Flow đặt "01", và Character Sync không bắt được
        // ảnh nào. Chỉ khi người dùng chọn "theo khai báo ở Kho ảnh Flow"
        // mới lấy danh sách họ tự nhập.
        const tuKhaiBao = payload.chain.nameSource === 'range';
        const tatCaMa = tuKhaiBao ? (payload.chain.imageNames || []) : null;
        tab.chain = {
          phase: 'image',
          imageNames: tuKhaiBao
            ? part.map((j) => tatCaMa[j.index - 1]).filter(Boolean)
            : tenAnhTheoRename(settings, part),
          videoPrompt: payload.chain.videoPrompt || '',
          perImagePrompts: payload.chain.perImagePrompts || null,
          // Bộ cài đặt cho MẺ VIDEO nối tiếp — do giao diện gom riêng bằng
          // bộ "Tải về — Video". Dùng lại bộ Ảnh ở đây là video tải về theo
          // chất lượng ảnh (img_1k) và rơi vào thư mục ảnh.
          videoSettings: payload.chain.videoSettings || settings,
          skipIfFailed: payload.chain.skipIfFailed !== false
        };
      }

      // Đặt đúng chế độ Image/Video trên trang Flow trước khi giao việc.
      if (settings.runMode) await datCheDo(tab, settings.runMode);
      // Kế hoạch model (mẻ video) — có thể ép giãn cách tối thiểu 1 giây.
      const caiDatTab = await chuanBiModel(tab, settings);

      const r = await tabManager.dispatch(tabId, buildStartMessage(prompts, part, caiDatTab));
      tab.busy = true;            // đánh dấu ngay, không chờ engine báo
      results.push({ tabId, count: part.length, ...r });
      logToUi('info',
        `▶ ${tabId}${tab.accountName ? ' (' + tab.accountName + ')' : ''}: ` +
        `nhận prompt ${part[0].index}–${part[part.length - 1].index} (${part.length} cái)` +
        (tab.chain ? ' · sẽ tự nối sang video khi xong' : ''));
    }
    sendUi('stats', { ...tabStatsPayload() });
    return { ok: true, results };
  });

  // ── Tạm dừng / chạy tiếp / dừng — THEO TỪNG TAB ───────────────────────
  // Không có tabIds thì áp cho mọi tab (nút chung ở dưới bảng điều khiển);
  // có tabIds thì chỉ đúng những tab đó, để dừng một tab không đụng tab khác
  // đang chạy mẻ của tài khoản khác.
  const guiTheoTab = async (tabIds, message) => {
    const ds = (tabIds && tabIds.length)
      ? tabIds.map((id) => tabManager.find(id)).filter(Boolean)
      : tabManager.tabs;
    const kq = [];
    for (const t of ds) kq.push(await tabManager.dispatch(t.id, message));
    return kq;
  };

  // Người dùng tự bấm Tạm dừng thì phải huỷ cả lịch nghỉ đang hẹn — nếu không
  // đồng hồ tới giờ sẽ tự bật lại tab mà họ vừa cố ý dừng.
  ipcMain.handle('app:run:pause', (_e, tabIds) => {
    const ds = (tabIds && tabIds.length)
      ? tabIds.map((id) => tabManager.find(id)).filter(Boolean)
      : tabManager.tabs;
    for (const t of ds) huyNghi(t.accountId);
    return guiTheoTab(tabIds, { action: 'PAUSE_AUTOMATION' });
  });

  // Bộ nhịp "hiền" gợi ý theo số tab — giao diện gọi khi bấm nút đặt nhanh.
  ipcMain.handle('app:run:nhipAnToan', (_e, soTab) => anToan.nhipAnToan(soTab));
  ipcMain.handle('app:run:resume', (_e, tabIds) => guiTheoTab(tabIds, { action: 'RESUME_AUTOMATION' }));

  ipcMain.handle('app:run:stop', async (_e, tabIds) => {
    const ds = (tabIds && tabIds.length)
      ? tabIds.map((id) => tabManager.find(id)).filter(Boolean)
      : tabManager.tabs;
    for (const t of ds) {
      downloadManager.clear(t.id);     // chỉ xoá hàng đợi tên của ĐÚNG tab đó
      t.chain = null;                  // dừng tay thì không nối chuỗi nữa
      huyNghi(t.accountId);            // đang hẹn chạy lại thì bỏ hẹn, đừng tự bật dậy
    }
    return guiTheoTab(tabIds, { action: 'STOP_AUTOMATION' });
  });

  // ── Đổi / đọc chế độ Flow bằng tay ───────────────────────────────────
  // Phần tự động vẫn chạy trước mỗi mẻ; hai lời gọi này để người dùng đặt sẵn
  // từ đầu, hoặc chữa tay khi Google đổi giao diện làm phần tự động trượt.
  ipcMain.handle('app:tabs:setMode', async (_e, { id, mode }) => {
    const tab = tabManager.find(id);
    if (!tab) return { ok: false, lyDo: 'Không thấy tab ' + id };
    return await datCheDo(tab, mode === 'image' ? 'image' : 'video');
  });

  ipcMain.handle('app:tabs:getMode', async (_e, id) => {
    const tab = tabManager.find(id);
    if (!tab || !tab.ready) return { ok: false, lyDo: 'Tab chưa sẵn sàng' };
    try {
      const mode = await tab.view.webContents.executeJavaScript(
        'window.__flowGetMode && window.__flowGetMode()', true);
      return { ok: true, mode: mode || null };
    } catch (err) {
      return { ok: false, lyDo: err.message };
    }
  });

  // Đọc danh sách model + model đang chọn. KHÔNG làm khi tab đang chạy: phải
  // mở bảng cài đặt trên trang, dễ giẫm chân engine đang dán prompt.
  ipcMain.handle('app:tabs:listModels', async (_e, id) => {
    const tab = tabManager.find(id);
    if (!tab || !tab.ready) return { ok: false, lyDo: 'Tab chưa sẵn sàng' };
    if (tab.busy) return { ok: false, lyDo: 'Tab đang chạy mẻ — đợi xong hoặc tạm dừng rồi đọc' };
    try {
      const r = await tab.view.webContents.executeJavaScript(
        'window.__flowListModels ? window.__flowListModels() : null', true);
      if (!r) return { ok: false, lyDo: 'Trình chọn model chưa được tiêm vào tab' };
      if (!r.ok) {
        logToUi('warning', `⚠️ [${tab.id}] Không đọc được danh sách model: ${r.lyDo}`, tab.id);
        if (r.chiTiet) logToUi('info', `   ↳ chẩn đoán: ${JSON.stringify(r.chiTiet)}`, tab.id);
        return r;
      }
      const g = await docModel(tab);
      logToUi('info', `🎚 [${tab.id}] Flow có ${r.ds.length} model: ${r.ds.join(' · ')}` +
        (g && g.ok ? ` — đang chọn ${g.model}` : ''), tab.id);
      return { ...r, dangChon: g && g.ok ? g.model : null };
    } catch (err) {
      return { ok: false, lyDo: err.message };
    }
  });

  ipcMain.handle('app:run:stats', () => tabStatsPayload());

  // Xem trước tên ảnh cho khối "Tự nối ảnh → video". Cố ý tính Ở ĐÂY chứ
  // không chép logic sang giao diện: một bản sao thứ hai là một chỗ nữa để
  // lệch, mà lệch tên ảnh thì Character Sync im lặng bắt nhầm ảnh.
  ipcMain.handle('app:run:chainPreview', (_e, payload) => {
    try {
      const p = payload || {};
      const jobs = Array.isArray(p.jobs) ? p.jobs : [];
      return { ok: true, names: tenAnhTheoRename(p.settings || {}, jobs) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('app:settings:get',  ()        => store.get(['veoSettings', 'veoProjects']));
  ipcMain.handle('app:settings:save', (_e, data) => {
    store.set({ veoSettings: data });
    if (data && data.downloadDir) downloadManager.setDownloadRoot(data.downloadDir);
    return true;
  });

  ipcMain.handle('app:dialog:folder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn thư mục lưu video',
      properties: ['openDirectory', 'createDirectory']
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('app:dialog:images', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn ảnh (chọn hết các ảnh trong thư mục)',
      filters: [{ name: 'Ảnh', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      properties: ['openFile', 'multiSelections']
    });
    if (r.canceled || !r.filePaths.length) return null;

    // Sắp theo tên có hiểu SỐ, để anh2 đứng trước anh10 chứ không phải sau.
    const soSanh = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
    const files = r.filePaths
      .map((p) => ({ name: path.basename(p), path: p }))
      .sort((a, b) => soSanh.compare(a.name, b.name));

    return { dir: path.dirname(r.filePaths[0]), files };
  });

  ipcMain.handle('app:dialog:txt', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Chọn file prompt (.txt)',
      filters: [{ name: 'Text', extensions: ['txt', 'text'] }],
      properties: ['openFile', 'multiSelections']
    });
    if (r.canceled) return null;
    return r.filePaths.map((p) => ({
      name: path.basename(p),
      content: fs.readFileSync(p, 'utf8')
    }));
  });

  ipcMain.handle('app:dialog:save-txt', async (_e, { content, suggested }) => {
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Lưu danh sách prompt',
      defaultPath: suggested || 'prompts.txt',
      filters: [{ name: 'Text', extensions: ['txt'] }]
    });
    if (r.canceled) return null;
    fs.writeFileSync(r.filePath, content, 'utf8');
    return r.filePath;
  });

  // ── Tự cập nhật ─────────────────────────────────────────────────────
  ipcMain.handle('app:capnhat:trangThai', () => (boCapNhat ? boCapNhat.trangThai() : null));
  ipcMain.handle('app:capnhat:kiemTra',  () => (boCapNhat ? boCapNhat.kiemTra() : null));
  ipcMain.handle('app:capnhat:caiDat',   (_e, epBuoc) => (boCapNhat ? boCapNhat.caiDat({ moLai: true, epBuoc: !!epBuoc }) : null));
  ipcMain.handle('app:capnhat:moTrang',  () => {
    const u = boCapNhat && boCapNhat.trangThai().trangPhatHanh;
    // Chỉ mở đúng trang phát hành GitHub — không mở link lạ nào khác.
    if (u && /^https:\/\/github\.com\//.test(u)) shell.openExternal(u);
    return !!u;
  });
  ipcMain.handle('app:capnhat:luuCaiDat', (_e, c) => {
    if (!boCapNhat) return null;
    boCapNhat.datCaiDat(c);
    store.set({ capNhat: boCapNhat.trangThai().caiDat });
    return boCapNhat.trangThai();
  });

  ipcMain.handle('app:version', () => ({
    version: APP_VERSION,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    logFile: logStream ? logStream.path : null,
    dataDir: app.getPath('userData')
  }));

  ipcMain.handle('app:open-path', (_e, p) => shell.openPath(p));

  // Nút "Thử dán prompt dài" trong Cài đặt — kiểm chứng ngay trên tab đang mở
  // rằng bao nhiêu ký tự vào được, trước khi chạy cả mẻ.
  ipcMain.handle('app:test-paste', async (_e, text) => {
    const tab = tabManager.find(tabManager.activeId);
    if (!tab) return { ok: false, error: 'Chưa mở tab Flow nào' };
    return pastePrompt(tab.view.webContents, text, (lvl, msg) => logToUi(lvl, msg, tab.id));
  });
}

// ============================================================================
//  KHỞI ĐỘNG
// ============================================================================

/**
 * Thanh menu trên cùng của macOS.
 *
 * Trên Mac, Cmd+C / Cmd+V / Cmd+A chỉ chạy được khi menu có mục "Sửa" mang
 * đúng các vai trò copy/paste/selectAll — không có thì dán prompt vào ô nhập
 * sẽ im re. Menu mặc định của Electron có đủ nhưng bằng tiếng Anh, nên dựng
 * lại bằng tiếng Việt. Windows giữ nguyên như cũ.
 */
function dungMenuMac() {
  if (process.platform !== 'darwin') return;
  const ten = 'Flow Automation Studio';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: ten,
      submenu: [
        { role: 'about', label: `Giới thiệu ${ten}` },
        { type: 'separator' },
        { role: 'hide', label: `Ẩn ${ten}` },
        { role: 'hideOthers', label: 'Ẩn các app khác' },
        { role: 'unhide', label: 'Hiện tất cả' },
        { type: 'separator' },
        { role: 'quit', label: `Thoát ${ten}` }
      ]
    },
    {
      label: 'Sửa',
      submenu: [
        { role: 'undo', label: 'Hoàn tác' },
        { role: 'redo', label: 'Làm lại' },
        { type: 'separator' },
        { role: 'cut', label: 'Cắt' },
        { role: 'copy', label: 'Sao chép' },
        { role: 'paste', label: 'Dán' },
        { role: 'pasteAndMatchStyle', label: 'Dán giữ định dạng đích' },
        { role: 'delete', label: 'Xoá' },
        { role: 'selectAll', label: 'Chọn tất cả' }
      ]
    },
    {
      label: 'Xem',
      submenu: [
        { role: 'reload', label: 'Tải lại giao diện' },
        { role: 'toggleDevTools', label: 'Công cụ nhà phát triển' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Cỡ chữ mặc định' },
        { role: 'zoomIn', label: 'Phóng to' },
        { role: 'zoomOut', label: 'Thu nhỏ' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Toàn màn hình' }
      ]
    },
    {
      label: 'Cửa sổ',
      submenu: [
        { role: 'minimize', label: 'Thu xuống Dock' },
        { role: 'zoom', label: 'Phóng cửa sổ' },
        { type: 'separator' },
        { role: 'front', label: 'Đưa tất cả lên trước' }
      ]
    }
  ]));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0f1117',
    title: 'Flow Automation Studio',
    icon: path.join(__dirname, 'icons', 'icon128.png'),
    webPreferences: {
      preload: path.join(__dirname, 'src', 'main', 'preload-ui.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'ui', 'index.html'));

  mainWindow.on('resize', () => tabManager && tabManager.applyBounds());
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });

  store = new Store(
    path.join(userData, 'flow-studio-data.json'),
    (msg) => logToUi('warning', msg)
  );

  try {
    logStream = fs.createWriteStream(path.join(userData, 'flow-studio.log'), { flags: 'a' });
    logStream.path = path.join(userData, 'flow-studio.log');
  } catch (_) {}

  accountManager = new AccountManager(store, (lvl, msg) => logToUi(lvl, msg));

  dungMenuMac();
  createWindow();

  tabManager = new TabManager({
    mainWindow,
    accounts: accountManager,
    preloadPath: path.join(__dirname, 'src', 'main', 'preload-flow.js'),
    log: (lvl, msg) => logToUi(lvl, msg),
    onTabsChanged: (list) => sendUi('tabs', list)
  });

  downloadManager = new DownloadManager({
    getSettings: () => store.get('veoSettings').veoSettings || {},
    findTabByWcId: (id) => tabManager.findByWcId(id),
    notifyTab: (tabId, payload) => tabManager.dispatch(tabId, payload),
    log: (lvl, msg, tabId) => logToUi(lvl, msg, tabId),
    // Thư mục tải RIÊNG của từng tài khoản, nếu tài khoản đó có đặt. Không có
    // thì video của các tài khoản trộn lẫn và rất khó lần ra cái nào của ai.
    dirForTab: (tab) => {
      if (!tab || !tab.accountId) return null;
      const acc = accountManager.find(tab.accountId);
      return acc && acc.downloadDir ? acc.downloadDir : null;
    }
  });

  const saved = store.get('veoSettings').veoSettings || {};
  downloadManager.setDownloadRoot(saved.downloadDir || app.getPath('downloads'));

  // Gắn cho MỌI phiên tài khoản đang có; tài khoản thêm sau được gắn lúc tạo.
  for (const acc of accountManager.accounts) attachDownloadsFor(acc);

  registerIpc();
  khoiDongCapNhat();

  logToUi('success', `🚀 Flow Automation Studio ${APP_VERSION} đã khởi động`);
  logToUi('info', `📁 Dữ liệu: ${userData}`);

  // Chạy thử đường model từ đầu tới cuối trên trang giả lập: chỉ bật khi đặt
  // FLOW_E2E_MODEL=1. Cần chạm vào hàm bên trong nên đưa thẳng cho bài thử.
  if (process.env.FLOW_E2E_MODEL === '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      require('./tests/model-e2e').run({
        app, tabManager, handleEngineMessage, theoDoiAnToan, chuanBiModel,
        lpChan, soAnToanCua, huyNghi
      }).catch((err) => { console.error('[e2e] Lỗi:', err); app.exit(1); });
    });
  }

  // Chạy thử tự động: chỉ bật khi đặt biến môi trường FLOW_SMOKE=1.
  if (process.env.FLOW_SMOKE === '1') {
    mainWindow.webContents.once('did-finish-load', () => {
      require('./tests/smoke').run(mainWindow, app).catch((err) => {
        console.error('[smoke] Lỗi:', err);
        app.exit(1);
      });
    });
  }
});

// ============================================================================
//  TỰ CẬP NHẬT — chi tiết và giới hạn ở src/main/cap-nhat.js
//  Kiểm lần đầu 20 giây sau khi mở (để app khởi động xong đã), rồi 4 giờ một
//  lần. Không bao giờ tự cài giữa lúc đang chạy mẻ.
// ============================================================================
function khoiDongCapNhat() {
  const pkg = require('./package.json');
  boCapNhat = new BoCapNhat({
    phienBan: APP_VERSION,
    repo: layRepo(pkg),
    platform: process.platform,
    arch: process.arch,
    execPath: process.execPath,
    isPackaged: app.isPackaged,
    env: process.env,
    thuMuc: app.getPath('userData'),
    // Chỉ để kiểm thử trỏ vào máy chủ giả; bình thường là api.github.com.
    apiGoc: process.env.FLOW_UPDATE_API || undefined,
    fetch: (url, opts) => net.fetch(url, opts),
    spawn: (cmd, args, opts) => spawn(cmd, args, opts),
    execFile: (cmd, args) => new Promise((ok, loi) =>
      execFile(cmd, args, { maxBuffer: 1 << 20 }, (err, out) => (err ? loi(err) : ok(out)))),
    thoatApp: () => app.quit(),
    moFinder: (p) => shell.showItemInFolder(p),
    coTabDangChay: () => !!(tabManager && tabManager.tabs.some((t) => t.busy || t.nghiAnToan)),
    log: (muc, chu) => logToUi(muc, chu),
    gui: (tt) => sendUi('cap-nhat', tt)
  });
  const luu = (store.get('capNhat') || {}).capNhat;
  boCapNhat.datCaiDat(luu);

  if (process.env.FLOW_SMOKE === '1' || process.env.FLOW_E2E_MODEL === '1') return;
  const kiem = () => { if (boCapNhat.caiDatNguoiDung.tuKiem) boCapNhat.kiemTra({ imLang: true }); };
  setTimeout(kiem, 20000);
  setInterval(kiem, 4 * 3600 * 1000);
}

// Đóng cửa sổ là THOÁT HẲN — trên cả macOS.
//
// Thói quen của macOS là đóng cửa sổ nhưng app vẫn sống dưới Dock. Với tool này
// thì đó là cái bẫy: kho dữ liệu đã đóng, TabManager vẫn giữ các tab Flow chạy
// ngầm trỏ vào một cửa sổ không còn nữa, và bấm biểu tượng Dock cũng không mở
// lại được gì. Đang chạy mẻ mà tưởng đã tắt thì càng tệ. Nên: đóng là thoát.
app.on('window-all-closed', () => {
  if (store) store.close();
  app.quit();
});

app.on('before-quit', (e) => {
  // Có bản mới đã tải xong và người dùng bật "tự cài khi thoát": giữ app lại
  // một nhịp để chuẩn bị (trên Mac phải giải nén + kiểm phiên bản TRƯỚC khi
  // tắt), rồi bộ cập nhật tự thoát. Hỏng thì thoát bình thường, lần sau tính.
  if (boCapNhat && boCapNhat.nenCaiKhiThoat()) {
    e.preventDefault();
    boCapNhat.caiDat({ moLai: false, epBuoc: true, thoat: true }).then((r) => {
      if (!r || !r.ok) { boCapNhat.boQuaKhiThoat = true; app.quit(); }
    });
    return;
  }
  if (store) store.close();
  if (tabManager) tabManager.closeAll();
});

process.on('uncaughtException', (err) => {
  // Không để app chết âm thầm — ghi log rồi báo lên giao diện.
  logToUi('error', `❌ Lỗi không bắt được: ${err.message}`);
  console.error(err);
});

module.exports = { FLOW_URL };
