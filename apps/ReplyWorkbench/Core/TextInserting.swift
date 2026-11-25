import Foundation

@MainActor
protocol TextInserting: AnyObject {
    func insertText(_ text: String)
    func deleteBackward()
}
