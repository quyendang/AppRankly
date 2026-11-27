import SwiftUI

struct KeywordsScreen: View {
    private struct Scope: Hashable {
        var appId: String
        var country = "us"
    }

    private enum Editor: String, Identifiable {
        case manual, suggestions
        var id: Self { self }
    }

    let session: OwnerSession
    @Environment(\.locale) private var locale
    @State private var scope: Scope
    @State private var apps: [StoreApp] = []
    @State private var pages: [Scope: KeywordOverview] = [:]
    @State private var jobs: Set<Scope> = []
    @State private var notices: [Scope: String] = [:]
    @State private var error: String?
    @State private var deleting: TrackedKeyword?
    @State private var editor: Editor?
    @State private var loading = false
    @State private var loadingApps = true
    @State private var request = UUID()

    init(session: OwnerSession, appId: String = "") {
        self.session = session
        _scope = State(initialValue: Scope(appId: appId))
    }

    private var app: StoreApp? { apps.first { $0.id == scope.appId } }
    private var page: KeywordOverview? { pages[scope] }
    private var market: KeywordMarket { page?.market ?? .init(country: scope.country, language: "en") }
    private var markets: [KeywordMarket] { page?.markets ?? pages.values.first?.markets ?? [market] }

    var body: some View {
        List {
            if !apps.isEmpty {
                Section {
                    Picker("Ứng dụng", selection: $scope.appId) {
                        ForEach(apps) { Text($0.name).tag($0.id) }
                    }
                    Picker("Thị trường", selection: $scope.country) {
                        ForEach(markets) { Text($0.label(in: locale)).tag($0.country) }
                    }
                    .accessibilityIdentifier("keyword-market")
                }
            }
            if let app {
                keywordRows(app)
                Section {
                    Button("Kiểm tra thứ hạng", systemImage: "arrow.clockwise") {
                        let target = scope
                        Task { await checkRanks(target) }
                    }
                    .disabled(jobs.contains(scope) || page?.keywords.isEmpty != false)
                    if jobs.contains(scope) { ProgressView("Đang kiểm tra \(market.country.uppercased())…") }
                    if let note = notices[scope] { Text(note).foregroundStyle(.secondary) }
                } footer: {
                    Text("Dựa trên tìm kiếm công khai của store. Mỗi lượt ưu tiên tối đa 20 từ chưa kiểm tra hoặc kiểm tra lâu nhất.")
                }
                Section("ASO") {
                    NavigationLink {
                        ASOListingScreen(session: session, app: app)
                    } label: {
                        Label("Trang store", systemImage: "storefront")
                    }
                    NavigationLink {
                        CompetitorScreen(session: session, app: app, market: market)
                    } label: {
                        Label("Đối thủ", systemImage: "person.2")
                    }
                    NavigationLink {
                        CampaignScreen(session: session, app: app)
                    } label: {
                        Label("Chiến dịch", systemImage: "link")
                    }
                }
            }
            if loading || loadingApps { ProgressView("Đang tải từ khóa…") }
            if let error {
                Text(error).foregroundStyle(.secondary)
                Button("Thử lại") { Task { await refresh() } }
            } else if !loadingApps, apps.isEmpty {
                ContentUnavailableView("Chưa có ứng dụng", systemImage: "square.grid.2x2")
            }
        }
        .navigationTitle("Từ khóa")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu("Thêm từ khóa", systemImage: "plus") {
                    Button("Nhập từ khóa", systemImage: "plus") { editor = .manual }
                    Button("Gợi ý bằng AI", systemImage: "sparkles") { editor = .suggestions }
                }
                .disabled(app == nil || page == nil)
                .accessibilityIdentifier("keyword-add-menu")
            }
        }
        .task { await loadApps() }
        .task(id: scope) { await load(scope) }
        .refreshable { await refresh() }
        .sheet(item: $editor) { editor in
            if let app {
                switch editor {
                case .manual:
                    AddKeywordSheet(session: session, app: app) { await refresh() }
                case .suggestions:
                    KeywordSuggestionSheet(session: session, app: app, market: market) { await refresh() }
                }
            }
        }
        .confirmationDialog("Bỏ theo dõi từ khóa?", isPresented: Binding(get: { deleting != nil },
            set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Bỏ theo dõi", role: .destructive) {
                if let deleting {
                    let target = scope
                    Task { await delete(deleting, in: target) }
                }
            }
        } message: {
            Text("Thao tác này cũng xóa lịch sử hạng của từ khóa.")
        }
    }

    private func keywordRows(_ app: StoreApp) -> some View {
        Section("Đang theo dõi") {
            if let page, page.keywords.isEmpty {
                Text("Chưa theo dõi từ khóa nào.").foregroundStyle(.secondary)
            }
            ForEach(page?.keywords ?? []) { item in
                NavigationLink {
                    KeywordHistoryScreen(session: session, app: app, keywordId: item.id,
                        term: item.term, country: scope.country)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        LabeledContent(item.term, value: item.position)
                            .monospacedDigit()
                        if let detail = item.detail {
                            Text(detail).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                .swipeActions(allowsFullSwipe: false) {
                    Button("Bỏ theo dõi", systemImage: "trash", role: .destructive) { deleting = item }
                }
            }
        }
    }

    private func refresh() async {
        if apps.isEmpty { await loadApps() }
        await load(scope)
    }

    private func loadApps() async {
        loadingApps = true
        defer { loadingApps = false }
        do {
            let catalog = try await session.get(AppCatalog.self, at: ["apps"])
            guard !Task.isCancelled else { return }
            apps = catalog.apps
            if !apps.contains(where: { $0.id == scope.appId }) { scope.appId = apps.first?.id ?? "" }
        } catch {
            if !Task.isCancelled { self.error = ASOMessage.text(error) }
        }
    }

    private func load(_ target: Scope) async {
        guard !target.appId.isEmpty else { return }
        let id = UUID()
        request = id
        error = nil
        loading = true
        defer { if request == id { loading = false } }
        do {
            let page = try await session.get(KeywordOverview.self, at: ["apps", target.appId, "keywords"],
                query: [.init(name: "country", value: target.country)])
            guard request == id, !Task.isCancelled, scope == target else { return }
            pages[target] = page
        } catch {
            if request == id && !Task.isCancelled { self.error = ASOMessage.text(error) }
        }
    }

    private func delete(_ keyword: TrackedKeyword, in target: Scope) async {
        do {
            _ = try await session.write(ReviewMutation.self, at: ["apps", target.appId, "keywords", String(keyword.id)],
                method: "DELETE", body: ASOEmptyBody())
            if scope == target { await load(target) }
        } catch {
            if scope == target { self.error = ASOMessage.text(error) }
        }
    }

    private func checkRanks(_ target: Scope) async {
        guard jobs.insert(target).inserted else { return }
        notices[target] = nil
        defer { jobs.remove(target) }
        let path = ["apps", target.appId, "rank-checks"]
        do {
            var job = try await session.write(RankCheck.self, at: path, body: RankCheckRequest(country: target.country))
            for _ in 0..<150 {
                if job.state != "running" { break }
                try await Task.sleep(for: .seconds(2))
                job = try await session.get(RankCheck.self, at: path + [job.id])
            }
            switch job.state {
            case "completed":
                notices[target] = job.failed > 0
                    ? "Đã kiểm tra \(job.checked) từ khóa. \(job.failed) từ gặp lỗi nguồn."
                    : "Đã kiểm tra \(job.checked) từ khóa."
            case "failed":
                notices[target] = "Lỗi nguồn tìm kiếm. Hạng đã lưu vẫn có thể xem."
            default:
                notices[target] = "Máy chủ vẫn đang kiểm tra. Tải lại danh sách để xem kết quả."
            }
            if scope == target { await load(target) }
        } catch {
            if !Task.isCancelled { notices[target] = ASOMessage.text(error) }
        }
    }
}

struct AddKeywordSheet: View {
    let session: OwnerSession
    let app: StoreApp
    let onAdded: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var term = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                LabeledContent("Ứng dụng", value: app.name)
                TextField("Từ khóa", text: $term).textInputAutocapitalization(.never)
                if let error { Text(error).foregroundStyle(.secondary) }
                Button("Theo dõi") { Task { await add() } }
                    .disabled(busy || term.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || term.utf16.count > 80)
            }
            .navigationTitle("Thêm từ khóa")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Hủy") { dismiss() }.disabled(busy) } }
        }
        .interactiveDismissDisabled(busy)
    }

    private func add() async {
        busy = true
        error = nil
        defer { busy = false }
        do {
            _ = try await session.write(KeywordChange.self, at: ["apps", app.id, "keywords"], body: NewKeyword(term: term))
            await onAdded()
            dismiss()
        } catch {
            self.error = ASOMessage.text(error)
        }
    }
}
