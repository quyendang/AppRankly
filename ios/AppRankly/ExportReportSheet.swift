import SwiftUI
import UniformTypeIdentifiers
import CoreTransferable

struct ReportExport: Transferable {
    let data: Data
    let format: String

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .commaSeparatedText) { $0.data }
            .exportingCondition { $0.format == "csv" }
            .suggestedFileName { _ in "apprankly.csv" }
        DataRepresentation(exportedContentType: .json) { $0.data }
            .exportingCondition { $0.format == "json" }
            .suggestedFileName { _ in "apprankly.json" }
    }
}

struct ExportReportSheet: View {
    let session: OwnerSession
    let range: ReportRange
    let appId: String
    @Environment(\.dismiss) private var dismiss
    @State private var format = "csv"
    @State private var file: ReportExport?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                LabeledContent("Khoảng thời gian", value: range.label)
                Picker("Định dạng", selection: $format) {
                    Text("CSV").tag("csv")
                    Text("JSON").tag("json")
                }
                .disabled(busy)
                if let file {
                    ShareLink(item: file, preview: SharePreview("AppRankly")) {
                        Label("Chia sẻ báo cáo", systemImage: "square.and.arrow.up")
                    }
                } else {
                    Button("Chuẩn bị tệp") { Task { await load() } }.disabled(busy)
                }
                if busy { ProgressView("Đang chuẩn bị báo cáo…") }
                if let error { Text(error).foregroundStyle(.secondary) }
            }
            .appNavigationTitle("Xuất báo cáo")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Đóng") { dismiss() } } }
        }
        .onChange(of: format) { file = nil; error = nil }
    }

    private func load() async {
        guard !busy else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            file = try await ReportExport(data: session.exportReport(format: format, range: range, appId: appId), format: format)
        } catch {
            self.error = OwnerMessage.text(error)
        }
    }
}
