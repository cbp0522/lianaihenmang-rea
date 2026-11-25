import Foundation

enum InsertStatus: Equatable {
    case idle, inserted
}

struct KeyboardPanelState: Equatable {
    private(set) var selectedIntent: ReplyIntent = .decline
    private(set) var status: InsertStatus = .idle

    var previewText: String { ReplyTemplates.text(for: selectedIntent) }
    var showsPlaceholderHint: Bool { selectedIntent == .confirm }

    mutating func select(_ intent: ReplyIntent) {
        selectedIntent = intent
        status = .idle
    }

    @MainActor
    mutating func insert(into target: TextInserting) {
        target.insertText(previewText)
        status = .inserted
    }

    @MainActor
    func insertNewline(into target: TextInserting) {
        target.insertText("\n")
    }

    @MainActor
    func deleteBackward(in target: TextInserting) {
        target.deleteBackward()
    }
}
