import SwiftUI

struct SettingsView: View {
    let session: OwnerSession

    var body: some View {
        Form {
            Section("Kết nối") {
                LabeledContent("Máy chủ", value: session.server)
            }
            Section {
                Button("Đăng xuất", role: .destructive) {
                    Task { await session.logout() }
                }
                .disabled(session.isWorking)
                if session.isWorking {
                    ProgressView("Đang đăng xuất…")
                }
            } footer: {
                if let message = session.message {
                    Text(message)
                        .foregroundStyle(.red)
                }
            }
        }
        .navigationTitle("Cài đặt")
    }
}
