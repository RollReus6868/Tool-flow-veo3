// ============================================================================
//  bam-tao-that-main.js — NÚT TẠO CHỈ NHẬN CHUỘT THẬT
//  --------------------------------------------------------------------------
//  Chạy:  xvfb-run -a npx electron --no-sandbox tests/bam-tao-that-main.js
//
//  Nhật ký 11:09 → 11:19 ngày 22/09/2026: cả bốn kiểu bấm của 2.8.4 (click,
//  chuột, Enter, Space — đều do JavaScript tạo, isTrusted = false) không ăn;
//  người dùng bấm tay thì ăn. Người dùng chỉ lại nút bằng "Chọn trên trang"
//  thì trúng LỚP BỌC <flow-generate-icon-button>, còn tệ hơn.
//
//  Bài này đi qua đúng các mảnh app dùng: flow-mode.js + flow-bam-tao.js tiêm
//  vào một WebContentsView ĐANG ẨN, bamChuotThat() của src/main/paste.js.
// ============================================================================
const { app, BaseWindow, WebContentsView } = require('electron');
const path = require('path');
const fs = require('fs');
const { bamChuotThat } = require('../src/main/paste');

const MODE = fs.readFileSync(path.join(__dirname, '..', 'src', 'inject', 'flow-mode.js'), 'utf8');
const BAM = fs.readFileSync(path.join(__dirname, '..', 'src', 'inject', 'flow-bam-tao.js'), 'utf8');
const loi = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (ten, dk, ct = '') => { console.log(`   ${dk ? '✓' : '✗'} ${ten}${ct ? ' — ' + ct : ''}`); if (!dk) loi.push(ten + (ct ? ' — ' + ct : '')); };

app.whenReady().then(async () => {
  const w = new BaseWindow({ width: 1200, height: 900, show: true })  // cửa sổ app thật luôn hiện; chỉ TAB là ẩn;
  await wait(800);                           // cho cửa sổ kịp hiện, như app thật
  const v = new WebContentsView({ webPreferences: { backgroundThrottling: false } });
  w.contentView.addChildView(v);
  v.setBounds({ x: 0, y: 0, width: 1100, height: 800 });
  v.setVisible(false);                       // tab chạy ngầm, như trong app
  const wc = v.webContents;
  await wc.loadFile(path.join(__dirname, 'fixture-bam-tao-that.html'));
  const js = (c) => wc.executeJavaScript(c, true);
  const cao = await js('innerHeight');
  ok('tab ẩn có khung nhìn thật (không 0px)', cao > 0, `cao ${cao}px`);
  const tiem = async () => { await js(MODE + '\n;undefined;'); await js('delete window.__flowBamTaoLoaded;undefined;'); await js(BAM + '\n;undefined;'); };
  const dat = async (c) => { await js(`window.__fixtureDat(${JSON.stringify(c || {})})`); await tiem(); };

  /** Đúng trình tự của main.js → INJECT_CLICK_CREATE. */
  async function bamNhuApp(selector) {
    const cb = await js(`window.__flowBamTaoChuanBi(${JSON.stringify({ selector })})`);
    if (!cb.ok) return { cb };
    const b = await bamChuotThat(wc, cb.x, cb.y);
    let kq = null;
    for (let i = 0; i < 10; i++) { await wait(500); kq = await js('window.__flowBamTaoKiem()'); if (kq.an) break; }
    return { cb, b, kq };
  }

  console.log('\n══════════ NÚT TẠO CHỈ NHẬN CHUỘT THẬT ══════════\n');

  await dat();
  const cu = await js('window.__flowBamTao({ doi: 400 })');
  ok('kiểu bấm bằng JavaScript (bản 2.8.4) KHÔNG ăn — đúng như nhật ký thật', !cu.ok && (await js('__soLanGui')) === 0,
     `ok=${cu.ok}, bị bỏ qua ${await js('__boQua')} lần`);

  await dat();
  let r = await bamNhuApp('');
  ok('chuột thật ăn, trong tab ĐANG ẨN', r.kq && r.kq.an, JSON.stringify(r.kq && { dai: r.kq.dai, the: r.kq.the }));
  ok('gửi ĐÚNG MỘT lần', (await js('__soLanGui')) === 1, `gửi ${await js('__soLanGui')} lần`);
  ok('tâm nút không bị che', r.cb.trung === true);

  await dat();
  r = await bamNhuApp('flow-generate-icon-button');
  ok('người dùng chỉ trúng LỚP BỌC → vẫn tìm xuống đúng <button>', r.cb.nut && r.cb.nut.tag === 'button', r.cb.nut && `<${r.cb.nut.tag}>`);
  ok('…và bấm ăn', r.kq && r.kq.an);

  await dat({ treMs: 3000 });
  r = await bamNhuApp('');
  ok('Flow 3 giây mới xoá chữ → vẫn nhận ra là đã ăn, không bấm thêm', r.kq && r.kq.an && (await js('__soLanGui')) === 1,
     `gửi ${await js('__soLanGui')} lần`);

  await dat({ tat: true });
  const cb = await js('window.__flowBamTaoChuanBi({})');
  ok('nút đang tắt → nói ra, không bấm', cb.ok === false && cb.wasDisabled === true);

  // main.js phải thử chuột thật TRƯỚC các kiểu bấm bằng JavaScript.
  const m = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const doan = m.slice(m.indexOf("case 'INJECT_CLICK_CREATE'"), m.indexOf("case 'INJECT_RENAME_INPUT'"));
  const a = doan.indexOf('bamChuotThat('), b2 = doan.indexOf('window.__flowBamTao ?');
  ok('main.js: bấm chuột thật đứng TRƯỚC đường cũ', a > 0 && b2 > a);

  console.log('\n' + (loi.length ? `KẾT QUẢ: ${loi.length} LỖI\n  - ` + loi.join('\n  - ') : 'KẾT QUẢ: TẤT CẢ ĐỀU PASS'));
  app.exit(loi.length ? 1 : 0);
});
