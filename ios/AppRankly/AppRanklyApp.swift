import SwiftUI

@main
struct AppRanklyApp: App {
    @State private var session = OwnerSession()

    var body: some Scene {
        WindowGroup {
            Group {
                switch session.phase {
                case .restoring:
                    ProgressView("Đang mở phiên…")
                case .locked:
                    ContentUnavailableView {
                        Label("Chưa mở được phiên", systemImage: "lock")
                    } description: {
                        Text(session.message ?? "Kiểm tra kết nối rồi thử lại.")
                    } actions: {
                        Button("Thử lại") { Task { await session.restore() } }
                            .buttonStyle(.borderedProminent)
                        Button("Đổi máy chủ", role: .destructive) {
                            session.forgetServer()
                        }
                    }
                    .disabled(session.isWorking)
                case .signedOut:
                    LoginView(session: session)
                case .signedIn:
                    AppTabs(session: session)
                }
            }
            .tint(Color("AccentColor"))
            .onChange(of: session.message) { _, message in
                if let message { AccessibilityNotification.Announcement(message).post() }
            }
            .task {
                if session.phase == .restoring { await session.restore() }
            }
        }
    }
}
