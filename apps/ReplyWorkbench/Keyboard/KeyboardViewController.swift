import SwiftUI
import UIKit

final class KeyboardViewController: UIInputViewController {
    private lazy var inserter = ProxyTextInserter(controller: self)
    private var hostingController: UIHostingController<KeyboardRootView>?

    override func viewDidLoad() {
        super.viewDidLoad()

        let host = UIHostingController(rootView: makeRootView())
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        host.view.backgroundColor = .clear
        view.addSubview(host.view)

        let height = view.heightAnchor.constraint(equalToConstant: 260)
        height.priority = UILayoutPriority(999)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            height
        ])
        host.didMove(toParent: self)
        hostingController = host
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        hostingController?.rootView = makeRootView()
    }

    private func makeRootView() -> KeyboardRootView {
        KeyboardRootView(
            target: inserter,
            switchKey: needsInputModeSwitchKey ? InputModeSwitchKey(controller: self) : nil
        )
    }
}

private struct KeyboardRootView: View {
    private let identity = UUID()
    let target: TextInserting
    let switchKey: InputModeSwitchKey?

    var body: some View {
        KeyboardAppearanceView(target: target, switchKey: switchKey)
            .id(identity)
    }
}

private struct KeyboardAppearanceView: View {
    @State private var state = KeyboardPanelState()
    let target: TextInserting
    let switchKey: InputModeSwitchKey?

    var body: some View {
        KeyboardPanelView(
            state: $state,
            target: target,
            leadingAccessory: switchKey?.frame(width: 44, height: 44)
        )
    }
}
