import Foundation

enum StorePlatform: String, Decodable {
    case apple, google

    var title: String {
        switch self {
        case .apple: "App Store"
        case .google: "Google Play"
        }
    }

    var revenueBasis: String {
        switch self {
        case .apple: AppLanguage.text("Khoản thu ước tính của nhà phát triển")
        case .google: AppLanguage.text("Tổng tiền người mua trả, gồm thuế")
        }
    }
}

struct StoreApp: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    let platform: StorePlatform
    let packageName: String
    let rating: Double?
    let version: String?
    let storeUrl: URL?
    let iconAvailable: Bool
    let metadataError: String?
}

struct SourceWarning: Decodable, Hashable {
    let platform: StorePlatform
    let error: String
}

struct AppCatalog: Decodable {
    let apps: [StoreApp]
    let warnings: [SourceWarning]
}

struct ReportRange: Codable, Equatable, Hashable {
    let startDate: String
    let endDate: String

    var query: [URLQueryItem] { [.init(name: "from", value: startDate), .init(name: "to", value: endDate)] }
    var label: String { "\(Self.display(startDate)) đến \(Self.display(endDate))" }

    static let timeZone = TimeZone(secondsFromGMT: 0) ?? .current

    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        return calendar
    }

    static func recent(_ days: Int) -> Self {
        // Match web: the range ends yesterday in the device's local calendar.
        let now = Date.now
        var local = Calendar(identifier: .gregorian)
        local.timeZone = .current
        let date = local.dateComponents([.year, .month, .day], from: now)
        let today = calendar.date(from: date) ?? now
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        return Self(
            startDate: formatter.string(from: today.addingTimeInterval(Double(-days) * 86400)),
            endDate: formatter.string(from: today.addingTimeInterval(-86400))
        )
    }

    static func localDay(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    static func date(_ value: String) -> Date? {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    static func display(_ value: String) -> String {
        guard let date = date(value) else { return value }
        var style = Date.FormatStyle(date: .numeric, time: .omitted)
        style.timeZone = timeZone
        return date.formatted(style)
    }
}

struct AnalyticsReport: Decodable {
    struct AppReport: Decodable, Identifiable {
        struct Revenue: Decodable {
            let status: String
            let byCurrency: [String: Double]
        }

        struct Day: Decodable {
            let date: String
            let installs: Int?
            let uninstalls: Int?
            let upgrades: Int?
        }

        var id: String { app.id }
        let app: StoreApp
        let installs: Int?
        let activeDevices: Int?
        let retention: Double?
        let lastDate: String?
        let error: String?
        let revenue: Revenue
        let daily: [Day]

        func subtotal(_ metric: KeyPath<Day, Int?>) -> Int? {
            AnalyticsReport.total(daily.map { $0[keyPath: metric] })
        }
    }

    let range: ReportRange
    let previousRange: ReportRange
    let generatedAt: String
    let warnings: [SourceWarning]
    let current: [AppReport]
    let previous: [AppReport]

    static func total(_ values: [Int?]) -> Int? {
        let known = values.compactMap { $0 }
        return known.isEmpty ? nil : known.reduce(0, +)
    }
}

struct ExchangeRates: Decodable {
    struct Rate: Decodable {
        let rate: Double
        let date: String?
    }

    let rates: [String: Rate]
    let source: String
    let status: String

    static func convert(_ amounts: [String: Double], using exchange: Self?) -> (total: Double?, missing: [String]) {
        var total = 0.0
        var missing: [String] = []
        for (currency, amount) in amounts where amount != 0 {
            if currency == "USD" {
                total += amount
            } else if let rate = exchange?.rates[currency]?.rate, rate > 0 {
                total += amount * rate
            } else {
                missing.append(currency)
            }
        }
        return (missing.isEmpty ? total : nil, missing.sorted())
    }
}

struct CountryBreakdown: Decodable {
    struct Row: Decodable, Identifiable {
        var id: String { country }
        let country: String
        let installs: Int?
        let revenueByCurrency: [String: Double]
    }
    let rows: [Row]
    let installStatus: String?
    let revenueStatus: String?
}

struct VersionBreakdown: Decodable {
    struct Row: Decodable, Identifiable {
        var id: String { label }
        let label: String
        let installs: Int?
    }
    let rows: [Row]
}

struct PurchaseBreakdown: Decodable {
    struct Purchases: Decodable {
        struct Day: Decodable, Identifiable {
            var id: String { date }
            let date: String
            let iap: Int
            let subscription: Int
            let refunds: Int
        }
        struct Product: Decodable, Identifiable {
            var id: String { "\(kind):\(sku)" }
            let kind: String
            let sku: String
            let title: String
            let purchases: Int
            let refunds: Int
            let revenueByCurrency: [String: Double]
        }
        struct Total: Decodable {
            let purchases: Int
            let refunds: Int
            let revenueByCurrency: [String: Double]
        }
        let daily: [Day]
        let products: [Product]
        let totals: [String: Total]
    }

    let available: Bool
    let purchases: Purchases?
}

struct ReleaseBreakdown: Decodable {
    struct Release: Decodable, Identifiable {
        let id: String
        let date: String
        let label: String
        let days: Int
        let before: Double?
        let after: Double?
        let change: Double?
        let rpiChange: Double?
        let reviews: Int
        let low: Int
    }

    let releases: [Release]
}
