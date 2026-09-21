// ============================================================================
//  ky-mac.js — ký "ad-hoc" cho bản macOS, chạy ngay sau khi đóng gói .app
//  --------------------------------------------------------------------------
//  VÌ SAO PHẢI CÓ
//  Máy Mac chip Apple (M1, M2, M3…) TỪ CHỐI chạy bất kỳ chương trình nào không
//  có chữ ký, dù chỉ là chữ ký tự cấp. Electron tải về có sẵn chữ ký, nhưng
//  electron-builder đổi tên file chạy và sửa Info.plist nên chữ ký đó hỏng. Kết
//  quả: bấm mở thì macOS báo "app bị hỏng, hãy chuyển vào Thùng rác".
//
//  Ký ad-hoc ("-") không cần chứng chỉ Apple, không tốn tiền. Nó KHÔNG làm
//  Gatekeeper tin app — lần mở đầu vẫn phải chuột phải → Mở (xem README) —
//  nhưng nó biến "app bị hỏng" thành "chưa xác định nhà phát triển", là thứ
//  người dùng tự cho phép được.
//
//  electron-builder 25 chỉ ký được khi chạy trên macOS và có chứng chỉ thật,
//  nên đặt "identity": null để nó bỏ qua, rồi tự ký ở đây:
//    • trên máy Mac: dùng codesign có sẵn của hệ điều hành
//    • trên Linux (máy dựng của GitHub hoặc sandbox): dùng rcodesign nếu có
// ============================================================================

const path = require('path');
const { execFileSync } = require('child_process');

function coLenh(ten) {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [ten], { stdio: 'ignore' });
    return true;
  } catch (_) { return false; }
}

exports.default = async function kyMac(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ký ad-hoc  app=${app}`);

  if (process.platform === 'darwin') {
    // --deep ký luôn các khung Electron bên trong. Không bật hardened runtime:
    // không có chứng chỉ thì hardened runtime chỉ làm V8 mất quyền JIT.
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
    return;
  }

  if (coLenh('rcodesign')) {
    // rcodesign không truyền chứng chỉ = ký ad-hoc, tự đi sâu vào khung lồng nhau.
    execFileSync('rcodesign', ['sign', app], { stdio: 'inherit' });
    return;
  }

  // Không ký được thì DỪNG hẳn, không phát hành một bản chắc chắn không mở được
  // trên Mac chip Apple.
  throw new Error('Không ký được bản macOS: máy này không có codesign (macOS) cũng không có rcodesign. ' +
                  'Hãy dựng bản Mac trên máy Mac, hoặc bằng GitHub Actions (build-mac.yml).');
};
