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
  const m = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const lay = (dau) => { const i = m.indexOf(dau); return i < 0 ? '' : m.slice(i, i + 2500); };
  // 1. Đổi model trong lượt xin bấm Tạo — lúc engine đứng chờ.
  assert.ok(/modelChoPrompt/.test(lay("case 'ACQUIRE_CREATE_SLOT'")), 'ACQUIRE_CREATE_SLOT chưa chọn model');
  // 2. Engine chỉ xin lượt khi giãn cách > 0 → phải ép tối thiểu 1 giây.
  assert.ok(/multiTabStagger:\s*Math\.max\(1/.test(lay('async function chuanBiModel')), 'chưa ép giãn cách ≥ 1 giây');
  // 3. Cả hai đường giao việc (bấm Bắt đầu, và mẻ video nối sau ảnh).
  assert.ok(/chuanBiModel\(tab, settings\)[\s\S]{0,200}buildStartMessage\(prompts, part, caiDatTab\)/.test(m),
    'nút Bắt đầu chưa áp kế hoạch model');
  assert.ok(/chuanBiModel\(tab, settings\)[\s\S]{0,120}buildStartMessage\(prompts, jobs, caiDatTab\)/.test(m),
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
  for (const id of ['modelChinh', 'modelPhu', 'modelXenKe', 'modelDuPhong', 'modelThuLai', 'btnDocModel', 'dsModel']) {
    assert.ok(html.includes(`id="${id}"`), `thiếu ô #${id}`);
  }
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

// ── Kết luận ───────────────────────────────────────────────────────────────
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
