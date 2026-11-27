# AppRankly iPhone

Ứng dụng SwiftUI cho iOS 26 trở lên, triển khai theo [mẫu A. Tổng quan](../designs/apprankly-ios/KE-HOACH.md).

## Chạy ứng dụng

1. Chạy backend AppRankly có router mobile mới và migration 011. Dùng riêng một môi trường thử nếu cần xác minh trước khi cập nhật máy chủ cá nhân.
2. Mở `AppRankly.xcodeproj` trong Xcode. Chọn simulator iOS 26 trở lên hoặc cấu hình Signing & Capabilities cho iPhone đã đăng ký.
3. Đăng nhập bằng origin HTTPS của backend, ví dụ `https://apprankly.example.com`, và mật khẩu owner hiện tại. Khi chạy simulator từ bản Debug, có thể dùng `http://localhost:3000` với backend local chạy ở chế độ phát triển.

Batch 1 có phiên thiết bị và đăng xuất trong Cài đặt. Batch 2 có tab Thống kê và Ứng dụng. Chọn kỳ 7, 30 hoặc 90 ngày, lọc theo app, rồi mở chi tiết quốc gia, phiên bản, mua hàng và tác động bản phát hành.

Batch 3 bổ sung tab Review và mục Cần xử lý trên Thống kê. Bấm **Làm mới** để cập nhật kho review từ store. Để trả lời hàng loạt, chọn một ứng dụng trước rồi chọn các review được phép trả lời. Mẫu phản hồi dùng chung với web. Bỏ qua một việc chỉ áp dụng trên thiết bị hiện tại. Bản nháp và lần gửi chưa rõ được giữ trong phiên chạy của app, gồm lúc cần đăng nhập lại.

Batch 4 nối tab **Từ khóa**. Chọn ứng dụng và thị trường để xem hạng và lịch sử 90 ngày. Hạng lấy từ tìm kiếm công khai của store. Mỗi lần kiểm tra tối đa 20 từ, ưu tiên từ chưa kiểm tra hoặc kiểm tra lâu nhất. Gợi ý bằng AI có bước duyệt dữ liệu gửi và bước chọn từ để theo dõi. Trang store, đối thủ và liên kết chiến dịch nằm trong mục ASO. [Hợp đồng API mobile](../app/openapi/mobile-v1.yml).

Access token hết hạn sau tối đa 15 phút. Refresh token có hạn tối đa 30 ngày kể từ lúc đăng nhập và đổi sau mỗi lần sử dụng. Khi phản hồi xoay token thất lạc sau khi server đã ghi kết quả, thiết bị có thể phải đăng nhập lại. Nút Đổi máy chủ ở trạng thái mất kết nối xóa phiên cục bộ. Phiên cũ trên máy chủ vẫn tuân theo hạn của nó nếu máy chủ chưa xác nhận đăng xuất.
