'use strict';

// ============================================================================
//  an-toan.js — hạ nhịp và tự nghỉ khi Flow bắt đầu coi mình là máy
//  --------------------------------------------------------------------------
//
//  VẤN ĐỀ THẬT
//  Chạy nhiều tab, chạy liên tục, thì tới một lúc Flow trả về thẻ đỏ:
//
//      "Không thành công — Chúng tôi nhận thấy có hoạt động bất thường nào đó."
//
//  Và từ đó trở đi MỌI prompt đều hỏng. Tệ hơn nữa: engine thấy lỗi thì thử
//  lại, mỗi prompt tới maxRetries lần. Nên đúng lúc Google đang khó chịu nhất
//  thì tool lại gõ cửa dồn dập nhất, và cả mẻ 30 prompt cháy sạch trong vài
//  phút — đúng cảnh "0/30 xong · 30 lỗi".
//
//  CHỖ NÀY LÀM ĐƯỢC GÌ, VÀ KHÔNG LÀM GÌ
//  Không có cách nào "qua mặt" bộ dò của Google, và file này không thử làm
//  thế: không giả vân tay trình duyệt, không đổi IP, không đụng tới CAPTCHA.
//  Việc nó làm là thứ tử tế hơn và thật ra hiệu quả hơn: gõ cửa thưa hơn, và
//  khi đã bị nhắc thì IM LẶNG NGHỈ một lúc thay vì cố đấm thêm.
//
//    • Nhận ra sớm — 2-3 lỗi liên tiếp là đủ để nghi, không đợi cháy cả mẻ.
//    • Dừng ngay cả tài khoản (mọi tab), vì Google chặn theo TÀI KHOẢN chứ
//      không theo tab.
//    • Nghỉ tăng dần: lần đầu 10 phút, bị lại thì 20, rồi 40 — vì bị chặn hai
//      lần liền nghĩa là 10 phút chưa đủ.
//    • Tự chạy tiếp sau khi nghỉ, không bắt người dùng ngồi canh.
//
//  Cả file là hàm thuần (trừ chỗ nói rõ), để tests/run.js gọi thẳng được.
// ============================================================================

// ── Những câu Flow/Google hiện ra khi đã coi mình là bất thường ────────────
//
//  Viết sẵn dạng KHÔNG DẤU, chữ thường. Trang Flow có lúc tiếng Việt có lúc
//  tiếng Anh tuỳ ngôn ngữ tài khoản, nên phải có cả hai.
const CUM_TU_CHAN = [
  'hoat dong bat thuong',      // "Chúng tôi nhận thấy có hoạt động bất thường"
  'luu luong bat thuong',
  'unusual activity',
  'unusual traffic',
  'suspicious activity',
  'qua nhieu yeu cau',
  'too many requests',
  'rate limit',
  'quota exceeded',
  'vuot qua han muc',
  'tam thoi bi chan',
  'temporarily blocked',
  'try again later',
  'thu lai sau'
];

// Câu báo lỗi chung chung của engine — KHÔNG đủ để kết luận bị chặn, nhưng
// nhiều cái liên tiếp thì đáng nghi.
const LOI_CHUNG = 'khong thanh cong';

/** Bỏ dấu tiếng Việt + hạ chữ thường, để so chuỗi không lệch vì dấu. */
function boDau(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase();
}

/**
 * Câu này có phải lời Google nói mình đang bất thường không?
 * Dùng cho cả chữ đọc từ DOM lẫn chữ trong trường `error` của engine.
 */
function laCanhBaoChan(text) {
  const t = boDau(text);
  if (!t) return false;
  return CUM_TU_CHAN.some((c) => t.includes(c));
}

/** Lỗi chung chung ("Không thành công") — đáng nghi nhưng chưa chắc chắn. */
function laLoiChungChung(text) {
  return boDau(text).includes(LOI_CHUNG);
}

// ── Cài đặt ────────────────────────────────────────────────────────────────

const MAC_DINH = {
  bat: true,            // bật chế độ an toàn
  nguong: 3,            // bao nhiêu prompt lỗi thì nghi bị chặn
  cuaSoPhut: 5,         // ...trong vòng bấy nhiêu phút
  nghiPhut: 10,         // nghỉ bao lâu ở lần bị chặn đầu tiên
  nhanDoi: true,        // bị lại thì nghỉ gấp đôi
  nghiToiDaPhut: 60,    // trần, để không nghỉ tới sáng
  cuMoi: 0,             // nghỉ giải lao sau mỗi N prompt xong (0 = tắt)
  giaiLaoPhut: 5        // ...nghỉ bấy nhiêu phút
};

/**
 * Nhặt cài đặt an toàn từ giao diện về dạng số sạch sẽ.
 * Giao diện gửi lên toàn chuỗi, và người dùng gõ được cả chữ vào ô số.
 */
function chuanHoaCaiDat(raw) {
  const r = raw || {};
  const so = (v, md, min, max) => {
    const n = parseInt(v, 10);
    if (isNaN(n)) return md;
    return Math.min(max, Math.max(min, n));
  };
  return {
    bat:           r.bat === undefined ? MAC_DINH.bat : !!r.bat,
    nguong:        so(r.nguong,        MAC_DINH.nguong,        1, 50),
    cuaSoPhut:     so(r.cuaSoPhut,     MAC_DINH.cuaSoPhut,     1, 120),
    nghiPhut:      so(r.nghiPhut,      MAC_DINH.nghiPhut,      1, 240),
    nhanDoi:       r.nhanDoi === undefined ? MAC_DINH.nhanDoi : !!r.nhanDoi,
    nghiToiDaPhut: so(r.nghiToiDaPhut, MAC_DINH.nghiToiDaPhut, 1, 600),
    cuMoi:         so(r.cuMoi,         MAC_DINH.cuMoi,         0, 500),
    giaiLaoPhut:   so(r.giaiLaoPhut,   MAC_DINH.giaiLaoPhut,   1, 120)
  };
}

// ── Theo dõi lỗi ───────────────────────────────────────────────────────────

/** Sổ theo dõi rỗng cho MỘT tài khoản. */
function soMoi() {
  return {
    moc: [],            // thời điểm (ms) của từng prompt lỗi gần đây
    coCauChan: false,   // đã đọc được đúng câu "hoạt động bất thường" chưa
    soLanBiChan: 0,     // đã phải nghỉ mấy lần trong phiên này
    dangNghi: false,
    nghiDen: 0,
    mocGiaiLao: 0       // số prompt đã xong ở lần giải lao gần nhất
  };
}

/**
 * Tìm những prompt VỪA chuyển sang lỗi, chưa được đếm lần nào.
 *
 * Phải lọc trùng: engine gửi lại NGUYÊN bảng mỗi vài giây, nên một prompt lỗi
 * sẽ xuất hiện trong hàng chục lượt gửi liên tiếp. Đếm thẳng thì chỉ một lỗi
 * duy nhất cũng vượt ngưỡng trong nháy mắt.
 *
 * @param {Array}  rows    mảng hàng engine gửi lên
 * @param {Set}    daDem   chỉ số các prompt đã đếm rồi (bị sửa tại chỗ)
 * @returns {{chiSo:number, loi:string, chacChan:boolean}[]}
 */
function loiMoi(rows, daDem) {
  const ds = Array.isArray(rows) ? rows : [];
  const ra = [];
  for (const r of ds) {
    if (!r || r.status !== 'ERROR') continue;
    // Khoá theo cả số lần thử: engine thử lại thì retries tăng, và lần hỏng
    // thứ hai của cùng một prompt là một lần gõ cửa mới thật sự.
    const khoa = `${r.index}#${r.retries || 0}`;
    if (daDem.has(khoa)) continue;
    daDem.add(khoa);
    ra.push({
      chiSo: r.index,
      loi: r.error || '',
      chacChan: laCanhBaoChan(r.error)
    });
  }
  return ra;
}

/**
 * Đếm số lỗi còn nằm trong cửa sổ thời gian, và bỏ những mốc đã quá cũ.
 * Sửa `moc` tại chỗ để sổ không phình mãi trong phiên chạy dài.
 */
function locTheoCuaSo(moc, bayGio, cuaSoPhut) {
  const gioiHan = bayGio - cuaSoPhut * 60000;
  let i = 0;
  while (i < moc.length && moc[i] < gioiHan) i++;
  if (i > 0) moc.splice(0, i);
  return moc.length;
}

/**
 * Có nên cho tài khoản này nghỉ không?
 *
 * Hai đường dẫn tới "có":
 *   • Đọc được đúng câu "hoạt động bất thường" trên trang → chắc chắn, nghỉ
 *     ngay từ lỗi đầu tiên, khỏi đợi đủ ngưỡng.
 *   • Chưa đọc được câu đó, nhưng số lỗi trong cửa sổ đã chạm ngưỡng → nghi.
 */
function canNghi(so, bayGio, caiDat) {
  if (!caiDat.bat) return { nghi: false };
  if (so.dangNghi)  return { nghi: false };

  const trongCuaSo = locTheoCuaSo(so.moc, bayGio, caiDat.cuaSoPhut);

  if (so.coCauChan && trongCuaSo >= 1) {
    return {
      nghi: true,
      chacChan: true,
      soLoi: trongCuaSo,
      lyDo: 'Trang Flow đang hiện thông báo hoạt động bất thường'
    };
  }
  if (trongCuaSo >= caiDat.nguong) {
    return {
      nghi: true,
      chacChan: false,
      soLoi: trongCuaSo,
      lyDo: `${trongCuaSo} prompt hỏng trong ${caiDat.cuaSoPhut} phút`
    };
  }
  return { nghi: false, soLoi: trongCuaSo };
}

/**
 * Nghỉ bao lâu (mili-giây). Tăng gấp đôi mỗi lần bị chặn lại, vì bị chặn
 * lần nữa ngay sau khi chạy lại nghĩa là lần nghỉ trước chưa đủ.
 *
 * @param {number} soLanBiChan số lần ĐÃ nghỉ trước đó (0 = lần đầu)
 */
function thoiGianNghi(soLanBiChan, caiDat) {
  const c = caiDat || MAC_DINH;
  const lan = Math.max(0, Number(soLanBiChan) || 0);
  const heSo = c.nhanDoi ? Math.pow(2, Math.min(lan, 10)) : 1;
  const phut = Math.min(c.nghiToiDaPhut, c.nghiPhut * heSo);
  return Math.round(phut * 60000);
}

/**
 * Đã tới lúc giải lao định kỳ chưa? Khác với nghỉ-do-bị-chặn: cái này là
 * phòng bệnh, nghỉ trước khi Google kịp khó chịu.
 *
 * @param {number} daXong tổng số prompt đã xong của tài khoản
 */
function canGiaiLao(so, daXong, caiDat) {
  if (!caiDat.bat || !caiDat.cuMoi) return { nghi: false };
  if (so.dangNghi) return { nghi: false };
  const xong = Math.max(0, Number(daXong) || 0);
  if (xong - so.mocGiaiLao < caiDat.cuMoi) return { nghi: false };
  return {
    nghi: true,
    daXong: xong,
    lyDo: `đã xong ${xong} prompt — nghỉ giải lao ${caiDat.giaiLaoPhut} phút`
  };
}

// ── Bộ nhịp gợi ý ──────────────────────────────────────────────────────────

/**
 * Nhịp chạy "hiền" gợi ý, theo số tab định chạy cùng lúc.
 *
 * Con số không phải bí kíp gì — nguyên tắc chỉ là: càng nhiều tab cùng một
 * tài khoản thì mỗi tab phải càng thưa, vì Google đếm theo tài khoản chứ
 * không đếm theo tab. Ba tab gõ cửa 20 giây một lần thì với Google nó là gõ
 * cửa 7 giây một lần.
 *
 * maxRetries hạ xuống 3 là phần quan trọng nhất mà ít ai để ý: lúc bị chặn,
 * mỗi lần thử lại là một lần gõ cửa nữa. Để 5 thì một mẻ 30 prompt thành 150
 * lần gõ cửa vào đúng lúc không nên gõ.
 */
function nhipAnToan(soTab) {
  const n = Math.max(1, Math.min(10, Number(soTab) || 1));
  const min = 20 + (n - 1) * 15;          // 1 tab: 20s · 2 tab: 35s · 3 tab: 50s
  const max = Math.round(min * 2.2);
  return {
    randomDelay: true,
    delayMin: min,
    delayMax: max,
    multiTabStagger: n > 1 ? 15 * n : 0,  // giãn lần bấm "Tạo" giữa các tab
    randomScroll: true,                   // có cuộn trang, giống người xem kết quả
    maxRetries: 3,
    networkGuard: 'auto'
  };
}

/** Đổi mili-giây thành "5 phút 30 giây" để ghi nhật ký cho người đọc. */
function doDai(ms) {
  const giay = Math.max(0, Math.round(ms / 1000));
  const p = Math.floor(giay / 60);
  const g = giay % 60;
  if (!p) return `${g} giây`;
  if (!g) return `${p} phút`;
  return `${p} phút ${g} giây`;
}

module.exports = {
  CUM_TU_CHAN,
  MAC_DINH,
  boDau,
  laCanhBaoChan,
  laLoiChungChung,
  chuanHoaCaiDat,
  soMoi,
  loiMoi,
  locTheoCuaSo,
  canNghi,
  thoiGianNghi,
  canGiaiLao,
  nhipAnToan,
  doDai
};
