'use strict';

// ============================================================================
//  model.js — kế hoạch model video cho từng mẻ, và chuyện Lower Priority
//  --------------------------------------------------------------------------
//
//  BA VIỆC, TẤT CẢ ĐỀU TUỲ CHỌN (để trống = giữ nguyên như bản cũ: Flow đang
//  chọn model nào thì chạy model đó, app không đụng vào):
//
//    1. MODEL CHÍNH — trước khi chạy, app tự chọn model này trên trang Flow.
//
//    2. XEN KẼ — cứ N prompt thì 1 prompt dùng MODEL PHỤ. Ví dụ N = 2 là
//       chính, phụ, chính, phụ… Đây là chuyện CHI TIÊU (một nửa miễn phí, một
//       nửa tốn credit), không phải cách để Flow thôi chặn: prompt chạy bằng
//       Lower Priority vẫn đi qua đúng hàng đợi đó.
//
//    3. DỰ PHÒNG KHI LOWER PRIORITY BỊ CHẶN — khi đang chạy "Veo 3.1 - Lite
//       [Lower Priority]" mà Flow báo hoạt động bất thường, thay vì cho cả tài
//       khoản nghỉ (chế độ an toàn), app:
//         • NGỪNG gửi Lower Priority của tài khoản đó một thời gian,
//         • chuyển sang model dự phòng (tốn credit) và chạy tiếp ngay —
//           prompt vừa hỏng được engine thử lại bằng model dự phòng,
//         • hết giờ thì prompt MỚI thử lại Lower Priority; bị lại thì chờ lâu
//           gấp đôi (30 → 60 → 120 phút, trần 4 giờ).
//
//  VÌ SAO KHÔNG "CỐ" LOWER PRIORITY TIẾP
//  Lower Priority là hàng miễn phí, nằm cuối hàng đợi, và là chỗ Google canh
//  máy tự động gắt nhất. Đã bị nhắc mà vẫn gửi tiếp thì chỉ làm cờ đỏ đậm hơn,
//  có khi lan sang cả các model trả phí của tài khoản. Tránh ra một lúc là
//  cách duy nhất vừa tử tế vừa hiệu quả.
//
//  Cả file là hàm thuần để tests/run.js gọi thẳng được.
// ============================================================================

/** Model Flow đang cho chọn (ảnh chụp người dùng gửi 09/2026). */
const MODEL_GOI_Y = [
  'Veo 3.1 - Lite [Lower Priority]',
  'Veo 3.1 - Lite',
  'Veo 3.1 - Fast',
  'Veo 3.1 - Quality',
  'Omni 1.1 Flash'
];

/**
 * Khoá so sánh — PHẢI giống hệt khoa() trong src/inject/flow-model.js.
 * (tests/run.js so hai bản với nhau.) Chỉ giữ chữ và số: "Veo 3.1 - Lite" và
 * "Veo 3.1 - Lite [Lower Priority]" ra hai khoá khác nhau, không phải tiền tố.
 */
function khoaModel(ten) {
  return String(ten == null ? '' : ten)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/volume_up|volume_off|arrow_drop_down/g, '')
    .replace(/[^a-z0-9]/g, '');
}

const cungModel = (a, b) => !!khoaModel(a) && khoaModel(a) === khoaModel(b);

/** Model miễn phí xếp hàng thấp — thứ Google canh gắt nhất. */
function laLowerPriority(ten) {
  return khoaModel(ten).includes('lowerpriority');
}

const MAC_DINH = {
  chinh: '',          // '' = giữ nguyên model đang chọn trên Flow
  phu: '',            // model xen kẽ
  xenKeMoi: 0,        // cứ N prompt thì 1 prompt dùng model phụ (0 = tắt)
  duPhong: '',        // model dùng khi Lower Priority bị chặn ('' = không, nghỉ như cũ)
  thuLaiPhut: 30      // bao lâu sau thì thử lại Lower Priority
};

function chuanHoaKeHoach(raw) {
  const r = raw || {};
  const chuoi = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 80);
  const so = (v, md, min, max) => {
    const n = parseInt(v, 10);
    return isNaN(n) ? md : Math.min(max, Math.max(min, n));
  };
  const k = {
    chinh:      chuoi(r.chinh),
    phu:        chuoi(r.phu),
    xenKeMoi:   so(r.xenKeMoi, MAC_DINH.xenKeMoi, 0, 50),
    duPhong:    chuoi(r.duPhong),
    thuLaiPhut: so(r.thuLaiPhut, MAC_DINH.thuLaiPhut, 5, 240)
  };
  // Xen kẽ mà thiếu model phụ, hoặc N = 1 (mọi prompt đều "phụ" = đổi model
  // chính cho khác đi), thì coi như tắt — nói rõ ở giao diện chứ không đoán.
  if (!k.phu || k.xenKeMoi < 2) { k.xenKeMoi = 0; }
  // Dự phòng mà lại là Lower Priority thì vô nghĩa (chính nó đang bị chặn).
  if (laLowerPriority(k.duPhong)) k.duPhong = '';
  return k;
}

/** Kế hoạch này có bắt app phải đụng vào hộp chọn model không. */
function coHieuLuc(k) {
  return !!(k && (k.chinh || (k.phu && k.xenKeMoi >= 2) || k.duPhong));
}

/**
 * Model cho prompt MỚI thứ `thuTu` (1, 2, 3…) của một tab.
 *
 * @param {object}  k           kế hoạch đã chuẩn hoá
 * @param {number}  thuTu       prompt mới thứ mấy của tab (đếm từ 1)
 * @param {boolean} lpDangChan  Lower Priority của tài khoản đang bị chặn
 * @returns {{model:string, lyDo:string}}  model '' = không đổi gì
 */
function modelChoPrompt(k, thuTu, lpDangChan) {
  if (!k) return { model: '', lyDo: '' };
  const n = Math.max(1, Number(thuTu) || 1);
  let model = k.chinh;
  let lyDo = 'model chính';
  if (k.phu && k.xenKeMoi >= 2 && n % k.xenKeMoi === 0) {
    model = k.phu;
    lyDo = `xen kẽ (prompt thứ ${n})`;
  }
  if (lpDangChan && laLowerPriority(model) && k.duPhong) {
    return { model: k.duPhong, lyDo: 'Lower Priority đang bị Flow chặn — dùng model dự phòng' };
  }
  return { model: model || '', lyDo: model ? lyDo : '' };
}

/**
 * Nên chuyển sang dự phòng thay vì cho cả tài khoản nghỉ không?
 * Chỉ khi: tab đang chạy Lower Priority, có dự phòng, và dự phòng khác nó.
 */
function nenChuyenDuPhong(k, modelHienTai) {
  return !!(k && k.duPhong && laLowerPriority(modelHienTai) && !cungModel(k.duPhong, modelHienTai));
}

/** Chờ bao lâu mới thử lại Lower Priority. Gấp đôi mỗi lần bị lại, trần 4 giờ. */
function thoiGianTranhLp(soLanBiChan, thuLaiPhut) {
  const lan = Math.max(1, Number(soLanBiChan) || 1);
  const goc = Math.max(5, Number(thuLaiPhut) || MAC_DINH.thuLaiPhut);
  return Math.round(Math.min(240, goc * Math.pow(2, Math.min(lan - 1, 6))) * 60000);
}

/** Mô tả kế hoạch cho nhật ký — một dòng người đọc hiểu được. */
function moTaKeHoach(k) {
  if (!coHieuLuc(k)) return 'giữ nguyên model đang chọn trên Flow';
  const phan = [];
  if (k.chinh) phan.push(`chính: ${k.chinh}`);
  if (k.phu && k.xenKeMoi >= 2) phan.push(`cứ ${k.xenKeMoi} prompt thì 1 prompt dùng ${k.phu}`);
  if (k.duPhong) phan.push(`Lower Priority bị chặn → ${k.duPhong}, ${k.thuLaiPhut} phút sau thử lại`);
  return phan.join(' · ');
}

module.exports = {
  MODEL_GOI_Y,
  MAC_DINH,
  khoaModel,
  cungModel,
  laLowerPriority,
  chuanHoaKeHoach,
  coHieuLuc,
  modelChoPrompt,
  nenChuyenDuPhong,
  thoiGianTranhLp,
  moTaKeHoach
};
