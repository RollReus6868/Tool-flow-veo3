#!/bin/bash
# ===========================================================================
#  CHAY_TU_NGUON.command — chạy app thẳng từ mã nguồn trên macOS
#  ---------------------------------------------------------------------------
#  Bản Mac của CHAY_TU_NGUON.bat. Đường này ít hỏng nhất: không cần build,
#  không cần ký, không vướng Gatekeeper của file .app.
#
#  Lần đầu bấm đúp mà macOS chặn ("không thể mở vì từ nhà phát triển không xác
#  định"): chuột phải vào file → Mở → Mở. Chỉ phải làm một lần.
#
#  Nhật ký ghi ra CHAY_LOG.txt cạnh file này — có lỗi thì gửi file đó.
# ===========================================================================

cd "$(dirname "$0")" || exit 1
LOG="$PWD/CHAY_LOG.txt"
echo "Bat dau: $(date)" > "$LOG"

# Terminal mở từ Finder không nạp PATH của Homebrew / nvm. Thêm các chỗ Node
# hay nằm, nếu không máy ĐÃ CÓ Node vẫn bị báo là chưa có.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi

dung_lai() {
  echo
  read -r -p "  Bấm Enter để đóng cửa sổ..." _
  exit "${1:-1}"
}

echo
echo "========================================================"
echo "  FLOW AUTOMATION STUDIO"
echo "========================================================"
echo

# --- Node.js ----------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "  [X] Máy chưa có Node.js."
  echo
  echo "      Đang mở trang tải Node.js. Tải bản LTS (file .pkg), cài như"
  echo "      app bình thường, rồi bấm đúp lại file này."
  echo "Chua co Node.js" >> "$LOG"
  open "https://nodejs.org/en/download" 2>/dev/null
  dung_lai 1
fi
NODEVER="$(node -v)"
echo "  Node.js $NODEVER"
echo "Node $NODEVER" >> "$LOG"

# --- Thư viện ---------------------------------------------------------------
# Điều kiện "đã cài xong" là một file THẬT SỰ cần lúc chạy, không phải chỉ là
# thư mục node_modules có tồn tại: npm install đứt giữa chừng vẫn để lại thư
# mục đó.
#
# node_modules chép từ máy Windows sang KHÔNG dùng được trên Mac (bên trong có
# Electron bản Windows). Thấy vậy thì cài lại.
CAN_CAI=0
[ -f node_modules/electron/package.json ] || CAN_CAI=1
[ -d node_modules/electron/dist/Electron.app ] || CAN_CAI=1

if [ "$CAN_CAI" = "1" ]; then
  echo
  echo "  Lần đầu chạy — đang cài thư viện, mất 3-10 phút..."
  echo "  (tải khoảng 250 MB, cần mạng)"
  echo
  rm -rf node_modules
  if ! npm install --no-audit --no-fund >>"$LOG" 2>&1; then
    echo
    echo "  [X] Cài thư viện thất bại. 25 dòng cuối:"
    echo
    tail -n 25 "$LOG"
    echo
    echo "  Hãy thử: tắt VPN, đổi mạng, rồi chạy lại."
    dung_lai 1
  fi
fi

echo
echo "  Đang mở app..."
echo
npx electron . >>"$LOG" 2>&1
RC=$?
if [ "$RC" != "0" ]; then
  echo "  [X] App thoát với mã $RC. 25 dòng cuối của CHAY_LOG.txt:"
  echo
  tail -n 25 "$LOG"
  dung_lai "$RC"
fi
exit 0
