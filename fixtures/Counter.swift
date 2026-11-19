import SwiftUI

@main
struct ResearchCounter: App {
    var body: some Scene {
        WindowGroup { CounterView() }
    }
}

struct CounterView: View {
    @State private var count = 0

    var body: some View {
        VStack(spacing: 24) {
            Text("样本计数器").font(.title)
            Text("当前数值 \(count)").font(.largeTitle)
            Button("增加一次") { count += 1 }.buttonStyle(.borderedProminent)
            Button("归零") { count = 0 }.buttonStyle(.bordered)
        }
        .padding()
    }
}
