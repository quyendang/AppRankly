import Foundation

struct APIClient {
    struct Tokens: Decodable {
        let accessToken: String
        let refreshToken: String
    }

    struct Failure: Error {
        let status: Int
        let code: String?
    }

    private struct ErrorResponse: Decodable {
        struct Body: Decodable { let code: String }
        let error: Body
    }

    private struct Password: Encodable { let password: String }
    private struct Refresh: Encodable { let refreshToken: String }

    // Credentials are bound to the configured origin, including during redirects.
    private final class NoRedirects: NSObject, URLSessionTaskDelegate {
        func urlSession(
            _ session: URLSession,
            task: URLSessionTask,
            willPerformHTTPRedirection response: HTTPURLResponse,
            newRequest request: URLRequest
        ) async -> URLRequest? { nil }
    }

    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 65
        return URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    }()

    let origin: URL

    init?(server: String) {
        guard var components = URLComponents(string: server.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = components.host, !host.isEmpty,
              ["", "/"].contains(components.path),
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              components.port.map({ (1...65535).contains($0) }) != false else { return nil }

        var allowed = components.scheme?.lowercased() == "https"
        #if DEBUG && targetEnvironment(simulator)
        allowed = allowed || (components.scheme?.lowercased() == "http" && host == "localhost")
        #endif
        guard allowed else { return nil }
        components.path = ""
        guard let url = components.url else { return nil }
        origin = url
    }

    func login(password: String) async throws -> Tokens {
        let body = try JSONEncoder().encode(Password(password: password))
        return try await decode(Tokens.self, at: ["auth", "login"], method: "POST", body: body)
    }

    func refresh(token: String) async throws -> Tokens {
        let body = try JSONEncoder().encode(Refresh(refreshToken: token))
        return try await decode(Tokens.self, at: ["auth", "refresh"], method: "POST", body: body)
    }

    func logout(accessToken: String) async throws {
        _ = try await send(to: ["auth", "logout"], method: "POST", accessToken: accessToken)
    }

    func decode<Value: Decodable & Sendable>(
        _ type: Value.Type,
        at path: [String],
        method: String = "GET",
        query: [URLQueryItem] = [],
        body: Data? = nil,
        accessToken: String? = nil
    ) async throws -> Value {
        let data = try await send(to: path, method: method, query: query, body: body, accessToken: accessToken)
        return try JSONDecoder().decode(type, from: data)
    }

    func send(
        to path: [String],
        method: String = "GET",
        query: [URLQueryItem] = [],
        body: Data? = nil,
        accessToken: String? = nil
    ) async throws -> Data {
        let endpoint = path.reduce(origin.appending(path: "api/v1")) { $0.appending(component: $1) }
        let address = query.isEmpty ? endpoint : endpoint.appending(queryItems: query)
        var request = URLRequest(url: address)
        request.httpMethod = method
        request.timeoutInterval = path.first == "auth" ? 15 : 55
        request.setValue(path == ["export"] ? "application/json, text/csv" : "application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await Self.session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(http.statusCode) else {
            let code = (try? JSONDecoder().decode(ErrorResponse.self, from: data))?.error.code
            throw Failure(status: http.statusCode, code: code)
        }
        return data
    }
}
