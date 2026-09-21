// ============================================================================
//  model-main.js — TRÌNH CHỌN MODEL VIDEO CÓ CHỌN ĐÚNG KHÔNG
//  --------------------------------------------------------------------------
//  Chạy:  xvfb-run -a npx electron --no-sandbox tests/model-main.js
//
//  Kiểm trên fixture-model.html, ba đời giao diện (mat / radix / tron).
//  Những thứ PHẢI đúng, vì sai cái nào cũng là sai tiền của người dùng:
//    • chọn "Veo 3.1 - Lite" KHÔNG được ra "Lite [Lower Priority]" và ngược
//      lại (tiền tố);
//    • không bấm vào thẻ kết quả nào trong lưới dù thẻ cũng ghi tên model;
//    • hộp model là nút bật-tắt: mỗi lần mở chỉ đúng MỘT cú bấm;
//    • chọn xong bảng phải đóng lại, nút mở bảng (thứ engine đọc để biết chế
//      độ Video/Image) vẫn nguyên.
// ============================================================================

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const MODE_SRC  = fs.readFileSync(path.join(__dirname, '..', 'src', 'inject', 'flow-mode.js'), 'utf8');
const MODEL_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'inject', 'flow-model.js'), 'utf8');

const failures = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function ok(ten, dk, ct = '') {
  console.log(`   ${dk ? '✓' : '✗'} ${ten}${ct ? ' — ' + ct : ''}`);
  if (!dk) failures.push(ten + (ct ? ' — ' + ct : ''));
}

let WIN = null;
const js = (code) => WIN.webContents.executeJavaScript(code, true);

async function moTrang(ui) {
  if (!WIN) {
    WIN = new BrowserWindow({ width: 1100, height: 900, show: false });
    await WIN.loadURL('file://' + path.join(__dirname, 'fixture-model.html'));
    await wait(300);
  }
  await js(`window.__fixtureSetUI(${JSON.stringify(ui)})`);
  // Tiêm y như tabs.js: flow-mode TRƯỚC, flow-model SAU, đuôi ";undefined;".
  await js(MODE_SRC + '\n;undefined;');
  await js(MODEL_SRC + '\n;undefined;');
}

async function kiem(ui) {
  console.log(`\n── Giao diện ${ui} ` + '─'.repeat(40));
  await moTrang(ui);
  ok('tiêm được flow-model.js', await js('typeof window.__flowSetModel === "function"'));

  // 1. Đọc model đang chọn
  const g = await js('window.__flowGetModel()');
  ok('đọc đúng model ban đầu', g && g.ok && g.model === 'Veo 3.1 - Fast', JSON.stringify(g));
  ok('đọc được số credit', g && g.tinDung === 10, `tinDung=${g && g.tinDung}`);
  ok('đọc xong thì đóng bảng', !(await js('window.__fixtureMo().bang')));

  // 2. Liệt kê
  const l = await js('window.__flowListModels()');
  ok('liệt kê đủ 5 model', l && l.ok && l.ds.length === 5, JSON.stringify(l && l.ds));
  ok('tên dòng Lower Priority đọc TRỌN, không cụt', l && l.ds.includes('Veo 3.1 - Lite [Lower Priority]'),
     JSON.stringify(l && l.ds));
  ok('không lẫn chữ biểu tượng "volume_up"', l && !l.ds.some((t) => /volume/i.test(t)));

  // 3. Chọn Lower Priority
  let b0 = await js('window.__soLanBamHop');
  const r1 = await js('window.__flowSetModel("Veo 3.1 - Lite [Lower Priority]")');
  ok('chọn Lower Priority: báo thành công', r1 && r1.ok && r1.daDoi, JSON.stringify(r1));
  ok('trang thật sự ở Lower Priority', (await js('window.__fixtureModel()')) === 'Veo 3.1 - Lite [Lower Priority]');
  ok('credit đọc lại = 0', r1 && r1.tinDung === 0, `tinDung=${r1 && r1.tinDung}`);
  ok('mở danh sách đúng MỘT cú bấm', (await js('window.__soLanBamHop')) - b0 === 1,
     `số cú bấm hộp = ${(await js('window.__soLanBamHop')) - b0}`);
  const mo1 = await js('window.__fixtureMo()');
  ok('chọn xong bảng và danh sách đều đóng', !mo1.bang && !mo1.ds, JSON.stringify(mo1));

  // 4. Cái bẫy tiền tố: chọn "Veo 3.1 - Lite" (tốn credit) khi đang ở Lower Priority
  const r2 = await js('window.__flowSetModel("Veo 3.1 - Lite")');
  ok('chọn "Veo 3.1 - Lite": thành công', r2 && r2.ok && r2.daDoi, JSON.stringify(r2));
  ok('KHÔNG nhầm sang Lower Priority (bẫy tiền tố)', (await js('window.__fixtureModel()')) === 'Veo 3.1 - Lite');

  // 4b. Bẫy tiền tố khi dòng Lower Priority đứng TRƯỚC dòng Lite
  await js('window.__fixtureDaoThuTu()');
  await js('window.__fixtureDatModel("Veo 3.1 - Fast")');
  const r2b = await js('window.__flowSetModel("Veo 3.1 - Lite")');
  ok('thứ tự đảo: chọn "Veo 3.1 - Lite" vẫn ra đúng Lite', r2b && r2b.ok &&
     (await js('window.__fixtureModel()')) === 'Veo 3.1 - Lite', await js('window.__fixtureModel()'));
  await js('window.__fixtureDaoThuTu()');

  // 5. Chọn lại đúng cái đang dùng: không bấm danh sách
  b0 = await js('window.__soLanBamHop');
  const r3 = await js('window.__flowSetModel("veo 3.1 – lite")');   // gạch ngang dài, chữ thường
  ok('đang đúng model thì không đổi', r3 && r3.ok && r3.daDoi === false, JSON.stringify(r3));
  ok('...và không mở danh sách', (await js('window.__soLanBamHop')) - b0 === 0);

  // 6. Model không có
  const r4 = await js('window.__flowSetModel("Veo 9 Ultra")');
  ok('model không tồn tại: báo lỗi rõ, kèm danh sách', r4 && !r4.ok && /đang có/.test(r4.lyDo || ''), r4 && r4.lyDo);
  ok('...và vẫn giữ model cũ', (await js('window.__fixtureModel()')) === 'Veo 3.1 - Lite');
  const mo4 = await js('window.__fixtureMo()');
  ok('...và đóng hết bảng', !mo4.bang && !mo4.ds, JSON.stringify(mo4));

  // 7. Không đụng vào thẻ kết quả
  ok('không bấm vào thẻ kết quả nào', (await js('window.__soLanBamMoi')) === 0,
     `số lần bấm nhầm = ${await js('window.__soLanBamMoi')}`);

  // 8. Nút mở bảng (engine đọc để biết chế độ) vẫn nói "video"
  ok('chế độ engine đọc vẫn là video', (await js('window.__flowGetMode()')) === 'video');
}

app.whenReady().then(async () => {
  try {
    for (const ui of ['mat', 'radix', 'tron']) await kiem(ui);
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
});
