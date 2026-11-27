import SwiftUI

struct ReviewListScreen: View {
    private struct Selection: Hashable {
        var appId = ""
        var filter = ReviewFilter.all
        var stars = 0
    }

    let session: OwnerSession
    @State private var selection: Selection
    @State private var apps: [StoreApp] = []
    @State private var reviews: [MobileReview] = []
    @State private var sources: [ReviewSource] = []
    @State private var cursor: String?
    @State private var loading = false
    @State private var error: String?
    @State private var request = UUID()
    @State private var batchSelection: Set<String> = []
    @State private var selecting = false
    @State private var composer: [MobileReview] = []
    @State private var showComposer = false

    init(session: OwnerSession, appId: String = "", filter: ReviewFilter = .all) {
        self.session = session
        _selection = State(initialValue: Selection(appId: appId, filter: filter))
    }

    var body: some View {
        List {
            Section {
                AppPicker(apps: apps, includesAll: true, selection: $selection.appId)
                Picker("Phản hồi", selection: $selection.filter) {
                    ForEach(ReviewFilter.allCases) { Text($0.title).tag($0) }
                }
                Picker("Số sao", selection: $selection.stars) {
                    Text("Tất cả số sao").tag(0)
                    ForEach(1...5, id: \.self) { Text("\($0) sao").tag($0) }
                }
            }
            if sources.contains(where: { $0.status != "available" }) {
                Section {
                    Text(sources.contains(where: { $0.status == "unavailable" })
                        ? "Có store chưa đồng bộ được. Danh sách có thể chỉ gồm review đã lưu."
                        : "Kéo xuống hoặc bấm Làm mới để lấy review từ store.")
                        .foregroundStyle(.secondary)
                    if let latest = sources.compactMap(\.checkedAt).max() {
                        Text("Kiểm tra gần nhất \(ReviewDate.display(latest))")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
            }
            if !reviewable.isEmpty, !selection.appId.isEmpty {
                Section {
                    if selecting {
                        Button("Soạn phản hồi cho \(batchSelection.count) review") { openBatch() }
                            .disabled(batchSelection.isEmpty || batchSelection.count > 20)
                        Button("Bỏ chọn") { selecting = false; batchSelection.removeAll() }
                    } else {
                        Button("Trả lời hàng loạt", systemImage: "checklist") { selecting = true }
                    }
                }
            }
            Section {
                ForEach(reviews, id: \.key) { review in
                    if selecting && review.canReply && review.replyState != "pending" {
                        Toggle(isOn: Binding(get: { batchSelection.contains(review.id) }, set: {
                            if $0 && batchSelection.count < 20 { batchSelection.insert(review.id) }
                            else if !$0 { batchSelection.remove(review.id) }
                        })) {
                            ReviewRow(review: review)
                        }
                    } else {
                        NavigationLink {
                            ReviewDetailScreen(session: session, app: review.app, reviewId: review.id, initial: review)
                        } label: {
                            ReviewRow(review: review)
                        }
                    }
                }
                if let cursor {
                    Button("Xem thêm review") { Task { await load(after: cursor) } }
                        .disabled(loading)
                }
                if loading { ProgressView("Đang tải review…") }
                else if let error {
                    Text(error).foregroundStyle(.secondary)
                    Button("Thử lại") { Task { await load() } }
                } else if reviews.isEmpty {
                    ContentUnavailableView("Chưa có review", systemImage: "bubble.left",
                        description: Text("Đổi bộ lọc hoặc làm mới từ store."))
                }
            }
        }
        .navigationTitle("Review")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button("Làm mới", systemImage: "arrow.clockwise") {
                    Task { await load(refresh: true) }
                }
                .disabled(loading)
                NavigationLink {
                    ReviewTemplateScreen(session: session)
                } label: {
                    Label("Mẫu phản hồi", systemImage: "doc.on.doc")
                }
            }
        }
        .task {
            if let catalog = try? await session.get(AppCatalog.self, at: ["apps"]) { apps = catalog.apps }
        }
        .task(id: selection) {
            selecting = false
            batchSelection.removeAll()
            reviews = []
            sources = []
            cursor = nil
            await load()
        }
        .onChange(of: session.reviewGeneration) { _, _ in
            Task { await load() }
        }
        .refreshable { await load(refresh: true) }
        .sheet(isPresented: $showComposer, onDismiss: {
            composer = []
            selecting = false
            batchSelection.removeAll()
        }) {
            ReviewComposer(session: session, reviews: composer)
        }
    }

    private var reviewable: [MobileReview] { reviews.filter { $0.canReply && $0.replyState != "pending" } }

    private func openBatch() {
        composer = reviewable.filter { batchSelection.contains($0.id) }
        showComposer = !composer.isEmpty
    }

    private func load(after: String? = nil, refresh: Bool = false) async {
        let id = UUID()
        request = id
        let filter = selection
        loading = true
        error = nil
        defer { if request == id { loading = false } }
        do {
            if refresh {
                _ = try await session.write(ReviewSources.self, at: ["reviews", "refresh"],
                    body: ReviewRefresh(appId: filter.appId.isEmpty ? nil : filter.appId))
            }
            var params = [URLQueryItem(name: "status", value: filter.filter.rawValue)]
            if !filter.appId.isEmpty { params.append(.init(name: "appId", value: filter.appId)) }
            if filter.stars > 0 { params.append(.init(name: "stars", value: String(filter.stars))) }
            if let after { params.append(.init(name: "cursor", value: after)) }
            let page = try await session.get(ReviewPage.self, at: ["reviews"], query: params)
            guard request == id, !Task.isCancelled else { return }
            if after != nil {
                let known = Set(reviews.map(\.key))
                reviews += page.reviews.filter { !known.contains($0.key) }
            } else {
                reviews = page.reviews
            }
            sources = page.sources
            cursor = page.nextCursor
            if refresh { session.reviewsChanged() }
        } catch {
            guard request == id, !Task.isCancelled, !(error is CancellationError) else { return }
            self.error = ReviewMessage.text(error)
        }
    }
}

struct ReviewRow: View {
    let review: MobileReview

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(review.app.name).font(.subheadline).foregroundStyle(.secondary)
            if let rating = review.rating {
                Label("\(rating)/5", systemImage: "star.fill")
                    .font(.subheadline)
                    .accessibilityLabel("\(rating) trên 5 sao")
            }
            Text(review.text.isEmpty ? "Không có nội dung" : review.text)
                .lineLimit(2)
            Text("\(review.displayAuthor) · \(review.statusTitle)")
                .font(.footnote).foregroundStyle(.secondary)
        }
        .padding(.vertical, 3)
    }
}

enum ReviewDate {
    static func display(_ date: String) -> String {
        if let value = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(date) {
            return value.formatted(date: .abbreviated, time: .shortened)
        }
        if let value = try? Date.ISO8601FormatStyle().parse(date) {
            return value.formatted(date: .abbreviated, time: .shortened)
        }
        return ReportRange.display(date)
    }
}
