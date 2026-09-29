'use strict';

// ============================================================================
//  anh-tham-chieu.js — đếm và gỡ ảnh tham chiếu bị dính trong ô nhập (2.8.9)
//  --------------------------------------------------------------------------
//  Phần chạy trong trang: src/inject/flow-anh-tham-chieu.js (đọc đầu file đó
//  để biết triệu chứng). Gỡ mỗi ảnh theo hai nấc, dừng ngay khi ăn:
//    1. bấm nút ✕ bằng sự kiện JavaScript — chạy được cả khi tab đang ẩn;
//    2. không ăn thì rê + bấm CHUỘT THẬT qua kênh debugger (như nút Tạo,
//       README 0o). Lưu ý đo được trong tests/model-e2e.js: tab chạy ngầm
//       không nhận chuột thật (mỗi cú chờ 5 giây rồi rơi mất) — nấc 2 chỉ
//       giúp khi tab đang hiện trên màn hình.
//
//  Luật dùng (main.js):
//    • Mẻ KHÔNG bật Character Sync / Đồng bộ khung hình → app không hề gắn
//      ảnh nào, nên mọi ảnh trong ô nhập trước lúc dán là ảnh dính: GỠ.
//    • Mẻ CÓ bật hai thứ đó → engine tự gắn ảnh ngay trước khi dán, không
//      phân biệt được ảnh nào là dính: CHỈ GHI NHẬT KÝ, không gỡ.
//    • Người dùng tắt "Gỡ ảnh tham chiếu bị dính" (họ tự gắn ảnh cho cả mẻ):
//      chỉ ghi nhật ký.
// ============================================================================

const { bamChuotThat, reChuotThat } = require('./paste');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Mẻ này có được phép tự gỡ không. Mặc định BẬT khi người dùng chưa từng chỉnh. */
function nenGo(settings) {
  const s = settings || {};
  if (s.goAnhThamChieu === false) return false;
  return !s.charSync && !s.keyframeSync;
}

async function dem(wc) {
  try {
    const r = await wc.executeJavaScript(
      'window.__flowDemAnhThamChieu ? window.__flowDemAnhThamChieu() : null', true);
    return r || { ok: false, so: 0, lyDo: 'chưa tiêm flow-anh-tham-chieu.js', ds: [] };
  } catch (err) {
    return { ok: false, so: 0, lyDo: err.message, ds: [] };
  }
}

/**
 * Gỡ hết ảnh trong ô nhập. Mỗi lần gỡ một ảnh rồi đếm lại — bấm ✕ không làm
 * số giảm thì DỪNG và báo, không bấm bừa lần nữa.
 *
 * @returns {Promise<{ok:boolean, daGo:number, conLai:number, lyDo?:string, nut?:string}>}
 */
async function goHet(wc, tuy = {}) {
  const toiDa = tuy.toiDa || 6;
  let daGo = 0;
  let nut = '';
  for (let lan = 0; lan < toiDa; lan++) {
    const d = await dem(wc);
    if (!d.ok) return { ok: false, daGo, conLai: 0, lyDo: d.lyDo };
    if (!d.so) return { ok: true, daGo, conLai: 0, nut };

    // 1. Bấm bằng JavaScript — chạy được cả khi tab đang ẩn.
    const j = await wc.executeJavaScript('window.__flowGoAnhThamChieuJs(0)', true).catch((e) => ({ ok: false, lyDo: e.message }));
    if (!j || !j.ok) return { ok: false, daGo, conLai: d.so, lyDo: (j && j.lyDo) || 'không bấm được' };
    await wait(tuy.choSauBam || 600);
    const dj = await dem(wc);
    if (dj.so < d.so) { daGo += d.so - dj.so; nut = j.nut || nut; continue; }

    // 2. Không ăn → chuột thật (chỉ tới được khi tab đang hiện trên màn hình).
    const goi = 'window.__flowViTriGoAnhThamChieu(0)';
    let v = await wc.executeJavaScript(goi, true).catch((e) => ({ ok: false, lyDo: e.message }));
    if (v && v.canRe) {
      // Nút ✕ chỉ hiện khi rê chuột vào ảnh — rê bằng chuột thật rồi hỏi lại.
      await reChuotThat(wc, v.rx, v.ry);
      await wait(400);
      v = await wc.executeJavaScript(goi, true).catch((e) => ({ ok: false, lyDo: e.message }));
    }
    if (!v || !v.ok || v.canRe) {
      return { ok: false, daGo, conLai: d.so, lyDo: (v && v.lyDo) || 'nút ✕ không hiện kể cả khi rê chuột vào ảnh' };
    }
    nut = v.nut || nut;
    const b = await bamChuotThat(wc, v.x, v.y);
    if (!b.ok) return { ok: false, daGo, conLai: d.so, lyDo: b.error };
    await wait(tuy.choSauBam || 600);
    const d2 = await dem(wc);
    if (d2.so >= d.so) return { ok: false, daGo, conLai: d2.so, lyDo: `bấm nút "${v.nut}" mà ảnh vẫn còn`, nut };
    daGo += d.so - d2.so;
  }
  const cuoi = await dem(wc);
  return { ok: !cuoi.so, daGo, conLai: cuoi.so, nut, lyDo: cuoi.so ? 'còn ảnh sau ' + toiDa + ' lần gỡ' : undefined };
}

module.exports = { nenGo, dem, goHet };
