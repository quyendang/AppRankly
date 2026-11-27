import SwiftUI
import Charts

enum AnalyticsPeriod: Int, CaseIterable, Identifiable {
    case week = 7
    case month = 30
    case quarter = 90

    var id: Int { rawValue }
    var label: String { "\(rawValue) ngày" }
    var range: ReportRange { .recent(rawValue) }
}

struct AnalyticsPeriodPicker: View {
    @Binding var selection: AnalyticsPeriod

    var body: some View {
        Picker("Khoảng thời gian", selection: $selection) {
            ForEach(AnalyticsPeriod.allCases) { option in
                Text(option.label).tag(option)
            }
        }
        .pickerStyle(.segmented)
        .accessibilityLabel("Khoảng thời gian")
    }
}

struct AnalyticsAppIcon: View {
    let app: StoreApp
    let session: OwnerSession
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Image(systemName: "app.fill")
                    .font(.title2)
                    .foregroundStyle(.tint)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(.quaternary)
            }
        }
        .frame(width: 40, height: 40)
        .clipShape(.rect(cornerRadius: 10))
        .accessibilityHidden(true)
        .task(id: app.id) {
            image = nil
            guard app.iconAvailable, let data = try? await session.icon(for: app), !Task.isCancelled else { return }
            image = UIImage(data: data)
        }
    }
}

struct AnalyticsStatusRow: View {
    let error: String?
    let isLoading: Bool
    let hasValue: Bool
    let retry: () async -> Void

    var body: some View {
        if isLoading || (!hasValue && error == nil) {
            ProgressView(hasValue ? "Đang cập nhật…" : "Đang tải…")
        } else if let error {
            Label(error, systemImage: "exclamationmark.circle")
                .foregroundStyle(.secondary)
            Button("Thử lại") { Task { await retry() } }
        }
    }
}

struct InstallsChart: View {
    private struct Point: Identifiable {
        let date: Date
        let value: Int
        let period: String
        let segment: String

        var id: String { "\(segment):\(date.timeIntervalSince1970)" }
    }

    let report: AnalyticsReport
    let current: [AnalyticsReport.AppReport]
    let previous: [AnalyticsReport.AppReport]

    private func points(_ apps: [AnalyticsReport.AppReport], from range: ReportRange, alignedTo offset: Date, name: String) -> [Point] {
        guard let start = ReportRange.date(range.startDate), let end = ReportRange.date(range.endDate) else { return [] }
        var totals: [String: Int] = [:]
        for app in apps {
            for day in app.daily {
                if let installs = day.installs {
                    totals[day.date, default: 0] += installs
                }
            }
        }
        let measured = totals.compactMap { key, value -> (Date, Int)? in
            guard let date = ReportRange.date(key), start...end ~= date else { return nil }
            return (date, value)
        }.sorted { $0.0 < $1.0 }

        var points: [Point] = []
        var segment = 0
        var last: Date?
        for (date, value) in measured {
            if let last, date.timeIntervalSince(last) > 86400 { segment += 1 }
            points.append(.init(date: offset.addingTimeInterval(date.timeIntervalSince(start)), value: value,
                period: name, segment: "\(name)-\(segment)"))
            last = date
        }
        return points
    }

    var body: some View {
        if let start = ReportRange.date(report.range.startDate),
           let end = ReportRange.date(report.range.endDate) {
            let data = points(current, from: report.range, alignedTo: start, name: "Kỳ này")
                + points(previous, from: report.previousRange, alignedTo: start, name: "Kỳ trước")
            if data.isEmpty {
                Text("Chưa có dữ liệu lượt cài.")
                    .foregroundStyle(.secondary)
            } else {
                Chart(data) { point in
                    LineMark(x: .value("Ngày", point.date), y: .value("Lượt cài", point.value),
                             series: .value("Đoạn dữ liệu", point.segment))
                        .foregroundStyle(by: .value("Kỳ", point.period))
                        .lineStyle(.init(lineWidth: 2, dash: point.period == "Kỳ trước" ? [5, 4] : []))
                    PointMark(x: .value("Ngày", point.date), y: .value("Lượt cài", point.value))
                        .foregroundStyle(by: .value("Kỳ", point.period))
                        .symbolSize(9)
                }
                .chartXScale(domain: start...max(end, start.addingTimeInterval(86400)))
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: 4)) {
                        AxisValueLabel(format: .dateTime.day().month(.defaultDigits))
                    }
                }
                .chartForegroundStyleScale(["Kỳ này": Color("AccentColor"), "Kỳ trước": Color.secondary])
                .frame(height: 160)
                .environment(\.timeZone, ReportRange.timeZone)
                .accessibilityLabel("Lượt cài theo ngày")
                .accessibilityHint("Đường nét đứt là ngày tương ứng của kỳ trước.")
            }
        }
    }
}

struct RevenueSummarySection: View {
    let reports: [AnalyticsReport.AppReport]
    let exchange: ExchangeRates?

    var body: some View {
        Section("Doanh thu") {
            let amounts = combined(reports)
            let result = ExchangeRates.convert(amounts, using: exchange)
            let available = reports.contains { $0.revenue.status != "unavailable" }
            if let converted = result.total, available {
                LabeledContent("Ước tính USD", value: converted.formatted(.currency(code: "USD")))
                if amounts.keys.contains(where: { $0 != "USD" }), let exchange {
                    let dates = Set(amounts.keys.compactMap { exchange.rates[$0]?.date }).sorted()
                    Text("Tỷ giá \(exchange.source)\(exchange.status == "stale" ? " (đã lưu)" : "")\(dates.last.map { ", gần nhất \(ReportRange.display($0))" } ?? "").")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            } else if !result.missing.isEmpty {
                Text("Thiếu tỷ giá USD cho \(result.missing.joined(separator: ", ")).")
                    .foregroundStyle(.secondary)
            } else {
                Text("Chưa có báo cáo doanh thu.")
                    .foregroundStyle(.secondary)
            }
            if reports.contains(where: { $0.revenue.status != "available" }), available {
                Text("Tổng chỉ gồm các báo cáo đã nhận.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if Set(reports.map(\.app.platform)).count > 1 {
                Text("Hai store dùng cách tính doanh thu khác nhau.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            ForEach([StorePlatform.apple, .google], id: \.self) { platform in
                let group = reports.filter { $0.app.platform == platform }
                if !group.isEmpty {
                    DisclosureGroup(platform.title) {
                        Text(platform.revenueBasis)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        CurrencyRows(amounts: combined(group))
                        if group.allSatisfy({ $0.revenue.status == "unavailable" }) {
                            Text("Chưa có báo cáo doanh thu.")
                                .foregroundStyle(.secondary)
                        } else if combined(group).isEmpty {
                            Text("Doanh thu bằng 0 trong phần báo cáo đã nhận.")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
    }

    private func combined(_ group: [AnalyticsReport.AppReport]) -> [String: Double] {
        group.reduce(into: [:]) { total, app in total.merge(app.revenue.byCurrency, uniquingKeysWith: +) }
    }
}

struct CurrencyRows: View {
    let amounts: [String: Double]

    var body: some View {
        ForEach(amounts.keys.sorted(), id: \.self) { currency in
            if let amount = amounts[currency] {
                LabeledContent(currency, value: amount.formatted(.number.precision(.fractionLength(2))))
                    .monospacedDigit()
            }
        }
    }
}

struct AnalyticsAppRow: View {
    let app: StoreApp
    let session: OwnerSession
    var installs: Int?
    var hasReport = false

    var body: some View {
        HStack(spacing: 12) {
            AnalyticsAppIcon(app: app, session: session)
            VStack(alignment: .leading, spacing: 3) {
                Text(app.name)
                    .font(.headline)
                Text(app.platform.title)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if hasReport {
                Spacer()
                Text(installs?.formatted() ?? "Chưa có báo cáo")
                    .font(.subheadline)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(installs.map { "\($0.formatted()) lượt cài" } ?? "Chưa có báo cáo lượt cài")
            }
        }
    }
}

struct SourceWarningsSection: View {
    let warnings: [SourceWarning]
    let reports: [AnalyticsReport.AppReport]
    let range: ReportRange?

    var body: some View {
        let updates = reports.filter { row in
            row.error != nil || row.lastDate.map { $0 < (range?.endDate ?? $0) } == true
        }
        if !warnings.isEmpty || !updates.isEmpty {
            Section("Nguồn báo cáo") {
                ForEach(Array(Set(warnings)).sorted { $0.platform.rawValue < $1.platform.rawValue }, id: \.self) { warning in
                    Label("Chưa tải được danh mục \(warning.platform.title).", systemImage: "exclamationmark.circle")
                }
                ForEach(updates) { row in
                    LabeledContent(row.app.name, value: status(row))
                }
            }
        }
    }

    private func status(_ row: AnalyticsReport.AppReport) -> String {
        if row.error == "SOURCE_FAILED" { return "Lỗi nguồn" }
        if row.error == "NO_REPORTS" { return "Chưa có báo cáo" }
        return row.lastDate.map { "Có dữ liệu đến \(ReportRange.display($0))" } ?? "Chưa rõ ngày"
    }
}
