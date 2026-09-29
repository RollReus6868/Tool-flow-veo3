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

    // ── 8. (2.8.7) Flow BỎ Lower Priority, người dùng còn lưu tên đó ─────
    //  Nhật ký 28/09/2026: "Flow có 4 model: Omni 1.1 Flash · Veo 3.1 - Lite ·
    //  Veo 3.1 - Fast · Veo 3.1 - Quality". Kế hoạch cũ còn ghi Lower Priority.
    //  Trước 2.8.7: app mở hộp chọn model trước mỗi prompt, báo lỗi, tới lần
    //  thứ ba mới tắt kế hoạch. Nay: đọc danh sách MỘT lần ở đầu mẻ, bỏ tên đó,
    //  nói rõ một dòng, và không đụng hộp chọn model trong suốt mẻ.
    //
    //  Bắt dòng nhật ký bằng cách nghe console.log — logToUi ghi ra đó.
    const dong = [];
    const logGoc = console.log;
    console.log = (...a) => { dong.push(a.join(' ')); logGoc(...a); };
    try {
      const conLai = await js(`window.__fixtureBoModel(${JSON.stringify(LP)})`);
      ok('trang giả lập đã bỏ Lower Priority', !conLai.includes(LP), conLai.join(' · '));
      await js(`window.__fixtureDatModel(${JSON.stringify(FAST)})`);

      const st8 = await chuanBiModel(tab, {
        runMode: 'video', multiTab: true, multiTabStagger: 0,
        chonModel: { chinh: LP, duPhong: LITE, thuLaiPhut: 30 }
      });
      ok('tên Lower Priority cũ: bỏ khỏi kế hoạch → không còn kế hoạch nào',
         tab.keHoachModel === null, JSON.stringify(tab.keHoachModel));
      ok('...không ép giãn cách vô ích', st8.multiTabStagger === 0, `multiTabStagger=${st8.multiTabStagger}`);
      ok('...nói rõ một dòng "Flow KHÔNG còn model này"',
         dong.filter((d) => /Flow KHÔNG còn model này/.test(d) && d.includes(LP)).length === 1,
         dong.filter((d) => /model/i.test(d)).slice(-3).join(' | '));
      ok('...và báo giữ nguyên model đang chọn', dong.some((d) => /giữ nguyên model đang chọn trên Flow/.test(d)));
      ok('...model trên trang không bị đụng', (await modelTrang()) === FAST, `trang đang: ${await modelTrang()}`);

      // ── 9. Model đã đúng sẵn: prompt đầu vẫn XÁC NHẬN thành lời ──────────
      //  Nhật ký 28/09 17:15: kế hoạch "chính: Veo 3.1 - Lite" rồi… không một
      //  dòng nào về model. Không phân biệt được "đã đúng" với "không chạy".
      dong.length = 0;
      const st9 = await chuanBiModel(tab, {
        runMode: 'video', multiTab: true, multiTabStagger: 0, chonModel: { chinh: FAST }
      });
      ok('kế hoạch "chính = model đang chọn" vẫn được giao', !!tab.keHoachModel);
      await tabManager.dispatch(tab.id, {
        action: 'START_AUTOMATION',
        data: { prompts: ['một con mèo'], videosToCreate: [{ index: 1, text: 'một con mèo' }], settings: st9 }
      });
      await doi(() => (tab.demPromptMoi || 0) >= 1, 45000);
      const coXacNhan = await doi(() => dong.some((d) => d.includes(`Model đang là ${FAST}`) && /đúng kế hoạch/.test(d)), 15000);
      ok('prompt đầu: ghi "Model đang là … — đúng kế hoạch"', coXacNhan,
         dong.filter((d) => /🎚/.test(d)).slice(-3).join(' | '));
      await tabManager.dispatch(tab.id, { action: 'STOP_AUTOMATION' });
      await wait(1000);

      // ── 10. (2.8.8) Nghỉ giữa thao tác — engine THẬT, trang giả lập ──────
      //  Đo bằng đồng hồ: lúc chữ thật sự vào ô nhập (đo TRONG trang) so với
      //  dòng nhật ký báo nghỉ và dòng engine ghi SAU khi dán xong. Không nghỉ
      //  thì khoảng "dán → engine đi tiếp" chỉ ~1,4 giây (engine tự chờ 600 +
      //  500 + 300 ms); nghỉ 3 giây thì phải ≥ 3 giây.
      const nhipTT = require('../src/main/nhip-thao-tac');
      const chayMe = async (min, max, cau) => {
        dong.length = 0;
        await js(`(() => {
          const ed = document.querySelector('.ProseMirror'); ed.innerHTML = '';
          window.__tDan = 0;
          if (window.__moDan) window.__moDan.disconnect();
          window.__moDan = new MutationObserver(() => {
            if (!window.__tDan && ed.innerText.trim().length) window.__tDan = Date.now();
          });
          window.__moDan.observe(ed, { childList: true, subtree: true, characterData: true });
          return true; })()`);
        // Tắt các bước phụ (khung hình, nhân vật, giọng) — mặc định engine BẬT
        // khung hình, gặp prompt không có @bắt_đầu là dừng trước khi dán.
        const st = await chuanBiModel(tab, {
          runMode: 'video', multiTab: true, multiTabStagger: 0, chonModel: {},
          keyframeSync: false, charSync: false, voiceSync: false
        });
        // Gắn đúng như hai chỗ giao việc trong main.js làm (ganNhipThaoTac).
        nhipTT.ganChoTab(tab, { nghiThaoTacBat: true, nghiThaoTacMin: min, nghiThaoTacMax: max });
        const tDong = {};
        const logGoc2 = console.log;
        console.log = (...a) => {
          const d = a.join(' ');
          if (/Nghỉ .*trước khi nhập prompt/.test(d) && !tDong.nhap) tDong.nhap = Date.now();
          if (/Nghỉ .*trước khi bấm Tạo/.test(d) && !tDong.tao) tDong.tao = Date.now();
          if (/Paste verified|Zero-width still present/.test(d) && !tDong.diTiep) tDong.diTiep = Date.now();
          logGoc(...a);
          dong.push(d);
        };
        await tabManager.dispatch(tab.id, {
          action: 'START_AUTOMATION',
          data: { prompts: [cau], videosToCreate: [{ index: 1, text: cau }], settings: st }
        });
        return { tDong, dung: () => { console.log = logGoc2; } };
      };

      const me = await chayMe(3, 3, 'một chú chó chạy trên bãi cỏ');
      await doi(() => me.tDong.diTiep, 45000);
      const tDan = await js('window.__tDan');
      me.dung();
      ok('nhật ký báo "Nghỉ … trước khi nhập prompt"', !!me.tDong.nhap);
      ok('chữ vào ô nhập SAU khoảng nghỉ trước khi nhập (≥ 2,9 s)',
         tDan && me.tDong.nhap && tDan - me.tDong.nhap >= 2900, `cách ${tDan - me.tDong.nhap} ms`);
      ok('nhật ký báo "Nghỉ … trước khi bấm Tạo"', !!me.tDong.tao);
      ok('dán xong → engine đi tiếp (tới bước bấm Tạo) sau ≥ 3 s, không phải ~1,4 s',
         tDan && me.tDong.diTiep && me.tDong.diTiep - tDan >= 3000, `cách ${me.tDong.diTiep - tDan} ms`);
      await tabManager.dispatch(tab.id, { action: 'STOP_AUTOMATION' });
      await wait(1500);

      // Bấm Dừng giữa lúc đang nghỉ dài: phải thôi nghỉ ngay, không chờ hết 30 s.
      const me2 = await chayMe(30, 30, 'một đàn chim bay qua núi');
      await doi(() => me2.tDong.nhap, 45000);
      const tHuy = Date.now();
      nhipTT.huy(tab);             // đúng lời gọi của nút Tạm dừng / Dừng trong main.js
      await doi(async () => await js('window.__tDan'), 10000);
      const tDan2 = await js('window.__tDan');
      me2.dung();
      ok('bấm Dừng lúc đang nghỉ 30 s: thôi nghỉ trong vòng 2 s',
         tDan2 && tDan2 - tHuy < 2000, tDan2 ? `sau ${tDan2 - tHuy} ms` : 'chữ không vào');
      await tabManager.dispatch(tab.id, { action: 'STOP_AUTOMATION' });
      nhipTT.huy(tab);
      nhipTT.ganChoTab(tab, {});
      await wait(1000);
    } finally {
      console.log = logGoc;
    }
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
