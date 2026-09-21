'use strict';

// ============================================================================
//  cap-nhat.js — TỰ CẬP NHẬT từ GitHub Releases, trên Windows lẫn macOS
//  --------------------------------------------------------------------------
//
//  VÌ SAO TỰ VIẾT, KHÔNG DÙNG electron-updater
//  electron-updater lo tốt phần Windows, nhưng trên macOS nó đi qua Squirrel.Mac
//  — thứ ĐÒI chữ ký Developer ID thật của Apple (99 USD/năm). App này chỉ ký
//  ad-hoc, nên Squirrel.Mac từ chối cài và bạn bè dùng Mac sẽ kẹt mãi ở bản cũ.
//  Viết một đường chung cho cả hai thì cả hai cùng chạy, cùng được kiểm thử.
//
//  ĐƯỜNG ĐI
//   1. Hỏi GitHub: bản phát hành mới nhất là gì?
//        GET https://api.github.com/repos/<chủ>/<repo>/releases/latest
//   2. Mới hơn bản đang chạy → chọn đúng file cho máy này:
//        Windows  FlowAutomationStudio-<v>-setup.exe
//        Mac      FlowAutomationStudio-<v>-mac-<arm64|x64>.zip
//   3. Tải ngầm về thư mục dữ liệu, KIỂM kích thước và mã băm sha256 (GitHub
//      ghi sẵn trong trường `digest` của từng file). Lệch là xoá, không cài.
//   4. Cài — KHÔNG BAO GIỜ khi đang có tab chạy mẻ, trừ khi người dùng bấm
//      xác nhận. Cài xong app tự mở lại. Hoặc để app tự cài khi bạn thoát.
//        Windows  chạy bộ cài NSIS ở chế độ im lặng (/S --updated)
//        Mac      giải nén, rồi một đoạn script nhỏ đợi app thoát hẳn, đổi
//                 .app cũ lấy .app mới (giữ bản cũ tới khi đổi xong mới xoá,
//                 hỏng giữa chừng thì trả lại bản cũ), rồi mở lại.
//
//  NHỮNG TRƯỜNG HỢP KHÔNG TỰ CÀI ĐƯỢC (và app nói rõ, chứ không im lặng):
//   • Chạy từ mã nguồn (CHAY_TU_NGUON.*): chỉ báo có bản mới + link tải.
//   • Bản portable .exe: tải bộ cài setup.exe về và mở nó lên — cài một lần
//     là từ đó về sau tự cập nhật được.
//   • Mac chạy app ngay trong thư mục Tải về (macOS "cách ly" nó sang một ổ
//     chỉ đọc) hoặc không có quyền ghi vào Applications: mở Finder tới file
//     vừa tải để kéo vào Applications.
//
//  Dữ liệu người dùng (tài khoản, phiên đăng nhập Google, cài đặt, dự án)
//  nằm trong thư mục dữ liệu riêng, KHÔNG nằm trong app — thay app không đụng.
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Hàm thuần ───────────────────────────────────────────────────────────────

/** "v2.10.0" > "2.9.3"? Trả 1 / 0 / -1. Bỏ qua đuôi "-beta" cho đơn giản. */
function soSanhPhienBan(a, b) {
  const tach = (v) => String(v || '').trim().replace(/^v/i, '').split('-')[0]
    .split('.').map((x) => parseInt(x, 10) || 0);
  const x = tach(a), y = tach(b);
  for (let i = 0; i < Math.max(x.length, y.length, 3); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** "https://github.com/Chu/Repo.git" → "Chu/Repo". */
function layRepo(pkg) {
  const r = pkg && pkg.repository;
  const url = typeof r === 'string' ? r : (r && r.url) || '';
  const m = url.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/#?].*)?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Chọn đúng file cho máy này trong một bản phát hành GitHub.
 * @returns {{ten, url, size, sha256}|null}
 */
function chonTaiSan(release, platform, arch) {
  const ds = (release && Array.isArray(release.assets)) ? release.assets : [];
  let mau;
  if (platform === 'win32') mau = /-setup\.exe$/i;
  else if (platform === 'darwin') mau = new RegExp(`-mac-${arch === 'arm64' ? 'arm64' : 'x64'}\\.zip$`, 'i');
  else return null;
  const a = ds.find((x) => x && mau.test(x.name || ''));
  if (!a) return null;
  const dg = String(a.digest || '');
  return {
    ten: a.name,
    url: a.browser_download_url,
    size: Number(a.size) || 0,
    sha256: /^sha256:[0-9a-f]{64}$/i.test(dg) ? dg.slice(7).toLowerCase() : null
  };
}

/**
 * Máy này tự cài được không, và cài kiểu gì.
 *   tu-dong   — tự tải, tự cài, tự mở lại
 *   mo-bo-cai — (Windows portable) tải bộ cài rồi mở nó lên cho người dùng cài
 *   mo-finder — (Mac không thay được app) tải về rồi mở Finder tới file
 *   thu-cong  — (chạy từ mã nguồn) chỉ báo có bản mới, không tải
 * @returns {{kieu:string, lyDo?:string, appPath?:string}}
 */
function kieuCaiDat(o) {
  if (!o.isPackaged) {
    return { kieu: 'thu-cong', lyDo: 'Đang chạy từ mã nguồn — tải gói mã nguồn mới, giải nén đè lên thư mục đang dùng.' };
  }
  if (o.platform === 'win32') {
    if (o.env && o.env.PORTABLE_EXECUTABLE_FILE) {
      return { kieu: 'mo-bo-cai', lyDo: 'Bản portable không tự thay được chính nó — app sẽ tải bộ cài và mở lên. Cài một lần, từ đó về sau tự cập nhật.' };
    }
    return { kieu: 'tu-dong' };
  }
  if (o.platform === 'darwin') {
    // .../Flow Automation Studio.app/Contents/MacOS/Flow Automation Studio
    const appPath = path.resolve(o.execPath, '..', '..', '..');
    if (!/\.app$/i.test(appPath)) return { kieu: 'thu-cong', lyDo: 'Không xác định được vị trí app.' };
    if (/\/AppTranslocation\//.test(appPath)) {
      return { kieu: 'mo-finder', appPath,
        lyDo: 'App đang chạy thẳng từ thư mục Tải về nên macOS khoá nó lại (chỉ đọc). Kéo app vào thư mục Applications rồi mở lại là tự cập nhật được.' };
    }
    if (!o.ghiDuoc(path.dirname(appPath)) || !o.ghiDuoc(appPath)) {
      return { kieu: 'mo-finder', appPath, lyDo: `Không có quyền ghi vào ${path.dirname(appPath)}.` };
    }
    return { kieu: 'tu-dong', appPath };
  }
  return { kieu: 'thu-cong', lyDo: 'Hệ điều hành này chưa hỗ trợ tự cập nhật.' };
}

/** Đoạn script đổi app trên Mac. Tách ra hàm thuần để kiểm thử đọc được. */
function scriptDoiAppMac() {
  return [
    '#!/bin/bash',
    '# Chạy SAU khi Flow Automation Studio thoát: đổi .app cũ lấy .app mới.',
    'PID="$1"; CU="$2"; MOI="$3"; MO_LAI="$4"; LOG="$5"',
    'exec >>"$LOG" 2>&1',
    'echo "== $(date) cập nhật: $CU"',
    '# Đợi app thoát hẳn (tối đa 60 giây).',
    'for i in $(seq 1 60); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done',
    'BAK="${CU%.app}.cu-$$.app"',
    'if ! mv "$CU" "$BAK"; then echo "Không dời được bản cũ"; exit 1; fi',
    'if mv "$MOI" "$CU"; then',
    '  rm -rf "$BAK"',
    '  xattr -dr com.apple.quarantine "$CU" 2>/dev/null',
    '  echo "Xong"',
    'else',
    '  echo "Không đặt được bản mới — trả lại bản cũ"',
    '  mv "$BAK" "$CU"',
    'fi',
    'if [ "$MO_LAI" = "1" ]; then open "$CU"; fi',
    ''
  ].join('\n');
}

/**
 * Đọc phiên bản trong Info.plist của một .app. electron-builder ghi plist dạng
 * XML nên đọc thẳng được, khỏi phụ thuộc plutil (cờ "raw" chỉ có từ macOS 12).
 */
function docPhienBanApp(appPath) {
  try {
    const x = fs.readFileSync(path.join(appPath, 'Contents', 'Info.plist'), 'utf8');
    const m = x.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
    return m ? m[1].trim() : '';
  } catch (_) { return ''; }
}

// ── Bộ cập nhật ─────────────────────────────────────────────────────────────

class BoCapNhat {
  /**
   * @param {object} o
   *   phienBan, repo, platform, arch, execPath, isPackaged, env, thuMuc,
   *   fetch(url, opts)           — net.fetch của Electron (theo proxy hệ thống)
   *   spawn(cmd, args, opts)     — child_process.spawn
   *   execFile(cmd, args)        — Promise<stdout>, cho ditto/plutil trên Mac
   *   thoatApp()                 — app.quit()
   *   moFinder(p), moLink(url)
   *   coTabDangChay()            — true nếu còn tab đang chạy mẻ
   *   log(muc, chu), gui(trangThai)
   *   apiGoc                     — mặc định https://api.github.com
   */
  constructor(o) {
    this.o = o;
    this.apiGoc = (o.apiGoc || 'https://api.github.com').replace(/\/$/, '');
    this.caiDatNguoiDung = { tuKiem: true, tuTai: true, tuCaiKhiThoat: true };
    this.dangCai = false;
    this.tt = {
      trangThai: 'chua-kiem',       // chua-kiem | dang-kiem | moi-nhat | co-ban-moi | dang-tai | da-tai | loi
      phienBanHienTai: o.phienBan,
      phienBanMoi: null,
      ghiChu: '',
      trangPhatHanh: o.repo ? `https://github.com/${o.repo}/releases/latest` : null,
      tienDo: 0,
      loi: null,
      kiemLuc: null,
      ...kieuCaiDat({ ...o, ghiDuoc: (p) => this._ghiDuoc(p) })
    };
  }

  _ghiDuoc(p) {
    try { fs.accessSync(p, fs.constants.W_OK); return true; } catch (_) { return false; }
  }

  _dat(thay) {
    Object.assign(this.tt, thay);
    try { this.o.gui && this.o.gui({ ...this.tt }); } catch (_) {}
  }

  trangThai() { return { ...this.tt, caiDat: { ...this.caiDatNguoiDung } }; }

  datCaiDat(c) {
    if (!c) return;
    for (const k of Object.keys(this.caiDatNguoiDung)) {
      if (typeof c[k] === 'boolean') this.caiDatNguoiDung[k] = c[k];
    }
  }

  /** Hỏi GitHub bản mới nhất. imLang = không ghi nhật ký khi không có gì mới. */
  async kiemTra({ imLang = false } = {}) {
    if (!this.o.repo) {
      this._dat({ trangThai: 'loi', loi: 'package.json chưa ghi địa chỉ repo GitHub' });
      return this.trangThai();
    }
    if (['dang-kiem', 'dang-tai'].includes(this.tt.trangThai) || this.dangCai) return this.trangThai();
    this._dat({ trangThai: 'dang-kiem', loi: null });

    let rel;
    try {
      const res = await this.o.fetch(`${this.apiGoc}/repos/${this.o.repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'FlowAutomationStudio-cap-nhat' }
      });
      if (res.status === 404) {
        this._dat({ trangThai: 'loi', kiemLuc: Date.now(),
          loi: `Chưa thấy bản phát hành nào ở github.com/${this.o.repo} (hoặc repo đang để riêng tư — bạn bè sẽ không nhận được cập nhật).` });
        if (!imLang) this.o.log('warning', `🔄 ${this.tt.loi}`);
        return this.trangThai();
      }
      if (!res.ok) throw new Error(`GitHub trả mã ${res.status}`);
      rel = await res.json();
    } catch (err) {
      this._dat({ trangThai: 'loi', loi: `Không hỏi được GitHub: ${err.message}${err.cause ? " (" + (err.cause.code || err.cause.message) + ")" : ""}`, kiemLuc: Date.now() });
      if (!imLang) this.o.log('warning', `🔄 ${this.tt.loi}`);
      return this.trangThai();
    }

    const moi = String(rel.tag_name || rel.name || '').replace(/^v/i, '');
    const ghiChu = String(rel.body || '').slice(0, 3000);
    if (!moi || soSanhPhienBan(moi, this.o.phienBan) <= 0) {
      this._dat({ trangThai: 'moi-nhat', phienBanMoi: null, kiemLuc: Date.now() });
      if (!imLang) this.o.log('info', `🔄 Đang dùng bản mới nhất (${this.o.phienBan}).`);
      return this.trangThai();
    }

    const taiSan = chonTaiSan(rel, this.o.platform, this.o.arch);
    this.taiSan = taiSan;
    this._dat({
      trangThai: 'co-ban-moi', phienBanMoi: moi, ghiChu, kiemLuc: Date.now(),
      trangPhatHanh: rel.html_url || this.tt.trangPhatHanh
    });
    this.o.log('success', `🔄 Có bản mới ${moi} (đang dùng ${this.o.phienBan}).`);

    if (!taiSan) {
      this._dat({ loi: `Bản ${moi} chưa có file cho máy này — tải tay ở trang phát hành.` });
      return this.trangThai();
    }
    if (this.tt.kieu !== 'thu-cong' && this.caiDatNguoiDung.tuTai) await this.tai();
    return this.trangThai();
  }

  /** Tải file cài về, kiểm kích thước + sha256. */
  async tai() {
    const ts = this.taiSan;
    if (!ts) return this.trangThai();
    if (this.tt.trangThai === 'dang-tai') return this.trangThai();

    const thuMuc = path.join(this.o.thuMuc, 'cap-nhat');
    fs.mkdirSync(thuMuc, { recursive: true });
    const dich = path.join(thuMuc, ts.ten);
    const tam = dich + '.dang-tai';

    // Đã tải đủ từ trước (lần mở app trước) thì khỏi tải lại.
    if (fs.existsSync(dich) && await this._dung(dich, ts)) {
      this.fileTai = dich;
      this._dat({ trangThai: 'da-tai', tienDo: 100, loi: null });
      this.o.log('success', `🔄 Bản ${this.tt.phienBanMoi} đã tải sẵn — sẵn sàng cài.`);
      return this.trangThai();
    }

    this._dat({ trangThai: 'dang-tai', tienDo: 0, loi: null });
    try {
      const res = await this.o.fetch(ts.url, { headers: { 'User-Agent': 'FlowAutomationStudio-cap-nhat' } });
      if (!res.ok || !res.body) throw new Error(`máy chủ trả mã ${res.status}`);
      const tong = ts.size || Number(res.headers.get('content-length')) || 0;
      const ghi = fs.createWriteStream(tam);
      const doc = res.body.getReader();
      let da = 0, lanBao = 0;
      for (;;) {
        const { done, value } = await doc.read();
        if (done) break;
        da += value.length;
        if (!ghi.write(Buffer.from(value))) await new Promise((r) => ghi.once('drain', r));
        const pt = tong ? Math.floor((da / tong) * 100) : 0;
        if (pt !== lanBao) { lanBao = pt; this._dat({ tienDo: pt }); }
      }
      await new Promise((r, j) => ghi.end((e) => (e ? j(e) : r())));

      if (!(await this._dung(tam, ts))) {
        try { fs.unlinkSync(tam); } catch (_) {}
        throw new Error('file tải về không khớp kích thước/mã băm — đã xoá, sẽ thử lại lần sau');
      }
      try { fs.unlinkSync(dich); } catch (_) {}
      fs.renameSync(tam, dich);
      // Dọn bản tải của những lần trước — mỗi file cả trăm MB.
      for (const f of fs.readdirSync(thuMuc)) {
        const p = path.join(thuMuc, f);
        if (p === dich || /\.(sh|log)$/.test(f)) continue;
        try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
      }
      this.fileTai = dich;
      this._dat({ trangThai: 'da-tai', tienDo: 100 });
      this.o.log('success', `🔄 Đã tải xong bản ${this.tt.phienBanMoi}` +
        (this.tt.kieu === 'tu-dong' ? ' — bấm "Cài & mở lại" ở mục Cập nhật, hoặc app tự cài khi bạn thoát.' : '.'));
    } catch (err) {
      try { fs.unlinkSync(tam); } catch (_) {}
      this._dat({ trangThai: 'loi', loi: `Tải bản mới hỏng: ${err.message}` });
      this.o.log('warning', `🔄 ${this.tt.loi}`);
    }
    return this.trangThai();
  }

  async _dung(file, ts) {
    try {
      const st = fs.statSync(file);
      if (ts.size && st.size !== ts.size) return false;
      if (ts.sha256) {
        const h = crypto.createHash('sha256');
        await new Promise((r, j) => fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', r).on('error', j));
        if (h.digest('hex') !== ts.sha256) return false;
      }
      return true;
    } catch (_) { return false; }
  }

  /**
   * Cài bản đã tải.
   * @param {object} p
   *   moLai   — cài xong mở lại app (bấm nút) / không (lúc thoát app)
   *   epBuoc  — vẫn cài dù đang có tab chạy mẻ (người dùng đã xác nhận)
   *   thoat   — tự gọi thoát app (false khi đang ở trong before-quit)
   */
  async caiDat({ moLai = true, epBuoc = false, thoat = true } = {}) {
    if (this.tt.trangThai !== 'da-tai' || !this.fileTai) {
      return { ok: false, lyDo: 'Chưa có bản mới nào tải xong' };
    }
    if (this.dangCai) return { ok: false, lyDo: 'Đang cài rồi' };
    if (!epBuoc && this.o.coTabDangChay()) {
      return { ok: false, canXacNhan: true,
        lyDo: 'Đang có tab chạy mẻ. Cài bây giờ sẽ dừng ngang mẻ đó (dự án đã lưu vẫn còn, mở lại chạy tiếp được).' };
    }

    const kieu = this.tt.kieu;
    try {
      if (this.o.platform === 'win32' && (kieu === 'tu-dong' || kieu === 'mo-bo-cai')) {
        // Bản cài đặt: /S = im lặng, --updated = giữ nguyên thư mục cài cũ,
        // --force-run = cài xong tự mở app. Bản portable: mở bộ cài bình thường.
        const args = kieu === 'tu-dong' ? ['/S', '--updated'].concat(moLai ? ['--force-run'] : []) : [];
        const p = this.o.spawn(this.fileTai, args, { detached: true, stdio: 'ignore' });
        p.unref();
        this.dangCai = true;
        this.o.log('success', `🔄 Đang cài bản ${this.tt.phienBanMoi}…` + (moLai ? ' App sẽ tự mở lại.' : ''));
        if (thoat) setTimeout(() => this.o.thoatApp(), 400);
        return { ok: true };
      }

      if (this.o.platform === 'darwin') {
        if (kieu !== 'tu-dong') {
          this.o.moFinder(this.fileTai);
          return { ok: false, thuCong: true,
            lyDo: `${this.tt.lyDo || ''} Đã mở Finder tới file vừa tải: bấm đúp để giải nén rồi kéo app vào Applications.`.trim() };
        }
        const thuMuc = path.join(path.dirname(this.fileTai), `giai-nen-${this.tt.phienBanMoi}`);
        fs.rmSync(thuMuc, { recursive: true, force: true });
        fs.mkdirSync(thuMuc, { recursive: true });
        // ditto giữ nguyên symlink và quyền chạy của các khung Electron —
        // giải nén bằng thư viện zip thường là hỏng app.
        await this.o.execFile('/usr/bin/ditto', ['-x', '-k', this.fileTai, thuMuc]);
        const appMoi = fs.readdirSync(thuMuc).find((f) => /\.app$/i.test(f));
        if (!appMoi) throw new Error('trong file zip không có .app');
        const duongMoi = path.join(thuMuc, appMoi);
        const ver = docPhienBanApp(duongMoi);
        if (soSanhPhienBan(ver, this.tt.phienBanMoi) !== 0) {
          throw new Error(`app trong gói là bản ${ver}, không phải ${this.tt.phienBanMoi}`);
        }
        const script = path.join(path.dirname(this.fileTai), 'doi-app.sh');
        fs.writeFileSync(script, scriptDoiAppMac(), { mode: 0o755 });
        const p = this.o.spawn('/bin/bash',
          [script, String(process.pid), this.tt.appPath, duongMoi, moLai ? '1' : '0',
           path.join(path.dirname(this.fileTai), 'cap-nhat.log')],
          { detached: true, stdio: 'ignore' });
        p.unref();
        this.dangCai = true;
        this.o.log('success', `🔄 Đang cài bản ${this.tt.phienBanMoi}…` + (moLai ? ' App sẽ tự mở lại.' : ''));
        if (thoat) setTimeout(() => this.o.thoatApp(), 400);
        return { ok: true };
      }

      return { ok: false, lyDo: this.tt.lyDo || 'Máy này không tự cài được' };
    } catch (err) {
      this._dat({ loi: `Cài bản mới hỏng: ${err.message}` });
      this.o.log('error', `🔄 ${this.tt.loi}`);
      return { ok: false, lyDo: this.tt.loi };
    }
  }

  /**
   * Có nên cài ngay lúc người dùng thoát app không. main.js gọi trong
   * before-quit: true thì chặn thoát lại, chờ caiDat() lo xong (trên Mac phải
   * giải nén + kiểm phiên bản TRƯỚC khi app tắt), rồi caiDat tự thoát.
   */
  nenCaiKhiThoat() {
    return !this.dangCai && !this.boQuaKhiThoat && this.caiDatNguoiDung.tuCaiKhiThoat &&
      this.tt.trangThai === 'da-tai' && this.tt.kieu === 'tu-dong';
  }
}

module.exports = { BoCapNhat, soSanhPhienBan, layRepo, chonTaiSan, kieuCaiDat, scriptDoiAppMac, docPhienBanApp };
