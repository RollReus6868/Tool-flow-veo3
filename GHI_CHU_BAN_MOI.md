## Flow Automation Studio 2.8.3

Sửa lỗi treo im lặng sau khi bấm Tạo, và mở đường để bạn tự vá khi Google đổi giao diện Flow.

**Lỗi đã sửa — treo im lặng.** Sáng 22/09 chạy 6 tab, mọi bước đều báo "thành công" mà không tải về được gì, tiến độ đứng yên. Hai chuyện xếp lên nhau: Google Flow đổi cấu trúc lưới thẻ kết quả nên app không dò được thẻ nào, VÀ phép đếm ảnh trước/sau khi bấm Tạo dùng hai bộ lọc khác nhau (trước chỉ đếm ảnh trong thẻ, sau đếm mọi ảnh kể cả logo và avatar) nên lúc nào cũng tưởng là tạo thành công. Một lỗi đáng lẽ báo rõ đã bị biến thành treo không một dòng lỗi. Nay hai chỗ đếm dùng cùng một bộ lọc.

**Mới — tự chỉ lại phần tử khi Flow đổi giao diện** (Cài đặt → Chẩn đoán giao diện Flow):

Trước bản này, app dặn bạn bấm "Chọn trên trang" và "Tải báo cáo .txt" — mà hai nút đó chưa bao giờ có trong app. Nay có thật, cho từng phần tử trong sáu phần tử then chốt:

🎯 Chọn trên trang — bấm, rồi bấm vào đúng phần tử đó trong cửa sổ Flow (Esc để thôi). App nhớ và áp ngay cho các tab đang mở, không phải chờ bản cập nhật.
Ô nhập selector — ai biết CSS thì dán thẳng vào. Để trống là dùng mặc định.
📄 Tải báo cáo .txt — xuất file gồm bản tự dò lúc này và bản app tự chụp đúng lúc nó trượt. Gửi nguyên file đó đi là đủ để vá. Trong file không có thông tin đăng nhập nào.

Lưu ý: nút "✕ Xoá ghi nhận" xoá luôn bản chụp app tự lưu. Đang gặp lỗi thì bấm Tải báo cáo .txt trước.

App báo vỡ giao diện thì mục Chẩn đoán tự sáng đèn và nói luôn phần tử nào, thay vì để dòng log đỏ trôi mất giữa hàng trăm dòng khác.

**Chưa xong:** selector mới cho lưới thẻ của Flow vẫn chưa có — cần bản chụp giao diện thật từ máy đang gặp lỗi (bấm 📄 Tải báo cáo .txt rồi gửi file đi).

Ai dùng Windows tải -setup.exe, ai dùng Mac tải .dmg đúng chip (Apple Silicon là arm64, Intel là x64)

Với Mac, mở app lần đầu bằng cách nhấp chuột phải → Open, vì app chưa có chứng chỉ Apple. Sau đó nhớ kéo app vào thư mục Applications. Cách cho phép (Cài đặt hệ thống → Quyền riêng tư \& Bảo mật → Vẫn mở)

Lưu ý: Windows nên dùng bản cài đặt (-setup.exe) — bản portable không tự thay được chính nó. Mac nên kéo app vào thư mục Applications.

