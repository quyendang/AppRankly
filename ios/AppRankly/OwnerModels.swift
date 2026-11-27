import Foundation

struct ServerSettings: Decodable, Equatable {
    let timezone: String
    let googlePackages: [String]
    let refreshIntervalHours: Int
    let notificationsEnabled: Bool
    let digest: String
    let digestHour: Int
    let digestLocale: String
    let anomalyThreshold: Int

    var preferences: ServerPreferences {
        .init(refreshIntervalHours: refreshIntervalHours, notificationsEnabled: notificationsEnabled, digest: digest,
              digestHour: digestHour, digestLocale: digestLocale, anomalyThreshold: anomalyThreshold)
    }
}

struct ServerPreferences: Encodable, Equatable {
    var refreshIntervalHours: Int
    var notificationsEnabled: Bool
    var digest: String
    var digestHour: Int
    var digestLocale: String
    var anomalyThreshold: Int
}

struct ManualGooglePackage: Encodable { let packageName: String }

struct Integrations: Decodable {
    struct Connection: Decodable { let configured: Bool }
    struct AI: Decodable {
        struct Provider: Decodable { let available: Bool }
        let defaultProvider: String?
        let providers: [Provider]
    }
    let google: Connection
    let apple: Connection
    let ai: AI
    let notifications: Connection
}

struct SyncStatus: Decodable {
    let status: String
    let lastRun: String?
    let appsChecked: Int?
}

struct SyncJob: Decodable {
    let id: String
    let state: String
    let appsChecked: Int?
}

struct DigestPreview: Decodable {
    let title: String
    let message: String
}

struct DeliveryRequest: Encodable {
    let confirmed = true
    var period: String?
}

struct DeliveryResult: Decodable {
    let channels: [String: String]
    var summary: String {
        let sent = channels.values.filter { $0 == "sent" }.count
        let failed = channels.values.filter { $0 == "failed" }.count
        return AppLanguage.text("Đã gửi đến \(sent) kênh, \(failed) kênh gặp lỗi.")
    }
}

struct NotificationFeed: Decodable {
    let notifications: [MobileNotification]
    let unreadCount: Int
}

struct MobileNotification: Decodable, Identifiable {
    struct Payload: Decodable {
        struct Item: Decodable {
            struct Metric: Decodable {
                let key: String
                let value: Double?
                let previous: Double?
                let change: Double?
                let unit: String?
            }
            let appId: String?
            let name: String
            let term: String?
            let country: String?
            let note: String?
            let tab: String?
            let metrics: [Metric]?
        }
        struct Hint: Decodable {
            let key: String
            let tab: String?
            let appId: String?
        }
        let kind: String
        let items: [Item]?
        let hints: [Hint]?
    }

    let id: String
    let title: String
    let message: String
    let timestamp: String
    let read: Bool?
    let data: Payload?

    var kind: String { data?.kind ?? "system" }
}

struct NotificationRead: Encodable { let id: String? }

struct AppEvents: Decodable {
    struct Event: Decodable, Identifiable {
        let id: String
        let date: String
        let type: String
        let label: String
        let source: String
        var canDelete: Bool { source == "manual" && type == "custom" }
    }
    let events: [Event]
}
struct NewEvent: Encodable {
    let label: String
    let date: String
}

enum OwnerMessage {
    static func text(_ error: Error) -> String {
        switch (error as? APIClient.Failure)?.code {
        case "INVALID_SETTINGS": AppLanguage.text("Kiểm tra lại cài đặt rồi thử lưu.")
        case "INVALID_PACKAGE": AppLanguage.text("Nhập mã gói Google Play hợp lệ, ví dụ com.example.app.")
        case "CONNECTION_FAILED": AppLanguage.text("Không kết nối được với store. Kiểm tra cấu hình trên máy chủ.")
        case "NOTIFICATIONS_DISABLED": AppLanguage.text("Bật gửi thông báo và cấu hình kênh trên máy chủ trước.")
        case "SYNC_NOT_FOUND": AppLanguage.text("Máy chủ đã làm mới phiên đồng bộ. Tải lại trạng thái.")
        case "INVALID_EVENT": AppLanguage.text("Nhập tên sự kiện tối đa 80 ký tự và chọn ngày.")
        default: ASOMessage.text(error)
        }
    }
}
