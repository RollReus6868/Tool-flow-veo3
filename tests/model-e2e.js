// ============================================================================
//  model-e2e.js — ĐƯỜNG MODEL TỪ ĐẦU TỚI CUỐI, TRONG APP THẬT
//  --------------------------------------------------------------------------
//  Chạy:  FLOW_E2E_MODEL=1 FLOW_TEST_HOST='^file:' xvfb-run -a npx electron --no-sandbox .
//
//  Khác model-main.js (chỉ thử flow-model.js trên trang): bài này chạy trong
//  main.js thật, với TabManager thật, engine thật được tiêm vào trang giả lập
//  fixture-model.html. Nó kiểm những thứ chỉ lộ ra khi các mảnh nối với nhau:
//
//    1. Engine THẬT có gửi ACQUIRE_CREATE_SLOT không (nó chỉ gửi khi giãn
//       cách > 0 — nếu main quên ép 1 giây thì cả tính năng im lặng chết).
//    2. Nhận lượt đó, main đổi đúng model trên trang.
//    3. Flow báo "unusual activity" lúc đang ở Lower Priority → main chuyển
//       sang dự phòng, KHÔNG cho cả tài khoản nghỉ; prompt mới dùng dự phòng;
//       hết giờ tránh thì quay về Lower Priority.
//    4. Đang ở model tốn credit mà vẫn bị chặn → nghỉ như chế độ an toàn cũ.
// ============================================================================

const path = require('path');

const LP = 'Veo 3.1 - Lite [Lower Priority]';
const LITE = 'Veo 3.1 - Lite';
const FAST = 'Veo 3.1 - Fast';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
function ok(ten, dk, ct = '') {
  console.log(`   ${dk ? '✓' : '✗'} ${ten}${ct ? ' — ' + ct : ''}`);
  if (!dk) failures.push(ten + (ct ? ' — ' + ct : ''));
}
async function doi(fn, ms = 20000) {
  const het = Date.now() + ms;
  while (Date.now() < het) { if (await fn()) return true; await wait(250); }
  return false;
}

exports.run = async function (x) {
  const { app, tabManager, handleEngineMessage, theoDoiAnToan, chuanBiModel, lpChan, soAnToanCua, huyNghi } = x;
  console.log('\n══════════ ĐƯỜNG MODEL TRONG APP THẬT ══════════\n');

  try {
    const tab = await tabManager.create(null, 'file://' + path.join(__dirname, 'fixture-model.html'));
    ok('engine + trình chọn model bám được vào trang giả lập', await doi(() => tab.ready));
    const wc = tab.view.webContents;
    const js = (c) => wc.executeJavaScript(c, true);
    ok('flow-model.js có mặt trong tab', await js('typeof window.__flowSetModel === "function"'));
    const modelTrang = () => js('window.__fixtureModel()');

    // ── 1. Nhận kế hoạch: chính = Lower Priority, dự phòng = Lite ─────────
    const st = await chuanBiModel(tab, {
      runMode: 'video', multiTab: true, multiTabStagger: 0,
      chonModel: { chinh: LP, duPhong: LITE, thuLaiPhut: 30 }
    });
    ok('ép giãn cách ≥ 1 giây để engine chịu xin lượt', st.multiTabStagger >= 1, `multiTabStagger=${st.multiTabStagger}`);
    ok('tab nhận kế hoạch model', !!tab.keHoachModel);

    // ── 2. Engine THẬT xin lượt → main đổi model ─────────────────────────
    //  Giao cho engine một mẻ 1 prompt. Trên trang giả lập nó không tạo ra
    //  video được, nhưng lượt xin bấm Tạo đến TRƯỚC khi dán — đủ để kiểm.
    await tabManager.dispatch(tab.id, {
      action: 'START_AUTOMATION',
      data: { prompts: ['một con mèo'], videosToCreate: [{ index: 1, text: 'một con mèo' }], settings: st }
    });
    const coLuot = await doi(() => (tab.demPromptMoi || 0) >= 1, 45000);
    ok('engine THẬT có gửi ACQUIRE_CREATE_SLOT', coLuot, `demPromptMoi=${tab.demPromptMoi}`);
    ok('...và main đổi trang sang Lower Priority', await doi(async () => (await modelTrang()) === LP, 15000),
       `trang đang: ${await modelTrang()}`);
    await tabManager.dispatch(tab.id, { action: 'STOP_AUTOMATION' });
    await wait(1500);

    // ── 3. Lower Priority bị chặn → chuyển dự phòng, KHÔNG nghỉ ──────────
    tab.busy = true;
    tab._daDemLoi = new Set();
    const t0 = Date.now();
    await theoDoiAnToan(tab, [{ index: 1, status: 'ERROR', retries: 0,
      error: 'We noticed some unusual activity. Please try again later.' }]);
    const so = soAnToanCua(tab.accountId);
    ok('không cho cả tài khoản nghỉ', !so.dangNghi);
    ok('trang đã chuyển sang dự phòng "Veo 3.1 - Lite"', (await modelTrang()) === LITE, `trang đang: ${await modelTrang()}`);
    ok('không nhầm sang Lower Priority (bẫy tiền tố)', (await modelTrang()) !== LP);
    const KHOA = tab.accountId || '(khong-ro)';
    const chan = lpChan.get(KHOA);
    ok('ghi nhận tránh Lower Priority ~30 phút', chan && Math.abs(chan.den - t0 - 30 * 60000) < 60000,
       chan ? `${Math.round((chan.den - t0) / 60000)} phút` : 'không có');
    ok('tab được thả ra (không kẹt ở trạng thái nghỉ)', !tab.nghiAnToan);

    // ── 4. Prompt mới trong giờ tránh → dự phòng; hết giờ → Lower Priority
    await handleEngineMessage({ action: 'ACQUIRE_CREATE_SLOT', gapMs: 1000 }, wc);
    ok('prompt mới trong giờ tránh: vẫn dự phòng', (await modelTrang()) === LITE);
    chan.den = Date.now() - 1;
    await handleEngineMessage({ action: 'ACQUIRE_CREATE_SLOT', gapMs: 1000 }, wc);
    ok('hết giờ tránh: prompt mới quay về Lower Priority', (await modelTrang()) === LP, `trang đang: ${await modelTrang()}`);

    // ── 5. Bị chặn lần hai → tránh gấp đôi ───────────────────────────────
    tab.busy = true;
    await theoDoiAnToan(tab, [{ index: 2, status: 'ERROR', retries: 0, error: 'unusual activity' }]);
    const chan2 = lpChan.get(KHOA);
    ok('bị lại: tránh 60 phút', chan2 && chan2.soLan === 2 && Math.round((chan2.den - Date.now()) / 60000) === 60,
       chan2 ? `lần ${chan2.soLan}, ${Math.round((chan2.den - Date.now()) / 60000)} phút` : '');

    // ── 6. Đang ở model tốn credit mà vẫn bị chặn → nghỉ như cũ ──────────
    tab.busy = true;
    await theoDoiAnToan(tab, [{ index: 3, status: 'ERROR', retries: 0, error: 'unusual activity' }]);
    ok('model tốn credit cũng bị chặn: cả tài khoản nghỉ', soAnToanCua(tab.accountId).dangNghi === true);
    ok('...và không đổi model lung tung', (await modelTrang()) === LITE);
    huyNghi(tab.accountId);

    // ── 6b. Người dùng bấm Dừng hẳn GIỮA LÚC đang đổi dự phòng ─────────
    //  Chuyển dự phòng tạm dừng tab ~6 giây rồi tự chạy lại. Nếu người dùng
    //  dừng tay trong khoảng đó mà app vẫn tự bật dậy thì là lỗi nghiêm trọng.
    chan2.den = Date.now() - 1; chan2.soLan = 0;
    soAnToanCua(tab.accountId).dangNghi = false;
    await js(`window.__fixtureDatModel(${JSON.stringify(LP)})`);
    tab.modelHienTai = LP;
    tab.busy = true;
    let daResume = false;
    const goc = tabManager.dispatch.bind(tabManager);
    tabManager.dispatch = async (id, msg) => { if (msg && msg.action === 'RESUME_AUTOMATION') daResume = true; return goc(id, msg); };
    const dangChuyen = theoDoiAnToan(tab, [{ index: 4, status: 'ERROR', retries: 0, error: 'unusual activity' }]);
    await wait(1500);
    huyNghi(tab.accountId);                 // = đúng thứ nút Dừng hẳn / Tạm dừng gọi
    await dangChuyen;
    tabManager.dispatch = goc;
    ok('dừng tay giữa lúc đổi: app KHÔNG tự chạy lại', daResume === false);

    // ── 7. Không có kế hoạch → không đụng vào model ─────────────────────
    await js(`window.__fixtureDatModel(${JSON.stringify(FAST)})`);
    await chuanBiModel(tab, { runMode: 'video', chonModel: {} });
    await handleEngineMessage({ action: 'ACQUIRE_CREATE_SLOT', gapMs: 1000 }, wc);
    ok('để trống kế hoạch: model trên trang giữ nguyên', (await modelTrang()) === FAST);
    await chuanBiModel(tab, { runMode: 'image', chonModel: { chinh: LP } });
    ok('mẻ ẢNH: không áp kế hoạch model video', tab.keHoachModel === null);
  } catch (e) {
    failures.push('Lỗi: ' + (e && e.stack || e));
  }

  console.log('\n' + '─'.repeat(58));
  if (failures.length) {
    console.log(`KẾT QUẢ: ${failures.length} LỖI`);
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  } else {
    console.log('KẾT QUẢ: TẤT CẢ ĐỀU PASS');
  }
  console.log('─'.repeat(58) + '\n');
  app.exit(failures.length ? 1 : 0);
};
