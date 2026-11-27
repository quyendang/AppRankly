import SwiftUI

struct AppCatalogScreen: View {
    let session: OwnerSession
    @State private var loader = AnalyticsLoad<AppCatalog>()
    @State private var search = ""

    var body: some View {
        List {
            if let catalog = loader.value {
                let apps = catalog.apps.filter {
                    search.isEmpty || $0.name.localizedStandardContains(search) || $0.packageName.localizedStandardContains(search)
                }
                if apps.isEmpty {
                    if search.isEmpty {
                        ContentUnavailableView("Chưa có ứng dụng", systemImage: "square.grid.2x2")
                    } else {
                        ContentUnavailableView.search(text: search)
                    }
                }
                ForEach(apps) { app in
                    NavigationLink {
                        AppAnalyticsScreen(session: session, app: app, period: .month)
                    } label: {
                        AnalyticsAppRow(app: app, session: session)
                    }
                }
                SourceWarningsSection(warnings: catalog.warnings, reports: [], range: nil)
            }
            AnalyticsStatusRow(error: loader.error, isLoading: loader.isLoading, hasValue: loader.value != nil) {
                await load()
            }
        }
        .navigationTitle("Ứng dụng")
        .searchable(text: $search, prompt: "Tên hoặc mã ứng dụng")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        await loader.fetch { try await session.get(AppCatalog.self, at: ["apps"]) }
    }
}
