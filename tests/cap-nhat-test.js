// ============================================================================
//  cap-nhat-test.js — TỰ CẬP NHẬT: kiểm với một "GitHub giả" chạy tại chỗ
//  --------------------------------------------------------------------------
//  Chạy:  node tests/cap-nhat-test.js
//
//  Dựng một máy chủ HTTP giả làm api.github.com + nơi chứa file, rồi đi hết
//  mọi nhánh của src/main/cap-nhat.js bằng fetch THẬT (Node 22 — cùng giao
//  diện với net.fetch của Electron):
//    • có bản mới / đã mới nhất / repo chưa có bản phát hành (404)
//    • tải qua chuyển hướng 302 (GitHub luôn chuyển hướng file tải về)
//    • file hỏng (sai mã băm) → xoá, KHÔNG cài
//    • Windows: đang chạy mẻ thì đòi xác nhận; cài bằng /S --updated
//    • Mac: gói .zip THẬT của bản dựng (nếu có trong dist/) — giải nén, đọc
//      phiên bản trong Info.plist, rồi CHẠY THẬT đoạn script đổi app bằng bash,
//      cả nhánh thành công lẫn nhánh hỏng giữa chừng phải trả lại bản cũ.
// ============================================================================

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const CN = require('../src/main/cap-nhat');

let pass = 0;
const failures = [];
async function test(ten, fn) {
  try { await fn(); pass++; console.log(`   ✓ ${ten}`); }
  catch (e) { failures.push(`${ten}\n     ${e.message}`); console.log(`   ✗ ${ten}\n     ${e.message}`); }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-nhat-'));
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ── GitHub giả ──────────────────────────────────────────────────────────────
const FILE = {};                      // tên → Buffer
let RELEASE = null;                   // JSON trả cho /releases/latest (null = 404)
let HONG = new Set();                 // tên file sẽ bị gửi SAI nội dung
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/repos/Chu/Repo/releases/latest') {
    if (!RELEASE) { res.writeHead(404); return res.end('{"message":"Not Found"}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(RELEASE));
  }
  // GitHub trả 302 sang kho file — giữ đúng thói quen đó.
  if (u.pathname.startsWith('/dl/')) {
    res.writeHead(302, { location: '/blob/' + u.pathname.slice(4) });
    return res.end();
  }
  if (u.pathname.startsWith('/blob/')) {
    const ten = decodeURIComponent(u.pathname.slice(6));
    let b = FILE[ten];
    if (!b) { res.writeHead(404); return res.end(); }
    if (HONG.has(ten)) { b = Buffer.from(b); b[b.length - 1] ^= 0xff; }
    res.writeHead(200, { 'content-length': b.length });
    return res.end(b);
  }
  res.writeHead(404); res.end();
});

function taiSan(goc, ten) {
  return { name: ten, size: FILE[ten].length, digest: 'sha256:' + sha(FILE[ten]),
           browser_download_url: `${goc}/dl/${encodeURIComponent(ten)}` };
}

function boMoi(goc, them = {}) {
  const ghi = { spawn: [], thoat: 0, finder: [], log: [] };
  const bo = new CN.BoCapNhat({
    phienBan: '2.7.0', repo: 'Chu/Repo', platform: 'win32', arch: 'x64',
    execPath: 'C:\\\\x\\\\Flow Automation Studio.exe', isPackaged: true, env: {},
    thuMuc: fs.mkdtempSync(path.join(TMP, 'du-lieu-')),
    apiGoc: goc,
    fetch: (u, o) => fetch(u, o),
    spawn: (cmd, args, opts) => { ghi.spawn.push({ cmd, args, opts }); return { unref() {} }; },
    execFile: async () => '',
    thoatApp: () => { ghi.thoat++; },
    moFinder: (p) => ghi.finder.push(p),
    coTabDangChay: () => false,
    log: (m, c) => ghi.log.push(`${m}: ${c}`),
    gui: () => {},
    ...them
  });
  return { bo, ghi };
}

const doi = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const GOC = `http://127.0.0.1:${srv.address().port}`;

  console.log('\n── Hàm thuần ─────────────────────────────────────────────');

  await test('so phiên bản: 2.10.0 > 2.9.3, v2.8.0 = 2.8.0, 2.8 = 2.8.0', () => {
    assert.strictEqual(CN.soSanhPhienBan('2.10.0', '2.9.3'), 1);
    assert.strictEqual(CN.soSanhPhienBan('v2.8.0', '2.8.0'), 0);
    assert.strictEqual(CN.soSanhPhienBan('2.8', '2.8.0'), 0);
    assert.strictEqual(CN.soSanhPhienBan('2.7.0', '2.8.0'), -1);
  });

  await test('đọc repo từ package.json (có/không .git)', () => {
    assert.strictEqual(CN.layRepo({ repository: { url: 'https://github.com/RollReus6868/Tool-flow-veo3.git' } }), 'RollReus6868/Tool-flow-veo3');
    assert.strictEqual(CN.layRepo({ repository: 'https://github.com/a/b' }), 'a/b');
    assert.strictEqual(CN.layRepo({}), null);
  });

  await test('chọn đúng file: Windows lấy setup.exe, KHÔNG lấy portable', () => {
    const rel = { assets: [
      { name: 'FlowAutomationStudio-2.8.0-portable.exe', size: 1 },
      { name: 'FlowAutomationStudio-2.8.0-setup.exe', size: 2, digest: 'sha256:' + 'a'.repeat(64) },
      { name: 'FlowAutomationStudio-2.8.0-mac-arm64.zip', size: 3 },
      { name: 'FlowAutomationStudio-2.8.0-mac-x64.zip', size: 4 }
    ] };
    const w = CN.chonTaiSan(rel, 'win32', 'x64');
    assert.strictEqual(w.ten, 'FlowAutomationStudio-2.8.0-setup.exe');
    assert.strictEqual(w.sha256, 'a'.repeat(64));
    assert.strictEqual(CN.chonTaiSan(rel, 'darwin', 'arm64').ten, 'FlowAutomationStudio-2.8.0-mac-arm64.zip');
    assert.strictEqual(CN.chonTaiSan(rel, 'darwin', 'x64').ten, 'FlowAutomationStudio-2.8.0-mac-x64.zip');
    assert.strictEqual(CN.chonTaiSan(rel, 'linux', 'x64'), null);
    assert.strictEqual(CN.chonTaiSan({ assets: [] }, 'win32', 'x64'), null);
  });

  await test('kiểu cài: mã nguồn / portable / Windows cài đặt', () => {
    assert.strictEqual(CN.kieuCaiDat({ isPackaged: false, platform: 'win32' }).kieu, 'thu-cong');
    assert.strictEqual(CN.kieuCaiDat({ isPackaged: true, platform: 'win32', env: { PORTABLE_EXECUTABLE_FILE: 'x' } }).kieu, 'mo-bo-cai');
    assert.strictEqual(CN.kieuCaiDat({ isPackaged: true, platform: 'win32', env: {} }).kieu, 'tu-dong');
  });

  await test('kiểu cài Mac: chạy từ Tải về (AppTranslocation) thì KHÔNG tự thay', () => {
    const k = CN.kieuCaiDat({ isPackaged: true, platform: 'darwin', ghiDuoc: () => true,
      execPath: '/private/var/folders/x/T/AppTranslocation/ABC/d/Flow Automation Studio.app/Contents/MacOS/Flow Automation Studio' });
    assert.strictEqual(k.kieu, 'mo-finder');
    assert.ok(/Applications/.test(k.lyDo));
  });

  await test('kiểu cài Mac: không ghi được Applications thì KHÔNG tự thay', () => {
    const k = CN.kieuCaiDat({ isPackaged: true, platform: 'darwin', ghiDuoc: () => false,
      execPath: '/Applications/Flow Automation Studio.app/Contents/MacOS/Flow Automation Studio' });
    assert.strictEqual(k.kieu, 'mo-finder');
    const k2 = CN.kieuCaiDat({ isPackaged: true, platform: 'darwin', ghiDuoc: () => true,
      execPath: '/Applications/Flow Automation Studio.app/Contents/MacOS/Flow Automation Studio' });
    assert.strictEqual(k2.kieu, 'tu-dong');
    assert.strictEqual(k2.appPath, '/Applications/Flow Automation Studio.app');
  });

  await test('script đổi app trên Mac: cú pháp bash hợp lệ', () => {
    if (process.platform === 'win32') return;          // máy dựng Windows: không có bash chắc chắn
    const f = path.join(TMP, 'kiem.sh');
    fs.writeFileSync(f, CN.scriptDoiAppMac());
    const r = spawnSync('bash', ['-n', f]);
    assert.strictEqual(r.status, 0, String(r.stderr));
  });

  console.log('\n── Windows, với GitHub giả ───────────────────────────────');

  FILE['FlowAutomationStudio-2.8.0-setup.exe'] = crypto.randomBytes(300 * 1024);

  await test('repo chưa có bản phát hành (404): báo rõ, không ném lỗi', async () => {
    RELEASE = null;
    const { bo } = boMoi(GOC);
    const tt = await bo.kiemTra();
    assert.strictEqual(tt.trangThai, 'loi');
    assert.ok(/riêng tư/.test(tt.loi), tt.loi);
  });

  await test('cùng phiên bản → "mới nhất", không tải gì', async () => {
    RELEASE = { tag_name: 'v2.7.0', assets: [] };
    const { bo } = boMoi(GOC);
    const tt = await bo.kiemTra();
    assert.strictEqual(tt.trangThai, 'moi-nhat');
  });

  await test('có bản mới → tự tải qua chuyển hướng 302, kiểm sha256, sẵn sàng cài', async () => {
    RELEASE = { tag_name: 'v2.8.0', body: 'Có gì mới', html_url: 'https://github.com/Chu/Repo/releases/tag/v2.8.0',
                assets: [taiSan(GOC, 'FlowAutomationStudio-2.8.0-setup.exe')] };
    const { bo } = boMoi(GOC);
    const tt = await bo.kiemTra();
    assert.strictEqual(tt.trangThai, 'da-tai', JSON.stringify(tt));
    assert.strictEqual(tt.phienBanMoi, '2.8.0');
    assert.ok(fs.readFileSync(bo.fileTai).equals(FILE['FlowAutomationStudio-2.8.0-setup.exe']));
  });

  await test('file tải về bị hỏng (sai mã băm) → xoá, KHÔNG cài', async () => {
    HONG = new Set(['FlowAutomationStudio-2.8.0-setup.exe']);
    const { bo, ghi } = boMoi(GOC);
    const tt = await bo.kiemTra();
    HONG = new Set();
    assert.strictEqual(tt.trangThai, 'loi', JSON.stringify(tt));
    assert.ok(/mã băm/.test(tt.loi));
    const con = fs.readdirSync(path.join(bo.o.thuMuc, 'cap-nhat'));
    assert.deepStrictEqual(con, [], 'còn sót file: ' + con.join(', '));
    const r = await bo.caiDat({ epBuoc: true });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(ghi.spawn.length, 0, 'đã chạy bộ cài từ một file hỏng!');
  });

  await test('đang chạy mẻ → KHÔNG cài, đòi xác nhận', async () => {
    const { bo, ghi } = boMoi(GOC, { coTabDangChay: () => true });
    await bo.kiemTra();
    const r = await bo.caiDat();
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.canXacNhan, true);
    assert.strictEqual(ghi.spawn.length, 0);
    assert.strictEqual(ghi.thoat, 0);
  });

  await test('xác nhận rồi → chạy bộ cài im lặng /S --updated --force-run, rồi thoát', async () => {
    const { bo, ghi } = boMoi(GOC, { coTabDangChay: () => true });
    await bo.kiemTra();
    const r = await bo.caiDat({ epBuoc: true });
    await doi(600);
    assert.strictEqual(r.ok, true, r.lyDo);
    assert.strictEqual(ghi.spawn.length, 1);
    assert.deepStrictEqual(ghi.spawn[0].args, ['/S', '--updated', '--force-run']);
    assert.strictEqual(ghi.spawn[0].opts.detached, true);
    assert.strictEqual(ghi.thoat, 1);
  });

  await test('tự cài khi thoát: không mở lại app (không --force-run)', async () => {
    const { bo, ghi } = boMoi(GOC);
    await bo.kiemTra();
    assert.strictEqual(bo.nenCaiKhiThoat(), true);
    await bo.caiDat({ moLai: false, epBuoc: true, thoat: false });
    assert.deepStrictEqual(ghi.spawn[0].args, ['/S', '--updated']);
    assert.strictEqual(ghi.thoat, 0);
    assert.strictEqual(bo.nenCaiKhiThoat(), false, 'đang cài mà vẫn đòi cài lần nữa');
  });

  await test('tắt "tự cài khi thoát" thì không cài khi thoát', async () => {
    const { bo } = boMoi(GOC);
    await bo.kiemTra();
    bo.datCaiDat({ tuCaiKhiThoat: false });
    assert.strictEqual(bo.nenCaiKhiThoat(), false);
  });

  await test('bản portable: tải bộ cài và MỞ nó lên (không im lặng)', async () => {
    const { bo, ghi } = boMoi(GOC, { env: { PORTABLE_EXECUTABLE_FILE: 'D:\\\\FAS.exe' } });
    await bo.kiemTra();
    await bo.caiDat({ epBuoc: true });
    assert.deepStrictEqual(ghi.spawn[0].args, []);
  });

  await test('chạy từ mã nguồn: chỉ báo, không tải', async () => {
    const { bo } = boMoi(GOC, { isPackaged: false });
    const tt = await bo.kiemTra();
    assert.strictEqual(tt.trangThai, 'co-ban-moi');
    assert.strictEqual(tt.kieu, 'thu-cong');
    assert.ok(!bo.fileTai);
  });

  await test('lần mở app sau: file đã tải sẵn và đúng → không tải lại', async () => {
    const { bo } = boMoi(GOC);
    await bo.kiemTra();
    const thuMuc = bo.o.thuMuc;
    let soLanTai = 0;
    const { bo: bo2 } = boMoi(GOC, { thuMuc, fetch: (u, o) => { if (/\/dl\//.test(u)) soLanTai++; return fetch(u, o); } });
    const tt = await bo2.kiemTra();
    assert.strictEqual(tt.trangThai, 'da-tai');
    assert.strictEqual(soLanTai, 0);
  });

  console.log('\n── macOS, với gói .zip THẬT của bản dựng ────────────────');

  const PKG = require('../package.json');
  const ZIP = path.join(__dirname, '..', 'dist', `FlowAutomationStudio-${PKG.version}-mac-arm64.zip`);
  if (!fs.existsSync(ZIP) || process.platform === 'win32') {
    console.log(`   – bỏ qua: chưa có ${path.basename(ZIP)} (chạy electron-builder --mac zip trước)`);
  } else {
    const tenZip = path.basename(ZIP);
    FILE[tenZip] = fs.readFileSync(ZIP);

    // Một thư mục Applications giả, trong đó có bản CŨ.
    const APPS = fs.mkdtempSync(path.join(TMP, 'Applications-'));
    const CU = path.join(APPS, 'Flow Automation Studio.app');
    const dungBanCu = () => {
      fs.rmSync(CU, { recursive: true, force: true });
      fs.mkdirSync(path.join(CU, 'Contents', 'MacOS'), { recursive: true });
      fs.writeFileSync(path.join(CU, 'Contents', 'Info.plist'),
        '<plist><dict><key>CFBundleShortVersionString</key><string>2.6.0</string></dict></plist>');
      fs.writeFileSync(path.join(CU, 'Contents', 'MacOS', 'Flow Automation Studio'), 'ban-cu');
    };

    const boMac = (them = {}) => boMoi(GOC, {
      platform: 'darwin', arch: 'arm64', phienBan: '2.6.0',
      execPath: path.join(CU, 'Contents', 'MacOS', 'Flow Automation Studio'),
      // Trên Linux không có ditto: dùng unzip (cũng giữ symlink).
      execFile: async (cmd, args) => {
        assert.strictEqual(cmd, '/usr/bin/ditto');
        execFileSync('unzip', ['-q', args[2], '-d', args[3]]);
        return '';
      },
      ...them
    });

    await test('Mac: tải gói, giải nén, đọc đúng phiên bản trong Info.plist, gọi script đổi app', async () => {
      dungBanCu();
      RELEASE = { tag_name: `v${PKG.version}`, assets: [taiSan(GOC, tenZip)] };
      const { bo, ghi } = boMac();
      assert.strictEqual(bo.trangThai().kieu, 'tu-dong');
      const tt = await bo.kiemTra();
      assert.strictEqual(tt.trangThai, 'da-tai', JSON.stringify(tt));
      const r = await bo.caiDat({ epBuoc: true });
      assert.strictEqual(r.ok, true, r.lyDo);
      assert.strictEqual(ghi.spawn[0].cmd, '/bin/bash');
      const [script, pid, cu, moi, moLai] = ghi.spawn[0].args;
      assert.strictEqual(cu, CU);
      assert.strictEqual(moLai, '1');
      assert.ok(fs.existsSync(path.join(moi, 'Contents', 'Info.plist')), 'không thấy app đã giải nén');

      // CHẠY THẬT đoạn script (PID của một tiến trình đã chết = app đã thoát).
      const chet = spawnSync('true').pid;
      const kq = spawnSync('bash', [script, String(chet), cu, moi, '0', path.join(TMP, 'doi.log')]);
      assert.strictEqual(kq.status, 0, fs.readFileSync(path.join(TMP, 'doi.log'), 'utf8'));
      assert.strictEqual(CN.docPhienBanApp(CU), PKG.version, 'app ở Applications chưa phải bản mới');
      assert.ok(fs.lstatSync(path.join(CU, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'Current')).isSymbolicLink(),
        'symlink của khung Electron bị mất — app sẽ không mở được');
      const conSot = fs.readdirSync(APPS).filter((f) => f !== 'Flow Automation Studio.app');
      assert.deepStrictEqual(conSot, [], 'bản cũ chưa được dọn: ' + conSot.join(', '));
    });

    await test('Mac: đặt bản mới hỏng giữa chừng → TRẢ LẠI bản cũ', async () => {
      dungBanCu();
      const f = path.join(TMP, 'kiem2.sh');
      fs.writeFileSync(f, CN.scriptDoiAppMac());
      const chet = spawnSync('true').pid;
      const kq = spawnSync('bash', [f, String(chet), CU, path.join(TMP, 'khong-co.app'), '0', path.join(TMP, 'doi2.log')]);
      assert.strictEqual(kq.status, 0);
      assert.strictEqual(CN.docPhienBanApp(CU), '2.6.0', 'mất bản cũ!');
      assert.strictEqual(fs.readFileSync(path.join(CU, 'Contents', 'MacOS', 'Flow Automation Studio'), 'utf8'), 'ban-cu');
    });

    await test('Mac: gói ghi bản X mà app bên trong là bản khác → KHÔNG cài', async () => {
      dungBanCu();
      RELEASE = { tag_name: 'v9.9.9', assets: [{ ...taiSan(GOC, tenZip), name: 'FlowAutomationStudio-9.9.9-mac-arm64.zip' }] };
      FILE['FlowAutomationStudio-9.9.9-mac-arm64.zip'] = FILE[tenZip];
      RELEASE.assets[0] = taiSan(GOC, 'FlowAutomationStudio-9.9.9-mac-arm64.zip');
      const { bo, ghi } = boMac();
      await bo.kiemTra();
      const r = await bo.caiDat({ epBuoc: true });
      assert.strictEqual(r.ok, false);
      assert.ok(/không phải 9\.9\.9/.test(r.lyDo), r.lyDo);
      assert.strictEqual(ghi.spawn.length, 0);
      assert.strictEqual(CN.docPhienBanApp(CU), '2.6.0');
    });

    await test('Mac không tự thay được (chạy từ Tải về) → mở Finder tới file, không đụng app', async () => {
      RELEASE = { tag_name: `v${PKG.version}`, assets: [taiSan(GOC, tenZip)] };
      const { bo, ghi } = boMac({ execPath: '/private/var/x/AppTranslocation/Y/d/Flow Automation Studio.app/Contents/MacOS/Flow Automation Studio' });
      await bo.kiemTra();
      const r = await bo.caiDat({ epBuoc: true });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(ghi.finder.length, 1);
      assert.strictEqual(ghi.spawn.length, 0);
    });
  }

  srv.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\n' + '─'.repeat(58));
  if (failures.length) {
    console.log(`KẾT QUẢ: ${pass} pass, ${failures.length} LỖI`);
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    process.exit(1);
  }
  console.log(`KẾT QUẢ: ${pass}/${pass} PASS`);
  console.log('─'.repeat(58));
})();
