'use strict';

// ============================================================================
//  nhip-thao-tac.js — nghỉ giữa các thao tác trong MỘT prompt (2.8.8)
//  --------------------------------------------------------------------------
//
//  Trước bản này, app chỉ có một nhịp: "chờ tối thiểu / tối đa" giữa hai lần
//  tạo. Bên trong một prompt thì mọi bước nối nhau sát sạt: nhập prompt xong
//  bấm Tạo ngay sau chưa tới một giây, mở menu tải xong chọn chất lượng ngay.
//
//  Nay người dùng bật được một khoảng nghỉ ngẫu nhiên [min, max] giây TRƯỚC
//  mỗi bước sau (đều là chỗ engine đứng chờ tiến trình chính trả lời, nên
//  nghỉ ở đây không phải sửa engine — xem README mục 1 của skill):
//
//     truocNhap    trước khi nhập prompt vào ô            (INJECT_PASTE)
//     truocTao     nhập xong, trước khi bấm Tạo           (INJECT_PASTE, sau khi dán)
//     truocModel   trước khi đổi model video              (ACQUIRE_CREATE_SLOT)
//     truocTai     menu tải đã mở, trước khi chọn chất lượng (SET_NEXT_FILENAME)
//     truocDoiTen  hộp đổi tên đã mở, trước khi gõ tên    (INJECT_RENAME_INPUT)
//
//  Nói thẳng: việc này làm tool chạy CHẬM và THƯA hơn — bớt số thao tác mỗi
//  phút gửi tới Flow. Nó không làm tool "vô hình": Google vẫn có nhiều cách
//  khác để biết đây là tool. Muốn bớt bị chặn thì số prompt mỗi ngày và số
//  tab chạy cùng lúc trên một tài khoản mới là thứ quyết định.
//
//  Cả file là hàm thuần (trừ nghi(), nhận sẵn hàm ngủ) để tests/run.js gọi thẳng.
// ============================================================================

const BUOC = {
  truocNhap:   'trước khi nhập prompt',
  truocTao:    'nhập xong, trước khi bấm Tạo',
  truocModel:  'trước khi đổi model',
  truocTai:    'trước khi chọn chất lượng tải về',
  truocDoiTen: 'trước khi gõ tên mới'
};

const MAC_DINH = { bat: false, min: 1, max: 4 };
const TRAN_GIAY = 60;           // một bước nghỉ tối đa 60 giây

/** Số giây, cho phép lẻ tới 0,1 (gõ "1,5" kiểu Việt cũng được). */
function soGiay(v, md) {
  const n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
  if (!isFinite(n)) return md;
  return Math.round(Math.min(TRAN_GIAY, Math.max(0, n)) * 10) / 10;
}

/**
 * Đọc từ bộ cài đặt phẳng giao diện gửi (nghiThaoTacBat/Min/Max).
 * Tối đa nhỏ hơn tối thiểu thì đổi chỗ — người dùng gõ ngược là chuyện thường.
 */
function chuanHoa(s) {
  const r = s || {};
  let min = soGiay(r.nghiThaoTacMin, MAC_DINH.min);
  let max = soGiay(r.nghiThaoTacMax, MAC_DINH.max);
  if (max < min) [min, max] = [max, min];
  const bat = !!r.nghiThaoTacBat && max > 0;
  return { bat, min, max };
}

/** Bốc một khoảng nghỉ (ms) trong [min, max]. rand để bài kiểm cố định được. */
function bocMs(k, rand = Math.random) {
  if (!k || !k.bat) return 0;
  const giay = k.min + (k.max - k.min) * Math.min(1, Math.max(0, rand()));
  return Math.round(giay * 1000);
}

function moTa(k) {
  if (!k || !k.bat) return 'tắt — các bước trong một prompt nối nhau như cũ';
  const so = (x) => String(x).replace('.', ',');
  return `nghỉ ngẫu nhiên ${so(k.min)}–${so(k.max)} giây trước mỗi bước ` +
    `(nhập prompt, bấm Tạo, đổi model, tải về, đổi tên)`;
}

/**
 * Nghỉ trước một bước. Dừng sớm nếu người dùng bấm Tạm dừng / Dừng (tab.huyNghiThaoTac
 * tăng lên) — không để họ bấm Dừng rồi còn phải chờ hết 60 giây.
 *
 * @param {object}   tab     tab đang chạy (đọc tab.nghiThaoTac, tab.huyNghiThaoTac)
 * @param {string}   buoc    một khoá của BUOC
 * @param {function} ghiLog  (msg) => void
 * @param {object}   [tuy]   { ngu: (ms)=>Promise, rand: ()=>number }  — cho bài kiểm
 * @returns {Promise<number>} số ms đã thật sự nghỉ
 */
async function nghi(tab, buoc, ghiLog, tuy = {}) {
  const k = tab && tab.nghiThaoTac;
  const ms = bocMs(k, tuy.rand);
  if (!ms) return 0;
  const ngu = tuy.ngu || ((t) => new Promise((r) => setTimeout(r, t)));
  const the = tab.huyNghiThaoTac || 0;

  // Ghi từng lần nghỉ cho 2 prompt đầu mỗi mẻ (đủ để thấy nó chạy), sau đó
  // im lặng — 5 dòng mỗi prompt nhân 100 prompt là chôn mất lỗi thật.
  tab.demNghiThaoTac = (tab.demNghiThaoTac || 0) + 1;
  if (typeof ghiLog === 'function') {
    if (tab.demNghiThaoTac <= 10) {
      ghiLog(`💤 Nghỉ ${(ms / 1000).toFixed(1).replace('.', ',')}s — ${BUOC[buoc] || buoc}`);
    } else if (tab.demNghiThaoTac === 11) {
      ghiLog('💤 (Từ đây không ghi từng lần nghỉ giữa thao tác nữa — vẫn đang nghỉ như cài đặt.)');
    }
  }

  let da = 0;
  while (da < ms) {
    if ((tab.huyNghiThaoTac || 0) !== the) break;
    const buocNgu = Math.min(250, ms - da);
    await ngu(buocNgu);
    da += buocNgu;
  }
  return da;
}

/** Gắn cấu hình cho tab lúc giao một mẻ mới. */
function ganChoTab(tab, settings) {
  if (!tab) return MAC_DINH;
  tab.nghiThaoTac = chuanHoa(settings);
  tab.demNghiThaoTac = 0;
  return tab.nghiThaoTac;
}

/** Tạm dừng / Dừng: cắt ngang mọi lần nghỉ đang dở của tab. */
function huy(tab) {
  if (tab) tab.huyNghiThaoTac = (tab.huyNghiThaoTac || 0) + 1;
}

module.exports = { BUOC, MAC_DINH, TRAN_GIAY, chuanHoa, bocMs, moTa, nghi, ganChoTab, huy };
