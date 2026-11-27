import Foundation
import Observation

@MainActor
@Observable
final class OwnerSession {
    enum Phase { case restoring, locked, signedOut, signedIn }

    private(set) var phase = Phase.restoring
    private(set) var isWorking = false
    private(set) var server = ""
    private(set) var message: String?

    private var client: APIClient?
    private var tokens: APIClient.Tokens?
    private var authenticationID = UUID()
    private var renewal: Task<APIClient.Tokens, Error>?
    private var exchangeRequest: Task<ExchangeRates, Error>?
    private var lastExchange: (ExchangeRates, Date)?
    private let artwork: NSCache<NSString, NSData> = {
        let cache = NSCache<NSString, NSData>()
        cache.totalCostLimit = 8 * 1024 * 1024
        return cache
    }()

    func restore() async {
        guard !isWorking, phase == .restoring || phase == .locked else { return }
        isWorking = true
        message = nil
        defer { isWorking = false }
        do {
            guard let saved = try SessionKeychain.read() else {
                phase = .signedOut
                return
            }
            server = saved.server
            guard let api = APIClient(server: server) else {
                try SessionKeychain.clear()
                phase = .signedOut
                return
            }
            let pair = try await api.refresh(token: saved.refreshToken)
            try await keep(pair, for: api)
            phase = .signedIn
        } catch let error as APIClient.Failure where error.status == 401 {
            do {
                try SessionKeychain.clear()
                phase = .signedOut
                message = "Phiên đã hết hạn. Đăng nhập lại để tiếp tục."
            } catch {
                phase = .locked
                message = description(for: error)
            }
        } catch {
            phase = .locked
            message = description(for: error)
        }
    }

    func login(server: String, password: String) async {
        guard !isWorking, phase == .signedOut else { return }
        guard let api = APIClient(server: server) else {
            message = "Nhập địa chỉ HTTPS của máy chủ AppRankly."
            return
        }

        isWorking = true
        message = nil
        defer { isWorking = false }
        do {
            let pair = try await api.login(password: password)
            try await keep(pair, for: api)
            phase = .signedIn
        } catch {
            message = description(for: error)
        }
    }

    func logout() async {
        guard !isWorking, let api = client, let pair = tokens else { return }
        isWorking = true
        message = nil
        defer { isWorking = false }
        do {
            do {
                let current = try await renewal?.value ?? pair
                try await api.logout(accessToken: current.accessToken)
            } catch let error as APIClient.Failure where error.status == 401 {
                do {
                    let fresh = try await renew(api, rejecting: tokens?.accessToken ?? pair.accessToken)
                    try await api.logout(accessToken: fresh.accessToken)
                } catch let error as APIClient.Failure where error.status == 401 {
                    // The server has already invalidated this session.
                }
            }
            try clearSession()
        } catch {
            message = description(for: error)
        }
    }

    func get<Value: Decodable & Sendable>(_ type: Value.Type, at path: [String], range: ReportRange? = nil) async throws -> Value {
        try await authorized { api, token in
            try await api.decode(type, at: path, query: range?.query ?? [], accessToken: token)
        }
    }

    func icon(for app: StoreApp) async throws -> Data {
        let key = app.id as NSString
        if let cached = artwork.object(forKey: key) { return cached as Data }
        let data = try await authorized { api, token in
            try await api.send(to: ["apps", app.id, "icon"], accessToken: token)
        }
        artwork.setObject(data as NSData, forKey: key, cost: data.count)
        return data
    }

    func exchangeRates() async throws -> ExchangeRates {
        if let (rates, date) = lastExchange, Date.now.timeIntervalSince(date) < 60 { return rates }
        if let exchangeRequest { return try await exchangeRequest.value }
        let sessionID = authenticationID
        let task = Task { try await get(ExchangeRates.self, at: ["exchange-rates"]) }
        exchangeRequest = task
        defer { if sessionID == authenticationID { exchangeRequest = nil } }
        let rates = try await task.value
        guard sessionID == authenticationID else { throw CancellationError() }
        lastExchange = (rates, .now)
        return rates
    }

    private func authorized<Value>(_ fetch: (APIClient, String) async throws -> Value) async throws -> Value {
        guard let api = client, let pair = tokens, phase == .signedIn, !isWorking else {
            throw APIClient.Failure(status: 401, code: "AUTH_REQUIRED")
        }
        let sessionID = authenticationID
        do {
            let value = try await fetch(api, pair.accessToken)
            guard sessionID == authenticationID else { throw CancellationError() }
            return value
        } catch let error as APIClient.Failure where error.status == 401 {
            try Task.checkCancellation()
            guard !isWorking, sessionID == authenticationID else { throw error }
            let fresh = try await renew(api, rejecting: pair.accessToken)
            try Task.checkCancellation()
            guard sessionID == authenticationID, !isWorking else { throw CancellationError() }
            let value = try await fetch(api, fresh.accessToken)
            guard sessionID == authenticationID else { throw CancellationError() }
            return value
        }
    }

    private func renew(_ api: APIClient, rejecting rejectedToken: String) async throws -> APIClient.Tokens {
        guard let pair = tokens else { throw APIClient.Failure(status: 401, code: "AUTH_REQUIRED") }
        if pair.accessToken != rejectedToken { return pair }
        if let renewal { return try await renewal.value }
        let task = Task {
            do {
                let fresh = try await api.refresh(token: pair.refreshToken)
                try await keep(fresh, for: api)
                return fresh
            } catch let error as APIClient.Failure where error.status == 401 {
                try clearSession()
                message = "Phiên đã hết hạn. Đăng nhập lại để tiếp tục."
                throw error
            }
        }
        renewal = task
        defer { renewal = nil }
        return try await task.value
    }

    private func clearSession() throws {
        try SessionKeychain.clear()
        authenticationID = UUID()
        client = nil
        tokens = nil
        lastExchange = nil
        artwork.removeAllObjects()
        exchangeRequest?.cancel()
        exchangeRequest = nil
        phase = .signedOut
    }

    func forgetServer() {
        guard !isWorking, phase == .locked else { return }
        do {
            try SessionKeychain.clear()
            server = ""
            message = nil
            phase = .signedOut
        } catch {
            message = description(for: error)
        }
    }

    private func keep(_ pair: APIClient.Tokens, for api: APIClient) async throws {
        do {
            try SessionKeychain.save(.init(server: api.origin.absoluteString, refreshToken: pair.refreshToken))
        } catch {
            try? await api.logout(accessToken: pair.accessToken)
            throw error
        }
        client = api
        tokens = pair
        server = api.origin.absoluteString
    }

    private func description(for error: Error) -> String {
        if error is SessionKeychain.Failure { return "Không truy cập được Keychain. Mở khóa iPhone rồi thử lại." }
        switch (error as? APIClient.Failure)?.code {
        case "INVALID_LOGIN": return "Mật khẩu chưa đúng."
        case "LOGIN_RATE_LIMIT", "RATE_LIMIT": return "Đã thử quá nhiều lần. Chờ một lúc rồi thử lại."
        case "NOT_FOUND": return "Máy chủ chưa có API cho iOS. Kiểm tra địa chỉ và phiên bản backend."
        default: return "Không hoàn tất được yêu cầu. Kiểm tra kết nối và địa chỉ máy chủ rồi thử lại."
        }
    }
}
