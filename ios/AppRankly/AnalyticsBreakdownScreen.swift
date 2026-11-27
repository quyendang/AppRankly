import SwiftUI
import Charts

enum AnalyticsBreakdownKind: String, CaseIterable, Identifiable {
    case countries, versions, purchases, releases

    var id: Self { self }

    var title: String {
        switch self {
        case .countries: "Quốc gia"
        case .versions: "Phiên bản"
        case .purchases: "Mua hàng"
        case .releases: "Tác động bản phát hành"
        }
    }

    var icon: String {
        switch self {
        case .countries: "globe"
        case .versions: "square.stack"
        case .purchases: "cart"
        case .releases: "chart.line.uptrend.xyaxis"
        }
    }
}

struct AnalyticsBreakdownScreen: View {
    private enum DataSet {
        case countries(CountryBreakdown)
        case versions(VersionBreakdown)
        case purchases(PurchaseBreakdown)
        case releases(ReleaseBreakdown)
    }

    let session: OwnerSession
    let app: StoreApp
    let range: ReportRange
    let kind: AnalyticsBreakdownKind
    @State private var loader = AnalyticsLoad<DataSet>()
    @State private var exchange: ExchangeRates?

    var body: some View {
        List {
            Section {
                LabeledContent("Ứng dụng", value: app.name)
                if kind != .releases {
                    LabeledContent("Khoảng thời gian", value: range.label)
                }
            }
            if let value = loader.value {
                switch value {
                case .countries(let response):
                    CountryRows(response: response, exchange: exchange, platform: app.platform)
                case .versions(let response):
                    Section("Lượt cài theo phiên bản") {
                        if response.rows.isEmpty {
                            Text("Chưa có báo cáo theo phiên bản.").foregroundStyle(.secondary)
                        }
                        ForEach(response.rows) { row in
                            ReportCountRow(row.label, count: row.installs)
                        }
                    }
                case .purchases(let response):
                    PurchaseSections(response: response, platform: app.platform)
                case .releases(let response):
                    ReleaseSections(response: response)
                }
            }
            AnalyticsStatusRow(error: loader.error, isLoading: loader.isLoading, hasValue: loader.value != nil) {
                await load()
            }
        }
        .navigationTitle(kind.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .task { await loadRates() }
        .refreshable {
            async let report: Void = load()
            async let rates: Void = loadRates()
            _ = await (report, rates)
        }
    }

    private func load() async {
        let path = ["apps", app.id, "analytics", kind.rawValue]
        await loader.fetch {
            switch kind {
            case .countries: .countries(try await session.get(CountryBreakdown.self, at: path, range: range))
            case .versions: .versions(try await session.get(VersionBreakdown.self, at: path, range: range))
            case .purchases: .purchases(try await session.get(PurchaseBreakdown.self, at: path, range: range))
            case .releases: .releases(try await session.get(ReleaseBreakdown.self, at: path))
            }
        }
    }

    private func loadRates() async {
        guard kind == .countries else { return }
        if let result = try? await session.exchangeRates(), !Task.isCancelled { exchange = result }
    }
}

struct CountryRows: View {
    @Environment(\.locale) private var locale
    let response: CountryBreakdown
    let exchange: ExchangeRates?
    let platform: StorePlatform

    var body: some View {
        Section {
            if response.rows.isEmpty {
                Text("Chưa có báo cáo theo quốc gia.").foregroundStyle(.secondary)
            }
            if response.installStatus == "unavailable" {
                Text("Chưa tải được báo cáo lượt cài.").foregroundStyle(.secondary)
            }
            if let status = response.revenueStatus, status != "available" {
                Text(status == "partial" ? "Báo cáo doanh thu mới có một phần." : "Chưa tải được báo cáo doanh thu.")
                    .foregroundStyle(.secondary)
            }
            let allInstalls = AnalyticsReport.total(response.rows.map(\.installs))
            ForEach(response.rows.sorted(by: { ($0.installs ?? Int.min) > ($1.installs ?? Int.min) })) { row in
                let name = locale.localizedString(forRegionCode: row.country) ?? row.country
                DisclosureGroup {
                    ReportCountRow("Lượt cài", count: row.installs)
                    if let installs = row.installs, let allInstalls, allInstalls > 0 {
                        LabeledContent("Tỷ lệ lượt cài", value: (Double(installs) / Double(allInstalls))
                            .formatted(.percent.precision(.fractionLength(1))))
                    }
                    CurrencyRows(amounts: row.revenueByCurrency)
                    if !row.revenueByCurrency.isEmpty {
                        let usd = ExchangeRates.convert(row.revenueByCurrency, using: exchange)
                        if let total = usd.total {
                            LabeledContent("Ước tính USD", value: total.formatted(.currency(code: "USD")))
                            if let installs = row.installs, installs > 0 {
                                LabeledContent("USD trên mỗi lượt cài", value: (total / Double(installs))
                                    .formatted(.number.precision(.fractionLength(3))))
                            }
                        } else {
                            Text("Thiếu tỷ giá cho \(usd.missing.joined(separator: ", ")).")
                                .foregroundStyle(.secondary)
                        }
                    }
                } label: {
                    ReportCountRow(name, count: row.installs)
                }
            }
        } header: {
            Text("Lượt cài và doanh thu")
        } footer: {
            Text("\(platform.revenueBasis). Số USD quy đổi theo \(exchange?.source ?? "Frankfurter").")
        }
    }
}

struct PurchaseSections: View {
    let response: PurchaseBreakdown
    let platform: StorePlatform

    var body: some View {
        if response.available, let purchases = response.purchases {
            Section {
                ForEach(["iap", "subscription"], id: \.self) { kind in
                    if let total = purchases.totals[kind] {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(productKind(kind)).font(.headline)
                            ReportCountRow("Lượt mua", count: total.purchases)
                            ReportCountRow("Lượt hoàn tiền", count: total.refunds)
                        }
                    }
                }
            } header: {
                Text("Tổng giao dịch")
            } footer: {
                Text(platform.revenueBasis)
            }
            if !purchases.daily.isEmpty {
                Section("Giao dịch theo ngày") {
                    Chart(purchases.daily) { day in
                        if let date = ReportRange.date(day.date) {
                            ForEach([("Mua trong app", day.iap), ("Đăng ký", day.subscription), ("Hoàn tiền", day.refunds)], id: \.0) { kind, count in
                                BarMark(x: .value("Ngày", date, unit: .day), y: .value("Giao dịch", count))
                                    .foregroundStyle(by: .value("Loại", kind))
                                    .position(by: .value("Loại", kind))
                            }
                        }
                    }
                    .frame(height: 165)
                    .environment(\.timeZone, ReportRange.timeZone)
                    .accessibilityLabel("Lượt mua và hoàn tiền theo ngày")
                }
            }
            Section("Theo sản phẩm") {
                if purchases.products.isEmpty {
                    Text("Không có giao dịch sản phẩm trong báo cáo đã nhận.").foregroundStyle(.secondary)
                }
                ForEach(purchases.products) { product in
                    DisclosureGroup {
                        ReportCountRow("Lượt mua", count: product.purchases)
                        ReportCountRow("Lượt hoàn tiền", count: product.refunds)
                        CurrencyRows(amounts: product.revenueByCurrency)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(product.title.isEmpty ? (product.sku.isEmpty ? "Sản phẩm chưa có tên" : product.sku) : product.title)
                            Text(productKind(product.kind)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        } else {
            Section("Mua hàng") {
                Text("Chưa có báo cáo giao dịch.").foregroundStyle(.secondary)
            }
        }
    }

    private func productKind(_ kind: String) -> String { kind == "iap" ? "Mua trong app" : "Đăng ký" }
}

struct ReleaseSections: View {
    let response: ReleaseBreakdown

    var body: some View {
        Section {
            if response.releases.isEmpty {
                Text("Chưa đủ dữ liệu để so sánh quanh ngày phát hành.").foregroundStyle(.secondary)
            }
            ForEach(response.releases) { version in
                DisclosureGroup {
                    LabeledContent("Lượt cài mỗi ngày trước phát hành", value: average(version.before))
                    LabeledContent("Lượt cài mỗi ngày sau phát hành", value: average(version.after))
                    LabeledContent("Thay đổi lượt cài", value: change(version.change))
                    LabeledContent("Thay đổi doanh thu trên mỗi lượt cài", value: change(version.rpiChange))
                    ReportCountRow("Review từ ngày phát hành", count: version.reviews)
                    ReportCountRow("Review 1–2 sao", count: version.low)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(version.label)
                        Text("\(ReportRange.display(version.date)) · \(version.days) ngày sau phát hành")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        } header: {
            Text("So sánh trước và sau")
        } footer: {
            Text("So sánh 7 ngày trước với tối đa 7 ngày từ ngày phát hành.")
        }
    }

    private func average(_ value: Double?) -> String {
        value?.formatted(.number.precision(.fractionLength(1))) ?? "Chưa có dữ liệu"
    }

    private func change(_ value: Double?) -> String {
        value.map { ($0 / 100).formatted(.percent.precision(.fractionLength(1))) } ?? "Chưa có dữ liệu"
    }
}
