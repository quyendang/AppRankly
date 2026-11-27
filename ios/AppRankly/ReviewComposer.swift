import SwiftUI

struct ReviewComposer: View {
    private enum Step { case editing, aiPreview, confirming, results }

    let session: OwnerSession
    let reviews: [MobileReview]
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var step = Step.editing
    @State private var templates: [ReviewTemplate] = []
    @State private var preview: ReviewAIPreview?
    @State private var attempts: [ReviewWrite] = []
    @State private var results: [ReviewBulkResponse.Item] = []
    @State private var error: String?
    @State private var busy = false
    @State private var uncertain = false
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            Form {
                if let first = reviews.first {
                    Section {
                        LabeledContent("Ứng dụng", value: first.app.name)
                        LabeledContent("Store", value: first.app.platform.title)
                    }
                    switch step {
                    case .editing:
                        editor(first)
                    case .aiPreview:
                        if let preview { consent(preview) }
                    case .confirming:
                        confirmation
                    case .results:
                        outcome
                    }
                }
                if busy { ProgressView(step == .confirming ? "Đang xử lý phản hồi…" : "Đang xử lý…") }
                if let error { Text(error).foregroundStyle(.secondary) }
            }
            .navigationTitle(reviews.count > 1 ? "Phản hồi hàng loạt" : "Soạn phản hồi")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if step != .results {
                        Button("Đóng", systemImage: "xmark") { dismiss() }.disabled(busy)
                    }
                }
            }
        }
        .interactiveDismissDisabled(busy)
        .task { await prepare() }
        .onChange(of: text) {
            persist()
        }
        .onChange(of: error) { _, message in
            if let message { AccessibilityNotification.Announcement(message).post() }
        }
    }

    private var proposal: [(review: MobileReview, text: String)] {
        reviews.map { review in
            let formatted = reviews.count == 1 ? text
                : ReviewTemplate(id: 0, name: "", body: text).rendered(for: review)
            return (review, formatted.trimmingCharacters(in: .whitespacesAndNewlines))
        }
    }
    private var allowed: Bool {
        !proposal.isEmpty && proposal.allSatisfy { !$0.text.isEmpty && $0.text.utf16.count <= $0.review.replyLimit }
    }

    private func editor(_ first: MobileReview) -> some View {
        Group {
            if reviews.count == 1 {
                Section(first.displayAuthor) {
                    Text(first.text).foregroundStyle(.secondary).textSelection(.enabled)
                }
            }
            Section {
                TextEditor(text: $text)
                    .frame(minHeight: 105)
                    .accessibilityLabel("Nội dung phản hồi")
                    .disabled(busy)
                LabeledContent("Ký tự", value: "\(proposal.map { $0.text.utf16.count }.max() ?? 0)/\(first.replyLimit)")
                    .foregroundStyle(.secondary)
                if !templates.isEmpty {
                    Menu("Chèn mẫu phản hồi") {
                        ForEach(templates) { template in
                            Button(template.name) {
                                text = reviews.count == 1 ? template.rendered(for: first) : template.body
                            }
                        }
                    }
                    .disabled(busy)
                }
                if reviews.count == 1 {
                    Button("Soạn bằng AI", systemImage: "sparkles") { Task { await requestPreview(for: first) } }
                        .disabled(busy)
                }
            } header: {
                Text("Phản hồi công khai")
            } footer: {
                if reviews.count > 1 { Text("Có thể dùng {name}, {rating} và {app} cho từng review.") }
            }
            Button("Xem trước phản hồi") { prepareConfirmation() }
                .disabled(!allowed || busy)
        }
    }

    private func consent(_ preview: ReviewAIPreview) -> some View {
        Group {
            Section("Dữ liệu gửi đến AI") {
                LabeledContent("Nhà cung cấp", value: preview.destination.provider)
                if let origin = preview.destination.origin { Text(origin).textSelection(.enabled) }
                if let model = preview.destination.model { LabeledContent("Mô hình", value: model) }
                LabeledContent("Ứng dụng", value: preview.payload.app)
                if let rating = preview.payload.review.rating { LabeledContent("Đánh giá", value: "\(rating)/5") }
                if let language = preview.payload.review.language, !language.isEmpty { LabeledContent("Ngôn ngữ", value: language) }
                Text(preview.payload.review.text).textSelection(.enabled)
                LabeledContent("Giới hạn", value: "\(preview.payload.replyLimit) ký tự")
                DisclosureGroup("Chỉ dẫn gửi kèm") { Text(preview.payload.instruction) }
            }
            Section {
                Button("Tạo bản nháp AI") { Task { await generate(preview) } }.disabled(busy)
                Button("Quay lại soạn") { step = .editing; error = nil }.disabled(busy)
            } footer: {
                Text("AI tạo nội dung để bạn chỉnh sửa. Bạn xác nhận riêng khi gửi lên store.")
            }
        }
    }

    private var confirmation: some View {
        Group {
            Section {
                ForEach(proposal, id: \.review.id) { item in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(item.review.displayAuthor).font(.headline)
                        Text(item.text).textSelection(.enabled)
                    }
                }
            } header: {
                Text("Xác nhận nội dung")
            } footer: {
                Text("Phản hồi sẽ xuất hiện công khai trên store sau khi được xử lý.")
            }
            Section {
                Button(uncertain ? "Kiểm tra lại lần gửi" : "Gửi công khai") {
                    Task { await publish() }
                }
                .disabled(busy)
                Button("Quay lại soạn") { step = .editing; error = nil }.disabled(busy || uncertain)
            }
        }
    }

    private var outcome: some View {
        Group {
            Section("Kết quả gửi") {
                ForEach(results.indices, id: \.self) { index in
                    let item = results[index]
                    let name = reviews.first { $0.id == item.reviewId }?.displayAuthor ?? "Review"
                    VStack(alignment: .leading, spacing: 5) {
                        Text(name).font(.headline)
                        if let review = item.review {
                            Label(review.replyState == "pending" ? "Store đã nhận, chờ hiển thị" : "Đã gửi phản hồi",
                                systemImage: "checkmark.circle")
                        } else {
                            Text(ReviewMessage.text(item.error)).foregroundStyle(.secondary)
                        }
                    }
                }
                if results.contains(where: { ReviewMessage.isUncertain($0.error) }) {
                    Button("Kiểm tra lại các lần gửi chưa rõ") { Task { await publish() } }.disabled(busy)
                }
            }
            Button("Xong") { dismiss() }.disabled(busy)
        }
    }

    private func prepare() async {
        guard !loaded else { return }
        if let saved = session.reviewDraft(for: reviews) {
            text = saved.text
            attempts = saved.attempts
        } else if reviews.count == 1 {
            text = reviews.first?.replyText ?? ""
        }
        loaded = true
        if let available = try? await session.get(ReviewTemplates.self, at: ["review-templates"]) {
            templates = available.templates
        }
    }

    private func persist() {
        guard loaded, step != .results else { return }
        session.saveReviewDraft(.init(text: text, attempts: attempts), for: reviews)
    }

    private func prepareConfirmation() {
        guard allowed else { return }
        let existing = Dictionary(uniqueKeysWithValues: attempts.map { ($0.reviewId, $0) })
        attempts = proposal.map { item in
            if let saved = existing[item.review.id], saved.text == item.text,
               saved.expectedRevision == item.review.revision { return saved }
            return ReviewWrite(item.review, text: item.text)
        }
        uncertain = false
        error = nil
        step = .confirming
        persist()
    }

    private func requestPreview(for review: MobileReview) async {
        await perform {
            preview = try await session.write(ReviewAIPreview.self, at: ["ai", "previews"],
                body: ReviewAIRequest(appId: review.app.id, reviewId: review.id))
            step = .aiPreview
        }
    }

    private func generate(_ preview: ReviewAIPreview) async {
        await perform {
            let result = try await session.write(ReviewAIResult.self, at: ["ai", "runs"],
                body: ReviewAIConfirmation(previewId: preview.previewId))
            text = result.text
            step = .editing
            self.preview = nil
        }
    }

    private func publish() async {
        guard let first = reviews.first, !attempts.isEmpty, !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            let updated: [ReviewBulkResponse.Item]
            if attempts.count == 1, let attempt = attempts.first {
                let result = try await session.write(ReviewResponse.self,
                    at: ["apps", first.app.id, "reviews", attempt.reviewId, "reply"], method: "PUT", body: attempt)
                updated = [.init(reviewId: attempt.reviewId, review: result.review, error: nil)]
            } else {
                updated = try await session.write(ReviewBulkResponse.self,
                    at: ["apps", first.app.id, "reviews", "bulk-replies"], body: ReviewBulk(items: attempts)).results
            }
            results = updated
            step = .results
            if updated.allSatisfy({ $0.review != nil }) {
                session.saveReviewDraft(nil, for: reviews)
            } else {
                session.saveReviewDraft(.init(text: text, attempts: attempts), for: reviews)
            }
            if updated.contains(where: { $0.review != nil }) { session.reviewsChanged() }
        } catch {
            let code = (error as? APIClient.Failure)?.code
            uncertain = code == nil || ReviewMessage.isUncertain(code)
            self.error = uncertain ? ReviewMessage.text("REVIEW_REPLY_UNCERTAIN") : ReviewMessage.text(error)
            if !uncertain {
                attempts = []
                step = .editing
            }
            persist()
        }
    }

    private func perform(_ operation: () async throws -> Void) async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        do { try await operation() }
        catch { if !Task.isCancelled { self.error = ReviewMessage.text(error) } }
    }
}
