import XCTest

final class ReplyWorkbenchUITests: XCTestCase {
    @MainActor
    func testMainPath() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()

        let editor = app.textViews["draftEditor"]
        let copy = app.buttons["copyDraft"]
        XCTAssertTrue(app.staticTexts["emptyStateHint"].exists)
        XCTAssertFalse(editor.exists)
        XCTAssertFalse(copy.isEnabled)
        attachScreenshot("未选择意图")

        let soften = app.buttons["intent.soften"]
        soften.tap()
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        let template = editor.value as? String ?? ""
        XCTAssertFalse(template.isEmpty)
        XCTAssertTrue(copy.isEnabled)

        focusAtEnd(of: editor)
        editor.typeText(" 123")
        let edited = editor.value as? String ?? ""
        XCTAssertEqual(edited, template + " 123")
        attachScreenshot("已编辑草稿")

        if !copy.isHittable {
            app.scrollViews.firstMatch.swipeUp()
        }
        copy.tap()
        XCTAssertEqual(app.staticTexts["copyStatus"].label, "已复制到剪贴板")
        attachScreenshot("复制成功")

        let decline = app.buttons["intent.decline"]
        if !decline.isHittable {
            app.scrollViews.firstMatch.swipeDown()
        }
        decline.tap()
        let keep = app.buttons["保留当前草稿"]
        XCTAssertTrue(keep.waitForExistence(timeout: 5))
        attachScreenshot("替换确认")

        keep.tap()
        XCTAssertTrue(keep.waitForNonExistence(timeout: 5))
        let keptDraft = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", edited), object: editor)
        let softenSelected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "selected == YES"), object: soften)
        XCTAssertEqual(XCTWaiter.wait(for: [keptDraft, softenSelected], timeout: 5), .completed)
        XCTAssertEqual(editor.value as? String, edited)
        XCTAssertTrue(soften.isSelected)
        attachScreenshot("保留草稿")

        decline.tap()
        let replace = app.buttons["替换为新模板"]
        XCTAssertTrue(replace.waitForExistence(timeout: 5))
        replace.tap()
        XCTAssertTrue(replace.waitForNonExistence(timeout: 5))
        let declineSelected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "selected == YES"), object: decline)
        let replacedDraft = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value != nil AND value != '' AND value != %@", edited), object: editor)
        XCTAssertEqual(XCTWaiter.wait(for: [declineSelected, replacedDraft], timeout: 5), .completed)
        XCTAssertTrue(decline.isSelected)
        XCTAssertTrue(app.staticTexts["copyStatus"].waitForNonExistence(timeout: 5))

        let undo = app.buttons["undoReplacement"]
        XCTAssertTrue(undo.waitForExistence(timeout: 5))
        if !undo.isHittable {
            app.scrollViews.firstMatch.swipeUp()
        }
        undo.tap()
        XCTAssertTrue(undo.waitForNonExistence(timeout: 5))
        let restoredDraft = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", edited), object: editor)
        let restoredIntent = XCTNSPredicateExpectation(predicate: NSPredicate(format: "selected == YES"), object: soften)
        XCTAssertEqual(XCTWaiter.wait(for: [restoredDraft, restoredIntent], timeout: 5), .completed)

        if !decline.isHittable {
            app.scrollViews.firstMatch.swipeDown()
        }
        decline.tap()
        XCTAssertTrue(replace.waitForExistence(timeout: 5))
        replace.tap()
        XCTAssertTrue(replace.waitForNonExistence(timeout: 5))
        XCTAssertTrue(undo.waitForExistence(timeout: 5))
        let replacement = editor.value as? String ?? ""
        XCTAssertFalse(replacement.isEmpty)
        XCTAssertNotEqual(replacement, edited)
        focusAtEnd(of: editor)
        editor.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: replacement.count))
        XCTAssertTrue(undo.waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["blankHint"].exists)
        XCTAssertFalse(copy.isEnabled)
        attachScreenshot("空白草稿")

        editor.typeText("123")
        XCTAssertTrue(copy.isEnabled)
        app.terminate()
        app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        app.launch()
        XCTAssertTrue(app.staticTexts["emptyStateHint"].exists)
        XCTAssertFalse(editor.exists)

        XCTAssertEqual(decline.frame.minX, soften.frame.minX, accuracy: 1)
        XCTAssertLessThanOrEqual(decline.frame.maxY, soften.frame.minY)
        attachScreenshot("辅助功能大字号单列")

        decline.tap()
        app.scrollViews.firstMatch.swipeUp()
        XCTAssertTrue(copy.isEnabled)
        copy.tap()
        XCTAssertEqual(app.staticTexts["copyStatus"].label, "已复制到剪贴板")
        attachScreenshot("辅助功能大字号复制")
    }

    private func focusAtEnd(of editor: XCUIElement) {
        editor.tap()
        editor.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.7)).tap()
    }

    @MainActor
    private func attachScreenshot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
