# Flow Automation Studio 2.8.2

Tool desktop tự động hoá Google Flow. Bản chuyển từ tiện ích Chrome
**Flow Automation Local 1.10.0** sang ứng dụng chạy thẳng trên máy.

---

## ⬇ TẢI VỀ DÙNG NGAY — không cần cài gì cả

Vào tab **[Releases](../../releases)** → tải file `.exe` mới nhất → giải nén →
bấm đúp là chạy.

**Không cần cài Node.js. Không cần build. Không cần biết lập trình.**

File đó do GitHub tự dựng trên một máy Windows thật mỗi lần mã nguồn thay đổi
(xem `.github/workflows/build-windows.yml`), nên luôn khớp với code mới nhất.

> Lần mở đầu tiên Windows SmartScreen sẽ báo *"Unknown publisher"* vì file không
> mua chữ ký số. Bấm **More info → Run anyway**. Đây là chuyện bình thường với
> mọi app tự build, không phải dấu hiệu có vấn đề.

> **Dùng Mac?** Có bản riêng cho macOS từ 2.7.0 — xem
> [mục 0k](#0k-bản-270--chạy-được-trên-macos).
>
> **Từ 2.8.0 app tự cập nhật** — xem [mục 0l](#0l-bản-280--tự-cập-nhật-chọn-model-và-chuyện-lower-priority).

Phần còn lại của tài liệu này dành cho việc sửa code. Chỉ muốn dùng tool thì đọc
tới đây là đủ, nhảy thẳng xuống [mục 2 — ba bước dùng lần đầu](#2-ba-bước-dùng-lần-đầu).

---

## 0a. Nhiều tài khoản Flow, mỗi tài khoản chạy độc lập (2.1.0)

**Tiện ích Chrome không làm được việc này.** Tiện ích sống trong profile Chrome
của bạn và dùng chung đúng một bộ cookie — muốn chạy tài khoản khác thì phải
đăng xuất rồi đăng nhập lại, hoặc mở hẳn một profile Chrome khác rồi cài lại
tiện ích vào đó.

Electron cho phép mỗi phiên có **kho cookie và storage riêng biệt**:

```js
session.fromPartition('persist:flow-acc3')
```

Nên ở đây mỗi tài khoản là một phiên riêng. Hệ quả:

- Đăng nhập tài khoản A **không** đá tài khoản B ra.
- Nhiều tài khoản **chạy cùng lúc**, mỗi tài khoản lại mở được nhiều tab.
- Mỗi tài khoản đặt được **thư mục tải riêng**, khỏi trộn lẫn video.
- Đăng xuất hay xoá một tài khoản chỉ đụng tới đúng phiên của nó.

### Hai kiểu chia việc

Ở mục **Chạy prompt → Giao việc cho tab → Kiểu chia**:

| Kiểu | Cách chia | Khi nào dùng |
|---|---|---|
| **Chia đều cho mọi tab** | Coi mọi tab như một dàn máy chung, chia liên tiếp cho tất cả | Xong sớm nhất |
| **Chia theo tài khoản** | Chia cho từng tài khoản trước, rồi mỗi tài khoản tự chia cho tab của nó | Mỗi tài khoản ôm một dải liền mạch — hợp khi muốn tách hạn mức hoặc tách kết quả |

Cả hai kiểu đều có kiểm thử riêng (`tests/run.js`) canh đúng hai điều: không sót
prompt nào, và không prompt nào bị giao cho hai tab.

---

## 0b. Đã có đủ cài đặt của tiện ích (2.1.0)

Bản 2.0.x mới có phần lõi. Bản này port **toàn bộ** cài đặt mà
`flow-engine.js` thật sự đọc — 33 khoá, đối chiếu thẳng với `readSettings()`
của tiện ích 1.10.0:

- **Tạo nội dung** — chế độ video/ảnh, tỉ lệ khung, số lượng mỗi prompt, thu
  phóng tab, thêm số thứ tự, cuộn ngẫu nhiên
- **Nhịp chạy** — chờ tối thiểu/tối đa, số lần thử lại, chốt chặn mất mạng
- **Đa tab** — bật/tắt, cách phối hợp, giãn cách giữa các lần bấm Tạo
- **Character Sync & Giọng nói** — `@Tên`, xoá thẻ, keyframe, 30 giọng
- **Tải về** — cách tải, chất lượng, thời điểm, thư mục con có thẻ thay thế
- **Đổi tên file** — 3 kiểu đặt tên, tiền/hậu tố, số chữ số, danh sách riêng,
  bỏ dấu
- **Chọn dải prompt** — từ số mấy đến số mấy, hoặc danh sách kiểu `1,5,9-12,20`
- **Dự án** — nạp lại chỗ đang dở, xoá dự án cũ
- **Chẩn đoán giao diện Flow** — dò 6 phần tử then chốt khi Google đổi giao diện
- **Ảnh → Video** — chọn thư mục ảnh đã đánh số, tải lên Flow

`tests/smoke.js` có một bài canh **đúng 33 khoá này**: thiếu khoá nào là test
đỏ. Đây là loại lỗi không bao giờ tự lộ ra — engine chỉ lặng lẽ dùng mặc định
của nó, người dùng chỉnh trên giao diện mà không thấy gì đổi.


---

## 0c. Bản 2.2.0 — sửa 5 lỗi thật + tự nối ảnh → video

### Năm lỗi người dùng báo, và nguyên nhân thật của từng cái

| Triệu chứng | Nguyên nhân | Đã sửa |
|---|---|---|
| Bấm **Thêm tài khoản** không có gì xảy ra | Electron **không cài đặt `window.prompt()`** — gọi vào là trả `null` ngay, hàm thoát sớm ở dòng kiểm tra kết quả | Tự dựng hộp thoại trong app |
| Giao việc tab 1 xong thì **không bấm Bắt đầu cho tab 2 được** | Nút Bắt đầu bị khoá **toàn cục** sau lần chạy đầu | Mỗi tab là một đơn vị độc lập; tab bận thì bỏ qua, tab rảnh vẫn nhận việc mới |
| **Tiến độ đứng yên** dù engine đang chạy | Engine gửi `{creating, completed, error}`, app lại đọc `{done, failed}` — **sai tên trường** | Đổi tên ở đúng một chỗ trong `main.js` |
| Nhật ký ngập **"Chờ khoá tải xuống quá lâu"**, treo ~7 phút | Engine hỏi `ACQUIRE_DOWNLOAD_LOCK`, app chưa xử lý action đó nên trả `{success:false}` → engine hiểu "tab khác đang giữ khoá" rồi chờ đúng **420 giây** | Cấp khoá ngay lập tức |
| Bảng trạng thái luôn hiện "Chờ" | Engine gửi trạng thái **CHỮ HOA** (`COMPLETED`, `CREATING`…), app dò bằng chữ thường | Dò cả hai kiểu |

**Về khoá tải xuống — vì sao cấp ngay là đúng, không phải né lỗi.** Khoá đó
sinh ra ở bản tiện ích để chữa một hạn chế của Chrome: `DownloadItem` không có
`tabId` nên hai tab tải cùng lúc là tên file đổi chéo, cách duy nhất là ép tải
lần lượt. Bản desktop không có hạn chế đó — Electron đưa thẳng `webContents`
vào sự kiện `will-download` nên mỗi tab có hàng đợi tên riêng. Giữ khoá ở đây
chỉ tổ làm chậm mà không đổi lại được gì.

### Tự nối ảnh → video

**Chạy prompt → Tự nối ảnh → video.** Bật lên, chạy một mẻ ở chế độ **Tạo ảnh**;
khi mẻ ảnh của một tab xong, app tự sinh danh sách `<câu lệnh video> @<mã ảnh>`,
bật Character Sync, rồi giao lại **đúng tab đó** chạy tiếp thành video.

Trạng thái chuỗi nằm trên **từng tab** (`tab.chain` trong `main.js`), nên nhiều
tab và nhiều tài khoản chạy chuỗi của riêng mình cùng lúc mà không lẫn ảnh của
nhau. `tests/run.js` có bài canh đúng điều đó: hai tab chạy hai dải ảnh khác
nhau thì mã ảnh không được trùng một cái nào.

Tuỳ chọn **"Chỉ nối khi mẻ ảnh sạch lỗi"** mặc định bật: mẻ ảnh có lỗi thì dừng
để bạn xem lại, thay vì lỡ dựng hàng trăm video từ ảnh hỏng.

### Kho ảnh Flow → sinh prompt video

**Chạy prompt → Kho ảnh Flow.** Dùng khi ảnh đã nằm sẵn trong kho Flow. Không
cần chọn file — chỉ khai mã ảnh rồi:

- **Kiểm tra ảnh trên kho Flow** — dò 12 mã mẫu đầu tiên **trên tab bạn chọn**
  (mỗi tài khoản một kho riêng, nên phải chọn đúng tab).
- **Sinh danh sách prompt** — ghép `<câu lệnh> @<mã ảnh>`, đồng thời bật sẵn chế
  độ video và Character Sync. Quên bật Character Sync là Flow dựng video từ chữ,
  chẳng dùng ảnh nào.

App chặn trước những mã ảnh có dấu cách hoặc gạch nối: Flow cắt `@tag` ở đúng
những ký tự đó rồi lấy nhầm ảnh.

### Tiến độ báo cáo độc lập từng tab

Bảng **Tiến độ từng tab** nằm ngay trong mục Chạy prompt: mỗi dòng là một tab,
kèm tên tài khoản, pha đang chạy (*đang tạo ảnh, sẽ nối video* / *đang dựng
video từ ảnh*), thanh tiến độ riêng, và **nút tạm dừng / dừng / chạy tiếp riêng
cho tab đó** — dừng một tab không đụng tab nào khác.

### Đã bỏ vì trùng hoặc engine không đọc

- **`multiTabMode`** — engine không đọc khoá này. Việc chia prompt do app lo ở
  *Kiểu chia*.
  > **Đính chính (2.5.0):** chỗ này từng viết là engine cũng không đọc
  > `multiTab`. **Sai** — `isMultiTab()` đọc nó và bảy chỗ trong engine gọi
  > `isMultiTab()`. Bỏ nó đi làm mấy tab dùng chung một tên dự án rồi ghi đè
  > dữ liệu của nhau. Nay `collectSettings()` luôn đặt `multiTab: true`; xem
  > mục 0g.
- Thêm **Ảnh 1K** vào ô chất lượng tải — engine đã hỗ trợ `img_1k` sẵn, chỉ
  thiếu ô chọn.


---

## 0d. Bản 2.3.0 — sửa 3 lỗi + gộp giao diện

| Triệu chứng | Nguyên nhân thật | Đã sửa |
|---|---|---|
| **Trang Tổng quan không hoạt động** | Engine gửi `data = { rows, isRunning, … }`, app lại truyền **cả object** vào chỗ `rows` — giao diện nhận một object chứ không phải mảng nên không vẽ được dòng nào | Lấy đúng `data.rows` |
| **Tạm dừng / Dừng hẳn bấm không được** | Cờ "đang bận" chỉ bật khi engine gửi `AUTOMATION_RESUMED`, mà hàm đó **chỉ chạy khi *tiếp tục*, không chạy khi *bắt đầu*** — nên mẻ mới không bao giờ được đánh dấu là đang chạy | Đánh dấu bận ngay lúc giao việc, và đọc thêm `isRunning` mà engine gửi kèm mỗi lần cập nhật bảng |
| Phải **tự tay đổi sang chế độ Video** trước khi nối ảnh → video | `switchToVideoMode()` của engine chỉ tìm nút ở NGOÀI bảng thả xuống, mà giao diện Flow nay đặt cặp nút Image/Video **bên trong** bảng bật lên từ ô nhập prompt | Thêm `src/inject/flow-mode.js` — tự mở bảng, bấm đúng nút, rồi **đọc lại để xác nhận**. Bản đầu của file này không chạy được trên Flow thật; xem mục 0e |

### Đổi chế độ tự động

App tự đặt đúng chế độ Image/Video trên trang Flow **trước mỗi mẻ**, và một lần
nữa khi chuỗi ảnh→video nối tiếp. Không đổi được thì nói thẳng trong Nhật ký
kèm lý do, thay vì lặng lẽ dán prompt video vào lúc Flow còn đang ở chế độ ảnh
rồi sinh ra một loạt ảnh.

### Giao diện: Prompt và Cài đặt chung một màn hình

Hai mục gộp làm một, chia đôi: **prompt bên trái, cài đặt bên phải**, hai cột
cuộn độc lập. Màn hẹp dưới 1180px thì tự xếp dọc. Khỏi phải nhảy qua lại khi
vừa soạn prompt vừa chỉnh cài đặt.

### Cài đặt đổi gì

- **Ngẫu nhiên thời gian chờ** — bật thì app chờ một khoảng ngẫu nhiên trong
  đoạn min–max; tắt thì chờ cố định. Về mặt cài đặt gửi engine, tắt ngẫu nhiên
  chỉ là đặt `pasteDelayMin = pasteDelayMax`, không phải thêm nhánh xử lý riêng.
- **Tải về tách riêng Video / Ảnh** — mỗi loại một chất lượng và một thư mục
  con. Engine chỉ hiểu một `downloadQuality`, nên app tự chọn đúng bộ theo
  **Chế độ chạy** — chạy ảnh và chạy video không phải chỉnh qua lại nữa.
  Thêm mức **Ảnh 1K**.
- **Thư mục tải ưu tiên theo tài khoản** — thư mục riêng của từng tài khoản
  Flow được dùng trước; ô ở Cài đặt chỉ là dự phòng cho tài khoản chưa đặt.
- **Bỏ "Thử đường dán prompt"** — đường dán đã chạy ổn định ngoài thực tế
  (21.804 ký tự vào đủ trong một lần bơm), mục này không còn việc gì để làm.


---

## 0m. Bản 2.8.2 — treo im lặng sau khi bấm Tạo, và mục Chẩn đoán nằm đó chết

Sáng 22/09/2026, 6 tab trên 3 tài khoản, 542 prompt chế độ ảnh. Nhật ký cho
thấy mọi bước đều "thành công" mà **không một video/ảnh nào được tải về**, và
tiến độ đứng yên tới lúc bấm Dừng. Hai lỗi khác nhau xếp lên nhau.

### Lỗi 1 — Google Flow đổi lưới thẻ kết quả

Cả 6 tab đều báo:

```
🔧 KHÔNG TÌM THẤY "Thẻ video / ảnh" sau 3 lần thử
```

Engine dò thẻ kết quả bằng bốn lớp dự phòng, và **cả bốn đều trượt**:
`flow-tile-container` → `flow-image-tile` / `flow-video-tile` →
`[data-tile-id]` → `a[href*="/edit/workflow/"]`. Nghĩa là Google đã đổi hẳn
cấu trúc lưới kết quả. Không dò được thẻ thì không biết ảnh đã xong chưa, nên
engine đứng chờ mãi ở `⏳ Đang chờ thẻ video mới xuất hiện`.

Đây là **chuyện sẽ còn lặp lại** — Google đổi giao diện Flow vài tháng một
lần. Nên bản này không đi vá một selector rồi chờ lần sau, mà mở đường cho bạn
**tự chỉ lại** (lỗi 3 dưới đây).

### Lỗi 2 — phép đếm ảnh che kín lỗi 1, biến nó thành treo im lặng

Dòng kiểm sau mỗi cú bấm Tạo, xuất hiện ở *mọi* prompt:

```
🔎 Verify: newTile=false, txtCleared=false(len=2421), newImg=true, newBatch=false
```

`newTile=false` là thẻ không dò được (lỗi 1). `txtCleared=false` là câu lệnh
vẫn còn nguyên trong ô nhập. Đáng lẽ engine phải kết luận **cú bấm Tạo không
vào**, báo lỗi và thử lại. Nhưng `newImg=true` đã cứu nó — và `newImg` **sai**.

Nguyên nhân gốc: hai phép đếm ảnh dùng **hai bộ lọc khác nhau**.

| Đếm ở đâu | Bộ lọc | Đếm cái gì |
|---|---|---|
| **Trước** khi bấm Tạo | `'[data-tile-id] img, a[href*="/edit/"] img'` | chỉ ảnh **nằm trong thẻ** |
| **Sau** khi bấm Tạo | `'img, a[href*="/edit/"] img'` | **mọi** ảnh trên trang |

So một số nhỏ với một số lớn thì `sau > trước` gần như **luôn đúng** — nó đếm
cả logo, avatar, icon của trang. Nên engine kết luận `✅ Create accepted` cho
mọi prompt, kể cả khi cú bấm trượt hoàn toàn, rồi đi chờ thẻ không bao giờ tới.

Một lỗi đáng lẽ **báo rõ** đã bị biến thành **treo không một dòng lỗi**.

Bộ lọc rộng ở chỗ đếm sau là cố ý ("Removed `[data-tile-id]` to work with new
UI") — chỉ là chỗ đếm trước không được sửa theo. Bản 2.8.2 cho hai chỗ dùng
**cùng một** bộ lọc, nên hiệu số lại có nghĩa.

### Lỗi 3 — app dặn bạn bấm hai cái nút không tồn tại

Câu báo lỗi của engine dặn:

> *Mở Cài đặt → Chẩn đoán giao diện Flow: bấm "Chọn trên trang" để tự chỉ lại
> phần tử này, hoặc "Tải báo cáo .txt" rồi gửi cho Claude để vá.*

**Hai nút đó chưa bao giờ có trong app.** Mục Chẩn đoán chỉ có ba nút: Kiểm
tra 6 phần tử / Xem tình trạng / Xoá ghi nhận. Bạn đọc câu đó, đi tìm, không
thấy gì — và không có cách nào tự vá, cũng không có cách nào gửi bằng chứng đi.

Tệ hơn: engine **đã mang sẵn đủ cơ chế** từ bản tiện ích, chỉ là bản desktop
chưa nối vào. Ba mắt nối bị hở:

| Engine có sẵn | Bản desktop trước 2.8.2 |
|---|---|
| Nhận `START_PICKING` để bật chế độ "bấm vào phần tử" | không ai gửi |
| Gửi `PICK_RESULT` kèm selector vừa sinh ra | nhận về rồi **ném đi** |
| Đọc `settings.selectors[key]`, **ưu tiên** trước selector mặc định | giao diện không hề gom khoá này |

Cộng thêm hai chỗ nữa cũng hỏng ngầm:

- Hàm vẽ kết quả tự kiểm đọc **sai hình dạng** dữ liệu engine trả về, nên vẽ
  ra mấy dòng vô nghĩa kiểu `❌ report`, `❌ health` — không bao giờ chỉ ra
  được phần tử nào vỡ.
- Engine gửi `UI_BREAK` để báo "phần tử này vừa vỡ", `main.js` không có nhánh
  xử lý nên trả về *"Action chưa hỗ trợ"*. App không biết gì; bạn chỉ thấy một
  dòng đỏ trôi qua giữa hàng trăm dòng log khác.

### Bản 2.8.2 có gì

Mục **Cài đặt → Chẩn đoán giao diện Flow** giờ có, cho **từng** phần tử trong
sáu phần tử then chốt:

- **🎯 Chọn trên trang** — bấm, rồi bấm vào đúng phần tử đó trong cửa sổ Flow
  (Esc để thôi). App nhớ selector và **áp ngay cho các tab đang mở**, không
  phải chờ lần Bắt đầu sau, cũng không phải chờ bản cập nhật.
- **Ô nhập selector** — ai biết CSS thì dán thẳng vào. Để trống = dùng mặc định.
- **✕** — bỏ selector tự chỉ, quay về mặc định.
- **📄 Tải báo cáo .txt** — xuất một file gồm *hai* nguồn: bản tự dò ngay lúc
  xuất, **và** bản engine tự chụp đúng lúc nó trượt (kèm `outerHTML` của tới 12
  phần tử ứng viên). Gửi nguyên file đó đi là đủ để viết selector mới. Trong
  file không có thông tin đăng nhập nào — chỉ cấu trúc HTML của trang Flow.

Engine báo vỡ thì mục Chẩn đoán **tự sáng đèn** và nói luôn phần tử nào, thay
vì để dòng log trôi mất.

> **Lưu ý:** nút **✕ Xoá ghi nhận** xoá luôn bản chụp mà engine tự lưu. Đang
> gặp lỗi thì **bấm Tải báo cáo .txt trước**, đừng bấm Xoá ghi nhận.

### Vì sao mấy lỗi này không bị bắt sớm hơn

- **Lỗi 1 và 2 chỉ lộ khi Flow thật đổi giao diện.** Trang giả lập trong bộ
  kiểm thử luôn có `flow-tile-container`, nên tầng 4 và tầng 7 vẫn xanh. Và
  không có bài nào so **cùng một** bộ lọc ở hai đầu trước/sau.
- **Lỗi 3 là loại lỗi bộ kiểm thử không được thiết kế để thấy.** Tầng giao
  diện kiểm *app có đủ phần tử app cần* — chứ không kiểm *app có đủ thứ mà
  engine HỨA với người dùng*. Câu dặn "bấm Chọn trên trang" nằm trong engine,
  cái nút nằm trong app, và không ai đối chiếu hai bên.

Bản này thêm ba bài kiểm thử để chuyện đó không tái diễn:

1. **Hai phép đếm ảnh phải dùng cùng một selector** — so thẳng chuỗi ở ba chỗ
   trong `flow-engine.js`. Đã phá thử: trả selector hẹp về là bài kiểm đỏ ngay.
2. **Mọi action engine gửi đều phải có nhánh xử lý trong `main.js`** — quét
   toàn bộ `flow-engine.js`, đối chiếu với các `case` bên `main.js`. Bài này
   canh cả một *loại* lỗi, không phải một lỗi lẻ: `REGISTER_TAB` thiếu từng làm
   ba tab ghi đè dự án của nhau, `UI_BREAK` thiếu làm app không biết giao diện
   đã vỡ.
3. **Đường tự chỉ selector phải nối đủ năm mắt** — có nút trong giao diện,
   preload phơi đủ hàm và cho phép kênh sự kiện, `main.js` gửi `START_PICKING`
   và đẩy `UPDATE_SETTINGS`, và `selectors` có mặt trong **cả** bộ gửi cho
   engine **và** bộ lưu ra đĩa.

### Chưa nghiệm thu được

Selector mới cho lưới thẻ của Flow **vẫn chưa có** — cần bản chụp DOM thật từ
máy đang gặp lỗi (nút **📄 Tải báo cáo .txt**, hoặc file
`flow-studio-data.json` phần `veoUiDiagnostics`). Đường tự chỉ selector đã
chạy đúng trên trang Flow **giả lập**, nhưng **chưa thử lần nào trên Flow
thật** — thao tác bấm chọn phần tử và selector sinh ra còn phải kiểm trên máy
người dùng.

---

## 0l. Bản 2.8.0 — tự cập nhật, chọn model, và chuyện Lower Priority

### Vì sao "Veo 3.1 - Lite [Lower Priority]" bị chặn ngay, còn model tốn credit thì không

Google không công bố cách họ canh, nên dưới đây là **cách giải thích hợp lý nhất**, không
phải điều đã được xác nhận:

- **Lower Priority là hàng miễn phí (0 credit).** Nó chỉ được xử lý bằng phần máy chủ còn
  dư sau khi đã phục vụ các yêu cầu trả phí. Thứ miễn phí và "không giới hạn" là thứ bị máy
  tự động khai thác nhiều nhất, nên Google canh nó gắt nhất.
- **Model tốn credit tự giới hạn.** Mỗi lần tạo trừ credit, hết credit là dừng, nên Google
  ít phải canh. Vì vậy cùng một tài khoản, cùng một lúc: Lower Priority bị báo bất thường,
  còn Lite/Fast thì tạo bình thường.
- **Nhóm gia đình làm dấu hiệu rõ hơn.** Các thành viên dùng chung một gói. Nhiều tài khoản
  trong cùng gói, trên cùng một máy và cùng một mạng, cùng lúc gửi Lower Priority thì với
  Google trông giống một người chạy nhiều tài khoản để lấy đồ miễn phí.

**Không có cách nào qua mặt bộ dò này, và app không thử.** Xen kẽ model **không** giúp:
prompt nào chạy Lower Priority vẫn đi vào đúng hàng đợi bị canh. Cách làm được:

1. **Bật "Tự chuyển khi Lower Priority bị chặn"** (Cài đặt → 🎚 Model video). Bị chặn là
   app ngừng gửi Lower Priority của tài khoản đó 30 phút, chạy tiếp bằng model dự phòng
   (tốn credit), rồi thử lại. Bị lại thì chờ 60 phút, rồi 120 phút. Mẻ không bị đứng giữa
   chừng, và app không gõ tiếp vào chỗ đang bị canh.
2. **Đừng cho mọi tài khoản trong nhóm gia đình chạy Lower Priority cùng lúc trên một máy.**
   Mỗi tài khoản một tab, nhịp thưa (nút "Đặt nhịp chạy hiền theo số tab").
3. Theo một bài đo của bên thứ ba (không phải Google), hàng Lower Priority đông nhất vào
   **chiều giờ Mỹ** (khoảng 0h–6h sáng giờ Việt Nam). Chạy ngoài khung đó thì chờ ít hơn.
4. Bị nhắc nhiều lần liền thì nên nghỉ hẳn một buổi. Cứ bị chặn mà vẫn chạy thì có thể
   ảnh hưởng tới cả tài khoản.

### Mới: 🎚 Model video

Ở mục **Prompt và Cài đặt → 🎚 Model video**. Để trống thì app chạy y như bản cũ, không
đụng tới hộp chọn model.

| Ô | Làm gì |
|---|---|
| Model chính | Trước mẻ video, app tự chọn model này trên trang Flow |
| Model dự phòng + Thử lại sau | Lower Priority bị chặn thì tự chuyển sang model này (xem trên) |
| Model phụ + "Cứ N prompt…" | Xen kẽ hai model. N = 2 là luân phiên 1–1. Để chia chi phí |
| 🔎 Đọc danh sách model | Đọc thẳng từ tab Flow, điền đúng chữ, và thử luôn app có bấm được hộp chọn không |

**Cách app đổi model mà không giẫm chân engine.** Trước mỗi prompt mới, engine hỏi xin "lượt
bấm Tạo" rồi **đứng chờ** câu trả lời. Đó là lúc duy nhất nó không đụng vào giao diện, và
app đổi model đúng lúc ấy. Engine chỉ hỏi khi "Giãn cách giữa các lần bấm Tạo" lớn hơn 0,
nên khi có kế hoạch model, app tự đặt tối thiểu 1 giây. Prompt **thử lại** thì không hỏi,
nó dùng model đang chọn. Vì vậy khi chuyển dự phòng, app tạm dừng tab khoảng 6 giây, đổi
model trên trang rồi chạy tiếp: lần thử lại sẽ chạy bằng dự phòng, không gõ lại Lower Priority.

**Hai cái bẫy đã chặn trước:**

- "Veo 3.1 - Lite" là phần đầu của "Veo 3.1 - Lite [Lower Priority]". So kiểu "có chứa" là
  chọn nhầm giữa miễn phí và tốn credit. App so **bằng nhau** sau khi bỏ dấu câu, và bài
  kiểm thử đảo thứ tự danh sách để bắt lỗi này.
- Biểu tượng loa trước mỗi dòng thật ra là chữ `volume_up`. App bỏ chữ đó ra trước khi so.

### Mới: tự cập nhật (Windows và macOS)

Mục **🔄 Cập nhật** (cuối cột cài đặt). App hỏi GitHub lần đầu sau khi mở 20 giây, rồi 4
giờ một lần. Có bản mới thì app tải ngầm và kiểm mã băm sha256 (file hỏng thì xoá, không
cài). Sau đó bạn bấm **Cài & mở lại**, hoặc để app tự cài khi bạn thoát. **Không bao giờ cài
giữa lúc đang chạy mẻ**, trừ khi bạn tự xác nhận. Tài khoản, phiên đăng nhập, cài đặt và dự
án nằm ở thư mục dữ liệu riêng nên cập nhật không đụng tới.

| Máy | Cập nhật thế nào |
|---|---|
| Windows, bản cài đặt `-setup.exe` | Tự động hoàn toàn (bộ cài chạy im lặng, xong tự mở lại) |
| Windows, bản `-portable.exe` | App tải bộ cài và mở lên. Cài một lần là từ đó tự cập nhật |
| Mac, app nằm trong Applications | Tự động hoàn toàn |
| Mac, app chạy thẳng từ Tải về | App tải về rồi mở Finder, bạn kéo app vào Applications |
| Chạy từ mã nguồn (`CHAY_TU_NGUON`) | Chỉ báo có bản mới, kèm link tải |

**Vì sao không dùng electron-updater.** Trên Mac, nó đi qua Squirrel.Mac, mà Squirrel.Mac
đòi chữ ký Developer ID thật của Apple (99 USD/năm). App này chỉ ký ad-hoc nên Squirrel.Mac
từ chối cài. Tự viết một đường chung (`src/main/cap-nhat.js`) thì cả hai hệ điều hành cùng
chạy và cùng được kiểm thử. Trên Mac, đoạn script đổi app **giữ bản cũ tới khi bản mới vào
chỗ xong**. Hỏng giữa chừng thì bản cũ được trả lại.

#### Phát hành bản mới cho bạn bè (việc của bạn, mỗi lần có bản mới)

1. Sửa `"version"` trong `package.json` (ví dụ `2.8.0` → `2.8.1`).
2. Ghi vài dòng vào `GHI_CHU_BAN_MOI.md`. Phần này hiện trong app ở mục "Có gì mới".
3. Đẩy mã nguồn lên GitHub.
4. Mở tab **Actions → "Phat hanh ban moi" → Run workflow**.
5. Chờ 15–25 phút. Máy của GitHub đóng gói cả bản Windows lẫn Mac rồi đăng lên
   **Releases**. App của mọi người tự thấy.

> **Repo phải để công khai (public).** App hỏi GitHub mà không kèm mật khẩu nào. Repo riêng
> tư thì bạn bè không thấy bản phát hành nào. Muốn giữ mã nguồn riêng tư thì tạo thêm một
> repo công khai chỉ để chứa bản phát hành, rồi sửa `repository.url` trong `package.json`
> trỏ vào đó.
>
> Workflow tự chặn khi thẻ phiên bản lệch với `package.json`. Nếu lệch, app của bạn bè sẽ
> tưởng lúc nào cũng có bản mới và cài đi cài lại mãi.

**Lần đầu: ai đang dùng 2.7.0 phải tự cài 2.8.0 một lần** (2.7.0 chưa có bộ cập nhật). Người
dùng Windows nên cài bản `-setup.exe`. Từ 2.8.0 trở đi mọi thứ tự động.

### Đã kiểm chứng tới đâu — nói thẳng

**Đã chạy:**

- **Tám tầng kiểm thử đều xanh**: 122 bài logic (thêm 17), 22 bài cho bộ cập nhật, cùng giao diện, đường dán, engine bám tab, đổi chế độ, trình chọn model và bài chạy từ đầu tới cuối.
- **Trình chọn model** chạy trên trang giả lập Flow ba đời giao diện (Material, Radix, thẻ
  trơn không có vai trò). Có kiểm cả bẫy tiền tố khi đảo thứ tự danh sách. Đã thử làm hỏng
  code để chắc bài kiểm thử bắt được.
- **Chạy từ đầu tới cuối trong app thật** (`tests/model-e2e.js`): engine thật gửi lượt xin
  bấm Tạo, và app đổi model. Khi bị báo "unusual activity", app chuyển dự phòng chứ không
  cho nghỉ. Hết giờ tránh thì app quay lại Lower Priority, và bị lại thì chờ gấp đôi. Model
  tốn credit cũng bị chặn thì app cho nghỉ như cũ. Người dùng bấm Dừng giữa lúc đang đổi thì
  app **không** tự chạy lại.
- **Bộ cập nhật** chạy với một "GitHub giả" tại chỗ, tải thật qua chuyển hướng 302. File
  hỏng mã băm thì bị xoá, không cài. Đang chạy mẻ thì app đòi xác nhận. Trên Mac, dùng
  **gói .zip thật** của bản 2.8.0: giải nén, đọc phiên bản, **chạy thật** script đổi app
  (symlink của khung Electron còn nguyên), và thử cả nhánh hỏng giữa chừng phải trả lại bản cũ.

**Chưa chạy được lần nào:**

- **Hộp chọn model trên trang Flow thật.** Mình dựng theo ảnh chụp bạn gửi. Nếu Google
  dựng DOM khác, app sẽ ghi dòng `↳ chẩn đoán: {...}` vào Nhật ký, và sau 3 lần hỏng liền nó
  tự tắt kế hoạch model, chạy tiếp bằng model đang chọn (không làm hỏng mẻ). Cách thử nhanh
  nhất: bấm **🔎 Đọc danh sách model** trước khi chạy mẻ.
- **Câu báo lỗi thật của Lower Priority.** App nhận "unusual activity / hoạt động bất
  thường" như chế độ an toàn vẫn làm. Nếu Flow dùng câu khác cho riêng Lower Priority, dự
  phòng vẫn kích hoạt khi đủ 3 lỗi trong 5 phút.
- **Bộ cài NSIS chạy im lặng trên Windows thật, và đổi app trên Mac thật.** Cả hai chỉ chạy
  được khi đã có một bản phát hành thật trên GitHub. Dòng log cho biết chạy đúng:
  `🔄 Đã tải xong bản …` rồi `🔄 Đang cài bản … App sẽ tự mở lại.`

---

## 0k. Bản 2.7.0 — chạy được trên macOS

Không có thay đổi nào cho người dùng Windows: engine, giao diện, cách chạy mẻ
giữ nguyên. Bản này **thêm** đường chạy trên Mac.

### Chọn đúng file

Bấm quả táo ở góc trái trên → **Giới thiệu về máy Mac này**, xem dòng *Chip* hoặc *Bộ xử lý*:

| Máy ghi | Tải file |
|---|---|
| Apple M1, M2, M3, M4… | `FlowAutomationStudio-2.7.0-mac-arm64.dmg` (hoặc `.zip`) |
| Intel | `FlowAutomationStudio-2.7.0-mac-x64.dmg` (hoặc `.zip`) |

Mở `.dmg`, kéo biểu tượng vào thư mục **Applications**. Dùng `.zip` thì bấm
đúp để giải nén rồi kéo app vào **Applications**.

### Lần mở đầu tiên: macOS sẽ chặn — và đó là bình thường

App không mua chứng chỉ nhà phát triển của Apple (99 USD/năm), nên lần đầu
macOS báo *"không thể mở vì Apple không thể kiểm tra phần mềm độc hại"*. Cho
phép **một lần** như sau:

1. Bấm đúp app, gặp thông báo thì bấm **Xong** (đừng bấm *Chuyển vào Thùng rác*).
2. Mở **Cài đặt hệ thống → Quyền riêng tư & Bảo mật**, kéo xuống dưới cùng.
3. Có dòng *"Flow Automation Studio đã bị chặn…"* → bấm **Vẫn mở**, nhập mật khẩu máy.

Từ lần sau bấm đúp là chạy. (Trên macOS 14 trở về trước, chuột phải vào app →
**Mở** → **Mở** cũng được.)

Nếu macOS báo *"app bị hỏng"* thay vì câu trên, mở **Terminal** và dán:

```
xattr -dr com.apple.quarantine "/Applications/Flow Automation Studio.app"
```

### Chạy thẳng từ mã nguồn trên Mac

Giống `CHAY_TU_NGUON.bat` bên Windows — đường ít hỏng nhất:

1. Cài **Node.js** bản LTS (file `.pkg`) từ <https://nodejs.org>.
2. Bấm đúp **`CHAY_TU_NGUON.command`**. Lần đầu macOS chặn thì chuột phải →
   **Mở**.

Tự đóng gói trên Mac: bấm đúp **`BUILD_MAC.command`**, xong sẽ có `.dmg` trong
thư mục `dist`. Không có Mac thì dùng GitHub: tab **Actions → "Dong goi macOS"
→ Run workflow** (file `.github/workflows/build-mac.yml`).

> **Đừng giải nén gói mã nguồn trên Windows rồi mới chép sang Mac.** Windows
> làm rơi mất "quyền chạy" của hai file `.command`, sang Mac bấm đúp sẽ báo
> *không có quyền truy cập*. Gửi nguyên file `.zip` sang Mac rồi giải nén ở đó.
> Lỡ rồi thì mở Terminal trong thư mục đó và gõ:
> `chmod +x *.command`
>
> Cũng đừng chép thư mục `node_modules` từ Windows sang — bên trong là
> Electron bản Windows. `CHAY_TU_NGUON.command` nhận ra và tự cài lại.

### Có gì khác trên Mac, và vì sao

**1. Ký "ad-hoc" — không có nó thì Mac chip Apple không chạy.** macOS trên chip
Apple từ chối mọi chương trình không có chữ ký, kể cả chữ ký tự cấp. Electron
tải về có sẵn chữ ký, nhưng electron-builder đổi tên file chạy và sửa
`Info.plist` nên chữ ký đó **hỏng**, và macOS báo "app bị hỏng". electron-builder
bản 25 chỉ ký được khi có chứng chỉ Apple thật, nên `package.json` đặt
`"identity": null` cho nó bỏ qua, rồi `tools/ky-mac.js` tự ký ad-hoc ngay sau
khi đóng gói — bằng `codesign` trên Mac, hoặc `rcodesign` trên Linux. Không ký
được thì **dừng build**, không phát hành một bản chắc chắn không mở được.

Ký ad-hoc **không** làm Gatekeeper tin app. Nó biến "app bị hỏng" (không có
cách mở) thành "chưa xác định nhà phát triển" (người dùng tự cho phép được).
Muốn hết hẳn bước cho phép thì phải mua chứng chỉ Apple và notarize — ngoài
phạm vi bản này.

**2. Menu tiếng Việt có mục "Sửa".** Trên Mac, Cmd+C / Cmd+V / Cmd+A chỉ chạy
khi thanh menu có mục mang đúng vai trò sao chép/dán. Thiếu là dán prompt vào ô
nhập im re, không báo gì.

**3. Đóng cửa sổ là thoát hẳn.** Thói quen của Mac là đóng cửa sổ nhưng app vẫn
sống dưới Dock. Với tool này đó là cái bẫy: kho dữ liệu đã đóng, các tab Flow
vẫn chạy ngầm trỏ vào một cửa sổ không còn, bấm biểu tượng Dock cũng không mở
lại được. Đang chạy mẻ mà tưởng đã tắt thì càng tệ.

**4. "Tắt máy khi chạy xong" chạy được trên Mac.** Qua System Events, nên lần
đầu macOS hỏi quyền điều khiển — bấm **Cho phép**. Muốn huỷ thì thoát app trước
khi hết giờ đếm ngược.

**5. Dữ liệu nằm ở** `~/Library/Application Support/Flow Automation Studio/`
(mục 7). Phiên đăng nhập Google **không** chuyển từ máy Windows sang được —
đăng nhập lại trong cửa sổ app, như lần đầu.

### Đã kiểm chứng tới đâu — nói thẳng

Đã làm: đóng gói ra `.app` cho cả chip Apple lẫn Intel; mở gói xem đúng
kiến trúc (`arm64` / `x86_64`), đúng `Info.plist`, đủ mã nguồn trong `app.asar`,
symlink của các khung Electron còn nguyên trong `.zip`, file chạy mang chữ ký
ad-hoc. Năm tầng kiểm thử xanh (105 bài logic, thêm 5 bài cho macOS). Hai file
`.command` chạy qua bash thật ở mọi nhánh: chưa có Node, lần đầu cài thư viện,
lần sau, app thoát lỗi, kiểm thử hỏng.

**Chưa làm được:** mở app trên một máy Mac thật. Bản dựng ở đây ký bằng
`rcodesign` trên Linux, không phải `codesign` của Apple. Workflow
`build-mac.yml` chạy trên máy Mac thật của GitHub và có bước
`codesign --verify --deep --strict` — đó là phép thử đáng tin nhất. Nếu bản
tải ở đây không mở được thì dùng bản từ workflow đó.

---

## 0j. Bản 2.6.2 — một dấu ngoặc làm cửa sổ biến mất

### Triệu chứng

`BUILD_EXE.bat` chạy tới `[4/6]` thì **cửa sổ tự đóng**. Không báo lỗi, không
kịp in một chữ. `BUILD_LOG.txt` dừng đúng ở dòng:

```
[4/6] winCodeSign
```

Nhật ký dừng ngay dòng đầu của bước đó, nghĩa là script chết lúc `cmd.exe`
**ĐỌC** khối lệnh, chưa kịp chạy dòng nào bên trong.

### Nguyên nhân: một dấu `)` trong câu thông báo

Bước 4 của bản 2.6.1 viết bằng `if … ( … ) else ( … )`. Trong nhánh `else` có
dòng này:

```bat
) else (
    echo    Dang tai bo cong cu (khoang 5,6 MB)...
```

Dấu `)` sau chữ `MB` **đóng khối `else` giữa chừng**. Phần còn lại của khối
thành cú pháp rác, `cmd.exe` bỏ chạy cả file và đóng cửa sổ ngay lập tức.

Tái hiện được bằng `cmd.exe` thật, gọn trong 9 dòng:

```
BAT DAU
   Dang tai bo cong cu
Can't recognize 'khoang 5,6 MB' as an internal or external command
```

Cùng khối đó còn một thứ nữa không đáng tin: lệnh `powershell` nối dòng bằng
`^`. Trong khối `( )`, `cmd.exe` đọc cả khối thành **một** lệnh trước khi
chạy, và dấu `^` cuối dòng ở trong đó hành xử khác hẳn khi ở ngoài.

### Vì sao lần trước tôi không bắt được

Tôi có chạy thử bước 4 bằng `cmd.exe` thật — nhưng thư mục cache lúc thử
**đã có sẵn file `.7z`**, nên nhánh chạy là `if defined CS7Z`. Nhánh `else`
chứa cả hai lỗi **chưa bao giờ được chạy tới**. Một bài kiểm thử chỉ đi qua
một nhánh thì hai nhánh kia vẫn là đất chưa ai đặt chân.

Lần này thử **cả hai nhánh**: cache rỗng (đi vào nhánh tải) và cache có sẵn
`.7z` (nhánh dùng lại).

### Sửa

**1. Viết phẳng, không dùng khối.** Cả bước 4 nay chỉ còn nhãn và `goto`, mỗi
lệnh một dòng, `powershell` viết liền một dòng không nối tiếp. Không còn khối
`( )` thì cả hai lỗi trên đều không thể xảy ra.

**2. Thoát mọi dấu ngoặc trong lệnh `echo`** — `^(` và `^)` — ở cả ba file,
kể cả những dòng đang nằm ngoài khối. Một dòng hôm nay ở ngoài, mai bị chuyển
vào trong là hỏng lại.

**3. Thêm `call` khi gọi `node`.** Dòng `node -e "…"` ở bước 2 thiếu `call`.
Trên máy có `node.exe` thì không sao, nhưng ai dùng **nvm-windows / Volta /
fnm** thì `node` là `node.cmd`. Gọi một file `.cmd` từ trong file `.bat` mà
không có `call` thì điều khiển **đi luôn, không quay lại** — script chết giữa
chừng, cửa sổ đóng ngay, đúng triệu chứng "tự biến mất". Tôi phát hiện ra vì
`node` giả trong máy dựng cũng là file `.bat` và đã vấp đúng chỗ đó.

**4. Lớp bọc giữ cửa sổ.** Hai file `.bat` chính nay tự gọi lại chính mình
trong một cửa sổ con:

```bat
if "%~1"=="--trong" goto :chinh
cmd /c ""%~f0" --trong"
if "%RC%"=="0" exit /b 0
pause
```

Cửa sổ con có chết kiểu gì thì cửa sổ cha vẫn còn đó, mang theo dòng báo lỗi.
Chạy trót lọt thì thoát luôn, không bắt bấm phím vô cớ. Từ nay sẽ không còn
cảnh người dùng không có gì để gửi đi.

**5. Thêm `curl.exe` làm đường tải dự phòng** — có sẵn từ Windows 10 bản
1803. PowerShell bị chính sách nhóm chặn thì vẫn còn một đường.

### Bốn bài kiểm thử mới

Ba lỗi trên đều là lỗi **cách `cmd.exe` đọc file**, không phải lỗi logic, nên
đọc file là bắt được:

| Bài | Bắt cái gì |
|---|---|
| Dấu ngoặc chưa thoát trong `echo` | chính lỗi làm cửa sổ biến mất |
| Nối dòng `^` bên trong khối `( )` | lỗi thứ hai cùng khối |
| Lớp bọc giữ cửa sổ có đủ 4 mảnh | để không ai gỡ mất |
| Có đường tải dự phòng | PowerShell hỏng vẫn còn curl |

### Chạy thử

Toàn bộ `BUILD_EXE.bat` chạy qua `cmd.exe` thật, đi hết cả 6 bước — kể cả
`[4/6]`, chỗ chết của bản trước. Cả hai nhánh của bước 4 đều được chạy tới.
`CHAY_TU_NGUON.bat` cũng chạy qua lớp bọc mới bình thường.

100 bài logic (thêm 4), năm tầng đều xanh.

---

## 0i. Bản 2.6.1 — build .exe hỏng vì hai file của macOS

### Triệu chứng

`BUILD_EXE.bat` chạy tới bước đóng gói rồi dừng, thử lại 4 lần rồi bỏ cuộc.
Trong `BUILD_LOG.txt`:

```
⨯ cannot execute  cause=exit status 2
  errorOut=ERROR: Cannot create symbolic link :
           A required privilege is not held by the client. :
           ...\winCodeSign\...\darwin\10.12\lib\libcrypto.dylib
           ...\winCodeSign\...\darwin\10.12\lib\libssl.dylib
```

### Vì sao

electron-builder tải gói `winCodeSign-2.6.0.7z` về rồi giải nén. Trong gói đó
có thư mục `darwin` — phần dành cho **macOS** — và bên trong có đúng **hai
symlink**: `libcrypto.dylib` và `libssl.dylib`.

Windows không cho tài khoản thường tạo symlink. Muốn tạo phải là
Administrator, hoặc phải bật Developer Mode. Người dùng bấm đôi vào file
`.bat` thì không có quyền đó → `7za` báo lỗi → electron-builder thử lại 4 lần
→ bỏ cuộc.

Nghĩa là: **bản build Windows thất bại vì hai file của macOS mà nó không bao
giờ dùng tới.**

### Cách sửa — không cần quyền Administrator

Tôi đo trước ba điều, không đoán:

| Kiểm chứng | Kết quả |
|---|---|
| Gói winCodeSign có bao nhiêu symlink, ở đâu? | Đúng 2, cả 2 trong `darwin/` |
| Hai gói NSIS có dính lỗi tương tự không? | 0 symlink — sạch |
| electron-builder có bỏ qua bước tải nếu cache đã có sẵn? | Có, trả về ngay, kể cả khi đưa URL sai |

Điều thứ ba là chìa khoá. Nên bước `[4/6]` mới trong `BUILD_EXE.bat` **tự
dựng sẵn cache** và **bỏ qua thư mục `darwin`**:

```bat
"%ZA%" x "%CS7Z%" -o"%CSDIR%" -xr!darwin -y
```

electron-builder thấy `...\Cache\winCodeSign\winCodeSign-2.6.0\` đã có thì
không tải, không giải nén — nên không bao giờ chạm tới symlink.

Bước này còn **dùng lại chính file `.7z` mà những lần build hỏng trước đã tải
về** (nằm trong thư mục cache, tên là số ngẫu nhiên như `528039443.7z`).
electron-builder tải xong mới ngã ở bước giải nén, nên file vẫn nguyên vẹn —
đỡ tải lại 5,6 MB, và nếu máy đang mất mạng thì đó là đường duy nhất đi tiếp
được. Xong việc mới dọn đống rác đó đi.

### Một lỗi tôi suýt gửi đi kèm

Tham số bỏ thư mục của 7za là `-xr!darwin` — **có dấu `!`**. Mà cả file đang
bật `EnableDelayedExpansion`, nên `cmd.exe` ăn mất dấu `!` và 7za nhận
`-xrdarwin`: tham số sai, 7za bỏ chạy, **không giải nén gì cả**, mà bước sau
vẫn đi tiếp như không có chuyện gì. Đúng loại lỗi im lặng tệ nhất.

Tôi bắt được vì chạy thử bằng `cmd.exe` thật, và đã đo cả hai chiều:

| | `signtool.exe` | thư mục `darwin` |
|---|---|---|
| Không bọc `setlocal DisableDelayedExpansion` | **thiếu** (7za không chạy) | — |
| Có bọc | **có** | đã bỏ đúng |

Bài kiểm thử `.bat` về dấu `!` nay soi **mọi dòng lệnh**, không riêng `echo`
— phiên bản cũ chỉ soi `echo` nên sẽ không bắt được lỗi này.

### Chuỗi kiểm chứng đầy đủ

Không có máy Windows, nên tôi ghép từng mắt xích bằng công cụ thật:

1. `7za.exe` **thật của Windows** (chạy qua wine) giải nén gói, bỏ `darwin`
   → `signtool.exe` có mặt, `darwin` không có. ✓
2. Chạy nguyên bước `[4/6]` bằng `cmd.exe` **thật**, trên một thư mục cache
   dựng đúng như máy người dùng (3 file `.7z` và 3 thư mục rác từ lần hỏng
   trước) → dùng lại `.7z` cũ, giải nén, dọn rác, chỉ còn
   `winCodeSign-2.6.0`. ✓
3. Chạy lại lần hai → nhận ra cache đã có, bỏ qua ngay. ✓
4. Lấy **chính cache do bước 2 sinh ra** cho `electron-builder --win --x64`
   chạy thật → `EXIT=0`, ra đủ cả hai file `.exe`, mỗi file 78 MB. ✓

Lỗi thứ hai tìm được nhờ chạy thử: `for /d %%D in ("%ROOT%\*")` chạy qua mà
không xoá gì khi đường dẫn nằm trong dấu nháy. Đổi sang
`for /f ... in ('dir /b /ad ...')` — cách đã chứng minh là chạy.

### Đường lui, nếu vẫn hỏng

Nếu bước đóng gói vẫn thất bại, `BUILD_EXE.bat` tự chạy lại với `--dir`. Cách
này bỏ qua hẳn bước NSIS — cũng là bước hay hỏng nhất — và vẫn cho ra app
**chạy được thật**, chỉ ở dạng thư mục:

```
dist\win-unpacked\Flow Automation Studio.exe
```

Và nếu nhật ký vẫn có dòng `Cannot create symbolic link`, script gọi thẳng
tên bệnh rồi chỉ hai cách chữa (chạy bằng quyền Administrator, hoặc bật
Developer Mode) thay vì bắt người dùng tự đoán.

96 bài logic (thêm 3), năm tầng đều xanh.

---

## 0h. Bản 2.6.0 — file .bat treo ở bước 1/5, và chuyện bị Flow chặn

### Tôi đã làm hỏng cái gì ở bản 2.5.0

Người dùng bấm `BUILD_EXE.bat`, màn hình dừng ở:

```
[1/5] Kiem tra Node.js...
_
```

Không thêm một chữ nào. Phải gõ Enter mới đi tiếp, rồi bị hỏi tải Node.js
về cài — dù máy **đã có sẵn** Node.js; cài xong thì nó bảo "đã cài sẵn"
rồi lại treo ở đúng chỗ cũ. `CHAY_TU_NGUON.bat` cũng vậy, và tệ hơn: không
mở nổi app nữa. Tức là bản 2.5.0 **không dùng được**, dù mọi logic bên
trong đều đã kiểm thử xanh. Ba lỗi cùng nằm trong file `.bat`, chồng lên nhau:

**1. `set /p BIEN=<file` — thủ phạm chính.**

```bat
node -v >"%TEMP%\fs_node.txt" 2>&1
set /p NODEVER=<"%TEMP%\fs_node.txt"      ← chỗ chết
```

`set /p` gặp file rỗng thì **không báo lỗi** — nó quay ra chờ người dùng gõ
phím, và chờ im lặng, không in ra một ký tự nào. Nhìn y hệt treo máy. Gõ
Enter thì `NODEVER` rỗng, nên bước kiểm tra "có phải dạng `v22.x` không"
trượt, và script kết luận máy chưa có Node.js.

Sửa: bỏ hẳn file tạm, đọc thẳng kết quả lệnh bằng `for /f` —

```bat
for /f "delims=" %%V in ('node -v 2^>nul') do if not defined NODEVER set "NODEVER=%%V"
```

`for /f` không có đường nào quay ra chờ bàn phím.

**2. `chcp 65001`.** Dòng này bật mã trang UTF-8, và chính nó làm hỏng
`set /p` đọc dữ liệu chuyển hướng — lỗi có sẵn trong `cmd.exe` từ nhiều đời
Windows. Mà mọi chữ trong các file `.bat` này đều viết không dấu, nên mã
trang mặc định hiển thị đủ. Bỏ luôn.

**3. Ba file `.bat` xuống dòng kiểu Linux (LF).** Tôi viết chúng trên máy
Linux nên không có `\r`. File `.bat` chỉ có LF chạy chập chờn trên `cmd.exe`,
hay gặp nhất là nhảy nhầm nhãn `goto`. Nay cả ba đều là CRLF, và có bài kiểm
thử đếm lại từng dòng.

**Một lỗi nhỏ nữa, tìm ra lúc chạy thử:** câu `echo [!] Node.js !NODEVER! qua cu`
in ra thành `[NODEVER qua cu`. Bật `EnableDelayedExpansion` rồi thì dấu `!`
trong chữ bị nuốt, và `^!` cũng không thoát được khi dòng nằm trong khối
`(...)`. Nay không còn dấu `!` nào trong chữ in ra, và có bài kiểm thử chặn.

### Lần này có chạy thử thật, không chỉ đọc lại code

Bài học của 2.5.0 là: **đọc code không thay thế được chạy thử.** Nên lần này
tôi cài `wine` vào máy dựng và chạy ba file `.bat` bằng `cmd.exe` thật, với
một `node.exe` giả đặt trên PATH, qua năm tình huống:

| Tình huống | Phải ra | Kết quả |
|---|---|---|
| Đã có Node v22 | thoát ngay, mã 0 | ✓ `Node.js v22.11.0 - dung duoc.` |
| Node v16 (quá cũ) | báo quá cũ, mời cài | ✓ |
| Stub Microsoft Store (in quảng cáo) | nhận ra không phải số phiên bản | ✓ |
| Không có Node | mời cài | ✓ |
| Có node mà không có npm | coi như chưa cài xong | ✓ |

Chính lần chạy thử này lòi ra thêm một lỗi nữa tôi vừa tự viết vào: cách
kiểm tra "chuỗi này có toàn chữ số không" bằng `for /f "delims=0123456789"`
gạt nhầm cả số hợp lệ. Đổi sang ép kiểu bằng `set /a`.

Rồi chạy tiếp cả `CHAY_TU_NGUON.bat` và `BUILD_EXE.bat` — cả hai đều đi qua
được bước `[1/5]`, đúng chỗ người dùng bị kẹt.

---

### Chống Flow phát hiện "hoạt động bất thường"

Người dùng hỏi: chạy nhiều tab một lúc thì tới lúc Flow hiện thẻ đỏ
*"Chúng tôi nhận thấy có hoạt động bất thường nào đó"*, và từ đó không tạo
được video nữa. Có cách nào hạn chế không?

**Nói thẳng trước, vì chỗ này dễ hứa hão.** Không có mẹo nào qua mặt được bộ
dò của Google, và bản này **không thử làm thế**: không giả vân tay trình
duyệt, không đổi IP, không đụng tới CAPTCHA. Những thứ đó vừa không bền vừa
là đường dẫn tới khoá tài khoản thật.

Việc làm được thì tầm thường hơn nhiều nhưng ăn thua hơn: **gõ cửa thưa hơn,
và khi đã bị nhắc thì im lặng nghỉ chứ đừng cố đấm thêm.**

**Vì sao "cố đấm thêm" lại là chuyện đang xảy ra.** Engine thấy prompt hỏng
thì **thử lại**, tới `maxRetries` lần. Nên đúng lúc Google đang khó chịu
nhất, tool lại gõ cửa dồn dập nhất. Mẻ 30 prompt với `maxRetries = 5` thành
150 lần gõ cửa trong vài phút — đúng cảnh `0/30 xong · 30 lỗi`.

**Mục mới: 🛡 Chế độ an toàn** (Chạy prompt → cột phải)

1. **Dò đúng câu cảnh báo.** `flow-canh-bao.js` đọc thẳng chữ đang hiện trên
   trang Flow. Cần thiết vì engine gắn cho *mọi* thẻ hỏng cùng một câu
   `"Không thành công (Policy/Error)"` — gộp hai chuyện rất khác nhau:

   | | Nghĩa | Nên làm gì |
   |---|---|---|
   | Prompt phạm chính sách | hỏng một cái, các cái khác vẫn chạy | chạy tiếp |
   | Cả tài khoản bị chặn | từ giờ hỏng sạch | dừng ngay |

   Nhìn con số thì không phân biệt được. Nhưng ngay trên thẻ, Flow ghi rõ.
   Chỉ quét khi **đã có lỗi**, và **bỏ qua chữ đang bị ẩn** — Flow dựng sẵn
   khung thông báo từ lúc trang mới tải, đếm cả chữ ẩn là tự dừng oan ngay
   khi vừa mở tab.

2. **Nghỉ theo TÀI KHOẢN, không theo tab.** Google đếm theo tài khoản. Để một
   tab nghỉ mà hai tab kia vẫn gõ cửa thì coi như không nghỉ.

3. **Nhận ra sớm.** Mặc định 3 prompt hỏng trong 5 phút là đủ để tạm dừng —
   không đợi cháy cả mẻ. Đọc được đúng câu cảnh báo thì dừng ngay từ lỗi đầu.

4. **Nghỉ tăng dần:** 10 → 20 → 40 phút, trần 60. Bị chặn lại ngay sau khi
   chạy tiếp nghĩa là lần nghỉ trước chưa đủ.

5. **Tự chạy lại**, không bắt ngồi canh. Bảng tiến độ hiện
   `🛡 đang nghỉ hạ nhiệt, còn 8 phút` — chứ không phải "đã dừng", vì hai cái
   đó nhìn giống nhau mà nghĩa khác hẳn.

6. **Giải lao định kỳ** (tuỳ chọn, mặc định tắt): nghỉ N phút sau mỗi M
   prompt. Nghỉ *trước* khi bị nhắc thay vì nghỉ *sau*.

7. **Nút "Đặt nhịp chạy hiền theo số tab"** điền sẵn giãn cách dán, giãn cách
   giữa các tab, cuộn trang ngẫu nhiên, và — quan trọng nhất — **hạ
   `maxRetries` xuống 3**. Càng nhiều tab của cùng một tài khoản thì mỗi tab
   phải càng thưa: 3 tab gõ cửa 20 giây một lần, với Google là gõ cửa 7 giây
   một lần.

**Một chốt chặn phải nhớ:** tạm dừng làm engine báo `isRunning = false`, mà
đó cũng là tín hiệu main.js dùng để biết "mẻ ảnh xong rồi, nối sang video
thôi". Không chặn thì chuỗi ảnh→video nổ ngay giữa giờ nghỉ — đúng lúc tệ
nhất. Có hai lớp chặn (`tab.nghiAnToan`), và có bài kiểm thử canh cả hai.

### Kiểm thử

93 bài logic (thêm 23), năm tầng đều xanh. Bài đáng nói nhất chạy trong tab
thật đã tiêm engine: dựng đúng thẻ `"hoạt động bất thường"` của Flow vào
DOM rồi bắt trình dò đọc ra — và bắt nó **không** đọc ra khi thẻ đó đang bị
ẩn. Cộng thêm năm bài đọc file `.bat` để ba lỗi ở trên không quay lại.

---

## 0g. Bản 2.5.0 — mẻ nối tiếp hỏng 30/30, và file .exe

### Lỗi: hai tính năng loại trừ nhau cùng bật

Mẻ ảnh chạy sạch 30/30. Nối sang video thì **hỏng cả 30**, không cái nào qua
nổi bước dán:

```
❌ Lỗi Khung hình: Bạn cần dùng cú pháp (@bắt_đầu, @kết_thúc) ở đầu Prompt!
❌ Lỗi Khung hình: Bạn cần gắn thẻ 2 ảnh (@bắt_đầu @kết_thúc) trong Prompt!
   Cần 2 thẻ @ảnh cho chế độ Khung hình
```

Người dùng bật **"Đồng bộ khung hình đầu/cuối"** — tính năng dựng video từ
*hai* ảnh: một ảnh mở đầu, một ảnh kết thúc. Chuỗi ảnh→video thì ngược lại:
mỗi video dựng từ **một** ảnh, nên prompt nó sinh ra chỉ có một thẻ `@01`.

Hai tính năng này loại trừ nhau về bản chất. Giữ cả hai không phải là "tôn
trọng lựa chọn người dùng" — nó chỉ có nghĩa là mẻ chạy hỏng 100%.

Nay `caiDatChuoiVideo()` trong `src/main/jobs.js` ép `keyframeSync: false` cho
mẻ nối tiếp, **và nói ra trong Nhật ký** — sửa lén thì lần sau người dùng lại
bật lên rồi lại không hiểu vì sao. Giao diện cũng cảnh báo ngay lúc bấm Bắt đầu.

### Lỗi thứ hai trong cùng file nhật ký: ba tab đè dự án của nhau

Cả ba tab cùng nạp **một tên dự án**:

```
[tab2] 📂 Loaded project: Project_2026-09-19_1789834930959
[tab1] 📂 Loaded project: Project_2026-09-19_1789834930959
```

và tab1 — sau khi tự F5 để đồng bộ tên file — **chạy tiếp mẻ video của tab2**,
dù chuỗi của chính nó chưa hề bắt đầu.

Hai nguyên nhân chồng nhau, cả hai đều là thiếu sót bên tiến trình chính:

1. **`REGISTER_TAB` chưa được xử lý.** Engine gọi nó lúc khởi động để xin
   `tabId` và số thứ tự tab; action này rơi vào nhánh mặc định nên engine thử
   lại 5 lần rồi bỏ cuộc với `veoTabId = null`. Mà `setRunState()` dùng khoá
   `String(veoTabId || 'single')` — nên **cả ba tab ghi chung một khoá**.

2. **Thiếu khoá `multiTab`.** Ghi chú ở mục 0c của README này từng khẳng định
   engine "không đọc" khoá đó. **Sai** — `isMultiTab()` đọc nó, và bảy chỗ
   trong engine gọi `isMultiTab()`. Quan trọng nhất: tên dự án chỉ được gắn
   hậu tố `_T<slot>` khi nó bật.

Nay `REGISTER_TAB` trả về `{ tabId, slot }` thật, `multiTab` luôn bật ở bản
desktop (mọi tab đều là `WebContentsView` ẩn nên các nhánh "đa tab" của engine
luôn là nhánh đúng), và số thứ tự tab **không bao giờ dùng lại** — đóng tab2
rồi mở tab mới mà lấy lại số 2 là tab mới thừa kế dự án dở dang của tab cũ.

Ba action nữa cũng được nối, trước đây đều rơi vào nhánh mặc định:
`TAB_STATUS`, `ACQUIRE_CREATE_SLOT` (giãn nhịp bấm Tạo, xếp hàng theo **từng
tài khoản** chứ không xếp chung), và `CAN_SHUTDOWN` (tab xong trước không tắt
máy khi tab khác còn chạy).

### Tự cài Node.js

`CAI_NODEJS.bat` dò Node, và nếu thiếu thì tải bộ cài LTS chính chủ từ
nodejs.org rồi cài giúp — cài cho riêng người dùng nên **không cần quyền
Administrator**. `CHAY_TU_NGUON.bat` và `BUILD_EXE.bat` đều gọi nó trước.

Hai chỗ dễ mắc mà script này xử lý sẵn:

- **Không dùng `where node`.** Windows trả về cả file stub của Microsoft Store
  không chạy được. Chỉ `node -v` rồi đọc kết quả mới đáng tin.
- **Nạp lại PATH ngay trong cửa sổ đang chạy.** Trình cài đặt chỉ sửa PATH
  trong registry; cửa sổ `cmd` đang mở vẫn giữ PATH cũ. Không đọc lại từ
  registry thì **vừa cài xong vẫn báo "không tìm thấy Node.js"** — và người
  dùng tưởng cài hỏng.

Bản Node quá cũ cũng bị từ chối: Electron 33 cần Node 18 trở lên.

### File .exe: đã build được, và đã kiểm chứng

`BUILD_EXE.bat` nay cho ra **hai** file trong `dist/`:

| File | Dùng khi nào |
|---|---|
| `FlowAutomationStudio-<ver>-setup.exe` | Bản **cài đặt**. Tạo lối tắt Desktop và Start Menu, mở nhanh. Nên dùng cái này. |
| `FlowAutomationStudio-<ver>-portable.exe` | **Một file duy nhất**, không cần cài. Chép đi đâu cũng chạy, kể cả USB. Đổi lại mỗi lần mở phải tự giải nén ra thư mục tạm nên chậm hơn vài giây. |

Cả hai **không cần Node.js** để chạy — Node chỉ cần lúc build. Dữ liệu vẫn nằm
ở `%APPDATA%\Flow Automation Studio` nên bản `.exe` và bản chạy từ nguồn dùng
chung tài khoản, cài đặt và dự án.

**Lỗi cấu hình đã tìm ra khi dựng thử:** thiếu `"publish": null`, nên
electron-builder chạy thêm bước sinh metadata cập nhật rồi ngã với
`Cannot read properties of null (reading 'channel')` — **ngay sau khi đã ghi
xong cả hai file .exe**. Mã thoát khác 0 nên script báo "BUILD THAT BAI" dù kết
quả đã nằm sẵn trong `dist`. Đúng kiểu lỗi khiến người ta tưởng build hỏng.

Lần này bản build **đã dựng thử thật** (Linux + wine, cùng bộ NSIS và rcedit mà
Windows dùng): mã thoát 0, hai file PE32 hợp lệ, 77–78 MB mỗi file.

`CHAY_TU_NGUON.bat` vẫn giữ nguyên làm đường dự phòng — nó ít hỏng nhất, và
`BUILD_EXE.bat` khi thất bại cũng nhắc lại điều đó.

### Không phải build trên máy mình cũng được

`.github/workflows/build-windows.yml`: đẩy mã nguồn lên GitHub, vào tab
**Actions** → **Dong goi Windows** → **Run workflow**. GitHub mượn một máy
Windows sạch dựng giúp, 5–10 phút sau tải file `.zip` về ở mục **Artifacts**.
Miễn phí, và không phải cài gì trên máy mình.

---

## 0f. Bản 2.4.0 — một cú bấm, không phải hai

### Lỗi: bấm hai lần nên mở rồi đóng ngay

Bản 2.3.1 vẫn trượt lần đầu. Nhật ký:

```
11:21:30 🔗 [tab1] Mẻ ảnh xong — tự nối sang video cho 2 ảnh (01 → 02)
11:21:35 ⏳ [tab1] Chưa đổi được sang chế độ video (lần 1/5) — thử lại sau 12 giây.
11:21:51 🎛 [tab1] Đã tự đổi Flow sang chế độ video
```

Mã ảnh đã đúng (`01 → 02`, không còn `001`). Chỗ hỏng là mở bảng cài đặt.

Nguyên nhân: `bamNhuNguoi()` bắn trọn chuỗi sự kiện chuột **rồi gọi thêm**
`el.click()` "cho chắc". Nút mở bảng là nút **bật-tắt**, nên đó là **hai cú
bấm**: mở, rồi đóng ngay. Nhìn từ ngoài y hệt "bấm mà không có gì xảy ra".

Cái bẫy nằm ở chỗ hai thư viện nghe hai sự kiện khác nhau:

| Thư viện | Mở bảng khi nhận |
|---|---|
| Radix UI | `pointerdown` — cố tình bỏ qua `click` tổng hợp |
| Angular Material (`mat-mdc-menu-trigger`, thứ Flow đang dùng) | `click` |

Phải bắn cả hai, nhưng **mỗi thứ đúng một lần** — đúng như trình duyệt sinh ra
khi người ta bấm chuột một cái. Thêm `el.click()` không phải "chắc ăn hơn", nó
là thêm một lần bấm nữa.

Nay `bamMotLan(el, kieu)` bấm đúng một cú, và `moBang()` **leo thang ba kiểu**
— chuột đầy đủ → `click()` trơn → bàn phím — **xác nhận giữa mỗi kiểu**. Nếu
sau một kiểu mà bảng chưa hiện thì rất có thể nó vừa mở vừa đóng, nên kiểu sau
lại bấm một lần nữa và lần này rơi vào nhịp mở.

`tests/fixture-mode.html` nay dựng đúng hành vi đó: bản Radix bật-tắt ở
`pointerdown`, bản Material bật-tắt ở `click`, và bài kiểm tra **đếm số cú bấm
bảng nhận được** — nhiều hơn 1 là hỏng.

### Nút đổi chế độ bằng tay

Mục **Chế độ trên trang Flow** trong Prompt và Cài đặt: chọn tab (hoặc tất cả),
bấm **Đặt sang Tạo ảnh / Tạo video**, hoặc **Đọc chế độ hiện tại**. Phần tự
động vẫn chạy trước mỗi mẻ — mục này để đặt sẵn từ đầu, và để chữa tay khi
Google đổi giao diện làm phần tự động trượt, thay vì ngồi xem nó thử 5 lần.

Flow **nhớ chế độ theo từng dự án**, nên đặt một lần là giữ nguyên — trừ khi
bạn chạy chuỗi ảnh→video, vì lúc đó chính app phải lật từ Ảnh sang Video giữa
chừng.

### Cài đặt tải về tách hẳn làm hai bộ

Bỏ nhóm *Tải về — chung*. **Cách tải**, **Thời điểm tải** và **toàn bộ phần đổi
tên file** nay nằm trong cả hai nhóm **Tải về — Video** và **Tải về — Ảnh**,
mỗi nhóm một bộ độc lập.

Không phải để cho đẹp: nhật ký bản trước cho thấy mẻ video do chuỗi ảnh→video
nối tiếp dùng lại **y nguyên bộ cài đặt của mẻ ảnh** —

```
11:23:16 [1] 🏷️ Tên file sẽ dùng: 01_2
11:23:16 [1] Đã chọn độ phân giải: img_1k     ← đang tải .mp4
```

— nên video tải về theo chất lượng **ảnh** và rơi vào thư mục **ảnh**. Nay giao
diện gom riêng bộ Video cho mẻ nối tiếp.

Mỗi nhóm có thêm dòng **"Tên file sẽ là"**: ghép đủ tiền tố, số thứ tự, hậu tố,
thư mục con và đuôi file, tính bằng **đúng hàm tiến trình chính dùng lúc chạy**.

### Những thứ dọn theo yêu cầu

- Bỏ ô **Thu phóng tab Flow** — cố định 80%, mức vẫn dùng làm mặc định.
- Khối **Kho ảnh Flow → sinh prompt video** chuyển sang mục **Ảnh → Video**.
- **Số chữ số cho STT** mặc định **3** (`001`, `002`…).
- `alert()` của engine bị chặn từ 2.3.1 — trong khung nhúng nó làm **treo cứng
  cả tab**.

### Tiến độ: phần trăm và trạng thái tải

Thanh tiến độ từng tab cộng thêm phần trăm của prompt **đang tạo**, nên nó nhích
đều thay vì đứng im 30–60 giây mỗi lần. Dưới thanh có dòng riêng cho việc tải,
và bảng Tổng quan có cột **Tải về**.

Tách hai thứ này ra là có lý do: tạo xong **không** có nghĩa là đã tải. Còn đổi
tên trên kho Flow, chờ máy chủ xuất file, rồi mới tải — nhật ký thật cho thấy
khoảng đó mất 15–40 giây mỗi cái. Gộp làm một là có lúc báo "Xong" trong khi
file chưa hề nằm trên đĩa.

Cột **Tên file** cũ ở bảng Tổng quan đã bỏ: nó đọc `r.filename`, một trường
engine **không hề gửi**, nên xưa nay luôn trống.

---

## 0e. Bản 2.3.1 — sửa đúng cái tôi vừa làm hỏng

Bản 2.3.0 giao đi kèm một lời thú nhận: phần `flow-mode.js` **chưa nghiệm thu
được ở đây** vì cần trang Flow thật. Chạy thật thì nó hỏng, đúng chỗ đã ngờ:

```
🔗 [tab1] Mẻ ảnh xong — tự nối sang video cho 2 ảnh (001 → 002)
⚠️ [tab1] Không tự đổi được sang chế độ video: Không mở được bảng cài đặt
⛔ [tab1] Bot tự động dừng: Sai chế độ giao diện (Yêu cầu Video).
```

Ba lỗi riêng biệt nằm trong ba dòng đó.

### 1. Bấm sai kiểu — Radix bỏ qua `click()`

Bảng cài đặt của Flow là Radix UI, mở bằng **`pointerdown`** chứ không phải
sự kiện `click` tổng hợp. Bản 2.3.0 gọi `el.click()` trơn nên không mở được gì.

Điều đáng nói: lời giải đã **nằm sẵn trong engine** và tôi đã không đọc.
`applyFlowSettings()` ghi rõ *"Full mouse event sequence (not just .click()) -
needed for Radix UI"* rồi bắn đủ `pointerover → mouseover → pointerdown →
mousedown → pointerup → mouseup → click`. Nay `flow-mode.js` bắn y hệt.

### 2. Tìm sai nút — và tìm bằng thước đo khác engine

Tôi dò `/\bx[1-4]\b/` ("x1"), engine dò `/\d+x/` ("1x"). Nhưng cái sai lớn
hơn là **dò riêng**: engine quyết định "sai chế độ giao diện" bằng cách đọc chữ
trên nút mà `findSettingsDropdownButtonNative()` trả về. Hai bên dò bằng hai bộ
chọn khác nhau thì sẽ có lúc tôi đổi xong mà engine vẫn kêu sai.

Nay `src/main/tabs.js` nối một đoạn xuất **bên trong** lớp bọc engine, phơi
chính hàm đó ra thành `window.__flowTimNutCaiDat`, và `flow-mode.js` dùng lại
nó — vừa để mở bảng, vừa để **xác nhận đã đổi**. Một nguồn sự thật duy nhất.
`flow-engine.js` trên đĩa vẫn không bị sửa một byte.

Thêm một cái bẫy nữa đã gỡ: bản cũ kiểm tra "có nhìn thấy không" bằng
`offsetParent`, mà `offsetParent` của **mọi phần tử `position:fixed` đều là
`null`** — và bảng thả xuống của Radix chính là khối fixed. Nay đo bằng kích
thước thật cộng `visibility`/`display`/`opacity`.

### 3. Mã ảnh lệch một chữ số — `001` ≠ `01`

Nhật ký in `(001 → 002)` trong khi kho Flow hiện `01`, `02`. Character Sync tìm
`@001`, không thấy gì. Nguyên nhân: giao diện **tự đánh số lấy** rồi hy vọng
trùng với tên Flow đặt.

Tên ảnh trên Flow do `renameMediaOnCloud()` đặt, bằng
`generateFileName(video, String(i+1), tiles.length)` — cùng hàm sinh tên file
tải về. Nay `src/main/jobs.js` có `tenAnhTheoRename()` **chép lại đúng hàm đó**
(cả ba nhánh `index_only` / `custom_list` / mặc định, cả đuôi `_1 _2` khi một
prompt ra nhiều ảnh, cả `renameStartIndex`), và tiến trình chính tính mã ảnh
bằng nó thay vì tin vào giao diện.

Kèm theo, khối *Tự nối ảnh → video* có thêm **dòng xem trước mã ảnh** ngay dưới
ô chọn. Lệch một chữ số thì lộ ra **trước khi bấm Bắt đầu**, chứ không phải sau
khi cả mẻ ảnh đã chạy xong hàng tiếng đồng hồ.

### 4. `alert()` của engine làm treo cả tab

Engine gọi `alert()` ở đúng hai chỗ — khi phát hiện sai chế độ. Ở tiện ích
Chrome thì người dùng đang nhìn tab đó, bấm OK là xong. Ở đây tab Flow chạy
trong khung nhúng, thường bị giấu sau giao diện app: `alert()` bật lên là
**đứng nguyên cả tab**, mọi lệnh sau đó treo. Với 4–5 tab song song thì hỏng cả
mẻ. Nay `chrome-shim.js` chặn `alert`/`confirm` và đẩy nội dung cảnh báo về
Nhật ký — người dùng vẫn đọc được, chỉ là không phải đi bấm OK cho từng tab.

### 5. Không giao việc khi chưa đổi được chế độ

Chuỗi ảnh→video giờ thử đổi chế độ **5 lần, cách nhau 12 giây**. Trong lúc đó
bạn tự bấm đổi trên trang Flow cũng được — app dò ra và chạy tiếp. Hết 5 lần mà
vẫn không đổi được thì **dừng hẳn, không giao việc**: giao vào lúc đó chỉ đổi
một thất bại im lặng lấy một thất bại ồn ào, mà mẻ ảnh vẫn nằm đó chưa được nối.

### Lần này đã nghiệm thu được

`tests/mode-main.js` + `tests/fixture-mode.html` dựng lại bảng cài đặt của Flow
ở **cả hai đời giao diện** (Radix cũ và Material mới), và fixture cố ý dựng
đúng hai cái bẫy: bảng **chỉ mở khi nhận `pointerdown`**, và bảng là khối
**`position:fixed`**. Bản 2.3.0 trượt cả hai. 30 khẳng định, bao gồm điều kiện
quan trọng nhất: sau khi đổi xong, **thước đo mà engine dùng** phải nói đúng
chế độ mới.

Cái còn lại vẫn chưa nghiệm thu được ở đây: tên lớp và cấu trúc DOM **thật** của
Flow hôm nay. Fixture dựng theo ảnh chụp bạn gửi cộng với chính selector engine
đang dùng, nhưng đó vẫn là bản dựng lại. Nếu Nhật ký còn báo không đổi được,
dòng `↳ chẩn đoán: {...}` ngay dưới sẽ cho biết nó nhìn thấy gì — gửi tôi dòng
đó là đủ, không cần chụp màn hình nữa.

---

## 0. Vì sao phải chuyển sang app desktop

### Vấn đề: prompt dài bị cắt cụt

Ô nhập prompt của Flow không phải `<textarea>`. Nó là editor **Slate.js /
ProseMirror** dựng trên `contenteditable`. Tiện ích Chrome chỉ có đúng hai
đường để nhét chữ vào, và **cả hai đều do trang web tự xử lý**:

1. `document.execCommand('insertText', ...)`
2. Tự chế một `ClipboardEvent('paste')` rồi phát ra

Cả hai chỉ là *lời đề nghị*. Hàm xử lý paste của Slate nhận chuỗi rồi tự quyết
định chèn bao nhiêu — với prompt dài thì nó cắt. Tiện ích đứng **ngoài** trang
web nên không có cách nào ép nó nhận đủ. Đây không phải lỗi lập trình sửa được
trong tiện ích; đó là giới hạn của chỗ đứng.

### Cách bản desktop giải quyết

Electron điều khiển Chromium ở **tầng dưới trang web**. Chữ được bơm qua
`Input.insertText` của giao thức DevTools — đúng con đường mà Chromium dùng khi
bạn gõ bằng bàn phím tiếng Việt. Với trang web thì đó là **gõ thật**, không đi
qua hàm xử lý paste, nên không có chỗ nào cắt bớt.

Đã đo bằng kiểm thử tự động (`tests/paste-main.js`) trên một ô nhập giả lập
đúng hành vi cắt chữ của Slate:

| Độ dài prompt | Đường cũ (tiện ích buộc phải dùng) | Đường mới (bản desktop) |
|---|---|---|
| 200 ký tự    | 200 / 200      | **200 / 200** |
| 1.500 ký tự  | 1.000 / 1.500 ← cắt | **1.500 / 1.500** |
| 5.000 ký tự  | 1.000 / 5.000 ← cắt | **5.000 / 5.000** |
| 20.000 ký tự | 1.000 / 20.000 ← cắt | **20.000 / 20.000** |

Thêm một điều quan trọng: bơm xong app **đọc ngược lại** nội dung trong ô nhập
rồi đếm. Thiếu chữ là báo lỗi rõ ràng kèm số ký tự thiếu — **không âm thầm chạy
tiếp để rồi sinh ra video sai nội dung**.

### Đa tab: hết cảnh đổi chéo tên file

README 1.7.0 của tiện ích mô tả một lỗi nặng: *hai tab tải cùng lúc thì tên file
bị đổi chéo*. Nguyên nhân nằm ở chính Chrome — sự kiện
`chrome.downloads.onDeterminingFilename` đưa cho tiện ích một `DownloadItem`
**không có trường `tabId`**. Tiện ích không thể biết file đang tải thuộc tab nào,
nên chỉ còn cách lấy đại mục đầu hàng đợi. Bản 1.7.0 phải dựng một cơ chế khoá
ép các tab tải **lần lượt**, đánh đổi bằng tốc độ.

Electron đưa thẳng `webContents` vào sự kiện tải:

```js
session.on('will-download', (event, item, webContents) => { … })
```

Biết chính xác tab nào tải file nào thì mỗi tab giữ hàng đợi tên riêng, **bỏ hẳn
cơ chế khoá**, và các tab tải song song thật.

Ngoài ra bản desktop không có service worker MV3 để Chrome giết khi rảnh — thứ
đã gây mất nhịp ở bản tiện ích.

---

## 1. Cách chạy

### Cách A — chạy từ mã nguồn (khuyến nghị, ít hỏng nhất)

1. Cài **Node.js** bản LTS từ <https://nodejs.org> (giữ nguyên mục *Add to PATH*).
2. Bấm đúp **`CHAY_TU_NGUON.bat`**.

Lần đầu mất 3–10 phút để tải thư viện (~250 MB). Từ lần sau mở là chạy ngay.

### Cách B — đóng gói thành file .exe

Bấm đúp **`BUILD_EXE.bat`**. Xong sẽ có file `.exe` trong thư mục `dist`.

Lần đầu mở, Windows SmartScreen báo *"Unknown publisher"* vì file không mua chữ
ký số — bấm **More info → Run anyway**. Đây là chuyện bình thường với mọi app tự
build, không phải dấu hiệu có vấn đề.

> Nếu cách B hỏng trên máy bạn, **đừng mất thời gian sửa** — cách A vẫn chạy
> được và cho ra đúng một app như nhau.

---

## 2. Ba bước dùng lần đầu

1. Mở app → mục **Trình duyệt** → bấm **+ Mở tab Flow** → **đăng nhập Google
   ngay trong cửa sổ app**.
   Phiên đăng nhập được lưu trong thư mục dữ liệu của app, nên lần sau mở không
   phải đăng nhập lại. Mọi tab dùng chung một phiên — đăng nhập một lần là đủ.

2. Trên trang Flow, chỉnh sẵn **chế độ video, tỉ lệ khung hình, số lượng** như ý
   muốn. App **giữ nguyên** những cài đặt đó, không đụng vào — giống hệt cách
   tiện ích làm.

3. Sang mục **Chạy prompt**, dán danh sách prompt, bấm **Bắt đầu**.

Muốn chạy nhiều tab: quay lại mục **Trình duyệt**, bấm **+ Mở tab Flow** thêm
vài lần. Ở mục **Chạy prompt** sẽ thấy khung *Giao việc cho tab* — để trống thì
app chia đều prompt cho mọi tab sẵn sàng.

---

## 3. Kiểm chứng trước khi chạy cả mẻ

**Cài đặt → Thử đường dán prompt.**

Bấm *Tạo thử 5.000 ký tự* rồi *Thử dán vào tab đang mở*. App sẽ bơm đoạn đó vào
ô nhập của Flow và **đếm lại xem vào được bao nhiêu ký tự**.

Dùng mục này khi nghi ngờ, thay vì chạy cả trăm prompt rồi mới phát hiện thiếu chữ.

---

## 4. Cấu trúc mã nguồn

```
main.js                        tiến trình chính — thay vai trò background.js (service worker)
src/main/
  accounts.js                  NHIỀU TÀI KHOẢN — mỗi tài khoản một phiên riêng
  tabs.js                      quản lý đa tab bằng WebContentsView
  jobs.js                      chia việc cho tab/tài khoản + hợp đồng dữ liệu gửi engine
  paste.js                     ĐƯỜNG DÁN PROMPT ĐÃ SỬA — chỗ quan trọng nhất
  downloads.js                 tải file + đổi tên theo TỪNG tab
  store.js                     thay chrome.storage.local, lưu ra file JSON
  text-utils.js                bỏ dấu tiếng Việt, làm sạch tên file cho Windows
  an-toan.js                   chế độ an toàn — tự nghỉ khi Flow báo bất thường
  model.js                     kế hoạch model: chính / xen kẽ / dự phòng Lower Priority (2.8.0)
  cap-nhat.js                  TỰ CẬP NHẬT từ GitHub Releases, Windows + Mac (2.8.0)
  preload-flow.js              cầu nối trang Flow <-> tiến trình chính
  preload-ui.js                cầu nối giao diện <-> tiến trình chính
src/inject/
  chrome-shim.js               GIẢ LẬP chrome.* — nhờ nó mà engine chạy lại nguyên vẹn
  main-world-helpers.js        trích nguyên văn từ background.js 1.10.0
  flow-engine.js               = content-v2.js của 1.10.0, 6.430 dòng — xem đính chính dưới
  flow-mode.js                 tự đổi chế độ Image <-> Video trên giao diện Flow
  flow-model.js                đọc / đổi model video trên giao diện Flow (2.8.0)
  flow-canh-bao.js             đọc câu "hoạt động bất thường" trên trang
src/ui/                        giao diện app
BUILD_EXE.bat                  dong goi thanh .exe (ban cai + ban mot file)
CHAY_TU_NGUON.bat              chay thang tu ma nguon, duong du phong
CAI_NODEJS.bat                 tu do va cai Node.js neu may chua co
CHAY_TU_NGUON.command          ban Mac cua CHAY_TU_NGUON.bat
BUILD_MAC.command              dong goi .dmg tren may Mac
GHI_CHU_BAN_MOI.md             "co gi moi" hien trong app khi co ban moi
tools/ky-mac.js                ky ad-hoc ban Mac sau khi dong goi
.github/workflows/
  build-windows.yml            GitHub dung ho file .exe
  build-mac.yml                GitHub dung ho ban Mac (.dmg + .zip)
  phat-hanh.yml                dong goi CA HAI roi dang ban phat hanh — ban be tu cap nhat
tests/
  smoke.js                     kiểm thử giao diện không cần màn hình + chụp ảnh
  paste-main.js                kiểm chứng đường dán prompt
  tabs-main.js                 engine có bám được vào tab không
  mode-main.js                 đổi chế độ Image <-> Video có chạy không
  model-main.js                chọn model: ba đời giao diện, bẫy tiền tố, bẫy chữ biểu tượng
  model-e2e.js                 đường model từ đầu tới cuối trong app thật (FLOW_E2E_MODEL=1)
  cap-nhat-test.js             bộ cập nhật với GitHub giả + gói Mac thật
  fixture-model.html           hộp chọn model của Flow, ba đời giao diện
  fixture-slate.html           ô nhập giả lập đúng hành vi cắt chữ
  fixture-flow.html            trang Flow giả lập (có chuyển trang kiểu SPA)
  fixture-mode.html            bảng cài đặt của Flow, cả hai đời giao diện
                               (bật-tắt ở pointerdown hoặc click, tuỳ đời)
reference/                     bản gốc của tiện ích, chỉ để đối chiếu — app không dùng
```

> **Đính chính (2.8.2):** chỗ này và mục "Điểm mấu chốt" dưới đây từng ghi
> `flow-engine.js` **KHÔNG SỬA MỘT BYTE** so với `content-v2.js` của tiện ích
> 1.10.0. Từ 2.8.2 điều đó **không còn đúng tuyệt đối**: có **đúng một** chỗ
> khác, là dòng đếm ảnh trước khi bấm Tạo (`_preClickImageCount`), vì chính nó
> gây treo im lặng ngày 22/09/2026 — xem [mục 0m](#0m-bản-282--treo-im-lặng-sau-khi-bấm-tạo-và-mục-chẩn-đoán-nằm-đó-chết).
> Chỗ khác đó có đánh dấu ngay trong code (`KHÁC content-v2.js`) và có bài
> kiểm thử tĩnh canh (`tests/run.js`). Tinh thần cũ vẫn giữ: **không fork
> engine để thêm tính năng** — tính năng mới đi bằng file tiêm riêng.

### Điểm mấu chốt: `chrome-shim.js`

Engine dò DOM của Flow (`flow-engine.js`) là **6.430 dòng đã tốn rất nhiều công
thử lửa qua từng lần Google đổi giao diện** — khoảng 175 chỗ tìm phần tử DOM.
Viết lại nó sang Python hay bất cứ ngôn ngữ nào là vứt bỏ toàn bộ công đó.

Engine chỉ dùng đúng 4 nhóm API của Chrome:

| API | Số chỗ dùng | Thay bằng |
|---|---|---|
| `chrome.runtime.sendMessage` | 38 | IPC của Electron |
| `chrome.storage.local` | 19 | file JSON trong thư mục dữ liệu |
| `chrome.runtime.onMessage` | 5 | IPC của Electron |
| `chrome.runtime.getManifest` | 1 | object tĩnh |

(`chrome.scripting` và `chrome.tabs` chỉ xuất hiện trong **ghi chú**, không phải
lời gọi thật.)

Nên chỉ cần ~150 dòng giả lập là engine chạy lại được nguyên vẹn. Mỗi lần Google
đổi giao diện, bạn vẫn sửa selector ở **đúng một chỗ** như trước.

Engine chạy trong **main world** của trang. Đây là khác biệt lớn: content script
của tiện ích bị nhốt trong *isolated world* nên mọi sự kiện nó phát ra đều có
`isTrusted = false` và Slate bỏ qua — chính vì thế bản 1.10.0 phải vòng qua
`background.js` gọi `executeScript({ world: 'MAIN' })`. Ở đây không cần vòng nữa.

---

## 5. Chạy kiểm thử

```
npm test                                             # logic thuan + bo cap nhat
npx electron --no-sandbox tests/paste-main.js        # duong dan prompt dai
npx electron --no-sandbox tests/mode-main.js         # doi che do Image <-> Video
npx electron --no-sandbox tests/model-main.js        # chon model video
FLOW_TEST_HOST='^file:' npx electron --no-sandbox tests/tabs-main.js      # engine bam vao tab
FLOW_E2E_MODEL=1 FLOW_TEST_HOST='^file:' npx electron --no-sandbox .      # model tu dau toi cuoi
```

Kiểm thử giao diện (Linux, cần Xvfb):

```
FLOW_SMOKE=1 npx electron . --no-sandbox
```

Ảnh chụp từng mục nằm ở `shots/`. **Phải xem lại ảnh** sau khi sửa giao diện —
nút bị cắt hay chữ chìm vào nền không hề ném ra exception.

---

## 5b. Khi tab báo "chưa sẵn sàng"

Tab Flow hiện ra đầy đủ nhưng app vẫn báo **Tab chưa sẵn sàng** và không bấm
Bắt đầu được, nghĩa là engine chưa bám được vào trang. Ở mục **Trình duyệt** có
hai nút xử lý việc này:

- **⚡ Gắn lại engine** — tiêm lại mà không phải tải lại cả trang Flow. Thử cái
  này trước.
- **🩺 Chẩn đoán** — in ra Nhật ký từng mảnh có mặt hay không (cầu nối preload,
  lớp giả lập `chrome.storage`, kênh nhận lệnh, engine, hàm bấm nút Tạo, ô nhập
  prompt). Dùng khi cần biết hỏng ở đâu thay vì đoán.

Từ bản 2.0.1 app còn **tự dò lại mỗi 3 giây** và tự gắn lại khi phát hiện engine
chết, nên phần lớn trường hợp không phải bấm gì.

### Hai lỗi đã gây ra chuyện này (đã sửa ở 2.0.1)

1. **`executeJavaScript` trả về hàm.** `main-world-helpers.js` kết thúc bằng
   `window.__flowClickCreate = mainWorldClickCreate;` — giá trị của phép gán đó
   là một hàm, mà Electron phải chuyển giá trị trả về của đoạn mã về tiến trình
   chính bằng structured clone. Hàm không clone được, nên lời gọi ném
   *"An object could not be cloned"* và cả chuỗi tiêm vỡ ngay tại đó.
   Sửa: nối thêm `;undefined;` vào cuối mỗi đoạn tiêm.

2. **Tiêm lại vào cùng một tài liệu thì vỡ.** `flow-engine.js` khai báo hàng
   loạt `const` ở cấp cao nhất; tiêm lần hai là `SyntaxError: Identifier ...
   has already been declared`, và không xoá đi được vì `const` cấp cao nhất
   không nằm trên `window`. Hệ quả: chốt chặn dò lại thử mỗi 3 giây và lần nào
   cũng vỡ ở đúng chỗ đó.
   Sửa: bọc engine trong một hàm tự gọi để mọi khai báo nằm trong phạm vi hàm.

Ngoài ra Flow là ứng dụng Angular: sau khi đăng nhập nó chuyển màn hình bằng
`history.pushState` chứ không tải lại trang, nên `did-finish-load` không bắn
lần nữa. Nay app nghe thêm `did-navigate-in-page` và `dom-ready`.

`tests/tabs-main.js` kiểm cả bốn tình huống này để lỗi không quay lại.

---

## 6. Những giới hạn phải nói thẳng

- **App không vượt được chốt chặn phía máy chủ Google.** Nếu Flow từ chối một
  prompt vì quá dài ở phía *máy chủ* (khác với ô nhập cắt chữ ở phía *trình
  duyệt*), thì không tool nào bỏ qua được. App sẽ báo rõ số ký tự vào được là
  bao nhiêu để bạn phân biệt hai trường hợp.

- **App không dùng API chính thức nào của Google Flow** (Google không cung cấp).
  Nó đọc giao diện web. Mỗi lần Google đổi giao diện là một số bước có thể trượt
  — y hệt bản tiện ích. Khác biệt là nay chỉ phải sửa ở một chỗ.

- **Chưa có ở bản 2.0.0** (bản 1.10.0 có, sẽ bổ sung sau khi bạn xác nhận phần
  lõi chạy ổn): tab **Ảnh → Video**, **Character Sync**, **Chẩn đoán giao diện**,
  **Quản lý dự án**, **tự báo bản mới**.

- **File .exe không có chữ ký số.** SmartScreen sẽ cảnh báo ở lần mở đầu tiên.

---

## 7. Dữ liệu được lưu ở đâu

```
%APPDATA%\Flow Automation Studio\
   flow-studio-data.json      cai dat + du an
   flow-studio.log            nhat ky
   Partitions\flow\           phien dang nhap Google
```

Trên macOS:

```
~/Library/Application Support/Flow Automation Studio/
```

Mở nhanh bằng **Cài đặt → Mở thư mục dữ liệu**.

Gỡ app **không** làm mất cài đặt. Muốn đăng xuất hẳn khỏi Google thì xoá thư mục
`Partitions\flow`.
