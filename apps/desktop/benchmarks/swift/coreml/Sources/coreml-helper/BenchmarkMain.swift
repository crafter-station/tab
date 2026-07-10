import CoreML
import Foundation
import Tokenizers

private struct Request: Decodable {
    let id: String
    let prompt: String
    let maxTokens: Int?
    let maxCharacters: Int?
}

private struct TextEvent: Encodable {
    let type = "text"
    let id: String
    let text: String
}

private struct DoneEvent: Encodable {
    let type = "done"
    let id: String
}

private struct Metrics: Encodable {
    let type = "metrics"
    let id: String
    let tokenizeMilliseconds: Double
    let prefillMilliseconds: Double
    let timeToFirstTextMilliseconds: Double?
    let totalMilliseconds: Double
    let promptTokens: Int
    let generatedTokens: Int
}

private struct ReadyEvent: Encodable {
    let type = "ready"
    let loadMilliseconds: Double
}

private let encoder = JSONEncoder()

private func emit<T: Encodable>(_ value: T, to handle: FileHandle) throws {
    var data = try encoder.encode(value)
    data.append(0x0a)
    try handle.write(contentsOf: data)
}

private func milliseconds(_ duration: ContinuousClock.Duration) -> Double {
    let components = duration.components
    return Double(components.seconds) * 1_000
        + Double(components.attoseconds) / 1_000_000_000_000_000
}

private func causalMask(size: Int) -> MLShapedArray<Float16> {
    var values = [Float16]()
    values.reserveCapacity(size * size)
    for row in 0..<size {
        for column in 0..<size {
            values.append(column <= row ? 0 : -65_504)
        }
    }
    return MLShapedArray(scalars: values, shape: [1, 1, size, size])
}

private func predict(
    model: MLModel,
    state: MLState,
    tokens: [Int],
    mask: MLShapedArray<Float16>
) async throws -> MLShapedArray<Float16> {
    let input = try MLDictionaryFeatureProvider(dictionary: [
        "input_ids": MLMultiArray(MLShapedArray(scalars: tokens.map(Int32.init), shape: [1, tokens.count])),
        "causal_mask": MLMultiArray(mask),
    ])
    let output = try await model.prediction(from: input, using: state)
    return MLShapedArray<Float16>(output.featureValue(for: "logits")!.multiArrayValue!)
}

private func sample(_ logits: MLShapedArray<Float16>) async -> Int {
    await Int(MLTensor(logits[0, logits.shape[1] - 1]).argmax().shapedArray(of: Int32.self).scalar!)
}

@main
private enum Main {
    static func main() async throws {
        guard CommandLine.arguments.count == 2 else { throw CocoaError(.fileNoSuchFile) }

        let clock = ContinuousClock()
        let started = clock.now
        let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let modelURL = directory.appending(path: "Qwen2.5-3B-Instruct-4bit.mlmodelc")
        let configuration = MLModelConfiguration()
        configuration.computeUnits = .all
        async let loadedModel = MLModel.load(contentsOf: modelURL, configuration: configuration)
        async let loadedTokenizer = AutoTokenizer.from(modelFolder: directory)
        let (model, tokenizer) = try await (loadedModel, loadedTokenizer)

        _ = try await predict(
            model: model,
            state: model.makeState(),
            tokens: [0, 0],
            mask: MLShapedArray<Float16>(repeating: 0, shape: [1, 1, 2, 2]))

        let stdout = FileHandle.standardOutput
        let stderr = FileHandle.standardError
        try emit(
            ReadyEvent(loadMilliseconds: milliseconds(started.duration(to: clock.now))),
            to: stderr)

        while let line = readLine(strippingNewline: true) {
            guard let data = line.data(using: .utf8),
                  let request = try? JSONDecoder().decode(Request.self, from: data)
            else { continue }

            let requestStarted = clock.now
            let tokenizeStarted = clock.now
            let promptTokens = try tokenizer.applyChatTemplate(
                messages: [["role": "user", "content": request.prompt]])
            let tokenizeEnded = clock.now
            let maxTokens = min(max(request.maxTokens ?? 32, 1), 64)
            guard promptTokens.count + maxTokens <= 2_048 else { continue }

            let state = model.makeState()
            let prefillStarted = clock.now
            var logits = try await predict(
                model: model,
                state: state,
                tokens: promptTokens,
                mask: causalMask(size: promptTokens.count))
            let prefillEnded = clock.now

            let characterLimit = min(max(request.maxCharacters ?? 80, 1), 80)
            var generated = [Int]()
            var emitted = ""
            var firstTextAt: ContinuousClock.Instant?

            for _ in 0..<maxTokens {
                let token = await sample(logits)
                if token == tokenizer.eosTokenId { break }
                generated.append(token)
                let decoded = tokenizer.decode(tokens: generated, skipSpecialTokens: true)
                let delta = String(decoded.dropFirst(emitted.count))
                let remaining = characterLimit - emitted.count
                let bounded = String(delta.prefix(max(remaining, 0)))
                if !bounded.isEmpty {
                    firstTextAt = firstTextAt ?? clock.now
                    try emit(TextEvent(id: request.id, text: bounded), to: stdout)
                    emitted += bounded
                }
                if emitted.count >= characterLimit { break }
                logits = try await predict(
                    model: model,
                    state: state,
                    tokens: [token],
                    mask: MLShapedArray<Float16>(
                        repeating: 0,
                        shape: [1, 1, 1, promptTokens.count + generated.count]))
            }

            let ended = clock.now
            try emit(DoneEvent(id: request.id), to: stdout)
            try emit(
                Metrics(
                    id: request.id,
                    tokenizeMilliseconds: milliseconds(tokenizeStarted.duration(to: tokenizeEnded)),
                    prefillMilliseconds: milliseconds(prefillStarted.duration(to: prefillEnded)),
                    timeToFirstTextMilliseconds: firstTextAt.map {
                        milliseconds(requestStarted.duration(to: $0))
                    },
                    totalMilliseconds: milliseconds(requestStarted.duration(to: ended)),
                    promptTokens: promptTokens.count,
                    generatedTokens: generated.count),
                to: stderr)
        }
    }
}
