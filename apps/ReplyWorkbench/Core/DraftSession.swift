import Foundation

enum CopyStatus: Equatable {
    case idle, copied, blankRejected
}

enum SelectionOutcome: Equatable {
    case applied, unchanged, needsConfirmation
}

struct DraftSession: Equatable {
    private static let blankCharacters = CharacterSet.whitespacesAndNewlines
        .subtracting(CharacterSet(charactersIn: "\u{200B}"))

    private(set) var selectedIntent: ReplyIntent?
    private(set) var draft = ""
    private(set) var pendingIntent: ReplyIntent?
    private(set) var copyStatus: CopyStatus = .idle
    private(set) var lastCopiedText: String?

    var isDraftBlank: Bool {
        draft.trimmingCharacters(in: Self.blankCharacters).isEmpty
    }

    var canCopy: Bool { selectedIntent != nil && !isDraftBlank }

    var hasProtectedEdits: Bool {
        guard let selectedIntent, !isDraftBlank else { return false }
        return !draft.utf8.elementsEqual(ReplyTemplates.text(for: selectedIntent).utf8)
    }

    mutating func select(_ intent: ReplyIntent) -> SelectionOutcome {
        if hasProtectedEdits {
            pendingIntent = intent
            return .needsConfirmation
        }
        if selectedIntent == intent && !isDraftBlank {
            return .unchanged
        }
        applyTemplate(for: intent)
        return .applied
    }

    mutating func confirmReplacement() {
        guard let pendingIntent else { return }
        applyTemplate(for: pendingIntent)
    }

    mutating func cancelReplacement() {
        pendingIntent = nil
    }

    mutating func updateDraft(_ text: String) {
        guard selectedIntent != nil else { return }
        draft = text
        if lastCopiedText?.utf8.elementsEqual(text.utf8) != true {
            copyStatus = .idle
        }
    }

    func copyPayload() -> String? {
        canCopy ? draft : nil
    }

    mutating func markCopied(_ text: String) {
        copyStatus = .copied
        lastCopiedText = text
    }

    mutating func markBlankRejected() {
        copyStatus = .blankRejected
    }

    private mutating func applyTemplate(for intent: ReplyIntent) {
        selectedIntent = intent
        draft = ReplyTemplates.text(for: intent)
        pendingIntent = nil
        copyStatus = .idle
        lastCopiedText = nil
    }
}
