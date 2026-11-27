import Foundation
import Observation

@MainActor
@Observable
final class AnalyticsLoad<Value> {
    private(set) var value: Value?
    private(set) var error: String?
    private(set) var isLoading = false
    private var request = UUID()

    func fetch(_ operation: () async throws -> Value) async {
        let id = UUID()
        request = id
        error = nil
        isLoading = true
        defer { if request == id { isLoading = false } }
        do {
            let next = try await operation()
            guard !Task.isCancelled, request == id else { return }
            value = next
        } catch {
            guard !Task.isCancelled, !(error is CancellationError), request == id else { return }
            let failure = error as? APIClient.Failure
            switch failure?.code {
            case "NO_REPORTS": self.error = "Chưa có báo cáo trong khoảng ngày này."
            case "APP_NOT_FOUND": self.error = "Ứng dụng này không còn trong danh mục."
            case "RATE_LIMIT": self.error = "Máy chủ đang giới hạn yêu cầu. Thử lại sau ít phút."
            default: self.error = "Không tải được dữ liệu. Kiểm tra kết nối rồi thử lại."
            }
        }
    }
}
