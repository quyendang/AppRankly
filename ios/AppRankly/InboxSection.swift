import SwiftUI

struct InboxSection: View {
    let session: OwnerSession
    let period: AnalyticsPeriod
    let selectedApp: String
    @State private var loader = AnalyticsLoad<InboxResponse>()

    private var tasks: [InboxTask] {
        (loader.value?.tasks ?? []).filter {
            !session.dismissedInboxKeys.contains($0.key) && (selectedApp.isEmpty || $0.app.id == selectedApp)
        }
    }

    var body: some View {
        Section("Cần xử lý") {
            ForEach(tasks.prefix(4)) { task in
                NavigationLink {
                    InboxDestination(session: session, task: task, period: period)
                } label: {
                    InboxRow(task: task)
                }
                .swipeActions {
                    Button("Bỏ qua", systemImage: "checkmark") { session.dismissInboxTask(task.key) }
                }
            }
            if tasks.count > 4 {
                NavigationLink("Xem tất cả") {
                    List(tasks) { task in
                        NavigationLink {
                            InboxDestination(session: session, task: task, period: period)
                        } label: {
                            InboxRow(task: task)
                        }
                        .swipeActions {
                            Button("Bỏ qua", systemImage: "checkmark") { session.dismissInboxTask(task.key) }
                        }
                    }
                    .appNavigationTitle("Hộp việc")
                }
            } else if tasks.isEmpty, loader.value != nil {
                Text("Chưa có việc cần xử lý.").foregroundStyle(.secondary)
            }
            AnalyticsStatusRow(error: loader.error, isLoading: loader.isLoading, hasValue: loader.value != nil) {
                await load()
            }
        }
        .task(id: period) { await load() }
        .onChange(of: session.catalogGeneration) { _, _ in Task { await load() } }
        .onChange(of: session.reviewGeneration) { _, _ in Task { await load() } }
    }

    private func load() async {
        await loader.fetch { try await session.get(InboxResponse.self, at: ["inbox"], range: period.range) }
    }
}

struct InboxRow: View {
    let task: InboxTask
    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 4) {
                Text(task.label)
                Text(task.app.name).font(.footnote).foregroundStyle(.secondary)
                if let anomaly = task.anomaly, anomaly.term == nil {
                    Text((anomaly.change / 100).formatted(.percent.precision(.fractionLength(1)).sign(strategy: .always(includingZero: false))))
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
        } icon: {
            Image(systemName: task.symbol)
        }
    }
}

struct InboxDestination: View {
    let session: OwnerSession
    let task: InboxTask
    let period: AnalyticsPeriod

    var body: some View {
        switch task.kind {
        case "lowReview":
            if let sample = task.sample {
                ReviewDetailScreen(session: session, app: task.app, reviewId: sample.id)
            } else {
                ReviewListScreen(session: session, appId: task.app.id, filter: .unanswered)
            }
        case "reviews":
            ReviewListScreen(session: session, appId: task.app.id, filter: .unanswered)
        case "rankDrop", "rankRise":
            if let id = task.anomaly?.keywordId, let country = task.anomaly?.country {
                KeywordHistoryScreen(session: session, app: task.app, keywordId: id, term: task.label, country: country)
            } else {
                List {
                    LabeledContent("Ứng dụng", value: task.app.name)
                    if let market = task.anomaly?.country { LabeledContent("Thị trường", value: market.uppercased()) }
                    LabeledContent("Hạng trước", value: task.anomaly?.from.map { "#\($0)" } ?? AppLanguage.text("Ngoài top 100"))
                    LabeledContent("Hạng mới", value: task.anomaly?.to.map { "#\($0)" } ?? AppLanguage.text("Ngoài top 100"))
                }
                .navigationTitle(task.label)
            }
        default:
            AppAnalyticsScreen(session: session, app: task.app, period: period)
        }
    }
}
