// ============================================================================
//  flow-anh-tham-chieu.js — ẢNH THAM CHIẾU DÍNH TRONG Ô NHẬP PROMPT (2.8.9)
//  --------------------------------------------------------------------------
//  TRIỆU CHỨNG (ảnh người dùng gửi 29/09/2026, mẻ ảnh Nano Banana 2 Lite)
//
//  Prompt [1] tạo sạch. Prompt [2] và [3] mỗi cái mang theo MỘT ảnh tham
//  chiếu là ảnh của prompt ngay trước. Nhật ký mẻ đó không có một dòng
//  "Tìm nhân vật", tức Character Sync không chạy — app không cố ý gắn ảnh
//  nào. Ảnh đã dính vào ô nhập ở đâu đó giữa lúc prompt trước xong (đổi tên,
//  mở menu tải) và lúc dán prompt sau, rồi đi theo lượt Tạo kế tiếp.
//
//  CHƯA BIẾT CHẮC bước nào làm nó dính (không có Flow thật để thử). Vì vậy
//  file này làm hai việc:
//    • ĐẾM ảnh đang nằm trong ô nhập — main.js đếm sau từng bước và ghi vào
//      nhật ký bước nào làm số đó tăng. Lần sau đọc nhật ký là biết.
//    • GỠ: bấm nút ✕ của từng ảnh — thử bằng JavaScript trước (chạy được cả
//      khi tab đang ẩn), không ăn thì main.js bấm chuột thật (nút Tạo của Flow
//      từng chỉ nhận chuột thật — README mục 0o).
//
//  "Ô nhập" = khối bao quanh ô soạn .ProseMirror và nút Tạo, KHÔNG gồm lưới
//  kết quả. Ảnh trong nút cài đặt (biểu tượng model) không tính.
//
//  Phơi ra:
//    window.__flowDemAnhThamChieu()            → { ok, so, ds:[{khoa,w,h}], khung }
//    window.__flowViTriGoAnhThamChieu(i)       → { ok, x, y, canRe, rx, ry, nut }
//    window.__flowGoAnhThamChieuJs(i)          → { ok, nut }   (bấm bằng JavaScript)
// ============================================================================

(function () {
  'use strict';
  if (window.__flowAnhThamChieuLoaded) return;
  window.__flowAnhThamChieuLoaded = true;

  var O_NHAP = '.ProseMirror[contenteditable="true"], [contenteditable="true"][role="textbox"], textarea';
  var NUT_TAO = 'button.generate-icon-button, flow-generate-icon-button button, button[aria-label="Start generation"], button[aria-label*="generat" i]';
  var LUOI = '[data-tile-id], flow-grid-tile-container, .batch-tiles-section';
  var BO_QUA = '.settings-trigger-button, [aria-haspopup="menu"], [aria-haspopup="listbox"], flow-prompt-box-settings';
  var CHU_GO = /(^|[\s_-])(close|cancel|clear|remove|delete|xoá|xóa|bỏ|gỡ|đóng)([\s_-]|$)/i;

  function hien(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function timONhap() {
    var ds = document.querySelectorAll(O_NHAP);
    for (var i = 0; i < ds.length; i++) if (hien(ds[i])) return ds[i];
    return null;
  }

  /** Leo từ ô soạn lên tới khối có nút Tạo; dừng nếu khối đó ôm cả lưới kết quả. */
  function timKhung(o) {
    var el = o;
    for (var i = 0; i < 12 && el; i++) {
      el = el.parentElement;
      if (!el || el === document.body) return null;
      if (el.querySelector(LUOI)) return null;
      if (el.querySelector(NUT_TAO)) return el;
    }
    return null;
  }

  function khoaAnh(el) {
    if (el.tagName === 'IMG') return el.currentSrc || el.src || el.alt || 'img';
    var m = /url\(["']?([^"')]+)/.exec(getComputedStyle(el).backgroundImage || '');
    return m ? m[1] : 'bg';
  }

  function dsAnh() {
    var o = timONhap();
    if (!o) return { ok: false, lyDo: 'không thấy ô nhập prompt', ds: [] };
    var khung = timKhung(o);
    if (!khung) return { ok: false, lyDo: 'không xác định được khối ô nhập', ds: [] };
    var ung = Array.prototype.slice.call(khung.querySelectorAll('img, [style*="background-image"]'));
    var ds = ung.filter(function (el) {
      if (o.contains(el)) return false;                 // ảnh nằm TRONG chữ prompt: bỏ
      if (el.closest(BO_QUA)) return false;             // biểu tượng model, menu cài đặt
      if (el.closest(NUT_TAO)) return false;
      var r = el.getBoundingClientRect();
      if (r.width < 20 || r.height < 20) return false;  // biểu tượng nhỏ
      if (el.tagName !== 'IMG' && !/url\(/.test(getComputedStyle(el).backgroundImage || '')) return false;
      return hien(el);
    });
    // Ảnh lồng ảnh (khung có nền + <img> bên trong) chỉ tính một.
    ds = ds.filter(function (el) { return !ds.some(function (k) { return k !== el && k.contains(el); }); });
    return { ok: true, ds: ds, khung: khung, o: o };
  }

  window.__flowDemAnhThamChieu = function () {
    try {
      var r = dsAnh();
      if (!r.ok) return { ok: false, so: 0, lyDo: r.lyDo, ds: [] };
      return {
        ok: true,
        so: r.ds.length,
        ds: r.ds.map(function (el) {
          var b = el.getBoundingClientRect();
          return { khoa: String(khoaAnh(el)).slice(-80), w: Math.round(b.width), h: Math.round(b.height) };
        }),
        khung: '<' + r.khung.tagName.toLowerCase() + ' class="' + String(r.khung.className || '').slice(0, 60) + '">'
      };
    } catch (e) { return { ok: false, so: 0, lyDo: e.message, ds: [] }; }
  };

  function moTaNut(b) {
    var icon = b.querySelector('i, mat-icon, .google-symbols, .material-icons');
    return ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' +
      (icon ? icon.textContent : (b.textContent || ''))).trim();
  }

  /**
   * Nút ✕ của ảnh thứ i. Tìm trong "thẻ ảnh" = tổ tiên gần nhất của ảnh (tối
   * đa 4 bậc, không vượt khối ô nhập, không ôm ô soạn / nút Tạo).
   * Nút thường chỉ hiện khi rê chuột vào: khi đó trả canRe + toạ độ để rê trước.
   */
  /** Nút ✕ của ảnh: tìm trong tổ tiên gần nhất (≤ 4 bậc, không vượt khối ô nhập). */
  function timNutGo(anh, r) {
    var the = anh;
    for (var k = 0; k < 4 && the; k++) {
      the = the.parentElement;
      if (!the || the === r.khung || the.contains(r.o) || the.querySelector(NUT_TAO)) return null;
      var cac = the.querySelectorAll('button, [role="button"]');
      for (var j = 0; j < cac.length; j++) {
        if (CHU_GO.test(moTaNut(cac[j]))) return cac[j];
      }
    }
    return null;
  }

  /**
   * Toạ độ nút ✕ của ảnh thứ i, để main.js bấm bằng chuột thật.
   * Nút chỉ hiện khi rê chuột vào: trả canRe + toạ độ ảnh để rê trước.
   */
  window.__flowViTriGoAnhThamChieu = function (i) {
    try {
      var r = dsAnh();
      if (!r.ok) return { ok: false, lyDo: r.lyDo };
      var anh = r.ds[i || 0];
      if (!anh) return { ok: false, lyDo: 'không còn ảnh nào' };
      var ra = anh.getBoundingClientRect();
      var nut = timNutGo(anh, r);
      if (!nut) {
        return { ok: false, lyDo: 'không thấy nút gỡ (✕) cạnh ảnh', rx: ra.left + ra.width / 2, ry: ra.top + ra.height / 2 };
      }
      var b = nut.getBoundingClientRect();
      var moTa = moTaNut(nut).slice(0, 40);
      if (!hien(nut) || getComputedStyle(nut).opacity === '0' || getComputedStyle(nut).pointerEvents === 'none') {
        return { ok: true, canRe: true, rx: ra.left + ra.width / 2, ry: ra.top + ra.height / 2, nut: moTa };
      }
      return { ok: true, x: b.left + b.width / 2, y: b.top + b.height / 2, nut: moTa };
    } catch (e) { return { ok: false, lyDo: e.message }; }
  };

  /**
   * Bấm ✕ bằng sự kiện JavaScript (hover → pointer → mouse → click), MỘT lượt.
   * Thử trước chuột thật: tab chạy NGẦM không nhận chuột thật (Chromium bỏ
   * sự kiện chuột gửi tới khung đang ẩn — đo trong tests/model-e2e.js: mỗi cú
   * chờ 5 giây rồi rơi mất). Không ăn thì main.js mới thử chuột thật.
   */
  window.__flowGoAnhThamChieuJs = function (i) {
    try {
      var r = dsAnh();
      if (!r.ok) return { ok: false, lyDo: r.lyDo };
      var anh = r.ds[i || 0];
      if (!anh) return { ok: false, lyDo: 'không còn ảnh nào' };
      var nut = timNutGo(anh, r);
      if (!nut) return { ok: false, lyDo: 'không thấy nút gỡ (✕) cạnh ảnh' };
      var b = nut.getBoundingClientRect();
      var o = { bubbles: true, cancelable: true, composed: true, view: window,
                clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, button: 0 };
      var the = nut.parentElement;
      try {
        the.dispatchEvent(new PointerEvent('pointerover', Object.assign({ pointerType: 'mouse' }, o)));
        the.dispatchEvent(new MouseEvent('mouseover', o));
        the.dispatchEvent(new MouseEvent('mouseenter', o));
        nut.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerType: 'mouse', buttons: 1 }, o)));
        nut.dispatchEvent(new MouseEvent('mousedown', Object.assign({ buttons: 1 }, o)));
        nut.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerType: 'mouse' }, o)));
        nut.dispatchEvent(new MouseEvent('mouseup', o));
        nut.dispatchEvent(new MouseEvent('click', o));
      } catch (e) { nut.click(); }
      return { ok: true, nut: moTaNut(nut).slice(0, 40) };
    } catch (e) { return { ok: false, lyDo: e.message }; }
  };
})();
