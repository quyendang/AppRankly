import SwiftUI

struct OverviewScreen: View {
    let session: OwnerSession

    @State private var period = AnalyticsPeriod.month
    @State private var selectedApp = ""
    @State private var loader = AnalyticsLoad<AnalyticsReport>()
    @State private var exporting = false
    @State private var exchange: ExchangeRates?

    var body: some View {
        List {
            Section {
                AnalyticsPeriodPicker(selection: $period)
                if let report = loader.value, !report.current.isEmpty {
                    Picker("Ứng dụng", selection: $selectedApp) {
                        Text("Tất cả ứng dụng").tag("")
                        ForEach(report.current) { Text($0.app.name).tag($0.id) }
                    }
                }
            }

            if let report = loader.value, report.range == period.range {
                let current = scoped(report.current)
                let previous = scoped(report.previous)
                if !current.isEmpty {
                    Section {
                        InstallTotal(current: current, previous: previous)
                        InstallsChart(report: report, current: current, previous: previous)
                    } header: {
                        Text("Lượt cài theo ngày")
                    } footer: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(report.range.label)
                            if let latest = current.compactMap(\.lastDate).max() {
                                Text("Báo cáo mới nhất \(ReportRange.display(latest))")
                            }
                        }
                    }
                    RevenueSummarySection(reports: current, exchange: exchange)
                    Section("Theo ứng dụng") {
                        ForEach(current) { item in
                            NavigationLink {
                                AppAnalyticsScreen(session: session, app: item.app, period: period)
                            } label: {
                                AnalyticsAppRow(app: item.app, session: session, installs: item.installs, hasReport: true)
                            }
                        }
                    }
                } else {
                    ContentUnavailableView("Chưa có ứng dụng", systemImage: "square.grid.2x2",
                        description: Text("Kiểm tra kết nối store và danh mục trên AppRankly web."))
                }
                SourceWarningsSection(warnings: report.warnings, reports: current, range: report.range)
            }
            InboxSection(session: session, period: period, selectedApp: selectedApp)
            AnalyticsStatusRow(error: loader.error, isLoading: loader.isLoading, hasValue: loader.value?.range == period.range) {
                await load()
            }
        }
        .navigationTitle("Thống kê")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button("Xuất báo cáo", systemImage: "square.and.arrow.up") { exporting = true }
                    .disabled(loader.value?.current.isEmpty != false)
                NavigationLink {
                    NotificationsScreen(session: session)
                } label: {
                    Label("Thông báo", systemImage: "bell")
                }
                NavigationLink {
                    SettingsView(session: session)
                } label: {
                    Label("Cài đặt", systemImage: "gearshape").labelStyle(.iconOnly)
                }
            }
        }
        .sheet(isPresented: $exporting) {
            ExportReportSheet(session: session, range: period.range, appId: selectedApp)
        }
        .onChange(of: session.catalogGeneration) { Task { await load() } }
        .task(id: period) { await load() }
        .task { await loadRates() }
        .refreshable {
            async let report: Void = load()
            async let rates: Void = loadRates()
            _ = await (report, rates)
        }
    }

    private func scoped(_ reports: [AnalyticsReport.AppReport]) -> [AnalyticsReport.AppReport] {
        selectedApp.isEmpty ? reports : reports.filter { $0.id == selectedApp }
    }

    private func load() async {
        let range = period.range
        await loader.fetch { try await session.get(AnalyticsReport.self, at: ["overview"], range: range) }
        if let value = loader.value, !value.current.contains(where: { $0.id == selectedApp }) {
            selectedApp = ""
        }
    }

    private func loadRates() async {
        if let result = try? await session.exchangeRates(), !Task.isCancelled { exchange = result }
    }
}

struct InstallTotal: View {
    let current: [AnalyticsReport.AppReport]
    let previous: [AnalyticsReport.AppReport]

    var body: some View {
        let total = AnalyticsReport.total(current.map(\.installs))
        let before = AnalyticsReport.total(previous.map(\.installs))
        let sameApps = Set(current.filter { $0.installs != nil }.map(\.id))
            == Set(previous.filter { $0.installs != nil }.map(\.id))
        VStack(alignment: .leading, spacing: 4) {
            if let total {
                Text(total, format: .number)
                    .font(.title2.weight(.semibold))
                    .monospacedDigit()
                if let before, before > 0, sameApps {
                    let percent = Double(total) / Double(before) - 1
                    Text("\(percent.formatted(.percent.precision(.fractionLength(1)).sign(strategy: .always(includingZero: false)))) so với kỳ trước")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            if current.contains(where: { $0.installs == nil }) && total != nil {
                Text("Lượt cài chỉ gồm các app đã có báo cáo.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
