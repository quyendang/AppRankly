import Foundation

enum AppLanguage {
    private static let bundles = Dictionary(uniqueKeysWithValues: ["vi", "en"].compactMap { language in
        Bundle.main.path(forResource: language, ofType: "lproj").flatMap(Bundle.init(path:)).map { (language, $0) }
    })

    static var identifier: String {
        UserDefaults.standard.string(forKey: "language") == "en" ? "en" : "vi"
    }

    static func text(_ key: String.LocalizationValue) -> String {
        let language = identifier
        return String(localized: key, bundle: bundles[language] ?? .main,
                      locale: Locale(identifier: language))
    }
}
