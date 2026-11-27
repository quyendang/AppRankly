import SwiftUI

struct ASOListingScreen: View {
    let session: OwnerSession
    let app: StoreApp
    @State private var loader = AnalyticsLoad<PublicStoreListing>()

    var body: some View {
        List {
            Section {
                HStack(spacing: 12) {
                    AnalyticsAppIcon(app: app, session: session)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(loader.value?.title ?? app.name).font(.headline)
                        Text(app.platform.title).foregroundStyle(.secondary)
                    }
                }
            }
            if let listing = loader.value {
                Section("Thông tin công khai") {
                    if let developer = listing.developer { LabeledContent("Nhà phát triển", value: developer) }
                    if let rating = listing.rating {
                        LabeledContent("Điểm đánh giá", value: rating.formatted(.number.precision(.fractionLength(1))) + "/5")
                    }
                    if let subtitle = listing.subtitle { LabeledContent("Phụ đề", value: subtitle) }
                    if let url = listing.storeUrl { Link("Mở trên \(app.platform.title)", destination: url) }
                }
                if let description = listing.description {
                    Section("Mô tả") { Text(description).textSelection(.enabled) }
                }
            }
            NavigationLink {
                StoreAnalysisScreen(session: session, app: app)
            } label: {
                Label("Phân tích AI", systemImage: "sparkles")
            }
            AnalyticsStatusRow(error: loader.error, isLoading: loader.isLoading, hasValue: loader.value != nil) { await load() }
        }
        .navigationTitle("Trang store")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        await loader.fetch { try await session.get(PublicStoreListing.self, at: ["apps", app.id, "listing"]) }
    }
}
