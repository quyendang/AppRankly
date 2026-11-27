import SwiftUI

struct CampaignScreen: View {
    let session: OwnerSession
    let app: StoreApp
    @State private var loader = AnalyticsLoad<Campaigns>()
    @State private var deleting: Campaign?
    @State private var adding = false
    @State private var deleteError: String?

    private var endpoint: [String] { ["apps", app.id, "campaigns"] }

    var body: some View {
        List {
            Section {
                LabeledContent("Ứng dụng", value: app.name)
            }
            if let payload = loader.value {
                Section {
                    if payload.campaigns.isEmpty { Text("Chưa tạo liên kết chiến dịch.").foregroundStyle(.secondary) }
                    ForEach(payload.campaigns) { campaign in
                        DisclosureGroup(campaign.name) {
                            LabeledContent("Nguồn", value: campaign.source)
                            LabeledContent("Lượt mở", value: campaign.clicks.formatted())
                            if let url = campaign.url(origin: session.server) {
                                ShareLink(item: url)
                            }
                            Button("Xóa liên kết", role: .destructive) { deleting = campaign }
                        }
                    }
                } header: {
                    Text("Liên kết đã tạo")
                } footer: {
                    Text("Lượt mở đếm số lần truy cập liên kết.")
                }
            }
            if let deleteError { Text(deleteError).foregroundStyle(.secondary) }
            AnalyticsStatusRow(error: loader.error, isLoading: loader.isLoading, hasValue: loader.value != nil) { await load() }
        }
        .navigationTitle("Chiến dịch")
        .toolbar { ToolbarItem(placement: .topBarTrailing) {
            Button("Tạo liên kết", systemImage: "plus") { adding = true }
        } }
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $adding) { AddCampaignSheet(session: session, app: app) { await load() } }
        .confirmationDialog("Xóa liên kết chiến dịch?", isPresented: Binding(get: { deleting != nil },
            set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Xóa", role: .destructive) {
                if let deleting { Task { await delete(deleting) } }
            }
        } message: {
            Text("Liên kết đã chia sẻ sẽ ngừng hoạt động.")
        }
    }

    private func load() async {
        await loader.fetch { try await session.get(Campaigns.self, at: endpoint) }
    }

    private func delete(_ campaign: Campaign) async {
        deleteError = nil
        do {
            _ = try await session.write(ReviewMutation.self, at: endpoint + [String(campaign.id)], method: "DELETE", body: ASOEmptyBody())
            await load()
        } catch {
            deleteError = ASOMessage.text(error)
        }
    }
}

struct AddCampaignSheet: View {
    let session: OwnerSession
    let app: StoreApp
    let onAdded: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var source = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                LabeledContent("Ứng dụng", value: app.name)
                TextField("Tên chiến dịch", text: $name)
                TextField("Nguồn", text: $source, prompt: Text("Ví dụ newsletter"))
                    .textInputAutocapitalization(.never)
                if let error { Text(error).foregroundStyle(.secondary) }
                Button("Tạo liên kết") { Task { await create() } }
                    .disabled(!valid(name) || !valid(source) || busy)
            }
            .navigationTitle("Chiến dịch mới")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Hủy") { dismiss() }.disabled(busy) } }
        }
        .interactiveDismissDisabled(busy)
    }

    private func valid(_ string: String) -> Bool {
        !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && string.utf16.count <= 100
    }

    private func create() async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            _ = try await session.write(Campaign.self, at: ["apps", app.id, "campaigns"],
                body: NewCampaign(name: name, source: source))
            await onAdded()
            dismiss()
        } catch {
            self.error = ASOMessage.text(error)
        }
    }
}
