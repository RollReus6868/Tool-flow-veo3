## Flow Automation Studio 2.8.5

**Sửa lỗi bấm Tạo mà Flow không nhận (bấm tay thì được).** Flow nay chỉ nhận cú bấm thật và bỏ qua mọi cú bấm do phần mềm giả lập. Từ bản này app bấm nút Tạo bằng chuột thật qua trình duyệt (cùng cách app vẫn dùng để dán chữ), kể cả khi tab đang chạy ngầm. Mỗi prompt chỉ bấm một lần. Nhật ký ghi `Nút Tạo ăn ở kiểu bấm "chuột thật"` khi thành công.

**Sửa lỗi "Chọn trên trang" cho nút Tạo.** Trước đây nếu bạn chỉ trúng khung bao quanh nút thì app bấm vào khung đó, không ăn. Nay app tự tìm đúng nút bên trong.

**Nên làm sau khi cập nhật:** vào Cài đặt → Chẩn đoán giao diện Flow và bấm ✕ đỏ ở những dòng bạn đã tự chỉ, nhất là "Thẻ video / ảnh" (nếu đang là `span.settings-summary`, đó không phải thẻ ảnh). Để trống là app dùng mặc định, vốn đang khớp đúng giao diện hiện tại.

Tài khoản, phiên đăng nhập, cài đặt và dự án giữ nguyên.
