import SwiftUI

struct StoreAnalysisScreen: View {
    private enum Kind: String, CaseIterable, Identifiable {
        case audit, variants, reviews, ask
        var id: Self { self }
        var title: LocalizedStringKey {
            switch self {
            case .audit: "Đánh giá trang store"
            case .variants: "Gợi ý nội dung"
            case .reviews: "Tổng hợp review"
            case .ask: "Hỏi về ứng dụng"
            }
        }
    }
    private struct Request: Encodable {
        let appId: String
        let kind: String
        let question: String
        let includeMetrics: Bool
        let locale: String
        let range: ReportRange
    }
    private struct Preview: Decodable {
        let previewId: String
        let destination: ReviewAIPreview.Destination
        let payloadJSON: String
    }
    private struct Result: Decodable {
        let summary: String
        let recommendations: [String]
        let candidates: [String]
    }
    private struct Response: Decodable {
        let result: Result?
        let provider: String?
        let model: String?
    }

    let session: OwnerSession
    let app: StoreApp
    var range: ReportRange = .recent(30)
    @Environment(\.locale) private var locale
    @State private var kind = Kind.audit
    @State private var question = ""
    @State private var includeMetrics = false
    @State private var preview: Preview?
    @State private var output: Response?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Form {
            Section("Phân tích") {
                Picker("Tác vụ", selection: $kind) {
                    ForEach(Kind.allCases) { Text($0.title).tag($0) }
                }
                TextField("Câu hỏi hoặc ngữ cảnh", text: $question, axis: .vertical).lineLimit(2...5)
                Toggle("Kèm số liệu riêng", isOn: $includeMetrics)
                if includeMetrics { LabeledContent("Khoảng thời gian", value: range.label) }
                Button("Tạo bản xem trước") { Task { await makePreview() } }.disabled(busy || question.utf16.count > 1000)
            }
            .disabled(busy)
            if let preview {
                Section("Dữ liệu gửi AI") {
                    LabeledContent("Nhà cung cấp", value: preview.destination.provider)
                    if let model = preview.destination.model { LabeledContent("Mô hình", value: model) }
                    if let origin = preview.destination.origin { Text(origin).textSelection(.enabled) }
                    Text(preview.payloadJSON).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                    Button("Xác nhận và phân tích") { Task { await analyze(preview) } }.disabled(busy)
                }
            }
            if let output, let result = output.result {
                Section("Phân tích gần nhất") {
                    if let model = output.model { Text(model).font(.footnote).foregroundStyle(.secondary) }
                    Text(result.summary).textSelection(.enabled)
                    ForEach(result.recommendations.indices, id: \.self) { Text(result.recommendations[$0]).textSelection(.enabled) }
                    ForEach(result.candidates.indices, id: \.self) { Text(result.candidates[$0]).textSelection(.enabled) }
                }
            }
            if busy { ProgressView("Đang xử lý…") }
            if let error { Text(error).foregroundStyle(.secondary) }
        }
        .navigationTitle("Phân tích AI")
        .onChange(of: kind) { preview = nil; error = nil }
        .onChange(of: question) { preview = nil; error = nil }
        .onChange(of: includeMetrics) { preview = nil; error = nil }
        .task { await load() }
    }

    private func load() async {
        await perform { output = try await session.get(Response.self, at: ["apps", app.id, "ai", "latest"]) }
    }

    private func makePreview() async {
        await perform {
            preview = try await session.write(Preview.self, at: ["ai", "previews"],
                body: Request(appId: app.id, kind: kind.rawValue, question: question, includeMetrics: includeMetrics,
                              locale: locale.language.languageCode?.identifier == "en" ? "en" : "vi", range: range))
        }
    }

    private func analyze(_ preview: Preview) async {
        await perform {
            self.preview = nil
            output = try await session.write(Response.self, at: ["ai", "runs"], body: ReviewAIConfirmation(previewId: preview.previewId))
        }
    }

    private func perform(_ work: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        do { try await work() }
        catch { if !Task.isCancelled { self.error = OwnerMessage.text(error) } }
    }
}
