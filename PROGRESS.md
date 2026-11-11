# Tiến độ AppRankly

## Đợt mới: giao diện Today (nhánh `feat/today-ui`)

- Người dùng chọn hướng B · Today trong `designs/apprankly-v2/` (prototype A · Leaderboard được giữ để tham khảo).
- Frontend mới: trang Hôm nay (lời chào, Việc cần làm, số hôm qua/kỳ/USD), lưới thẻ app mở ra chi tiết bằng View Transitions, bảng lệnh ⌘K, tiến trình đồng bộ theo nguồn, Tác động phiên bản trong tab Phiên bản.
- Tải dữ liệu: Apple và Google gọi riêng (`/api/portfolio` nhận `platform`), cache theo kỳ, tải trước khi rê chuột, giữ số cũ khi đổi kỳ, nạp review nền từng app.
- Backend thêm `GET /api/insights/open-reviews`, `GET /api/insights/release-impact` (có test). Font chuyển sang Bricolage Grotesque + Readex Pro (OFL), bỏ font cũ.
- Kiểm tra: `app/test/run.js` đạt; `designs/apprankly-v2/production-check.mjs` và `audit.mjs production` chạy trên preview-server tổng hợp, 1440/390, sáng/tối, không lỗi console, không tràn ngang.
- Chưa làm: deploy Railway và kiểm tra với dữ liệu thật.


**Cập nhật:** 2026-11-01 17:36 (Asia/Ho_Chi_Minh)
**Agent gần nhất:** Codex
**Trạng thái:** ✅ Hoàn tất yêu cầu hiện tại; đã lưu checkpoint

## Công việc hiện tại

Dashboard cá nhân cho các app Google Play và App Store, chạy trên Railway. Đã hoàn tất việc gộp ASO vào Chi tiết app, bỏ Nhật ký khỏi giao diện, thêm tổng USD và nhận diện logo/nền tảng. Commit tính năng gần nhất: `d4731b7`, đã push `origin/main` và quan sát bản frontend mới cùng dữ liệu thật tại https://apprankly-production.up.railway.app.

## Danh sách công việc

- [x] Spectrum tông ấm, Việt/Anh, sáng/tối/theo hệ thống; font nội bộ.
- [x] Credentials chỉ ở server, đăng nhập một chủ sở hữu, cookie HttpOnly, kiểm tra Origin; bỏ Git/team/raw SQL khỏi runtime cá nhân.
- [x] Railway: một service, SQLite và dữ liệu dưới `/app/data`, health/readiness, tài liệu triển khai và biến môi trường bằng tiếng Anh.
- [x] AI hỗ trợ OpenAI/Anthropic-compatible proxy và custom base URL; HTTP nội bộ Railway cần opt-in rõ ràng.
- [x] Phát hiện app Google qua Reporting API, bucket báo cáo và danh sách package thêm thủ công; tải logo qua server có allowlist.
- [x] Sửa parser Google để không che số liệu Install Events bằng số 0 giả.
- [x] Apple: tải Sales Reports đúng phiên bản, lỗi nguồn có HTTP status an toàn; sửa doanh thu subscription/IAP theo Parent Identifier/SKU.
- [x] Google: đọc ZIP Estimated Sales, lọc package/ngày, xử lý hoàn tiền và giữ tiền tệ gốc.
- [x] Review: API chính thức, tối đa 12 báo cáo CSV Google gần nhất, nguồn công khai dự phòng, SQLite archive; xem và sửa phản hồi, lọc đã/chưa trả lời.
- [x] AI-Generated Response: một lần bấm tạo nháp, theo ngôn ngữ đánh giá; đăng lên store cần xác nhận riêng.
- [x] Xử lý JSON từ proxy có Markdown fence, lỗi rỗng/cắt/không hợp lệ; không trả nhầm thành lỗi nhập liệu.
- [x] Gộp ASO vào các tab Chi tiết app; bỏ trang Nhật ký, form ghi chú/releases và timeline khỏi frontend.
- [x] Tổng USD tham khảo, số tiền gốc mở rộng, tỷ giá/ngày/nguồn; cache và xử lý tỷ giá thiếu.
- [x] Test backend, build frontend, kiểm tra responsive và bản Railway thực tế.

## Các tệp chính đã thay đổi trong đợt làm việc

- `app/frontend/src/App.jsx` — shell Spectrum, Chi tiết app gộp, review reply và tổng USD; đã xóa khoảng 480 dòng UI cũ trong đợt gộp.
- `app/frontend/src/components.jsx` — logo, icon nền tảng và export theo cơ sở doanh thu.
- `app/frontend/src/index.css`, `locales.js`, `revenue.js` — bố cục, Việt/Anh, tổng tiền gốc và quy đổi USD.
- `app/lib/portfolio.js`, `GooglePlayStoreStatsViewer.js`, `AppleAppStoreStatsViewer.js` — danh sách và số liệu các app, nguồn dữ liệu, subscription revenue.
- `app/lib/googleAppDiscovery.js`, `googleSales.js`, `googleReviewHistory.js` — discovery chính thức, báo cáo tài chính ZIP, review CSV.
- `app/lib/storeReviews.js`, `db/migrations/009_review_archive.sql` — đọc/lưu review và gửi phản hồi qua store API.
- `app/lib/exchangeRates.js` — tỷ giá công khai Frankfurter, cache dưới DATA_DIR, nguồn dự phòng khi lỗi.
- `app/lib/ai/index.js`, `app/routes/aso.js`, `app/server.js` — proxy AI, prompt review, lỗi có mã ổn định, API tỷ giá có xác thực.
- `app/test/` — regression tests cho doanh thu, discovery, review/history, tỷ giá, proxy và bảo mật; `preview-server.js` chỉ dùng dữ liệu giả.
- `README.md`, `DEPLOYMENT.md`, `SECURITY.md` — hướng dẫn và giới hạn hiện tại bằng tiếng Anh.

## Quyết định và ghi chú

- Thiết kế đã duyệt: Spectrum với màu ấm và chữ đậm/dễ đọc hơn. Điều hướng hiện chỉ có Tổng quan, Chi tiết app, Cài đặt.
- Chi tiết app có 8 tab: Tổng quan, Quốc gia, Phiên bản, Nội dung cửa hàng, Từ khóa, Đối thủ, Đánh giá, Chiến dịch. App đang chọn được dùng chung cho các tab.
- Nhật ký bị loại khỏi frontend. Không xóa ghi chú/releases, bảng hoặc tệp dữ liệu cũ; backend API cũ vẫn có xác thực. Frontend mới không tải hoặc gửi ghi chú cũ vào AI.
- Apple: tiền nhận dự kiến = Developer Proceeds × Units, khớp app ID hoặc Parent Identifier là SKU app. Google: Charged Amount từ Estimated Sales, gồm thuế, chưa trừ phí, trừ refunds. Hai cơ sở khác nhau được ghi nhãn rõ.
- Tổng USD dùng tỷ giá tham khảo mới nhất, không phải tỷ giá ngày giao dịch/payout hoặc lợi nhuận ròng. Frankfurter chỉ nhận yêu cầu bảng tỷ giá với base USD, không nhận dữ liệu portfolio hay credentials. Cache một giờ, lưu trên volume, dùng snapshot cũ tối đa bảy ngày khi nguồn lỗi. Thiếu tỷ giá thì không hiện tổng đầy đủ.
- Google app discovery cần bật Google Play Developer Reporting API và quyền service account phù hợp. Gửi review cần Google Play Android Developer API và quyền Reply to reviews. Báo cáo tài chính cần View financial data ở cấp Global.
- Review Google API chỉ liệt kê review mới/sửa trong bảy ngày; kết hợp tối đa 12 báo cáo tháng gần nhất, 100 review công khai US và archive. UI hiển thị tối đa 500 review, không cam kết đầy đủ lịch sử. CSV không có review ID dùng được thì chỉ đọc.
- Nút AI-Generated Response tự tạo/tiêu thụ payload một lần ở server; không có bước duyệt payload trong form review. Chỉ tạo nháp, không tự đăng. Các phân tích AI tổng quát vẫn có preview và consent riêng.
- Proxy đang cấu hình trên Railway đã tạo nháp thật thành công sau bản sửa `e57cd68`. Không đọc hoặc ghi key thật vào checkpoint/log/tài liệu.
- Production data/screenshot không được commit vào repo. Preview synthetic không được đóng gói vào Docker image.

## Kiểm thử và xác minh gần nhất

- Backend: Node 22, chạy toàn bộ `app/test/run.js`, thành công. Mặc định bỏ live store integration nếu `LIVE_STORE_TESTS` chưa bật.
- Frontend: `npm run build:frontend` thành công; `git diff --check` đạt.
- UI: kiểm tra 390/768/1280/1440 px, không tràn ngang; Việt/Anh và sáng/tối; các tab analytics, từ khóa, review và AI reply chạy với dữ liệu giả. Console preview không có lỗi.
- Railway: quan sát bundle của commit `d4731b7` là `index-CLH05lpd.js`; điều hướng có đúng ba mục, logo StreetStride tải ảnh thật, tab review CardioFit còn hiển thị review và phản hồi đã có.
- Quy đổi thật đã kiểm tra: StreetStride iOS trong kỳ đang chọn hiện 5,36 USD, tỷ giá GBP → USD ngày 2026-11-01. Đây là quan sát tại thời điểm kiểm tra, không phải fixture hoặc giá trị cố định.
- Chưa xác minh trạng thái SUCCESS qua Railway CLI/platform API trong phiên này; CLI chưa có phiên đăng nhập. Chỉ khẳng định bản mới được quan sát hoạt động trên URL thật.
- Không thử đăng review thật thay người dùng; gửi review chỉ được kiểm thử qua mock/synthetic. Lần thử AI thật chỉ tạo nháp và để nút đăng chưa được duyệt.

## Môi trường và cách chạy lại

- Repo: `/Users/quyen.eth/Desktop/Desktop1/Project/AppRankly`, nhánh `main`.
- Remote: `https://github.com/quyendang/AppRankly.git`.
- Runtime production: Node 22 (Dockerfile). Node mặc định máy local là phiên bản khác; dùng Node 22 khi chạy test SQLite.
- Lệnh test: `npm exec --yes --package node@22 -- node app/test/run.js`. Có thể cần quyền mở server localhost tạm trong sandbox.
- Node 22 đã có local tại `/Users/quyen.eth/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node` (kiểm tra còn tồn tại trước khi dùng).
- Build: `npm run build:frontend`.
- Preview synthetic: `node app/test/preview-server.js`, cổng 3002, mật khẩu demo xem trong chính tệp test. Không dùng credentials thật cho preview.
- Tài liệu triển khai: `DEPLOYMENT.md`; biến mẫu: `.env.example`. Không cần biến môi trường mới cho tỷ giá USD.

## Trở ngại và giới hạn còn lại

- Không có yêu cầu triển khai tính năng nào đang dang dở.
- Báo cáo store có độ trễ; metrics hoặc logo có thể thiếu do nguồn/metadata/quyền. Dữ liệu không hỗ trợ không được suy ra từ installs.
- Tổng USD chỉ tính trên báo cáo hiện có; quy đổi không làm các nguồn chưa đủ thành dữ liệu đầy đủ. Tổng gộp Apple/Google không phải net revenue.
- Không có Docker local để chạy xác minh container/restore volume trong phiên này. Không tự khẳng định kiểm thử redeploy/restore mới ngoài bằng chứng đã ghi.

## Tiếp theo

1. Chờ phản hồi của người dùng về giao diện Chi tiết app và tổng USD; không tự tạo tính năng mới.
2. Nếu có lỗi dữ liệu, đối chiếu app/package, khoảng ngày, trạng thái nguồn và báo cáo thật trước khi đổi công thức. Không yêu cầu người dùng gửi API key.
3. Nếu tiếp tục sửa, đọc checkpoint, kiểm tra git sạch và chạy test/build phù hợp; chỉ thử đăng review thật khi có chỉ dẫn cụ thể của người dùng.

## Lịch sử

| Ngày | Agent | Nội dung |
|---|---|---|
| 2026-11-01 | Codex | `6f88a19`: tự phát hiện app Google, gọn doanh thu nhiều tiền tệ, icon nền tảng. |
| 2026-11-01 | Codex | `4ddda58`: doanh thu subscription Apple/Google, review history và trả lời thủ công/AI có xác nhận đăng. |
| 2026-11-01 | Codex | `898134a`: tạo phản hồi AI một lần bấm, theo ngôn ngữ đánh giá. |
| 2026-11-01 | Codex | `e57cd68`: sửa định dạng JSON và giới hạn token qua proxy; tạo nháp thật trên Railway thành công. |
| 2026-11-01 | Codex | `d4731b7`: gộp ASO vào Chi tiết app, bỏ Nhật ký khỏi UI, logo/nền tảng và tổng USD theo tỷ giá thật. |
| 2026-11-01 | Codex | Lưu checkpoint tổng hợp; các thay đổi tính năng đã commit/push, working tree sạch trước khi tạo PROGRESS.md. |
