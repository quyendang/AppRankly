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
            }
            Tab("Từ khóa", systemImage: "magnifyingglass") {
                NavigationStack {
                    screen("Từ khóa", unavailable: "Chưa có dữ liệu từ khóa", icon: "magnifyingglass")
                }
            }
            Tab("Ứng dụng", systemImage: "square.grid.2x2.fill") {
                NavigationStack {
                    AppCatalogScreen(session: session)
                }
            }
        }
    }

    private func screen(_ title: String, unavailable: String, icon: String) -> some View {
        ContentUnavailableView(unavailable, systemImage: icon)
            .navigationTitle(title)
    }
}
