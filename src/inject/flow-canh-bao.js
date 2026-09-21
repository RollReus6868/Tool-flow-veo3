// ============================================================================
//  flow-canh-bao.js — ĐỌC XEM FLOW CÓ ĐANG KÊU "HOẠT ĐỘNG BẤT THƯỜNG" KHÔNG
//  --------------------------------------------------------------------------
//  VÌ SAO CẦN ĐỌC THẲNG TỪ TRANG
//
//  Engine gắn cho mọi thẻ hỏng đúng một câu: "Không thành công (Policy/Error)".
//  Câu đó gộp hai chuyện rất khác nhau:
//
//    • Prompt này vi phạm chính sách — hỏng một cái, các cái khác vẫn chạy.
//      Nghỉ 10 phút chẳng giúp gì, chỉ mất thời gian.
//    • Cả tài khoản đang bị coi là bất thường — từ giờ hỏng SẠCH.
//      Chạy tiếp là đổ thêm dầu.
//
//  Nhìn con số thì không phân biệt được hai cái đó. Nhưng NGAY TRÊN THẺ,
//  Flow ghi rõ: "Chúng tôi nhận thấy có hoạt động bất thường nào đó." File này
//  đi đọc đúng câu ấy, để chỗ quyết định bên main.js biết mình đang gặp cái
//  nào mà không phải đoán.
//
//  Đọc, và chỉ đọc. Không bấm, không sửa gì trên trang.
//
//  Phơi ra: window.__flowDoCanhBao() → { co, cum, viDu, soThe }
// ============================================================================

(function () {
  'use strict';

  // Giống hệt danh sách trong src/main/an-toan.js. Cố ý chép ra đây chứ không
  // require: file này chạy TRONG trang Flow, không có module hệ thống. Bài
  // kiểm thử tests/run.js so hai danh sách với nhau để chúng không lệch nhau.
  var CUM_TU = [
    'hoat dong bat thuong',
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

  function boDau(s) {
    return String(s == null ? '' : s)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D')
      .toLowerCase();
  }

  // Chữ bị display:none / visibility:hidden thì người dùng không thấy, và
  // Flow hay dựng sẵn khung thông báo rồi mới hiện. Đếm cả chữ ẩn là báo
  // động giả ngay từ lúc trang vừa tải.
  function dangHien(el) {
    try {
      if (!el || !el.isConnected) return false;
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) return false;
      var st = window.getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden' && st.opacity !== '0';
    } catch (e) {
      return false;
    }
  }

  window.__flowDoCanhBao = function () {
    try {
      // Chỉ quét phần chữ đang hiện, và chỉ những nút LÁ (không có con) —
      // đúng cách engine dò thẻ lỗi. Quét cả cây thì mỗi câu bị đếm lại ở
      // từng tổ tiên của nó.
      var tatCa = document.querySelectorAll('body *');
      var trung = null;
      var viDu = '';
      var soThe = 0;

      for (var i = 0; i < tatCa.length; i++) {
        var el = tatCa[i];
        if (el.children && el.children.length) continue;
        var chu = (el.textContent || '').trim();
        if (chu.length < 8 || chu.length > 400) continue;
        if (!dangHien(el)) continue;

        var t = boDau(chu);
        for (var j = 0; j < CUM_TU.length; j++) {
          if (t.indexOf(CUM_TU[j]) !== -1) {
            soThe++;
            if (!trung) { trung = CUM_TU[j]; viDu = chu.slice(0, 200); }
            break;
          }
        }
      }

      return { co: !!trung, cum: trung, viDu: viDu, soThe: soThe };
    } catch (e) {
      return { co: false, cum: null, viDu: '', soThe: 0, loi: e && e.message };
    }
  };

  // Cho bài kiểm thử đối chiếu danh sách với bản bên main.
  window.__flowCumTuChan = CUM_TU;
})();
