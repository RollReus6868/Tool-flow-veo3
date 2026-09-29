// ============================================================================
//  tham-chieu-main.js — ẢNH THAM CHIẾU DÍNH TRONG Ô NHẬP (2.8.9)
//  --------------------------------------------------------------------------
//  Chạy:  xvfb-run -a npx electron --no-sandbox tests/tham-chieu-main.js
//
//  Đi qua đúng các mảnh app dùng: src/inject/flow-anh-tham-chieu.js tiêm vào
//  một WebContentsView ĐANG ẨN (như tab chạy ngầm), và goHet() của
//  src/main/anh-tham-chieu.js bấm nút ✕ bằng chuột thật qua kênh debugger.
// ============================================================================
const { app, BaseWindow, WebContentsView } = require('electron');
const path = require('path');
const fs = require('fs');
const thamChieu = require('../src/main/anh-tham-chieu');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'inject', 'flow-anh-tham-chieu.js'), 'utf8');
const loi = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (ten, dk, ct = '') => { console.log(`   ${dk ? '✓' : '✗'} ${ten}${ct ? ' — ' + ct : ''}`); if (!dk) loi.push(ten + (ct ? ' — ' + ct : '')); };

app.whenReady().then(async () => {
  const w = new BaseWindow({ width: 1200, height: 900, show: true });
  await wait(800);
  const v = new WebContentsView({ webPreferences: { backgroundThrottling: false } });
  w.contentView.addChildView(v);
  v.setBounds({ x: 0, y: 0, width: 1100, height: 800 });
  v.setVisible(false);                       // tab chạy ngầm, như trong app
  const wc = v.webContents;
  await wc.loadFile(path.join(__dirname, 'fixture-tham-chieu.html'));
  const js = (c) => wc.executeJavaScript(c, true);
  await js(SRC + '\n;undefined;');

  console.log('\n══════════ ẢNH THAM CHIẾU DÍNH TRONG Ô NHẬP ══════════\n');
  try {
    let d = await thamChieu.dem(wc);
    ok('đọc được khối ô nhập', d.ok, d.lyDo || d.khung);
    ok('ô nhập sạch: 0 ảnh (không đếm lưới kết quả, biểu tượng model, biểu tượng nhỏ)', d.so === 0, JSON.stringify(d.ds));

    await js('window.__fixtureDinhAnh()');
    d = await thamChieu.dem(wc);
    ok('dính 1 ảnh → đếm ra 1', d.so === 1, `so=${d.so}`);

    // Cú bấm do JavaScript tạo KHÔNG gỡ được — đúng như nút Tạo của Flow.
    await js(`document.querySelector('#refs .chip button').click()`);
    ok('bấm ✕ bằng JavaScript: Flow bỏ qua, ảnh vẫn còn',
      (await js('window.__fixtureSoChip()')) === 1 && (await js('window.__soLanGoGia')) === 1);

    const giaTruoc = await js('window.__soLanGoGia');
    const r1 = await thamChieu.goHet(wc);
    ok('goHet: bấm JavaScript trước (không ăn), rồi rê chuột + bấm chuột thật → gỡ sạch',
      r1.ok && r1.daGo === 1 && r1.conLai === 0 && (await js('window.__soLanGoGia')) === giaTruoc + 1, JSON.stringify(r1));
    ok('...nói ra nút đã bấm', /remove|close/i.test(r1.nut || ''), r1.nut);
    ok('...trang không còn ảnh nào', (await js('window.__fixtureSoChip()')) === 0);

    await js('window.__fixtureDinhAnh(); window.__fixtureDinhAnh();');
    const r2 = await thamChieu.goHet(wc);
    ok('dính 2 ảnh → gỡ cả 2', r2.ok && r2.daGo === 2 && (await js('window.__fixtureSoChip()')) === 0, JSON.stringify(r2));

    // Nút ✕ nhận cú bấm JavaScript: gỡ ngay, không cần chuột thật (tab ẩn vẫn gỡ được).
    await js(`window.__fixtureDinhAnh('js')`);
    const rj = await thamChieu.goHet(wc);
    ok('nút ✕ nhận JavaScript: gỡ bằng đường JavaScript', rj.ok && rj.daGo === 1 && (await js('window.__fixtureSoChip()')) === 0, JSON.stringify(rj));

    // Ảnh không có nút ✕: không bấm bừa, báo rõ.
    await js('window.__fixtureDinhAnh(false)');
    const r3 = await thamChieu.goHet(wc);
    ok('ảnh không có nút gỡ: báo không gỡ được, không bấm bừa', !r3.ok && r3.conLai === 1 && /nút gỡ/.test(r3.lyDo || ''), JSON.stringify(r3));
    ok('...ô nhập, nút Tạo, lưới kết quả không bị đụng',
      (await js(`document.querySelectorAll('[data-tile-id]').length`)) === 2 &&
      !!(await js(`document.querySelector('.generate-icon-button')`)));

    // Nút ✕ "chết": bấm thật một lần, thấy không ăn thì DỪNG, không bấm lại.
    await js(`document.querySelector('#refs').innerHTML = ''`);
    await js(`window.__fixtureDinhAnh('chet')`);
    const r4 = await thamChieu.goHet(wc);
    ok('nút ✕ không ăn: dừng sau đúng 1 cú bấm, báo "ảnh vẫn còn"',
      !r4.ok && /vẫn còn/.test(r4.lyDo || '') && (await js('window.__soLanBamChet')) === 1,
      `${JSON.stringify(r4)} · số cú bấm ${await js('window.__soLanBamChet')}`);
    await js(`document.querySelector('#refs').innerHTML = ''`);

    // Khối có nút Tạo lại ôm cả lưới kết quả → không đoán, không đếm ảnh lưới.
    await js('window.__fixtureNutTaoRaNgoai()');
    const d5 = await thamChieu.dem(wc);
    ok('nút Tạo nằm chung khối với lưới: không nhận nhầm lưới là ô nhập', !d5.ok && d5.so === 0, JSON.stringify(d5));

    // Luật gỡ theo cài đặt.
    ok('luật: mẻ thường → gỡ', thamChieu.nenGo({}) === true);
    ok('luật: Character Sync → không gỡ', thamChieu.nenGo({ charSync: true }) === false);
    ok('luật: khung hình → không gỡ', thamChieu.nenGo({ keyframeSync: true }) === false);
    ok('luật: người dùng tắt → không gỡ', thamChieu.nenGo({ goAnhThamChieu: false }) === false);
  } catch (e) {
    loi.push('Lỗi: ' + (e && e.stack || e));
  }

  console.log('\n' + '─'.repeat(58));
  if (loi.length) { console.log(`KẾT QUẢ: ${loi.length} LỖI`); loi.forEach((l, i) => console.log(`  ${i + 1}. ${l}`)); }
  else console.log('KẾT QUẢ: TẤT CẢ ĐỀU PASS');
  console.log('─'.repeat(58) + '\n');
  app.exit(loi.length ? 1 : 0);
});
