// ============================================================================
//  run.js — kiểm thử logic thuần, chạy bằng node, không cần Electron
//  --------------------------------------------------------------------------
//  Tầng nhanh nhất trong ba tầng kiểm thử. Chạy được trong một giây nên dùng
//  để bắt lỗi ngay khi sửa code, trước khi đụng tới hai tầng chậm hơn
//  (giao diện qua Xvfb, và đường dán prompt qua Chromium thật).
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Đọc mã nguồn để soi tĩnh. GitHub Actions trên Windows checkout ra CRLF
// (core.autocrlf), nên cắt thân hàm theo '\n}\n' sẽ trượt: indexOf trả -1 và
// slice lấy tới gần hết file — bài kiểm "không được có X trong hàm" đỏ oan,
// bài "phải có X" xanh oan. Luôn chuẩn hoá về LF trước khi cắt.
const docNguon = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8').replace(/\r\n/g, '\n');
/** Thân hàm bắt đầu bằng `dau`, tới dấu `}` đóng ở đầu dòng. Không thấy thì báo lỗi, không đoán. */
function thanHam(m, dau) {
  const i = m.indexOf(dau);
  if (i < 0) return '';
  const j = m.indexOf('\n}\n', i);
  if (j < 0) throw new Error(`không tìm thấy cuối hàm "${dau}" — mã nguồn chưa chuẩn hoá xuống dòng?`);
  return m.slice(i, j);
}

const {
  deaccentVi, normalizeForCompare, splitExtension,
  sanitizeDownloadPath, sanitizeSubfolder
} = require('../src/main/text-utils');
const { Store } = require('../src/main/store');

let pass = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (err) {
    failures.push(`${name}\n     ${err.message}`);
  }
}

// Bài kiểm bất đồng bộ (2.8.8): phần kết luận ở cuối file chờ hết mới đếm.
const choAsync = [];
function testAsync(name, fn) {
  choAsync.push(Promise.resolve().then(fn).then(
    () => { pass++; },
    (err) => { failures.push(`${name}\n     ${err.message}`); }
  ));
}

// ── Bỏ dấu tiếng Việt ──────────────────────────────────────────────────────
test('Bỏ dấu giữ nguyên nghĩa', () => {
  assert.strictEqual(deaccentVi('Đường phố Hà Nội'), 'Duong pho Ha Noi');
  assert.strictEqual(deaccentVi('Chú mèo tam thể'), 'Chu meo tam the');
  assert.strictEqual(deaccentVi('ĐẸP'), 'DEP');
  assert.strictEqual(deaccentVi('sương mù nhẹ'), 'suong mu nhe');
});

test('Bỏ dấu không đụng chữ đã sạch', () => {
  assert.strictEqual(deaccentVi('Scene_01_final'), 'Scene_01_final');
});

// ── So sánh độ dài prompt ──────────────────────────────────────────────────
test('Chuẩn hoá gộp khoảng trắng để so đúng', () => {
  // Editor gộp khoảng trắng và biến xuống dòng thành ranh giới thẻ. Nếu so
  // thô thì prompt vào ĐỦ vẫn bị báo là thiếu. Đây đúng là lỗi đã mắc một lần
  // trong chính bài kiểm thử đường dán.
  assert.strictEqual(normalizeForCompare('a\n\nb'), 'a b');
  assert.strictEqual(normalizeForCompare('  a   b  '), 'a b');
  assert.strictEqual(normalizeForCompare('a\tb'), 'a b');
});

test('Chuẩn hoá không làm mất chữ có dấu', () => {
  const s = 'Đường phố Hà Nội về đêm';
  assert.strictEqual(normalizeForCompare(s), s);
});

// ── Tên file ───────────────────────────────────────────────────────────────
test('Tách phần mở rộng', () => {
  assert.deepStrictEqual(splitExtension('canh_01.mp4'), { stem: 'canh_01', ext: 'mp4' });
  assert.deepStrictEqual(splitExtension('a/b/c.png'),   { stem: 'c',       ext: 'png' });
  assert.deepStrictEqual(splitExtension('khongcoduoi'), { stem: 'khongcoduoi', ext: '' });
});

test('Tên file bỏ ký tự Windows cấm', () => {
  const out = sanitizeDownloadPath('phim: "canh 1" <chinh>|sua?');
  assert.ok(!/[\\:*?"<>|]/.test(out), 'còn ký tự cấm trong: ' + out);
});

test('Tên file luôn bỏ dấu', () => {
  // Chromium âm thầm từ chối nhiều tên file ngoài ASCII — lỗi thật ở bản 1.6.1.
  const out = sanitizeDownloadPath('Chú mèo tam thể.mp4');
  assert.ok(!/[^\x00-\x7f]/.test(out), 'còn ký tự ngoài ASCII: ' + out);
  assert.ok(out.includes('Chu_meo') || out.includes('Chu meo'), out);
});

test('Tên trùng thiết bị của Windows được đổi', () => {
  // CON, PRN, AUX, NUL, COM1-9, LPT1-9 không đặt được làm tên file trên Windows.
  assert.notStrictEqual(sanitizeDownloadPath('CON'), 'CON');
  assert.notStrictEqual(sanitizeDownloadPath('com1'), 'com1');
});

test('Tên file không kết thúc bằng dấu chấm hay khoảng trắng', () => {
  // Windows tự cắt đuôi, dẫn tới lệch tên so với thứ app nghĩ nó đã ghi.
  assert.ok(!/[. ]$/.test(sanitizeDownloadPath('canh_01. ')));
  assert.ok(!/^\./.test(sanitizeDownloadPath('...an')));
});

test('Tên file rỗng vẫn cho ra tên dùng được', () => {
  assert.ok(sanitizeDownloadPath('   ').length > 0);
  assert.ok(sanitizeDownloadPath('///').length > 0);
});

// ── Thư mục con ────────────────────────────────────────────────────────────
test('Thẻ {date} được thay', () => {
  const out = sanitizeSubfolder('FlowVideos/{date}');
  assert.ok(/^FlowVideos\/\d{4}-\d{2}-\d{2}$/.test(out), out);
});

test('Thư mục con chặn thoát lên thư mục cha', () => {
  const out = sanitizeSubfolder('../../Windows/System32');
  assert.ok(!out.includes('..'), 'còn ".." trong: ' + out);
});

test('Thư mục con rỗng trả về rỗng', () => {
  assert.strictEqual(sanitizeSubfolder(''), '');
  assert.strictEqual(sanitizeSubfolder('   '), '');
});

// ── Kho lưu trữ ────────────────────────────────────────────────────────────
test('Store đọc ghi đúng ba kiểu khoá', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-store-'));
  const s = new Store(path.join(dir, 'd.json'));

  s.set({ a: 1, b: 'hai', c: { d: true } });

  assert.deepStrictEqual(s.get('a'), { a: 1 });
  assert.deepStrictEqual(s.get(['a', 'b']), { a: 1, b: 'hai' });
  assert.deepStrictEqual(s.get({ a: 0, zzz: 'mac dinh' }), { a: 1, zzz: 'mac dinh' });
  assert.strictEqual(s.get(null).b, 'hai');

  s.remove('a');
  assert.deepStrictEqual(s.get('a'), {});

  fs.rmSync(dir, { recursive: true, force: true });
});

test('Store ghi ra đĩa và đọc lại được', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-store-'));
  const file = path.join(dir, 'd.json');

  const s1 = new Store(file);
  s1.set({ veoSettings: { renameMaxLen: 40, prefix: 'Cảnh' } });
  s1.close();                       // ép ghi ngay, không chờ 250ms

  const s2 = new Store(file);
  assert.strictEqual(s2.get('veoSettings').veoSettings.renameMaxLen, 40);
  assert.strictEqual(s2.get('veoSettings').veoSettings.prefix, 'Cảnh');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('Store gặp file hỏng thì bắt đầu lại, không ném lỗi', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-store-'));
  const file = path.join(dir, 'd.json');
  fs.writeFileSync(file, '{ dây không phải JSON', 'utf8');

  const s = new Store(file);         // không được ném
  assert.deepStrictEqual(s.get(null), {});
  // Bản hỏng phải được giữ lại để còn cứu dữ liệu
  assert.ok(fs.readdirSync(dir).some((f) => f.includes('.hong-')));

  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Hàng đợi tên file theo tab ─────────────────────────────────────────────
test('Hàng đợi tên file tách biệt theo từng tab', () => {
  // Đây chính là lỗi "hai tab tải cùng lúc bị đổi chéo tên" của bản 1.7.0.
  const { DownloadManager } = require('../src/main/downloads');
  const dm = new DownloadManager({
    getSettings: () => ({}), findTabByWcId: () => null,
    notifyTab: () => {}, log: () => {}
  });

  dm.pushName('tab1', 'canh_01.mp4');
  dm.pushName('tab2', 'canh_99.mp4');
  dm.pushName('tab1', 'canh_02.mp4');

  assert.deepStrictEqual(dm.queueFor('tab1'), ['canh_01.mp4', 'canh_02.mp4']);
  assert.deepStrictEqual(dm.queueFor('tab2'), ['canh_99.mp4']);

  dm.clear('tab1');
  assert.deepStrictEqual(dm.queueFor('tab1'), []);
  assert.deepStrictEqual(dm.queueFor('tab2'), ['canh_99.mp4'], 'xoá tab1 không được đụng tab2');
});

test('Huỷ tên đã đặt trước chỉ gỡ đúng mục đó', () => {
  const { DownloadManager } = require('../src/main/downloads');
  const dm = new DownloadManager({
    getSettings: () => ({}), findTabByWcId: () => null,
    notifyTab: () => {}, log: () => {}
  });
  dm.pushName('tab1', 'a.mp4');
  dm.pushName('tab1', 'b.mp4');
  dm.popName('tab1', 'a.mp4');
  assert.deepStrictEqual(dm.queueFor('tab1'), ['b.mp4']);
});

test('Store bỏ thụt lề khi file lớn, và vẫn đọc lại được', () => {
  // Với 427 prompt, riêng phần thụt lề chiếm thêm hàng MB và phải ghi xuống
  // đĩa lại từ đầu sau MỖI lần lưu.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-store-'));
  const file = path.join(dir, 'd.json');

  const s = new Store(file);
  assert.strictEqual(s.prettyPrint, true, 'file nhỏ thì vẫn nên dễ đọc');

  s.set({ big: 'x'.repeat(3 * 1024 * 1024) });
  s.close();
  assert.strictEqual(s.prettyPrint, false, 'file lớn mà vẫn thụt lề');

  const s2 = new Store(file);
  assert.strictEqual(s2.get('big').big.length, 3 * 1024 * 1024, 'đọc lại bị mất dữ liệu');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('Store chỉ cảnh báo dung lượng MỘT lần', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-store-'));
  const canhBao = [];
  const s = new Store(path.join(dir, 'd.json'), (m) => canhBao.push(m));

  s.checkSize(500 * 1024 * 1024);
  s.checkSize(510 * 1024 * 1024);
  s.checkSize(520 * 1024 * 1024);
  assert.strictEqual(canhBao.length, 1, 'cảnh báo lặp lại gây nhiễu nhật ký');

  s.checkSize(10 * 1024 * 1024);      // về mức bình thường -> đặt lại
  s.checkSize(500 * 1024 * 1024);
  assert.strictEqual(canhBao.length, 2, 'sau khi về mức thường thì phải báo lại được');

  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Hợp đồng dữ liệu gửi cho engine ────────────────────────────────────────
// Đây là chỗ đã sai một lần và không có gì báo: engine nhận thiếu trường thì
// lặng lẽ ghi "No prompts to process!" rồi dừng, nhìn từ ngoài y như bấm Bắt
// đầu mà không có gì xảy ra.
const { buildJobs, splitJobs, buildStartMessage } = require('../src/main/jobs');

test('buildJobs đánh số từ 1, giữ nguyên nội dung', () => {
  const jobs = buildJobs(['một', 'hai', 'ba']);
  assert.deepStrictEqual(jobs, [
    { index: 1, text: 'một' },
    { index: 2, text: 'hai' },
    { index: 3, text: 'ba' }
  ]);
});

test('splitJobs chia liên tiếp, phần dư dồn cho tab đầu', () => {
  const jobs = buildJobs(Array.from({ length: 7 }, (_, i) => 'p' + (i + 1)));
  const parts = splitJobs(jobs, 3);

  assert.strictEqual(parts.length, 3);
  assert.deepStrictEqual(parts.map((p) => p.length), [3, 2, 2]);

  // Liên tiếp, không xen kẽ: tab đầu phải nhận 1,2,3 chứ không phải 1,4,7
  assert.deepStrictEqual(parts[0].map((j) => j.index), [1, 2, 3]);
  assert.deepStrictEqual(parts[1].map((j) => j.index), [4, 5]);
  assert.deepStrictEqual(parts[2].map((j) => j.index), [6, 7]);
});

test('splitJobs không tạo phần rỗng khi tab nhiều hơn prompt', () => {
  const parts = splitJobs(buildJobs(['a', 'b']), 5);
  assert.strictEqual(parts.length, 2);
  assert.ok(parts.every((p) => p.length > 0));
});

test('splitJobs với danh sách rỗng trả về rỗng', () => {
  assert.deepStrictEqual(splitJobs(buildJobs([]), 3), []);
});

test('Không sót prompt nào khi chia', () => {
  const prompts = Array.from({ length: 427 }, (_, i) => 'prompt ' + (i + 1));
  const parts = splitJobs(buildJobs(prompts), 4);
  const all = parts.flat().map((j) => j.index);
  assert.strictEqual(all.length, 427);
  assert.deepStrictEqual(all, Array.from({ length: 427 }, (_, i) => i + 1));
});

test('buildStartMessage có ĐỦ ba trường engine đọc', () => {
  const prompts = ['một', 'hai', 'ba', 'bốn'];
  const parts = splitJobs(buildJobs(prompts), 2);
  const msg = buildStartMessage(prompts, parts[1], { renameMaxLen: 30 });

  assert.strictEqual(msg.action, 'START_AUTOMATION');
  // Thiếu bất kỳ trường nào dưới đây là engine dừng im lặng.
  assert.ok(Array.isArray(msg.data.prompts), 'thiếu data.prompts');
  assert.ok(Array.isArray(msg.data.videosToCreate), 'thiếu data.videosToCreate');
  assert.ok(msg.data.settings && typeof msg.data.settings === 'object', 'thiếu data.settings');
});

test('data.prompts phải giữ danh sách ĐẦY ĐỦ, không cắt theo tab', () => {
  // Engine tra prompts[index - 1] theo số thứ tự TOÀN CỤC. Gửi danh sách đã
  // cắt thì tab thứ hai trở đi tra nhầm ô, và tên file lệch hết.
  const prompts = ['một', 'hai', 'ba', 'bốn'];
  const parts = splitJobs(buildJobs(prompts), 2);
  const msg = buildStartMessage(prompts, parts[1], {});

  assert.strictEqual(msg.data.prompts.length, 4, 'danh sách prompt bị cắt');

  const job = msg.data.videosToCreate[0];
  assert.strictEqual(job.index, 3);
  assert.strictEqual(msg.data.prompts[job.index - 1], job.text,
    'prompts[index-1] không khớp với text của việc');
});

test('videosToCreate đúng hình dạng { index, text }', () => {
  const msg = buildStartMessage(['a', 'b'], buildJobs(['a', 'b']), {});
  for (const j of msg.data.videosToCreate) {
    assert.strictEqual(typeof j.index, 'number');
    assert.strictEqual(typeof j.text, 'string');
  }
});

// ── Chia việc cho nhiều tài khoản ──────────────────────────────────────────
const { planRun } = require('../src/main/jobs');

const TABS_2TK = [
  { id: 't1', accountId: 'a' }, { id: 't2', accountId: 'a' },
  { id: 't3', accountId: 'b' }, { id: 't4', accountId: 'b' }
];

test('Kiểu "split" chia liên tiếp cho mọi tab, bất kể tài khoản', () => {
  const ke = planRun(Array.from({ length: 8 }, (_, i) => 'p' + (i + 1)), TABS_2TK, 'split');
  assert.strictEqual(ke.length, 4);
  assert.deepStrictEqual(ke.map((k) => k.part.length), [2, 2, 2, 2]);
  assert.deepStrictEqual(ke[0].part.map((j) => j.index), [1, 2]);
});

test('Kiểu "account" chia cho tài khoản trước, rồi mới chia trong tài khoản', () => {
  const ke = planRun(Array.from({ length: 8 }, (_, i) => 'p' + (i + 1)), TABS_2TK, 'account');

  const cuaA = ke.filter((k) => k.accountId === 'a').flatMap((k) => k.part.map((j) => j.index));
  const cuaB = ke.filter((k) => k.accountId === 'b').flatMap((k) => k.part.map((j) => j.index));

  // Mỗi tài khoản ôm một dải LIỀN MẠCH — đây là điểm khác cốt lõi so với 'split'
  assert.deepStrictEqual(cuaA.sort((x, y) => x - y), [1, 2, 3, 4]);
  assert.deepStrictEqual(cuaB.sort((x, y) => x - y), [5, 6, 7, 8]);
});

test('Chia theo tài khoản không sót và không trùng prompt nào', () => {
  const prompts = Array.from({ length: 427 }, (_, i) => 'p' + (i + 1));
  const ke = planRun(prompts, TABS_2TK, 'account');
  const tatCa = ke.flatMap((k) => k.part.map((j) => j.index)).sort((x, y) => x - y);
  assert.strictEqual(tatCa.length, 427, 'sót hoặc trùng prompt');
  assert.deepStrictEqual(tatCa, Array.from({ length: 427 }, (_, i) => i + 1));
});

test('Tài khoản có nhiều tab hơn vẫn chia đúng trong nội bộ', () => {
  const tabs = [
    { id: 't1', accountId: 'a' },
    { id: 't2', accountId: 'b' }, { id: 't3', accountId: 'b' }, { id: 't4', accountId: 'b' }
  ];
  const ke = planRun(Array.from({ length: 12 }, (_, i) => 'p' + (i + 1)), tabs, 'account');

  const cuaA = ke.filter((k) => k.accountId === 'a');
  const cuaB = ke.filter((k) => k.accountId === 'b');

  // Hai tài khoản chia đôi 12 -> mỗi bên 6; bên B lại chia 6 cho 3 tab -> 2/tab
  assert.strictEqual(cuaA[0].part.length, 6);
  assert.deepStrictEqual(cuaB.map((k) => k.part.length), [2, 2, 2]);
});

test('Không tab nào nhận phần rỗng', () => {
  const ke = planRun(['một', 'hai'], TABS_2TK, 'split');
  assert.ok(ke.every((k) => k.part.length > 0));
  assert.strictEqual(ke.length, 2, 'chỉ 2 prompt thì chỉ 2 tab có việc');
});

test('Không có prompt hoặc không có tab thì kế hoạch rỗng', () => {
  assert.deepStrictEqual(planRun([], TABS_2TK, 'account'), []);
  assert.deepStrictEqual(planRun(['a'], [], 'account'), []);
});

// ── Hợp đồng dữ liệu của lệnh ảnh ──────────────────────────────────────────
// handleCheckAssetNames(payload) trong flow-engine.js đọc payload.names và đòi
// mảng CHUỖI. Đưa mảng object vào là nó trả "Chưa có tên ảnh nào để kiểm tra"
// — im lặng đúng kiểu đã làm nút Bắt đầu không làm gì.
const { buildImageNames } = require('../src/main/jobs');

test('buildImageNames cho ra mảng CHUỖI, không phải object', () => {
  const names = buildImageNames({ files: [{ name: '01.png', path: '/x/01.png' }, { name: '02.png', path: '/x/02.png' }] });
  assert.deepStrictEqual(names, ['01.png', '02.png']);
  assert.ok(names.every((n) => typeof n === 'string'), 'còn lọt object vào danh sách tên');
});

test('buildImageNames chấp nhận cả mảng chuỗi sẵn', () => {
  assert.deepStrictEqual(buildImageNames({ files: ['a.png', 'b.png'] }), ['a.png', 'b.png']);
});

test('buildImageNames bỏ mục hỏng thay vì ném lỗi', () => {
  assert.deepStrictEqual(
    buildImageNames({ files: [{ name: 'a.png' }, null, {}, { name: '' }, 'b.png'] }),
    ['a.png', 'b.png']
  );
  assert.deepStrictEqual(buildImageNames({}), []);
  assert.deepStrictEqual(buildImageNames(null), []);
});


// ── Ảnh → Video ────────────────────────────────────────────────────────────
const { buildI2vNames, invalidI2vNames, buildI2vPrompts } = require('../src/main/jobs');

test('buildI2vNames đệm số 0 và ghép tiền/hậu tố', () => {
  assert.deepStrictEqual(
    buildI2vNames({ from: 1, to: 3, pad: 2, prefix: 'anh' }),
    ['anh01', 'anh02', 'anh03']);
  assert.deepStrictEqual(
    buildI2vNames({ from: 8, to: 11, pad: 3, prefix: 'c', suffix: '_v2' }),
    ['c008_v2', 'c009_v2', 'c010_v2', 'c011_v2']);
});

test('buildI2vNames chặn khoảng vô lý', () => {
  assert.deepStrictEqual(buildI2vNames({ from: 5, to: 1 }), [], 'to < from');
  assert.deepStrictEqual(buildI2vNames({ from: 1, to: 100000 }), [], 'khoảng quá lớn');
  assert.deepStrictEqual(buildI2vNames({ from: 'x', to: 3 }), []);
});

test('invalidI2vNames bắt mã làm hỏng @tag của Character Sync', () => {
  // Dấu cách và gạch nối làm Flow cắt @tag giữa chừng rồi lấy nhầm ảnh.
  assert.deepStrictEqual(
    invalidI2vNames(['ok_1', 'Ảnh01', 'co dau cach', 'gach-noi', 'cham.png']),
    ['co dau cach', 'gach-noi', 'cham.png']);
  assert.deepStrictEqual(invalidI2vNames(['a1', 'b2']), []);
});

test('buildI2vPrompts đặt @mã ở CUỐI câu', () => {
  const p = buildI2vPrompts(['a01', 'a02'], 'cho ảnh chuyển động nhẹ');
  assert.deepStrictEqual(p, [
    'cho ảnh chuyển động nhẹ @a01',
    'cho ảnh chuyển động nhẹ @a02'
  ]);
});

test('buildI2vPrompts ưu tiên câu lệnh riêng từng ảnh', () => {
  const p = buildI2vPrompts(['a01', 'a02', 'a03'], 'chung', ['riêng 1', '', 'riêng 3']);
  assert.deepStrictEqual(p, ['riêng 1 @a01', 'chung @a02', 'riêng 3 @a03']);
});

test('buildI2vPrompts không có câu lệnh thì vẫn ra @mã hợp lệ', () => {
  assert.deepStrictEqual(buildI2vPrompts(['a01'], ''), ['@a01']);
  assert.deepStrictEqual(buildI2vPrompts(['a01'], '   '), ['@a01']);
});

test('Chuỗi ảnh→video: mỗi tab chỉ nối ĐÚNG mã ảnh của phần nó nhận', () => {
  // Đây là điều kiện để nhiều tab chạy chuỗi song song mà không lẫn ảnh.
  const prompts = Array.from({ length: 6 }, (_, i) => 'p' + (i + 1));
  const maAnh = buildI2vNames({ from: 1, to: 6, pad: 2 });      // 01..06
  const tabs = [{ id: 't1', accountId: 'a' }, { id: 't2', accountId: 'b' }];
  const ke = planRun(prompts, tabs, 'account');

  const cuaT1 = ke.find((k) => k.tabId === 't1').part.map((j) => maAnh[j.index - 1]);
  const cuaT2 = ke.find((k) => k.tabId === 't2').part.map((j) => maAnh[j.index - 1]);

  assert.deepStrictEqual(cuaT1, ['01', '02', '03']);
  assert.deepStrictEqual(cuaT2, ['04', '05', '06']);
  assert.strictEqual(new Set([...cuaT1, ...cuaT2]).size, 6, 'có mã ảnh bị trùng giữa hai tab');
});

// ── Tên ảnh Flow sẽ đặt ────────────────────────────────────────────────────
// Đây là chỗ bản 2.3.0 sai và chỉ lộ ra sau khi mẻ ảnh đã chạy xong: app in
// "(001 → 002)" trong khi kho Flow hiện "01", "02". Mọi mong đợi dưới đây lấy
// từ generateFileName() trong flow-engine.js, không phải tôi tự nghĩ ra.
const { tenAnhTheoRename } = require('../src/main/jobs');

const VIEC = (n, bd = 1) =>
  Array.from({ length: n }, (_, i) => ({ index: bd + i, text: 'canh quay ' + (bd + i) }));

test('index_only + outputCount=1 -> "01","02" chứ KHÔNG phải "001"', () => {
  const t = tenAnhTheoRename(
    { renameMode: 'index_only', renameIndexPad: 2, outputCount: 1 }, VIEC(2));
  assert.deepStrictEqual(t, ['01', '02']);
});

test('index_only mặc định pad=2 khi không khai báo', () => {
  const t = tenAnhTheoRename({ renameMode: 'index_only', outputCount: 1 }, VIEC(3));
  assert.deepStrictEqual(t, ['01', '02', '03']);
});

test('index_only ghép tiền tố và hậu tố bằng dấu gạch dưới', () => {
  const t = tenAnhTheoRename({
    renameMode: 'index_only', renameIndexPad: 3, renamePrefix: 'Canh',
    renameSuffix: 'v2', outputCount: 1
  }, VIEC(2));
  assert.deepStrictEqual(t, ['Canh_001_v2', 'Canh_002_v2']);
});

test('renameStartIndex dịch cả dải số', () => {
  const t = tenAnhTheoRename(
    { renameMode: 'index_only', renameIndexPad: 2, renameStartIndex: 10, outputCount: 1 }, VIEC(3));
  assert.deepStrictEqual(t, ['10', '11', '12']);
});

test('outputCount > 1 thì mỗi prompt sinh nhiều ảnh, có đuôi _1 _2', () => {
  const t = tenAnhTheoRename(
    { renameMode: 'index_only', renameIndexPad: 2, outputCount: 2 }, VIEC(2));
  assert.deepStrictEqual(t, ['01_1', '01_2', '02_1', '02_2']);
});

test('tên ảnh bám theo số thứ tự TOÀN CỤC, không phải vị trí trong mẻ', () => {
  // Tab 2 nhận prompt 4–6: tên phải là 04,05,06 chứ không phải 01,02,03.
  const t = tenAnhTheoRename(
    { renameMode: 'index_only', renameIndexPad: 2, outputCount: 1 }, VIEC(3, 4));
  assert.deepStrictEqual(t, ['04', '05', '06']);
});

test('số ở đầu câu lệnh được ưu tiên, đúng như engine làm', () => {
  const t = tenAnhTheoRename(
    { renameMode: 'index_only', renameIndexPad: 2, outputCount: 1 },
    [{ index: 1, text: '12) một cảnh biển' }]);
  assert.deepStrictEqual(t, ['12']);
});

test('custom_list lấy đúng dòng theo số thứ tự', () => {
  const t = tenAnhTheoRename({
    renameMode: 'custom_list', renameCustomList: 'alpha\nbeta\ngamma', outputCount: 1
  }, VIEC(3));
  assert.deepStrictEqual(t, ['alpha', 'beta', 'gamma']);
});

test('chế độ mặc định sinh tên dài — và ta phát hiện được là @tag hỏng', () => {
  const t = tenAnhTheoRename({ renameMode: 'default', renameMaxLen: 30, outputCount: 1 },
    [{ index: 1, text: 'một cảnh biển rất đẹp' }]);
  assert.strictEqual(t.length, 1);
  assert.ok(t[0].startsWith('01_'), `tên phải bắt đầu bằng "01_", đang là ${t[0]}`);
  // Chính vì thế giao diện phải cảnh báo nên dùng "Chỉ số thứ tự".
  assert.ok(t[0].length > 4);
});

test('mã ảnh sinh ra ở index_only luôn hợp cú pháp @tag', () => {
  const t = tenAnhTheoRename({
    renameMode: 'index_only', renameIndexPad: 2, renamePrefix: 'Cảnh', outputCount: 1
  }, VIEC(3));
  assert.deepStrictEqual(invalidI2vNames(t), [], `có mã sai cú pháp: ${t.join(', ')}`);
});

test('nối ảnh→video từ tên suy ra: mã trong prompt khớp tên ảnh', () => {
  const s = { renameMode: 'index_only', renameIndexPad: 2, outputCount: 1 };
  const ten = tenAnhTheoRename(s, VIEC(2));
  const p = buildI2vPrompts(ten, 'cho ảnh chuyển động nhẹ');
  assert.deepStrictEqual(p, [
    'cho ảnh chuyển động nhẹ @01',
    'cho ảnh chuyển động nhẹ @02'
  ]);
});

// ── Cài đặt cho mẻ video nối tiếp ──────────────────────────────────────────
// Lỗi thật, bản 2.4.0: người dùng bật "Đồng bộ khung hình đầu/cuối", chuỗi
// ảnh→video nối tiếp giữ nguyên khoá đó, và engine ném lỗi ở MỌI prompt —
// 30/30 hỏng, không cái nào qua được bước dán:
//     ❌ Lỗi Khung hình: Bạn cần gắn thẻ 2 ảnh (@bắt_đầu @kết_thúc) trong Prompt!
// Vì prompt của chuỗi chỉ có đúng một thẻ @mã: mỗi video dựng từ một ảnh.
const { caiDatChuoiVideo } = require('../src/main/jobs');

test('chuỗi ảnh→video TẮT đồng bộ khung hình (đòi 2 thẻ @, chuỗi chỉ có 1)', () => {
  const { settings } = caiDatChuoiVideo({ keyframeSync: true, runMode: 'image' });
  assert.strictEqual(settings.keyframeSync, false);
});

test('tắt đồng bộ khung hình thì phải NÓI ra, không sửa lén', () => {
  const { daTat } = caiDatChuoiVideo({ keyframeSync: true });
  assert.strictEqual(daTat.length, 1);
  assert.ok(/khung hình/i.test(daTat[0]), `lời nhắn khó hiểu: ${daTat[0]}`);
});

test('vốn đã tắt thì không nhắn gì cho rối', () => {
  const { daTat } = caiDatChuoiVideo({ keyframeSync: false });
  assert.deepStrictEqual(daTat, []);
});

test('chuỗi luôn ép runMode=video và charSync=true', () => {
  // charSync là thứ khiến Flow lấy đúng ảnh @mã ra dùng. Tắt thì video sinh
  // ra từ chữ, chẳng liên quan gì tới mẻ ảnh vừa tạo.
  const { settings } = caiDatChuoiVideo({ runMode: 'image', charSync: false });
  assert.strictEqual(settings.runMode, 'video');
  assert.strictEqual(settings.charSync, true);
});

test('chuỗi giữ nguyên mọi cài đặt khác của bộ Video', () => {
  const { settings } = caiDatChuoiVideo({
    downloadQuality: '1080p', downloadSubfolder: 'Video/{date}',
    renameIndexPad: 3, multiTab: true, voiceSync: true
  });
  assert.strictEqual(settings.downloadQuality, '1080p');
  assert.strictEqual(settings.downloadSubfolder, 'Video/{date}');
  assert.strictEqual(settings.renameIndexPad, 3);
  assert.strictEqual(settings.multiTab, true);
  assert.strictEqual(settings.voiceSync, true);
});

test('caiDatChuoiVideo không sửa object gốc', () => {
  const goc = { keyframeSync: true, runMode: 'image' };
  caiDatChuoiVideo(goc);
  assert.strictEqual(goc.keyframeSync, true, 'đã sửa nhầm vào object của người gọi');
  assert.strictEqual(goc.runMode, 'image');
});

test('prompt chuỗi chỉ có ĐÚNG MỘT thẻ @ — nền tảng của hai bài trên', () => {
  const ten = tenAnhTheoRename({ renameMode: 'index_only', renameIndexPad: 2, outputCount: 1 },
    [{ index: 1, text: 'a' }, { index: 2, text: 'b' }]);
  for (const p of buildI2vPrompts(ten, 'cho ảnh chuyển động')) {
    const so = (p.match(/@/g) || []).length;
    assert.strictEqual(so, 1, `prompt có ${so} thẻ @: ${p}`);
  }
});

// ── Cấu hình đóng gói .exe ─────────────────────────────────────────────────
//
//  Không build được .exe ở đây (cần Windows hoặc wine), nhưng ĐÚNG HAI thứ
//  trong cấu hình từng làm hỏng bản build, và cả hai kiểm được bằng node:
//
//   1. publish phải là null. Không đặt thì electron-builder chạy thêm bước
//      sinh metadata cập nhật rồi NGÃ với
//          Cannot read properties of null (reading 'channel')
//      NGAY SAU KHI đã ghi xong cả hai file .exe. Mã thoát khác 0 nên
//      BUILD_EXE.bat báo "BUILD THAT BAI" dù file đã nằm sẵn trong dist —
//      đúng kiểu lỗi làm người dùng tưởng build hỏng.
//
//   2. Phải có ĐỦ hai đích: nsis (bản cài) và portable (một file chạy thẳng).
//      Thiếu portable là mất đúng thứ người dùng xin: "1 file .exe hoàn chỉnh".
const PKG = require('../package.json');

test('đóng gói: publish = null để build không ngã ở bước cuối', () => {
  assert.strictEqual(PKG.build.publish, null,
    'thiếu publish:null — build sẽ báo thất bại dù .exe đã tạo xong');
});

test('đóng gói: có cả bản cài (nsis) lẫn bản một file (portable)', () => {
  const dich = PKG.build.win.target.map((t) => (typeof t === 'string' ? t : t.target));
  assert.ok(dich.includes('nsis'), 'thiếu đích nsis');
  assert.ok(dich.includes('portable'), 'thiếu đích portable — mất "1 file .exe" người dùng cần');
});

test('đóng gói: mang theo đủ mã nguồn app chạy được', () => {
  for (const f of ['main.js', 'src/**/*', 'package.json']) {
    assert.ok(PKG.build.files.includes(f), `thiếu "${f}" trong build.files`);
  }
});

test('đóng gói: tên file .exe nói rõ bản nào là bản nào', () => {
  assert.ok(/portable/.test(PKG.build.portable.artifactName));
  assert.ok(/setup/.test(PKG.build.nsis.artifactName));
});

test('đóng gói: bản cài KHÔNG xoá dữ liệu khi gỡ', () => {
  // Tài khoản, cài đặt và dự án nằm ở %APPDATA%. Gỡ app mà xoá luôn là mất
  // trắng — và người dùng thường gỡ chỉ để cài lại bản mới.
  assert.strictEqual(PKG.build.nsis.deleteAppDataOnUninstall, false);
});

test('đóng gói: bản cài cho phép chọn thư mục, không cài lén', () => {
  assert.strictEqual(PKG.build.nsis.oneClick, false);
  assert.strictEqual(PKG.build.nsis.allowToChangeInstallationDirectory, true);
});

test('script .bat cần có đủ: chạy nguồn, build, cài Node', () => {
  // Người dùng xin giữ CHAY_TU_NGUON.bat làm đường dự phòng — nếu ai đó dọn
  // nhầm thì bài này kêu ngay.
  for (const f of ['CHAY_TU_NGUON.bat', 'BUILD_EXE.bat', 'CAI_NODEJS.bat']) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', f)), `thiếu ${f}`);
  }
});

test('hai script chính đều gọi CAI_NODEJS.bat trước khi làm gì', () => {
  for (const f of ['CHAY_TU_NGUON.bat', 'BUILD_EXE.bat']) {
    const noiDung = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(/call "%HERE%CAI_NODEJS\.bat"/.test(noiDung),
      `${f} không gọi CAI_NODEJS.bat — người mới lại phải tự đi tìm Node.js`);
  }
});


// ============================================================================
//  Các file .bat — lỗi ở đây làm app KHÔNG MỞ ĐƯỢC, nên kiểm kỹ hơn cả code
//  --------------------------------------------------------------------------
//  Bản 2.5.0 vấp đúng ba cái bên dưới cùng lúc và người dùng bị kẹt ở bước
//  [1/5], màn hình đứng im không một chữ. Không có cách nào chạy .bat trong
//  bài kiểm thử này (đây là máy Linux), nên chặn ở mức đọc file — rẻ mà đủ
//  bắt lại đúng ba lỗi đó nếu ai vô tình viết lại.
// ============================================================================

const BAT = ['CAI_NODEJS.bat', 'CHAY_TU_NGUON.bat', 'BUILD_EXE.bat'];
const docBat = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('.bat: không đọc biến từ file bằng "set /p" (nguồn gốc lỗi treo 2.5.0)', () => {
  // "set /p BIEN=<file" gặp file rỗng thì KHÔNG báo lỗi — nó quay ra chờ
  // người dùng gõ phím. Màn hình đứng im, không dòng nào, nhìn hệt như treo.
  for (const f of BAT) {
    const dong = docBat(f).split(/\r?\n/)
      .filter((l) => !/^\s*REM/i.test(l) && /set\s+\/p\s+"?\w+\s*=\s*</i.test(l));
    assert.strictEqual(dong.length, 0,
      `${f} còn đọc biến từ file bằng set /p:\n       ${dong.join('\n       ')}`);
  }
});

test('.bat: không có chcp 65001 (làm hỏng chính set /p, và không cần)', () => {
  for (const f of BAT) {
    assert.ok(!/^\s*chcp\s+65001/mi.test(docBat(f)),
      `${f} còn chcp 65001 — mọi chữ trong file đều không dấu nên không cần`);
  }
});

test('.bat: xuống dòng kiểu Windows (CRLF)', () => {
  // File .bat chỉ có LF chạy chập chờn trên cmd.exe, hay gặp nhất là nhảy
  // nhầm nhãn goto. Zip giữ nguyên byte nên sai ở đây là tới tay người dùng.
  for (const f of BAT) {
    const b = fs.readFileSync(path.join(__dirname, '..', f));
    const lf = (b.toString('binary').match(/\n/g) || []).length;
    const crlf = (b.toString('binary').match(/\r\n/g) || []).length;
    assert.strictEqual(lf, crlf, `${f} có ${lf - crlf} dòng chỉ xuống bằng LF`);
  }
});

test('.bat: không có dấu ! lạc trên MỌI dòng lệnh (delayed expansion nuốt mất)', () => {
  // Bật EnableDelayedExpansion rồi thì cmd.exe ăn mất dấu "!" ở bất cứ đâu
  // trên dòng, không riêng gì lệnh echo:
  //
  //    echo [!] xong              → in ra "[] xong"
  //    7za x ... -xr!darwin -y    → 7za nhận "-xrdarwin": THAM SỐ SAI
  //
  // Cái thứ hai là lỗi thật, và nó im lặng: 7za bỏ chạy, không giải nén gì,
  // mà bước sau vẫn đi tiếp như không có chuyện gì. "^!" cũng không thoát
  // được khi dòng nằm trong khối (...). Hai cách đúng: đừng dùng "!", hoặc
  // bọc riêng dòng đó bằng setlocal DisableDelayedExpansion.
  for (const f of BAT) {
    const dong = docBat(f).split(/\r?\n/);
    let tatMoRong = false;
    for (const l of dong) {
      if (/^\s*setlocal\s+DisableDelayedExpansion/i.test(l)) { tatMoRong = true; continue; }
      if (/^\s*endlocal/i.test(l)) { tatMoRong = false; continue; }
      if (tatMoRong) continue;                        // vùng đã tắt, "!" an toàn
      if (/^\s*REM/i.test(l) || !l.trim()) continue;
      // Bỏ các cách gọi biến HỢP LỆ trước khi soi phần còn lại:
      //   !BIEN!          lấy giá trị
      //   !BIEN:~0,1!     lấy vài ký tự đầu
      //   !BIEN:a=b!      thay chuỗi
      const con = l.replace(/![A-Za-z_]\w*(?::[^!]*)?!/g, '');
      assert.ok(!con.includes('!'),
        `${f} còn dấu ! lạc, cmd.exe sẽ nuốt mất:\n       ${l.trim()}`);
    }
  }
});

test('.bat: mọi setlocal DisableDelayedExpansion đều được đóng lại', () => {
  // Quên endlocal thì từ đó tới cuối file mọi "!BIEN!" đều không nở ra nữa,
  // và các bước sau lặng lẽ chạy với biến rỗng.
  for (const f of BAT) {
    let mo = 0;
    for (const l of docBat(f).split(/\r?\n/)) {
      if (/^\s*REM/i.test(l)) continue;
      if (/^\s*setlocal\s+DisableDelayedExpansion/i.test(l)) mo++;
      else if (/^\s*endlocal/i.test(l) && mo > 0) mo--;
    }
    assert.strictEqual(mo, 0, `${f} có ${mo} setlocal DisableDelayedExpansion chưa đóng`);
  }
});

test('.bat: BUILD_EXE dựng sẵn winCodeSign, bỏ thư mục darwin của macOS', () => {
  // Lỗi thật (BUILD_LOG.txt của người dùng, bản 2.6.0):
  //   ERROR: Cannot create symbolic link : A required privilege is not held
  //          ... winCodeSign\...\darwin\10.12\lib\libcrypto.dylib
  //
  // Gói winCodeSign có đúng HAI symlink, cả hai nằm trong thư mục darwin
  // (phần cho macOS). Windows không cho tài khoản thường tạo symlink, nên
  // electron-builder giải nén thất bại — vì hai file macOS mà bản build
  // Windows không bao giờ dùng tới. Dựng sẵn cache và bỏ darwin là xong,
  // không cần quyền Administrator.
  const s = docBat('BUILD_EXE.bat');
  assert.ok(/winCodeSign-2\.6\.0/.test(s), 'không thấy tên gói winCodeSign');
  assert.ok(/-xr!darwin/.test(s), 'không thấy tham số bỏ thư mục darwin');
  assert.ok(/signtool\.exe/.test(s), 'không kiểm tra signtool.exe — thứ duy nhất cần trong gói đó');
  assert.ok(/electron-builder\\Cache\\winCodeSign/.test(s), 'không trỏ đúng thư mục cache');

  // Và dòng gọi 7za PHẢI nằm trong vùng đã tắt delayed expansion.
  const dong = s.split(/\r?\n/);
  const i = dong.findIndex((l) => /-xr!darwin/.test(l) && !/^\s*REM/i.test(l));
  assert.ok(i > 0, 'không tìm thấy dòng lệnh gọi 7za');
  const truoc = dong.slice(Math.max(0, i - 6), i).join('\n');
  assert.ok(/setlocal\s+DisableDelayedExpansion/i.test(truoc),
    'dòng gọi 7za không được bọc bởi setlocal DisableDelayedExpansion — ' +
    'dấu ! sẽ bị nuốt và 7za nhận tham số sai');
});

test('.bat: build hỏng thì vẫn thử đường lui ra bản thư mục', () => {
  // Bản thư mục (--dir) bỏ qua hẳn bước đóng gói NSIS — cũng là bước hay
  // hỏng nhất — mà vẫn cho ra app chạy được thật.
  const s = docBat('BUILD_EXE.bat');
  assert.ok(/--dir/.test(s), 'không có đường lui --dir');
  assert.ok(/win-unpacked/.test(s), 'không chỉ cho người dùng chỗ file .exe của bản thư mục');
});

test('.bat: không có dấu ngoặc chưa thoát trong lệnh echo', () => {
  // LỖI THẬT, bản 2.6.1: cửa sổ tự biến mất ở bước [4/6], nhật ký dừng ngay
  // tại dòng đó. Thủ phạm là MỘT dòng echo nằm trong khối else:
  //
  //     ) else (
  //         echo    Dang tai bo cong cu (khoang 5,6 MB)...
  //
  // Dấu ")" sau chữ MB ĐÓNG KHỐI else giữa chừng. Phần còn lại thành cú pháp
  // rác, cmd.exe bỏ chạy cả file và đóng cửa sổ ngay — không in nổi một chữ,
  // nên người dùng không có gì để gửi đi cả.
  //
  // Chỉ cấm trong khối thì vẫn còn bẫy: một dòng echo hôm nay ở ngoài, mai bị
  // chuyển vào khối là hỏng lại. Nên cấm hẳn: mọi dấu ngoặc trong chữ in ra
  // đều phải viết "^(" và "^)".
  for (const f of BAT) {
    for (const l of docBat(f).split(/\r?\n/)) {
      if (!/^\s*echo\s/i.test(l) || /^\s*REM/i.test(l)) continue;
      const t = l.replace(/"[^"]*"/g, '')          // ngoặc trong dấu nháy thì an toàn
                 .replace(/\^\(/g, '').replace(/\^\)/g, '');  // đã thoát rồi
      assert.ok(!/[()]/.test(t),
        `${f} có dấu ngoặc chưa thoát trong echo — sẽ đóng khối sớm:\n       ${l.trim()}`);
    }
  }
});

test('.bat: không nối dòng bằng ^ bên trong khối ( )', () => {
  // Cùng gốc với lỗi trên: cmd.exe đọc cả khối ( ) thành MỘT lệnh trước khi
  // chạy, và dấu ^ cuối dòng trong đó không còn đáng tin. Lệnh powershell
  // nhiều dòng của bản 2.6.1 nằm đúng trong một khối else.
  for (const f of BAT) {
    let sau = 0;
    for (const l of docBat(f).split(/\r?\n/)) {
      if (/^\s*REM/i.test(l)) continue;
      const t = l.replace(/"[^"]*"/g, '');
      if (sau > 0 && /\^\s*$/.test(l)) {
        assert.fail(`${f} nối dòng bằng ^ khi đang ở trong khối ( ):\n       ${l.trim()}`);
      }
      sau += (t.match(/\(/g) || []).length - (t.match(/\)/g) || []).length;
      if (sau < 0) sau = 0;
    }
  }
});

test('.bat: hai file chính có lớp bọc giữ cửa sổ lại khi gặp sự cố', () => {
  // Lỗi cú pháp làm cmd.exe đóng cửa sổ ngay, người dùng không đọc được gì.
  // Lớp bọc tự gọi lại chính mình trong cửa sổ con: con có chết thì cha vẫn
  // còn, mang theo dòng báo lỗi.
  for (const f of ['BUILD_EXE.bat', 'CHAY_TU_NGUON.bat']) {
    const s = docBat(f);
    assert.ok(/if "%~1"=="--trong" goto :chinh/.test(s), `${f} thiếu lớp bọc giữ cửa sổ`);
    assert.ok(/cmd \/c ""%~f0" --trong"/.test(s), `${f} không tự gọi lại trong cửa sổ con`);
    assert.ok(/^:chinh\s*$/m.test(s), `${f} thiếu nhãn :chinh`);
    // Và phải thoát sớm khi chạy ngon, nếu không lần nào cũng bắt bấm phím.
    assert.ok(/if "%RC%"=="0" exit \/b 0/.test(s), `${f} chạy ngon vẫn bắt bấm phím`);
  }
});

test('.bat: bước dựng winCodeSign có đường tải dự phòng', () => {
  // PowerShell có thể bị chính sách nhóm chặn, hoặc hỏng linh tinh. curl.exe
  // có sẵn từ Windows 10 bản 1803 — thêm một đường nữa gần như không tốn gì.
  const s = docBat('BUILD_EXE.bat');
  assert.ok(/powershell/i.test(s), 'không còn đường tải bằng PowerShell');
  assert.ok(/curl\.exe/i.test(s), 'thiếu đường tải dự phòng bằng curl.exe');
});

test('.bat: mọi goto/call :nhãn đều có nhãn thật', () => {
  for (const f of BAT) {
    const s = docBat(f);
    const nhan = new Set([...s.matchAll(/^:(\w+)/gm)].map((m) => m[1].toLowerCase()));
    for (const m of s.matchAll(/\b(?:goto|call)\s+:(\w+)/g)) {
      const t = m[1].toLowerCase();
      if (t === 'eof') continue;
      assert.ok(nhan.has(t), `${f} nhảy tới :${m[1]} mà không có nhãn đó`);
    }
  }
});

// ============================================================================
//  Chế độ an toàn
// ============================================================================

const anToan = require('../src/main/an-toan');

test('an toàn: nhận ra câu Flow báo hoạt động bất thường', () => {
  assert.ok(anToan.laCanhBaoChan(
    'Chúng tôi nhận thấy có hoạt động bất thường nào đó. Vui lòng truy cập Trung tâm trợ giúp.'));
  assert.ok(anToan.laCanhBaoChan('We detected unusual activity from your account'));
  assert.ok(anToan.laCanhBaoChan('Too many requests'));
  // Lỗi thường của Flow thì KHÔNG được coi là bị chặn — nghỉ 10 phút vì một
  // prompt phạm chính sách là phí thời gian của người dùng.
  assert.ok(!anToan.laCanhBaoChan('Không thành công (Policy/Error)'));
  assert.ok(!anToan.laCanhBaoChan('Tạo thất bại'));
  assert.ok(!anToan.laCanhBaoChan(''));
  assert.ok(!anToan.laCanhBaoChan(null));
});

test('an toàn: danh sách câu cảnh báo hai bên KHÔNG được lệch nhau', () => {
  // flow-canh-bao.js chạy trong trang Flow nên phải chép lại danh sách. Chép
  // thì có ngày lệch, nên đối chiếu ngay tại đây.
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'inject', 'flow-canh-bao.js'), 'utf8');
  const khoi = src.match(/var CUM_TU = \[([\s\S]*?)\];/);
  assert.ok(khoi, 'không tìm thấy danh sách CUM_TU trong flow-canh-bao.js');
  const ben = [...khoi[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(ben, anToan.CUM_TU_CHAN,
    'danh sách câu cảnh báo bên trang và bên tiến trình chính đã lệch nhau');
});

test('an toàn: đếm lỗi KHÔNG đếm trùng khi engine gửi lại cả bảng', () => {
  // Engine gửi lại NGUYÊN bảng vài giây một lần. Đếm thẳng thì một lỗi duy
  // nhất cũng vượt ngưỡng trong nháy mắt và app tự dừng oan.
  const daDem = new Set();
  const rows = [
    { index: 1, status: 'COMPLETED' },
    { index: 2, status: 'ERROR', error: 'Không thành công (Policy/Error)', retries: 0 }
  ];
  assert.strictEqual(anToan.loiMoi(rows, daDem).length, 1);
  assert.strictEqual(anToan.loiMoi(rows, daDem).length, 0, 'đếm lại lần hai');
  assert.strictEqual(anToan.loiMoi(rows, daDem).length, 0, 'đếm lại lần ba');
  // Nhưng engine THỬ LẠI rồi hỏng nữa thì đó là một lần gõ cửa mới thật.
  rows[1].retries = 1;
  assert.strictEqual(anToan.loiMoi(rows, daDem).length, 1);
});

test('an toàn: chưa đủ ngưỡng thì chưa nghỉ', () => {
  const c = anToan.chuanHoaCaiDat({ nguong: 3, cuaSoPhut: 5 });
  const so = anToan.soMoi();
  const t = 1000000;
  so.moc.push(t - 1000, t - 2000);
  assert.strictEqual(anToan.canNghi(so, t, c).nghi, false);
  so.moc.push(t - 500);
  assert.strictEqual(anToan.canNghi(so, t, c).nghi, true);
});

test('an toàn: lỗi quá cũ rơi ra khỏi cửa sổ, không cộng dồn cả buổi', () => {
  const c = anToan.chuanHoaCaiDat({ nguong: 3, cuaSoPhut: 5 });
  const so = anToan.soMoi();
  const t = 1000000000;
  so.moc.push(t - 20 * 60000, t - 19 * 60000, t - 18 * 60000);  // 3 lỗi, 20 phút trước
  assert.strictEqual(anToan.canNghi(so, t, c).nghi, false, 'lỗi cũ vẫn làm dừng');
  assert.strictEqual(so.moc.length, 0, 'mốc quá cũ chưa bị dọn, sổ sẽ phình mãi');
});

test('an toàn: đọc được đúng câu cảnh báo thì nghỉ ngay từ lỗi đầu', () => {
  const c = anToan.chuanHoaCaiDat({ nguong: 10 });
  const so = anToan.soMoi();
  so.coCauChan = true;
  so.moc.push(Date.now());
  const qd = anToan.canNghi(so, Date.now(), c);
  assert.strictEqual(qd.nghi, true);
  assert.strictEqual(qd.chacChan, true);
});

test('an toàn: đang nghỉ rồi thì không xếp thêm lần nghỉ nữa', () => {
  const c = anToan.chuanHoaCaiDat({ nguong: 1 });
  const so = anToan.soMoi();
  so.dangNghi = true;
  so.moc.push(Date.now());
  assert.strictEqual(anToan.canNghi(so, Date.now(), c).nghi, false);
});

test('an toàn: tắt chế độ an toàn thì không bao giờ tự nghỉ', () => {
  const c = anToan.chuanHoaCaiDat({ bat: false, nguong: 1 });
  const so = anToan.soMoi();
  so.coCauChan = true;
  so.moc.push(Date.now(), Date.now(), Date.now());
  assert.strictEqual(anToan.canNghi(so, Date.now(), c).nghi, false);
});

test('an toàn: nghỉ tăng gấp đôi mỗi lần bị chặn lại, và có trần', () => {
  const c = anToan.chuanHoaCaiDat({ nghiPhut: 10, nhanDoi: true, nghiToiDaPhut: 60 });
  assert.strictEqual(anToan.thoiGianNghi(0, c), 10 * 60000);
  assert.strictEqual(anToan.thoiGianNghi(1, c), 20 * 60000);
  assert.strictEqual(anToan.thoiGianNghi(2, c), 40 * 60000);
  assert.strictEqual(anToan.thoiGianNghi(3, c), 60 * 60000, 'phải chặn ở trần 60 phút');
  assert.strictEqual(anToan.thoiGianNghi(99, c), 60 * 60000, 'lần thứ 99 vẫn phải là 60');
});

test('an toàn: tắt nhân đôi thì lần nào cũng nghỉ bấy nhiêu', () => {
  const c = anToan.chuanHoaCaiDat({ nghiPhut: 7, nhanDoi: false });
  assert.strictEqual(anToan.thoiGianNghi(0, c), 7 * 60000);
  assert.strictEqual(anToan.thoiGianNghi(5, c), 7 * 60000);
});

test('an toàn: giải lao định kỳ đếm theo tổng prompt đã xong', () => {
  const c = anToan.chuanHoaCaiDat({ cuMoi: 20, giaiLaoPhut: 5 });
  const so = anToan.soMoi();
  assert.strictEqual(anToan.canGiaiLao(so, 19, c).nghi, false);
  assert.strictEqual(anToan.canGiaiLao(so, 20, c).nghi, true);
  so.mocGiaiLao = 20;                       // đã nghỉ ở mốc 20
  assert.strictEqual(anToan.canGiaiLao(so, 25, c).nghi, false);
  assert.strictEqual(anToan.canGiaiLao(so, 40, c).nghi, true);
});

test('an toàn: cuMoi = 0 là tắt hẳn giải lao', () => {
  const c = anToan.chuanHoaCaiDat({ cuMoi: 0 });
  assert.strictEqual(anToan.canGiaiLao(anToan.soMoi(), 999, c).nghi, false);
});

test('an toàn: người dùng gõ bậy vào ô số thì lấy mặc định, không NaN', () => {
  const c = anToan.chuanHoaCaiDat({ nguong: 'ba', cuaSoPhut: '', nghiPhut: null });
  assert.strictEqual(c.nguong, anToan.MAC_DINH.nguong);
  assert.strictEqual(c.cuaSoPhut, anToan.MAC_DINH.cuaSoPhut);
  assert.strictEqual(c.nghiPhut, anToan.MAC_DINH.nghiPhut);
  // Và số vô lý bị kẹp về khoảng cho phép.
  assert.strictEqual(anToan.chuanHoaCaiDat({ nguong: 9999 }).nguong, 50);
  assert.strictEqual(anToan.chuanHoaCaiDat({ nguong: -5 }).nguong, 1);
});

test('an toàn: càng nhiều tab thì nhịp càng thưa', () => {
  const a = anToan.nhipAnToan(1), b = anToan.nhipAnToan(3);
  assert.ok(b.delayMin > a.delayMin, '3 tab phải chờ lâu hơn 1 tab');
  assert.ok(b.delayMax > b.delayMin);
  assert.strictEqual(a.multiTabStagger, 0, 'một tab thì giãn cách giữa tab vô nghĩa');
  assert.ok(b.multiTabStagger > 0);
  // Hạ số lần thử lại là phần quan trọng nhất: lúc bị chặn, mỗi lần thử lại
  // là một lần gõ cửa nữa.
  assert.ok(a.maxRetries <= 3, 'nhịp an toàn phải hạ số lần thử lại');
  assert.strictEqual(a.randomScroll, true);
  assert.strictEqual(a.randomDelay, true);
});

test('an toàn: nhipAnToan chịu được số tab vô lý', () => {
  for (const v of [0, -3, null, undefined, 'hai', 999]) {
    const n = anToan.nhipAnToan(v);
    assert.ok(n.delayMin >= 20 && n.delayMin <= 200, `delayMin lạ với ${v}`);
  }
});

test('an toàn: đổi mili-giây sang chữ người đọc được', () => {
  assert.strictEqual(anToan.doDai(30000), '30 giây');
  assert.strictEqual(anToan.doDai(600000), '10 phút');
  assert.strictEqual(anToan.doDai(330000), '5 phút 30 giây');
});

test('an toàn: giao diện có đủ ô, và trình dò cảnh báo được tiêm vào tab', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'index.html'), 'utf8');
  for (const id of ['anToanBat', 'anToanNguong', 'anToanCuaSo', 'anToanNghi',
                    'anToanToiDa', 'anToanNhanDoi', 'anToanCuMoi', 'anToanGiaiLao',
                    'btnNhipAnToan']) {
    assert.ok(html.includes(`id="${id}"`), `giao diện thiếu ô #${id}`);
  }
  const tabs = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'tabs.js'), 'utf8');
  assert.ok(/flow-canh-bao\.js/.test(tabs), 'tabs.js chưa nạp flow-canh-bao.js');
  assert.ok(/canhBaoSource/.test(tabs), 'tabs.js chưa tiêm trình dò cảnh báo vào tab');
});

test('an toàn: nghỉ hạ nhiệt KHÔNG được kích hoạt chuỗi ảnh→video', () => {
  // Tạm dừng làm engine báo isRunning=false. Không chặn thì main.js tưởng mẻ
  // ảnh đã xong và nối sang video ngay giữa giờ nghỉ — đúng lúc tệ nhất.
  const m = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(/!d\.isRunning && !tab\.nghiAnToan/.test(m),
    'main.js còn nối chuỗi ảnh→video khi đang nghỉ hạ nhiệt');
  assert.ok(/if \(tab\.nghiAnToan\) return;/.test(m),
    'chayTiepChuoi thiếu chốt chặn lúc đang nghỉ');
});

// ── Model video (2.8.0) ────────────────────────────────────────────────────
const modelKH = require('../src/main/model');
const LP = 'Veo 3.1 - Lite [Lower Priority]';
const LITE = 'Veo 3.1 - Lite';
const FAST = 'Veo 3.1 - Fast';

test('model: để trống thì KHÔNG đụng vào hộp chọn model (y như bản cũ)', () => {
  const k = modelKH.chuanHoaKeHoach({});
  assert.strictEqual(modelKH.coHieuLuc(k), false);
  assert.strictEqual(modelKH.chuanHoaKeHoach(undefined).thuLaiPhut, 30);
});

test('model: "Lite" và "Lite [Lower Priority]" là HAI model khác nhau (bẫy tiền tố)', () => {
  assert.ok(modelKH.laLowerPriority(LP));
  assert.ok(!modelKH.laLowerPriority(LITE));
  assert.ok(!modelKH.cungModel(LP, LITE));
  assert.ok(modelKH.cungModel(LITE, 'veo 3.1 – lite'));           // gạch dài, chữ thường
  assert.ok(modelKH.cungModel(LP, 'Veo 3.1 Lite (Lower priority)'));
});

test('model: khoá so sánh bên main GIỐNG HỆT bên trang Flow (flow-model.js)', () => {
  // Hai bản chạy ở hai nơi (tiến trình chính / trong trang) nên buộc phải là
  // hai bản chép. Lệch nhau là main tưởng đã đúng model trong khi trang chọn khác.
  const vm = require('vm');
  const cua = { window: {}, document: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'inject', 'flow-model.js'), 'utf8'), cua);
  const khoaTrang = cua.window.__flowChuanHoaModel;
  for (const t of [LP, LITE, FAST, 'Veo 3.1 - Quality', 'Omni 1.1 Flash', 'volume_upVeo 3.1 - Lite', 'Véo 3.1 — Líte']) {
    assert.strictEqual(modelKH.khoaModel(t), khoaTrang(t), `lệch ở "${t}"`);
  }
});

test('model: xen kẽ N=2 là chính, phụ, chính, phụ', () => {
  const k = modelKH.chuanHoaKeHoach({ chinh: LP, phu: LITE, xenKeMoi: 2 });
  const ra = [1, 2, 3, 4].map((n) => modelKH.modelChoPrompt(k, n, false).model);
  assert.deepStrictEqual(ra, [LP, LITE, LP, LITE]);
});

test('model: xen kẽ N=3 là chính, chính, phụ', () => {
  const k = modelKH.chuanHoaKeHoach({ chinh: LP, phu: FAST, xenKeMoi: 3 });
  const ra = [1, 2, 3, 4, 5, 6].map((n) => modelKH.modelChoPrompt(k, n, false).model);
  assert.deepStrictEqual(ra, [LP, LP, FAST, LP, LP, FAST]);
});

test('model: xen kẽ thiếu model phụ hoặc N<2 thì tự tắt', () => {
  assert.strictEqual(modelKH.chuanHoaKeHoach({ chinh: LP, xenKeMoi: 2 }).xenKeMoi, 0);
  assert.strictEqual(modelKH.chuanHoaKeHoach({ chinh: LP, phu: LITE, xenKeMoi: 1 }).xenKeMoi, 0);
});

test('model: Lower Priority đang bị chặn → prompt mới dùng dự phòng, kể cả lượt xen kẽ', () => {
  const k = modelKH.chuanHoaKeHoach({ chinh: FAST, phu: LP, xenKeMoi: 2, duPhong: LITE });
  assert.strictEqual(modelKH.modelChoPrompt(k, 1, true).model, FAST);   // không phải LP thì giữ
  assert.strictEqual(modelKH.modelChoPrompt(k, 2, true).model, LITE);   // lượt LP → dự phòng
  assert.strictEqual(modelKH.modelChoPrompt(k, 2, false).model, LP);    // hết giờ tránh → LP lại
});

test('model: không có dự phòng thì vẫn là Lower Priority (để chế độ an toàn cho nghỉ)', () => {
  const k = modelKH.chuanHoaKeHoach({ chinh: LP });
  assert.strictEqual(modelKH.modelChoPrompt(k, 1, true).model, LP);
  assert.strictEqual(modelKH.nenChuyenDuPhong(k, LP), false);
});

test('model: dự phòng không được là chính Lower Priority', () => {
  assert.strictEqual(modelKH.chuanHoaKeHoach({ chinh: LP, duPhong: LP }).duPhong, '');
});

test('model: chỉ chuyển dự phòng khi ĐANG chạy Lower Priority', () => {
  const k = modelKH.chuanHoaKeHoach({ chinh: LP, duPhong: LITE });
  assert.strictEqual(modelKH.nenChuyenDuPhong(k, LP), true);
  // Đang chạy model tốn credit mà vẫn bị chặn = cả tài khoản bị nhắc → nghỉ.
  assert.strictEqual(modelKH.nenChuyenDuPhong(k, LITE), false);
  assert.strictEqual(modelKH.nenChuyenDuPhong(k, null), false);
});

test('model: tránh Lower Priority tăng dần 30 → 60 → 120 → trần 240 phút', () => {
  const ph = (n) => modelKH.thoiGianTranhLp(n, 30) / 60000;
  assert.deepStrictEqual([1, 2, 3, 4, 5].map(ph), [30, 60, 120, 240, 240]);
});

test('model: nối dây trong main.js đủ các chỗ', () => {
  const m = docNguon('main.js');
  const lay = (dau) => { const i = m.indexOf(dau); return i < 0 ? '' : m.slice(i, i + 2500); };
  // 1. Đổi model trong lượt xin bấm Tạo — lúc engine đứng chờ.
  assert.ok(/modelChoPrompt/.test(lay("case 'ACQUIRE_CREATE_SLOT'")), 'ACQUIRE_CREATE_SLOT chưa chọn model');
  // 2. Engine chỉ xin lượt khi giãn cách > 0 → phải ép tối thiểu 1 giây.
  // Soi TRỌN thân hàm, không phải 2.500 ký tự đầu: bước kiểm danh sách model
  // đầu mẻ (2.8.7) làm hàm dài ra và dòng ép giãn cách rơi ra ngoài cửa sổ cũ.
  const thanChuanBi = thanHam(m, 'async function chuanBiModel');
  assert.ok(/multiTabStagger:\s*Math\.max\(1/.test(thanChuanBi), 'chưa ép giãn cách ≥ 1 giây');
  // 3. Cả hai đường giao việc (bấm Bắt đầu, và mẻ video nối sau ảnh).
  assert.ok(/chuanBiModel\(tab, settings\)[\s\S]{0,200}buildStartMessage\(prompts, part, caiDatTab\)/.test(m),
    'nút Bắt đầu chưa áp kế hoạch model');
  // 2.8.8: thêm dòng ganNhipThaoTac ở giữa nên nới cửa sổ 120 → 200 ký tự.
  assert.ok(/chuanBiModel\(tab, settings\)[\s\S]{0,200}buildStartMessage\(prompts, jobs, caiDatTab\)/.test(m),
    'mẻ video nối tiếp chưa áp kế hoạch model');
  // 4. Chuyển dự phòng TRƯỚC khi cho nghỉ.
  assert.ok(/thuChuyenDuPhong\(tab\.accountId, qd\)\) return;\s*\n\s*await batDauNghi/.test(m),
    'chế độ an toàn chưa thử chuyển dự phòng trước khi nghỉ');
  // 5. Đang chuyển dự phòng thì chặn chuỗi ảnh→video (như lúc nghỉ).
  assert.ok(/t\.nghiAnToan = true;[^\n]*\n\s*try \{ await tabManager\.dispatch\(t\.id, \{ action: 'PAUSE_AUTOMATION' \}\)/.test(lay('async function thuChuyenDuPhong')),
    'chuyển dự phòng chưa chặn chuỗi ảnh→video');
  // 6. Không đọc danh sách model khi tab đang chạy.
  assert.ok(/if \(tab\.busy\) return \{ ok: false/.test(lay("'app:tabs:listModels'")), 'đọc model lúc tab đang chạy');
});

test('tab ẩn KHÔNG bị thu về 0×0 (lưới ảo của Flow sẽ vẽ 0 thẻ)', () => {
  // KHÔI PHỤC ở 2.8.4: bài kiểm này và bản vá nó canh đã bị GÓI ZIP 2.8.2
  // ghi đè mất (xem README mục 0n, phần "gói zip ghi đè bản vá mới hơn").
  // Lưới kết quả mới của Flow là cdk-virtual-scroll-viewport: chỉ vẽ số thẻ
  // vừa khung nhìn. Tab ẩn bị thu về 0×0 thì lưới vẽ 0 thẻ, và mọi tab báo
  // "KHÔNG TÌM THẤY Thẻ video / ảnh".
  const { khungChoTab } = require('../src/main/tabs.js');
  const z = { x: 0, y: 0, width: 0, height: 0 };
  const k1 = khungChoTab(z, null);
  assert.ok(k1.width >= 400 && k1.height >= 300, 'chưa có vùng hiển thị vẫn phải có khung thật');
  assert.deepStrictEqual(khungChoTab({ x: 300, y: 60, width: 1000, height: 700 }, null), { x: 300, y: 60, width: 1000, height: 700 });
  const cuoi = { x: 300, y: 60, width: 1000, height: 700 };
  assert.deepStrictEqual(khungChoTab(z, cuoi), cuoi, 'vùng hiển thị bị ẩn thì giữ khung đẹp gần nhất');
  const t = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'tabs.js'), 'utf8');
  const ab = t.slice(t.indexOf('  applyBounds() {'), t.indexOf('  async reload('));
  assert.ok(!/width:\s*0/.test(ab), 'applyBounds lại đặt khung 0×0 cho tab');
});

test('kiểm trước mẻ: cả hai chỗ giao mẻ và đường đọc kho sau F5 đều đi qua bộ lọc selector', () => {
  const m = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const giao = (m.match(/dispatch\([^)]*buildStartMessage\(/g) || []).length;
  const kiem = (m.match(/kiemTruocKhiChay\(tab\.view\.webContents/g) || []).length;
  assert.ok(giao >= 2 && kiem === giao, `có ${giao} chỗ giao mẻ nhưng ${kiem} chỗ kiểm`);
  assert.ok(/case 'get':\s*return locVeoSettings\(store\.get\(arg\)\)/.test(m), 'flow:storage get chưa lọc selector đã bỏ');
  const { moTaTaiVe } = require('../src/main/kiem-truoc');
  assert.strictEqual(moTaTaiVe({ runMode: 'image', autoDownload: false, downloadMode: 'none' }).muc, 'warning');
  assert.strictEqual(moTaTaiVe({ runMode: 'video', autoDownload: true, downloadMode: 'single' }).muc, 'info');
});

test('model: tiêm flow-model.js SAU flow-mode.js', () => {
  const t = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'tabs.js'), 'utf8');
  const a = t.indexOf("['trình đổi chế độ'"), b = t.indexOf("['trình chọn model'");
  assert.ok(a > 0 && b > a, 'flow-model.js phải tiêm ngay sau flow-mode.js');
  const mo = fs.readFileSync(path.join(__dirname, '..', 'src', 'inject', 'flow-mode.js'), 'utf8');
  for (const h of ['__flowBamMotLan', '__flowMoBang', '__flowTimBang', '__flowDongBang'])
    assert.ok(mo.includes(`window.${h}`), `flow-mode.js chưa phơi ${h}`);
});

test('model: giao diện có đủ ô và gửi settings.chonModel', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'index.html'), 'utf8');
  for (const id of ['modelChinh', 'modelPhu', 'modelXenKe', 'modelDuPhong', 'modelThuLai', 'btnDocModel']) {
    assert.ok(html.includes(`id="${id}"`), `thiếu ô #${id}`);
  }
  // 2.8.7: ba ô tên model PHẢI là hộp chọn. Ô gõ chữ kèm gợi ý (<input
  // list>) lọc gợi ý theo chữ đang có trong ô — đã ghi sẵn một tên thì bấm
  // vào không hiện gì, đúng lỗi "không bấm chọn model chính được" 28/09/2026.
  for (const id of ['modelChinh', 'modelPhu', 'modelDuPhong']) {
    assert.ok(new RegExp(`<select id="${id}"`).test(html), `#${id} phải là <select>, không phải ô gõ chữ`);
  }
  assert.ok(!/list="dsModel"/.test(html) && !/<datalist/.test(html),
    'còn ô gõ chữ kèm datalist — bấm vào sẽ không hiện đủ danh sách model');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'app.js'), 'utf8');
  assert.strictEqual((ui.match(/s\.chonModel = docChonModel\(\)/g) || []).length, 2,
    'collectSettings và collectForSave đều phải gom chonModel');
  assert.ok(/datChonModel\(s\.chonModel\)/.test(ui), 'applySettings chưa nạp lại chonModel');
});

// ── Tự cập nhật (2.8.0) ────────────────────────────────────────────────────
// Phần chạy thật (máy chủ giả, tải, mã băm, đổi app Mac) ở tests/cap-nhat-test.js.
test('cập nhật: tên file đóng gói khớp đúng thứ app đi tìm', () => {
  const CN = require('../src/main/cap-nhat');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const v = pkg.version;
  const ten = (mau, arch) => mau.replace('${version}', v).replace('${arch}', arch).replace('${ext}', 'zip');
  const rel = { assets: [
    { name: pkg.build.nsis.artifactName.replace('${version}', v) },
    { name: pkg.build.portable.artifactName.replace('${version}', v) },
    { name: ten(pkg.build.mac.artifactName, 'arm64') },
    { name: ten(pkg.build.mac.artifactName, 'x64') }
  ] };
  assert.ok(CN.chonTaiSan(rel, 'win32', 'x64'), 'app Windows không nhận ra bộ cài của chính mình');
  assert.ok(CN.chonTaiSan(rel, 'darwin', 'arm64'), 'app Mac chip Apple không nhận ra gói của mình');
  assert.ok(CN.chonTaiSan(rel, 'darwin', 'x64'), 'app Mac Intel không nhận ra gói của mình');
  assert.strictEqual(CN.layRepo(pkg) !== null, true, 'package.json thiếu địa chỉ repo GitHub');
});

test('cập nhật: workflow phát hành đủ ba file, và chặn thẻ lệch phiên bản', () => {
  const y = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'phat-hanh.yml'), 'utf8');
  for (const f of ['-setup.exe', '-mac-arm64.zip', '-mac-x64.zip']) assert.ok(y.includes(f), `phat-hanh.yml không kiểm ${f}`);
  assert.ok(/khong trung package\.json/.test(y), 'thiếu chốt chặn thẻ ≠ version — app sẽ cài đi cài lại mãi');
  assert.ok(/uses: \.\/\.github\/workflows\/build-windows\.yml/.test(y) && /uses: \.\/\.github\/workflows\/build-mac\.yml/.test(y));
  // Hai workflow đóng gói KHÔNG tự chạy theo thẻ nữa — nếu không mỗi thẻ sinh ba lượt dựng.
  for (const f of ['build-windows.yml', 'build-mac.yml']) {
    const w = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', f), 'utf8');
    assert.ok(/workflow_call:/.test(w), `${f} thiếu workflow_call`);
    assert.ok(!/^\s*push:/m.test(w), `${f} vẫn tự chạy khi push thẻ`);
  }
});

test('cập nhật: main.js khởi động bộ cập nhật, cài khi thoát, chỉ mở link GitHub', () => {
  const m = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(/registerIpc\(\);\s*\n\s*khoiDongCapNhat\(\);/.test(m), 'chưa gọi khoiDongCapNhat()');
  assert.ok(/before-quit[\s\S]{0,600}nenCaiKhiThoat\(\)[\s\S]{0,120}e\.preventDefault\(\)/.test(m),
    'before-quit chưa giữ app lại để cài');
  assert.ok(/\^https:\\\/\\\/github\\\.com\\\//.test(m), 'mở trang phát hành phải giới hạn ở github.com');
  assert.ok(/coTabDangChay: \(\) => !!\(tabManager && tabManager\.tabs\.some\(\(t\) => t\.busy \|\| t\.nghiAnToan\)\)/.test(m),
    'tab đang nghỉ hạ nhiệt cũng là tab đang chạy mẻ — không được cài đè');
  const pre = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'preload-ui.js'), 'utf8');
  assert.ok(pre.includes("'cap-nhat'"), 'preload chưa cho kênh cap-nhat');
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'index.html'), 'utf8');
  for (const id of ['theCapNhat', 'btnCapNhatKiem', 'btnCapNhatCai', 'capNhatTuCai', 'pillCapNhat'])
    assert.ok(html.includes(`id="${id}"`), `thiếu #${id}`);
});

// ── macOS ──────────────────────────────────────────────────────────────────
const GOC = path.join(__dirname, '..');

test('macOS: file .command xuống dòng LF, có shebang, có quyền chạy', () => {
  // CRLF làm bash đọc "#!/bin/bash\r" → "bad interpreter", cửa sổ Terminal
  // báo lỗi khó hiểu rồi đóng. Thiếu quyền chạy thì Finder từ chối mở.
  for (const ten of ['CHAY_TU_NGUON.command', 'BUILD_MAC.command']) {
    const p = path.join(GOC, ten);
    const s = fs.readFileSync(p, 'utf8');
    assert.ok(s.startsWith('#!/bin/bash\n'), `${ten} thiếu dòng #!/bin/bash`);
    assert.ok(!s.includes('\r'), `${ten} có ký tự CR — bash sẽ không chạy được`);
    if (process.platform !== 'win32') {
      assert.ok(fs.statSync(p).mode & 0o111, `${ten} chưa có quyền chạy (chmod +x)`);
    }
  }
});

test('macOS: node_modules chép từ Windows sang thì phải cài lại', () => {
  // Chỉ kiểm package.json của electron là chưa đủ — node_modules của Windows có
  // file đó nhưng bên trong là electron.exe, không có Electron.app.
  const s = fs.readFileSync(path.join(GOC, 'CHAY_TU_NGUON.command'), 'utf8');
  assert.ok(/node_modules\/electron\/dist\/Electron\.app/.test(s),
    'CHAY_TU_NGUON.command không nhận ra node_modules bản Windows');
});

test('macOS: cấu hình đóng gói đủ để Mac chip Apple mở được', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(GOC, 'package.json'), 'utf8'));
  const b = pkg.build;
  assert.ok(b.mac, 'package.json thiếu mục build.mac');
  // identity phải là null TƯỜNG MINH: để trống thì electron-builder đi tìm
  // chứng chỉ, không có thì bỏ ký — và bản arm64 không ký là "app bị hỏng".
  assert.strictEqual(b.mac.identity, null, 'build.mac.identity phải là null (tự ký ad-hoc ở afterPack)');
  assert.strictEqual(b.afterPack, 'tools/ky-mac.js', 'thiếu afterPack ký ad-hoc');
  assert.ok(fs.existsSync(path.join(GOC, b.afterPack)), 'không thấy tools/ky-mac.js');
  assert.ok(fs.existsSync(path.join(GOC, b.mac.icon)), `không thấy icon Mac ${b.mac.icon}`);
  const archs = new Set(b.mac.target.flatMap((t) => t.arch));
  assert.ok(archs.has('arm64') && archs.has('x64'), 'phải dựng cả chip Apple (arm64) lẫn Intel (x64)');
  // Không được đụng tới phần Windows đang chạy tốt.
  assert.strictEqual(b.publish, null, 'mất "publish": null — build Windows sẽ báo hỏng');
  assert.ok(!('signAndEditExecutable' in (b.win || {})), 'không được tắt signAndEditExecutable');
});

test('macOS: hook ký bỏ qua bản Windows, dừng hẳn nếu không ký được bản Mac', () => {
  // afterPack chạy cho MỌI nền tảng — nhánh Windows phải thoát ngay dòng đầu,
  // nếu không nó làm hỏng BUILD_EXE.bat đang chạy tốt.
  const s = fs.readFileSync(path.join(GOC, 'tools', 'ky-mac.js'), 'utf8');
  assert.ok(/if \(context\.electronPlatformName !== 'darwin'\) return;/.test(s),
    'hook ký chưa bỏ qua bản Windows');
  assert.strictEqual(typeof require(path.join(GOC, 'tools', 'ky-mac.js')).default, 'function');
  assert.ok(/throw new Error/.test(s), 'không ký được mà vẫn cho qua — sẽ phát hành bản không mở được');
});

test('macOS: đóng cửa sổ là thoát hẳn, và có menu Sửa để Cmd+V dán được', () => {
  const m = fs.readFileSync(path.join(GOC, 'main.js'), 'utf8');
  const khoi = m.slice(m.indexOf("app.on('window-all-closed'"));
  const than = khoi.slice(0, khoi.indexOf('});'));
  assert.ok(/app\.quit\(\)/.test(than) && !/darwin/.test(than),
    'window-all-closed trên Mac không thoát — tab Flow chạy ngầm không cửa sổ');
  for (const vt of ['copy', 'paste', 'selectAll']) {
    assert.ok(m.includes(`role: '${vt}'`), `menu Mac thiếu vai trò ${vt}`);
  }
  assert.ok(/dungMenuMac\(\);\s*\n\s*createWindow\(\);/.test(m), 'chưa gọi dungMenuMac() trước khi mở cửa sổ');
});

// ── Engine: đếm ảnh trước/sau khi bấm Tạo phải CÙNG một bộ lọc ─────────────
//
//  LỖI THẬT 22/09/2026. Nhật ký ghi ở cả 6 tab:
//      🔎 Verify: newTile=false, txtCleared=false(len=2421), newImg=true
//  rồi "✅ Create accepted — monitoring for 4 tiles..." và treo mãi ở
//  "⏳ Đang chờ thẻ video mới xuất hiện".
//
//  Nguyên nhân: chỗ đếm TRƯỚC khi bấm dùng '[data-tile-id] img, …' (chỉ ảnh
//  trong thẻ) còn hai chỗ đếm SAU khi bấm dùng 'img, …' (mọi ảnh trên trang).
//  Nhỏ so với lớn nên newImg gần như luôn true — cú bấm Tạo trượt vẫn được
//  coi là thành công, và lỗi thật (Flow đổi giao diện lưới thẻ) bị che kín.
//
//  Bài kiểm này so THẲNG chuỗi selector ở ba chỗ. Đảo một chữ là đỏ ngay.
test('engine: đếm ảnh trước và sau khi bấm Tạo dùng cùng một selector', () => {
  const e = fs.readFileSync(path.join(GOC, 'src', 'inject', 'flow-engine.js'), 'utf8');

  const lay = (re, ten) => {
    const m = e.match(re);
    assert.ok(m, `không tìm thấy ${ten} trong flow-engine.js — code đã đổi, xem lại bài kiểm này`);
    return m[1];
  };

  const truoc = lay(/_preClickImageCount = document\.querySelectorAll\('([^']+)'\)/,
                    'chỗ đếm TRƯỚC khi bấm (_preClickImageCount)');
  const sau1  = lay(/const currentImageCount = document\.querySelectorAll\('([^']+)'\)/,
                    'chỗ đếm SAU khi bấm (currentImageCount)');
  const sau2  = lay(/const currentImageCount2 = document\.querySelectorAll\('([^']+)'\)/,
                    'chỗ đếm SAU khi bấm lần 2 (currentImageCount2)');

  assert.strictEqual(truoc, sau1,
    `đếm trước ("${truoc}") khác đếm sau ("${sau1}") — newImg sẽ luôn true và treo im lặng`);
  assert.strictEqual(truoc, sau2,
    `đếm trước ("${truoc}") khác đếm sau lần 2 ("${sau2}") — retry cũng bị che lỗi`);

  // Chốt thêm: không được quay lại bộ lọc hẹp theo [data-tile-id]. Giao diện
  // Flow mới không còn thuộc tính đó, nên đếm hẹp là luôn ra 0 ở cả hai đầu
  // và newImg thành luôn FALSE — lại sai theo hướng ngược lại.
  assert.ok(!truoc.includes('[data-tile-id]'),
    'bộ lọc đếm ảnh không được phụ thuộc [data-tile-id] (giao diện Flow mới đã bỏ)');
});

// ── MỌI action engine GỬI phải có người trả lời ở tiến trình chính ─────────
//
//  Đây là bài kiểm cho CẢ MỘT LOẠI lỗi, không phải một lỗi lẻ. Engine gửi
//  action mà main.js không có `case` thì nó rơi vào nhánh default và nhận
//  { success:false, error:'Action chưa hỗ trợ: …' } — engine coi như lỗi kết
//  nối rồi bỏ qua trong im lặng. Đã cắn thật hai lần:
//
//    • REGISTER_TAB thiếu  -> ba tab dùng chung khoá 'single', ghi đè dự án.
//    • UI_BREAK thiếu      -> app không biết giao diện Flow đã vỡ, mục Chẩn
//                             đoán im lìm trong khi engine đang kêu.
//
//  Thà bài kiểm này đỏ khi thêm tính năng, còn hơn để lặng lẽ mất dữ liệu.
test('mọi action engine gửi đều có case trong main.js', () => {
  const e = fs.readFileSync(path.join(GOC, 'src', 'inject', 'flow-engine.js'), 'utf8');
  const m = fs.readFileSync(path.join(GOC, 'main.js'), 'utf8');

  const gui = new Set();
  const nhat = (re) => { let x; while ((x = re.exec(e))) gui.add(x[1]); };
  nhat(/sendMessage\(\{\s*action:\s*'([A-Z_]+)'/g);
  nhat(/\bbg\('([A-Z_]+)'/g);
  nhat(/action:\s*'([A-Z_]+)'\s*,\s*data/g);

  // Bỏ ra những action engine NHẬN (app gửi xuống), không phải engine gửi lên.
  const engineNhan = new Set();
  let y; const reNhan = /message\.action === '([A-Z_]+)'/g;
  while ((y = reNhan.exec(e))) engineNhan.add(y[1]);

  const nhan = new Set();
  let z; const reCase = /case '([A-Z_]+)':/g;
  while ((z = reCase.exec(m))) nhan.add(z[1]);

  const thieu = [...gui].filter((a) => !engineNhan.has(a) && !nhan.has(a)).sort();
  assert.ok(gui.size >= 25, `chỉ nhặt được ${gui.size} action — biểu thức nhặt có thể đã hỏng`);
  assert.deepStrictEqual(thieu, [],
    `main.js chưa trả lời ${thieu.length} action engine gửi: ${thieu.join(', ')}`);
});

// ── Đường tự vá selector phải nối đủ từ đầu tới cuối ──────────────────────
//
//  Engine dặn người dùng "bấm Chọn trên trang hoặc Tải báo cáo .txt" khi nó
//  trượt. Trước 2.8.2 hai nút đó KHÔNG TỒN TẠI trong app, và settings.selectors
//  — khoá mà resolveSelector() của engine đọc — không hề được giao diện gom.
//  Nên cơ chế tự vá của engine nằm đó chết. Bài kiểm này canh cả 5 mắt nối.
test('đường tự chỉ selector nối đủ: nút → engine → settings.selectors', () => {
  const html = fs.readFileSync(path.join(GOC, 'src', 'ui', 'index.html'), 'utf8');
  const appjs = fs.readFileSync(path.join(GOC, 'src', 'ui', 'app.js'), 'utf8');
  const pre = fs.readFileSync(path.join(GOC, 'src', 'main', 'preload-ui.js'), 'utf8');
  const m = fs.readFileSync(path.join(GOC, 'main.js'), 'utf8');
  const e = fs.readFileSync(path.join(GOC, 'src', 'inject', 'flow-engine.js'), 'utf8');

  // 1. Engine vẫn đọc settings.selectors — nếu Google/engine đổi thì phải biết.
  assert.ok(/state\.settings\.selectors/.test(e),
    'engine không còn đọc settings.selectors — xem lại resolveSelector()');

  // 2. Có nút trong giao diện.
  assert.ok(html.includes('id="btnUiReport"'), 'thiếu nút "Tải báo cáo .txt"');
  assert.ok(html.includes('id="uiSelectorBox"'), 'thiếu chỗ vẽ dòng "Chọn trên trang"');
  assert.ok(/data-pick=/.test(appjs), 'giao diện không vẽ nút "Chọn trên trang"');

  // 3. Preload phơi đủ ba hàm, và cho phép hai kênh sự kiện mới.
  for (const h of ['uiPick', 'uiReport', 'pushSelectors']) {
    assert.ok(pre.includes(h + ':'), `preload-ui.js chưa phơi engine.${h}`);
  }
  for (const k of ['ui-pick', 'ui-break']) {
    assert.ok(pre.includes(`'${k}'`), `preload-ui.js chưa cho phép kênh '${k}'`);
  }

  // 4. Tiến trình chính gửi START_PICKING và đẩy UPDATE_SETTINGS.
  assert.ok(/action: 'START_PICKING'/.test(m), 'main.js không gửi START_PICKING');
  assert.ok(/action: 'UPDATE_SETTINGS'/.test(m),
    'main.js không đẩy UPDATE_SETTINGS — selector vừa chỉ sẽ phải chờ lần Bắt đầu sau');

  // 5. Giao diện gom selectors vào CẢ hai đường: gửi engine, và lưu ra đĩa.
  const khoi = (ten) => {
    const i = appjs.indexOf(`function ${ten}(`);
    assert.ok(i > 0, `không tìm thấy ${ten}()`);
    return appjs.slice(i, appjs.indexOf('\n}', i));
  };
  assert.ok(/s\.selectors\s*=/.test(khoi('collectSettings')),
    'collectSettings() không gửi selectors — engine sẽ không bao giờ thấy selector bạn chỉ');
  assert.ok(/s\.selectors\s*=/.test(khoi('collectForSave')),
    'collectForSave() không lưu selectors — mở lại app là mất hết');
});

// ── Trả lời KHÔNG ĐỒNG BỘ của engine phải về được tới nơi ─────────────────
//
//  BẰNG CHỨNG THẬT: báo cáo chẩn đoán 10:13 ngày 22/09/2026, chỗ đáng lẽ là
//  bảng 6 phần tử kèm outerHTML, chỉ có đúng:
//      ──── 1. TỰ KIỂM NGAY LÚC XUẤT BÁO CÁO ────
//      { "ok": true }
//
//  chrome-shim cũ chạy đồng bộ nên mọi sendResponse gọi sau đều mất. Engine
//  có ĐÚNG BA chỗ trả lời kiểu đó, và cả ba đều là tính năng người dùng bấm:
//  tự kiểm giao diện, tải ảnh lên Flow, kiểm tên ảnh.
//
//  Bài này canh hai đầu: shim có CHỜ, và main.js có MỞ PHONG BÌ.
//  (Đường đầu-cuối thật nằm ở tầng 4 — tests/tabs-main.js, bài 3b2.)
test('shim chờ sendResponse gọi sau, và main.js mở phong bì', () => {
  const shim = fs.readFileSync(path.join(GOC, 'src', 'inject', 'chrome-shim.js'), 'utf8');
  const m = fs.readFileSync(path.join(GOC, 'main.js'), 'utf8');
  const e = fs.readFileSync(path.join(GOC, 'src', 'inject', 'flow-engine.js'), 'utf8');

  // Engine vẫn còn dùng kiểu trả lời sau chứ? Nếu Google/engine đổi thì phải biết.
  const soChoTraSau = (e.match(/return true;\s*\/\/ trả lời không đồng bộ|sendResponse\);\s*\n\s*return true;/g) || []).length;
  assert.ok(/return true;/.test(e) && soChoTraSau >= 1,
    'engine không còn chỗ nào trả lời không đồng bộ — xem lại bài kiểm này');

  assert.ok(/=== true\)\s*choKhongDongBo = true/.test(shim),
    'chrome-shim không còn nhận biết người nghe trả về true → mọi trả lời sau sẽ mất');
  assert.ok(/new Promise\(/.test(shim),
    'chrome-shim không trả về Promise → không thể chờ sendResponse gọi sau');
  assert.ok(/setTimeout\(\(\) => tra\(true\)/.test(shim),
    'thiếu trần thời gian chờ — một người nghe hỏng là treo cả app');

  assert.ok(/const moPhongBi =/.test(m), 'main.js thiếu moPhongBi()');
  // Ba lệnh trả lời không đồng bộ đều phải đi qua moPhongBi.
  for (const [ten, re] of [
    ['RUN_UI_SELFTEST',       /moPhongBi\(await guiChoTabDangMo\(\{ action: 'RUN_UI_SELFTEST' \}\)\)/],
    ['CHECK_ASSET_NAMES',     /moPhongBi\(await guiChoTabDangMo\(\{\s*\n?\s*action: 'CHECK_ASSET_NAMES'/],
    ['UPLOAD_IMAGES_TO_FLOW', /return moPhongBi\(r\);/]
  ]) {
    assert.ok(re.test(m), `${ten} chưa mở phong bì của shim — giao diện sẽ nhận { ok:true } rỗng`);
  }
});

// ── Bấm nút Tạo: đi qua trình mới, và KHÔNG submit hai lần ────────────────
//
//  Nhật ký 22/09/2026: "🖱️ Create clicked (wasDisabled: false)" rồi
//  "newTile=false, txtCleared=false(len=21804), newImg=false" — bấm mà Flow
//  không nhận. Hai chỗ hở: hàm bấm cũ không đọc selector người dùng tự chỉ,
//  và chỉ thử đúng một kiểu bấm.
test('lệnh bấm Tạo đi qua flow-bam-tao.js kèm selector người dùng', () => {
  const m = fs.readFileSync(path.join(GOC, 'main.js'), 'utf8');
  const t = fs.readFileSync(path.join(GOC, 'src', 'main', 'tabs.js'), 'utf8');
  // Bỏ dòng ghi chú trước khi soi: chính ghi chú trong file cũng NHẮC TỚI
  // đoạn code sai (để giải thích vì sao không được dùng), nên soi cả ghi chú
  // là bài kiểm đỏ oan. Đây là lỗi tôi mắc ngay khi viết bài kiểm này.
  const boGhiChu = (x) => x.split('\n').filter((d) => !/^\s*\/\//.test(d)).join('\n');
  const b = boGhiChu(fs.readFileSync(path.join(GOC, 'src', 'inject', 'flow-bam-tao.js'), 'utf8'));

  // File tiêm phải được nạp VÀ có trong chuỗi tiêm, nếu không __flowBamTao
  // không tồn tại trên trang và app lặng lẽ rơi về hàm cũ.
  assert.ok(/flow-bam-tao\.js/.test(t), 'tabs.js không đọc flow-bam-tao.js');
  assert.ok(/bamTaoSource/.test(t) && /\['trình bấm nút Tạo', this\.bamTaoSource\]/.test(t),
    'flow-bam-tao.js chưa có trong chuỗi tiêm');
  // Phải tiêm SAU flow-mode.js: nó dùng lại __flowBamMotLan / __flowNhinThay.
  assert.ok(t.indexOf("this.modeSource") < t.indexOf("this.bamTaoSource]"),
    'flow-bam-tao.js phải tiêm SAU trình đổi chế độ');

  assert.ok(/window\.__flowBamTao/.test(m), 'main.js không gọi __flowBamTao');
  assert.ok(/selectorNguoiDung\(\) \|\| \{\}\)\.createBtn/.test(m),
    'lệnh bấm Tạo không truyền selector người dùng tự chỉ — đúng lỗi 22/09');

  // Enter và Space phải là HAI bước riêng. Gộp lại (kiểu 'phim' của
  // flow-mode.js gửi cả hai) là submit hai lần với nút nghe cả hai phím —
  // tests/bam-tao-main.js đã bắt đúng lỗi này khi viết bản đầu.
  assert.ok(/'click', 'chuot', 'enter', 'space'/.test(b),
    'thứ tự kiểu bấm phải tách Enter và Space thành hai bước');
  assert.ok(!/__flowBamMotLan\(el, 'phim'\)/.test(b),
    "không được dùng kiểu 'phim' dùng chung: nó gửi Enter RỒI Space → submit hai lần");
  // Dừng ngay khi thấy ăn, chứ không bắn hết cho chắc.
  assert.ok(/if \(kq\.an\)/.test(b) && /return \{\s*\n?\s*ok: true/.test(b),
    'phải dừng ngay khi một kiểu bấm đã ăn');
});

// ── Thư mục dữ liệu đổi tên nhưng KHÔNG được làm mất phiên đăng nhập ──────
test('thư mục dữ liệu là Tool-flow-veo3, có chuyển dữ liệu cũ sang', () => {
  const thoMain = fs.readFileSync(path.join(GOC, 'main.js'), 'utf8');
  // Bỏ ghi chú: chính ghi chú của khối đó có câu "PHẢI CHẠY TRƯỚC
  // app.whenReady()", nên so vị trí trên bản còn ghi chú là đỏ oan.
  const m = thoMain.split('\n').filter((d) => !/^\s*\/\//.test(d)).join('\n');

  assert.ok(/TEN_THU_MUC_DU_LIEU = 'Tool-flow-veo3'/.test(m), 'chưa đặt tên thư mục mới');
  assert.ok(/TEN_THU_MUC_CU = 'Flow Automation Studio'/.test(m), 'chưa biết tên thư mục cũ để chuyển sang');
  assert.ok(/app\.setPath\('userData'/.test(m), 'chưa đổi đường dẫn userData');

  // Phải đặt TRƯỚC whenReady, nếu không Chromium đã mở kho ở đường cũ.
  assert.ok(m.indexOf("datThuMucDuLieu") < m.indexOf('app.whenReady()'),
    'đổi thư mục dữ liệu phải chạy TRƯỚC app.whenReady()');

  // Ba nước nhường nhau: đổi tên → chép → ở lại đường cũ.
  const khoi = m.slice(m.indexOf('function datThuMucDuLieu'), m.indexOf('let mainWindow'));
  assert.ok(/renameSync/.test(khoi), 'thiếu bước đổi tên thư mục');
  assert.ok(/cpSync/.test(khoi), 'thiếu bước chép dự phòng khi đổi tên hỏng');
  assert.ok(/setPath\('userData', cu\)/.test(khoi),
    'thiếu đường lùi: chuyển không được thì phải Ở LẠI thư mục cũ, không được bỏ mất phiên đăng nhập');
});

// ── 2.8.7: Flow bỏ "Veo 3.1 - Lite [Lower Priority]" ──────────────────────
//
//  Nhật ký 28/09/2026: "Flow có 4 model: Omni 1.1 Flash · Veo 3.1 - Lite ·
//  Veo 3.1 - Fast · Veo 3.1 - Quality". Người dùng còn lưu tên Lower Priority
//  từ trước. Ba bài dưới canh: kế hoạch bị lọc theo danh sách THẬT, gợi ý
//  mặc định hai bên khớp nhau và không còn Lower Priority, và nối dây đủ.
test('model: lọc kế hoạch theo danh sách Flow thật', () => {
  const MK = require('../src/main/model');
  const DS = ['Omni 1.1 Flash', 'Veo 3.1 - Lite', 'Veo 3.1 - Fast', 'Veo 3.1 - Quality'];

  // Tên cũ Flow không còn → bỏ, và nói ra đã bỏ gì.
  const k1 = MK.chuanHoaKeHoach({ chinh: 'Veo 3.1 - Lite [Lower Priority]', phu: 'Veo 3.1 - Fast', xenKeMoi: 2 });
  const r1 = MK.locTheoDanhSach(k1, DS);
  assert.strictEqual(r1.keHoach.chinh, '', 'tên Lower Priority phải bị bỏ khi Flow không còn');
  assert.deepStrictEqual(r1.daBo, [{ truong: 'chinh', ten: 'Veo 3.1 - Lite [Lower Priority]' }]);
  assert.strictEqual(r1.keHoach.phu, 'Veo 3.1 - Fast', 'model phụ Flow còn thì phải giữ');

  // BẪY TIỀN TỐ: "Veo 3.1 - Lite" có trong danh sách KHÔNG được làm tên Lower
  // Priority lọt qua (so bằng nhau sau chuẩn hoá, không so "có chứa").
  assert.ok(!MK.locTheoDanhSach(MK.chuanHoaKeHoach({ chinh: 'Veo 3.1 - Lite [Lower Priority]' }), ['Veo 3.1 - Lite'])
    .keHoach.chinh, 'tiền tố "Veo 3.1 - Lite" không được coi là khớp Lower Priority');

  // Tên còn trên Flow thì giữ nguyên, kể cả khác hoa thường / khoảng trắng.
  const r2 = MK.locTheoDanhSach(MK.chuanHoaKeHoach({ chinh: 'veo 3.1  - FAST' }), DS);
  assert.strictEqual(r2.keHoach.chinh, 'veo 3.1 - FAST');
  assert.deepStrictEqual(r2.daBo, []);

  // Model phụ bị bỏ → tắt luôn xen kẽ, không để N còn đó mà không có gì để xen.
  const r3 = MK.locTheoDanhSach(MK.chuanHoaKeHoach({ chinh: 'Veo 3.1 - Lite', phu: 'Veo 9 Ultra', xenKeMoi: 3 }), DS);
  assert.strictEqual(r3.keHoach.phu, '');
  assert.strictEqual(r3.keHoach.xenKeMoi, 0);

  // Flow không còn Lower Priority nào → dự phòng vô nghĩa, bỏ (nó chỉ chạy
  // khi ĐANG dùng Lower Priority). Còn Lower Priority thì giữ.
  const kDp = MK.chuanHoaKeHoach({ chinh: 'Veo 3.1 - Lite', duPhong: 'Veo 3.1 - Fast' });
  assert.strictEqual(MK.locTheoDanhSach(kDp, DS).keHoach.duPhong, '');
  assert.strictEqual(MK.locTheoDanhSach(kDp, DS.concat('Veo 3.1 - Lite [Lower Priority]')).keHoach.duPhong,
    'Veo 3.1 - Fast', 'Google đưa Lower Priority trở lại thì dự phòng phải chạy lại được');

  // Đọc danh sách thất bại ([]) → KHÔNG lọc gì cả.
  assert.deepStrictEqual(MK.locTheoDanhSach(k1, []).keHoach, k1);
});

test('model: gợi ý mặc định khớp hai bên và không còn Lower Priority', () => {
  const MK = require('../src/main/model');
  const ui = fs.readFileSync(path.join(GOC, 'src', 'ui', 'app.js'), 'utf8');
  const m = ui.match(/const DS_MODEL_MAC_DINH = (\[[^\]]*\]);/);
  assert.ok(m, 'không tìm thấy DS_MODEL_MAC_DINH trong app.js');
  const dsUi = JSON.parse(m[1].replace(/'/g, '"'));
  assert.deepStrictEqual(dsUi, MK.MODEL_GOI_Y, 'gợi ý model ở giao diện lệch với src/main/model.js');
  assert.ok(!MK.MODEL_GOI_Y.some(MK.laLowerPriority), 'gợi ý mặc định còn Lower Priority — Flow đã bỏ');
  // Logic Lower Priority vẫn còn nguyên, để Google đưa nó trở lại vẫn chạy.
  assert.ok(MK.laLowerPriority('Veo 3.1 - Lite [Lower Priority]'));
});

test('model: đầu mẻ kiểm danh sách thật, prompt đầu luôn xác nhận model', () => {
  const m = docNguon('main.js');
  const than = (dau) => thanHam(m, dau);

  const cb = than('async function chuanBiModel');
  assert.ok(/__flowListModels/.test(cb) && /locTheoDanhSach/.test(cb),
    'chuanBiModel chưa đối chiếu kế hoạch với danh sách model thật trên Flow');
  // Lọc TRƯỚC khi đọc model đang chọn và TRƯỚC khi gán tab.keHoachModel.
  assert.ok(cb.indexOf('locTheoDanhSach') < cb.indexOf('tab.keHoachModel = k'),
    'phải lọc kế hoạch trước khi giao nó cho tab');

  const dm = than('async function datModel(tab, ten');
  assert.ok(/baoKhiGiuNguyen/.test(dm) && /đúng kế hoạch/.test(dm),
    'datModel vẫn im lặng khi model đã đúng — nhật ký không phân biệt được "đã đúng" với "không chạy"');
  assert.ok(/datModel\(tab, model, lyDo, tab\.demPromptMoi === 1\)/.test(m),
    'prompt đầu mẻ chưa bật xác nhận model thành lời');
});

// ── 2.8.7a: soi tĩnh phải ra cùng kết quả trên checkout CRLF (Windows CI) ──
test('soi tĩnh: cắt thân hàm như nhau dù file xuống dòng CRLF', () => {
  const lf = docNguon('main.js');
  const crlf = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r?\n/g, '\r\n');
  const chuan = crlf.replace(/\r\n/g, '\n');
  for (const dau of ['async function ghiLyDoTheLoi', 'async function chuanBiModel', 'async function datModel']) {
    const a = thanHam(lf, dau), b = thanHam(chuan, dau);
    assert.ok(a && a.length < 20000, `thân "${dau}" cắt sai (dài ${a.length})`);
    assert.strictEqual(a, b, `thân "${dau}" khác nhau giữa LF và CRLF`);
  }
  assert.throws(() => thanHam(crlf, 'async function ghiLyDoTheLoi'), /cuối hàm/,
    'cắt trên CRLF thô phải báo lỗi, không được lặng lẽ lấy tới cuối file');
});

// ── 2.8.7: ghi lý do Flow viết trên thẻ lỗi ───────────────────────────────
test('thẻ lỗi: đọc chữ Flow ghi trên thẻ và ghi vào nhật ký', () => {
  const m = docNguon('main.js');
  const cb = docNguon('src', 'inject', 'flow-canh-bao.js');
  assert.ok(/window\.__flowDocLyDoTheLoi = function/.test(cb), 'flow-canh-bao.js chưa phơi __flowDocLyDoTheLoi');
  assert.ok(/flow-error-tile/.test(cb), 'chưa dò thẻ flow-error-tile');
  assert.ok(/async function ghiLyDoTheLoi/.test(m), 'main.js thiếu ghiLyDoTheLoi');
  // Gọi từ UPDATE_TABLE_DATA và KHÔNG phụ thuộc chế độ an toàn.
  const khoi = m.slice(m.indexOf("case 'UPDATE_TABLE_DATA'"), m.indexOf("case 'UPDATE_PROGRESS'"));
  assert.ok(/ghiLyDoTheLoi\(tab, hangs\)/.test(khoi), 'UPDATE_TABLE_DATA chưa gọi ghiLyDoTheLoi');
  const g = thanHam(m, 'async function ghiLyDoTheLoi');
  assert.ok(g, 'không cắt được thân ghiLyDoTheLoi');
  assert.ok(!/caiDatAnToan\.bat/.test(g), 'đọc lý do thẻ lỗi không được phụ thuộc chế độ an toàn');
  assert.ok(/_lyDoDaGhi/.test(g), 'phải lọc trùng — lưới còn thẻ lỗi cũ thì câu đó lặp mãi');
});

// ── 2.8.8: nghỉ giữa các thao tác trong một prompt ─────────────────────────
const NT = require('../src/main/nhip-thao-tac');

test('nhịp thao tác: chuẩn hoá cài đặt', () => {
  assert.deepStrictEqual(NT.chuanHoa({}), { bat: false, min: 1, max: 4 });
  assert.deepStrictEqual(NT.chuanHoa({ nghiThaoTacBat: true, nghiThaoTacMin: '2', nghiThaoTacMax: '5' }),
    { bat: true, min: 2, max: 5 });
  // Gõ ngược thì đổi chỗ, không bỏ.
  assert.deepStrictEqual(NT.chuanHoa({ nghiThaoTacBat: true, nghiThaoTacMin: 6, nghiThaoTacMax: 2 }),
    { bat: true, min: 2, max: 6 });
  // Dấu phẩy kiểu Việt, và trần 60 giây.
  assert.strictEqual(NT.chuanHoa({ nghiThaoTacBat: true, nghiThaoTacMin: '1,5', nghiThaoTacMax: 999 }).min, 1.5);
  assert.strictEqual(NT.chuanHoa({ nghiThaoTacBat: true, nghiThaoTacMin: 1, nghiThaoTacMax: 999 }).max, 60);
  // Bật mà cả hai đầu là 0 thì coi như tắt.
  assert.strictEqual(NT.chuanHoa({ nghiThaoTacBat: true, nghiThaoTacMin: 0, nghiThaoTacMax: 0 }).bat, false);
  assert.strictEqual(NT.chuanHoa({ nghiThaoTacBat: true, nghiThaoTacMin: -3, nghiThaoTacMax: 'abc' }).min, 0);
});

test('nhịp thao tác: bốc thời gian nằm trong khoảng người dùng chọn', () => {
  const k = { bat: true, min: 2, max: 5 };
  assert.strictEqual(NT.bocMs(k, () => 0), 2000);
  assert.strictEqual(NT.bocMs(k, () => 0.999999), 5000);
  assert.strictEqual(NT.bocMs({ bat: false, min: 2, max: 5 }, () => 0.5), 0, 'tắt thì không nghỉ');
  for (let i = 0; i < 500; i++) {
    const ms = NT.bocMs(k);
    assert.ok(ms >= 2000 && ms <= 5000, `ra ngoài khoảng: ${ms}`);
  }
  // Ngẫu nhiên THẬT: 500 lần không được ra cùng một số.
  const ds = new Set(Array.from({ length: 500 }, () => NT.bocMs(k)));
  assert.ok(ds.size > 50, 'khoảng nghỉ không ngẫu nhiên');
});

testAsync('nhịp thao tác: nghỉ đủ, ghi nhật ký có giới hạn, bấm Dừng là cắt ngang', async () => {
  const log = [];
  let daNgu = 0;
  const ngu = async (ms) => { daNgu += ms; };
  const tab = { id: 'tab1' };
  NT.ganChoTab(tab, { nghiThaoTacBat: true, nghiThaoTacMin: 3, nghiThaoTacMax: 3 });
  const ms = await NT.nghi(tab, 'truocTao', (m) => log.push(m), { ngu });
  assert.strictEqual(ms, 3000);
  assert.strictEqual(daNgu, 3000);
  assert.ok(/Nghỉ 3,0s — nhập xong, trước khi bấm Tạo/.test(log[0]), log[0]);

  // Không tràn nhật ký: 30 lần nghỉ chỉ ra 10 dòng + 1 dòng báo.
  for (let i = 0; i < 29; i++) await NT.nghi(tab, 'truocNhap', (m) => log.push(m), { ngu });
  assert.strictEqual(log.length, 11, `ghi ${log.length} dòng`);

  // Tắt thì không nghỉ và không ghi gì.
  const t2 = { id: 't2' };
  NT.ganChoTab(t2, { nghiThaoTacBat: false, nghiThaoTacMin: 3, nghiThaoTacMax: 3 });
  assert.strictEqual(await NT.nghi(t2, 'truocTai', () => { throw new Error('không được ghi'); }, { ngu }), 0);

  // Dừng giữa chừng: nghỉ 60 giây, bấm Dừng sau 1 giây → thôi ngay.
  const t3 = { id: 't3' };
  NT.ganChoTab(t3, { nghiThaoTacBat: true, nghiThaoTacMin: 60, nghiThaoTacMax: 60 });
  let dem = 0;
  const nguRoiDung = async (x) => { dem += x; if (dem >= 1000) NT.huy(t3); };
  const da = await NT.nghi(t3, 'truocTao', null, { ngu: nguRoiDung });
  assert.ok(da <= 1250, `bấm Dừng rồi vẫn nghỉ ${da}ms`);
});

test('nhịp thao tác: nối đúng chỗ trong main.js', () => {
  const boGhiChu = (t) => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const m = boGhiChu(docNguon('main.js'));
  const khoi = (dau, sau) => { const i = m.indexOf(dau); const j = m.indexOf(sau, i + 1); return i < 0 ? '' : m.slice(i, j); };

  const dan = khoi("case 'INJECT_PASTE'", "case 'INJECT_CLICK_CREATE'");
  const iTruoc = dan.indexOf("nhipTT.nghi(tab, 'truocNhap'");
  const iDan = dan.indexOf('pastePrompt(');
  const iSau = dan.indexOf("nhipTT.nghi(tab, 'truocTao'");
  assert.ok(iTruoc >= 0 && iTruoc < iDan, 'chưa nghỉ TRƯỚC khi nhập prompt');
  assert.ok(iSau > iDan, 'chưa nghỉ SAU khi nhập, trước khi trả lời engine (trước khi bấm Tạo)');
  assert.ok(iSau < dan.lastIndexOf('return {'), 'phải nghỉ trước khi trả lời engine');

  // KHÔNG nghỉ trong INJECT_CLICK_CREATE: engine đã chụp danh sách thẻ trước
  // khi gửi lệnh này — nghỉ ở đó thì ảnh chụp cũ, dễ nhận nhầm thẻ.
  const bam = khoi("case 'INJECT_CLICK_CREATE'", "case 'INJECT_RENAME_INPUT'");
  assert.ok(bam && !/nhipTT\.nghi/.test(bam), 'không được nghỉ bên trong INJECT_CLICK_CREATE');

  assert.ok(/nhipTT\.nghi\(tab, 'truocDoiTen'/.test(khoi("case 'INJECT_RENAME_INPUT'", "case 'SET_NEXT_FILENAME'")),
    'chưa nghỉ trước khi đổi tên');
  const tai = khoi("case 'SET_NEXT_FILENAME'", "case 'UNSET_NEXT_FILENAME'");
  assert.ok(tai.indexOf("nhipTT.nghi(tab, 'truocTai'") >= 0 &&
    tai.indexOf("nhipTT.nghi(tab, 'truocTai'") < tai.indexOf('pushName('), 'chưa nghỉ trước khi tải về');
  const slot = khoi("case 'ACQUIRE_CREATE_SLOT'", "case 'CAN_SHUTDOWN'");
  assert.ok(slot.indexOf("nhipTT.nghi(tab, 'truocModel'") >= 0 &&
    slot.indexOf("nhipTT.nghi(tab, 'truocModel'") < slot.indexOf('datModel('), 'chưa nghỉ trước khi đổi model');

  // Gắn cấu hình ở CẢ HAI đường giao việc (bấm Bắt đầu, và mẻ video nối sau ảnh).
  assert.strictEqual((m.match(/^\s+ganNhipThaoTac\(tab, settings\);/gm) || []).length, 2,
    'phải gắn nhịp thao tác ở cả hai chỗ giao việc');
  // Tạm dừng và Dừng cắt ngang lần nghỉ.
  assert.ok(/nhipTT\.huy\(t\)[\s\S]{0,120}PAUSE_AUTOMATION/.test(m), 'Tạm dừng chưa cắt ngang lần nghỉ');
  assert.ok(/nhipTT\.huy\(t\)[\s\S]{0,120}STOP_AUTOMATION/.test(m), 'Dừng chưa cắt ngang lần nghỉ');
});

test('nhịp thao tác: giao diện có ô và gửi đi đúng khoá', () => {
  const html = docNguon('src', 'ui', 'index.html');
  for (const id of ['nghiThaoTacBat', 'nghiThaoTacMin', 'nghiThaoTacMax', 'nghiThaoTacHint'])
    assert.ok(html.includes(`id="${id}"`), `thiếu #${id}`);
  const app = docNguon('src', 'ui', 'app.js');
  const fields = app.slice(app.indexOf('const FIELDS'), app.indexOf('];', app.indexOf('const FIELDS')));
  const sw = app.slice(app.indexOf('const SWITCHES'), app.indexOf('];', app.indexOf('const SWITCHES')));
  assert.ok(/'nghiThaoTacMin'/.test(fields) && /'nghiThaoTacMax'/.test(fields), 'FIELDS chưa có ô nghỉ — không lưu, không gửi đi');
  assert.ok(/'nghiThaoTacBat'/.test(sw), 'SWITCHES chưa có công tắc nghỉ');
  // Khoá giao diện gửi PHẢI đúng khoá tiến trình chính đọc.
  const nt = docNguon('src', 'main', 'nhip-thao-tac.js');
  for (const k of ['nghiThaoTacBat', 'nghiThaoTacMin', 'nghiThaoTacMax'])
    assert.ok(nt.includes('r.' + k), `nhip-thao-tac.js không đọc ${k}`);
});

// ── 2.8.9: thời gian quy trình, ảnh tham chiếu dính, model ảnh ────────────
const TG = require('../src/main/thoi-gian');

test('thời gian: đồng hồ quy trình và dự đoán lúc xong (cả mẻ video nối sau)', () => {
  const t0 = 1_000_000;
  // Mẻ 10 ảnh, sẽ nối 10 video. Sau 120 s xong 2 ảnh → 60 s/ảnh.
  let q = TG.batDau(t0, 'image', 10, 10);
  let u = TG.uocTinh(q, { done: 2, failed: 0 }, {}, t0 + 120000);
  assert.strictEqual(u.daChayMs, 120000);
  assert.strictEqual(u.conLaiMs, 8 * 60000 + 10 * TG.MAC_DINH_MS.video, 'còn = 8 ảnh × 60 s + 10 video × mặc định');
  assert.strictEqual(u.xongLuc, t0 + 120000 + u.conLaiMs);
  assert.ok(/thuc-te/.test(u.nguon));
  // Lỗi cũng là đã xử lý xong (không chạy lại).
  u = TG.uocTinh(q, { done: 1, failed: 1 }, {}, t0 + 120000);
  assert.strictEqual(u.conLaiMs, 8 * 60000 + 10 * TG.MAC_DINH_MS.video);
  // Có lịch sử video thì dùng lịch sử cho mẻ chờ nối.
  u = TG.uocTinh(q, { done: 2 }, { video: 90000 }, t0 + 120000);
  assert.strictEqual(u.conLaiMs, 8 * 60000 + 10 * 90000);
  // Chưa xong cái nào: dùng lịch sử, trừ phần đã chạy, nhưng còn ≥ nửa prompt.
  u = TG.uocTinh(TG.batDau(t0, 'image', 3, 0), { done: 0 }, { image: 40000 }, t0 + 30000);
  assert.strictEqual(u.conLaiMs, 3 * 40000 - 30000);
  assert.strictEqual(u.nguon, 'lich-su');
  u = TG.uocTinh(TG.batDau(t0, 'image', 1, 0), { done: 0 }, {}, t0 + 999999);
  assert.strictEqual(u.conLaiMs, TG.MAC_DINH_MS.image * 0.5, 'prompt đầu chạy lâu hơn dự kiến: không về 0');
  assert.strictEqual(u.nguon, 'mac-dinh');
  // Đang nghỉ hạ nhiệt: cộng thời gian nghỉ còn lại.
  const coNghi = TG.uocTinh(q, { done: 2 }, {}, t0 + 120000, 5 * 60000);
  assert.strictEqual(coNghi.conLaiMs, 8 * 60000 + 10 * TG.MAC_DINH_MS.video + 5 * 60000);
  // Sang mẻ video: đồng hồ tổng GIỮ NGUYÊN, không đặt lại.
  q = TG.sangPhaVideo(q, t0 + 600000, 10);
  u = TG.uocTinh(q, { done: 0 }, {}, t0 + 600000);
  assert.strictEqual(u.batDau, t0);
  assert.strictEqual(u.daChayMs, 600000);
  assert.strictEqual(u.conLaiMs, 10 * TG.MAC_DINH_MS.video);
  // Xong: đồng hồ đứng.
  q = TG.ketThuc(q, t0 + 1600000);
  u = TG.uocTinh(q, { done: 10 }, {}, t0 + 9999999);
  assert.strictEqual(u.daChayMs, 1600000);
  assert.strictEqual(u.conLaiMs, 0);
  assert.strictEqual(TG.ketThuc(q, t0 + 1).ketThuc, t0 + 1600000, 'kết thúc hai lần không dời mốc');
  // Lịch sử: trộn nửa cũ nửa mới.
  assert.deepStrictEqual(TG.ghiLichSu({}, 'image', 50000), { image: 50000 });
  assert.deepStrictEqual(TG.ghiLichSu({ image: 50000 }, 'image', 70000), { image: 60000 });
  assert.strictEqual(TG.dinhDang(3725000), '1:02:05');
  assert.strictEqual(TG.dinhDang(65000), '1:05');
  assert.strictEqual(TG.uocTinh(null), null);
});

test('thời gian: nối đúng chỗ trong main.js và giao diện', () => {
  const boGhiChu = (t) => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const m = boGhiChu(docNguon('main.js'));
  assert.ok(/thoiGian: tg\.uocTinh\(t\.quyTrinh/.test(thanHam(m, 'function tabStatsPayload')), 'bảng tiến độ chưa gửi thoiGian');
  assert.ok(/tab\.quyTrinh = tg\.batDau\(/.test(m), 'bấm Bắt đầu chưa khởi động đồng hồ');
  const chuoi = thanHam(m, 'async function chayTiepChuoi');
  assert.ok(/tab\.quyTrinh = tg\.sangPhaVideo\(/.test(chuoi), 'mẻ video nối sau chưa giữ đồng hồ quy trình');
  assert.strictEqual((chuoi.match(/ketThucQuyTrinh\(tab\)/g) || []).length, 3, 'ba đường chuỗi bị huỷ phải dừng đồng hồ');
  const dung = m.slice(m.indexOf("case 'AUTOMATION_STOPPED'"), m.indexOf("case 'ACQUIRE_DOWNLOAD_LOCK'"));
  assert.ok(/ketThucQuyTrinh\(tab\)/.test(dung) && /chain\.phase === 'image'/.test(dung),
    'AUTOMATION_STOPPED phải dừng đồng hồ, trừ khi còn mẻ video chờ nối');
  const ui = docNguon('src', 'ui', 'app.js');
  assert.ok(/\$\{htmlThoiGian\(t\.thoiGian\)\}/.test(ui), 'thẻ tiến độ tab chưa hiện thời gian');
  assert.ok(/setInterval\(\(\) => \{\s*const now = Date\.now\(\);\s*document\.querySelectorAll\('#tabProgress \.tg'\)/.test(ui),
    'đồng hồ trên giao diện chưa tự nhích mỗi giây');
});

test('ảnh tham chiếu dính: nối đúng chỗ', () => {
  const boGhiChu = (t) => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const m = boGhiChu(docNguon('main.js'));
  const dan = m.slice(m.indexOf("case 'INJECT_PASTE'"), m.indexOf("case 'INJECT_CLICK_CREATE'"));
  assert.ok(dan.indexOf('donAnhThamChieuTruocKhiDan(tab)') >= 0 &&
    dan.indexOf('donAnhThamChieuTruocKhiDan(tab)') < dan.indexOf('pastePrompt('), 'phải gỡ ảnh dính TRƯỚC khi dán');
  const don = thanHam(m, 'async function donAnhThamChieuTruocKhiDan');
  assert.ok(/tab\.goAnhTC/.test(don) && /thamChieu\.goHet\(/.test(don), 'chỉ gỡ khi mẻ cho phép (tab.goAnhTC)');
  assert.ok(/tab\.dungAnhTC\) return null/.test(thanHam(m, 'async function theoDoiAnhThamChieu')),
    'mẻ Character Sync / khung hình: không được theo dõi (lẫn ảnh cố ý)');
  // Đếm sau từng bước để lần ra bước nào làm ảnh dính.
  assert.ok(/theoDoiAnhThamChieu\(tab, `đổi tên/.test(m), 'chưa đếm sau bước đổi tên');
  assert.ok(/theoDoiAnhThamChieu\(tab, 'mở menu thẻ/.test(m), 'chưa đếm sau khi mở menu tải');
  assert.ok(/theoDoiAnhThamChieu\(t, 'tải về'\)/.test(m), 'chưa đếm sau khi tải xong');
  assert.ok(/theoDoiAnhThamChieu\(tab, 'bấm Tạo'\)/.test(m), 'chưa đếm sau khi bấm Tạo');
  assert.strictEqual((m.match(/^\s+await ganAnhThamChieu\(tab, settings\);/gm) || []).length, 2, 'gắn luật ở cả hai chỗ giao việc');
  const tabs = docNguon('src', 'main', 'tabs.js');
  assert.ok(/flow-anh-tham-chieu\.js/.test(tabs) && /\['trình dò ảnh tham chiếu', this\.thamChieuSource\]/.test(tabs),
    'tabs.js chưa tiêm flow-anh-tham-chieu.js');
  const app = docNguon('src', 'ui', 'app.js');
  const sw = app.slice(app.indexOf('const SWITCHES'), app.indexOf('];', app.indexOf('const SWITCHES')));
  assert.ok(/'goAnhThamChieu'/.test(sw), 'công tắc gỡ ảnh chưa được lưu / gửi đi');
  assert.ok(/id="goAnhThamChieu" checked/.test(docNguon('src', 'ui', 'index.html')), 'công tắc gỡ ảnh phải BẬT sẵn');
});

test('model ảnh: mặc định Nano Banana 2 Lite, áp sau khi đổi sang chế độ ảnh', () => {
  const html = docNguon('src', 'ui', 'index.html');
  assert.ok(/<option value="Nano Banana 2 Lite" selected>/.test(html), 'mặc định hộp Model ảnh phải là Nano Banana 2 Lite');
  const app = docNguon('src', 'ui', 'app.js');
  assert.ok(/const MODEL_ANH_MAC_DINH = 'Nano Banana 2 Lite'/.test(app));
  const fields = app.slice(app.indexOf('const FIELDS'), app.indexOf('];', app.indexOf('const FIELDS')));
  assert.ok(/'modelAnh'/.test(fields), 'modelAnh chưa được lưu / gửi đi');
  assert.ok(/if \(s\.modelAnh\) themLuaChonModelAnh\(\[s\.modelAnh\]\)/.test(thanHam(app, 'function applySettings')),
    'nạp lại cài đặt: tên model ảnh chưa có trong hộp sẽ bị mất');
  const boGhiChu = (t) => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const m = boGhiChu(docNguon('main.js'));
  const iCheDo = m.indexOf('if (settings.runMode) await datCheDo(tab, settings.runMode);');
  const iAnh = m.indexOf("if (settings.runMode === 'image') await datModelAnh(tab, settings);");
  assert.ok(iCheDo >= 0 && iAnh > iCheDo, 'phải chọn model ảnh SAU khi đã sang chế độ ảnh');
  const dma = thanHam(m, 'async function datModelAnh');
  assert.ok(/tab\.modelHienTai = null/.test(dma), 'chọn model ảnh xong phải xoá modelHienTai (của kế hoạch video)');
});

// ── 2.8.9a: đóng gói macOS — hai DMG không được trùng tên ổ đĩa ────────────
test('macOS: DMG arm64 và x64 gắn vào hai ổ đĩa khác tên', () => {
  // Lỗi CI 2.8.9: dmg.title không có ${arch} → cả hai bản cùng gắn vào
  // /Volumes/Flow Automation Studio <ver>, bản này tháo ổ của bản kia →
  // "hdiutil create/detach … Exit code 1". Tính tên đúng như dmg-builder làm
  // (node_modules/dmg-builder/out/dmg.js → computeVolumeName).
  const pkg = JSON.parse(docNguon('package.json'));
  const title = pkg.build && pkg.build.dmg && pkg.build.dmg.title;
  assert.ok(title, 'thiếu build.dmg.title');
  assert.ok(title.includes('${arch}'), 'dmg.title phải có ${arch} — nếu không hai bản DMG trùng ổ đĩa');
  let hauTo;
  try { hauTo = require('builder-util/out/arch').getArchSuffix; } catch (_) { hauTo = null; }
  const ten = (arch) => title
    .replace(/\$\{arch\}/g, hauTo ? hauTo(arch === 'x64' ? 1 : 3, undefined) : (arch === 'x64' ? '' : '-arm64'))
    .replace(/\$\{version\}/g, pkg.version).replace(/\$\{productName\}/g, pkg.productName);
  assert.notStrictEqual(ten('x64'), ten('arm64'), `trùng tên ổ đĩa: ${ten('x64')}`);
  // Vòng thử lại trong build-mac.yml là lớp phòng thêm, KHÔNG kiểm ở đây: file
  // workflow phải chép tay vào máy người dùng, thiếu nó thì CI vẫn phải chạy được.
});

// ── Kết luận ───────────────────────────────────────────────────────────────
(async () => {
await Promise.all(choAsync);
console.log('');
console.log('─'.repeat(58));
if (failures.length) {
  console.log(`KẾT QUẢ: ${pass} pass, ${failures.length} LỖI\n`);
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}\n`));
  console.log('─'.repeat(58));
  process.exit(1);
}
console.log(`KẾT QUẢ: ${pass}/${pass} PASS`);
console.log('─'.repeat(58));
console.log('');
})();
