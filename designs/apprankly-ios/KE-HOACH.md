# Kế hoạch AppRankly cho iOS 26+

App iPhone dùng riêng cho một chủ tài khoản. SwiftUI đọc và ghi qua backend AppRankly hiện tại. Đã chọn mẫu **A. Tổng quan** cho màn mở đầu. Batch 1 bắt đầu với router mobile và phiên đăng nhập thiết bị. Phạm vi parity lấy theo giao diện web hiện hành trong `app/frontend/src/App.jsx`, gồm cả các tác vụ ít dùng ở phần Cài đặt và menu thao tác.

Batch 1 đến 3 đã qua kiểm thử local. Trên simulator đã kiểm tra phiên thiết bị, thống kê, Hộp việc và luồng duyệt bản xem trước AI rồi gửi phản hồi đến store giả lập. API được kiểm thử đối soát sau timeout, quyền phản hồi và lỗi từng dòng khi gửi hàng loạt. Xác minh gửi lên store thật và ký cài trên iPhone thật còn chờ. Xem [hướng dẫn chạy trong Xcode](../../ios/README.md) và [OpenAPI mobile](../../app/openapi/mobile-v1.yml).

## Kiểm kê backend

| Nhóm | Đang có | Bổ sung cho iPhone |
|---|---|---|
| Phiên đăng nhập | `app/lib/auth.js` dùng cookie HttpOnly 12 giờ và kiểm tra Origin cho thao tác ghi. | Mount router `/api/v1` riêng cho token thiết bị. Tái dùng kiểm tra mật khẩu owner và giới hạn đăng nhập. |
| Danh mục, thống kê | `projects`, `portfolio`, `dimension`, `country-revenue`, `purchases`, `exchange-rates`. | DTO ổn định theo app và kỳ báo cáo. Một request vào màn mặc định, tải sâu theo màn. |
| Việc cần làm | Web ghép danh mục, `insights/open-reviews` và `insights/anomalies` qua `tasks.js`. | Dùng cùng quy tắc xếp việc cho hai client. Trả ID dẫn tới đúng app, review hoặc keyword. Xác nhận hành vi bỏ qua trên từng thiết bị trước khi thêm đồng bộ trạng thái. |
| Review | `aso/app/:id` gộp listing, review, keyword, rank, competitor, campaign và kết quả AI. `storeReviews.js` lưu kho review, có gửi lẻ và hàng loạt. | Đọc riêng từ kho SQLite với phân trang, bộ lọc và trạng thái nguồn. Giữ xác nhận gửi, thêm chống ghi lặp và đối soát trạng thái store. |
| Từ khóa và ASO | `aso/keywords`, `aso/ranks`, `aso/ranks/history`, tìm và ghim đối thủ, listing, campaign. | Trả rank theo app và thị trường, tách danh sách khỏi lịch sử. Nối các thao tác thêm, bỏ theo dõi, kiểm tra và gợi ý AI hiện có. |
| Quản trị cá nhân | `sync`, `refresh`, settings, integration tests, notifications, digest, export, release impact và events. | JSON theo từng màn, trạng thái đồng bộ cho tác vụ dài, share sheet cho CSV/JSON. |
| AI | `ai/preview` và `ai/run`, preview có hạn và dùng một lần. Web có luồng soạn review bằng một nút, sau đó xác nhận gửi riêng. | Giữ hai quyền tách biệt: tạo nội dung và công khai phản hồi. Áp các luồng preview của web, ràng buộc preview trả về với phiên và đúng app/tác vụ. |

Các route server-side có sẵn như `/api/notes`, linter và PPP pricing cần đối chiếu lại với các màn web đang bật trước khi đưa vào checklist parity. Bất kỳ mục nào đang có thể thao tác trên web sẽ có đường tương ứng trong app. Bố cục và phím tắt desktop được thay bằng điều hướng iPhone tương ứng.

## Hợp đồng API đề xuất

Giữ một service Express, một SQLite và các bộ kết nối App Store Connect, Google Play, AI hiện tại. Tách logic đang nằm trong handler thành hàm dùng chung tại điểm cần dùng. Mount router mobile sau middleware chung về JSON, `no-store` và bảo vệ HTTP, trước chuỗi xác thực cookie và Origin của web. Router mobile có auth và rate-limit riêng cùng lỗi 404 cuối router. Mobile dùng `URLSession` và `Codable`.

| API dưới `/api/v1` | Hợp đồng tối thiểu |
|---|---|
| `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` | Mật khẩu owner qua HTTPS, access token Bearer ngắn hạn và refresh token xoay vòng. Thu hồi từng phiên thiết bị khi logout. Lưu refresh token dạng hash trong SQLite và dùng transaction khi xoay. Ràng buộc phiên với phiên bản thông tin đăng nhập để đổi mật khẩu hoặc secret có hiệu lực cả với mobile. Keychain giữ token thiết bị, app không lưu mật khẩu hay store keys. |
| `GET /apps`, `GET /apps/{appId}/icon`, `GET /overview?from=&to=&platform=` | ID opaque từ hệ hiện tại, ví dụ `apple:com.example.expenses`. Overview trả app, cảnh báo nguồn, kỳ hiện tại và kỳ trước đủ cho màn mặc định. Trả `generatedAt` và mốc dữ liệu của từng app. |
| `GET /apps/{appId}/analytics?from=&to=`, `GET /apps/{appId}/analytics/{breakdown}` | Chuỗi theo ngày, quốc gia, phiên bản và mua hàng theo màn. Giữ ngày báo cáo, tiền gốc và cơ sở đo. USD chỉ hiện dưới dạng ước tính có nguồn tỷ giá. |
| `GET /inbox`, `GET /apps/{appId}/reviews`, `GET /apps/{appId}/reviews/{reviewId}` | Inbox gồm việc cần làm. Danh sách review lọc trạng thái phản hồi, số sao và app, phân trang bằng cursor ổn định theo ngày và ID. Tách trạng thái kết nối store khỏi quyền gửi của từng review. |
| `PUT /apps/{appId}/reviews/{reviewId}/reply`, `POST /apps/{appId}/reviews/bulk-replies` | Body có nội dung xác nhận, idempotency key cho thao tác ghi và revision dự kiến để phát hiện cập nhật từ web hoặc store. Bulk trả kết quả từng dòng. Có trạng thái chờ hiển thị, đã xác nhận hoặc cần đối soát. |
| `GET/POST /apps/{appId}/keywords`, `DELETE /apps/{appId}/keywords/{keywordId}`, `GET /apps/{appId}/keywords/{keywordId}/history`, `POST /apps/{appId}/rank-checks` | Lọc theo thị trường và ngôn ngữ. Theo dõi theo app như web, lịch sử và đợt kiểm tra theo thị trường. Phân biệt chưa kiểm tra, ngoài top N, nguồn lỗi và rank thật. |
| `POST /ai/previews`, `POST /ai/runs` | Server dựng và che dữ liệu nhạy cảm trong payload. Trả điểm đến, dữ liệu gửi, hạn và preview ID. Run nhận ID đã xác nhận, tiêu thụ một lần. Tạo bản nháp và gửi review là hai API riêng. |
| `GET /notifications`, `POST /notifications/read`, `DELETE /notifications/{id}`, `GET /settings`, `PUT /settings`, `GET /integrations`, `POST /sync`, `GET /sync/{id}` | Notification trong app, thiết lập và tình trạng tích hợp. Nếu tác vụ đồng bộ dài, trả 202 và ID công việc, hoàn tất qua scheduler hiện tại. Đính kèm nguồn lỗi hoặc tiến độ cho từng store. |

Thống nhất JSON lỗi `{error: {code, requestId}}`, mã ổn định cho phiên hết hạn, thiếu quyền, tài nguyên thiếu, kết quả store chưa rõ và rate-limit. Phản hồi danh sách có `nextCursor` nullable. Mọi thao tác theo app kiểm tra ID qua `ownedApp` và lọc review, keyword, event hoặc campaign theo app/platform. Với analytics, `null` biểu thị thiếu dữ liệu, giá trị 0 biểu thị kết quả đo bằng không. Cơ sở đo Google và Apple khác nhau, nên API cần gắn nhãn doanh thu với từng loại phép đo. Kiểm tra hợp đồng bằng test tự động trước khi SwiftUI gọi server.

### Gửi review và lỗi giữa chừng

Ghi dấu lần gửi trước khi gọi store. Nếu timeout sau khi upstream có thể đã nhận, trả trạng thái cần kiểm tra lại. Retry cùng key đọc kết quả cũ hoặc đối soát với store trước khi gửi lại. Dùng cùng cơ chế ghi cho web và iOS để revision phản ánh các cập nhật từ cả hai client. Giữ nội dung chưa gửi ở composer khi mất mạng hoặc hết phiên. Với iOS, dùng giới hạn ban đầu theo validator hiện có và đối chiếu trên staging bằng cả văn bản có dấu lẫn emoji.

Google Play cho tạo hoặc sửa phản hồi và tài liệu hướng dẫn giới hạn 350 ký tự. Apple cho tạo và sửa bằng cùng endpoint, phản hồi có thể chờ công bố. Bản đầu theo parity web hiện tại, gồm tạo và sửa. Lấy quyền thực tế từ store trước khi tuyên bố có thể gửi, đặc biệt với review công khai hoặc review lưu từ lịch sử. [Google Play Reply to Reviews](https://developers.google.com/android-publisher/reply-to-reviews) · [Apple Customer Review Responses](https://developer.apple.com/documentation/appstoreconnectapi/customer-review-responses)

## Thứ tự triển khai và điều kiện nghiệm thu

| Batch | Backend | iPhone | Hoàn thành khi |
|---|---|---|---|
| 0. Chọn hướng và khóa phạm vi | Kiểm kê route và fixture theo app, ngày, store và trạng thái nguồn. | Đã chốt A. Tổng quan, vào tab Thống kê khi mở app. | Hướng giao diện đã chốt. Checklist parity chi tiết được đối chiếu theo từng batch. |
| 1. Kết nối và phiên | Router `/api/v1`, schema OpenAPI, login/refresh/logout/me, cấu hình host HTTPS, rate-limit, redaction. | SwiftUI shell, đăng nhập, Keychain, chuyển cảnh hết phiên và lỗi kết nối. | Login và thu hồi trên staging. Test song song refresh và phân tách API cookie/Bearer. Test web auth hiện có vẫn qua. |
| 2. Danh mục và thống kê | Apps, icon, overview, analytics theo app, quốc gia, phiên bản, doanh thu, lượt mua, hoàn tiền, release impact và nguồn. | `TabView`, mở vào tab Thống kê, `List`, bộ lọc thời gian và Swift Charts. | Cùng fixture hai store cho kết quả tương ứng web, gồm kỳ thiếu báo cáo, tiền nhiều loại và lệch ngày. Trạng thái tải từng phần, trống, lỗi và làm mới hoạt động. |
| 3. Review và Hộp việc | Đọc riêng, lọc, phân trang, refresh, gửi/sửa lẻ và bulk, mẫu trả lời, luồng draft AI, việc cần làm. | Review list → chi tiết → soạn → xác nhận → trạng thái store. Mục Cần xử lý trên Thống kê dẫn tới review hoặc biến động tương ứng. | Test phân trang, xung đột chỉnh sửa, lỗi một phần khi bulk, retry sau timeout và trường hợp store không cấp quyền. Xác minh App Store chờ hiển thị và phản hồi Google trên dữ liệu thử được phép gửi. |
| 4. Keyword và ASO | Keyword, rank theo thị trường, lịch sử, đối thủ, listing, campaign, preview AI và nhập keyword đã chọn. | Danh sách rank, chi tiết xu hướng, danh sách đối thủ, listing, chiến dịch. | Đổi thị trường giữ đúng ngữ cảnh, dữ liệu rank lỗi vẫn đọc được, AI chỉ thêm các từ đã chọn. Các thao tác theo app có test quyền và phạm vi dữ liệu. |
| 5. Parity còn lại và cài cá nhân | Thiết lập, trạng thái và kiểm tra tích hợp, đồng bộ, thông báo/digest, events, các công cụ AI đang hiện trên web và export tương thích. | `Form` cho Settings, share sheet CSV/JSON, thông báo trong app, vi/en, phân biệt lỗi và hành động khôi phục. | Mỗi tác vụ web có đối chiếu và đường đi trên iOS. Chạy test backend, UI test, Dark Mode, VoiceOver, Dynamic Type, Reduce Transparency, offline và iPhone thật. Xác minh ký và cài trực tiếp qua Xcode trên iPhone của chủ app. |

Cài từ Xcode trên thiết bị đăng ký là cách đề xuất cho đợt dùng cá nhân đầu tiên. Ký và cấp lại provisioning theo tài khoản Apple đang dùng. APNs chỉ đưa vào khi xác nhận cần thông báo hệ thống trên iPhone. Thông báo trong app và các kênh server hiện có nằm trong parity. [Apple: Chạy app trên thiết bị](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)

## Hướng thiết kế native

- **A. Tổng quan** là mẫu được chọn. Màn đầu hiển thị xu hướng lượt cài, mốc dữ liệu, doanh thu, danh sách app và mục Cần xử lý. Sắc hồng AppRankly dành cho lựa chọn và hành động. Cụm biểu đồ và danh sách app trả lời câu hỏi app nào có thay đổi trong kỳ.
- Chia bốn đích thường dùng bằng `TabView` và `NavigationStack`, theo thứ tự **Thống kê → Review → Từ khóa → Ứng dụng**. Mỗi tab giữ ngữ cảnh khi chuyển. Settings nằm trong toolbar. Dùng `List`, `Section`, `Picker`, `Menu`, `Form`, `TextEditor`, `.searchable`, `.sheet` và `ShareLink` trước. Dùng Swift Charts và row tổng hợp riêng khi cách trình bày dữ liệu thật sự cần đến.
- Liquid Glass do hệ thống cung cấp cho tab bar, navigation và toolbar. Biểu đồ, nội dung review, hàng keyword dùng nền đặc. Dùng SF Symbols và kiểu chữ semantic Dynamic Type. Đích chạm 44 pt, nhãn VoiceOver cho sao và số liệu, trạng thái có chữ, màu thích ứng theo hệ thống. Màn compact ưu tiên một cột. Kiểm tra iPhone rộng và Dynamic Type lớn bằng cách xuống dòng metadata thay vì thu chữ.
- Prototype HTML mô phỏng thanh tab và sheet, dùng chung bộ dữ liệu mẫu. Batch 2 và 3 kiểm chứng hành vi native trong SwiftUI. Quyết định thiết kế dựa trên `designing-for-ios.md › Best practices`, `tab-bars.md › Best practices`, `sheets.md › Best practices`, `color.md › Best practices` và `charting-data.md › Best practices`. [Apple: Adopting Liquid Glass](https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass) · [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/)
