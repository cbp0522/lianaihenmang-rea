import SwiftUI

struct KeyboardPanelView<LeadingAccessory: View>: View {
    @Binding var state: KeyboardPanelState
    let target: TextInserting
    let leadingAccessory: LeadingAccessory

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 4) {
                ForEach(ReplyIntent.allCases, content: intentButton)
            }
            .controlSize(.small)

            Text(state.previewText)
                .font(.callout)
                .lineLimit(3)
                .accessibilityIdentifier("keyboard.preview")

            if state.showsPlaceholderHint {
                Text("插入后请在输入框中补全括号内容")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 8) {
                leadingAccessory
                Button {
                    state.insert(into: target)
                } label: {
                    Text("插入").frame(maxWidth: .infinity, minHeight: 28)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("keyboard.insert")

                Button {
                    state.deleteBackward(in: target)
                } label: {
                    Text("⌫").frame(minHeight: 28)
                }
                .buttonStyle(.bordered)
                .accessibilityLabel("退格")
                .accessibilityIdentifier("keyboard.delete")

                Button {
                    state.insertNewline(into: target)
                } label: {
                    Text("换行").frame(minHeight: 28)
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("keyboard.newline")
            }

            Text(state.status == .inserted ? "已插入" : " ")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .accessibilityHidden(state.status == .idle)
                .accessibilityIdentifier("keyboard.status")
        }
        .padding(10)
        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
    }

    @ViewBuilder
    private func intentButton(_ intent: ReplyIntent) -> some View {
        let button = Button {
            state.select(intent)
        } label: {
            Text(intent.title)
                .lineLimit(1)
                .frame(maxWidth: .infinity, minHeight: 28)
        }
        .accessibilityIdentifier("keyboard.intent.\(intent.id)")

        if state.selectedIntent == intent {
            button.buttonStyle(.borderedProminent)
                .accessibilityAddTraits(.isSelected)
        } else {
            button.buttonStyle(.bordered)
        }
    }
}
