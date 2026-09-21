// ============================================================================
//  paste.js — DÁN PROMPT KHÔNG BỊ CẮT CỤT
//  --------------------------------------------------------------------------
//  Đây là lý do chính để bỏ tiện ích Chrome mà làm tool desktop.
//
//  VÌ SAO BẢN TIỆN ÍCH BỊ CẮT
//  Ô nhập prompt của Flow không phải <textarea>. Nó là editor Slate.js /
//  ProseMirror dựng trên contenteditable. Tiện ích buộc phải nhét chữ vào bằng
//  một trong hai đường, cả hai đều do TRANG WEB xử lý:
//
//    1. document.execCommand('insertText', ...)
//    2. dispatch một ClipboardEvent('paste') tự chế
//
//  Cả hai đều chỉ là "lời đề nghị": hàm xử lý paste của Slate/ProseMirror nhận
//  chuỗi rồi tự quyết định chèn bao nhiêu. Với prompt dài, hàm đó chuẩn hoá,
//  tách đoạn, và ở nhiều bản còn tự cắt bớt — nên chữ vào không đủ. Tiện ích
//  đứng ngoài trang web nên KHÔNG có cách nào ép nó nhận đủ.
//
//  BẢN DESKTOP LÀM KHÁC
//  Electron điều khiển thẳng Chromium ở tầng dưới trang web. Chữ được bơm qua
//  Input.insertText của giao thức DevTools — cùng con đường mà Chromium dùng
//  khi bạn gõ bằng bàn phím tiếng Việt (IME). Với trang web thì đây là gõ THẬT:
//  không qua hàm xử lý paste, nên không có chỗ nào cắt bớt.
//
//  Và quan trọng không kém: dán xong thì ĐỌC NGƯỢC LẠI độ dài trong editor rồi
//  so với độ dài đã gửi. Thiếu chữ là báo lỗi rõ ràng, không im lặng chạy tiếp
//  để rồi sinh ra video sai nội dung.
// ============================================================================

const { normalizeForCompare } = require('./text-utils');

// Bộ chọn ô nhập prompt — giữ đúng thứ tự ưu tiên của bản tiện ích 1.10.0.
const EDITOR_SELECTORS = [
  '.ProseMirror[contenteditable="true"]',
  'div[data-slate-editor="true"][contenteditable="true"][aria-multiline="true"]',
  'div[data-slate-editor="true"][contenteditable="true"][zindex="-1"]',
  'div[data-slate-editor="true"][role="textbox"][contenteditable="true"]',
  'div[contenteditable="true"][role="textbox"]'
];

// Chèn theo khối khi bơm một phát không đủ. 2000 ký tự/khối là mức an toàn:
// đủ lớn để prompt 20.000 ký tự chỉ mất 10 nhịp, đủ nhỏ để editor kịp dựng lại
// cây DOM giữa hai nhịp.
const CHUNK_SIZE = 2000;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Bật debugger của một webContents. Gọi nhiều lần vô hại.
 */
function ensureDebugger(wc) {
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    return true;
  } catch (err) {
    // Đã gắn sẵn bởi lời gọi khác thì cũng coi như thành công.
    if (/already attached/i.test(err.message)) return true;
    console.error('[paste] Không gắn được debugger:', err.message);
    return false;
  }
}

/**
 * Tìm ô nhập, cuộn tới, bấm vào, rồi xoá sạch nội dung cũ.
 * Trả về { ok, selector, error }.
 */
async function focusAndClearEditor(wc) {
  const script = `
    (async () => {
      const SELECTORS = ${JSON.stringify(EDITOR_SELECTORS)};
      const visible = (el) => {
        if (!el) return false;
        if (el.closest('[role="article"]')) return false;   // thẻ kết quả, không phải ô nhập
        const r = el.getBoundingClientRect();
        return el.offsetParent !== null || (r.width > 0 && r.height > 0);
      };

      let editor = null, used = null;
      for (const sel of SELECTORS) {
        for (const el of document.querySelectorAll(sel)) {
          if (visible(el)) { editor = el; used = sel; break; }
        }
        if (editor) break;
      }
      if (!editor) return { ok: false, error: 'Không tìm thấy ô nhập prompt trên trang Flow' };

      editor.scrollIntoView({ block: 'center' });
      editor.click();
      editor.focus();
      await new Promise(r => setTimeout(r, 150));

      // Bôi đen toàn bộ nội dung cũ để nhịp gõ đầu tiên ghi đè luôn.
      const range = document.createRange();
      range.selectNodeContents(editor);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      window.__flowPasteEditor = editor;   // để bước đọc ngược lại dùng đúng phần tử
      return { ok: true, selector: used, focused: document.activeElement === editor };
    })()
  `;
  return wc.executeJavaScript(script, true);
}

/**
 * Đọc lại chữ đang thật sự nằm trong editor.
 */
async function readEditorText(wc) {
  const script = `
    (() => {
      const el = window.__flowPasteEditor;
      if (!el || !el.isConnected) return { ok: false, error: 'Ô nhập đã biến mất khỏi trang' };
      return {
        ok: true,
        text: el.innerText || el.textContent || '',
        hasZeroWidth: !!el.querySelector('[data-slate-zero-width]')
      };
    })()
  `;
  return wc.executeJavaScript(script, true);
}

/**
 * Bơm chữ qua Input.insertText của giao thức DevTools.
 */
async function cdpInsert(wc, text) {
  await wc.debugger.sendCommand('Input.insertText', { text });
}

/**
 * Dán prompt vào ô nhập của Flow, có xác minh.
 *
 * @param {Electron.WebContents} wc  webContents của tab Flow
 * @param {string} text              prompt đầy đủ, không giới hạn độ dài
 * @param {(level:string, msg:string)=>void} log
 * @returns {Promise<{ok:boolean, expected:number, actual:number, method:string, error?:string}>}
 */
async function pastePrompt(wc, text, log = () => {}) {
  const expected = normalizeForCompare(text).length;

  const focus = await focusAndClearEditor(wc);
  if (!focus.ok) {
    return { ok: false, expected, actual: 0, method: 'none', error: focus.error };
  }
  log('info', `📝 Đã tìm thấy ô nhập (${focus.selector}), chuẩn bị bơm ${text.length} ký tự`);

  if (!ensureDebugger(wc)) {
    return {
      ok: false, expected, actual: 0, method: 'none',
      error: 'Không bật được kênh điều khiển Chromium (debugger). Hãy khởi động lại app.'
    };
  }

  // ── Nhịp 1: bơm một phát ────────────────────────────────────────────────
  try {
    await cdpInsert(wc, text);
  } catch (err) {
    return { ok: false, expected, actual: 0, method: 'cdp', error: `Input.insertText lỗi: ${err.message}` };
  }
  await wait(350);

  let check = await readEditorText(wc);
  if (check.ok) {
    const actual = normalizeForCompare(check.text).length;
    if (actual >= expected) {
      log('success', `✅ Đã bơm đủ ${actual}/${expected} ký tự (bơm một lần)`);
      return { ok: true, expected, actual, method: 'cdp-once' };
    }
    log('warning', `⚠️ Mới vào ${actual}/${expected} ký tự — chuyển sang bơm theo khối`);
  }

  // ── Nhịp 2: xoá sạch rồi bơm theo khối ─────────────────────────────────
  // Một số bản editor chặn chuỗi quá dài trong một sự kiện. Chia nhỏ thì qua.
  const refocus = await focusAndClearEditor(wc);
  if (!refocus.ok) {
    return { ok: false, expected, actual: 0, method: 'chunk', error: refocus.error };
  }

  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }

  try {
    for (let i = 0; i < chunks.length; i++) {
      await cdpInsert(wc, chunks[i]);
      await wait(120);
      if (chunks.length > 4 && i % 5 === 4) {
        log('info', `📝 Đang bơm… khối ${i + 1}/${chunks.length}`);
      }
    }
  } catch (err) {
    return { ok: false, expected, actual: 0, method: 'chunk', error: `Bơm theo khối lỗi: ${err.message}` };
  }
  await wait(400);

  check = await readEditorText(wc);
  if (!check.ok) {
    return { ok: false, expected, actual: 0, method: 'chunk', error: check.error };
  }

  const actual = normalizeForCompare(check.text).length;
  if (actual >= expected) {
    log('success', `✅ Đã bơm đủ ${actual}/${expected} ký tự (${chunks.length} khối)`);
    return { ok: true, expected, actual, method: 'cdp-chunk' };
  }

  // ── Thất bại: nói rõ thiếu bao nhiêu, KHÔNG im lặng chạy tiếp ───────────
  const missing = expected - actual;
  return {
    ok: false,
    expected,
    actual,
    method: 'cdp-chunk',
    error:
      `Ô nhập của Flow chỉ nhận ${actual}/${expected} ký tự (thiếu ${missing}). ` +
      `Đây là chốt chặn từ phía Google, không phải lỗi tool — ` +
      `hãy rút ngắn prompt hoặc tách thành nhiều prompt.`
  };
}

/**
 * Đổi tên tile trên Flow — cũng là một ô nhập, cũng cần bơm chữ tin cậy.
 */
async function typeIntoFocused(wc, text) {
  if (!ensureDebugger(wc)) return { ok: false, error: 'Không bật được debugger' };
  try {
    await cdpInsert(wc, text);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { pastePrompt, typeIntoFocused, ensureDebugger, EDITOR_SELECTORS };
