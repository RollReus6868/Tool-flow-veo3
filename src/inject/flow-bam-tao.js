// ============================================================================
//  flow-bam-tao.js — BẤM NÚT TẠO / GỬI trên trang Flow
//  --------------------------------------------------------------------------
//  VÌ SAO PHẢI CÓ FILE NÀY (nhật ký 10:10 → 10:14 ngày 22/09/2026)
//
//  Dán prompt xong, engine bấm Tạo, log ghi "🖱️ Create clicked
//  (wasDisabled: false)" — rồi KHÔNG CÓ GÌ XẢY RA:
//
//      🔎 Verify: newTile=false, txtCleared=false(len=21804), newImg=false
//
//  Chữ vẫn nguyên 21.804 ký tự trong ô nhập, không thẻ chờ, không ảnh mới.
//  Nghĩa là cú bấm KHÔNG tới được chỗ Flow nghe. Hai chỗ hở, cả hai đều thật:
//
//  1. HÀM BẤM CŨ KHÔNG BIẾT TỚI SELECTOR NGƯỜI DÙNG TỰ CHỈ.
//     Lúc 10:11:32 người dùng đã bấm "Chọn trên trang" và chỉ đúng nút:
//         button[aria-label="Start generation"]  (khớp 1 phần tử)
//     App nhớ, engine nhận. Nhưng INJECT_CLICK_CREATE gọi
//     window.__flowClickCreate(), mà hàm đó dò nút bằng bộ selector CỨNG của
//     riêng nó (`button.generate-icon-button`, rồi icon `arrow_forward`) và
//     KHÔNG hề đọc settings.selectors.createBtn. Người dùng chỉ đúng nút mà
//     app vẫn bấm vào chỗ nó tự tìm được — có thể là một nút khác hẳn.
//
//  2. CHỈ THỬ ĐÚNG MỘT KIỂU BẤM RỒI BỎ.
//     Hàm cũ: thử gọi onClick của React fiber, không có thì `el.click()`.
//     Flow 2026 là Angular Material (`mdc-icon-button mat-mdc-button-base`),
//     không có React fiber — nên luôn rơi về `el.click()` trơn. Component
//     nào nghe `pointerdown`/`pointerup` thay vì `click` là bấm xong không
//     việc gì xảy ra, và không ai biết vì hàm vẫn trả về ok:true.
//
//  Cách làm ở đây giống trình đổi chế độ (mục 3.1 của quy trình): thử LẦN
//  LƯỢT ba kiểu bấm, XÁC NHẬN sau mỗi lần, và DỪNG NGAY khi thấy có tác
//  dụng. Bắn cả ba một lượt là Flow submit ba lần cho cùng một prompt.
//
//  Và quan trọng không kém: khi cả ba đều không ăn, file này đọc luôn chữ
//  báo lỗi Flow đang hiện trên trang (snackbar / mat-error / role=alert) rồi
//  trả về, để nhật ký nói được VÌ SAO chứ không chỉ "không xảy ra gì".
//
//  Phơi ra:  window.__flowBamTao({ selector })  -> Promise<{...}>
//            window.__flowBamTaoDebug()         -> mô tả thứ nó nhìn thấy
// ============================================================================

(function () {
  if (window.__flowBamTaoLoaded) return;
  window.__flowBamTaoLoaded = true;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Dùng lại hàm của flow-mode.js nếu có, để hai bên không lệch cách nhìn. */
  function nhinThay(el) {
    if (typeof window.__flowNhinThay === 'function') {
      try { return window.__flowNhinThay(el); } catch (_) {}
    }
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    try {
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') return false;
    } catch (_) {}
    return true;
  }

  // ── Gửi ĐÚNG MỘT phím ────────────────────────────────────────────────────
  //  KHÔNG dùng __flowBamMotLan(el, 'phim') ở đây: hàm đó gửi Enter RỒI Space.
  //  Với bảng cài đặt (bật-tắt) thì vô hại, nhưng nút gửi nghe cả hai phím là
  //  SUBMIT HAI LẦN cho cùng một prompt — tốn credit đôi và sinh hai thẻ.
  //  Bài kiểm tests/bam-tao-main.js đã bắt đúng lỗi này.
  async function bamPhim(el, key) {
    try { el.focus({ preventScroll: true }); } catch (_) {}
    const o = {
      key,
      code: key === ' ' ? 'Space' : 'Enter',
      keyCode: key === ' ' ? 32 : 13,
      which: key === ' ' ? 32 : 13,
      bubbles: true, cancelable: true
    };
    el.dispatchEvent(new KeyboardEvent('keydown', o));
    el.dispatchEvent(new KeyboardEvent('keyup', o));
  }

  async function bamKieu(el, kieu) {
    if (kieu === 'enter') return bamPhim(el, 'Enter');
    if (kieu === 'space') return bamPhim(el, ' ');
    if (typeof window.__flowBamMotLan === 'function') {
      return window.__flowBamMotLan(el, kieu);
    }
    // Dự phòng khi flow-mode.js chưa tiêm được: chỉ có kiểu click trơn.
    try { el.click(); } catch (_) {}
  }

  // ── Ô nhập prompt đang dùng ───────────────────────────────────────────────
  // Bỏ ô nằm trong thẻ kết quả ([role="article"]) — đó là ô sửa prompt của
  // một thẻ đã tạo, không phải ô nhập chính.
  function timEditor() {
    const ds = document.querySelectorAll(
      '.ProseMirror[contenteditable="true"], ' +
      'div[data-slate-editor="true"][aria-multiline="true"], ' +
      'div[data-slate-editor="true"][zindex="-1"], ' +
      'textarea'
    );
    for (const ed of ds) {
      if (!ed.closest('[role="article"]') && nhinThay(ed)) return ed;
    }
    return null;
  }

  /** Độ dài chữ trong ô nhập. innerText, KHÔNG phải textContent (mục 5). */
  function doDaiChu(ed) {
    if (!ed) return -1;
    const s = ed.tagName === 'TEXTAREA' ? (ed.value || '') : (ed.innerText || '');
    return s.replace(/﻿/g, '').trim().length;
  }

  /** Số thẻ đang chờ tạo — dấu hiệu rõ nhất cho "Flow đã nhận việc". */
  function demTheCho() {
    let n = 0;
    for (const sel of ['flow-pending-tile', '.batch-tiles-section',
                       '[data-tile-id]', 'flow-tile-container',
                       'flow-image-tile', 'flow-video-tile']) {
      try { n += document.querySelectorAll(sel).length; } catch (_) {}
    }
    return n;
  }

  function daTat(el) {
    if (!el) return false;
    if (el.disabled) return true;
    if (el.getAttribute('aria-disabled') === 'true') return true;
    try {
      const st = getComputedStyle(el);
      if (st.pointerEvents === 'none') return true;
      if (parseFloat(st.opacity) < 0.5) return true;
    } catch (_) {}
    return false;
  }

  // ── Chữ Flow đang báo lỗi trên trang ─────────────────────────────────────
  //  Khi bấm mà không có gì xảy ra, rất thường là Flow ĐANG NÓI vì sao (prompt
  //  quá dài, nội dung bị chặn, hết credit…) bằng một snackbar hoặc dòng đỏ mà
  //  engine không đọc tới. Không đọc chỗ này thì mọi nguyên nhân khác nhau đều
  //  hiện ra y như nhau trong nhật ký: "không xảy ra gì".
  function docLoiTrenTrang() {
    const SEL = [
      '.mat-mdc-snack-bar-label', '.mdc-snackbar__label', 'mat-snack-bar-container',
      'mat-error', '.mat-mdc-form-field-error',
      '[role="alert"]', '[role="status"]', '.error-message', '.flow-error'
    ];
    const ra = [];
    for (const sel of SEL) {
      let ds = [];
      try { ds = document.querySelectorAll(sel); } catch (_) { continue; }
      for (const el of ds) {
        if (!nhinThay(el)) continue;            // bỏ chữ đang bị ẩn
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (t && t.length <= 400 && !ra.includes(t)) ra.push(t);
      }
    }
    return ra.slice(0, 5);
  }

  function taNut(el) {
    if (!el) return null;
    const at = (n) => { try { return el.getAttribute(n) || ''; } catch (_) { return ''; } };
    const cls = String(el.className || '');
    return {
      tag: (el.tagName || '').toLowerCase(),
      aria: at('aria-label'),
      cls: cls.length > 140 ? cls.slice(0, 140) + '…' : cls,
      text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      daTat: daTat(el)
    };
  }

  // ── Tìm nút Tạo / gửi ────────────────────────────────────────────────────
  //  Thứ tự có chủ ý: selector NGƯỜI DÙNG CHỈ đứng trước tất cả. Họ đang nhìn
  //  vào trang thật, còn mọi selector cứng bên dưới chỉ là phỏng đoán từ đời
  //  giao diện cũ.
  const TEN_ICON = ['arrow_forward', 'arrow_upward', 'send', 'play_arrow', 'arrow_right_alt'];
  const CHU_ARIA = ['start generation', 'generate', 'create', 'tạo', 'gửi', 'submit'];

  function timNut(selectorNguoiDung) {
    const hopLe = (el) => el && el.tagName && nhinThay(el) && !el.closest('[role="article"]');

    if (selectorNguoiDung) {
      let ds = [];
      try { ds = document.querySelectorAll(selectorNguoiDung); } catch (_) { ds = []; }
      for (const el of ds) {
        // Người dùng hay chỉ trúng LỚP BỌC (vd. <flow-generate-icon-button>),
        // mà nút thật nằm BÊN TRONG nó. Tìm xuống trước, rồi mới tìm lên —
        // bản 2.8.4 chỉ tìm lên (closest) nên bấm vào lớp bọc, không ăn.
        const b = el.tagName === 'BUTTON' ? el
          : (el.querySelector('button, [role="button"]') || el.closest('button') || el);
        if (hopLe(b)) return { el: b, via: 'selector-nguoi-dung' };
      }
    }

    const moi = document.querySelector('button.generate-icon-button');
    if (hopLe(moi)) return { el: moi, via: 'generate-icon-button' };

    // aria-label — đời giao diện 2026 đặt "Start generation".
    let nut = [];
    try { nut = Array.from(document.querySelectorAll('button, [role="button"]')); } catch (_) {}
    for (const b of nut) {
      const a = String(b.getAttribute('aria-label') || '').toLowerCase();
      if (!a) continue;
      if (CHU_ARIA.some((c) => a.includes(c)) && hopLe(b)) return { el: b, via: 'aria-label' };
    }

    // Icon mũi tên / gửi, ưu tiên nút nằm trong khung chứa ô nhập.
    const ed = timEditor();
    const timIcon = (goc) => {
      let icons = [];
      try {
        icons = Array.from(goc.querySelectorAll('i.google-symbols, i[class*="google-symbols"], mat-icon, span.material-symbols-outlined'));
      } catch (_) {}
      for (const ic of icons) {
        const t = (ic.textContent || '').trim();
        if (!TEN_ICON.includes(t)) continue;
        const b = ic.closest('button') || ic.closest('[role="button"]');
        if (hopLe(b)) return b;
      }
      return null;
    };

    if (ed) {
      let hop = ed.parentElement;
      for (let i = 0; i < 15 && hop; i++) {
        const b = timIcon(hop);
        if (b) return { el: b, via: 'icon-canh-o-nhap' };
        hop = hop.parentElement;
      }
    }
    const b2 = timIcon(document);
    if (b2) return { el: b2, via: 'icon-toan-trang' };

    return { el: null, via: null };
  }

  /** Đã có tác dụng chưa? Ba dấu hiệu độc lập, đúng một cái là đủ. */
  function daAn(truoc, nut) {
    const ed = timEditor();
    const dai = doDaiChu(ed);
    const the = demTheCho();
    return {
      an: (truoc.dai > 2 && dai <= 2) || the > truoc.the || (!truoc.daTat && daTat(nut)),
      dai, the, daTatBayGio: daTat(nut)
    };
  }

  // ── KIỂM KÊ DOM ĐỂ CHẨN ĐOÁN ─────────────────────────────────────────────
  //  Báo cáo chẩn đoán 10:13 ngày 22/09/2026 gần như vô dụng: phần "ứng viên"
  //  cho "Thẻ video / ảnh" chỉ toàn nút trên thanh tiêu đề (Home, Search,
  //  Account details…). Không phải vì bộ lọc sai, mà vì LƯỚI ĐANG TRỐNG —
  //  chưa có thẻ nào được tạo, nên danh sách ứng viên riêng rỗng và engine
  //  rơi về danh sách chung. Báo cáo kể đúng cái nó thấy, chỉ là cái đó không
  //  trả lời được câu hỏi nào.
  //
  //  Hàm này kiểm kê TÊN CÁC THẺ TỰ ĐẶT (flow-*, mat-*) đang có trên trang.
  //  Google đổi tên thẻ lưới thì ở đây thấy ngay tên mới, kể cả khi lưới còn
  //  trống — đó là thứ thật sự cần để viết lại selector.
  window.__flowKiemKeDOM = function () {
    const dem = {};
    let tatCa = [];
    try { tatCa = Array.from(document.querySelectorAll('*')); } catch (_) {}
    for (const el of tatCa) {
      const tag = (el.tagName || '').toLowerCase();
      if (!tag.includes('-')) continue;               // chỉ thẻ tự đặt
      if (!dem[tag]) dem[tag] = { tong: 0, hien: 0 };
      dem[tag].tong++;
      if (nhinThay(el)) dem[tag].hien++;
    }
    // Sắp theo tên cho lần nào đọc cũng cùng thứ tự, dễ so hai báo cáo.
    const theTuDat = {};
    Object.keys(dem).sort().forEach((k) => { theTuDat[k] = dem[k]; });

    const ed = timEditor();
    return {
      url: location.href,
      title: document.title,
      doDaiChuTrongOnhap: doDaiChu(ed),
      soAnh: (() => { try { return document.querySelectorAll('img').length; } catch (_) { return -1; } })(),
      theTuDat,
      // Bộ selector engine dùng để dò thẻ — nói rõ cái nào còn khớp, cái nào không.
      doThuTheKetQua: ['flow-tile-container', 'flow-image-tile', 'flow-video-tile',
                       '[data-tile-id]', 'a[href*="/edit/workflow/"]', 'flow-pending-tile',
                       '.batch-tiles-section']
        .reduce((acc, sel) => {
          try { acc[sel] = document.querySelectorAll(sel).length; } catch (_) { acc[sel] = 'selector lỗi'; }
          return acc;
        }, {}),
      loiTrenTrang: docLoiTrenTrang()
    };
  };

  window.__flowBamTaoDebug = function () {
    const ed = timEditor();
    const { el, via } = timNut(null);
    return {
      coEditor: !!ed,
      doDaiChu: doDaiChu(ed),
      soTheThayDuoc: demTheCho(),
      nut: taNut(el),
      timThayNutBang: via,
      loiTrenTrang: docLoiTrenTrang(),
      coHamBamCuaModeJs: typeof window.__flowBamMotLan === 'function'
    };
  };

  // ── BẤM CHUỘT THẬT (2.8.5) — chia hai nửa cho tiến trình chính ─────────
  //  Flow bỏ qua cú bấm do JavaScript tạo ra (isTrusted = false). Tiến trình
  //  chính bấm chuột thật qua kênh debugger; trang chỉ lo HAI việc:
  //    __flowBamTaoChuanBi() — tìm nút, cuộn tới, trả toạ độ tâm nút, ghi lại
  //                            trạng thái TRƯỚC khi bấm.
  //    __flowBamTaoKiem()    — so với trạng thái trước: đã ăn chưa.
  let truocBamThat = null;

  window.__flowBamTaoChuanBi = function (tuyChon) {
    const o = tuyChon || {};
    const { el, via } = timNut(o.selector || null);
    if (!el) {
      return { ok: false, error: 'Không tìm thấy nút Tạo trên trang Flow.', debug: window.__flowBamTaoDebug() };
    }
    const truoc = { dai: doDaiChu(timEditor()), the: demTheCho(), daTat: daTat(el) };
    if (truoc.daTat) {
      return { ok: false, wasDisabled: true, via, nut: taNut(el), truoc,
        error: 'Nút Tạo đang bị Flow tắt (disabled) — chưa bấm được.', loiTrenTrang: docLoiTrenTrang() };
    }
    try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (_) {}
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    // Tâm nút có bị lớp khác đè lên không? Bị đè thì chuột thật bấm trúng lớp
    // đè, không phải nút — nói ra thay vì bấm bừa.
    let trung = true;
    try {
      const o2 = document.elementFromPoint(x, y);
      trung = !!o2 && (o2 === el || el.contains(o2) || o2.contains(el));
    } catch (_) {}
    truocBamThat = { truoc, el, sel: o.selector || null };
    return { ok: true, x, y, trung, via, nut: taNut(el), truoc,
      khung: { w: window.innerWidth, h: window.innerHeight } };
  };

  window.__flowBamTaoKiem = function () {
    if (!truocBamThat) return { an: false, loi: 'chưa chuẩn bị' };
    const el = truocBamThat.el.isConnected ? truocBamThat.el : (timNut(truocBamThat.sel).el || truocBamThat.el);
    const kq = daAn(truocBamThat.truoc, el);
    return { ...kq, loiTrenTrang: kq.an ? [] : docLoiTrenTrang() };
  };

  /**
   * @param {{selector?: string, doi?: number}} [tuyChon]
   *        selector — của người dùng tự chỉ (settings.selectors.createBtn)
   *        doi      — chờ bao lâu (ms) sau mỗi kiểu bấm mới đi xác nhận
   * @returns {Promise<{ok, wasDisabled, kieu, via, nut, thu, loiTrenTrang, ...}>}
   *
   *  Giữ nguyên hai trường `ok` và `wasDisabled` vì engine đọc đúng hai cái đó.
   */
  window.__flowBamTao = async function (tuyChon) {
    const o = tuyChon || {};
    const doi = Math.max(400, Number(o.doi) || 1400);

    const { el, via } = timNut(o.selector || null);
    if (!el) {
      return {
        ok: false,
        error: 'Không tìm thấy nút Tạo trên trang Flow. Vào Cài đặt → Chẩn đoán giao diện Flow, ' +
               'bấm "Chọn trên trang" ở dòng "Nút Tạo (mũi tên gửi)" để chỉ đúng nút.',
        debug: window.__flowBamTaoDebug()
      };
    }

    const edTruoc = timEditor();
    const truoc = { dai: doDaiChu(edTruoc), the: demTheCho(), daTat: daTat(el) };

    // Nút đang bị tắt thật thì bấm kiểu gì cũng vô ích — nói ra ngay, kèm chữ
    // Flow đang báo (nếu có), thay vì bấm ba lần rồi mới chịu.
    if (truoc.daTat) {
      return {
        ok: false, wasDisabled: true, via, nut: taNut(el),
        error: 'Nút Tạo đang bị Flow tắt (disabled) — chưa bấm được.',
        truoc, loiTrenTrang: docLoiTrenTrang()
      };
    }

    // Angular Material nghe `click`; Radix và vài component tự viết nghe
    // `pointerdown`. Thứ tự này để kiểu rẻ và hay đúng nhất đi trước.
    // Enter và Space tách làm HAI bước, mỗi bước xác nhận riêng — gộp lại là
    // submit hai lần với nút nghe cả hai phím.
    const KIEU = ['click', 'chuot', 'enter', 'space'];
    const thu = [];

    for (const kieu of KIEU) {
      try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (_) {}
      try {
        await bamKieu(el, kieu);
      } catch (err) {
        thu.push({ kieu, loi: String(err && err.message || err) });
        continue;
      }

      await wait(doi);
      const kq = daAn(truoc, el);
      thu.push({ kieu, an: kq.an, dai: kq.dai, the: kq.the, daTat: kq.daTatBayGio });

      if (kq.an) {
        return {
          ok: true, wasDisabled: false, kieu, via, nut: taNut(el),
          method: 'bam-' + kieu, truoc, thu
        };
      }
    }

    // Cả ba kiểu đều không ăn. Đây là lúc chữ trên trang đáng giá nhất.
    return {
      ok: false, wasDisabled: false, via, nut: taNut(el), truoc, thu,
      loiTrenTrang: docLoiTrenTrang(),
      error: 'Đã thử cả bốn kiểu bấm (click, chuột, Enter, Space) mà Flow không nhận: ' +
             'chữ trong ô nhập không mất đi, không có thẻ chờ nào mới, nút cũng không bị tắt.',
      debug: window.__flowBamTaoDebug()
    };
  };
})();
