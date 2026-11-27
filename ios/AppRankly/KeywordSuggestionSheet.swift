import SwiftUI

struct KeywordSuggestionSheet: View {
    let session: OwnerSession
    let app: StoreApp
    let market: KeywordMarket
    let onAdded: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale
    @State private var count = 15
    @State private var preview: KeywordPreview?
    @State private var suggestions: [KeywordSuggestions.Item] = []
    @State private var selected: Set<String> = []
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Ứng dụng", value: app.name)
                    LabeledContent("Thị trường", value: market.label(in: locale))
                    if suggestions.isEmpty {
                        Picker("Số gợi ý", selection: $count) {
                            ForEach([10, 15, 20, 25], id: \.self) { Text(String($0)).tag($0) }
                        }
                        .disabled(busy)
                    }
                }
                if !suggestions.isEmpty {
                    Section {
                        ForEach(suggestions) { item in
                            Toggle(isOn: Binding(get: { selected.contains(item.term) }, set: { picked in
                                if picked { selected.insert(item.term) } else { selected.remove(item.term) }
                            })) {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(item.term).font(.headline)
                                    if !item.reason.isEmpty { Text(item.reason).font(.footnote).foregroundStyle(.secondary) }
                                }
                            }
                            .disabled(busy)
                        }
                        Button("Theo dõi \(selected.count) từ đã chọn") { Task { await add() } }
                            .disabled(selected.isEmpty || busy)
                    } header: {
                        Text("Chọn từ khóa")
                    } footer: {
                        Text("Gợi ý không có số liệu lượng tìm kiếm hay thứ hạng.")
                    }
                } else if let preview {
                    Section {
                        LabeledContent("Nhà cung cấp", value: preview.destination.provider)
                        if let model = preview.destination.model { LabeledContent("Mô hình", value: model) }
                        if let origin = preview.destination.origin { Text(origin).textSelection(.enabled) }
                        DisclosureGroup("Nội dung gửi cho AI") {
                            Text(preview.payload.formattedJSON)
                                .font(.system(.caption, design: .monospaced))
                                .textSelection(.enabled)
                        }
                        Button("Xác nhận và tạo gợi ý") { Task { await generate(preview) } }
                            .disabled(busy)
                    } header: {
                        Text("Bản xem trước")
                    } footer: {
                        Text("AppRankly chỉ gửi dữ liệu trong bản xem trước sau khi bạn xác nhận.")
                    }
                } else {
                    Button("Xem trước dữ liệu gửi AI") { Task { await makePreview() } }.disabled(busy)
                }
                if busy { ProgressView("Đang xử lý…") }
                if let error { Text(error).foregroundStyle(.secondary) }
            }
            .navigationTitle("Gợi ý từ khóa")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Đóng", systemImage: "xmark") { dismiss() }.disabled(busy) }
            }
        }
        .interactiveDismissDisabled(busy)
        .onChange(of: count) { preview = nil; error = nil }
    }

    private func makePreview() async {
        await perform {
            preview = try await session.write(KeywordPreview.self, at: ["ai", "previews"],
                body: KeywordSuggestionRequest(appId: app.id, country: market.country, count: count))
        }
    }

    private func generate(_ approved: KeywordPreview) async {
        await perform {
            preview = nil
            let result = try await session.write(KeywordSuggestions.self, at: ["ai", "runs"],
                body: ReviewAIConfirmation(previewId: approved.previewId))
            suggestions = result.suggestions
            selected = []
        }
    }

    private func add() async {
        await perform {
            let terms = suggestions.map(\.term).filter { selected.contains($0) }
            _ = try await session.write(KeywordChange.self, at: ["apps", app.id, "keywords"],
                body: SelectedKeywords(terms: terms))
            await onAdded()
            dismiss()
        }
    }

    private func perform(_ work: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        do { try await work() }
        catch { self.error = ASOMessage.text(error) }
    }
}
