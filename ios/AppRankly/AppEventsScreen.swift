import SwiftUI

struct AppEventsScreen: View {
    let session: OwnerSession
    let app: StoreApp
    @State private var loader = AnalyticsLoad<AppEvents>()
    @State private var label = ""
    @State private var date = Date.now
    @State private var deleting: AppEvents.Event?
    @State private var busy = false
    @State private var error: String?

    private var endpoint: [String] { ["apps", app.id, "events"] }

    var body: some View {
        Form {
            Section("Thêm sự kiện") {
                TextField("Tên sự kiện", text: $label)
                DatePicker("Ngày sự kiện", selection: $date, displayedComponents: .date)
                Button("Lưu sự kiện") { Task { await add() } }
                    .disabled(busy || label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || label.utf16.count > 80)
            }
            if let events = loader.value?.events {
                Section("Lịch sử sự kiện") {
                    if events.isEmpty { Text("Chưa có sự kiện").foregroundStyle(.secondary) }
                    ForEach(events.reversed()) { event in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(event.label)
                            Text(ReportRange.display(event.date)).font(.footnote).foregroundStyle(.secondary)
                        }
                        .swipeActions(allowsFullSwipe: false) {
                            if event.canDelete { Button("Xóa", role: .destructive) { deleting = event }.disabled(busy) }
                        }
                    }
                }
            }
            if let error { Text(error).foregroundStyle(.secondary) }
            AnalyticsStatusRow(error: loader.error, isLoading: loader.isLoading, hasValue: loader.value != nil) { await load() }
        }
        .navigationTitle("Sự kiện")
        .task { await load() }
        .refreshable { await load() }
        .confirmationDialog("Xóa sự kiện?", isPresented: Binding(get: { deleting != nil },
            set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Xóa", role: .destructive) {
                if let deleting { Task { await delete(deleting) } }
            }
        }
    }

    private func load() async {
        await loader.fetch { try await session.get(AppEvents.self, at: endpoint) }
    }

    private func add() async {
        await perform {
            _ = try await session.write(AppEvents.Event.self, at: endpoint,
                body: NewEvent(label: label, date: ReportRange.localDay(date)))
            label = ""
        }
    }

    private func delete(_ event: AppEvents.Event) async {
        await perform {
            _ = try await session.write(ReviewMutation.self, at: endpoint + [event.id],
                method: "DELETE", body: ASOEmptyBody())
        }
    }

    private func perform(_ work: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        do { try await work(); await load() }
        catch { self.error = OwnerMessage.text(error) }
    }
}
