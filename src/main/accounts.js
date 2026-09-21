// ============================================================================
//  accounts.js — NHIỀU TÀI KHOẢN FLOW, MỖI TÀI KHOẢN MỘT PHIÊN RIÊNG
//  --------------------------------------------------------------------------
//  Bản tiện ích Chrome KHÔNG làm được việc này. Tiện ích sống trong profile
//  Chrome của người dùng và dùng chung đúng một bộ cookie — muốn chạy tài
//  khoản khác thì phải đăng xuất rồi đăng nhập lại, hoặc mở hẳn một profile
//  Chrome khác rồi cài lại tiện ích vào đó.
//
//  Electron cho phép mỗi phiên (session partition) có kho cookie và storage
//  RIÊNG BIỆT, hoàn toàn không thấy nhau:
//
//      session.fromPartition('persist:flow-acc3')
//
//  Nên mỗi tài khoản ở đây là một partition riêng. Hệ quả:
//    • Đăng nhập tài khoản A không đá tài khoản B ra.
//    • Nhiều tài khoản chạy CÙNG LÚC, mỗi tài khoản lại mở được nhiều tab.
//    • Xoá một tài khoản là xoá sạch dữ liệu phiên của đúng tài khoản đó.
//
//  Lưu ý về thư mục tải: mỗi tài khoản đặt được thư mục tải riêng, nếu không
//  video của các tài khoản trộn lẫn vào nhau và rất khó lần ra cái nào của ai.
// ============================================================================

const STORE_KEY = 'veoAccounts';

/** Ký tự an toàn cho tên partition — chỉ chữ, số, gạch. */
function slugId(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'acc';
}

class AccountManager {
  /**
   * @param {object} store   kho lưu trữ (src/main/store.js)
   * @param {(lvl:string,msg:string)=>void} log
   */
  constructor(store, log) {
    this.store = store;
    this.log = log || (() => {});
    /** @type {Array<{id,name,partition,downloadDir,createdAt}>} */
    this.accounts = [];
    this.load();
  }

  load() {
    const saved = this.store.get(STORE_KEY)[STORE_KEY];
    this.accounts = Array.isArray(saved) ? saved : [];

    // Lần đầu chạy: dựng sẵn một tài khoản để người dùng không phải nghĩ.
    if (!this.accounts.length) {
      this.accounts = [{
        id: 'mac-dinh',
        name: 'Tài khoản 1',
        partition: 'persist:flow-mac-dinh',
        downloadDir: '',
        createdAt: Date.now()
      }];
      this.save();
    }

    // Bản 2.0.x cũ dùng chung đúng một partition tên 'persist:flow'. Giữ nguyên
    // partition đó cho tài khoản đầu tiên để người dùng KHÔNG phải đăng nhập
    // lại sau khi cập nhật.
    const first = this.accounts[0];
    if (first && first.id === 'mac-dinh' && !first._daChuyen) {
      first.partition = 'persist:flow';
      first._daChuyen = true;
      this.save();
    }
  }

  save() {
    this.store.set({ [STORE_KEY]: this.accounts });
  }

  list() {
    return this.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      partition: a.partition,
      downloadDir: a.downloadDir || '',
      createdAt: a.createdAt
    }));
  }

  find(id) {
    return this.accounts.find((a) => a.id === id) || null;
  }

  /** Tài khoản dùng khi không chỉ định rõ. */
  primary() {
    return this.accounts[0] || null;
  }

  /**
   * Thêm tài khoản mới. Tên trùng vẫn cho phép — id mới là thứ phân biệt.
   */
  create(name) {
    const base = slugId(name) || 'acc';
    let id = base;
    let n = 2;
    while (this.find(id)) id = `${base}-${n++}`;

    const acc = {
      id,
      name: String(name || '').trim() || `Tài khoản ${this.accounts.length + 1}`,
      partition: `persist:flow-${id}`,
      downloadDir: '',
      createdAt: Date.now()
    };
    this.accounts.push(acc);
    this.save();
    this.log('success', `👤 Đã thêm tài khoản "${acc.name}"`);
    return acc;
  }

  rename(id, name) {
    const acc = this.find(id);
    if (!acc) return false;
    acc.name = String(name || '').trim() || acc.name;
    this.save();
    return true;
  }

  setDownloadDir(id, dir) {
    const acc = this.find(id);
    if (!acc) return false;
    acc.downloadDir = dir || '';
    this.save();
    return true;
  }

  /**
   * Xoá tài khoản. KHÔNG cho xoá tài khoản cuối cùng — xoá hết rồi thì không
   * còn chỗ nào mở tab, người dùng kẹt cứng.
   */
  remove(id) {
    if (this.accounts.length <= 1) {
      return { ok: false, error: 'Phải giữ lại ít nhất một tài khoản' };
    }
    const i = this.accounts.findIndex((a) => a.id === id);
    if (i < 0) return { ok: false, error: 'Không tìm thấy tài khoản' };
    const [acc] = this.accounts.splice(i, 1);
    this.save();
    this.log('warning', `🗑 Đã xoá tài khoản "${acc.name}"`);
    return { ok: true, account: acc };
  }

  /**
   * Đăng xuất: xoá sạch cookie và storage của ĐÚNG phiên đó.
   * Các tài khoản khác không hề bị đụng tới.
   */
  async logout(id) {
    const acc = this.find(id);
    if (!acc) return { ok: false, error: 'Không tìm thấy tài khoản' };
    try {
      const { session } = require('electron');
      const ses = session.fromPartition(acc.partition);
      await ses.clearStorageData();      // cookie, localStorage, cache, IndexedDB…
      this.log('warning', `🚪 Đã đăng xuất "${acc.name}"`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Đã đăng nhập chưa — dò bằng cookie của Google trong đúng phiên đó.
   * Chỉ đếm số cookie, KHÔNG đọc giá trị: giá trị cookie là thông tin đăng
   * nhập, tool không có việc gì phải chạm vào.
   */
  async isLoggedIn(id) {
    const acc = this.find(id);
    if (!acc) return false;
    try {
      const { session } = require('electron');
      const ses = session.fromPartition(acc.partition);
      const cookies = await ses.cookies.get({ domain: '.google.com' });
      return cookies.some((c) => c.name === 'SID' || c.name === '__Secure-1PSID');
    } catch (_) {
      return false;
    }
  }

  sessionFor(id) {
    const acc = this.find(id) || this.primary();
    if (!acc) return null;
    const { session } = require('electron');
    return session.fromPartition(acc.partition);
  }
}

module.exports = { AccountManager, slugId };
