// ============================================================================
//  luoi-ao-main.js — TAB ẨN VẪN PHẢI THẤY THẺ ẢNH/VIDEO
//  --------------------------------------------------------------------------
//  Chạy:  FLOW_TEST_HOST='^file:' electron --no-sandbox tests/luoi-ao-main.js
//
//  Lỗi thật (2.8.1): Google đổi lưới kết quả sang cdk-virtual-scroll-viewport —
//  chỉ vẽ số thẻ vừa khung nhìn. App thu tab ẩn về 0×0, nên lưới vẽ 0 thẻ; mọi
//  tab báo "KHÔNG TÌM THẤY Thẻ video / ảnh" và không bao giờ tải được ảnh.
//  Bài này đi qua TabManager thật, với tab ẨN (người dùng đang ở màn điều
//  khiển) và tab HIỆN, rồi đếm thẻ bằng chính hàm engine dùng.
// ============================================================================
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { TabManager } = require('../src/main/tabs');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const loi = [];

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1300, height: 900, show: false });
  await win.loadURL('about:blank');
  const tm = new TabManager({
    mainWindow: win,
    session: require('electron').session.fromPartition('test:luoi-ao'),
    preloadPath: path.join(__dirname, '..', 'src', 'main', 'preload-flow.js'),
    log: () => {}, onTabsChanged: () => {}
  });
  const fx = 'file://' + path.join(__dirname, 'fixture-luoi-ao.html');

  console.log('\n══════════ TAB ẨN CÓ THẤY THẺ TRONG LƯỚI ẢO KHÔNG ══════════\n');
  // Người dùng ở màn điều khiển: vùng trình duyệt ẩn, chưa từng có kích thước.
  tm.setPaneBounds({ x: 0, y: 0, width: 0, height: 0 }, false);
  const a = await tm.create(null, fx);
  const b = await tm.create(null, fx);
  await wait(1500);

  const dem = (t) => t.view.webContents.executeJavaScript(
    `(typeof getOuterTilesNative === 'function' ? getOuterTilesNative()
      : [...document.querySelectorAll('flow-tile-container')].filter(el => el.offsetParent !== null || el.offsetWidth > 0)).length`);
  const cao = (t) => t.view.webContents.executeJavaScript('innerHeight');

  for (const [ten, t] of [['tab 1 (ẩn)', a], ['tab 2 (ẩn)', b]]) {
    const n = await dem(t), h = await cao(t);
    console.log(`${ten.padEnd(26)}: cao ${h}px, thấy ${n} thẻ ${n > 0 ? '✓' : '✗'}`);
    if (!(n > 0)) loi.push(`${ten} không thấy thẻ nào (khung cao ${h}px)`);
  }

  // Hiện tab 1 rồi ẩn lại: phải giữ khung, không co về 0.
  tm.setPaneBounds({ x: 200, y: 60, width: 1000, height: 760 }, true);
  tm.setActive(a.id); await wait(600);
  tm.setPaneBounds({ x: 0, y: 0, width: 0, height: 0 }, false); await wait(600);
  const n2 = await dem(b), h2 = await cao(b);
  console.log(`${'sau khi hiện rồi ẩn'.padEnd(26)}: cao ${h2}px, thấy ${n2} thẻ ${n2 > 0 ? '✓' : '✗'}`);
  if (!(n2 > 0)) loi.push('hiện rồi ẩn lại thì tab co về 0 thẻ');

  console.log('\n' + (loi.length ? `KẾT QUẢ: ${loi.length} LỖI\n  - ` + loi.join('\n  - ') : 'KẾT QUẢ: PASS'));
  app.exit(loi.length ? 1 : 0);
});
