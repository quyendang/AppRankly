import SwiftUI

struct AppPicker: View {
    let apps: [StoreApp]
    var includesAll = false
    @Binding var selection: String

    var body: some View {
        Picker("Ứng dụng", selection: $selection) {
            if includesAll {
                Label("Tất cả ứng dụng", systemImage: "square.grid.2x2").tag("")
            }
            ForEach(apps) { app in
                AppChoiceLabel(name: app.name, platform: app.platform).tag(app.id)
            }
        }
        .pickerStyle(.navigationLink)
        .accessibilityIdentifier("app-picker")
    }
}

struct AppChoiceLabel: View {
    let name: String
    let platform: StorePlatform

    var body: some View {
        Label {
            Text(name)
        } icon: {
            switch platform {
            case .apple:
                Image(systemName: "apple.logo")
            case .google:
                Image("AndroidPlatform")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 18, height: 18)
            }
        }
        .accessibilityLabel(Text("\(name), \(platform.title)"))
    }
}
