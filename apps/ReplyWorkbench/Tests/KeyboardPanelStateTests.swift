import XCTest
@testable import ReplyWorkbench

@MainActor
final class KeyboardPanelStateTests: XCTestCase {
    func testDefaultIntentAndSelection() {
        var state = KeyboardPanelState()
        XCTAssertEqual(state.selectedIntent, .decline)
        XCTAssertEqual(state.previewText, ReplyTemplates.text(for: .decline))
        XCTAssertEqual(state.status, .idle)

        state.insert(into: RecordingInserter())
        state.select(.soften)
        XCTAssertEqual(state.selectedIntent, .soften)
        XCTAssertEqual(state.previewText, ReplyTemplates.text(for: .soften))
        XCTAssertEqual(state.status, .idle)

        for intent in ReplyIntent.allCases {
            state.select(intent)
            XCTAssertEqual(state.showsPlaceholderHint, intent == .confirm)
        }
    }

    func testInsertWritesCompleteTemplateEachTime() {
        var state = KeyboardPanelState()
        state.select(.confirm)
        let target = RecordingInserter()
        let expected = Array(ReplyTemplates.text(for: .confirm).utf8)

        state.insert(into: target)
        XCTAssertEqual(target.insertions, [expected])
        XCTAssertEqual(state.status, .inserted)

        state.insert(into: target)
        XCTAssertEqual(target.insertions, [expected, expected])
        XCTAssertEqual(state.status, .inserted)
    }

    func testNewlineAndDeletePreserveStatus() {
        var state = KeyboardPanelState()
        let target = RecordingInserter()

        state.insertNewline(into: target)
        XCTAssertEqual(target.insertions, [[10]])
        XCTAssertEqual(state.status, .idle)

        state.insert(into: target)
        state.insertNewline(into: target)
        XCTAssertEqual(target.insertions.last, [10])
        XCTAssertEqual(state.status, .inserted)

        state.deleteBackward(in: target)
        XCTAssertEqual(target.deletionCount, 1)
        XCTAssertEqual(state.status, .inserted)
    }

    func testPreviewDeletesOneGraphemeAndClears() {
        let target = PreviewTextInserter()
        target.deleteBackward()
        XCTAssertEqual(target.text, "")

        target.insertText("e\u{301}👩‍💻")
        target.deleteBackward()
        XCTAssertEqual(Array(target.text.utf8), Array("e\u{301}".utf8))

        target.clear()
        XCTAssertEqual(target.text, "")
    }

    private final class RecordingInserter: TextInserting {
        private(set) var insertions: [[UInt8]] = []
        private(set) var deletionCount = 0

        func insertText(_ text: String) {
            insertions.append(Array(text.utf8))
        }

        func deleteBackward() {
            deletionCount += 1
        }
    }
}
