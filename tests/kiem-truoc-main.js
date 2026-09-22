// ============================================================================
//  kiem-truoc-main.js — SELECTOR NGƯỜI DÙNG CHỈ SAI THÌ KHÔNG ĐỂ NÓ PHÁ MẺ
//  --------------------------------------------------------------------------
//  Chạy:  xvfb-run -a npx electron --no-sandbox tests/kiem-truoc-main.js
//
//  Nhật ký 11:58 → 12:05 ngày 22/09/2026: video tạo xong, nhưng engine báo
//  "Video 1/1 bị lỗi từ Google" và không tải — vì selector người dùng chỉ cho
//  "Thẻ video / ảnh" là span.settings-summary (dòng chữ tóm tắt model trong ô
//  nhập). Bài này dựng trang giả CÙNG KHUNG Flow thật và kiểm kiemTruocKhiChay().
// ============================================================================
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { kiemTruocKhiChay, locVeoSettings, _DA_BO } = require('../src/main/kiem-truoc');

const loi = [];
const ok = (ten, dk, ct = '') => { console.log(`   ${dk ? '✓' : '✗'} ${ten}${ct ? ' — ' + ct : ''}`); if (!dk) loi.push(ten); };

app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1100, height: 800, show: false });
  await w.loadFile(path.join(__dirname, 'fixture-kiem-truoc.html'));
  const wc = w.webContents;
  const chay = async (selectors) => {
    const nk = [];
    const s = await kiemTruocKhiChay(wc, { runMode: 'video', autoDownload: true, downloadMode: 'single', selectors }, (m, c) => nk.push([m, c]));
    return { s, nk };
  };
  console.log('\n══════════ SELECTOR NGƯỜI DÙNG CHỈ — ĐÚNG HAY SAI ══════════\n');

  let r = await chay({ tile: 'span.settings-summary', promptEditor: 'div[contenteditable="true"]' });
  ok('span.settings-summary (đúng lỗi nhật ký 22/09) → BỎ', !r.s.selectors.tile);
  ok('…và nói ra trong nhật ký', r.nk.some(([m, c]) => m === 'warning' && c.includes('span.settings-summary')));
  ok('…không đụng selector khác', r.s.selectors.promptEditor === 'div[contenteditable="true"]');
  const sauF5 = locVeoSettings({ veoSettings: { a: 1, selectors: { tile: 'span.settings-summary', x: 'y' } } });
  ok('sau F5 engine đọc lại kho → selector sai vẫn bị lọc', !sauF5.veoSettings.selectors.tile && sauF5.veoSettings.selectors.x === 'y' && sauF5.veoSettings.a === 1);
  const moi = locVeoSettings({ veoSettings: { selectors: { tile: 'flow-tile-container' } } });
  ok('người dùng chỉ lại selector MỚI → không bị lọc', moi.veoSettings.selectors.tile === 'flow-tile-container');

  r = await chay({ tile: 'mat-list-item' });
  ok('mat-list-item (danh sách dự án ở thanh bên) → BỎ', !r.s.selectors.tile);

  r = await chay({ tile: 'flow-tile-container' });
  ok('flow-tile-container (đúng) → GIỮ', r.s.selectors.tile === 'flow-tile-container');

  r = await chay({ downloadBtn: 'button[aria-label="More options"]' });
  ok('"More options" khớp cả nút trong thẻ → GIỮ', r.s.selectors.downloadBtn === 'button[aria-label="More options"]');
  r = await chay({ downloadBtn: 'flow-navigation-header button' });
  ok('nút ở đầu trang, không nằm trong thẻ → BỎ', !r.s.selectors.downloadBtn);

  await wc.executeJavaScript('__luoiTrong()');
  r = await chay({ tile: '.the-cua-toi', downloadBtn: 'button.cua-toi' });
  ok('lưới trống, selector chưa khớp gì → GIỮ (không phán được)', r.s.selectors.tile === '.the-cua-toi' && r.s.selectors.downloadBtn === 'button.cua-toi');
  r = await chay({ tile: 'span.settings-summary' });
  ok('lưới trống mà vẫn trỏ vào ô nhập → vẫn BỎ', !r.s.selectors.tile);
  r = await chay({ tile: 'div[[' });
  ok('selector sai cú pháp → BỎ, không làm hỏng mẻ', !r.s.selectors.tile);

  const nk = [];
  await kiemTruocKhiChay(wc, { runMode: 'image', autoDownload: false, downloadMode: 'none' }, (m, c) => nk.push([m, c]));
  ok('bộ Ảnh "Không tự tải" → nhật ký cảnh báo rõ', nk.some(([m, c]) => m === 'warning' && c.includes('KHÔNG tự tải') && c.includes('Tải về — Ảnh')));

  console.log('\n' + (loi.length ? `KẾT QUẢ: ${loi.length} LỖI\n  - ` + loi.join('\n  - ') : 'KẾT QUẢ: TẤT CẢ ĐỀU PASS'));
  app.exit(loi.length ? 1 : 0);
});
