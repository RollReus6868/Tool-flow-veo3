#!/bin/bash
# ===========================================================================
#  BUILD_MAC.command — đóng gói app macOS (.dmg và .zip) NGAY TRÊN MÁY MAC
#  ---------------------------------------------------------------------------
#  Ra file trong thư mục dist/:
#    FlowAutomationStudio-<phiên bản>-mac-arm64.dmg   cho Mac chip Apple (M1…)
#    FlowAutomationStudio-<phiên bản>-mac-x64.dmg     cho Mac chip Intel
#  (và bản .zip tương ứng)
#
#  Không cần tài khoản nhà phát triển Apple: app được ký "ad-hoc" (tools/
#  ky-mac.js). Nhờ vậy Mac chip Apple chịu chạy, nhưng lần mở đầu vẫn phải
#  cho phép bằng tay — xem README, mục "Dùng trên macOS".
#
#  Nhật ký: BUILD_LOG.txt cạnh file này.
# ===========================================================================

cd "$(dirname "$0")" || exit 1
LOG="$PWD/BUILD_LOG.txt"
echo "Bat dau: $(date)" > "$LOG"
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi

dung_lai() {
  echo
  read -r -p "  Bấm Enter để đóng cửa sổ..." _
  exit "${1:-1}"
}

buoc() { echo; echo "[$1] $2"; echo "[$1] $2" >> "$LOG"; }

if [ "$(uname)" != "Darwin" ]; then
  echo "  File này chỉ chạy trên macOS. Trên Windows dùng BUILD_EXE.bat."
  dung_lai 1
fi

buoc "1/4" "Node.js"
if ! command -v node >/dev/null 2>&1; then
  echo "  [X] Máy chưa có Node.js. Đang mở trang tải — cài bản LTS rồi chạy lại."
  open "https://nodejs.org/en/download" 2>/dev/null
  dung_lai 1
fi
echo "  $(node -v)"

buoc "2/4" "Thư viện"
if [ ! -d node_modules/electron/dist/Electron.app ] || [ ! -f node_modules/electron-builder/package.json ]; then
  echo "  Cài lại thư viện cho macOS (3-10 phút)..."
  rm -rf node_modules
  if ! npm install --no-audit --no-fund >>"$LOG" 2>&1; then
    echo "  [X] Cài thư viện thất bại. 25 dòng cuối:"; tail -n 25 "$LOG"; dung_lai 1
  fi
fi
echo "  Xong"

buoc "3/4" "Kiểm thử logic"
if ! node tests/run.js >>"$LOG" 2>&1; then
  echo "  [X] Kiểm thử logic hỏng — không đóng gói một bản đã hỏng sẵn."
  grep -n "FAIL" "$LOG" | tail -n 15
  dung_lai 1
fi
echo "  $(grep 'KẾT QUẢ' "$LOG" | tail -n 1)"

buoc "4/4" "Đóng gói (.dmg + .zip, chip Apple và chip Intel)"
rm -rf dist
if ! CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 --x64 --publish never >>"$LOG" 2>&1; then
  echo "  [X] Đóng gói thất bại. 30 dòng cuối:"; tail -n 30 "$LOG"; dung_lai 1
fi

if ! ls dist/*.dmg >/dev/null 2>&1; then
  echo "  [X] Build xong mà không thấy file .dmg trong dist/"; dung_lai 1
fi

echo
echo "  Build thành công:"
ls -lh dist/*.dmg dist/*.zip | awk '{print "    " $NF "  " $5}'
echo "Build thanh cong" >> "$LOG"
open dist
dung_lai 0
