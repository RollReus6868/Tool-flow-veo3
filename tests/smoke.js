// ============================================================================
//  smoke.js — CHẠY THỬ KHÔNG CẦN MÀN HÌNH
//  --------------------------------------------------------------------------
//  Lý do phải có: người viết code không nhìn thấy giao diện. Nút bị cắt mất,
//  chữ chìm vào nền, bảng lệch cột — không thứ nào trong đó ném ra exception.
//  Script này mở app dưới Xvfb, đi qua TỪNG mục, chụp ảnh lại để xem tận mắt,
//  và quan trọng hơn: kiểm tra phần logic thuần (tách prompt, đặt tên file,
//  so độ dài prompt) bằng khẳng định thay vì nhìn bằng mắt.
// ============================================================================

const path = require('path');
const fs = require('fs');

const PANES = ['overview', 'run', 'i2v', 'accounts', 'browser', 'projects', 'logs'];

// Những khoá cài đặt mà flow-engine.js THẬT SỰ đọc. Thiếu khoá nào là engine
// lặng lẽ dùng mặc định của nó, và người dùng chỉnh trên giao diện mà không
// thấy gì đổi — kiểu lỗi không bao giờ tự lộ ra.
const SETTING_KEYS = [
  'runMode', 'aspectRatio', 'outputCount', 'pasteDelayMin', 'pasteDelayMax',
  'maxRetries', 'randomScroll', 'addIndex', 'charSync', 'charSyncStripTag',
  'keyframeSync', 'voiceSync', 'voiceSelect', 'autoRename', 'renameMode',
  'renameStartIndex', 'renameCustomList', 'renameMaxLen', 'renameIndexPad',
  'renamePrefix', 'renameSuffix', 'asciiMode', 'autoDownload', 'downloadZip',
  'downloadQuality', 'downloadImmediately', 'downloadSubfolder', 'autoShutdown',
  'zoomLevel', 'networkGuard', 'multiTabStagger',
  // multiTab: ghi chú cũ bảo engine không đọc khoá này — SAI, isMultiTab() đọc
  // nó và bảy chỗ trong engine gọi isMultiTab(). Thiếu nó thì mấy tab dùng
  // chung một tên dự án rồi ghi đè dữ liệu của nhau (lỗi thật, bản 2.4.0).
  'multiTab'
];
const SHOT_DIR = process.env.FLOW_SHOTS || path.join(__dirname, '..', 'shots');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(mainWindow, app) {
  const failures = [];
  const note = (msg) => console.log('[smoke] ' + msg);

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const wc = mainWindow.webContents;

  await wait(1200);

  // ── 1. Kiểm tra phần tử then chốt có mặt đủ không ──────────────────────
  const REQUIRED = [
    '#promptsInput', '#promptSeparator', '#btnStart', '#btnStop',
    '#btnNewTab', '#browserPane', '#logBox', '#downloadDir',
    '#progressTable', '#tabPicker',
    '#btnReinject', '#btnDiagnose',
    // Đa tài khoản
    '#accountList', '#btnAddAccount', '#newTabAccount', '#planMode',
    // Chọn dải prompt
    '#startIndex', '#endIndex', '#useCustomRange', '#customIndices',
    // Dự án, Ảnh→Video, chẩn đoán giao diện Flow
    '#projectTable', '#projectSearch', '#i2vPrompt', '#btnI2vUpload',
    '#btnUiSelftest', '#voiceSelect', '#autoScrollLogs',
    // Cài đặt gộp vào cùng mục Prompt, chia đôi màn hình
    '.split-left', '.split-right', '#randomDelay',
    // Tải về + đổi tên: MỘT BỘ RIÊNG cho video, MỘT BỘ RIÊNG cho ảnh
    '#downloadQualityVideo', '#downloadQualityImage', '#subfolderVideo', '#subfolderImage',
    '#downloadModeVideo', '#downloadModeImage',
    '#downloadImmediatelyVideo', '#downloadImmediatelyImage',
    '#autoRenameVideo', '#autoRenameImage', '#renameModeVideo', '#renameModeImage',
    '#renameIndexPadVideo', '#renameIndexPadImage', '#renameCustomListVideo', '#renameCustomListImage',
    '#asciiModeVideo', '#asciiModeImage',
    '#renamePreviewVideo', '#renamePreviewImage',
    // Đổi chế độ Flow bằng tay
    '#modeTab', '#btnModeVideo', '#btnModeImage', '#btnModeCheck', '#flowModeNow',
    // Kho ảnh Flow + sinh prompt + chuỗi ảnh→video
    '#faFrom', '#faTo', '#faPrompt', '#faTab', '#btnCheckFlowAssets', '#btnGenPrompts',
    '#chainEnabled', '#chainPrompt', '#chainNameSource', '#chainSkipIfFailed',
    // Xem trước mã ảnh: chỗ duy nhất người dùng thấy được "01" hay "001"
    // TRƯỚC khi chạy. Thiếu nó là lại phải chờ hết mẻ ảnh mới biết lệch.
    '#chainNamePreview',
    // Tiến độ từng tab + hộp thoại tự làm
    '#tabProgress', '#tabProgSummary', '#modalMask', '#modalInput', '#modalOk'
  ];
  const missing = await wc.executeJavaScript(
    `(${JSON.stringify(REQUIRED)}).filter(s => !document.querySelector(s))`
  );
  if (missing.length) failures.push(`Thiếu phần tử: ${missing.join(', ')}`);
  else note(`Đủ ${REQUIRED.length} phần tử then chốt`);

  // ── 2. Tách prompt — khẳng định, không nhìn bằng mắt ───────────────────
  const CASES = [
    { mode: 'line',  input: 'a\nb\nc',                    expect: 3 },
    { mode: 'line',  input: 'a\n\n\nb',                   expect: 2 },   // bỏ dòng rỗng
    { mode: 'blank', input: 'dòng 1\ndòng 2\n\nprompt 2', expect: 2 },
    { mode: 'dash',  input: 'p1\n---\np2\n---\np3',       expect: 3 },
    { mode: 'eq',    input: 'p1\n===\np2',                expect: 2 }
  ];
  for (const c of CASES) {
    const got = await wc.executeJavaScript(`
      (() => {
        document.querySelector('#promptSeparator').value = ${JSON.stringify(c.mode)};
        document.querySelector('#promptsInput').value = ${JSON.stringify(c.input)};
        document.querySelector('#promptsInput').dispatchEvent(new Event('input'));
        return document.querySelector('#promptCount').textContent;
      })()
    `);
    const n = parseInt(got, 10);
    if (n !== c.expect) failures.push(`Tách prompt "${c.mode}": mong ${c.expect}, nhận ${n}`);
  }
  note('Đã kiểm 5 kiểu tách prompt');

  // ── 3. Prompt dài phải đếm đúng, không bị cắt ở tầng giao diện ─────────
  const LONG = 12345;
  const counted = await wc.executeJavaScript(`
    (() => {
      const box = document.querySelector('#promptsInput');
      document.querySelector('#promptSeparator').value = 'line';
      box.value = 'X'.repeat(${LONG});
      box.dispatchEvent(new Event('input'));
      return {
        chars: document.querySelector('#promptChars').textContent,
        longest: document.querySelector('#promptLongest').textContent,
        realLen: box.value.length
      };
    })()
  `);
  if (counted.realLen !== LONG) {
    failures.push(`Ô nhập prompt cắt chữ: đưa vào ${LONG}, còn ${counted.realLen}`);
  } else {
    note(`Prompt ${LONG} ký tự giữ nguyên trong giao diện (${counted.longest})`);
  }

  // Dọn lại để ảnh chụp không dính chuỗi X dài
  await wc.executeJavaScript(`
    (() => {
      const box = document.querySelector('#promptsInput');
      box.value = 'Một chú mèo tam thể ngồi bên cửa sổ lúc hoàng hôn, ánh sáng vàng ấm\\nToàn cảnh thành phố nhìn từ trên cao vào ban đêm, đèn neon rực rỡ\\nSóng biển vỗ vào ghềnh đá, quay chậm, bọt trắng xoá';
      box.dispatchEvent(new Event('input'));
    })()
  `);

  // ── 3b. Cài đặt phải gom đủ MỌI khoá engine đọc ───────────────────────
  const thieuKhoa = await wc.executeJavaScript(`
    (() => {
      const s = window.__collectSettings();
      return ${JSON.stringify(SETTING_KEYS)}.filter(k => s[k] === undefined);
    })()
  `);
  if (thieuKhoa.length) {
    failures.push(`Cài đặt thiếu khoá engine đọc: ${thieuKhoa.join(', ')}`);
  } else {
    note(`Cài đặt gom đủ ${SETTING_KEYS.length} khoá engine đọc`);
  }

  // Chế độ ảnh phải TẮT keyframeSync/voiceSync — ở chế độ ảnh không có nút
  // giọng nói, bật lên là engine đi tìm phần tử không hề tồn tại rồi treo.
  const cheDoAnh = await wc.executeJavaScript(`
    (() => {
      const r = document.querySelector('input[name="runMode"][value="image"]');
      r.checked = true; r.dispatchEvent(new Event('change'));
      document.querySelector('#keyframeSync').checked = true;
      document.querySelector('#voiceSync').checked = true;
      const s = window.__collectSettings();
      const v = document.querySelector('input[name="runMode"][value="video"]');
      v.checked = true; v.dispatchEvent(new Event('change'));
      return { keyframeSync: s.keyframeSync, voiceSync: s.voiceSync, runMode: s.runMode };
    })()
  `);
  if (cheDoAnh.keyframeSync !== false || cheDoAnh.voiceSync !== false) {
    failures.push('Chế độ ảnh mà keyframeSync/voiceSync vẫn bật — engine sẽ đi tìm nút giọng nói không tồn tại');
  } else {
    note('Chế độ ảnh tự tắt keyframeSync/voiceSync');
  }

  // ── 3c. Danh sách số tuỳ chọn ────────────────────────────────────────
  const CASES_IDX = [
    ['1,5,9-12,20', 100, [1, 5, 9, 10, 11, 12, 20]],
    ['12-9',        100, [9, 10, 11, 12]],          // viết ngược vẫn phải hiểu
    ['5,5,5',       100, [5]],                      // trùng thì gộp
    ['1,500',        10, [1]],                      // ngoài phạm vi thì bỏ
    ['  ',          100, []]
  ];
  for (const [raw, total, mong] of CASES_IDX) {
    const got = await wc.executeJavaScript(
      `window.__parseIndexList(${JSON.stringify(raw)}, ${total})`);
    if (JSON.stringify(got) !== JSON.stringify(mong)) {
      failures.push(`Danh sách số "${raw}": mong ${JSON.stringify(mong)}, nhận ${JSON.stringify(got)}`);
    }
  }
  note('Đã kiểm 5 dạng danh sách số tuỳ chọn');

  // ── 3d. Thẻ tài khoản vẽ được ────────────────────────────────────────
  await wc.executeJavaScript(`
    window.__testAccounts([
      { id: 'a', name: 'Tài khoản chính', downloadDir: 'D:\\\\Flow\\\\Chinh', loggedIn: true },
      { id: 'b', name: 'Acc phụ 1', downloadDir: '', loggedIn: false }
    ])
  `);
  const soThe = await wc.executeJavaScript(`document.querySelectorAll('#accountList .acc').length`);
  if (soThe !== 2) failures.push(`Vẽ thẻ tài khoản: mong 2, nhận ${soThe}`);
  else note('Thẻ tài khoản vẽ đúng');


  // ── 3e. Tiến độ từng tab vẽ được, và điều khiển riêng từng tab ────────
  await wc.executeJavaScript(`
    window.__testProgress({
      perTab: [
        { tabId: 'tab1', accountName: 'Tài khoản chính', busy: true,  assigned: 20, done: 7, running: 2, failed: 1, phase: 'image' },
        { tabId: 'tab2', accountName: 'Tài khoản chính', busy: true,  assigned: 20, done: 12, running: 1, failed: 0, phase: null },
        { tabId: 'tab3', accountName: 'Acc phụ 1',       busy: false, assigned: 15, done: 15, running: 0, failed: 0, phase: 'video' }
      ],
      tong: { done: 34, running: 3, failed: 1, assigned: 55 }
    })
  `);
  await wait(250);
  const soDong = await wc.executeJavaScript(`document.querySelectorAll('#tabProgress .tprow').length`);
  if (soDong !== 3) failures.push(`Tiến độ từng tab: mong 3 dòng, nhận ${soDong}`);
  else note('Tiến độ từng tab vẽ đúng 3 dòng');

  // Tab đang chạy phải có nút dừng riêng; tab rảnh phải có nút chạy tiếp.
  const nut = await wc.executeJavaScript(`
    [...document.querySelectorAll('#tabProgress .tprow')].map(r =>
      [...r.querySelectorAll('.tprow-act button')].map(b => b.textContent).join(''))
  `);
  if (!(nut[0].includes('⏹') && nut[2].includes('⏵'))) {
    failures.push('Nút điều khiển riêng từng tab sai: ' + JSON.stringify(nut));
  } else note('Mỗi tab có nút điều khiển riêng');

  // Chụp riêng khối tiến độ — nó nằm dưới tầm nhìn nên ảnh chụp mục Chạy
  // không thấy, mà đây lại đúng là thứ người dùng báo hỏng.
  await wc.executeJavaScript(`
    (() => {
      document.querySelector('.nav-item[data-pane="run"]').click();
      document.querySelector('#tabProgress').scrollIntoView({ block: 'center' });
    })()
  `);
  await wait(400);
  {
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(SHOT_DIR, 'run-tien-do-tung-tab.png'), img.toPNG());
    note('Đã chụp run-tien-do-tung-tab.png');
  }

  // Hai thẻ Tải về nay dài gấp đôi (gồm cả phần đổi tên) — phải nhìn tận mắt
  // xem có bị cắt hay dồn cục không, vì không thứ nào trong đó ném exception.
  await wc.executeJavaScript(`
    (() => {
      document.querySelector('#renamePreviewImage').scrollIntoView({ block: 'center' });
    })()
  `);
  await wait(400);
  {
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(SHOT_DIR, 'run-tai-ve-tach-doi.png'), img.toPNG());
    note('Đã chụp run-tai-ve-tach-doi.png');
  }

  // Nút "Có bản mới" trên thanh trên cùng phải ẨN khi chưa có gì mới. Lớp
  // .pill đặt display:inline-flex, lấn mất thuộc tính hidden — lỗi thật đã
  // lọt vào ảnh chụp lần đầu.
  const pillAn = await wc.executeJavaScript(`getComputedStyle(document.querySelector('#pillCapNhat')).display`);
  if (pillAn !== 'none') failures.push('Nút "Có bản mới" vẫn hiện khi chưa có bản mới (display=' + pillAn + ')');
  else note('Nút "Có bản mới" ẩn đúng khi chưa có gì mới');

  // ── 3e2. Thẻ Model video (2.8.0) ─────────────────────────────────────
  //  Điền thử một kế hoạch rồi đọc lại đúng thứ collectSettings() gửi cho
  //  tiến trình chính — sai tên khoá ở đây là cả tính năng im lặng tắt.
  const km = await wc.executeJavaScript(`
    (() => {
      const set = (id, v) => { const e = document.querySelector(id); e.value = v;
        e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); };
      set('#modelChinh', 'Veo 3.1 - Lite [Lower Priority]');
      set('#modelDuPhong', 'Veo 3.1 - Lite');
      set('#modelPhu', 'Veo 3.1 - Fast');
      set('#modelXenKe', '2');
      document.querySelector('#theModelVideo').scrollIntoView({ block: 'center' });
      return { cm: window.__collectSettings().chonModel, goiY: document.querySelector('#modelXenKeHint').textContent };
    })()
  `);
  if (!km.cm || km.cm.chinh !== 'Veo 3.1 - Lite [Lower Priority]' || km.cm.duPhong !== 'Veo 3.1 - Lite' ||
      String(km.cm.xenKeMoi) !== '2' || km.cm.phu !== 'Veo 3.1 - Fast') {
    failures.push('collectSettings().chonModel sai: ' + JSON.stringify(km.cm));
  } else note('Kế hoạch model đi đúng vào settings.chonModel');
  if (!/chính, phụ, chính, phụ/.test(km.goiY)) failures.push('Gợi ý xen kẽ sai: ' + km.goiY);
  await wait(400);
  {
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(SHOT_DIR, 'run-model-video.png'), img.toPNG());
    note('Đã chụp run-model-video.png');
  }
  // Trả về trống để các bước sau chạy như bản cũ.
  await wc.executeJavaScript(`['#modelChinh','#modelDuPhong','#modelPhu'].forEach((i) => { document.querySelector(i).value = ''; });
    document.querySelector('#modelXenKe').value = '0'; true`);

  // ── 3e3. Thẻ Cập nhật (2.8.0): vẽ trạng thái "đang tải" và "sẵn sàng cài"
  const cn = await wc.executeJavaScript(`
    (() => {
      try { veCapNhat({ trangThai: 'dang-tai', phienBanHienTai: '2.8.0', phienBanMoi: '2.8.1', tienDo: 62,
                  kieu: 'tu-dong', ghiChu: 'Sửa lỗi A · Thêm tính năng B',
                  caiDat: { tuKiem: true, tuTai: true, tuCaiKhiThoat: true } }); } catch (e) { return { loi: String(e && e.stack) }; }
      const a = { pill: !document.querySelector('#pillCapNhat').hidden, cai: document.querySelector('#btnCapNhatCai').disabled };
      document.querySelector('#theCapNhat').scrollIntoView({ block: 'center' });
      return a;
    })()
  `);
  if (cn.loi) failures.push('veCapNhat ném lỗi: ' + cn.loi);
  else if (!cn.pill || !cn.cai) failures.push('Thẻ Cập nhật lúc đang tải sai: ' + JSON.stringify(cn));
  await wait(400);
  {
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(SHOT_DIR, 'run-cap-nhat-dang-tai.png'), img.toPNG());
    note('Đã chụp run-cap-nhat-dang-tai.png');
  }
  const cn2 = await wc.executeJavaScript(`
    (() => {
      veCapNhat({ trangThai: 'da-tai', phienBanHienTai: '2.8.0', phienBanMoi: '2.8.1', tienDo: 100,
                  kieu: 'tu-dong', ghiChu: 'Sửa lỗi A · Thêm tính năng B' });
      return { cai: document.querySelector('#btnCapNhatCai').disabled, chu: document.querySelector('#pillCapNhat').textContent };
    })()
  `);
  if (cn2.cai || !/2\.8\.1/.test(cn2.chu)) failures.push('Thẻ Cập nhật lúc sẵn sàng cài sai: ' + JSON.stringify(cn2));
  else note('Thẻ Cập nhật: nút Cài bật đúng lúc, nút trên thanh trên cùng hiện đúng bản');
  await wait(300);
  {
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(SHOT_DIR, 'run-cap-nhat-san-sang.png'), img.toPNG());
    note('Đã chụp run-cap-nhat-san-sang.png');
  }
  await wc.executeJavaScript(`veCapNhat({ trangThai: 'chua-kiem', phienBanHienTai: '2.8.0' }); true`);

  // ── 3e4. Chẩn đoán giao diện Flow: tự chỉ lại selector (2.8.2) ────────
  //
  //  Mục này TỪNG hỏng ngầm: engine dặn người dùng bấm "Chọn trên trang" và
  //  "Tải báo cáo .txt", mà hai nút đó không tồn tại; còn settings.selectors
  //  — khoá engine đọc để ưu tiên selector người dùng chỉ — không hề được
  //  giao diện gom. Bài này canh cả ba: có nút, vẽ đủ dòng, và selector đi
  //  ĐƯỢC vào đúng khoá engine đọc.
  const cd = await wc.executeJavaScript(`
    (() => {
      try { renderUiSelectors(); } catch (e) { return { loi: String(e && e.stack) }; }
      const box = document.querySelector('#uiSelectorBox');
      const dong  = box.querySelectorAll('[data-pick]').length;
      const oNhap = box.querySelectorAll('[data-sel]').length;

      // Gõ selector cho "tile" đúng như người dùng dán tay vào ô.
      const o = box.querySelector('[data-sel="tile"]');
      o.value = 'div[data-x="tile-moi"]';
      o.dispatchEvent(new Event('change'));

      return {
        dong, oNhap,
        coNutBaoCao: !!document.querySelector('#btnUiReport'),
        sel: window.__collectSettings().selectors
      };
    })()
  `);
  if (cd.loi) failures.push('renderUiSelectors ném lỗi: ' + cd.loi);
  else if (cd.dong !== 6 || cd.oNhap !== 6) {
    failures.push(`Mục Chẩn đoán vẽ thiếu dòng: ${cd.dong} nút chọn / ${cd.oNhap} ô nhập (phải 6/6)`);
  } else if (!cd.coNutBaoCao) {
    failures.push('Thiếu nút "Tải báo cáo .txt" — engine dặn người dùng bấm đúng nút này');
  } else if (!cd.sel || cd.sel.tile !== 'div[data-x="tile-moi"]') {
    failures.push('Selector tự chỉ KHÔNG vào settings.selectors: ' + JSON.stringify(cd.sel));
  } else note('Chẩn đoán: 6 dòng chọn phần tử, selector tự chỉ vào đúng settings.selectors');

  // Engine báo vỡ -> đi trọn đường IPC thật (main -> preload -> app) và mục
  // Chẩn đoán phải tự sáng đèn, chứ không để dòng log đỏ trôi mất.
  wc.send('ui:ui-break', { tabId: 'tab1', data: { key: 'tile', label: 'Thẻ video / ảnh', misses: 3 } });
  await wait(300);
  const vo = await wc.executeJavaScript(`
    (() => {
      document.querySelector('#theChanDoan').scrollIntoView({ block: 'center' });
      return document.querySelector('#uiHealthBox').textContent;
    })()
  `);
  if (!/Thẻ video \/ ảnh/.test(vo) || !/Chọn trên trang/.test(vo)) {
    failures.push('Sự kiện ui-break không vẽ được cảnh báo: ' + JSON.stringify(vo.slice(0, 120)));
  } else note('Engine báo vỡ giao diện thì mục Chẩn đoán tự sáng đèn');
  await wait(400);
  {
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(SHOT_DIR, 'run-chan-doan.png'), img.toPNG());
    note('Đã chụp run-chan-doan.png');
  }
  // Trả ô selector về trống để các bước sau chạy như bản cũ.
  await wc.executeJavaScript(`
    (() => {
      const o = document.querySelector('#uiSelectorBox [data-sel="tile"]');
      if (o) { o.value = ''; o.dispatchEvent(new Event('change')); }
      return true;
    })()
  `);

  // ── 3f. Sinh mã ảnh cho kho Flow ─────────────────────────────────────
  const maAnh = await wc.executeJavaScript(`
    (() => {
      const set = (id, v) => { const e = document.querySelector(id); e.value = v; e.dispatchEvent(new Event('input')); };
      set('#faFrom', 1); set('#faTo', 3); set('#faPad', 2);
      set('#faPrefix', 'anh'); set('#faSuffix', '');
      return window.__flowAssetNames();
    })()
  `);
  if (JSON.stringify(maAnh) !== JSON.stringify(['anh01', 'anh02', 'anh03'])) {
    failures.push('Sinh mã ảnh sai: ' + JSON.stringify(maAnh));
  } else note('Sinh mã ảnh từ khoảng số đúng');

  // Mã ảnh có dấu cách / gạch nối phải bị bắt: Character Sync cắt @tag ở đó.
  const xau = await wc.executeJavaScript(`window.__badNames(['ok_1','co dau cach','gach-noi','Ảnh01'])`);
  if (JSON.stringify(xau) !== JSON.stringify(['co dau cach', 'gach-noi'])) {
    failures.push('Bắt mã ảnh hỏng sai: ' + JSON.stringify(xau));
  } else note('Bắt được mã ảnh không hợp lệ');

  // ── 3f-bis. Xem trước mã ảnh cho chuỗi ảnh→video ──────────────────────
  // Bài này canh đúng lỗi người dùng gặp: app tính ra "001" trong khi kho
  // Flow đặt "01", Character Sync không bắt được ảnh nào, và chỉ lộ ra sau
  // khi cả mẻ ảnh đã chạy xong. Đi qua TRỌN đường thật — giao diện gọi IPC,
  // tiến trình chính tính bằng tenAnhTheoRename() — chứ không tính lại ở đây.
  const xemTruoc = await wc.executeJavaScript(`
    (async () => {
      const set = (id, v) => { const e = document.querySelector(id); if (!e) return;
        e.value = v; e.dispatchEvent(new Event('input')); };
      const tick = (id, v) => { const e = document.querySelector(id); if (!e) return;
        e.checked = v; e.dispatchEvent(new Event('change')); };

      set('#promptsInput', 'canh mot\\ncanh hai');
      set('#promptSeparator', 'newline');
      set('#startIndex', 1); set('#endIndex', '');
      tick('#useCustomRange', false);
      set('#renameModeImage', 'index_only');
      set('#renameIndexPadImage', 2); set('#renamePrefixImage', ''); set('#renameSuffixImage', '');
      set('#renameStartIndexImage', 1); set('#outputCount', 1);
      const rm = document.querySelector('input[name="runMode"][value="image"]');
      rm.checked = true; rm.dispatchEvent(new Event('change'));
      set('#chainPrompt', 'cho anh chuyen dong');
      set('#chainNameSource', 'auto');
      tick('#chainEnabled', true);

      await new Promise(r => setTimeout(r, 500));
      const chu = document.querySelector('#chainNamePreview').textContent;
      const goi = window.__buildChainPayload(['canh mot', 'canh hai']);
      return { chu, nameSource: goi && goi.nameSource, tuDanhSo: goi && goi.imageNames };
    })()
  `);
  {
    const loi = [];
    if (!/(^|[^0-9])01([^0-9]|$)/.test(xemTruoc.chu)) loi.push('không thấy mã "01"');
    if (/(^|[^0-9])001([^0-9]|$)/.test(xemTruoc.chu)) loi.push('vẫn hiện "001" — đúng lỗi cũ');
    if (xemTruoc.nameSource !== 'auto') loi.push('nameSource = ' + xemTruoc.nameSource);
    // Ở lối auto, giao diện KHÔNG được tự đánh số nữa: tên do tiến trình
    // chính suy từ cài đặt đổi tên, một nguồn sự thật duy nhất.
    if (xemTruoc.tuDanhSo) loi.push('giao diện vẫn tự đánh số mã ảnh');
    if (loi.length) failures.push('Xem trước mã ảnh: ' + loi.join('; ') + ` (đang hiện: ${xemTruoc.chu})`);
    else note('Xem trước mã ảnh khớp cách Flow đặt tên (01, 02 — không phải 001)');
  }

  // ── 3g. Hộp thoại tự làm (Electron không có window.prompt) ────────────
  const hopThoai = await wc.executeJavaScript(`
    (async () => {
      const p = window.__hoiChu({ title: 'Thử', value: 'Tài khoản 2' });
      await new Promise(r => setTimeout(r, 60));
      const hien = !document.querySelector('#modalMask').classList.contains('hidden');
      document.querySelector('#modalOk').click();
      return { hien, ketQua: await p };
    })()
  `);
  if (!hopThoai.hien || hopThoai.ketQua !== 'Tài khoản 2') {
    failures.push(`Hộp thoại hỏng: hiện=${hopThoai.hien}, trả về=${JSON.stringify(hopThoai.ketQua)}`);
  } else note('Hộp thoại tự làm chạy đúng (thay cho prompt() Electron không có)');


  // ── 3h. Tải về tách theo loại: chạy ảnh và chạy video lấy đúng bộ ─────
  const taiVe = await wc.executeJavaScript(`
    (() => {
      const set = (id, v) => { const e = document.querySelector(id); e.value = v; };
      set('#downloadQualityVideo', '4k');   set('#subfolderVideo', 'Video/{date}');
      set('#downloadQualityImage', 'img_1k'); set('#subfolderImage', 'Anh/{date}');

      const chon = (m) => {
        const r = document.querySelector('input[name="runMode"][value="' + m + '"]');
        r.checked = true; r.dispatchEvent(new Event('change'));
        const s = window.__collectSettings();
        return { q: s.downloadQuality, sub: s.downloadSubfolder };
      };
      const video = chon('video');
      const anh   = chon('image');
      chon('video');
      return { video, anh };
    })()
  `);
  if (taiVe.video.q !== '4k' || taiVe.anh.q !== 'img_1k') {
    failures.push('Chất lượng tải không đổi theo chế độ: ' + JSON.stringify(taiVe));
  } else if (!taiVe.video.sub.startsWith('Video/') || !taiVe.anh.sub.startsWith('Anh/')) {
    failures.push('Thư mục con không đổi theo chế độ: ' + JSON.stringify(taiVe));
  } else {
    note('Tải về tự lấy đúng bộ cài đặt theo chế độ video/ảnh');
  }

  // ── 3h-bis. Cài đặt ĐỔI TÊN cũng phải tách đôi ───────────────────────
  // Trước đây chỉ có một bộ, nên ai vừa chạy ảnh vừa chạy video phải chỉnh
  // qua chỉnh lại — và chuỗi ảnh→video thì không kịp chỉnh, mẻ video nối
  // tiếp ngay. Bài này canh đúng chỗ đó: đặt hai bộ khác hẳn nhau rồi đọc
  // lại theo từng chế độ.
  const doiTen = await wc.executeJavaScript(`
    (() => {
      const set = (id, v) => { const e = document.querySelector(id); if (e) e.value = v; };
      const tick = (id, v) => { const e = document.querySelector(id); if (e) e.checked = v; };
      set('#renameModeVideo', 'index_only'); set('#renameIndexPadVideo', 4);
      set('#renamePrefixVideo', 'VID');      set('#downloadModeVideo', 'zip');
      set('#downloadImmediatelyVideo', 'true'); tick('#autoRenameVideo', true);

      set('#renameModeImage', 'index_only'); set('#renameIndexPadImage', 2);
      set('#renamePrefixImage', '');         set('#downloadModeImage', 'single');
      set('#downloadImmediatelyImage', 'false'); tick('#autoRenameImage', false);

      const doc = (m) => {
        const s = window.__collectSettings(m);
        return { pad: s.renameIndexPad, pre: s.renamePrefix, mode: s.dlMode,
                 zip: s.downloadZip, ngay: s.downloadImmediately, doiTen: s.autoRename };
      };
      return { video: doc('video'), anh: doc('image') };
    })()
  `);
  {
    const loi = [];
    if (String(doiTen.video.pad) !== '4' || String(doiTen.anh.pad) !== '2') loi.push('số chữ số STT không tách');
    if (doiTen.video.pre !== 'VID' || doiTen.anh.pre !== '') loi.push('tiền tố không tách');
    if (!doiTen.video.zip || doiTen.anh.zip) loi.push('cách tải không tách');
    if (doiTen.video.ngay !== true || doiTen.anh.ngay !== false) loi.push('thời điểm tải không tách');
    if (doiTen.video.doiTen !== true || doiTen.anh.doiTen !== false) loi.push('tự đổi tên không tách');
    if (loi.length) failures.push('Cài đặt đổi tên chưa tách đôi: ' + loi.join('; ') + ' ' + JSON.stringify(doiTen));
    else note('Cài đặt đổi tên + cách tải tách riêng cho video và ảnh');
  }

  // ── 3h-ter. Xem trước tên file ───────────────────────────────────────
  // Ghép đủ tiền tố + số + thư mục con + đuôi. Đây là chỗ duy nhất người
  // dùng thấy được cái tên THẬT trước khi chạy.
  const xemTen = await wc.executeJavaScript(`
    (async () => { try {
      const set = (id, v) => { const e = document.querySelector(id); if (e) {
        e.value = v; e.dispatchEvent(new Event('input')); } };
      set('#promptsInput', 'canh mot\\ncanh hai');
      set('#promptSeparator', 'line');
      set('#renameModeVideo', 'index_only'); set('#renameIndexPadVideo', 3);
      set('#renamePrefixVideo', 'VID'); set('#renameSuffixVideo', '');
      set('#renameStartIndexVideo', 1); set('#subfolderVideo', '');
      set('#downloadModeVideo', 'single'); set('#outputCount', 1);
      const cb = document.querySelector('#autoRenameVideo');
      cb.checked = true; cb.dispatchEvent(new Event('input'));
      await new Promise(r => setTimeout(r, 600));
      return document.querySelector('#renamePreviewVideo').textContent;
    } catch (e) { return 'LOI: ' + (e && e.message); } })()
  `);
  if (!/VID_001\.mp4/.test(xemTen)) {
    failures.push('Xem trước tên file sai, đang hiện: ' + xemTen);
  } else note('Xem trước tên file ghép đúng tiền tố + STT + đuôi');

  // ── 3h-penta. Chuỗi ảnh→video phải tự tắt đồng bộ khung hình ─────────
  // 30/30 prompt hỏng ở bản 2.4.0 vì khoá này được giữ nguyên: nó đòi 2 thẻ
  // @ảnh, còn prompt của chuỗi chỉ có 1.
  const chuoi = await wc.executeJavaScript(`
    (() => {
      const tick = (id, v) => { const e = document.querySelector(id); if (e) {
        e.checked = v; e.dispatchEvent(new Event('change')); } };
      const set = (id, v) => { const e = document.querySelector(id); if (e) {
        e.value = v; e.dispatchEvent(new Event('input')); } };
      const r = document.querySelector('input[name="runMode"][value="video"]');
      r.checked = true; r.dispatchEvent(new Event('change'));
      tick('#keyframeSync', true);
      set('#chainPrompt', 'cho anh chuyen dong');
      tick('#chainEnabled', true);
      const bo = window.__collectSettings('video');
      return { truocKhiLoc: bo.keyframeSync, multiTab: bo.multiTab };
    })()
  `);
  {
    const loi = [];
    // Giao diện gom thô vẫn giữ nguyên lựa chọn của người dùng…
    if (chuoi.truocKhiLoc !== true) loi.push('collectSettings không giữ keyframeSync của người dùng');
    if (chuoi.multiTab !== true) loi.push('thiếu multiTab — các tab sẽ đè dự án của nhau');
    if (loi.length) failures.push('Cài đặt chuỗi: ' + loi.join('; '));
    else note('Bộ cài đặt video giữ đúng lựa chọn người dùng và có multiTab');
  }

  // ── Chế độ an toàn ────────────────────────────────────────────────────
  // Các ô này KHÔNG phải khoá engine đọc — tiến trình chính đọc, để tự cho
  // nghỉ khi Flow bắt đầu coi mình là máy. Nên phải kiểm riêng: nếu chúng
  // không tới được settings.anToan thì phần canh chừng chạy bằng mặc định
  // và người dùng chỉnh ô mà chẳng thấy gì đổi.
  const at = await wc.executeJavaScript(`
    (() => {
      const set = (id, v) => { const e = document.querySelector(id); if (e) {
        e.value = v; e.dispatchEvent(new Event('input')); } };
      const tick = (id, v) => { const e = document.querySelector(id); if (e) {
        e.checked = v; e.dispatchEvent(new Event('change')); } };
      tick('#anToanBat', true);
      set('#anToanNguong', '4');
      set('#anToanCuaSo', '7');
      set('#anToanNghi', '15');
      set('#anToanCuMoi', '25');
      tick('#anToanNhanDoi', false);
      const bo = window.__collectSettings('video');
      return bo.anToan || null;
    })()
  `);
  {
    const loi = [];
    if (!at) loi.push('settings.anToan không được gom vào cài đặt');
    else {
      if (at.bat !== true)        loi.push('mất công tắc bật/tắt');
      if (String(at.nguong) !== '4')   loi.push('ngưỡng số lỗi không tới nơi');
      if (String(at.cuaSoPhut) !== '7') loi.push('cửa sổ thời gian không tới nơi');
      if (String(at.nghiPhut) !== '15') loi.push('số phút nghỉ không tới nơi');
      if (String(at.cuMoi) !== '25')    loi.push('mốc giải lao không tới nơi');
      if (at.nhanDoi !== false)   loi.push('lựa chọn nhân đôi không tới nơi');
    }
    if (loi.length) failures.push('Chế độ an toàn: ' + loi.join('; '));
    else note('Cài đặt chế độ an toàn tới đủ tiến trình chính');
  }

  // Nút đặt nhịp hiền phải điền thật vào các ô, không chỉ đổi dòng chữ gợi ý.
  const nhipHien = await wc.executeJavaScript(`
    (async () => {
      const truoc = document.querySelector('#delayMin').value;
      document.querySelector('#btnNhipAnToan').click();
      await new Promise(r => setTimeout(r, 400));
      return {
        truoc,
        sau: document.querySelector('#delayMin').value,
        max: document.querySelector('#delayMax').value,
        cuon: document.querySelector('#randomScroll').checked,
        thuLai: document.querySelector('#maxRetries').value,
        chu: (document.querySelector('#nhipAnToanKq').textContent || '').includes('Đã đặt theo')
      };
    })()
  `);
  {
    const loi = [];
    if (!nhipHien.chu) loi.push('không báo lại đã đặt gì');
    if (!(Number(nhipHien.max) > Number(nhipHien.sau))) loi.push('giãn cách tối đa không lớn hơn tối thiểu');
    if (nhipHien.cuon !== true) loi.push('không bật cuộn trang ngẫu nhiên');
    if (!(Number(nhipHien.thuLai) <= 3)) loi.push('không hạ số lần thử lại — lúc bị chặn sẽ gõ cửa thêm');
    if (loi.length) failures.push('Nút nhịp an toàn: ' + loi.join('; '));
    else note('Nút đặt nhịp hiền điền đúng vào các ô thật');
  }
  // …còn việc TẮT là của caiDatChuoiVideo ở tiến trình chính (tests/run.js
  // canh riêng). Tách hai tầng như vậy để chỗ lọc chỉ có MỘT, không phải hai.

  // ── 3h-quater. Bỏ ô thu phóng nhưng engine vẫn phải có zoomLevel ─────
  const zoom = await wc.executeJavaScript(`
    (() => ({ oCon: !!document.querySelector('#zoomLevel'),
              giaTri: window.__collectSettings().zoomLevel }))()
  `);
  if (zoom.oCon) failures.push('Vẫn còn ô Thu phóng tab Flow trên giao diện');
  else if (!zoom.giaTri) failures.push('Bỏ ô thu phóng nhưng engine không còn nhận zoomLevel');
  else note('Đã bỏ ô thu phóng, engine vẫn nhận zoomLevel = ' + zoom.giaTri);

  // ── 3i. Ngẫu nhiên thời gian chờ ─────────────────────────────────────
  const nhip = await wc.executeJavaScript(`
    (() => {
      document.querySelector('#delayMin').value = 20;
      document.querySelector('#delayMax').value = 45;
      const doc = (bat) => {
        const c = document.querySelector('#randomDelay');
        c.checked = bat; c.dispatchEvent(new Event('change'));
        const s = window.__collectSettings();
        return [s.pasteDelayMin, s.pasteDelayMax];
      };
      return { bat: doc(true), tat: doc(false) };
    })()
  `);
  // Tắt ngẫu nhiên = hai đầu bằng nhau; engine bốc số trong [min,max] nên
  // min==max chính là chờ cố định, không cần nhánh xử lý riêng.
  if (JSON.stringify(nhip.bat) !== '[20,45]' || JSON.stringify(nhip.tat) !== '[20,20]') {
    failures.push('Ngẫu nhiên thời gian chờ sai: ' + JSON.stringify(nhip));
  } else {
    note('Ngẫu nhiên thời gian chờ bật/tắt đúng');
  }

  // ── 4. Đi qua từng mục và chụp ảnh ────────────────────────────────────
  for (const pane of PANES) {
    try {
      await wc.executeJavaScript(
        `document.querySelector('.nav-item[data-pane="${pane}"]').click()`
      );
      await wait(420);

      const active = await wc.executeJavaScript(
        `document.querySelector('#pane-${pane}').classList.contains('active')`
      );
      if (!active) failures.push(`Mục "${pane}" bấm vào mà không mở`);

      const img = await wc.capturePage();
      fs.writeFileSync(path.join(SHOT_DIR, `${pane}.png`), img.toPNG());
      note(`Đã chụp ${pane}.png`);
    } catch (err) {
      failures.push(`Mục "${pane}" lỗi: ${err.message}`);
    }
  }

  // ── 5. Bảng tiến độ có dữ liệu thì phải vẽ đúng số dòng ────────────────
  await wc.executeJavaScript(`
    (() => {
      document.querySelector('.nav-item[data-pane="overview"]').click();
      const rows = [
        { index: 1, prompt: 'Chú mèo tam thể bên cửa sổ hoàng hôn', status: 'done',    filename: '01_chu_meo_tam_the.mp4' },
        { index: 2, prompt: 'Thành phố về đêm nhìn từ trên cao',    status: 'running', filename: '' },
        { index: 3, prompt: 'Sóng biển vỗ ghềnh đá quay chậm',      status: 'error',   filename: '' },
        { index: 4, prompt: 'Rừng thông trong sương sớm',           status: 'pending', filename: '' }
      ];
      window.__testTable && window.__testTable(rows);
    })()
  `);
  await wait(300);

  {
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(SHOT_DIR, 'overview-co-du-lieu.png'), img.toPNG());
    note('Đã chụp overview-co-du-lieu.png');
  }

  // ── 6. Nhật ký phải hiện được cả 4 mức ────────────────────────────────
  await wc.executeJavaScript(`
    (() => {
      document.querySelector('.nav-item[data-pane="logs"]').click();
      window.__testLog && [
        ['info',    '📝 Đã tìm thấy ô nhập prompt, chuẩn bị bơm 12.345 ký tự'],
        ['success', '✅ Đã bơm đủ 12.345/12.345 ký tự (7 khối)'],
        ['warning', '⚠️ Mới vào 4.000/12.345 ký tự — chuyển sang bơm theo khối'],
        ['error',   '❌ Ô nhập của Flow chỉ nhận 4.000/12.345 ký tự (thiếu 8.345)']
      ].forEach(([lv, m]) => window.__testLog(lv, m, 'tab1'));
    })()
  `);
  await wait(300);

  {
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(SHOT_DIR, 'logs-co-du-lieu.png'), img.toPNG());
    note('Đã chụp logs-co-du-lieu.png');
  }

  // ── 7. Lỗi JavaScript trong renderer ──────────────────────────────────
  const jsErrors = await wc.executeJavaScript('window.__jsErrors || []');
  if (jsErrors.length) failures.push(`Renderer có ${jsErrors.length} lỗi JS: ${jsErrors.join(' | ')}`);

  // ── Kết luận ──────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(64));
  if (failures.length) {
    console.log(`KẾT QUẢ: ${failures.length} LỖI`);
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  } else {
    console.log('KẾT QUẢ: TẤT CẢ ĐỀU PASS');
  }
  console.log('Ảnh chụp nằm ở: ' + SHOT_DIR);
  console.log('─'.repeat(64) + '\n');

  app.exit(failures.length ? 1 : 0);
}

module.exports = { run };
