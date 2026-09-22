// ============================================================================
//  bam-tao-main.js — BẤM NÚT TẠO CÓ ĂN KHÔNG, VÀ ĐÚNG MỘT LẦN
//  --------------------------------------------------------------------------
//  Chạy:  xvfb-run -a npx electron --no-sandbox tests/bam-tao-main.js
//
//  Bài này sinh ra từ nhật ký thật 10:10 → 10:14 ngày 22/09/2026:
//
//      🖱️ Create clicked (wasDisabled: false)
//      🔎 Verify: newTile=false, txtCleared=false(len=21804), newImg=false
//
//  Bấm xong mà chữ vẫn nguyên trong ô nhập, không thẻ nào mới. Cú bấm không
//  tới được chỗ Flow nghe, và hàm cũ vẫn báo ok:true nên không ai biết.
//
//  Bốn điều phải đúng, bài này canh cả bốn:
//    1. Nút chỉ nghe pointerdown / chỉ nghe keydown thì vẫn phải bấm được.
//    2. Submit ĐÚNG MỘT LẦN — không bắn cả ba kiểu một lượt.
//    3. Selector người dùng tự chỉ phải được ƯU TIÊN trước selector cứng.
//    4. Không ăn thì phải nói được VÌ SAO (đọc chữ Flow báo trên trang),
//       chứ không trả ok:true rồi để engine đi chờ thẻ tới hết 60 giây.
// ============================================================================

const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const MODE_SRC   = fs.readFileSync(path.join(__dirname, '..', 'src', 'inject', 'flow-mode.js'), 'utf8');
const BAMTAO_SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'inject', 'flow-bam-tao.js'), 'utf8');

const failures = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function ok(ten, dieuKien, chiTiet = '') {
  console.log(`   ${dieuKien ? '✓' : '✗'} ${ten}${chiTiet ? ' — ' + chiTiet : ''}`);
  if (!dieuKien) failures.push(ten + (chiTiet ? ' — ' + chiTiet : ''));
}

let WIN = null;
const js = (code) => WIN.webContents.executeJavaScript(code, true);

async function moTrang() {
  if (WIN) return;
  WIN = new BrowserWindow({ width: 1100, height: 800, show: false });
  await WIN.loadURL('file://' + path.join(__dirname, 'fixture-bam-tao.html'));
  await wait(300);
}

/** Tiêm lại y như tabs.js: flow-mode.js trước (để có __flowBamMotLan). */
async function tiem() {
  await js(MODE_SRC + '\n;undefined;');
  // flow-bam-tao.js có chốt chống tiêm chồng, nên phải mở chốt khi tiêm lại.
  await js('delete window.__flowBamTaoLoaded; undefined;');
  await js(BAMTAO_SRC + '\n;undefined;');
}

async function dat(cfg) {
  await js(`window.__fixtureDat(${JSON.stringify(cfg)})`);
  await tiem();
}

async function bam(tuyChon) {
  // doi nhỏ cho bài kiểm chạy nhanh; app thật dùng mặc định 1400ms.
  return js(`window.__flowBamTao(${JSON.stringify({ doi: 450, ...(tuyChon || {}) })})`);
}

async function chay() {
  await moTrang();

  // ── 1. Ba đời nút, mỗi đời chỉ nghe một loại sự kiện ──────────────────
  const MONG = [
    ['click',   'click', 'Angular Material nghe click'],
    ['pointer', 'chuot', 'Radix / component tự viết nghe pointerdown'],
    ['phim',    'enter', 'chỉ nghe bàn phím']
  ];

  console.log('\n── Nút chỉ nghe MỘT loại sự kiện ' + '─'.repeat(26));
  for (const [doi, kieuMong, moTa] of MONG) {
    await dat({ doi });
    const r = await bam();
    ok(`đời "${doi}" (${moTa}): bấm được`, !!(r && r.ok), r && r.error ? r.error : `kiểu=${r && r.kieu}`);
    ok(`đời "${doi}": dùng đúng kiểu bấm "${kieuMong}"`, r && r.kieu === kieuMong, `kiểu=${r && r.kieu}`);

    const soLan = await js('window.__fixtureSoLanSubmit()');
    ok(`đời "${doi}": submit ĐÚNG 1 lần`, soLan === 1, `đếm được ${soLan} lần`);

    const soThe = await js('window.__fixtureSoThe()');
    ok(`đời "${doi}": có đúng 1 thẻ chờ mới`, soThe === 1, `đếm được ${soThe} thẻ`);
  }

  // ── 2. Ưu tiên selector người dùng tự chỉ ────────────────────────────
  //  Bật nút gây nhiễu mang đúng class `generate-icon-button` mà hàm cũ tìm
  //  ĐẦU TIÊN, và nó không nghe gì cả. Không ưu tiên selector người dùng thì
  //  bấm vào đấy và chẳng có gì xảy ra — đúng cảnh 10:11:32 trong nhật ký.
  console.log('\n── Selector người dùng tự chỉ phải đi trước ' + '─'.repeat(15));
  await dat({ doi: 'click', nutNhieu: true });
  const rNhieu = await bam();
  ok('có nút gây nhiễu mà KHÔNG chỉ selector: bấm trượt (đúng như lỗi thật)',
     !(rNhieu && rNhieu.ok), `ok=${rNhieu && rNhieu.ok}`);

  await dat({ doi: 'click', nutNhieu: true });
  const rChi = await bam({ selector: 'button[aria-label="Start generation"]' });
  ok('chỉ đúng selector thì bấm được', !!(rChi && rChi.ok), rChi && rChi.error ? rChi.error : '');
  ok('...và nói rõ tìm nút bằng selector người dùng',
     rChi && rChi.via === 'selector-nguoi-dung', `via=${rChi && rChi.via}`);
  const soLanChi = await js('window.__fixtureSoLanSubmit()');
  ok('...và vẫn đúng 1 lần submit', soLanChi === 1, `đếm được ${soLanChi} lần`);

  // ── 3. Không ăn thì phải nói được vì sao ─────────────────────────────
  console.log('\n── Bấm không ăn: phải báo lỗi kèm chữ trên trang ' + '─'.repeat(10));
  await dat({ doi: 'chet', loi: 'Prompt is too long. Please shorten it.' });
  const rChet = await bam();
  ok('nút không nghe gì: trả về ok=false, KHÔNG báo thành công',
     rChet && rChet.ok === false, `ok=${rChet && rChet.ok}`);
  ok('...đã thử đủ cả bốn kiểu bấm (click, chuột, Enter, Space)',
     rChet && Array.isArray(rChet.thu) && rChet.thu.length === 4,
     `thử ${rChet && rChet.thu && rChet.thu.length} kiểu`);
  ok('...và đọc được chữ Flow báo trên trang',
     rChet && (rChet.loiTrenTrang || []).some((t) => /too long/i.test(t)),
     JSON.stringify(rChet && rChet.loiTrenTrang));
  const soLanChet = await js('window.__fixtureSoLanSubmit()');
  ok('...không submit lần nào (đúng, vì nút không nghe gì)', soLanChet === 0, `đếm được ${soLanChet}`);

  // Chữ đang bị ẩn thì KHÔNG được đọc — báo động sai còn tệ hơn không báo.
  await dat({ doi: 'chet' });
  const rAn = await bam();
  ok('chữ báo lỗi đang bị ẩn thì bỏ qua, không báo động sai',
     rAn && (rAn.loiTrenTrang || []).length === 0, JSON.stringify(rAn && rAn.loiTrenTrang));

  // ── 4. Nút đang bị Flow tắt: nói ngay, đừng bấm ba lần ──────────────
  console.log('\n── Nút đang bị tắt ' + '─'.repeat(39));
  await dat({ doi: 'tat' });
  const rTat = await bam();
  ok('nút bị tắt: báo wasDisabled và không bấm',
     rTat && rTat.ok === false && rTat.wasDisabled === true,
     `ok=${rTat && rTat.ok} wasDisabled=${rTat && rTat.wasDisabled}`);
  ok('...không thử kiểu bấm nào cả', rTat && rTat.thu === undefined, JSON.stringify(rTat && rTat.thu));

  // ── 5. Kiểm kê DOM cho báo cáo chẩn đoán ────────────────────────────
  //  Báo cáo 10:13 vô dụng vì lưới trống thì danh sách ứng viên rỗng. Kiểm kê
  //  TÊN THẺ TỰ ĐẶT vẫn nói được Google đang dùng thẻ gì, dù lưới trống.
  console.log('\n── Kiểm kê DOM ' + '─'.repeat(43));
  await dat({ doi: 'click' });
  const kk = await js('window.__flowKiemKeDOM()');
  ok('kiểm kê đọc được độ dài chữ trong ô nhập', kk && kk.doDaiChuTrongOnhap > 0, `${kk && kk.doDaiChuTrongOnhap} ký tự`);
  ok('kiểm kê có bảng "thử từng selector thẻ kết quả"',
     kk && kk.doThuTheKetQua && typeof kk.doThuTheKetQua['flow-tile-container'] === 'number',
     JSON.stringify(kk && kk.doThuTheKetQua));
  await bam();
  const kk2 = await js('window.__flowKiemKeDOM()');
  ok('sau khi submit, kiểm kê thấy thẻ flow-pending-tile',
     kk2 && kk2.theTuDat && kk2.theTuDat['flow-pending-tile'] &&
     kk2.theTuDat['flow-pending-tile'].tong === 1,
     JSON.stringify(kk2 && kk2.theTuDat));
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    await chay();
  } catch (err) {
    failures.push('NÉM LỖI: ' + (err && err.stack || err));
  }
  console.log('');
  console.log('─'.repeat(58));
  if (failures.length) {
    console.log(`KẾT QUẢ: ${failures.length} LỖI\n`);
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  } else {
    console.log('KẾT QUẢ: TẤT CẢ ĐỀU PASS');
  }
  console.log('─'.repeat(58));
  console.log('');
  app.exit(failures.length ? 1 : 0);
});
