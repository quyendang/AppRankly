import SwiftUI

struct ReviewDetailScreen: View {
    let session: OwnerSession
    let app: StoreApp
    let reviewId: String
    @State private var review: MobileReview?
    @State private var source: ReviewSource?
    @State private var showingComposer = false
    @State private var loading = false
    @State private var error: String?

    init(session: OwnerSession, app: StoreApp, reviewId: String, initial: MobileReview? = nil) {
        self.session = session
        self.app = app
        self.reviewId = reviewId
        _review = State(initialValue: initial)
    }

    var body: some View {
        List {
            if let review {
                Section {
                    LabeledContent("Ứng dụng", value: app.name)
                    LabeledContent("Store", value: app.platform.title)
                    if let rating = review.rating { LabeledContent("Đánh giá", value: "\(rating)/5 sao") }
                    if let date = review.date { LabeledContent("Ngày", value: ReviewDate.display(date)) }
                    if let market = review.territory { LabeledContent("Thị trường", value: market) }
                }
                Section(review.displayAuthor) {
                    Text(review.text.isEmpty ? "Review không có nội dung." : review.text)
                        .textSelection(.enabled)
                }
                Section("Phản hồi của bạn") {
                    Text(review.statusTitle).font(.subheadline).foregroundStyle(.secondary)
                    if let reply = review.replyText { Text(reply).textSelection(.enabled) }
                    if let date = review.replyDate { Text(ReviewDate.display(date)).font(.footnote).foregroundStyle(.secondary) }
                    if source?.status == "unavailable" {
                        Text("Store chưa đồng bộ được. Nội dung bên trên là dữ liệu đã lưu.").foregroundStyle(.secondary)
                    }
                    if review.canReply {
                        Button(review.replyText == nil ? "Soạn phản hồi" : "Sửa phản hồi") { showingComposer = true }
                    } else {
                        Text("Review từ nguồn chỉ đọc.").foregroundStyle(.secondary)
                    }
                }
            }
            if loading && review == nil { ProgressView("Đang tải review…") }
            if let error {
                Text(error).foregroundStyle(.secondary)
                Button("Thử lại") { Task { await load() } }
            }
        }
        .appNavigationTitle("Chi tiết review")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .sheet(isPresented: $showingComposer, onDismiss: { Task { await load() } }) {
            if let review { ReviewComposer(session: session, reviews: [review]) }
        }
    }

    private func load() async {
        guard !loading else { return }
        loading = true
        error = nil
        defer { loading = false }
        do {
            let result = try await session.get(ReviewDetailResponse.self, at: ["apps", app.id, "reviews", reviewId])
            guard !Task.isCancelled else { return }
            review = result.review
            source = result.source
        } catch {
            guard !Task.isCancelled, !(error is CancellationError) else { return }
            self.error = ReviewMessage.text(error)
        }
    }
}
