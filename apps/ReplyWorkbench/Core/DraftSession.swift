import Foundation

enum CopyStatus: Equatable {
    case idle, copied, blankRejected
}

enum SelectionOutcome: Equatable {
    case applied, unchanged, needsConfirmation
}

struct DraftSession: Equatable {
    private struct ReplacementSnapshot: Equatable {
        let intent: ReplyIntent
        let draft: String
    }

    private static let blankCharacters = CharacterSet.whitespacesAndNewlines
        .subtracting(CharacterSet(charactersIn: "\u{200B}"))

    private(set) var selectedIntent: ReplyIntent?
    private(set) var draft = ""
    private(set) var pendingIntent: ReplyIntent?
    private(set) var copyStatus: CopyStatus = .idle
    private(set) var lastCopiedText: String?
    private var replacementSnapshot: ReplacementSnapshot?

    var isDraftBlank: Bool {
        draft.trimmingCharacters(in: Self.blankCharacters).isEmpty
    }

    var canCopy: Bool { selectedIntent != nil && !isDraftBlank }
    var canUndoReplacement: Bool { replacementSnapshot != nil }

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
        guard let pendingIntent, let selectedIntent else { return }
        let snapshot = ReplacementSnapshot(intent: selectedIntent, draft: draft)
        applyTemplate(for: pendingIntent)
        replacementSnapshot = snapshot
    }

    mutating func cancelReplacement() {
        pendingIntent = nil
    }

    mutating func undoReplacement() {
        guard let replacementSnapshot else { return }
        selectedIntent = replacementSnapshot.intent
        draft = replacementSnapshot.draft
        copyStatus = .idle
        lastCopiedText = nil
        self.replacementSnapshot = nil
    }

    mutating func updateDraft(_ text: String) {
        guard selectedIntent != nil else { return }
        if replacementSnapshot != nil, !draft.utf8.elementsEqual(text.utf8) {
            replacementSnapshot = nil
        }
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
        replacementSnapshot = nil
    }
}
