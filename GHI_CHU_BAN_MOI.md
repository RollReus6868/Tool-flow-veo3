## Flow Automation Studio 2.8.6

**Sửa lỗi tạo xong mà không tải về.**

- **Video báo "lỗi từ Google" dù đã tạo xong:** nguyên nhân là selector tự chỉ ở mục "Thẻ video / ảnh" trỏ nhầm vào dòng chữ tóm tắt model, không phải thẻ video. Từ bản này, trước mỗi mẻ app tự kiểm các selector bạn đã chỉ. Selector nào rõ ràng sai thì app bỏ qua, dùng mặc định và ghi một dòng cảnh báo vào Nhật ký.
- **Ảnh không tải:** đầu mỗi mẻ, Nhật ký giờ ghi rõ mẻ đó có tải về không. Nếu thấy "KHÔNG tự tải về", vào Cài đặt → Tải về — Ảnh → Cách tải và chọn "Tải từng media".

Tài khoản, phiên đăng nhập, cài đặt và dự án giữ nguyên.
