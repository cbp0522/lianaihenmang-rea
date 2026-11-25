import Combine

@MainActor
final class WorkbenchModel: ObservableObject {
    @Published private(set) var session = DraftSession()
    private let clipboard: any ClipboardWriting

    init(clipboard: any ClipboardWriting) {
        self.clipboard = clipboard
    }

    func select(_ intent: ReplyIntent) -> SelectionOutcome {
        session.select(intent)
    }

    func confirmReplacement() {
        session.confirmReplacement()
    }

    func cancelReplacement() {
        session.cancelReplacement()
    }

    func undoReplacement() {
        session.undoReplacement()
    }

    func updateDraft(_ text: String) {
        session.updateDraft(text)
    }

    @discardableResult
    func copy() -> CopyStatus {
        guard let payload = session.copyPayload() else {
            session.markBlankRejected()
            return .blankRejected
        }
        clipboard.write(payload)
        session.markCopied(payload)
        return .copied
    }
}
