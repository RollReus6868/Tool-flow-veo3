// ============================================================================
//  flow-mode.js — ĐỔI CHẾ ĐỘ IMAGE ⇄ VIDEO TRÊN GIAO DIỆN FLOW
//  --------------------------------------------------------------------------
//  VÌ SAO CÓ FILE NÀY
//  switchToVideoMode() của engine chỉ tìm nút ở dạng
//      [role="tab"][aria-controls$="-VIDEO"]
//  NGOÀI bảng thả xuống, và tự nó ghi chú "nút nằm trong dropdown thì bỏ qua".
//  Giao diện Flow hiện nay đặt cặp Image/Video BÊN TRONG bảng cài đặt bật lên
//  từ ô nhập prompt, nên engine không với tới và người dùng phải tự tay đổi.
//
//  BẢN 2.3.1 — VIẾT LẠI THEO ĐÚNG CÁCH ENGINE LÀM
//  Bản 2.3.0 tự nghĩ ra bộ chọn riêng ("chip nào có chữ x1..x4 thì bấm") rồi
//  gọi el.click(). Chạy thật thì báo "Không mở được bảng cài đặt". Hai lý do,
//  cả hai đều đã có lời giải SẴN trong engine mà tôi đã không dùng:
//
//    1. BẤM SAI KIỂU. Bảng cài đặt của Flow là Radix UI. Radix mở bảng bằng
//       pointerdown chứ không phải sự kiện click tổng hợp, nên el.click() trơn
//       không mở được gì. applyFlowSettings() của engine ghi rõ:
//       "Full mouse event sequence (not just .click()) - needed for Radix UI"
//       và bắn đủ pointerover → mouseover → pointerdown → mousedown →
//       pointerup → mouseup → click. Nay ta bắn y hệt.
//
//    2. TÌM SAI NÚT. Tôi dò /\bx[1-4]\b/ ("x1"), còn engine dò /\d+x/ ("1x"),
//       lại thêm điều kiện chuỗi phải chứa video|banana|imagen. Nay ta gọi
//       THẲNG hàm của engine — findSettingsDropdownButtonNative — được tiêm
//       phơi ra thành window.__flowTimNutCaiDat (xem src/main/tabs.js). Đây
//       cũng chính là nút mà engine dùng để KIỂM TRA chế độ ở pastePrompt():
//              const isUIVideo = modeBtn.textContent.includes('video')
//       Dùng chung một nút nghĩa là thứ ta đổi và thứ engine kiểm tra không
//       bao giờ lệch nhau. Đây là điểm mấu chốt của bản sửa này.
//
//  File chạy trong MAIN WORLD, phơi ra:
//      window.__flowSetMode('video'|'image')  -> Promise<{ok, daDoi, lyDo?}>
//      window.__flowGetMode()                 -> 'video' | 'image' | null
//      window.__flowModeDebug()               -> mô tả những gì nó nhìn thấy
//  Nó KHÔNG sửa engine — engine vẫn nguyên vẹn, đây chỉ là tay giúp việc.
// ============================================================================

(function () {
  'use strict';

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── Cố ý KHÔNG dùng offsetParent ────────────────────────────────────────
  // offsetParent trả null cho MỌI phần tử position:fixed, mà bảng thả xuống
  // của Radix chính là một khối fixed. Dò bằng offsetParent thì bảng có mở
  // toang trước mắt ta vẫn coi như không nhìn thấy — im lặng và rất khó ngờ.
  // Đo bằng kích thước thật cộng thuộc tính hiển thị thì không dính bẫy đó.
  const nhinThay = (el) => {
    if (!el || typeof el.getBoundingClientRect !== 'function') return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) return false;
    try {
      const st = window.getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') return false;
    } catch (_) {}
    return true;
  };

  const chu = (el) => (el && el.textContent ? el.textContent : '').trim().toLowerCase();

  // Nhãn hai chế độ. Flow chạy tiếng Anh kể cả khi trang đang là tiếng Việt,
  // nhưng vẫn để sẵn cả hai cho chắc.
  const NHAN = {
    video: ['video'],
    image: ['image', 'hình ảnh', 'hinh anh', 'ảnh', 'anh']
  };

  // ══════════════════════════════════════════════════════ 1. TÌM NÚT MỞ BẢNG

  /**
   * Bản sao y nguyên findSettingsDropdownButtonNative() của engine.
   * Chỉ dùng khi vì lý do nào đó bản gốc không được phơi ra.
   */
  function timTriggerNoiBo() {
    const moi = document.querySelector('button.settings-trigger-button');
    if (moi && moi.offsetParent !== null && !moi.closest('[role="article"]')) return moi;

    const ds = document.querySelectorAll('button[aria-haspopup="menu"]');
    for (const btn of ds) {
      if (!btn.offsetParent || btn.closest('[role="article"]')) continue;
      const t = chu(btn);
      if (t.includes('video') || t.includes('banana') || t.includes('imagen')) {
        if (/\d+x/.test(t)) return btn;
      }
    }
    for (const btn of ds) {
      if (!btn.offsetParent || btn.closest('[role="article"]')) continue;
      if (/\d+x/.test(chu(btn))) return btn;
    }
    return null;
  }

  /**
   * Lưới an toàn cuối cùng: Google đổi giao diện thì hai cách trên cùng trượt.
   * Ở đây nới rất rộng — chấp cả "x1" lẫn "1x", cả tên model lẫn độ dài clip —
   * nhưng vẫn loại thẻ cha bọc cả trang bằng trần độ dài chuỗi.
   */
  function timTriggerNoiRong() {
    const ungVien = [...document.querySelectorAll('button, [role="button"]')];
    const hop = [];
    for (const el of ungVien) {
      if (!nhinThay(el)) continue;
      if (el.closest('[role="article"]')) continue;          // nút trong thẻ kết quả
      const t = chu(el);
      if (!t || t.length > 80) continue;
      const diem =
        (/nano banana|imagen|veo\s*\d/.test(t) ? 3 : 0) +
        (/\d+x|\bx[1-9]\b/.test(t) ? 2 : 0) +
        (/\b(720p|1080p|4k)\b/.test(t) ? 1 : 0) +
        (/\b\d+s\b/.test(t) ? 1 : 0) +
        (/\b\d{1,2}:\d{1,2}\b/.test(t) ? 1 : 0) +            // "16:9"
        (t.includes('video') ? 1 : 0);
      if (diem >= 2) hop.push({ el, diem });
    }
    hop.sort((a, b) => b.diem - a.diem);
    return hop.length ? hop[0].el : null;
  }

  /** Nút mở bảng cài đặt — ưu tiên tuyệt đối hàm của engine. */
  function timTrigger() {
    if (typeof window.__flowTimNutCaiDat === 'function') {
      try {
        const b = window.__flowTimNutCaiDat();
        if (b && nhinThay(b)) return b;
      } catch (_) {}
    }
    return timTriggerNoiBo() || timTriggerNoiRong();
  }

  // ══════════════════════════════════════════════════════ 2. MỞ BẢNG CÀI ĐẶT

  /**
   * Bắn ĐÚNG MỘT cú bấm, y như người thật bấm một lần.
   *
   * ── Vì sao phải nhấn mạnh chữ "một" ──────────────────────────────────
   * Bản 2.3.1 bắn cả chuỗi sự kiện RỒI gọi thêm el.click() "cho chắc". Với
   * một nút bật-tắt thì đó là HAI cú bấm: mở bảng rồi đóng ngay lại. Nhìn từ
   * ngoài y hệt "bấm mà không có gì xảy ra", và nhật ký của người dùng ghi
   * đúng như vậy — lần 1 thất bại.
   *
   * Cái bẫy ở chỗ hai thư viện nghe hai sự kiện khác nhau:
   *     Radix UI            nghe pointerdown
   *     Angular Material    nghe click        (Flow dùng mat-mdc-menu-trigger)
   * Nên phải bắn cả hai, nhưng mỗi thứ ĐÚNG MỘT LẦN — đúng như trình duyệt
   * sinh ra khi người ta bấm chuột một cái. Thêm el.click() là thêm một lần
   * bấm nữa, không phải "chắc ăn hơn".
   *
   * @param {Element} el
   * @param {'chuot'|'click'|'phim'} kieu  cách bấm, để leo thang khi trượt
   */
  async function bamMotLan(el, kieu = 'chuot') {
    try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (_) {}

    if (kieu === 'click') { try { el.click(); } catch (_) {} return; }

    if (kieu === 'phim') {
      try { el.focus({ preventScroll: true }); } catch (_) {}
      for (const key of ['Enter', ' ']) {
        const o = { key, code: key === ' ' ? 'Space' : 'Enter', keyCode: key === ' ' ? 32 : 13,
                    which: key === ' ' ? 32 : 13, bubbles: true, cancelable: true };
        el.dispatchEvent(new KeyboardEvent('keydown', o));
        el.dispatchEvent(new KeyboardEvent('keyup', o));
        await wait(200);
      }
      return;
    }

    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window, button: 0 };
    const p = { ...o, pointerType: 'mouse', isPrimary: true, buttons: 1 };

    try { el.focus({ preventScroll: true }); } catch (_) {}

    el.dispatchEvent(new PointerEvent('pointerover', p));
    el.dispatchEvent(new MouseEvent('mouseover', o));
    el.dispatchEvent(new PointerEvent('pointerenter', p));
    el.dispatchEvent(new PointerEvent('pointerdown', p));
    el.dispatchEvent(new MouseEvent('mousedown', o));
    await wait(60);
    el.dispatchEvent(new PointerEvent('pointerup', { ...p, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...o, buttons: 0 }));
  }

  /**
   * Bảng cài đặt đang mở, nếu có.
   * Ba lối, đúng thứ tự engine dùng, cộng một lối suy ra từ nội dung.
   */
  function timBang() {
    const moi = document.querySelector('flow-prompt-box-settings');
    if (moi && nhinThay(moi)) return moi;

    const mo = document.querySelector('[data-radix-menu-content][data-state="open"]');
    if (mo && nhinThay(mo)) return mo;

    const bat = document.querySelector('[data-radix-menu-content], [data-radix-popper-content-wrapper]');
    if (bat && nhinThay(bat)) return bat;

    // Lối cuối: bất cứ khối nào đang hiện mà chứa ĐỦ CẢ HAI nhãn Image và
    // Video ở dạng nút ngắn — đó chắc chắn là bảng chọn chế độ.
    const nuts = [...document.querySelectorAll(
      'button, [role="tab"], [role="radio"], [role="menuitemradio"], mat-button-toggle'
    )].filter((el) => nhinThay(el) && chu(el).length <= 24);

    const coVideo = nuts.find((el) => khopNhan(el, 'video'));
    const coImage = nuts.find((el) => khopNhan(el, 'image'));
    if (coVideo && coImage) {
      let n = coVideo;
      for (let i = 0; i < 8 && n; i++) {
        if (n.contains(coImage)) return n;
        n = n.parentElement;
      }
      return coVideo.parentElement || null;
    }
    return null;
  }

  function khopNhan(el, mode) {
    const t = chu(el);
    if (!t || t.length > 24) return false;
    return (NHAN[mode] || []).some((n) => t === n || t.startsWith(n + ' ') || t.endsWith(' ' + n));
  }

  /**
   * Mở bảng và CHỜ nó thật sự hiện ra.
   *
   * Leo thang ba kiểu bấm, XÁC NHẬN giữa mỗi kiểu. Cố ý không gộp: gộp lại
   * thì hai kiểu cùng ăn và thành hai cú bấm, mở rồi đóng — đúng lỗi cũ.
   * Nếu sau một kiểu mà bảng chưa hiện, rất có thể nó vừa mở vừa đóng, nên
   * kiểu sau lại bấm một lần nữa và lần này rơi vào nhịp mở.
   */
  async function moBang() {
    const dangMo = timBang();
    if (dangMo) return dangMo;

    const trigger = timTrigger();
    if (!trigger) return null;

    for (const kieu of ['chuot', 'click', 'phim']) {
      await bamMotLan(trigger, kieu);
      // Chờ tới 2,4 giây cho mỗi kiểu (tổng ~7 giây), đủ cho hiệu ứng mở của
      // Material lẫn Radix mà không bắt người dùng ngồi đợi quá lâu.
      for (let i = 0; i < 6; i++) {
        await wait(400);
        const b = timBang();
        if (b) return b;
      }
    }
    return null;
  }

  function dongBang() {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
    }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true
    }));
  }

  // ══════════════════════════════════════════════════════ 3. BẤM NÚT CHẾ ĐỘ

  const dangBat = (el) => !!el && (
    el.getAttribute('aria-selected') === 'true' ||
    el.getAttribute('aria-checked') === 'true' ||
    el.getAttribute('data-state') === 'active' ||
    el.getAttribute('data-state') === 'checked' ||
    el.classList.contains('mat-button-toggle-checked')
  );

  /**
   * Tìm nút chế độ bên trong bảng, thử ba lối theo đúng applyFlowSettings():
   *   - Giao diện MỚI: span.toggle-text  ->  mat-button-toggle  ->  button
   *   - Giao diện CŨ : [role="tab"][aria-controls$="-content-VIDEO"]
   *   - Lưới an toàn : bất kỳ nút ngắn nào mang đúng nhãn
   * Trả { nut, boc } — `boc` là thẻ mang trạng thái chọn, `nut` là thứ bấm được.
   */
  function timNutCheDo(bang, mode) {
    const goc = bang || document;

    // ── Giao diện mới (mat-button-toggle) ──────────────────────────────
    const spans = [...goc.querySelectorAll('span.toggle-text')];
    for (const sp of spans) {
      const t = (sp.textContent || '').trim().toLowerCase();
      if (!(NHAN[mode] || []).some((n) => t === n)) continue;
      const boc = sp.closest('mat-button-toggle');
      if (boc) return { nut: boc.querySelector('button') || boc, boc };
    }

    // ── Giao diện cũ (Radix tab + aria-controls) ───────────────────────
    const duoi = mode === 'video' ? 'VIDEO' : 'IMAGE';
    let tab = goc.querySelector(`[role="tab"][aria-controls$="-content-${duoi}"]`)
           || goc.querySelector(`[role="tab"][aria-controls$="-${duoi}"]`)
           || goc.querySelector(`[role="tab"][aria-controls*="-${duoi}"]`);
    if (tab) return { nut: tab, boc: tab };

    // Chế độ ảnh có thể mang tên model (IMAGEN / NANO_BANANA) chứ không phải
    // "IMAGE": lấy thẻ tab CÒN LẠI trong cùng nhóm với tab VIDEO.
    if (mode === 'image') {
      const tabVideo = goc.querySelector('[role="tab"][aria-controls*="-VIDEO"]');
      if (tabVideo) {
        const nhom = tabVideo.closest('[role="tablist"]') || tabVideo.parentElement;
        if (nhom) {
          const khac = [...nhom.querySelectorAll('[role="tab"]')]
            .find((el) => el !== tabVideo && !/-VIDEO/.test(el.getAttribute('aria-controls') || ''));
          if (khac) return { nut: khac, boc: khac };
        }
      }
    }

    // ── Lưới an toàn: khớp theo chữ ────────────────────────────────────
    const ds = [...goc.querySelectorAll(
      'button, [role="tab"], [role="radio"], [role="menuitemradio"], [role="option"], mat-button-toggle'
    )].filter((el) => nhinThay(el) && khopNhan(el, mode));
    if (ds.length) {
      const el = ds[ds.length - 1];                 // nút trong bảng vừa mở nằm cuối
      return { nut: el.tagName === 'MAT-BUTTON-TOGGLE' ? (el.querySelector('button') || el) : el, boc: el };
    }
    return null;
  }

  // ══════════════════════════════════════════════════════ 4. ĐỌC CHẾ ĐỘ THẬT

  /**
   * Chế độ Flow đang chạy, ĐỌC ĐÚNG CÁCH ENGINE ĐỌC ở pastePrompt():
   *     const isUIVideo = modeBtn.textContent.toLowerCase().includes('video')
   * Không tự nghĩ ra cách khác — lệch với engine là lại rơi vào cảnh
   * "đã đổi rồi" mà engine vẫn dừng vì "Sai chế độ giao diện".
   */
  function docCheDo() {
    const btn = timTrigger();
    if (!btn) return null;
    return chu(btn).includes('video') ? 'video' : 'image';
  }

  window.__flowGetMode = docCheDo;

  // Cho trình chọn model (flow-model.js) dùng CHUNG cách mở bảng và cách bấm.
  // Chép lại một bản thứ hai là thêm một chỗ nữa để lệch — cái bẫy "bấm hai
  // lần thành mở rồi đóng" đã phải trả giá một lần ở đây rồi.
  window.__flowBamMotLan = bamMotLan;
  window.__flowMoBang    = moBang;
  window.__flowTimBang   = timBang;
  window.__flowDongBang  = dongBang;
  window.__flowNhinThay  = nhinThay;

  /** Chụp lại những gì đang thấy — để gửi kèm khi báo lỗi. */
  window.__flowModeDebug = function () {
    const btn = timTrigger();
    const bang = timBang();
    return {
      coHamEngine: typeof window.__flowTimNutCaiDat === 'function',
      trigger: btn ? { tag: btn.tagName, chu: chu(btn).slice(0, 120), lop: btn.className } : null,
      cheDo: docCheDo(),
      bangDangMo: bang ? { tag: bang.tagName, lop: String(bang.className).slice(0, 120) } : null,
      nutVideo: !!timNutCheDo(bang, 'video'),
      nutImage: !!timNutCheDo(bang, 'image')
    };
  };

  // ══════════════════════════════════════════════════════ 5. HÀM CHÍNH

  /**
   * Đổi chế độ tạo nội dung của Flow.
   * @param {'video'|'image'} mode
   * @returns {Promise<{ok:boolean, daDoi:boolean, lyDo?:string, chiTiet?:object}>}
   */
  window.__flowSetMode = async function (mode) {
    const muon = mode === 'image' ? 'image' : 'video';

    try {
      // ── Đang đúng chế độ rồi thì thôi ────────────────────────────────
      const dangO = docCheDo();
      if (dangO === muon) return { ok: true, daDoi: false, lyDo: `Flow đã ở chế độ ${muon}` };

      if (dangO === null && !timTrigger()) {
        return {
          ok: false, daDoi: false,
          lyDo: 'Chưa thấy ô nhập prompt của Flow (trang chưa mở đúng dự án?)',
          chiTiet: window.__flowModeDebug()
        };
      }

      // ── Mở bảng ──────────────────────────────────────────────────────
      const bang = await moBang();
      if (!bang) {
        return {
          ok: false, daDoi: false,
          lyDo: 'Không mở được bảng cài đặt cạnh ô nhập prompt',
          chiTiet: window.__flowModeDebug()
        };
      }

      // ── Bấm nút chế độ ───────────────────────────────────────────────
      const tim = timNutCheDo(bang, muon);
      if (!tim) {
        dongBang();
        return {
          ok: false, daDoi: false,
          lyDo: `Bảng cài đặt đã mở nhưng không thấy nút "${muon}" trong đó`,
          chiTiet: window.__flowModeDebug()
        };
      }

      if (dangBat(tim.boc)) {
        dongBang();
        return { ok: true, daDoi: false, lyDo: `Đã ở chế độ ${muon} sẵn` };
      }

      // Bấm tới 3 lần, mỗi lần một KIỂU khác, chờ rồi đọc lại — giống
      // clickWithRetry của engine nhưng có leo thang cách bấm.
      const KIEU = ['chuot', 'click', 'phim'];
      for (let lan = 1; lan <= 3; lan++) {
        await bamMotLan(tim.nut, KIEU[lan - 1]);
        await wait(700);

        // XÁC NHẬN bằng chính thước đo của engine: chữ trên nút mở bảng.
        for (let i = 0; i < 6; i++) {
          if (docCheDo() === muon) {
            dongBang();
            await wait(250);
            return { ok: true, daDoi: true };
          }
          await wait(300);
        }

        // Bảng có thể đã đóng sau cú bấm — mở lại để thử tiếp.
        const lai = timBang() || await moBang();
        const t2 = timNutCheDo(lai, muon);
        if (t2) { tim.nut = t2.nut; tim.boc = t2.boc; }
      }

      dongBang();
      return {
        ok: false, daDoi: false,
        lyDo: `Đã bấm nút "${muon}" 3 lần nhưng giao diện Flow không đổi`,
        chiTiet: window.__flowModeDebug()
      };
    } catch (e) {
      try { dongBang(); } catch (_) {}
      return { ok: false, daDoi: false, lyDo: e && e.message ? e.message : String(e) };
    }
  };
})();
