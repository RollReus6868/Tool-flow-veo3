// ============================================================================
//  mode-main.js — TRÌNH ĐỔI CHẾ ĐỘ IMAGE ⇄ VIDEO CÓ CHẠY KHÔNG
//  --------------------------------------------------------------------------
//  Chạy:  xvfb-run -a electron tests/mode-main.js --no-sandbox
//
//  Bài này sinh ra từ một lỗi thật, và tôi đã giao hàng lỗi đó vì KHÔNG có
//  bài kiểm tra nào như thế này. Nhật ký của người dùng:
//
//      🔗 [tab1] Mẻ ảnh xong — tự nối sang video cho 2 ảnh (001 → 002)
//      ⚠️ [tab1] Không tự đổi được sang chế độ video: Không mở được bảng
//         cài đặt cạnh ô nhập prompt.
//      ⛔ [tab1] Bot tự động dừng: Sai chế độ giao diện (Yêu cầu Video).
//
//  Hai cái bẫy, fixture dựng lại cả hai:
//    1. Bảng cài đặt chỉ mở khi nhận POINTERDOWN. el.click() trơn không mở
//       được gì — Radix cố tình bỏ qua click tổng hợp.
//    2. Bảng là khối position:fixed, nên offsetParent của nó là null. Dò
//       "có nhìn thấy không" bằng offsetParent là trượt dù bảng mở toang.
//
//  Và một điều kiện nữa, quan trọng không kém: sau khi đổi xong, thước đo mà
//  ENGINE dùng (chữ trên nút mở bảng) phải nói đúng chế độ mới. Đổi được mà
//  engine vẫn đọc ra chế độ cũ thì nó vẫn tự dừng — y như cũ.
// ============================================================================

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const MODE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'inject', 'flow-mode.js'), 'utf8');

const failures = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function ok(ten, dieuKien, chiTiet = '') {
  console.log(`   ${dieuKien ? '✓' : '✗'} ${ten}${chiTiet ? ' — ' + chiTiet : ''}`);
  if (!dieuKien) failures.push(ten + (chiTiet ? ' — ' + chiTiet : ''));
}

// Cố ý dùng ĐÚNG MỘT cửa sổ cho cả bài. Dựng cửa sổ thứ hai rồi loadURL ngay
// sau khi destroy() cửa sổ trước thì Electron trả ERR_FAILED (-2) — nửa tiếng
// đi tìm lỗi ở chỗ không hề có lỗi. Một cửa sổ, đổi giao diện bằng lời gọi hàm.
let WIN = null;

/** Nạp fixture, chọn đời giao diện, tiêm flow-mode.js. */
async function moTrang(ui) {
  if (!WIN) {
    WIN = new BrowserWindow({ width: 1100, height: 800, show: false });
    await WIN.loadURL('file://' + path.join(__dirname, 'fixture-mode.html'));
    await wait(300);
  }
  // Chọn đời giao diện bằng lời gọi hàm, không bằng ?query hay #hash:
  // Electron từ chối tải lại cùng một file:// chỉ khác phần đó (ERR_FAILED -2).
  await WIN.webContents.executeJavaScript(
    `window.__fixtureSetUI(${JSON.stringify(ui)})`, true);
  // Tiêm y như tabs.js làm, kể cả đuôi ";undefined;" chống lỗi clone.
  // flow-mode.js là IIFE chỉ gán lên window nên tiêm chồng bao nhiêu lần
  // cũng được — đúng điều kiện tabs.js trông đợi ở nó.
  await WIN.webContents.executeJavaScript(MODE_SRC + '\n;undefined;', true);
  return WIN;
}

const js = (wc, code) => wc.webContents.executeJavaScript(code, true);

async function kiemTraMotGiaoDien(ui) {
  console.log(`\n── Giao diện ${ui === 'new' ? 'MỚI (Material)' : 'CŨ (Radix)'} ` + '─'.repeat(28));
  const win = await moTrang(ui);

  ok('tiêm được flow-mode.js', await js(win, 'typeof window.__flowSetMode === "function"'));

  // ── 1. Đọc đúng chế độ ban đầu ─────────────────────────────────────────
  const banDau = await js(win, 'window.__flowGetMode()');
  ok('đọc đúng chế độ ban đầu là image', banDau === 'image', `đọc ra "${banDau}"`);

  // ── 2. Đổi image -> video ──────────────────────────────────────────────
  // Đây là thao tác đã thất bại ở bản 2.3.0.
  const r1 = await js(win, 'window.__flowSetMode("video")');
  ok('đổi sang video: báo thành công', r1 && r1.ok === true,
     r1 ? (r1.lyDo || '') : 'không trả về gì');
  ok('đổi sang video: báo CÓ đổi', r1 && r1.daDoi === true);

  // Trang thật sự đổi, không phải chỉ báo suông.
  const sauKhiDoi = await js(win, 'window.__fixtureMode()');
  ok('trang Flow thật sự sang chế độ video', sauKhiDoi === 'video', `trang đang ở "${sauKhiDoi}"`);

  // ĐÚNG MỘT cú bấm mở bảng. Bản 2.3.1 bắn chuỗi sự kiện rồi gọi thêm
  // el.click() — trên giao diện Material đó là hai cú, mở rồi đóng ngay, và
  // nhật ký người dùng ghi "Chưa đổi được sang chế độ video (lần 1/5)".
  const soCuBam = await js(win, 'window.__soLanBamNut');
  ok('chỉ bấm nút mở bảng ĐÚNG MỘT lần', soCuBam === 1,
     `bảng nhận ${soCuBam} cú bấm — nhiều hơn 1 là mở rồi đóng ngay`);

  // ── 3. Thước đo của ENGINE phải đồng ý ─────────────────────────────────
  // Chính xác dòng engine chạy ở pastePrompt(). Lệch ở đây là engine tự dừng
  // với "Sai chế độ giao diện" dù ta vừa đổi xong.
  const engineThay = await js(win, `(function(){
    var b = document.querySelector('button.settings-trigger-button');
    return b ? b.textContent.trim().toLowerCase().includes('video') : null;
  })()`);
  ok('engine cũng đọc ra là video', engineThay === true, `engine đọc: ${engineThay}`);

  // ── 4. Bảng phải được ĐÓNG lại ─────────────────────────────────────────
  // Bỏ bảng mở treo trên ô nhập là engine bấm Tạo không trúng.
  ok('bảng cài đặt đã đóng lại', (await js(win, 'window.__fixtureOpen()')) === false);

  // ── 5. Gọi lại khi đã đúng chế độ: không được làm gì thêm ──────────────
  const soLan = await js(win, 'window.__soLanMoBang');
  const r2 = await js(win, 'window.__flowSetMode("video")');
  ok('gọi lại lúc đã ở video: vẫn ok', r2 && r2.ok === true);
  ok('gọi lại lúc đã ở video: báo KHÔNG đổi gì', r2 && r2.daDoi === false);
  ok('gọi lại lúc đã ở video: không mở bảng vô ích',
     (await js(win, 'window.__soLanMoBang')) === soLan);

  // ── 6. Đổi ngược video -> image ────────────────────────────────────────
  const r3 = await js(win, 'window.__flowSetMode("image")');
  ok('đổi ngược về image: báo thành công', r3 && r3.ok === true, r3 ? (r3.lyDo || '') : '');
  ok('đổi ngược về image: trang đã đổi thật',
     (await js(win, 'window.__fixtureMode()')) === 'image');

  // ── 7. Bảng đang mở sẵn thì vẫn xử lý được ─────────────────────────────
  // Mở bảng bằng đúng sự kiện mà đời giao diện đó nghe: Radix ở pointerdown,
  // Material ở click. Dùng sai sự kiện thì bảng không mở và bài kiểm tra tự
  // báo hỏng ở phần dựng cảnh chứ không phải ở phần cần kiểm.
  await js(win, `(function(){
    var t = document.getElementById('trigger');
    t.dispatchEvent(${ui === 'new'
      ? `new MouseEvent('click', { bubbles: true })`
      : `new PointerEvent('pointerdown', { bubbles: true })`});
    return true;
  })()`);
  await wait(200);
  ok('bảng đang mở sẵn trước khi gọi', (await js(win, 'window.__fixtureOpen()')) === true);
  const r4 = await js(win, 'window.__flowSetMode("video")');
  ok('bảng mở sẵn: vẫn đổi được', r4 && r4.ok === true && (await js(win, 'window.__fixtureMode()')) === 'video',
     r4 ? (r4.lyDo || '') : '');
}

app.whenReady().then(async () => {
  console.log('\n══════════ ĐỔI CHẾ ĐỘ IMAGE ⇄ VIDEO TRÊN FLOW ══════════');

  try {
    await kiemTraMotGiaoDien('old');
    await kiemTraMotGiaoDien('new');

    // ── 8. Không có bảng nào cả thì phải báo lỗi RÕ, không treo ───────────
    console.log('\n── Trang không phải Flow ' + '─'.repeat(31));
    await WIN.loadURL('data:text/html,<h1>trang%20la</h1>');
    await wait(300);
    await WIN.webContents.executeJavaScript(MODE_SRC + '\n;undefined;', true);
    const r = await WIN.webContents.executeJavaScript('window.__flowSetMode("video")', true);
    ok('trang lạ: báo thất bại chứ không treo', r && r.ok === false, JSON.stringify(r));
    ok('trang lạ: có nêu lý do đọc được', !!(r && r.lyDo && r.lyDo.length > 10), r && r.lyDo);
  } catch (e) {
    failures.push('Ngoại lệ khi chạy: ' + e.message);
    console.error(e);
  }

  console.log('\n' + '─'.repeat(58));
  if (failures.length) {
    console.log(`KẾT QUẢ: ${failures.length} LỖI`);
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  } else {
    console.log('KẾT QUẢ: TẤT CẢ ĐỀU PASS');
  }
  console.log('─'.repeat(58) + '\n');

  if (WIN) WIN.destroy();
  app.exit(failures.length ? 1 : 0);
});
