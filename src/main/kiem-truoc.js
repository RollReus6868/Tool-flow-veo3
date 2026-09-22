// ============================================================================
//  kiem-truoc.js — KIỂM CÀI ĐẶT NGAY TRƯỚC KHI GIAO MẺ CHO TAB
//  --------------------------------------------------------------------------
//  VÌ SAO (nhật ký 11:58 → 12:05 ngày 22/09/2026): tạo ảnh và video đều xong,
//  nhưng KHÔNG tải được gì:
//
//    • Video: "Đã bốc 1 thẻ từ bộ lọc Search!" rồi ngay lập tức
//      "Video 1/1 bị lỗi từ Google (Không thể tạo video). Đã skip."
//      Video không hề lỗi. Người dùng đã "Chọn trên trang" cho mục
//      "Thẻ video / ảnh" và trúng `span.settings-summary` — dòng chữ tóm tắt
//      model cạnh ô nhập, KHÔNG phải thẻ. Engine luôn ưu tiên selector người
//      dùng chỉ, nên bốc đúng cái span đó, không thấy <video> bên trong và
//      kết luận Google tạo hỏng.
//    • Ảnh: không có lấy một dòng "Bắt đầu tải tệp". Engine chỉ tải khi bộ
//      "Tải về — Ảnh" khác "Không tự tải" — nhật ký không hề nói bộ đó đang
//      đặt gì, nên người dùng không có cách nào biết.
//
//  Mục Chẩn đoán vẫn hiện ✅ cho cả hai, vì ✅ chỉ nghĩa là "selector khớp
//  một thứ gì đó", không phải "khớp đúng thứ".
//
//  File này làm hai việc trước mỗi mẻ:
//    1. Hỏi trang: selector người dùng chỉ cho "Thẻ video / ảnh" và "Nút ⋮
//       trên thẻ" có trỏ vào thứ trông giống thẻ không. Rõ ràng sai thì BỎ
//       selector đó cho mẻ này (dùng mặc định) và nói ra trong nhật ký.
//       Không phán được (lưới đang trống) thì giữ nguyên.
//    2. Ghi ra nhật ký mẻ này sẽ tải về thế nào.
// ============================================================================

/** Chạy TRONG trang Flow. Trả { tile: {sai, lyDo}, downloadBtn: {...} }. */
function kichBanKiemSelector(selectors) {
  return `(() => {
    const S = ${JSON.stringify(selectors || {})};
    const THE = 'flow-tile-container, flow-image-tile, flow-video-tile, [data-tile-id]';
    const NGOAI_LUOI = 'flow-prompt-box, flow-base-prompt-box, flow-navigation-header, ' +
                       'flow-tile-view-header, mat-sidenav, [contenteditable="true"]';
    const lay = (sel) => { try { return Array.from(document.querySelectorAll(sel)); } catch (_) { return null; } };
    const chuoi = (v) => typeof v === 'string' ? v : (v && v.selector) || '';
    const kq = {};

    const tSel = chuoi(S.tile).trim();
    if (tSel) {
      const ds = lay(tSel);
      if (ds === null) kq.tile = { sai: true, lyDo: 'selector viết sai cú pháp' };
      else if (ds.length) {
        const giongThe = (el) => el.matches(THE) || !!el.querySelector(THE) || !!el.querySelector('img, video');
        const ngoai = ds.filter((el) => el.closest(NGOAI_LUOI)).length;
        if (!ds.some(giongThe)) {
          kq.tile = { sai: true, lyDo: ngoai
            ? 'nó trỏ vào ' + ds.length + ' phần tử nằm ở ô nhập / thanh bên / đầu trang, không phải lưới kết quả'
            : 'không phần tử nào nó khớp có chứa ảnh hay video' };
        }
      }
    }

    const dSel = chuoi(S.downloadBtn).trim();
    if (dSel) {
      const ds = lay(dSel);
      const the = lay(THE) || [];
      if (ds === null) kq.downloadBtn = { sai: true, lyDo: 'selector viết sai cú pháp' };
      else if (ds.length && the.length && !ds.some((el) => the.some((t) => t.contains(el)))) {
        kq.downloadBtn = { sai: true, lyDo: 'không nút nào nó khớp nằm trong một thẻ ảnh/video' };
      }
    }
    return kq;
  })()`;
}

// Selector đã bị bỏ (theo ĐÚNG chuỗi selector). Engine đọc lại cài đặt từ
// kho mỗi lần trang F5 (chrome.storage 'veoSettings'), nên chỉ bỏ trong bộ cài
// đặt gửi kèm mẻ là chưa đủ: sau F5 selector sai quay lại. locVeoSettings() lọc
// cả ở đường đó. Nhớ theo chuỗi — người dùng chỉ lại selector mới thì không bị lọc.
const DA_BO = new Map();

function locVeoSettings(kq) {
  if (!DA_BO.size || !kq || !kq.veoSettings || !kq.veoSettings.selectors) return kq;
  const sel = { ...kq.veoSettings.selectors };
  let doi = false;
  for (const [k, v] of DA_BO) {
    const cu = typeof sel[k] === 'string' ? sel[k] : (sel[k] && sel[k].selector) || '';
    if (cu && cu === v) { delete sel[k]; doi = true; }
  }
  return doi ? { ...kq, veoSettings: { ...kq.veoSettings, selectors: sel } } : kq;
}

const TEN_MUC = { tile: 'Thẻ video / ảnh', downloadBtn: 'Nút ⋮ trên thẻ' };
const TEN_CACH = { none: 'Không tự tải', single: 'Tải từng media (có đổi tên)', zip: 'Tải gộp .zip' };

/** Dòng nhật ký nói mẻ này tải về thế nào. Thuần — kiểm được bằng node. */
function moTaTaiVe(s) {
  const bo = s.runMode === 'image' ? 'Ảnh' : 'Video';
  const cach = TEN_CACH[s.downloadMode] || (s.autoDownload ? 'Tải từng media' : 'Không tự tải');
  if (!s.autoDownload && !s.downloadZip) {
    return { muc: 'warning', chu: `📥 Mẻ ${bo.toLowerCase()} này KHÔNG tự tải về — bộ "Tải về — ${bo}" đang là "Không tự tải". ` +
      `Muốn tải thì vào Cài đặt → Tải về — ${bo} → Cách tải.` };
  }
  const thuMuc = s.downloadSubfolder ? ` vào thư mục con "${s.downloadSubfolder}"` : '';
  return { muc: 'info', chu: `📥 Mẻ ${bo.toLowerCase()} này: ${cach}${thuMuc}.` };
}

/**
 * Trả về BẢN SAO cài đặt đã bỏ selector sai (nếu có). Không bao giờ ném lỗi:
 * kiểm không được thì giao nguyên cài đặt như cũ.
 */
async function kiemTruocKhiChay(wc, settings, log) {
  const s = { ...settings };
  try { const m = moTaTaiVe(s); log(m.muc, m.chu); } catch (_) {}
  const sel = s.selectors && typeof s.selectors === 'object' ? s.selectors : null;
  if (!sel || !(sel.tile || sel.downloadBtn)) return s;
  let kq = {};
  try { kq = (await wc.executeJavaScript(kichBanKiemSelector(sel), true)) || {}; } catch (_) { return s; }
  const moi = { ...sel };
  for (const k of Object.keys(TEN_MUC)) {
    if (kq[k] && kq[k].sai) {
      const cu = typeof moi[k] === 'string' ? moi[k] : (moi[k] && moi[k].selector) || '';
      delete moi[k];
      DA_BO.set(k, cu);
      log('warning', `⚠️ Bỏ qua selector bạn chỉ cho "${TEN_MUC[k]}" (${cu}): ${kq[k].lyDo}. ` +
        `Mẻ này dùng selector mặc định. Vào Cài đặt → Chẩn đoán giao diện Flow, bấm ✕ đỏ ở dòng "${TEN_MUC[k]}" để khỏi thấy lại cảnh báo này.`);
    }
  }
  s.selectors = moi;
  return s;
}

module.exports = { kiemTruocKhiChay, kichBanKiemSelector, moTaTaiVe, locVeoSettings, _DA_BO: DA_BO };
