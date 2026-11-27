import Foundation

enum ReviewFilter: String, CaseIterable, Identifiable {
    case all, unanswered, answered
    var id: Self { self }
    var title: String {
        switch self {
        case .all: "Tất cả"
        case .unanswered: "Chưa trả lời"
        case .answered: "Đã trả lời"
        }
    }
}

struct MobileReview: Decodable, Identifiable {
    var key: String { "\(app.id)|\(id)" }
    let app: StoreApp
    let id: String
    let author: String?
    let text: String
    let rating: Int?
    let date: String?
    let territory: String?
    let source: String
    let canReply: Bool
    let replyText: String?
    let replyDate: String?
    let replyState: String
    let revision: String
    let replyLimit: Int

    var displayAuthor: String { author ?? "Người dùng" }
    var statusTitle: String {
        switch replyState {
        case "pending": "Chờ hiển thị"
        case "published": "Đã trả lời"
        default: "Chưa trả lời"
        }
    }
}

struct ReviewSource: Decodable, Identifiable {
    var id: String { appId }
    let appId: String
    let status: String
    let checkedAt: String?
}

struct ReviewPage: Decodable {
    let reviews: [MobileReview]
    let sources: [ReviewSource]
    let nextCursor: String?
}

struct ReviewSources: Decodable { let sources: [ReviewSource] }
struct ReviewResponse: Decodable { let review: MobileReview }
struct ReviewDetailResponse: Decodable {
    let review: MobileReview
    let source: ReviewSource
}
struct ReviewRefresh: Encodable { let appId: String? }

struct ReviewWrite: Encodable {
    let reviewId: String
    let text: String
    let expectedRevision: String
    let operationId = UUID()
    let confirmed = true

    init(_ review: MobileReview, text: String) {
        reviewId = review.id
        expectedRevision = review.revision
        self.text = text
    }
}
struct ReviewDraftRecord {
    let text: String
    let attempts: [ReviewWrite]
}
struct ReviewBulk: Encodable {
    let items: [ReviewWrite]
    let confirmed = true
}
struct ReviewBulkResponse: Decodable {
    struct Item: Decodable {
        let reviewId: String?
        let review: MobileReview?
        let error: String?
    }
    let results: [Item]
}

struct ReviewTemplate: Decodable, Identifiable {
    let id: Int
    let name: String
    let body: String

    func rendered(for review: MobileReview) -> String {
        body.replacing("{name}", with: review.displayAuthor)
            .replacing("{rating}", with: review.rating.map(String.init) ?? "")
            .replacing("{app}", with: review.app.name)
    }
}
struct ReviewTemplates: Decodable { let templates: [ReviewTemplate] }
struct NewReviewTemplate: Encodable {
    let name: String
    let body: String
}
struct ReviewMutation: Decodable { let success: Bool }

struct ReviewAIRequest: Encodable {
    let kind = "reviewReply"
    let appId: String
    let reviewId: String
}
struct ReviewAIPreview: Decodable {
    struct Destination: Decodable {
        let provider: String
        let origin: String?
        let model: String?
    }
    struct Payload: Decodable {
        struct Content: Decodable {
            let text: String
            let rating: Int?
            let language: String?
        }
        let app: String
        let review: Content
        let replyLimit: Int
        let instruction: String
    }
    let previewId: String
    let destination: Destination
    let payload: Payload
}
struct ReviewAIConfirmation: Encodable {
    let previewId: String
    let confirmed = true
}
struct ReviewAIResult: Decodable { let text: String }

struct InboxResponse: Decodable {
    let tasks: [InboxTask]
}
struct InboxTask: Decodable, Identifiable {
    struct Sample: Decodable { let id: String }
    struct Anomaly: Decodable {
        let change: Double
        let term: String?
        let country: String?
        let from: Int?
        let to: Int?
    }

    var id: String { key }
    let key: String
    let kind: String
    let app: StoreApp
    let count: Int?
    let sample: Sample?
    let lastDate: String?
    let anomaly: Anomaly?

    var label: String {
        switch kind {
        case "lowReview": "\(count ?? 0) review 1–2 sao chưa trả lời"
        case "reviews": "\(count ?? 0) review chưa trả lời"
        case "lag": "Báo cáo đến chậm"
        case "source": "Lỗi nguồn báo cáo"
        case "rankDrop", "rankRise": anomaly?.term ?? "Thứ hạng từ khóa thay đổi"
        case "revenueDrop", "revenueSpike": "Doanh thu biến động"
        default: "Lượt cài biến động"
        }
    }

    var symbol: String {
        switch kind {
        case "lowReview", "reviews": "bubble.left"
        case "source", "lag": "exclamationmark.circle"
        case "rankDrop", "rankRise": "magnifyingglass"
        case "revenueDrop", "revenueSpike": "dollarsign.circle"
        default: "chart.bar"
        }
    }
}

enum ReviewMessage {
    static func isUncertain(_ code: String?) -> Bool {
        ["REVIEW_REPLY_UNCERTAIN", "REVIEW_REPLY_IN_PROGRESS", "OPERATION_FAILED"].contains(code ?? "")
    }

    static func text(_ code: String?) -> String {
        switch code {
        case "REVIEW_REPLY_CONFLICT": "Review hoặc phản hồi đã thay đổi trên store. Mở lại review và kiểm tra trước khi gửi."
        case "REVIEW_REPLY_NOT_VERIFIED": "Không tìm thấy phản hồi này trên store. Tải lại review trước khi xác nhận gửi mới."
        case "REVIEW_REPLY_UNCERTAIN", "REVIEW_REPLY_IN_PROGRESS": "Chưa xác minh được kết quả. Kiểm tra lại để xem store đã nhận phản hồi chưa."
        case "REVIEWS_PERMISSION_REQUIRED": "Store chưa cấp quyền trả lời review này."
        case "REVIEW_NOT_FOUND": "Không tìm thấy review. Hãy tải lại danh sách."
        case "AI_NOT_CONFIGURED": "Máy chủ chưa có nhà cung cấp AI."
        case "PREVIEW_REQUIRED": "Bản xem trước đã hết hạn. Tạo bản xem trước mới để tiếp tục."
        case "INVALID_REVIEW_REPLY", "INVALID_INPUT": "Kiểm tra nội dung và giới hạn ký tự rồi thử lại."
        default: "Không hoàn tất được thao tác. Kiểm tra kết nối rồi thử lại."
        }
    }

    static func text(_ error: Error) -> String { text((error as? APIClient.Failure)?.code) }
}
