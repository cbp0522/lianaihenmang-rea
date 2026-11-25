import Combine

@MainActor
final class PreviewTextInserter: ObservableObject, TextInserting {
    @Published private(set) var text = ""

    func insertText(_ text: String) {
        self.text += text
    }

    func deleteBackward() {
        if !text.isEmpty {
            text.removeLast()
        }
    }

    func clear() {
        text = ""
    }
}
