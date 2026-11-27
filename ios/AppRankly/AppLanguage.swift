import SwiftUI

enum AppLanguage {
    private static let bundles = Dictionary(uniqueKeysWithValues: ["vi", "en"].compactMap { language in
        Bundle.main.path(forResource: language, ofType: "lproj").flatMap(Bundle.init(path:)).map { (language, $0) }
    })

    static var identifier: String {
        UserDefaults.standard.string(forKey: "language") == "en" ? "en" : "vi"
    }

    static func text(_ key: String.LocalizationValue, language: String = identifier) -> String {
        return String(localized: key, bundle: bundles[language] ?? .main,
                      locale: Locale(identifier: language))
    }
}

extension View {
    func appNavigationTitle(_ title: String.LocalizationValue) -> some View {
        modifier(AppNavigationTitle(title: title))
    }
}

private struct AppNavigationTitle: ViewModifier {
    @Environment(\.locale) private var locale
    let title: String.LocalizationValue

    func body(content: Content) -> some View {
        content.navigationTitle(AppLanguage.text(title, language: locale.language.languageCode?.identifier ?? "vi"))
    }
}
