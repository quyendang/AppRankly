import Foundation

struct KeywordMarket: Codable, Identifiable, Hashable {
    var id: String { country }
    let country: String
    let language: String

    func label(in locale: Locale) -> String {
        let code = country.uppercased()
        return "\(locale.localizedString(forRegionCode: code) ?? code) · \(language)"
    }
}

struct KeywordOverview: Decodable {
    let market: KeywordMarket
    let markets: [KeywordMarket]
    let keywords: [TrackedKeyword]
}

struct TrackedKeyword: Decodable, Identifiable {
    let id: Int
    let term: String
    let rank: Int?
    let topN: Int?
    let checkedAt: String?
    let attemptedAt: String?
    let status: String

    var position: String {
        switch status {
        case "ranked": rank.map { "#\($0)" } ?? "Chưa rõ hạng"
        case "outside": "Ngoài top \(topN ?? 0)"
        case "no_results": "Không có kết quả"
        case "source_failed": "Lỗi nguồn"
        default: "Chưa kiểm tra"
        }
    }

    var detail: String? {
        if status == "source_failed" {
            if let rank, let checkedAt { return "Hạng đã lưu #\(rank) · \(ReviewDate.display(checkedAt))" }
            if let topN, let checkedAt {
                let previous = topN > 0 ? "Ngoài top \(topN)" : "Không có kết quả"
                return "Đã lưu \(previous.lowercased()) · \(ReviewDate.display(checkedAt))"
            }
            return attemptedAt.map { "Lần thử gần nhất \(ReviewDate.display($0))" }
        }
        return checkedAt.map { ReviewDate.display($0) }
    }
}

struct KeywordHistory: Decodable {
    struct Point: Decodable, Identifiable {
        var id: String { date }
        let date: String
        let rank: Int?
        let topN: Int

        var position: String {
            if let rank { return "#\(rank)" }
            return topN > 0 ? "Ngoài top \(topN)" : "Không có kết quả"
        }
    }

    let id: Int
    let term: String
    let market: KeywordMarket
    let points: [Point]
}

struct RankCheck: Decodable {
    let id: String
    let country: String
    let state: String
    let checked: Int
    let failed: Int
    let error: String?
}

struct RankCheckRequest: Encodable { let country: String }
struct NewKeyword: Encodable { let term: String }
struct SelectedKeywords: Encodable { let terms: [String] }
struct KeywordChange: Decodable { let added: Int }
struct ASOEmptyBody: Encodable {}

struct KeywordSuggestionRequest: Encodable {
    let kind = "keywords"
    let appId: String
    let country: String
    let count: Int
    let locale = "vi"
}

struct KeywordPreview: Decodable {
    struct Payload: Codable {
        struct App: Codable {
            let name: String
            let packageName: String
            let platform: String
        }
        struct Listing: Codable {
            let title: String
            let summary: String
            let description: String
        }

        let app: App
        let kind: String
        let locale: String
        let listing: Listing
        let keywords: [String]
        let market: KeywordMarket
        let limit: Int
        let competitors: [String]
        let maxTermLength: Int
        let instruction: String

        var formattedJSON: String {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            guard let data = try? encoder.encode(self) else { return "" }
            return String(decoding: data, as: UTF8.self)
        }
    }

    let previewId: String
    let destination: ReviewAIPreview.Destination
    let payload: Payload
}

struct KeywordSuggestions: Decodable {
    struct Item: Decodable, Identifiable {
        var id: String { term }
        let term: String
        let reason: String
    }
    let suggestions: [Item]
}

struct PublicStoreListing: Decodable {
    let title: String
    let subtitle: String?
    let description: String?
    let developer: String?
    let rating: Double?
    let storeUrl: URL?
}

struct Competitor: Decodable, Identifiable {
    let id: String
    let title: String
    let rating: Double?
    let pinned: Bool
}
struct Competitors: Decodable { let competitors: [Competitor] }
struct PinCompetitor: Encodable { let competitorId: String }

struct Campaign: Decodable, Identifiable {
    let id: Int
    let name: String
    let source: String
    let path: String
    let clicks: Int
    let createdAt: String?

    func url(origin: String) -> URL? {
        guard path.hasPrefix("/l/"), let host = URL(string: origin) else { return nil }
        let slug = path.dropFirst(3)
        guard !slug.isEmpty, slug.utf8.allSatisfy({ (97...122).contains($0) || (48...57).contains($0) || $0 == 45 })
        else { return nil }
        return host.appending(path: "l").appending(component: String(slug))
    }
}
struct Campaigns: Decodable { let campaigns: [Campaign] }
struct NewCampaign: Encodable {
    let name: String
    let source: String
}

enum ASOMessage {
    static func text(_ error: Error) -> String {
        switch (error as? APIClient.Failure)?.code {
        case "INVALID_KEYWORD": "Nhập từ khóa từ 1 đến 80 ký tự."
        case "INVALID_MARKET": "Thị trường này chưa được hỗ trợ."
        case "KEYWORD_NOT_FOUND": "Từ khóa đã bị xóa khỏi ứng dụng này."
        case "RANK_CHECK_NOT_FOUND": "Lần kiểm tra đã hết hạn. Tải lại danh sách để xem hạng đã lưu."
        case "RANK_CHECK_BUSY": "Máy chủ đang có nhiều lần kiểm tra. Thử lại sau."
        case "RANK_SOURCE_FAILED": "Nguồn tìm kiếm chưa phản hồi. Hạng đã lưu vẫn có thể xem."
        case "LISTING_UNAVAILABLE": "Chưa có thông tin trang store cho ứng dụng này."
        case "COMPETITOR_NOT_FOUND": "Store chưa trả về thông tin đối thủ này."
        case "CAMPAIGN_NOT_FOUND": "Chiến dịch đã bị xóa hoặc thuộc ứng dụng khác."
        case "AI_INVALID_RESPONSE": "Không tìm được gợi ý mới phù hợp. Tạo bản xem trước mới để thử lại."
        default: ReviewMessage.text(error)
        }
    }
}
