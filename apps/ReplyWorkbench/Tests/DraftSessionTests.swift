import XCTest
@testable import ReplyWorkbench

final class DraftSessionTests: XCTestCase {
    func testTemplatesAreDistinctAndDeterministic() {
        let templates = ReplyIntent.allCases.map(ReplyTemplates.text(for:))
        XCTAssertEqual(templates.count, 4)
        XCTAssertEqual(Set(templates).count, 4)

        for intent in ReplyIntent.allCases {
            var session = DraftSession()
            XCTAssertEqual(session.select(intent), .applied)
            XCTAssertFalse(session.isDraftBlank)
            XCTAssertEqual(session.draft, ReplyTemplates.text(for: intent))
        }
    }

    @MainActor
    func testEditingClearsCopyStatusOnlyWhenTextChanges() {
        let clipboard = RecordingClipboard()
        let model = WorkbenchModel(clipboard: clipboard)
        _ = model.select(.confirm)

        model.updateDraft("  e\u{301}  ")
        model.copy()
        model.updateDraft("  e\u{301}  ")
        XCTAssertEqual(model.session.copyStatus, .copied)

        model.updateDraft("  é  ")
        XCTAssertEqual(model.session.draft, "  é  ")
        XCTAssertEqual(model.session.copyStatus, .idle)
        XCTAssertEqual(clipboard.writes.count, 1)
    }

    @MainActor
    func testBlankDraftsAreRejectedWithoutWriting() {
        let clipboard = RecordingClipboard()
        let model = WorkbenchModel(clipboard: clipboard)
        XCTAssertFalse(model.session.canCopy)
        XCTAssertEqual(model.copy(), .blankRejected)
        XCTAssertEqual(model.session.copyStatus, .blankRejected)
        _ = model.select(.decline)

        for blank in ["", "   ", "\n\t ", "\r\n", "\u{3000}"] {
            model.updateDraft(blank)
            XCTAssertTrue(model.session.isDraftBlank)
            XCTAssertFalse(model.session.canCopy)
            XCTAssertEqual(model.copy(), .blankRejected)
            XCTAssertEqual(model.session.copyStatus, .blankRejected)
        }

        XCTAssertTrue(clipboard.writes.isEmpty)
        model.updateDraft("\u{200B}")
        XCTAssertFalse(model.session.isDraftBlank)
        XCTAssertTrue(model.session.canCopy)
    }

    @MainActor
    func testCopyPreservesOriginalTextAndWritesOnEveryTap() {
        let clipboard = RecordingClipboard()
        let model = WorkbenchModel(clipboard: clipboard)
        let draft = "  👩‍💻 e\u{301}\r\n收到。\t "
        _ = model.select(.soften)
        model.updateDraft(draft)

        model.copy()
        model.copy()

        XCTAssertEqual(clipboard.writes.map { Array($0.utf8) }, [Array(draft.utf8), Array(draft.utf8)])
        XCTAssertEqual(model.session.copyStatus, .copied)
        XCTAssertEqual(model.session.lastCopiedText, draft)
    }

    func testUneditedAndBlankDraftsSwitchWithoutConfirmation() {
        var session = DraftSession()
        XCTAssertEqual(session.select(.decline), .applied)
        XCTAssertEqual(session.select(.decline), .unchanged)
        XCTAssertEqual(session.select(.confirm), .applied)
        XCTAssertEqual(session.draft, ReplyTemplates.text(for: .confirm))

        session.updateDraft("\u{3000}")
        XCTAssertEqual(session.select(.confirm), .applied)
        XCTAssertEqual(session.draft, ReplyTemplates.text(for: .confirm))

        session.updateDraft("")
        XCTAssertEqual(session.select(.followUp), .applied)
        XCTAssertEqual(session.draft, ReplyTemplates.text(for: .followUp))
        XCTAssertNil(session.pendingIntent)
    }

    func testProtectedEditsCanBeKeptOrReplaced() {
        var session = DraftSession()
        _ = session.select(.soften)
        let editedDraft = "晚一点再聊。"
        session.updateDraft(editedDraft)
        session.markCopied(editedDraft)
        let original = session

        XCTAssertEqual(session.select(.decline), .needsConfirmation)
        XCTAssertEqual(session.pendingIntent, .decline)
        XCTAssertEqual(session.selectedIntent, .soften)
        XCTAssertEqual(session.draft, editedDraft)
        session.cancelReplacement()
        XCTAssertEqual(session, original)

        XCTAssertEqual(session.select(.soften), .needsConfirmation)
        session.confirmReplacement()
        XCTAssertEqual(session.selectedIntent, .soften)
        XCTAssertEqual(session.draft, ReplyTemplates.text(for: .soften))
        XCTAssertNil(session.pendingIntent)
        XCTAssertNil(session.lastCopiedText)
        XCTAssertEqual(session.copyStatus, .idle)

        session.updateDraft(editedDraft)
        XCTAssertEqual(session.select(.decline), .needsConfirmation)
        session.confirmReplacement()
        XCTAssertEqual(session.selectedIntent, .decline)
        XCTAssertEqual(session.draft, ReplyTemplates.text(for: .decline))
        XCTAssertNil(session.pendingIntent)
    }
}

private final class RecordingClipboard: ClipboardWriting {
    private(set) var writes: [String] = []

    func write(_ text: String) {
        writes.append(text)
    }
}
