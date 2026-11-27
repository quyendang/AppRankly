import SwiftUI

struct AppAnalyticsScreen: View {
    let session: OwnerSession
    let app: StoreApp

    @State private var period: AnalyticsPeriod
    @State private var loader = AnalyticsLoad<AnalyticsReport>()
    @State private var events: [AppEvents.Event] = []
    @State private var exchange: ExchangeRates?

    init(session: OwnerSession, app: StoreApp, period: AnalyticsPeriod) {
        self.session = session
        self.app = app
        _period = State(initialValue: period)
    }

    var body: some View {
        List {
            Section {
                HStack(spacing: 12) {
                    AnalyticsAppIcon(app: app, session: session)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(app.platform.title)
                            .font(.headline)
                        if let version = app.version { Text("Phiên bản \(version)").font(.subheadline) }
                        if let rating = app.rating {
                            Label(rating.formatted(.number.precision(.fractionLength(1))), systemImage: "star.fill")
                                .font(.subheadline)
                                .accessibilityLabel("\(rating.formatted(.number.precision(.fractionLength(1)))) sao")
                        }
                    }
                }
                AnalyticsPeriodPicker(selection: $period)
            }
            if let report = loader.value, report.range == period.range, let current = report.current.first {
                Section {
                    InstallTotal(current: [current], previous: report.previous)
                    InstallsChart(report: report, current: [current], previous: report.previous, events: events)
                } header: {
                    Text("Lượt cài theo ngày")
                } footer: {
                    Text(report.range.label)
                }
                RevenueSummarySection(reports: [current], exchange: exchange)
                Section("Độ phủ dữ liệu") {
                    ReportCountRow("Gỡ cài đặt", count: current.subtotal(\.uninstalls))
                    ReportCountRow("Lượt nâng cấp", count: current.subtotal(\.upgrades))
                    ReportCountRow("Thiết bị đang hoạt động", count: current.activeDevices)
                    LabeledContent("Tỷ lệ giữ chân", value: current.retention?.formatted(.percent) ?? "Chưa có dữ liệu")
                    LabeledContent("Ngày báo cáo gần nhất", value: current.lastDate.map { ReportRange.display($0) } ?? "Chưa có dữ liệu")
                }
                SourceWarningsSection(warnings: report.warnings, reports: [current], range: report.range)
            }
            Section("Quản lý store") {
                NavigationLink {
                    ReviewListScreen(session: session, appId: app.id)
                } label: {
                    Label("Review", systemImage: "bubble.left")
                }
            }
            Section("ASO") {
                NavigationLink {
                    KeywordsScreen(session: session, appId: app.id)
                } label: {
                    Label("Từ khóa", systemImage: "magnifyingglass")
                }
            }
            Section("Báo cáo chi tiết") {
                NavigationLink {
                    AppEventsScreen(session: session, app: app)
                } label: {
                    Label("Sự kiện", systemImage: "calendar")
                }
                ForEach(AnalyticsBreakdownKind.allCases) { kind in
                    NavigationLink {
                        AnalyticsBreakdownScreen(session: session, app: app, range: period.range, kind: kind)
                    } label: {
                        Label(kind.title, systemImage: kind.icon)
                    }
                }
            }
            AnalyticsStatusRow(error: loader.error, isLoading: loader.isLoading, hasValue: loader.value?.range == period.range) {
                await load()
            }
        }
        .navigationTitle(app.name)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: period) { await load() }
        .task { await loadRates() }
        .onAppear { Task { await loadEvents() } }
        .refreshable {
            async let report: Void = load()
            async let rates: Void = loadRates()
            async let events: Void = loadEvents()
            _ = await (report, rates, events)
        }
    }

    private func load() async {
        let range = period.range
        await loader.fetch { try await session.get(AnalyticsReport.self, at: ["apps", app.id, "analytics"], range: range) }
    }

    private func loadEvents() async {
        if let result = try? await session.get(AppEvents.self, at: ["apps", app.id, "events"]) {
            events = result.events
        }
    }

    private func loadRates() async {
        if let result = try? await session.exchangeRates(), !Task.isCancelled { exchange = result }
    }
}

struct ReportCountRow: View {
    let title: String
    let count: Int?

    init(_ title: String, count: Int?) {
        self.title = title
        self.count = count
    }

    var body: some View {
        LabeledContent(title, value: count?.formatted() ?? "Chưa có dữ liệu")
            .monospacedDigit()
    }
}
