import SwiftUI

struct LoginView: View {
    let session: OwnerSession

    @State private var server: String
    @State private var password = ""
    @FocusState private var passwordFocused: Bool

    init(session: OwnerSession) {
        self.session = session
        _server = State(initialValue: session.server)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Máy chủ AppRankly") {
                    TextField("Địa chỉ máy chủ", text: $server, prompt: Text("https://"))
                        .accessibilityLabel("Địa chỉ máy chủ")
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.next)
                        .onSubmit { passwordFocused = true }
                }
                Section("Tài khoản chủ app") {
                    SecureField("Mật khẩu", text: $password)
                        .accessibilityLabel("Mật khẩu")
                        .textContentType(.password)
                        .focused($passwordFocused)
                        .submitLabel(.go)
                        .onSubmit { submit() }
                }
                Section {
                    Button("Đăng nhập", action: submit)
                        .disabled(server.isEmpty || password.isEmpty || session.isWorking)
                    if session.isWorking {
                        ProgressView("Đang đăng nhập…")
                    }
                } footer: {
                    if let message = session.message {
                        Text(message)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("AppRankly")
        }
    }

    private func submit() {
        guard !server.isEmpty, !password.isEmpty, !session.isWorking else { return }
        passwordFocused = false
        Task {
            await session.login(server: server, password: password)
            if session.phase == .signedIn { password = "" }
        }
    }
}
