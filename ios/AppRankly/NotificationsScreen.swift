import SwiftUI

struct NotificationsScreen: View {
    private enum Filter: String, CaseIterable, Identifiable {
        case all, changes, reviews, system
        var id: Self { self }
        var title: LocalizedStringKey {
            switch self {
            case .all: "Tất cả"
            case .changes: "Biến động"
            case .reviews: "Review"
            case .system: "Hệ thống"
            }
        }
    }

    let session: OwnerSession
    @State private var loader = AnalyticsLoad<NotificationFeed>()
    @State private var filter = Filter.all
    @State private var apps: [StoreApp] = []
    @State private var deletion: MobileNotification?
    @State private var error: String?
    @State private var writing = false

    var body: some View {
        List {
            Picker("Loại thông báo", selection: $filter) {
                ForEach(Filter.allCases) { Text($0.title).tag($0) }
            }
            if let feed = loader.value {
                let shown = feed.notifications.filter(matches)
                if shown.isEmpty {
                    ContentUnavailableView("Chưa có thông báo", systemImage: "bell")
                }
                ForEach(shown) { item in
                    NavigationLink {
                        NotificationDetail(session: session, item: item, apps: apps) { await mark(item.id) }
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.title).font(.headline)
                            Text(ReviewDate.display(item.timestamp)).font(.footnote).foregroundStyle(.secondary)
                            if item.read != true {
                                Label("Chưa đọc", systemImage: "circle.fill").font(.caption).foregroundStyle(.tint)
                            }
                        }
                    }
                    .swipeActions(allowsFullSwipe: false) {
                        Button("Xóa", systemImage: "trash", role: .destructive) { deletion = item }.disabled(writing)
                    }
                }
            }
            if let error { Text(error).foregroundStyle(.secondary) }
            AnalyticsStatusRow(error: loader.error, isLoading: loader.isLoading, hasValue: loader.value != nil) { await load() }
        }
        .navigationTitle("Thông báo")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Đọc tất cả", systemImage: "checkmark.circle") { Task { await mark(nil) } }
                    .disabled(writing || (loader.value?.unreadCount ?? 0) == 0)
            }
        }
        .task { await load() }
        .task {
            if let result = try? await session.get(AppCatalog.self, at: ["apps"]) { apps = result.apps }
        }
        .refreshable { await load() }
        .confirmationDialog("Xóa thông báo?", isPresented: Binding(get: { deletion != nil },
            set: { if !$0 { deletion = nil } }), titleVisibility: .visible) {
            Button("Xóa", role: .destructive) {
                if let deletion { Task { await delete(deletion) } }
            }
        }
    }

    private func matches(_ item: MobileNotification) -> Bool {
        switch filter {
        case .all: true
        case .changes: ["stats", "anomaly", "rank", "digest"].contains(item.kind)
        case .reviews: item.kind == "review"
        case .system: !["stats", "anomaly", "rank", "digest", "review"].contains(item.kind)
        }
    }

    private func load() async {
        await loader.fetch { try await session.get(NotificationFeed.self, at: ["notifications"]) }
    }

    private func mark(_ id: String?) async {
        await change {
            _ = try await session.write(ReviewMutation.self, at: ["notifications", "read"], body: NotificationRead(id: id))
        }
    }

    private func delete(_ item: MobileNotification) async {
        await change {
            _ = try await session.write(ReviewMutation.self, at: ["notifications", item.id], method: "DELETE", body: ASOEmptyBody())
        }
    }

    private func change(_ operation: () async throws -> Void) async {
        guard !writing else { return }
        writing = true
        error = nil
        defer { writing = false }
        do { try await operation(); await load() }
        catch { self.error = OwnerMessage.text(error) }
    }
}

struct NotificationDetail: View {
    let session: OwnerSession
    let item: MobileNotification
    let apps: [StoreApp]
    let markRead: () async -> Void

    var body: some View {
        List {
            Section {
                Text(item.title).font(.headline)
                Text(ReviewDate.display(item.timestamp)).font(.footnote).foregroundStyle(.secondary)
                if !(item.message.isEmpty) { Text(item.message).textSelection(.enabled) }
            }
            if let rows = item.data?.items {
                ForEach(rows.indices, id: \.self) { index in
                    let row = rows[index]
                    Section(row.name) {
                        if let term = row.term { Text(term) }
                        if let metrics = row.metrics {
                            ForEach(metrics.indices, id: \.self) { index in
                                let metric = metrics[index]
                                LabeledContent(metricTitle(metric.key), value: metricValue(metric))
                                if let previous = metric.previous {
                                    LabeledContent("Trước đó", value: previous.formatted())
                                }
                            }
                        }
                        if let note = row.note { Text(note).foregroundStyle(.secondary) }
                        if let app = apps.first(where: { $0.id == row.appId }) {
                            NavigationLink("Mở ứng dụng") { destination(app, tab: row.tab) }
                        }
                    }
                }
            }
            if let hints = item.data?.hints, !hints.isEmpty {
                Section("Gợi ý xử lý") {
                    ForEach(hints.indices, id: \.self) { index in
                        let hint = hints[index]
                        if let app = apps.first(where: { $0.id == hint.appId }) {
                            NavigationLink { destination(app, tab: hint.tab) } label: { Text(hintTitle(hint.key)) }
                        } else { Text(hintTitle(hint.key)) }
                    }
                }
            }
        }
        .navigationTitle("Thông báo")
        .task { if item.read != true { await markRead() } }
    }

    private func metricTitle(_ key: String) -> LocalizedStringKey {
        switch key {
        case "rank": "Thứ hạng"
        case "rating": "Điểm đánh giá"
        case "revenue": "Doanh thu"
        case "uninstalls": "Gỡ cài đặt"
        case "reviews": "Review"
        default: "Lượt cài"
        }
    }

    private func metricValue(_ metric: MobileNotification.Payload.Item.Metric) -> String {
        let value = metric.value.map { $0.formatted(.number.precision(.fractionLength(0...2))) } ?? "—"
        let unit = metric.unit.map { " \($0)" } ?? ""
        let change = metric.change.map { " (\($0.formatted(.number.precision(.fractionLength(0...1)).sign(strategy: .always(includingZero: false))))\(metric.key == "rank" ? "" : "%"))" } ?? ""
        return value + unit + change
    }

    private func hintTitle(_ key: String) -> LocalizedStringKey {
        switch key {
        case "replyReview", "replyNewReviews": "Trả lời review"
        case "checkListingKeywords": "Kiểm tra trang store và từ khóa"
        case "recheckRanks", "keepRankMomentum": "Xem lại thứ hạng"
        case "checkRelease": "Kiểm tra bản phát hành"
        case "checkCountries": "Kiểm tra báo cáo quốc gia"
        case "checkRecentReviews", "uninstallsHigh": "Đọc review gần đây"
        case "checkRevenueDrop": "Kiểm tra doanh thu"
        default: "Xem báo cáo"
        }
    }

    @ViewBuilder private func destination(_ app: StoreApp, tab: String?) -> some View {
        switch tab {
        case "reviews": ReviewListScreen(session: session, appId: app.id)
        case "keywords": KeywordsScreen(session: session, appId: app.id)
        case "storeListing": ASOListingScreen(session: session, app: app)
        case "countries": AnalyticsBreakdownScreen(session: session, app: app, range: .recent(30), kind: .countries)
        case "versions": AnalyticsBreakdownScreen(session: session, app: app, range: .recent(30), kind: .versions)
        default: AppAnalyticsScreen(session: session, app: app, period: .month)
        }
    }
}
