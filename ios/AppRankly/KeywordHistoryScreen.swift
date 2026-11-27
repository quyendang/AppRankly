import SwiftUI
import Charts

struct KeywordHistoryScreen: View {
    private struct Position: Identifiable {
        let date: Date
        let rank: Int
        let segment: Int
        var id: Date { date }
    }

    let session: OwnerSession
    let app: StoreApp
    let keywordId: Int
    let term: String
    let country: String
    @Environment(\.locale) private var locale
    @State private var loader = AnalyticsLoad<KeywordHistory>()

    var body: some View {
        List {
            Section {
                LabeledContent("Ứng dụng", value: app.name)
                LabeledContent("Thị trường", value: loader.value?.market.label(in: locale) ?? country.uppercased())
            }
            if let history = loader.value {
                Section("Vị trí tìm kiếm") {
                    let points = positions(history.points)
                    if points.isEmpty {
                        Text("Chưa có vị trí để vẽ biểu đồ.").foregroundStyle(.secondary)
                    } else {
                        RankHistoryChart(points: points.map { (date: $0.date, rank: $0.rank, segment: $0.segment) })
                    }
                }
                Section("Lịch sử 90 ngày") {
                    if history.points.isEmpty {
                        Text("Chưa có lần kiểm tra ở thị trường này.").foregroundStyle(.secondary)
                    }
                    ForEach(history.points.reversed()) { row in
                        LabeledContent(ReportRange.display(row.date), value: row.position).monospacedDigit()
                    }
                }
            }
            AnalyticsStatusRow(error: loader.error, isLoading: loader.isLoading, hasValue: loader.value != nil) {
                await load()
            }
        }
        .navigationTitle(term)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        await loader.fetch {
            try await session.get(KeywordHistory.self, at: ["apps", app.id, "keywords", String(keywordId), "history"],
                query: [.init(name: "country", value: country)])
        }
    }

    private func positions(_ points: [KeywordHistory.Point]) -> [Position] {
        var segment = 0
        return points.compactMap { point in
            guard let rank = point.rank, let date = ReportRange.date(point.date) else {
                segment += 1
                return nil
            }
            return .init(date: date, rank: rank, segment: segment)
        }
    }
}

struct RankHistoryChart: View {
    let points: [(date: Date, rank: Int, segment: Int)]

    var body: some View {
        Chart(points, id: \.date) { item in
            LineMark(x: .value("Ngày", item.date), y: .value("Thứ hạng", -item.rank), series: .value("Đoạn", item.segment))
                .foregroundStyle(Color("AccentColor"))
            PointMark(x: .value("Ngày", item.date), y: .value("Thứ hạng", -item.rank))
                .foregroundStyle(Color("AccentColor"))
                .accessibilityLabel(ReportRange.display(item.date.formatted(.iso8601.year().month().day().dateSeparator(.dash))))
                .accessibilityValue("Hạng \(item.rank)")
        }
        .chartYScale(domain: (-max((points.map(\.rank).max() ?? 1) + 1, 3)) ... -1)
        .chartYAxis {
            AxisMarks(values: .automatic(desiredCount: 4)) { value in
                AxisGridLine()
                AxisValueLabel {
                    if let position = value.as(Int.self), position < 0 { Text("#\(-position)") }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 4)) {
                AxisValueLabel(format: .dateTime.day().month(.defaultDigits))
            }
        }
        .frame(height: 170)
        .environment(\.timeZone, ReportRange.timeZone)
        .accessibilityLabel("Lịch sử thứ hạng")
        .accessibilityHint("Hạng tốt hơn nằm phía trên biểu đồ.")
    }
}
