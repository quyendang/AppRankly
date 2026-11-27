import SwiftUI

struct AppTabs: View {
    let session: OwnerSession

    var body: some View {
        TabView {
            Tab("Thống kê", systemImage: "chart.bar.fill") {
                NavigationStack {
                    OverviewScreen(session: session)
                }
            }
            Tab("Review", systemImage: "bubble.left.fill") {
                NavigationStack {
                    ReviewListScreen(session: session)
                }
                .id(session.visibilityGeneration)
            }
            Tab("Từ khóa", systemImage: "magnifyingglass") {
                NavigationStack {
                    KeywordsScreen(session: session)
                }
                .id(session.visibilityGeneration)
            }
            Tab("Ứng dụng", systemImage: "square.grid.2x2.fill") {
                NavigationStack {
                    AppCatalogScreen(session: session)
                }
                .id(session.visibilityGeneration)
            }
        }
    }

}
