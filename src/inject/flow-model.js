// ============================================================================
//  flow-model.js — ĐỌC VÀ ĐỔI MODEL VIDEO TRÊN GIAO DIỆN FLOW
//  --------------------------------------------------------------------------
//  VÌ SAO CÓ FILE NÀY
//  Engine KHÔNG chọn model. Khoá `settings.model` có trong state của nó nhưng
//  không chỗ nào đọc — Flow dùng model nào là do người dùng bấm tay trên
//  trang, rồi Flow nhớ luôn cho những lần sau. Nên muốn:
//    • chạy cả mẻ bằng một model định sẵn, khỏi phải nhớ chỉnh tay,
//    • xen kẽ hai model trong cùng một mẻ,
//    • tự chuyển sang model dự phòng khi "Veo 3.1 - Lite [Lower Priority]"
//      bị Flow báo hoạt động bất thường,
//  thì phải có một bàn tay riêng bấm cái hộp chọn model. Đúng như flow-mode.js
//  làm cho cặp Image/Video: engine giữ nguyên, đây chỉ là tay giúp việc.
//
//  NHÌN THẤY GÌ TRÊN FLOW (ảnh chụp người dùng gửi, 09/2026)
//  Bấm nút "Video · 720p · 8s · x1" cạnh ô nhập prompt → bảng cài đặt mở ra,
//  trong đó có một hộp "Veo 3.1 - Fast ▾". Bấm hộp đó → danh sách:
//        🔊 Omni 1.1 Flash
//        🔊 Veo 3.1 - Lite
//        🔊 Veo 3.1 - Fast
//        🔊 Veo 3.1 - Quality
//        🔊 Veo 3.1 - Lite [Lower Priority]
//  và dưới bảng ghi "Generating will use 10 credits".
//
//  HAI CÁI BẪY ĐÃ TÍNH TRƯỚC
//  1. Biểu tượng loa là chữ của phông biểu tượng ("volume_up"). Đọc
//     textContent trơn sẽ ra "volume_upVeo 3.1 - Lite" — so bằng nhau là trượt
//     hết. Phải gỡ phần chữ-biểu-tượng ra trước khi so.
//  2. "Veo 3.1 - Lite" là TIỀN TỐ của "Veo 3.1 - Lite [Lower Priority]". So
//     kiểu "có chứa" là chọn nhầm cái miễn phí thành cái tốn credit hoặc ngược
//     lại. Chỉ so BẰNG NHAU sau khi đã chuẩn hoá.
//
//  Thẻ kết quả trong lưới cũng ghi tên model ("Veo 3.1 - Fast"). Không bao
//  giờ bấm vào thứ gì nằm trong [role="article"].
//
//  Phơi ra (main world):
//      window.__flowGetModel()           -> Promise<{ok, model, tinDung, lyDo?}>
//      window.__flowSetModel(ten)        -> Promise<{ok, daDoi, model, tinDung, lyDo?, chiTiet?}>
//      window.__flowListModels()         -> Promise<{ok, ds:[ten], lyDo?}>
//      window.__flowModelDebug()         -> những gì nó nhìn thấy, để gửi kèm khi lỗi
//      window.__flowChuanHoaModel(ten)   -> khoá so sánh (cho bài kiểm thử)
//  Cần flow-mode.js tiêm TRƯỚC (dùng chung cách mở bảng và cách bấm).
// ============================================================================

(function () {
  'use strict';

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  // Dùng chung với flow-mode.js; nếu vì lý do gì nó chưa có thì tự lo tối
  // thiểu để không ném lỗi.
  const nhinThay = (el) => (window.__flowNhinThay ? window.__flowNhinThay(el) : !!(el && el.getClientRects().length));
  const bamMotLan = (el, kieu) => window.__flowBamMotLan(el, kieu);
  const dongBang  = () => window.__flowDongBang && window.__flowDongBang();

  // ── 1. Chuẩn hoá tên model ──────────────────────────────────────────────

  // Chữ trông như tên biểu tượng của phông Material/Google Symbols:
  // "volume_up", "arrow_drop_down", "check"… — chữ thường, gạch dưới, không số.
  const LA_CHU_BIEU_TUONG = /^[a-z]+(?:_[a-z]+)*$/;

  function chuKhongBieuTuong(el) {
    if (!el) return '';
    const ban = el.cloneNode(true);
    for (const x of ban.querySelectorAll('i, mat-icon, svg, .material-icons, .material-symbols-outlined, .material-symbols-rounded, .google-symbols, [aria-hidden="true"]')) {
      const t = (x.textContent || '').trim();
      if (x.tagName === 'svg' || x.tagName === 'SVG' || !t || LA_CHU_BIEU_TUONG.test(t)) x.remove();
    }
    return (ban.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Khoá so sánh: bỏ dấu, chữ thường, CHỈ giữ chữ và số.
   * "Veo 3.1 - Lite [Lower Priority]" → "veo31litelowerpriority"
   * "Veo 3.1 – Lite (Lower priority)" → cùng khoá đó (Google hay đổi dấu câu)
   * "Veo 3.1 - Lite"                  → "veo31lite"  (KHÁC — không phải tiền tố nữa)
   */
  function khoa(ten) {
    return String(ten == null ? '' : ten)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/volume_up|volume_off|arrow_drop_down/g, '')
      .replace(/[^a-z0-9]/g, '');
  }
  window.__flowChuanHoaModel = khoa;

  // Tên model video/ảnh Flow đang dùng. Đủ rộng để Google thêm model mới vẫn
  // nhận ra, đủ hẹp để không nhầm một dòng chữ bất kỳ.
  const MAU_TEN_MODEL = /^(veo|omni|imagen|nano ?banana|gemini|lyria)\b/i;

  const trongThe = (el) => !!(el && el.closest && el.closest('[role="article"]'));

  // ── 2. Tìm hộp chọn model bên trong bảng cài đặt ────────────────────────

  function timHopModel(bang) {
    const goc = bang || document;
    const ds = [...goc.querySelectorAll(
      'button, [role="combobox"], [role="button"], mat-select, [aria-haspopup]'
    )];
    const hop = [];
    for (const el of ds) {
      if (!nhinThay(el) || trongThe(el)) continue;
      const t = chuKhongBieuTuong(el);
      if (!t || t.length > 60) continue;
      if (!MAU_TEN_MODEL.test(t)) continue;
      // Nút mở bảng ("Video · 720p · 8s x1") KHÔNG phải hộp chọn model.
      if (/\bx[1-9]\b|\b\d+x\b|720p|1080p/i.test(t)) continue;
      const diem =
        (el.getAttribute('role') === 'combobox' || el.tagName === 'MAT-SELECT' ? 3 : 0) +
        (el.hasAttribute('aria-haspopup') ? 2 : 0) +
        (el.tagName === 'BUTTON' ? 1 : 0);
      hop.push({ el, diem, t });
    }
    if (!hop.length) return null;
    hop.sort((a, b) => b.diem - a.diem);
    // Phần tử bấm được: mat-select tự nó là đích; nút con bên trong thì lấy nút.
    return hop[0].el;
  }

  function docTenTrenHop(hop) {
    const t = chuKhongBieuTuong(hop);
    return t || null;
  }

  // ── 3. Danh sách lựa chọn đang mở ───────────────────────────────────────
  //
  //  Danh sách thường nằm trong lớp phủ gắn thẳng vào <body> (cdk-overlay
  //  của Material, portal của Radix) — NGOÀI bảng cài đặt. Nên phải dò khắp
  //  trang, chỉ lấy thứ đang hiện.

  /**
   * @param {Element} hopModel   hộp chọn model (loại ra khỏi kết quả)
   * @param {Set<Element>} [nen] những phần tử đã có TRƯỚC khi bấm mở. Lối dò
   *        theo chữ trơn chỉ nhận phần tử MỚI hiện ra — nếu không, hai dòng chữ
   *        "Veo…" bất kỳ trên trang cũng bị coi là "danh sách đang mở".
   * @returns {{el, ten, k}[]}
   */
  function timLuaChon(hopModel, nen) {
    const theoVaiTro = [...document.querySelectorAll(
      '[role="option"], [role="menuitem"], [role="menuitemradio"], mat-option'
    )].filter((el) => nhinThay(el) && !trongThe(el) && el !== hopModel);

    const ra = [];
    const daCo = new Set();
    const them = (el) => {
      const ten = chuKhongBieuTuong(el);
      if (!ten || ten.length > 70 || !MAU_TEN_MODEL.test(ten)) return;
      const k = khoa(ten);
      if (daCo.has(k)) return;
      daCo.add(k);
      ra.push({ el, ten, k });
    };
    theoVaiTro.forEach(them);
    if (ra.length >= 2 || !nen) return ra.length >= 2 ? ra : [];

    // Lưới an toàn: Google đổi sang thẻ trơn không có role.
    for (const el of dongChuTron(hopModel)) {
      if (!nen.has(el)) them(el);
    }
    return ra.length >= 2 ? ra : [];
  }

  /** Phần tử đang hiện mang tên model, không phải hộp chọn, không trong thẻ. */
  function dongChuTron(hopModel) {
    return [...document.querySelectorAll('button, li, [tabindex], div, span')]
      .filter((el) => nhinThay(el) && !trongThe(el) && el !== hopModel &&
                      !(hopModel && (hopModel.contains(el) || el.contains(hopModel))) &&
                      laMotDong(el) && !laMotDong(el.parentElement));
  }

  /**
   * Phần tử này có phải TRỌN một dòng lựa chọn không. Lấy tổ tiên CAO NHẤT còn
   * mang đúng một tên — nếu lấy thẻ con thì dòng "Veo 3.1 - Lite [Lower
   * Priority]" dựng bằng hai <span> sẽ bị đọc cụt thành "Veo 3.1 - Lite", đúng
   * cái bẫy tiền tố nói ở đầu file.
   */
  function laMotDong(el) {
    if (!el || el === document.body) return false;
    const t = chuKhongBieuTuong(el);
    if (!t || t.length > 70 || !MAU_TEN_MODEL.test(t)) return false;
    // Thẻ bọc nhiều dòng: chữ của nó chứa tên model thứ hai.
    return (t.match(/\b(veo|omni|imagen|nano ?banana|gemini|lyria)\b/gi) || []).length === 1;
  }

  // ── 4. Đọc số credit ghi dưới bảng ──────────────────────────────────────

  function docTinDung(bang) {
    const goc = bang || document.body;
    const t = (goc.textContent || '').replace(/\s+/g, ' ');
    const m = t.match(/(?:will use|sẽ dùng|sẽ sử dụng)\s*(\d+)\s*(?:credits?|tín dụng)/i)
           || t.match(/(\d+)\s*(?:credits?|tín dụng)/i);
    return m ? parseInt(m[1], 10) : null;
  }

  // ── 5. Mở bảng + mở danh sách ───────────────────────────────────────────

  async function moBangCaiDat() {
    if (typeof window.__flowMoBang !== 'function') return null;
    return await window.__flowMoBang();
  }

  /** Mở danh sách model. Leo thang kiểu bấm, XÁC NHẬN giữa mỗi kiểu. */
  async function moDanhSach(hop) {
    // Danh sách đã mở sẵn (theo vai trò) thì dùng luôn, KHÔNG bấm thêm: hộp
    // chọn là nút bật-tắt, bấm nữa là đóng lại.
    let ds = timLuaChon(hop);
    if (ds.length) return ds;
    const nen = new Set(dongChuTron(hop));
    for (const kieu of ['chuot', 'click', 'phim']) {
      await bamMotLan(hop, kieu);
      for (let i = 0; i < 6; i++) {
        await wait(300);
        ds = timLuaChon(hop, nen);
        if (ds.length) return ds;
      }
    }
    return [];
  }

  function dongDanhSach() {
    // Escape đóng danh sách trước; bảng cài đặt đóng ở lần Escape sau.
    const esc = () => {
      const o = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
      (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', o));
    };
    esc();
  }

  async function dongHet() {
    dongDanhSach();
    await wait(150);
    dongBang();
    await wait(250);
  }

  // ── 6. Các hàm phơi ra ──────────────────────────────────────────────────

  function chanDoan(ghiChu) {
    const bang = window.__flowTimBang ? window.__flowTimBang() : null;
    const hop = timHopModel(bang) || timHopModel(null);
    const ds = timLuaChon(hop, new Set());
    return {
      ghiChu: ghiChu || '',
      coFlowMode: typeof window.__flowMoBang === 'function',
      bangDangMo: bang ? { tag: bang.tagName, lop: String(bang.className || '').slice(0, 100) } : null,
      hopModel: hop ? { tag: hop.tagName, role: hop.getAttribute('role'), chu: docTenTrenHop(hop) } : null,
      luaChon: ds.map((x) => x.ten).slice(0, 12),
      tinDung: docTinDung(bang)
    };
  }
  window.__flowModelDebug = () => chanDoan('');

  /** Đọc model đang chọn. Mở bảng nếu cần, đọc xong đóng lại. */
  window.__flowGetModel = async function () {
    try {
      const daMoSan = !!(window.__flowTimBang && window.__flowTimBang());
      const bang = await moBangCaiDat();
      if (!bang) return { ok: false, model: null, lyDo: 'Không mở được bảng cài đặt cạnh ô nhập prompt' };
      const hop = timHopModel(bang) || timHopModel(null);
      const model = hop ? docTenTrenHop(hop) : null;
      const tinDung = docTinDung(bang);
      if (!daMoSan) await dongHet();
      if (!model) return { ok: false, model: null, tinDung, lyDo: 'Bảng cài đặt đã mở nhưng không thấy hộp chọn model', chiTiet: chanDoan() };
      return { ok: true, model, tinDung };
    } catch (e) {
      try { await dongHet(); } catch (_) {}
      return { ok: false, model: null, lyDo: e && e.message ? e.message : String(e) };
    }
  };

  /** Liệt kê các model Flow đang cho chọn — cho nút "Đọc danh sách từ Flow". */
  window.__flowListModels = async function () {
    try {
      const bang = await moBangCaiDat();
      if (!bang) return { ok: false, ds: [], lyDo: 'Không mở được bảng cài đặt' };
      const hop = timHopModel(bang) || timHopModel(null);
      if (!hop) { await dongHet(); return { ok: false, ds: [], lyDo: 'Không thấy hộp chọn model', chiTiet: chanDoan() }; }
      const ds = await moDanhSach(hop);
      const ten = ds.map((x) => x.ten);
      const chiTiet = ten.length ? null : chanDoan('bấm hộp model nhưng không thấy danh sách');
      await dongHet();
      return ten.length ? { ok: true, ds: ten } : { ok: false, ds: [], lyDo: 'Không mở được danh sách model', chiTiet };
    } catch (e) {
      try { await dongHet(); } catch (_) {}
      return { ok: false, ds: [], lyDo: e && e.message ? e.message : String(e) };
    }
  };

  /**
   * Chọn model theo TÊN (so bằng nhau sau chuẩn hoá, không so "có chứa").
   * Xong luôn đọc lại tên trên hộp để xác nhận — không tin cú bấm.
   */
  window.__flowSetModel = async function (tenMuon) {
    const muon = khoa(tenMuon);
    if (!muon) return { ok: false, daDoi: false, lyDo: 'Chưa nói model nào' };
    try {
      const bang = await moBangCaiDat();
      if (!bang) return { ok: false, daDoi: false, lyDo: 'Không mở được bảng cài đặt cạnh ô nhập prompt', chiTiet: chanDoan() };

      let hop = timHopModel(bang) || timHopModel(null);
      if (!hop) { const ct = chanDoan(); await dongHet(); return { ok: false, daDoi: false, lyDo: 'Bảng cài đặt đã mở nhưng không thấy hộp chọn model', chiTiet: ct }; }

      const dangDung = docTenTrenHop(hop);
      if (khoa(dangDung) === muon) {
        const tinDung = docTinDung(bang);
        await dongHet();
        return { ok: true, daDoi: false, model: dangDung, tinDung };
      }

      const KIEU = ['chuot', 'click', 'phim'];
      for (let lan = 0; lan < KIEU.length; lan++) {
        const ds = await moDanhSach(hop);
        if (!ds.length) {
          const ct = chanDoan('bấm hộp model nhưng không thấy danh sách');
          await dongHet();
          return { ok: false, daDoi: false, lyDo: 'Không mở được danh sách model', chiTiet: ct };
        }
        const dich = ds.find((x) => x.k === muon);
        if (!dich) {
          const coGi = ds.map((x) => x.ten).join(' · ');
          await dongHet();
          return { ok: false, daDoi: false, lyDo: `Flow không có model "${tenMuon}" (đang có: ${coGi})` };
        }

        await bamMotLan(dich.el, KIEU[lan]);

        // XÁC NHẬN bằng chữ trên hộp chọn. Bảng có thể đã đóng theo cú bấm,
        // và hộp có thể được dựng lại — nên dò lại từ đầu mỗi nhịp.
        for (let i = 0; i < 8; i++) {
          await wait(300);
          const b2 = (window.__flowTimBang && window.__flowTimBang()) || null;
          const h2 = timHopModel(b2) || timHopModel(null);
          if (h2 && khoa(docTenTrenHop(h2)) === muon) {
            const tinDung = docTinDung(b2);
            const model = docTenTrenHop(h2);
            await dongHet();
            return { ok: true, daDoi: true, model, tinDung };
          }
        }

        // Chưa thấy đổi: có thể bảng đã đóng hẳn nên không đọc được hộp.
        // Mở lại bảng để đọc cho chắc trước khi bấm lần nữa.
        const b3 = await moBangCaiDat();
        const h3 = b3 && (timHopModel(b3) || timHopModel(null));
        if (h3 && khoa(docTenTrenHop(h3)) === muon) {
          const tinDung = docTinDung(b3);
          const model = docTenTrenHop(h3);
          await dongHet();
          return { ok: true, daDoi: true, model, tinDung };
        }
        if (h3) hop = h3;
      }

      const ct = chanDoan('đã bấm 3 kiểu mà hộp model vẫn không đổi');
      await dongHet();
      return { ok: false, daDoi: false, lyDo: `Đã bấm chọn "${tenMuon}" 3 lần nhưng Flow không đổi model`, chiTiet: ct };
    } catch (e) {
      try { await dongHet(); } catch (_) {}
      return { ok: false, daDoi: false, lyDo: e && e.message ? e.message : String(e) };
    }
  };
})();
