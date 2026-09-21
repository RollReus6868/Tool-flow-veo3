// ============================================================================
//  paste-main.js — KIỂM CHỨNG ĐƯỜNG DÁN PROMPT
//  --------------------------------------------------------------------------
//  Chạy:  electron tests/paste-main.js --no-sandbox
//
//  Dựng một ô nhập giả lập đúng hành vi cắt chữ của Slate/ProseMirror rồi:
//    A. Dán theo ĐƯỜNG CŨ (ClipboardEvent tự chế — cách tiện ích Chrome buộc
//       phải dùng)  ->  phải thấy bị CẮT. Nếu không cắt thì fixture sai.
//    B. Dán theo ĐƯỜNG MỚI (Input.insertText qua CDP)  ->  phải VÀO ĐỦ.
//
//  Không có bước A thì bước B không chứng minh được điều gì: phải thấy đường
//  cũ hỏng thật thì việc đường mới chạy được mới có ý nghĩa.
// ============================================================================

const { app, BrowserWindow } = require('electron');
const path = require('path');
const { pastePrompt } = require('../src/main/paste');

const CASES = [
  { name: 'ngắn 200 ký tự',         len: 200   },
  { name: 'vừa 1.500 ký tự',        len: 1500  },
  { name: 'dài 5.000 ký tự',        len: 5000  },
  { name: 'rất dài 20.000 ký tự',   len: 20000 }
];

// Văn bản thử có dấu tiếng Việt và xuống dòng — đúng kiểu prompt thật.
function makeText(len) {
  const unit = 'Một cảnh quay điện ảnh lúc hoàng hôn, ánh sáng vàng ấm trải dài trên mặt nước, máy quay lia chậm từ trái sang phải.\n';
  let out = '';
  while (out.length < len) out += unit;
  return out.slice(0, len);
}

const failures = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Phải đọc bằng innerText, KHÔNG phải textContent.
// Lý do đã trả giá một lần: khi bơm chữ nhiều dòng, trình duyệt dựng mỗi dòng
// thành một thẻ riêng; textContent nối các thẻ lại mà KHÔNG chèn ký tự xuống
// dòng, nên mỗi dòng "mất" đúng 1 ký tự. Đo kiểu đó thì prompt 20.000 ký tự
// hiện ra 19.828 và trông y như bị cắt, trong khi chữ vào đủ cả.
// innerText tái dựng đúng ngắt dòng nên mới so được.
async function readLen(wc) {
  return wc.executeJavaScript(
    `(document.querySelector('.ProseMirror').innerText || '').replace(/\\s+/g,' ').trim().length`, true
  );
}

async function clearEditor(wc) {
  await wc.executeJavaScript(`document.querySelector('.ProseMirror').textContent = '';`, true);
}

/** Đường CŨ: đúng cách tiện ích Chrome phải làm. */
async function pasteOldWay(wc, text) {
  await wc.executeJavaScript(`
    (() => {
      const ed = document.querySelector('.ProseMirror');
      ed.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', ${JSON.stringify(text)});
      ed.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return true;
    })()
  `, true);
  await wait(250);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 620, show: false });
  await win.loadFile(path.join(__dirname, 'fixture-slate.html'));
  const wc = win.webContents;
  await wait(400);

  const expected = (t) => t.replace(/\s+/g, ' ').trim().length;

  console.log('\n══════════ KIỂM CHỨNG ĐƯỜNG DÁN PROMPT ══════════\n');

  for (const c of CASES) {
    const text = makeText(c.len);
    const want = expected(text);

    // ── A. Đường cũ ────────────────────────────────────────────────────
    await clearEditor(wc);
    await pasteOldWay(wc, text);
    const oldLen = await readLen(wc);

    // ── B. Đường mới ───────────────────────────────────────────────────
    await clearEditor(wc);
    const res = await pastePrompt(wc, text, () => {});
    const newLen = await readLen(wc);

    const oldCut = oldLen < want;
    const newOk  = newLen >= want && res.ok;

    console.log(`${c.name}`);
    console.log(`   đường cũ (ClipboardEvent) : ${oldLen}/${want} ${oldCut ? '← BỊ CẮT (đúng như lỗi thật)' : '(không cắt)'}`);
    console.log(`   đường mới (Input.insertText): ${newLen}/${want} ${newOk ? '✓ ĐỦ' : '✗ THIẾU'}  [${res.method}]`);
    console.log('');

    if (!newOk) {
      failures.push(`${c.name}: đường mới chỉ vào ${newLen}/${want} (${res.error || 'không rõ'})`);
    }
    // Với chuỗi ngắn hơn ngưỡng cắt (1000) thì đường cũ không cắt là bình thường.
    if (want > 1000 && !oldCut) {
      failures.push(`${c.name}: fixture KHÔNG tái hiện được lỗi cắt — bài kiểm tra mất ý nghĩa`);
    }
  }

  // ── Kiểm tra thêm: ký tự tiếng Việt có dấu phải giữ nguyên ────────────
  const viText = 'Đường phố Hà Nội về đêm, đèn lồng đỏ, sương mù nhẹ — quay bằng ống kính 35mm, ấm áp và hoài cổ.';
  await clearEditor(wc);
  await pastePrompt(wc, viText, () => {});
  const got = await wc.executeJavaScript(
    `document.querySelector('.ProseMirror').innerText || ''`, true
  );
  if (got.replace(/\s+/g, ' ').trim() !== viText.replace(/\s+/g, ' ').trim()) {
    failures.push(`Chữ tiếng Việt bị đổi khi bơm.\n   gửi : ${viText}\n   nhận: ${got}`);
  } else {
    console.log('Tiếng Việt có dấu: giữ nguyên từng ký tự ✓\n');
  }

  console.log('─'.repeat(58));
  if (failures.length) {
    console.log(`KẾT QUẢ: ${failures.length} LỖI`);
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  } else {
    console.log('KẾT QUẢ: TẤT CẢ ĐỀU PASS');
  }
  console.log('─'.repeat(58) + '\n');

  app.exit(failures.length ? 1 : 0);
});
