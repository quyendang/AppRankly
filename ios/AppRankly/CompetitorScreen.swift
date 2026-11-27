import SwiftUI

struct CompetitorScreen: View {
    let session: OwnerSession
    let app: StoreApp
    let market: KeywordMarket
    @Environment(\.locale) private var locale
    @State private var tracked: [Competitor] = []
    @State private var results: [Competitor]?
    @State private var query = ""
    @State private var busy = false
    @State private var error: String?
    @State private var unpinning: Competitor?

    private var endpoint: [String] { ["apps", app.id, "competitors"] }

    var body: some View {
        List {
            Section {
                LabeledContent("Ứng dụng", value: app.name)
                LabeledContent("Thị trường tìm kiếm", value: market.label(in: locale))
            }
            if let results, !query.isEmpty {
                Section("Kết quả tìm kiếm") {
                    if results.isEmpty { Text("Không tìm thấy đối thủ phù hợp.").foregroundStyle(.secondary) }
                    ForEach(results) { item in
                        CompetitorName(item: item)
                        if tracked.contains(where: { $0.id == item.id }) {
                            Label("Đang theo dõi", systemImage: "checkmark").foregroundStyle(.secondary)
                        } else {
                            Button("Theo dõi \(item.title)") { Task { await pin(item) } }.disabled(busy)
                        }
                    }
                }
            }
            Section("Đang theo dõi") {
                if tracked.isEmpty && !busy { Text("Chưa theo dõi đối thủ nào.").foregroundStyle(.secondary) }
                ForEach(tracked) { item in
                    CompetitorName(item: item)
                        .swipeActions(allowsFullSwipe: false) {
                            Button("Bỏ theo dõi", systemImage: "trash", role: .destructive) { unpinning = item }
                        }
                }
            }
            if busy { ProgressView("Đang tải…") }
            if let error {
                Text(error).foregroundStyle(.secondary)
                Button("Thử lại") { Task { await refresh() } }.disabled(busy)
            }
        }
        .navigationTitle("Đối thủ")
        .searchable(text: $query, prompt: "Tìm đối thủ trên \(app.platform.title)")
        .onSubmit(of: .search) { Task { await search() } }
        .onChange(of: query) { results = nil }
        .task { await refresh() }
        .refreshable { await refresh() }
        .confirmationDialog("Bỏ theo dõi đối thủ?", isPresented: Binding(get: { unpinning != nil },
            set: { if !$0 { unpinning = nil } }), titleVisibility: .visible) {
            Button("Bỏ theo dõi", role: .destructive) {
                if let item = unpinning { Task { await unpin(item) } }
            }
        }
    }

    private func refresh() async {
        await perform { try await loadTracked() }
    }

    private func loadTracked() async throws {
        tracked = try await session.get(Competitors.self, at: endpoint).competitors
    }

    private func search() async {
        let raw = query
        let term = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !term.isEmpty else { results = nil; return }
        guard term.utf16.count <= 100 else { error = "Nhập tối đa 100 ký tự."; return }
        await perform {
            let response = try await session.get(Competitors.self, at: endpoint,
                query: [.init(name: "q", value: term), .init(name: "country", value: market.country)])
            if query == raw { results = response.competitors }
        }
    }

    private func pin(_ item: Competitor) async {
        await perform {
            _ = try await session.write(ReviewMutation.self, at: endpoint, body: PinCompetitor(competitorId: item.id))
            try await loadTracked()
        }
    }

    private func unpin(_ item: Competitor) async {
        await perform {
            _ = try await session.write(ReviewMutation.self, at: endpoint + [item.id], method: "DELETE", body: ASOEmptyBody())
            try await loadTracked()
        }
    }

    private func perform(_ work: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        do { try await work() }
        catch { if !Task.isCancelled { self.error = ASOMessage.text(error) } }
    }
}

struct CompetitorName: View {
    let item: Competitor

    var body: some View {
        LabeledContent(item.title, value: item.rating.map { $0.formatted(.number.precision(.fractionLength(1))) + "/5" } ?? "Chưa có điểm")
    }
}
