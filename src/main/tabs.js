// ============================================================================
//  tabs.js — QUẢN LÝ ĐA TAB FLOW
//  --------------------------------------------------------------------------
//  Mỗi tab là một WebContentsView nhúng thẳng trong cửa sổ app (giống hệt cách
//  tool mẫu làm), KHÔNG phải cửa sổ Chrome rời.
//
//  Vì sao đa tab ở bản desktop khoẻ hơn hẳn bản tiện ích:
//    • Không có service worker MV3 để Chrome giết khi rảnh — logic điều phối
//      nằm trong tiến trình chính của app, sống suốt phiên chạy.
//    • Tải file phân biệt được theo tab (xem downloads.js), nên bỏ được cơ chế
//      khoá tuần tự; các tab chạy song song thật.
//    • Tất cả tab dùng CHUNG một phiên đăng nhập ('persist:flow'), nên đăng
//      nhập Google một lần là mọi tab đều vào được.
// ============================================================================

const path = require('path');
const fs = require('fs');

const FLOW_URL = 'https://labs.google/fx/vi/tools/flow';

// Chỉ dùng cho kiểm thử: cho phép trỏ vào trang giả lập cục bộ.
// Người dùng bình thường không bao giờ đặt biến này.
const FLOW_HOST_RE = process.env.FLOW_TEST_HOST
  ? new RegExp(process.env.FLOW_TEST_HOST, 'i')
  : /^https?:\/\/(labs\.google|flow\.google\.com)/i;

/**
 * Kích thước cho MỌI tab (hiện hay ẩn). Vùng hiển thị chưa có / bị thu nhỏ
 * (người dùng đang ở màn điều khiển) thì dùng khung đẹp gần nhất, hoặc
 * 1280×800 — không bao giờ trả khung 0×0.
 */
const KHUNG_MAC_DINH = { x: 0, y: 0, width: 1280, height: 800 };
function khungChoTab(pane, khungCuoi) {
  const dung = (b) => b && b.width >= 400 && b.height >= 300;
  if (dung(pane)) return { x: pane.x | 0, y: pane.y | 0, width: pane.width | 0, height: pane.height | 0 };
  if (dung(khungCuoi)) return khungCuoi;
  return { ...KHUNG_MAC_DINH };
}

class TabManager {
  constructor({ mainWindow, session, accounts, preloadPath, log, onTabsChanged }) {
    this.mainWindow = mainWindow;
    this.session = session;         // chỉ dùng khi không có AccountManager (kiểm thử)
    this.accounts = accounts || null;
    this.preloadPath = preloadPath;
    this.log = log;
    this.onTabsChanged = onTabsChanged || (() => {});

    /** @type {Array<{id:string, view:any, title:string, url:string, ready:boolean, busy:boolean}>} */
    this.tabs = [];
    this.activeId = null;
    this.seq = 0;
    this.paneBounds = { x: 0, y: 0, width: 0, height: 0 };
    this.paneVisible = false;
    this.khungCuoi = null;      // khung đẹp gần nhất, dùng cho tab ẩn

    // Mã nguồn tiêm vào trang, đọc một lần lúc khởi động.
    const injectDir = path.join(__dirname, '..', 'inject');
    this.shimSource    = fs.readFileSync(path.join(injectDir, 'chrome-shim.js'), 'utf8');
    this.helperSource  = fs.readFileSync(path.join(injectDir, 'main-world-helpers.js'), 'utf8');
    this.engineSource  = fs.readFileSync(path.join(injectDir, 'flow-engine.js'), 'utf8');
    this.modeSource    = fs.readFileSync(path.join(injectDir, 'flow-mode.js'), 'utf8');
    this.canhBaoSource = fs.readFileSync(path.join(injectDir, 'flow-canh-bao.js'), 'utf8');
    this.modelSource   = fs.readFileSync(path.join(injectDir, 'flow-model.js'), 'utf8');
  }

  list() {
    return this.tabs.map((t) => ({
      id: t.id,
      title: t.title,
      url: t.url,
      ready: t.ready,
      busy: t.busy,
      active: t.id === this.activeId,
      accountId: t.accountId || null,
      accountName: t.accountName || ''
    }));
  }

  /** Các tab của một tài khoản. */
  ofAccount(accountId) {
    return this.tabs.filter((t) => t.accountId === accountId);
  }

  /** Gom tab theo tài khoản, giữ thứ tự tài khoản. */
  groupByAccount() {
    const nhom = new Map();
    for (const t of this.tabs) {
      const k = t.accountId || 'khong-ro';
      if (!nhom.has(k)) nhom.set(k, []);
      nhom.get(k).push(t);
    }
    return nhom;
  }

  find(tabId) {
    return this.tabs.find((t) => t.id === tabId) || null;
  }

  findByWcId(wcId) {
    return this.tabs.find((t) => {
      try { return t.view.webContents.id === wcId; } catch (_) { return false; }
    }) || null;
  }

  /**
   * Mở một tab Flow mới.
   */
  async create(accountId = null, url = FLOW_URL) {
    const { WebContentsView } = require('electron');
    const id = `tab${++this.seq}`;
    // Số thứ tự KHÔNG dùng lại: engine ghép nó vào tên dự án (_T1, _T2…) và
    // dùng làm khoá trạng thái chạy. Đóng tab2 rồi mở tab mới mà lấy lại số 2
    // là tab mới thừa kế dự án dở dang của tab cũ.
    const slot = this.seq;

    // ── Phiên theo TÀI KHOẢN ────────────────────────────────────────────
    // Đây là chỗ làm nên tính năng đa tài khoản: mỗi tài khoản một partition
    // riêng nên cookie hoàn toàn tách biệt. Đăng nhập tài khoản này không đá
    // tài khoản kia ra, và nhiều tài khoản chạy song song được.
    let ses = this.session;
    let acc = null;
    if (this.accounts) {
      acc = this.accounts.find(accountId) || this.accounts.primary();
      ses = this.accounts.sessionFor(acc ? acc.id : null);
    }

    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        // Flow là ứng dụng Angular nặng; tắt tiết kiệm điện khi ẩn để tab nền
        // vẫn chạy automation bình thường thay vì bị hãm nhịp.
        backgroundThrottling: false
      }
    });

    const tab = {
      id, slot, view, title: 'Đang mở…', url, ready: false, busy: false,
      accountId: acc ? acc.id : null,
      accountName: acc ? acc.name : ''
    };
    this.tabs.push(tab);

    const wc = view.webContents;

    wc.on('page-title-updated', (_e, title) => {
      tab.title = title;
      this.onTabsChanged(this.list());
    });

    // Tải lại cả trang: tài liệu mới, engine cũ mất sạch -> phải tiêm lại.
    wc.on('did-navigate', (_e, newUrl) => {
      tab.url = newUrl;
      tab.ready = false;
      this.onTabsChanged(this.list());
    });

    wc.on('did-finish-load', () => {
      tab.url = wc.getURL();
      this.maybeInject(tab, 'did-finish-load');
    });

    // ── Chỗ này là lỗi đã gặp thật ──────────────────────────────────────
    // Flow là ứng dụng SPA (Angular). Sau khi đăng nhập Google xong, nó
    // chuyển sang màn hình dự án BẰNG JAVASCRIPT chứ không tải lại trang,
    // nên 'did-finish-load' KHÔNG bắn lần nữa. Bản đầu chỉ nghe mỗi sự kiện
    // đó, nên tab nằm mãi ở trạng thái "chưa sẵn sàng" dù trang đã hiện ra
    // đầy đủ trước mắt người dùng.
    //
    // Đổi trang kiểu SPA giữ nguyên tài liệu, nên engine đã tiêm VẪN CÒN —
    // maybeInject() sẽ tự nhận ra điều đó và không tiêm chồng.
    wc.on('did-navigate-in-page', (_e, newUrl, isMainFrame) => {
      if (!isMainFrame) return;
      tab.url = newUrl;
      this.maybeInject(tab, 'did-navigate-in-page');
    });

    wc.on('dom-ready', () => this.maybeInject(tab, 'dom-ready'));

    wc.on('render-process-gone', (_e, details) => {
      tab.ready = false;
      this.log('error', `❌ [${id}] Tab bị sập (${details.reason}). Bấm "Nạp lại" để mở lại.`);
      this.onTabsChanged(this.list());
    });

    // ── Chốt chặn cuối: dò lại mỗi 3 giây ───────────────────────────────
    // Không sự kiện nào của Electron bao phủ được hết mọi kiểu chuyển trang
    // của một ứng dụng Angular. Thay vì đoán cho đủ sự kiện, cứ dò thẳng
    // trạng thái thật trong trang. Rẻ, và không bao giờ để tab kẹt.
    tab.watchdog = setInterval(() => {
      if (wc.isDestroyed()) return clearInterval(tab.watchdog);
      if (wc.isLoading()) return;
      this.maybeInject(tab, 'watchdog');
    }, 3000);

    // Cửa sổ pop-up của Google (đăng nhập, chọn tài khoản) mở ngay trong tab.
    wc.setWindowOpenHandler(({ url: target }) => {
      wc.loadURL(target);
      return { action: 'deny' };
    });

    this.mainWindow.contentView.addChildView(view);
    this.applyBounds();

    await wc.loadURL(url);
    if (!this.activeId) this.setActive(id);
    this.onTabsChanged(this.list());
    this.log('info', acc ? `🆕 Đã mở ${id} cho tài khoản "${acc.name}"` : `🆕 Đã mở ${id}`);
    return tab;
  }

  /**
   * Tiêm lớp giả lập chrome.* rồi tiêm engine — đúng thứ tự đó, vì engine gọi
   * chrome.storage ngay ở phần khởi tạo.
   *
   * Cả hai chạy trong MAIN WORLD. Đây là khác biệt lớn so với tiện ích: content
   * script của tiện ích bị nhốt trong isolated world nên mọi sự kiện nó phát ra
   * đều có isTrusted=false và Slate bỏ qua — chính vì thế bản 1.10.0 phải vòng
   * qua background.js gọi executeScript({world:'MAIN'}). Ở đây không cần.
   */
  /**
   * Quyết định có cần tiêm hay không, dựa trên TRẠNG THÁI THẬT trong trang
   * chứ không dựa vào cờ tab.ready bên ngoài — cờ đó dễ lệch với thực tế.
   */
  async maybeInject(tab, why) {
    const wc = tab.view.webContents;
    if (wc.isDestroyed()) return;

    // ── Vì sao phải khoá NGAY từ đây ─────────────────────────────────────
    // Ba sự kiện (did-finish-load, did-navigate-in-page, dom-ready) bắn gần
    // như cùng lúc. Bản trước chỉ đặt cờ injecting BÊN TRONG injectEngine,
    // tức là SAU lời await kiểm tra engine còn sống — nên cả ba lượt cùng
    // thấy "chưa có engine" và cùng tiêm. Kết quả: ba bản engine, ba bộ
    // listener, và mỗi lệnh gửi xuống bị xử lý ba lần.
    //
    // Đúng là thứ đã thấy trong nhật ký người dùng: ba dòng
    // "No prompts to process!" giống hệt nhau, cùng một giây.
    if (tab.injecting) return;
    tab.injecting = true;
    try {
      await this._maybeInjectInner(tab, why);
    } finally {
      tab.injecting = false;      // đây là lớp khoá ngoài cùng, luôn mở lại
    }
  }

  async _maybeInjectInner(tab, why) {
    const wc = tab.view.webContents;
    const url = wc.getURL();
    if (!FLOW_HOST_RE.test(url)) {
      // Đang ở trang đăng nhập Google chẳng hạn — không tiêm vào đó.
      if (tab.ready) { tab.ready = false; this.onTabsChanged(this.list()); }
      return;
    }

    let alive = false;
    try {
      // Kiểm tra engine còn SỐNG thật, không chỉ là "đã từng tiêm".
      alive = await wc.executeJavaScript(
        '!!(window.__flowEngineLoaded && window.__flowShimDispatch && window.chrome && window.chrome.storage)', true
      );
    } catch (_) {
      alive = false;
    }

    if (alive) {
      if (!tab.ready) {
        tab.ready = true;
        this.log('success', `✅ [${tab.id}] Engine đã sẵn sàng`);
        this.onTabsChanged(this.list());
      }
      return;
    }

    if (tab.ready) { tab.ready = false; this.onTabsChanged(this.list()); }
    await this.injectEngine(tab, why);
  }

  /**
   * Tiêm lớp giả lập chrome.* rồi tiêm engine — đúng thứ tự đó, vì engine gọi
   * chrome.storage ngay ở phần khởi tạo.
   *
   * Cả hai chạy trong MAIN WORLD. Đây là khác biệt lớn so với tiện ích: content
   * script của tiện ích bị nhốt trong isolated world nên mọi sự kiện nó phát ra
   * đều có isTrusted=false và Slate bỏ qua — chính vì thế bản 1.10.0 phải vòng
   * qua background.js gọi executeScript({world:'MAIN'}). Ở đây không cần.
   *
   * Tiêm THEO TỪNG CHẶNG có đặt tên. Bản đầu gói tất cả trong một try/catch
   * nên khi hỏng chỉ biết "không tiêm được", không biết hỏng ở đâu — mất cả
   * một vòng hỏi đáp với người dùng mới lần ra. Giờ log nói thẳng chặng nào.
   */
  async injectEngine(tab, why = 'thủ công') {
    const wc = tab.view.webContents;
    // Giữ rồi trả lại giá trị cũ thay vì đặt cứng về false ở cuối: hàm này
    // được gọi cả từ maybeInject (đang giữ khoá) lẫn từ nút bấm tay. Đặt cứng
    // về false sẽ mở khoá sớm và để lượt khác chen vào giữa chừng.
    const khoaTruocDo = tab.injecting;
    tab.injecting = true;

    // ── Vì sao bọc trong hàm tự gọi ───────────────────────────────────────
    // flow-engine.js khai báo hàng loạt const/let ở CẤP CAO NHẤT. Tiêm lần
    // hai vào CÙNG một tài liệu là ném ngay
    //     SyntaxError: Identifier '...' has already been declared
    // và không xoá đi được: const ở cấp cao nhất không nằm trên window nên
    // delete không với tới. Hệ quả là chốt chặn dò lại vĩnh viễn không cứu
    // nổi một tab có engine chết giữa chừng — nó thử lại mỗi 3 giây và lần
    // nào cũng vỡ ở đúng chỗ đó.
    //
    // Bọc lại thì mọi khai báo nằm gọn trong phạm vi hàm, nên tiêm bao nhiêu
    // lần cũng được. Dùng function thường chứ không dùng arrow, và không bật
    // strict mode, để `this` ở cấp cao nhất vẫn là window như engine trông đợi.
    const boc = (src) => `(function(){\n${src}\n})();`;

    // ── Phơi vài hàm của engine ra window ────────────────────────────────
    // Engine bị bọc trong IIFE (xem ghi chú ngay trên) nên hàm của nó không
    // nằm trên window. Nhưng flow-mode.js CẦN đúng hàm tìm nút cài đặt mà
    // engine dùng — vì đó cũng là nút engine soi để quyết định "sai chế độ
    // giao diện" rồi tự dừng. Hai bên dò bằng hai bộ chọn khác nhau là sinh
    // ra cảnh đổi xong mà engine vẫn kêu sai (đúng lỗi của bản 2.3.0).
    //
    // Đoạn này nối vào BÊN TRONG lớp bọc nên vẫn thấy được khai báo của
    // engine, và flow-engine.js trên đĩa không bị sửa một byte nào.
    const XUAT_ENGINE = `
try {
  if (typeof findSettingsDropdownButtonNative === 'function')
    window.__flowTimNutCaiDat = findSettingsDropdownButtonNative;
  if (typeof applyFlowSettings === 'function')
    window.__flowApDungCaiDat = applyFlowSettings;
} catch (e) { console.warn('[tiêm] không phơi được hàm engine:', e); }`;

    const stages = [
      ['đánh dấu tab', `window.__FLOW_TAB_ID = ${JSON.stringify(tab.id)};`],
      ['lớp giả lập chrome.*', this.shimSource],
      ['hàm phụ trợ', boc(this.helperSource)],
      // Dọn người nghe cũ trước khi engine mới đăng ký bộ của nó, nếu không
      // mỗi lệnh gửi xuống sẽ bị xử lý nhiều lần.
      ['dọn người nghe cũ', 'window.__flowShimReset && window.__flowShimReset();'],
      ['engine dò DOM', boc(this.engineSource + '\n' + XUAT_ENGINE)],
      ['trình đổi chế độ', this.modeSource],
      // SAU trình đổi chế độ: dùng chung hàm mở bảng và hàm bấm của nó.
      ['trình chọn model', this.modelSource],
      ['trình dò cảnh báo', this.canhBaoSource],
      ['chốt hoàn tất', 'window.__flowEngineLoaded = true;']
    ];

    try {
      // Cầu nối từ preload PHẢI có trước, nếu không lớp giả lập chrome.* sẽ
      // lặng lẽ không lắp được và engine chết ở lời gọi chrome.storage đầu tiên.
      const hasBridge = await wc.executeJavaScript('!!window.__flowBridge', true);
      if (!hasBridge) {
        tab.ready = false;
        tab.injecting = khoaTruocDo;
        this.log('error',
          `❌ [${tab.id}] Thiếu cầu nối preload (__flowBridge). Hãy đóng tab rồi mở lại; ` +
          `nếu vẫn vậy thì khởi động lại app.`);
        this.onTabsChanged(this.list());
        return;
      }

      for (const [name, source] of stages) {
        try {
          // ── Vì sao phải nối thêm ";undefined;" ──────────────────────────
          // executeJavaScript trả về GIÁ TRỊ CỦA BIỂU THỨC CUỐI CÙNG và tìm
          // cách chuyển nó về tiến trình chính qua structured clone.
          // main-world-helpers.js kết thúc bằng
          //     window.__flowClickCreate = mainWorldClickCreate;
          // mà giá trị của phép gán đó là MỘT HÀM — hàm không clone được, nên
          // lời gọi ném "An object could not be cloned" và cả chuỗi tiêm vỡ
          // ngay tại đó. Engine không bao giờ được nạp, tab kẹt mãi ở trạng
          // thái "chưa sẵn sàng", và chẳng có gì trên màn hình nói vì sao.
          //
          // Đây là lỗi người dùng đã gặp thật. Ép giá trị trả về thành
          // undefined là xong — ta không cần giá trị nào từ các đoạn tiêm này.
          await wc.executeJavaScript(source + '\n;undefined;', true);
        } catch (err) {
          throw new Error(`hỏng ở chặng "${name}": ${err.message}`);
        }
      }

      tab.ready = true;
      this.log('success', `✅ [${tab.id}] Engine đã sẵn sàng (${why})`);
    } catch (err) {
      tab.ready = false;
      this.log('error', `❌ [${tab.id}] Không tiêm được engine — ${err.message}`);
    } finally {
      tab.injecting = khoaTruocDo;
    }
    this.onTabsChanged(this.list());
  }

  /**
   * Chẩn đoán: nói rõ từng mảnh có mặt hay không, để khỏi phải đoán.
   */
  async diagnose(tabId) {
    const tab = this.find(tabId);
    if (!tab) return { ok: false, error: 'Không tìm thấy tab' };
    const wc = tab.view.webContents;

    try {
      const probe = await wc.executeJavaScript(`({
        url: location.href,
        coBridge: !!window.__flowBridge,
        coChrome: !!window.chrome,
        coStorage: !!(window.chrome && window.chrome.storage && window.chrome.storage.local),
        coDispatch: typeof window.__flowShimDispatch === 'function',
        coEngine: !!window.__flowEngineLoaded,
        coClickCreate: typeof window.__flowClickCreate === 'function',
        coONhapPrompt: !!document.querySelector('.ProseMirror[contenteditable="true"], div[data-slate-editor="true"][contenteditable="true"]')
      })`, true);
      return { ok: true, tabId, urlKhop: FLOW_HOST_RE.test(probe.url), ...probe };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  setActive(tabId) {
    const tab = this.find(tabId);
    if (!tab) return false;
    this.activeId = tabId;
    this.applyBounds();
    this.onTabsChanged(this.list());
    return true;
  }

  /** Renderer báo vùng hiển thị trình duyệt nằm ở đâu trong cửa sổ. */
  setPaneBounds(rect, visible) {
    this.paneBounds = rect;
    this.paneVisible = visible;
    this.applyBounds();
  }

  applyBounds() {
    const khung = khungChoTab(this.paneBounds, this.khungCuoi);
    this.khungCuoi = khung;
    for (const tab of this.tabs) {
      const show = this.paneVisible && tab.id === this.activeId;
      // Tab ẨN vẫn giữ NGUYÊN KÍCH THƯỚC THẬT, chỉ tắt hiển thị. KHÔNG thu về
      // 0×0: lưới kết quả mới của Flow (cdk-virtual-scroll-viewport) chỉ vẽ số
      // thẻ vừa khung nhìn — khung cao 0 thì vẽ 0 thẻ, engine báo "KHÔNG TÌM
      // THẤY Thẻ video / ảnh" và không bao giờ thấy ảnh xong để tải về.
      try { tab.view.setBounds(khung); } catch (_) { /* view đã huỷ */ }
      try { tab.view.setVisible(show); } catch (_) {
        // Electron cũ không có setVisible: đẩy ra ngoài màn hình, giữ kích thước.
        try { if (!show) tab.view.setBounds({ ...khung, x: -20000, y: -20000 }); } catch (_) {}
      }
    }
  }

  async reload(tabId) {
    const tab = this.find(tabId);
    if (!tab) return false;
    tab.ready = false;
    this.onTabsChanged(this.list());
    tab.view.webContents.reload();
    return true;
  }

  close(tabId) {
    const idx = this.tabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return false;
    const [tab] = this.tabs.splice(idx, 1);
    if (tab.watchdog) clearInterval(tab.watchdog);
    try {
      this.mainWindow.contentView.removeChildView(tab.view);
      tab.view.webContents.close();
    } catch (_) {}
    if (this.activeId === tabId) {
      this.activeId = this.tabs.length ? this.tabs[0].id : null;
    }
    this.applyBounds();
    this.onTabsChanged(this.list());
    this.log('info', `🗑 Đã đóng ${tabId}`);
    return true;
  }

  closeAll() {
    for (const tab of [...this.tabs]) this.close(tab.id);
  }

  /** Gửi một message xuống engine của một tab (thay chrome.tabs.sendMessage). */
  async dispatch(tabId, message) {
    const tab = this.find(tabId);
    if (!tab) return { ok: false, error: 'Không tìm thấy tab' };
    try {
      const payload = JSON.stringify(message);
      return await tab.view.webContents.executeJavaScript(
        `window.__flowShimDispatch && window.__flowShimDispatch(${payload})`, true
      );
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async broadcast(message) {
    return Promise.all(this.tabs.map((t) => this.dispatch(t.id, message)));
  }
}

module.exports = { TabManager, FLOW_URL, FLOW_HOST_RE, khungChoTab };
