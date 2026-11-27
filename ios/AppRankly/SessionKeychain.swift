import Foundation
import Security

enum SessionKeychain {
    struct SavedSession: Codable {
        let server: String
        let refreshToken: String
    }

    struct Failure: Error { let status: OSStatus }

    private static var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Bundle.main.bundleIdentifier ?? "AppRankly",
            kSecAttrAccount as String: "owner-session"
        ]
    }

    static func read() throws -> SavedSession? {
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw Failure(status: status) }
        return try JSONDecoder().decode(SavedSession.self, from: data)
    }

    static func save(_ session: SavedSession) throws {
        let data = try JSONEncoder().encode(session)
        let update = [kSecValueData as String: data]
        let updated = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        guard updated == errSecItemNotFound else {
            if updated != errSecSuccess { throw Failure(status: updated) }
            return
        }
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let added = SecItemAdd(item as CFDictionary, nil)
        if added != errSecSuccess { throw Failure(status: added) }
    }

    static func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound { throw Failure(status: status) }
    }
}
