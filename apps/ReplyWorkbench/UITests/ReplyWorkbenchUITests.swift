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
        scrollToHittable(copy, in: app)
        XCTAssertTrue(copy.isEnabled)
        copy.tap()
        XCTAssertEqual(app.staticTexts["copyStatus"].label, "已复制到剪贴板")
        attachScreenshot("辅助功能大字号复制")
    }

    @MainActor
    func testKeyboardPreview() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()

        let insert = app.buttons["keyboard.insert"]
        let soften = app.buttons["keyboard.intent.soften"]
        let output = app.descendants(matching: .any)["keyboardPreviewOutput"]
        let status = app.staticTexts["keyboard.status"]
        let newline = app.buttons["keyboard.newline"]
        let delete = app.buttons["keyboard.delete"]
        let clear = app.buttons["clearKeyboardPreview"]
        let template = "刚才我的语气有点急，抱歉。我不是在怪你，只是想把这件事处理好。我们都缓一缓，晚点再好好聊，可以吗？"

        scrollToHittable(insert, in: app)
        scrollToHittable(soften, in: app)
        soften.tap()
        scrollToHittable(insert, in: app)
        insert.tap()
        assertValue(template, of: output)
        XCTAssertEqual(status.label, "已插入")

        scrollToHittable(newline, in: app)
        newline.tap()
        assertValue(template + "\n", of: output)
        scrollToHittable(delete, in: app)
        delete.tap()
        assertValue(template, of: output)

        scrollToHittable(clear, in: app)
        clear.tap()
        assertValue("", of: output)
    }

    @MainActor
    private func assertValue(_ value: String, of element: XCUIElement) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [expectation], timeout: 5), .completed)
        XCTAssertEqual(element.value as? String, value)
    }

    @MainActor
    private func scrollToHittable(_ element: XCUIElement, in app: XCUIApplication) {
        let scrollView = app.scrollViews.firstMatch
        let window = app.windows.firstMatch
        for _ in 0..<5 {
            if element.isHittable { return }
            if element.exists, element.frame.midY < window.frame.midY {
                scrollView.swipeDown()
            } else {
                scrollView.swipeUp()
            }
        }
        XCTAssertTrue(element.isHittable, "无法滚动到 \(element.identifier)")
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
