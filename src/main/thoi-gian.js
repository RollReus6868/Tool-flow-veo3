'use strict';

// ============================================================================
//  thoi-gian.js — thời gian đã chạy và dự đoán lúc xong CẢ QUY TRÌNH (2.8.9)
//  --------------------------------------------------------------------------
//  "Quy trình" = từ lúc bấm Bắt đầu tới khi tab xong hẳn, gồm cả mẻ video tự
//  nối sau mẻ ảnh. Đồng hồ KHÔNG đặt lại khi chuyển sang mẻ video.
//
//  Dự đoán thời gian còn lại = phần còn lại của mẻ đang chạy
//                            + mẻ video còn chờ nối (nếu có)
//                            + thời gian nghỉ hạ nhiệt còn lại (nếu đang nghỉ).
//
//  Tốc độ mỗi prompt lấy theo thứ tự tin cậy:
//    1. đo thật trong mẻ đang chạy (đã xong ≥ 1 prompt)          → 'thuc-te'
//    2. tốc độ các mẻ trước của chế độ đó (lưu trong store)        → 'lich-su'
//    3. số mặc định đo từ nhật ký 29/09: ảnh ~60 s, video ~105 s   → 'mac-dinh'
//  Mẻ video chờ nối chưa chạy nên luôn dùng (2) hoặc (3).
//
//  Hàm thuần — tests/run.js gọi thẳng với đồng hồ giả.
// ============================================================================

const MAC_DINH_MS = { image: 60000, video: 105000 };

/** Bắt đầu một quy trình mới (bấm Bắt đầu). */
function batDau(now, cheDo, tong, soVideoChoNoi) {
  return {
    batDau: now,
    ketThuc: null,
    pha: { cheDo: cheDo === 'image' ? 'image' : 'video', batDau: now, tong: Math.max(0, tong | 0) },
    choVideo: Math.max(0, soVideoChoNoi | 0)
  };
}

/** Mẻ ảnh xong, sang mẻ video nối tiếp — giữ nguyên đồng hồ tổng. */
function sangPhaVideo(q, now, tong) {
  if (!q) return batDau(now, 'video', tong, 0);
  return { ...q, ketThuc: null, pha: { cheDo: 'video', batDau: now, tong: Math.max(0, tong | 0) }, choVideo: 0 };
}

function ketThuc(q, now) {
  return q ? { ...q, ketThuc: q.ketThuc || now } : q;
}

/** Số ms mỗi prompt đo được trong mẻ (null nếu chưa xong cái nào). */
function tocDoPha(q, daXuLy, now) {
  if (!q || !q.pha || !(daXuLy > 0)) return null;
  const moc = q.ketThuc || now;
  return Math.max(1000, (moc - q.pha.batDau) / daXuLy);
}

/** Trộn tốc độ mới vào lịch sử (nửa cũ, nửa mới) — một mẻ lạ không kéo lệch hẳn. */
function ghiLichSu(lichSu, cheDo, msMoiPrompt) {
  const ls = { ...(lichSu || {}) };
  if (!(msMoiPrompt > 0) || !MAC_DINH_MS[cheDo]) return ls;
  ls[cheDo] = ls[cheDo] ? Math.round((ls[cheDo] + msMoiPrompt) / 2) : Math.round(msMoiPrompt);
  return ls;
}

/**
 * @param {object} q          quy trình của tab (batDau/sangPhaVideo/ketThuc)
 * @param {object} stats      { done, failed } của mẻ ĐANG chạy
 * @param {object} lichSu     { image?: ms, video?: ms }
 * @param {number} now
 * @param {number} [nghiConLai] ms nghỉ hạ nhiệt còn lại
 */
function uocTinh(q, stats, lichSu, now, nghiConLai = 0) {
  if (!q) return null;
  const daChayMs = Math.max(0, (q.ketThuc || now) - q.batDau);
  if (q.ketThuc) return { batDau: q.batDau, ketThuc: q.ketThuc, daChayMs, conLaiMs: 0, xongLuc: q.ketThuc, nguon: 'xong' };

  const ls = lichSu || {};
  const daXuLy = ((stats && stats.done) || 0) + ((stats && stats.failed) || 0);
  const tong = q.pha.tong;
  const conLaiPrompt = Math.max(0, tong - daXuLy);

  let nguon, msPha;
  const thuc = tocDoPha(q, daXuLy, now);
  if (thuc) {
    nguon = 'thuc-te';
    msPha = thuc * conLaiPrompt;
  } else {
    const moi = ls[q.pha.cheDo] || MAC_DINH_MS[q.pha.cheDo];
    nguon = ls[q.pha.cheDo] ? 'lich-su' : 'mac-dinh';
    // Chưa xong cái nào: trừ đi phần đã chạy của mẻ, nhưng đừng để về 0 khi
    // prompt đầu chạy lâu hơn dự kiến — còn ít nhất nửa prompt.
    msPha = Math.max(moi * tong - (now - q.pha.batDau), moi * 0.5);
  }
  const msVideo = q.choVideo ? q.choVideo * (ls.video || MAC_DINH_MS.video) : 0;
  if (q.choVideo && nguon === 'thuc-te') nguon = ls.video ? 'thuc-te' : 'thuc-te+mac-dinh';

  const conLaiMs = Math.round(msPha + msVideo + Math.max(0, nghiConLai || 0));
  return { batDau: q.batDau, ketThuc: null, daChayMs, conLaiMs, xongLuc: now + conLaiMs, nguon };
}

/** "1:05:09" / "12:04" — dùng chung cho giao diện và nhật ký. */
function dinhDang(ms) {
  const t = Math.max(0, Math.round((ms || 0) / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const hai = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${hai(m)}:${hai(s)}` : `${m}:${hai(s)}`;
}

module.exports = { MAC_DINH_MS, batDau, sangPhaVideo, ketThuc, tocDoPha, ghiLichSu, uocTinh, dinhDang };
