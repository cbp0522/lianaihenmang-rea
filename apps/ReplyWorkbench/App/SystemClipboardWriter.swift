import UIKit

struct SystemClipboardWriter: ClipboardWriting {
    func write(_ text: String) {
        UIPasteboard.general.string = text
    }
}
