import SwiftUI

struct AppVisibilityScreen: View {
    private struct Catalog: Decodable {
        struct Entry: Decodable, Identifiable {
            let id: String
            let name: String
            let platform: StorePlatform
        }

        var apps: [Entry]
        var hidden: [Entry]
        let warnings: [SourceWarning]
    }

    private struct VisibilityUpdate: Encodable { let hidden: Bool }

    let session: OwnerSession
    @State private var catalog: Catalog?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        List {
            if let catalog {
                Section {
                    if catalog.apps.isEmpty { Text("Không còn ứng dụng đang hiển thị.").foregroundStyle(.secondary) }
                    ForEach(catalog.apps) { app in
                        row(app, hide: true)
                    }
                } header: {
                    Text("Đang hiển thị")
                } footer: {
                    Text("Ẩn ứng dụng để loại khỏi thống kê và danh sách trên iPhone.")
                }
                Section("Đã ẩn") {
                    if catalog.hidden.isEmpty { Text("Chưa có ứng dụng nào bị ẩn.").foregroundStyle(.secondary) }
                    ForEach(catalog.hidden) { app in
                        row(app, hide: false)
                    }
                }
                SourceWarningsSection(warnings: catalog.warnings, reports: [], range: nil)
            }
            if busy { ProgressView("Đang tải…") }
            if let error {
                Text(error).foregroundStyle(.secondary)
                Button("Thử lại") { Task { await load() } }
            }
        }
        .appNavigationTitle("Hiển thị ứng dụng")
        .task { await load() }
        .refreshable { await load() }
    }

    private func row(_ app: Catalog.Entry, hide: Bool) -> some View {
        Button {
            Task { await change(app, hide: hide) }
        } label: {
            HStack {
                AppChoiceLabel(name: app.name, platform: app.platform)
                    .foregroundStyle(.primary)
                Spacer()
                if hide {
                    Label("Ẩn ứng dụng", systemImage: "eye.slash")
                } else {
                    Label("Khôi phục", systemImage: "arrow.uturn.backward")
                }
            }
        }
        .accessibilityElement(children: .combine)
        .disabled(busy)
    }

    private func load() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        error = nil
        do { catalog = try await session.get(Catalog.self, at: ["apps", "visibility"]) }
        catch { if !Task.isCancelled { self.error = OwnerMessage.text(error) } }
    }

    private func change(_ app: Catalog.Entry, hide: Bool) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        error = nil
        do {
            _ = try await session.write(ReviewMutation.self, at: ["apps", app.id, "visibility"], method: "PUT",
                                        body: VisibilityUpdate(hidden: hide))
            if hide {
                catalog?.apps.removeAll(where: { $0.id == app.id })
                catalog?.hidden.append(app)
                catalog?.hidden.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            } else {
                catalog?.hidden.removeAll(where: { $0.id == app.id })
            }
            session.visibilityChanged(app.id, hidden: hide)
            catalog = try await session.get(Catalog.self, at: ["apps", "visibility"])
        } catch {
            if !Task.isCancelled { self.error = OwnerMessage.text(error) }
        }
    }
}
