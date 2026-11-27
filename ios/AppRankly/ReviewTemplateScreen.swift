import SwiftUI

struct ReviewTemplateScreen: View {
    let session: OwnerSession
    @State private var templates: [ReviewTemplate] = []
    @State private var name = ""
    @State private var text = ""
    @State private var loading = false
    @State private var error: String?
    @State private var removing: ReviewTemplate?

    var body: some View {
        Form {
            Section("Mẫu đã lưu") {
                if templates.isEmpty && !loading { Text("Chưa có mẫu phản hồi.").foregroundStyle(.secondary) }
                ForEach(templates) { template in
                    DisclosureGroup(template.name) {
                        Text(template.body)
                        Button("Xóa mẫu", role: .destructive) { removing = template }
                            .disabled(loading)
                    }
                }
            }
            Section {
                TextField("Tên mẫu", text: $name)
                TextField("Nội dung", text: $text, axis: .vertical).lineLimit(3...8)
                Button("Lưu mẫu") { Task { await save() } }
                    .disabled(loading || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || name.utf16.count > 60 || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || text.utf16.count > 5970)
            } header: {
                Text("Mẫu mới")
            } footer: {
                Text("Có thể dùng {name}, {rating} và {app} trong nội dung.")
            }
            if loading { ProgressView() }
            if let error { Text(error).foregroundStyle(.secondary) }
        }
        .appNavigationTitle("Mẫu phản hồi")
        .task { await load() }
        .refreshable { await load() }
        .confirmationDialog("Xóa mẫu phản hồi?", isPresented: Binding(get: { removing != nil },
            set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Xóa", role: .destructive) {
                if let removing { Task { await delete(removing) } }
            }
        }
    }

    private func load() async {
        await perform {
            templates = try await session.get(ReviewTemplates.self, at: ["review-templates"]).templates
        }
    }
    private func save() async {
        await perform {
            let item = try await session.write(ReviewTemplate.self, at: ["review-templates"],
                body: NewReviewTemplate(name: name, body: text))
            templates.append(item)
            name = ""
            text = ""
        }
    }
    private func delete(_ item: ReviewTemplate) async {
        await perform {
            _ = try await session.write(ReviewMutation.self, at: ["review-templates", String(item.id)],
                method: "DELETE", body: ReviewRefresh(appId: nil))
            templates.removeAll { $0.id == item.id }
        }
    }
    private func perform(_ operation: () async throws -> Void) async {
        guard !loading else { return }
        loading = true
        error = nil
        defer { loading = false }
        do { try await operation() }
        catch { if !Task.isCancelled { self.error = ReviewMessage.text(error) } }
    }
}
