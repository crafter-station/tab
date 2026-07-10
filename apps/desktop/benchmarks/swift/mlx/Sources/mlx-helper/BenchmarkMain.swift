import Foundation
import MLX
import MLXLLM
import MLXLMCommon
import Tokenizers

private struct TokenizerAdapter: MLXLMCommon.Tokenizer {
    let base: any Tokenizers.Tokenizer

    func encode(text: String, addSpecialTokens: Bool) -> [Int] {
        base.encode(text: text, addSpecialTokens: addSpecialTokens)
    }

    func decode(tokenIds: [Int], skipSpecialTokens: Bool) -> String {
        base.decode(tokens: tokenIds, skipSpecialTokens: skipSpecialTokens)
    }

    func convertTokenToId(_ token: String) -> Int? { base.convertTokenToId(token) }
    func convertIdToToken(_ id: Int) -> String? { base.convertIdToToken(id) }
    var bosToken: String? { base.bosToken }
    var eosToken: String? { base.eosToken }
    var unknownToken: String? { base.unknownToken }

    func applyChatTemplate(
        messages: [[String: any Sendable]],
        tools: [[String: any Sendable]]?,
        additionalContext: [String: any Sendable]?
    ) throws -> [Int] {
        do {
            return try base.applyChatTemplate(
                messages: messages, tools: tools, additionalContext: additionalContext)
        } catch Tokenizers.TokenizerError.missingChatTemplate {
            throw MLXLMCommon.TokenizerError.missingChatTemplate
        }
    }
}

private struct LocalTokenizerLoader: MLXLMCommon.TokenizerLoader {
    func load(from directory: URL) async throws -> any MLXLMCommon.Tokenizer {
        TokenizerAdapter(base: try await AutoTokenizer.from(modelFolder: directory))
    }
}

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

private struct MemoryCounters: Encodable {
    let activeBytes: Int
    let cacheBytes: Int
    let peakActiveBytes: Int

    init(_ snapshot: Memory.Snapshot) {
        activeBytes = snapshot.activeMemory
        cacheBytes = snapshot.cacheMemory
        peakActiveBytes = snapshot.peakMemory
    }
}

private struct Metrics: Encodable {
    let type = "metrics"
    let id: String
    let prepareMilliseconds: Double
    let timeToFirstTextMilliseconds: Double?
    let promptMilliseconds: Double?
    let generationMilliseconds: Double?
    let totalMilliseconds: Double
    let promptTokens: Int?
    let generatedTokens: Int?
    let stopReason: String
    let memory: MemoryCounters
}

private struct ReadyMetrics: Encodable {
    let type = "ready"
    let loadMilliseconds: Double
    let memory: MemoryCounters
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

private func stopReason(_ reason: GenerateStopReason) -> String {
    switch reason {
    case .stop: "stop"
    case .length: "length"
    case .cancelled: "cancelled"
    }
}

@main
private enum Main {
    static func main() async throws {
        guard CommandLine.arguments.count == 2 else { throw CocoaError(.fileNoSuchFile) }

        let clock = ContinuousClock()
        let loadStarted = clock.now
        let modelDirectory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let container = try await LLMModelFactory.shared.loadContainer(
            from: modelDirectory, using: LocalTokenizerLoader())
        let loadEnded = clock.now

        let stdout = FileHandle.standardOutput
        let stderr = FileHandle.standardError
        try emit(
            ReadyMetrics(
                loadMilliseconds: milliseconds(loadStarted.duration(to: loadEnded)),
                memory: MemoryCounters(Memory.snapshot())),
            to: stderr)

        while let line = readLine(strippingNewline: true) {
            guard let data = line.data(using: .utf8),
                  let request = try? JSONDecoder().decode(Request.self, from: data)
            else { continue }

            Memory.peakMemory = 0
            let started = clock.now
            let prepared = try await container.prepare(input: UserInput(prompt: request.prompt))
            let prepareEnded = clock.now
            let stream = try await container.generate(
                input: prepared,
                parameters: GenerateParameters(
                    maxTokens: min(max(request.maxTokens ?? 32, 1), 64), temperature: 0))

            let characterLimit = min(max(request.maxCharacters ?? 80, 1), 80)
            var characters = 0
            var firstTextAt: ContinuousClock.Instant?
            var completion: GenerateCompletionInfo?

            generation: for await event in stream {
                switch event {
                case .chunk(let chunk):
                    let remaining = characterLimit - characters
                    guard remaining > 0 else { break generation }
                    let text = String(chunk.prefix(remaining))
                    if !text.isEmpty {
                        firstTextAt = firstTextAt ?? clock.now
                        try emit(TextEvent(id: request.id, text: text), to: stdout)
                        characters += text.count
                    }
                    if characters >= characterLimit { break generation }
                case .info(let info):
                    completion = info
                case .toolCall:
                    break
                }
            }

            let ended = clock.now
            try emit(DoneEvent(id: request.id), to: stdout)
            try emit(
                Metrics(
                    id: request.id,
                    prepareMilliseconds: milliseconds(started.duration(to: prepareEnded)),
                    timeToFirstTextMilliseconds: firstTextAt.map { milliseconds(started.duration(to: $0)) },
                    promptMilliseconds: completion.map { $0.promptTime * 1_000 },
                    generationMilliseconds: completion.map { $0.generateTime * 1_000 },
                    totalMilliseconds: milliseconds(started.duration(to: ended)),
                    promptTokens: completion?.promptTokenCount,
                    generatedTokens: completion?.generationTokenCount,
                    stopReason: completion.map { stopReason($0.stopReason) } ?? "character_limit",
                    memory: MemoryCounters(Memory.snapshot())),
                to: stderr)
        }
    }
}
