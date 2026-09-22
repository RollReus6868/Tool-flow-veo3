// ============================================================================
//  tabs-main.js — KIỂM CHỨNG ENGINE BÁM ĐƯỢC VÀO TAB
//  --------------------------------------------------------------------------
//  Chạy:  FLOW_TEST_HOST='^file:' electron tests/tabs-main.js --no-sandbox
//
//  Bài này sinh ra từ một lỗi thật người dùng gặp: đăng nhập xong, trang Flow
//  hiện ra đầy đủ trước mắt, nhưng app vẫn báo "Tab chưa sẵn sàng" và không
//  bấm Bắt đầu được.
//
//  Nguyên nhân: Flow là ứng dụng Angular. Sau đăng nhập nó chuyển màn hình
//  bằng history.pushState chứ KHÔNG tải lại trang, nên 'did-finish-load' —
//  sự kiện duy nhất mà bản đầu nghe — không bắn lần nữa. Engine không bao giờ
//  được tiêm, và không có gì trong giao diện nói cho người dùng biết vì sao.
//
//  Ba tình huống dưới đây phải cùng cho ra "sẵn sàng", nếu không lỗi sẽ quay lại.
// ============================================================================

const { app, BrowserWindow } = require('electron');
const path = require('path');
const { TabManager } = require('../src/main/tabs');

const failures = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chờ tới khi điều kiện đúng, hoặc hết giờ. */
async function waitFor(fn, timeoutMs = 15000, step = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await wait(step);
  }
  return false;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1000, height: 700, show: false });
  await win.loadURL('about:blank');

  const logs = [];
  const tm = new TabManager({
    mainWindow: win,
    session: require('electron').session.fromPartition('test:flow'),
    preloadPath: path.join(__dirname, '..', 'src', 'main', 'preload-flow.js'),
    log: (lvl, msg) => logs.push(`${lvl}: ${msg}`),
    onTabsChanged: () => {}
  });

  const fixture = 'file://' + path.join(__dirname, 'fixture-flow.html');

  console.log('\n══════════ ENGINE CÓ BÁM ĐƯỢC VÀO TAB KHÔNG ══════════\n');

  // ── 1. Tải trang lần đầu ─────────────────────────────────────────────
  // Đi qua đúng đường thật: create() dựng WebContentsView, đấu các sự kiện,
  // bật chốt chặn dò lại. Không giả lập mảnh nào.
  const tab = await tm.create(null, fixture);
  const ok1 = await waitFor(() => tab.ready);
  console.log(`1. Tải trang lần đầu            : ${ok1 ? '✓ sẵn sàng' : '✗ KHÔNG sẵn sàng'}`);
  if (!ok1) failures.push('Tải trang lần đầu mà engine không bám được');

  // Kiểm tra từng mảnh thật sự có mặt, không chỉ tin vào cờ tab.ready
  const d1 = await tm.diagnose(tab.id);
  const thieu = ['coBridge', 'coChrome', 'coStorage', 'coDispatch', 'coEngine', 'coClickCreate']
    .filter((k) => !d1[k]);
  console.log(`   các mảnh có mặt              : ${thieu.length ? '✗ thiếu ' + thieu.join(', ') : '✓ đủ cả 6'}`);
  if (thieu.length) failures.push('Thiếu mảnh sau khi tiêm: ' + thieu.join(', '));

  // ── 2. Chuyển màn hình kiểu SPA — ĐÂY LÀ TÌNH HUỐNG GÂY LỖI ──────────
  // pushState giữ nguyên tài liệu nên engine vẫn còn; maybeInject phải nhận
  // ra điều đó và KHÔNG tiêm chồng, đồng thời giữ tab ở trạng thái sẵn sàng.
  const newUrl = await tab.view.webContents.executeJavaScript('window.__doSpaNav()', true);
  await wait(1500);              // để sự kiện did-navigate-in-page tự chạy
  const ok2 = await waitFor(() => tab.ready, 8000);
  console.log(`2. Chuyển trang kiểu SPA        : ${ok2 ? '✓ vẫn sẵn sàng' : '✗ MẤT sẵn sàng'}`);
  console.log(`   (địa chỉ mới: ${newUrl.replace(/^file:\/\/.*\//, '…/')})`);
  if (!ok2) failures.push('Chuyển trang kiểu SPA xong thì tab kẹt ở "chưa sẵn sàng" — đúng lỗi cũ tái phát');

  // ── 3. Engine biến mất không báo trước — chốt chặn dò lại phải cứu ───
  await tab.view.webContents.executeJavaScript('window.__wipeEngine()', true);
  const dWiped = await tm.diagnose(tab.id);
  console.log(`3. Xoá sạch engine khỏi trang   : ${dWiped.coEngine ? '✗ xoá không thành' : '✓ đã xoá'}`);

  // KHÔNG gọi tay lần nào. Chốt chặn 3 giây phải tự nhận ra engine chết —
  // dù cờ tab.ready vẫn đang là true — rồi tiêm lại.
  const ok3 = await waitFor(async () => {
    const d = await tm.diagnose(tab.id);
    return d.coEngine === true;
  }, 15000);
  console.log(`   chốt chặn tự gắn lại         : ${ok3 ? '✓ đã tự cứu' : '✗ KHÔNG tự cứu được'}`);
  if (!ok3) failures.push('Engine mất mà chốt chặn dò lại không gắn lại được');

  // ── 3b. getBytesInUse phải báo 0 ─────────────────────────────────────
  // Engine dùng nó ở đúng một chỗ: canh hạn mức 10MB của chrome.storage, và
  // vượt ngưỡng là TỰ XOÁ dự án cũ. Bản desktop ghi ra file, không có trần đó,
  // nên báo số thật sẽ khiến engine xoá dữ liệu người dùng để lách một hạn mức
  // không tồn tại — đã gặp thật với người dùng có 427 prompt (~8,7 triệu ký tự).
  const bytes = await tab.view.webContents.executeJavaScript(
    'chrome.storage.local.getBytesInUse(null)', true
  );
  const bytesCb = await tab.view.webContents.executeJavaScript(
    'new Promise(r => chrome.storage.local.getBytesInUse(null, r))', true
  );
  const ok3b = bytes === 0 && bytesCb === 0;
  console.log(`3b. getBytesInUse báo 0          : ${ok3b ? '✓ đúng' : `✗ báo ${bytes}/${bytesCb}`}`);
  if (!ok3b) failures.push(`getBytesInUse báo ${bytes} thay vì 0 — engine sẽ tự xoá dự án cũ`);

  // ── 3b2. Trả lời KHÔNG ĐỒNG BỘ phải về được tới tiến trình chính ──────
  //
  //  Quy ước chrome.runtime.onMessage: người nghe trả về `true` nghĩa là
  //  "tôi sẽ gọi sendResponse SAU". Bản chrome-shim cũ chạy đồng bộ và trả về
  //  ngay, nên mọi câu trả lời kiểu đó MẤT TRẮNG. Ba chỗ trong engine dùng
  //  đúng kiểu đó: RUN_UI_SELFTEST, UPLOAD_IMAGES_TO_FLOW, CHECK_ASSET_NAMES.
  //
  //  Bằng chứng thật — báo cáo chẩn đoán 10:13 ngày 22/09/2026 ghi đúng hai
  //  dòng này ở chỗ đáng lẽ là bảng 6 phần tử kèm outerHTML:
  //      ──── 1. TỰ KIỂM NGAY LÚC XUẤT BÁO CÁO ────
  //      { "ok": true }
  //
  //  Bài này đăng ký một người nghe trả lời sau 300ms rồi gọi dispatch() đúng
  //  đường app dùng. Không chờ được thì result là undefined.
  await tab.view.webContents.executeJavaScript(`
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (msg && msg.action === 'KIEM_TRA_TRA_LOI_SAU') {
        setTimeout(() => sendResponse({ ok: true, bangChung: 'tra-loi-sau' }), 300);
        return true;
      }
      if (msg && msg.action === 'KIEM_TRA_TRA_LOI_NGAY') {
        sendResponse({ ok: true, bangChung: 'tra-loi-ngay' });
      }
    });
    undefined;
  `, true);

  const traSau = await tm.dispatch(tab.id, { action: 'KIEM_TRA_TRA_LOI_SAU' });
  const okSau = traSau && traSau.result && traSau.result.bangChung === 'tra-loi-sau';
  console.log(`3b2. Trả lời sau (async)         : ${okSau ? '✓ về đủ' : '✗ MẤT: ' + JSON.stringify(traSau)}`);
  if (!okSau) failures.push('sendResponse không đồng bộ bị mất — tự kiểm giao diện sẽ rỗng');

  // Trả lời ngay vẫn phải chạy như cũ, và KHÔNG được chờ hết trần thời gian.
  const t0 = Date.now();
  const traNgay = await tm.dispatch(tab.id, { action: 'KIEM_TRA_TRA_LOI_NGAY' });
  const treo = Date.now() - t0;
  const okNgay = traNgay && traNgay.result && traNgay.result.bangChung === 'tra-loi-ngay' && treo < 2000;
  console.log(`3b3. Trả lời ngay (sync)         : ${okNgay ? `✓ về đủ, ${treo}ms` : '✗ ' + JSON.stringify(traNgay) + ` (${treo}ms)`}`);
  if (!okNgay) failures.push('Trả lời đồng bộ bị hỏng hoặc bị chờ oan');

  // ── 3c. Hàm của engine phải được phơi ra cho trình đổi chế độ ────────
  // Engine bị bọc trong IIFE nên hàm của nó không nằm trên window. tabs.js
  // nối thêm một đoạn xuất BÊN TRONG lớp bọc để flow-mode.js dùng lại ĐÚNG
  // findSettingsDropdownButtonNative — cũng chính là nút engine soi để kết
  // luận "sai chế độ giao diện". Hai bên dò bằng hai bộ chọn khác nhau là
  // sinh ra cảnh đổi xong mà engine vẫn tự dừng (lỗi thật của bản 2.3.0).
  const phoi = await tab.view.webContents.executeJavaScript(`({
    timNutCaiDat: typeof window.__flowTimNutCaiDat === 'function',
    setMode: typeof window.__flowSetMode === 'function',
    getMode: typeof window.__flowGetMode === 'function'
  })`, true);
  const thieuPhoi = Object.entries(phoi).filter(([, v]) => !v).map(([k]) => k);
  console.log(`3c. Phơi hàm cho trình đổi chế độ: ${thieuPhoi.length ? '✗ thiếu ' + thieuPhoi.join(', ') : '✓ đủ cả 3'}`);
  if (thieuPhoi.length) failures.push('Không phơi được: ' + thieuPhoi.join(', '));

  // ── 3d. Trình dò cảnh báo "hoạt động bất thường" ─────────────────────
  //
  //  Đây là đường nhận biết CHÍNH XÁC nhất, và là đường duy nhất phân biệt
  //  được hai chuyện engine gộp làm một:
  //      "prompt này phạm chính sách"  ≠  "cả tài khoản đang bị chặn"
  //  Lẫn hai cái đó thì hoặc nghỉ oan 10 phút vì một prompt xấu, hoặc cắm đầu
  //  chạy tiếp đúng lúc Google đang khó chịu — đúng cảnh 0/30 xong · 30 lỗi.
  const doSach = await tab.view.webContents.executeJavaScript(
    'window.__flowDoCanhBao ? window.__flowDoCanhBao() : null', true);
  const ok3d1 = doSach && doSach.co === false;
  console.log(`3d. Trang sạch: không báo động giả: ${ok3d1 ? '✓ đúng' : '✗ BÁO NHẦM: ' + JSON.stringify(doSach)}`);
  if (!ok3d1) failures.push('Trình dò cảnh báo báo động giả trên trang không có lỗi gì');

  // Dựng đúng thẻ Flow hiện ra khi bị chặn, rồi xem có đọc ra không.
  const doBan = await tab.view.webContents.executeJavaScript(`
    (() => {
      const d = document.createElement('div');
      d.id = '__thu_canh_bao';
      d.innerHTML = '<div><span>Không thành công</span></div>' +
        '<div><span>Chúng tôi nhận thấy có hoạt động bất thường nào đó. ' +
        'Vui lòng truy cập vào Trung tâm trợ giúp để biết thêm thông tin.</span></div>';
      document.body.appendChild(d);
      const r = window.__flowDoCanhBao();
      d.remove();
      return r;
    })()
  `, true);
  const ok3d2 = doBan && doBan.co === true && /bat thuong/.test(doBan.cum || '');
  console.log(`   đọc ra thẻ bị chặn thật      : ${ok3d2 ? '✓ đọc được — "' + (doBan.cum) + '"' : '✗ KHÔNG đọc ra: ' + JSON.stringify(doBan)}`);
  if (!ok3d2) failures.push('Không đọc ra thẻ "hoạt động bất thường" của Flow');

  // Chữ bị ẩn thì người dùng không thấy, và Flow hay dựng sẵn khung thông báo
  // từ lúc trang mới tải. Đếm cả chữ ẩn là tự dừng ngay khi vừa mở tab.
  const doAn = await tab.view.webContents.executeJavaScript(`
    (() => {
      const d = document.createElement('div');
      d.style.display = 'none';
      d.innerHTML = '<span>Chúng tôi nhận thấy có hoạt động bất thường nào đó.</span>';
      document.body.appendChild(d);
      const r = window.__flowDoCanhBao();
      d.remove();
      return r;
    })()
  `, true);
  const ok3d3 = doAn && doAn.co === false;
  console.log(`   bỏ qua chữ đang bị ẩn        : ${ok3d3 ? '✓ đúng' : '✗ đếm cả chữ ẩn, sẽ tự dừng oan'}`);
  if (!ok3d3) failures.push('Trình dò cảnh báo đếm cả chữ đang bị ẩn');

  // ── 4. Không tiêm vào trang lạ ───────────────────────────────────────
  // Trang đăng nhập Google chẳng hạn — tiêm vào đó là sai.
  await tab.view.webContents.loadURL('data:text/html,<h1>trang%20la</h1>');
  await wait(4500);              // đủ dài để chốt chặn chạy ít nhất một nhịp
  const ok4 = tab.ready === false;
  console.log(`4. Trang lạ (vd trang đăng nhập): ${ok4 ? '✓ đúng, không tiêm' : '✗ tiêm nhầm vào trang lạ'}`);
  if (!ok4) failures.push('Tiêm engine vào cả trang không phải Flow');

  console.log('\n' + '─'.repeat(56));
  if (failures.length) {
    console.log(`KẾT QUẢ: ${failures.length} LỖI`);
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    console.log('\nNhật ký của TabManager:');
    logs.forEach((l) => console.log('   ' + l));
  } else {
    console.log('KẾT QUẢ: TẤT CẢ ĐỀU PASS');
  }
  console.log('─'.repeat(56) + '\n');


  tm.closeAll();
  app.exit(failures.length ? 1 : 0);
});
