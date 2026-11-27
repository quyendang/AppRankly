import SwiftUI

struct SettingsView: View {
    let session: OwnerSession
    @AppStorage("language") private var language = "vi"
    @AppStorage("appearance") private var appearance = "system"
    @State private var settings: ServerSettings?
    @State private var integrations: Integrations?
    @State private var syncStatus: SyncStatus?
    @State private var syncJob: SyncJob?
    @State private var syncing = false
    @State private var syncMessage: String?
    @State private var preferences: ServerPreferences?
    @State private var packageName = ""
    @State private var removing: String?
    @State private var delivery: DeliveryAction?
    @State private var preview: DigestPreview?
    @State private var busy = false
    @State private var message: String?

    private enum DeliveryAction {
        case test, digest(String)
    }

    var body: some View {
        Form {
            Section("Giao diện") {
                Picker("Ngôn ngữ", selection: $language) {
                    Text(verbatim: "Tiếng Việt").tag("vi")
                    Text(verbatim: "English").tag("en")
                }
                Picker("Giao diện", selection: $appearance) {
                    Text("Hệ thống").tag("system")
                    Text("Sáng").tag("light")
                    Text("Tối").tag("dark")
                }
            }
            Section("Kết nối") {
                LabeledContent("Máy chủ", value: session.server)
                if let integrations {
                    connection("Google Play", id: "google", configured: integrations.google.configured)
                    connection("App Store", id: "apple", configured: integrations.apple.configured)
                    LabeledContent("AI", value: integrations.ai.providers.contains(where: \.available)
                        ? (integrations.ai.defaultProvider ?? AppLanguage.text("Đã cấu hình")) : AppLanguage.text("Chưa cấu hình"))
                }
            }
            Section("Đồng bộ") {
                if let last = syncStatus?.lastRun { LabeledContent("Lần gần nhất", value: ReviewDate.display(last)) }
                if let count = syncStatus?.appsChecked { LabeledContent("Số app đã kiểm tra", value: count.formatted()) }
                let sources = syncJob?.state == "completed" ? syncJob?.sources : syncStatus?.sources
                if let apple = sources?["apple"] { syncSource("App Store", apple) }
                if let google = sources?["google"] { syncSource("Google Play", google) }
                Button("Đồng bộ ngay", systemImage: "arrow.clockwise") { Task { await sync() } }.disabled(busy)
                if syncing { ProgressView("Đang đồng bộ…") }
                if let syncMessage { Text(syncMessage).foregroundStyle(.secondary) }
            }
            if let settings, let preferences {
                packages(settings.googlePackages)
                preferencesSection(settings, preferences)
            }
            NavigationLink { NotificationsScreen(session: session) } label: { Label("Thông báo", systemImage: "bell") }
            if busy && !syncing { ProgressView("Đang xử lý…") }
            if let message { Text(message).foregroundStyle(.secondary) }
            Section {
                Button("Đăng xuất", role: .destructive) { Task { await session.logout() } }
                    .disabled(session.isWorking || busy)
                if let message = session.message { Text(message).foregroundStyle(.secondary) }
            }
        }
        .appNavigationTitle("Cài đặt")
        .task { await load() }
        .refreshable { await load() }
        .confirmationDialog("Bỏ mã gói đã thêm?", isPresented: Binding(get: { removing != nil },
            set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Bỏ mã gói", role: .destructive) {
                if let removing { Task { await changePackage(removing, remove: true) } }
            }
        }
        .confirmationDialog("Gửi đến các kênh đã cấu hình?", isPresented: Binding(get: { delivery != nil },
            set: { if !$0 { delivery = nil } }), titleVisibility: .visible) {
            Button("Xác nhận gửi") {
                if let delivery { Task { await send(delivery) } }
            }
        }
    }

    private func syncSource(_ name: String, _ source: SyncSource) -> some View {
        LabeledContent(name, value: AppLanguage.text("\(source.withReports)/\(source.attempted) app có báo cáo"))
    }

    private func connection(_ label: String, id: String, configured: Bool) -> some View {
        Group {
            LabeledContent(label, value: configured ? AppLanguage.text("Đã cấu hình") : AppLanguage.text("Chưa cấu hình"))
            if configured {
                Button("Kiểm tra \(label)") { Task { await testConnection(id) } }.disabled(busy)
            }
        }
    }

    private func packages(_ packages: [String]) -> some View {
        Section("Mã gói Google Play") {
            ForEach(packages, id: \.self) { id in
                Text(id)
                    .swipeActions(allowsFullSwipe: false) {
                        Button("Bỏ mã gói", role: .destructive) { removing = id }.disabled(busy)
                    }
            }
            TextField("Mã gói ứng dụng", text: $packageName).textContentType(.none)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            Button("Thêm mã gói") { Task { await changePackage(packageName, remove: false) } }
                .disabled(busy || packageName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
    }

    private func preferencesSection(_ settings: ServerSettings, _ current: ServerPreferences) -> some View {
        let binding = Binding(get: { preferences ?? current }, set: { preferences = $0 })
        return Section("Lịch và bản tin") {
            Picker("Tần suất đồng bộ", selection: binding.refreshIntervalHours) {
                ForEach(Array(Set([1, 3, 6, 12, 24, settings.refreshIntervalHours])).sorted(), id: \.self) {
                    Text("\($0) giờ").tag($0)
                }
            }
            LabeledContent("Múi giờ máy chủ", value: settings.timezone)
            Toggle("Gửi đến kênh thông báo", isOn: binding.notificationsEnabled)
            Picker("Tần suất bản tin", selection: binding.digest) {
                Text("Tắt").tag("off")
                Text("Hằng ngày").tag("daily")
                Text("Hằng tuần").tag("weekly")
            }
            Picker("Giờ gửi", selection: binding.digestHour) {
                ForEach(0..<24) { Text(String(format: "%02d:00", $0)).tag($0) }
            }
            Picker("Ngôn ngữ bản tin", selection: binding.digestLocale) {
                Text("Tiếng Việt").tag("vi")
                Text("English").tag("en")
            }
            Stepper("Ngưỡng biến động \(current.anomalyThreshold)%", value: binding.anomalyThreshold, in: 10...90)
            Button("Lưu cài đặt") { Task { await save(current) } }
                .disabled(busy || current == settings.preferences)
            let period = settings.digest == "weekly" ? "weekly" : "daily"
            Button("Xem trước bản tin") { Task { await loadDigest(period) } }.disabled(busy)
            if let preview { DisclosureGroup(preview.title) { Text(preview.message).textSelection(.enabled) } }
            if settings.notificationsEnabled && integrations?.notifications.configured == true {
                Button("Gửi bản tin") { delivery = .digest(period) }.disabled(busy)
                Button("Gửi thông báo thử") { delivery = .test }.disabled(busy)
            }
        }
    }

    private func load() async {
        await perform {
            async let settings = session.get(ServerSettings.self, at: ["settings"])
            async let integrations = session.get(Integrations.self, at: ["integrations"])
            async let sync = session.get(SyncStatus.self, at: ["sync"])
            let (loaded, connections, state) = try await (settings, integrations, sync)
            self.settings = loaded
            preferences = loaded.preferences
            self.integrations = connections
            syncStatus = state
        }
    }

    private func save(_ value: ServerPreferences) async {
        await perform {
            let saved = try await session.write(ServerSettings.self, at: ["settings"], method: "PUT", body: value)
            settings = saved
            preferences = saved.preferences
            preview = nil
            message = AppLanguage.text("Đã lưu cài đặt.")
        }
    }

    private func changePackage(_ input: String, remove: Bool) async {
        await perform {
            let id = input.trimmingCharacters(in: .whitespacesAndNewlines)
            let path = ["apps", "google"]
            settings = if remove {
                try await session.write(ServerSettings.self, at: path + [id], method: "DELETE", body: ASOEmptyBody())
            } else {
                try await session.write(ServerSettings.self, at: path, body: ManualGooglePackage(packageName: id))
            }
            packageName = ""
            session.catalogChanged()
        }
    }

    private func testConnection(_ platform: String) async {
        await perform {
            _ = try await session.write(ReviewMutation.self, at: ["integrations", platform, "test"], body: ASOEmptyBody())
            message = AppLanguage.text("Kết nối thành công.")
        }
    }

    private func loadDigest(_ period: String) async {
        await perform {
            preview = try await session.get(DigestPreview.self, at: ["digest"], query: [.init(name: "period", value: period)])
        }
    }

    private func send(_ action: DeliveryAction) async {
        await perform {
            let result: DeliveryResult
            switch action {
            case .test:
                result = try await session.write(DeliveryResult.self, at: ["notifications", "test"], body: DeliveryRequest())
            case .digest(let period):
                result = try await session.write(DeliveryResult.self, at: ["digest", "send"], body: DeliveryRequest(period: period))
            }
            message = result.summary
        }
    }

    private func sync() async {
        guard !busy else { return }
        busy = true
        syncing = true
        message = nil
        syncMessage = nil
        defer {
            busy = false
            syncing = false
        }
        do {
            var job = try await session.write(SyncJob.self, at: ["sync"], body: ASOEmptyBody())
            for _ in 0..<90 {
                guard job.state == "running" else { break }
                try await Task.sleep(for: .seconds(2))
                job = try await session.get(SyncJob.self, at: ["sync", job.id])
            }
            syncJob = job
            if let latest = try? await session.get(SyncStatus.self, at: ["sync"]) { syncStatus = latest }
            switch job.state {
            case "completed":
                session.catalogChanged()
                session.reviewsChanged()
                syncMessage = AppLanguage.text("Đồng bộ hoàn tất.")
            case "skipped": syncMessage = AppLanguage.text("Một lượt đồng bộ khác đang chạy.")
            case "failed": syncMessage = AppLanguage.text("Không hoàn tất được đồng bộ.")
            default: syncMessage = AppLanguage.text("Máy chủ vẫn đang đồng bộ.")
            }
        } catch {
            if !Task.isCancelled { syncMessage = OwnerMessage.text(error) }
        }
    }

    private func perform(_ operation: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        message = nil
        defer { busy = false }
        do { try await operation() }
        catch { if !Task.isCancelled { message = OwnerMessage.text(error) } }
    }
}
