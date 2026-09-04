// Semantic agent proof of concept: a throwaway on-device agent runner.
//
// Protocol (NDJSON over stdio):
//   stdin  first line : {"instructions":string,"prompt":string,"tools":[{"name","description","schema"}],"outputSchema":object}
//   stdout             : {"type":"tool_call","id":n,"name":string,"arguments":json}
//   stdin  reply       : {"type":"tool_result","id":n,"result":string}
//   stdout final       : {"type":"final","value":json,"transcript":[...],"elapsedMs":n}
//   stdout failure     : {"type":"failure","message":string}
// Every tool call is serialized through one stdio exchange. Nothing here is a production design.
import Foundation
import FoundationModels

@available(macOS 26.0, *)
final class Stdio: @unchecked Sendable {
    private let lock = NSLock()
    private var nextId = 0
    private var seen: [String: String] = [:]
    var maxToolCalls = 4
    func exchange(name: String, arguments: String) -> String {
        lock.lock(); defer { lock.unlock() }
        // The on-device model has a 4096-token window and happily repeats a call forever; budget and dedupe.
        let key = name + ":" + arguments
        if let previous = seen[key] {
            emit(["type": "note", "text": "repeated tool call suppressed: \(key)"])
            return "{\"note\":\"You already called this exact tool; its result is above. Do not call it again. Answer now.\",\"previous\":\(previous.prefix(200).debugDescription)}"
        }
        if seen.count >= maxToolCalls {
            emit(["type": "note", "text": "tool budget exhausted at \(seen.count) calls"])
            return "{\"note\":\"Tool budget exhausted. Answer now with the facts you already have.\"}"
        }
        nextId += 1
        let id = nextId
        let argumentsJson = arguments.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) } ?? [String: Any]()
        emit(["type": "tool_call", "id": id, "name": name, "arguments": argumentsJson])
        while let line = readLine(strippingNewline: true) {
            guard let data = line.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  object["type"] as? String == "tool_result", object["id"] as? Int == id else { continue }
            let result = object["result"] as? String ?? ""
            seen[key] = result
            return result
        }
        return "{\"error\":\"stdin closed\"}"
    }
    func emit(_ object: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: object), let text = String(data: data, encoding: .utf8) else { return }
        FileHandle.standardOutput.write((text + "\n").data(using: .utf8)!)
    }
}

@available(macOS 26.0, *)
struct BridgedTool: Tool {
    typealias Arguments = GeneratedContent
    let name: String
    let description: String
    let parameters: GenerationSchema
    let stdio: Stdio
    var includesSchemaInInstructions: Bool { true }
    func call(arguments: GeneratedContent) async throws -> String {
        stdio.exchange(name: name, arguments: arguments.jsonString)
    }
}

@available(macOS 26.0, *)
func dynamicSchema(_ json: Any, name: String) -> DynamicGenerationSchema {
    guard let object = json as? [String: Any] else { return DynamicGenerationSchema(type: String.self) }
    let description = object["description"] as? String
    if let values = object["enum"] as? [String] {
        return DynamicGenerationSchema(name: name, description: description, anyOf: values)
    }
    switch object["type"] as? String {
    case "object":
        let properties = object["properties"] as? [String: Any] ?? [:]
        let required = Set(object["required"] as? [String] ?? [])
        let sortedNames = properties.keys.sorted()
        return DynamicGenerationSchema(name: name, description: description, properties: sortedNames.map { key in
            DynamicGenerationSchema.Property(name: key, description: (properties[key] as? [String: Any])?["description"] as? String,
                                             schema: dynamicSchema(properties[key]!, name: name + "_" + key), isOptional: !required.contains(key))
        })
    case "array":
        return DynamicGenerationSchema(arrayOf: dynamicSchema(object["items"] ?? [:], name: name + "_item"),
                                       minimumElements: object["minItems"] as? Int, maximumElements: object["maxItems"] as? Int)
    case "integer": return DynamicGenerationSchema(type: Int.self)
    case "number": return DynamicGenerationSchema(type: Double.self)
    case "boolean": return DynamicGenerationSchema(type: Bool.self)
    default: return DynamicGenerationSchema(type: String.self)
    }
}

@available(macOS 26.0, *)
func transcriptJson(_ transcript: Transcript) -> [[String: Any]] {
    transcript.map { entry -> [String: Any] in
        switch entry {
        case .instructions(let i): return ["kind": "instructions", "text": i.segments.map { "\($0)" }.joined(), "tools": i.toolDefinitions.map { $0.name }]
        case .prompt(let p): return ["kind": "prompt", "text": p.segments.map { "\($0)" }.joined()]
        case .toolCalls(let calls): return ["kind": "toolCalls", "calls": calls.map { ["name": $0.toolName, "arguments": $0.arguments.jsonString] }]
        case .toolOutput(let o): return ["kind": "toolOutput", "name": o.toolName, "text": o.segments.map { "\($0)" }.joined()]
        case .response(let r): return ["kind": "response", "text": r.segments.map { "\($0)" }.joined()]
        @unknown default: return ["kind": "unknown"]
        }
    }
}

@available(macOS 26.0, *)
@main struct AgentHelper {
    static func main() async {
        let stdio = Stdio()
        guard let jobLine = readLine(strippingNewline: true), let jobData = jobLine.data(using: .utf8),
              let job = try? JSONSerialization.jsonObject(with: jobData) as? [String: Any] else {
            stdio.emit(["type": "failure", "message": "no job on stdin"]); return
        }
        let model = SystemLanguageModel.default
        guard case .available = model.availability else {
            stdio.emit(["type": "failure", "message": "on-device model unavailable: \(model.availability)"]); return
        }
        let start = Date()
        do {
            let tools: [any Tool] = ((job["tools"] as? [[String: Any]]) ?? []).map { spec in
                BridgedTool(name: spec["name"] as! String, description: spec["description"] as? String ?? "",
                            parameters: try! GenerationSchema(root: dynamicSchema(spec["schema"] ?? [:], name: spec["name"] as! String), dependencies: []),
                            stdio: stdio)
            }
            stdio.maxToolCalls = job["maxToolCalls"] as? Int ?? 4
            let session = LanguageModelSession(model: model, tools: tools, instructions: job["instructions"] as? String ?? "")
            let prompt = job["prompt"] as? String ?? ""
            var value: Any = NSNull()
            if let outputSchema = job["outputSchema"] {
                // Guided first; a tool-using guided turn sometimes drifts into prose, so a schema-only
                // conversion turn in the same session recovers it. (A free-text first phase looped on
                // tool calls until the 4096-token window overflowed.)
                let schema = try GenerationSchema(root: dynamicSchema(outputSchema, name: "Output"), dependencies: [])
                var structured: GeneratedContent?
                do {
                    let response = try await session.respond(to: prompt, schema: schema, options: GenerationOptions(temperature: 0.2))
                    structured = response.content
                } catch {
                    stdio.emit(["type": "note", "text": "guided turn failed, converting: \(String(describing: error).prefix(300))"])
                }
                let analysis = session.transcript.compactMap { entry -> String? in
                    if case .response(let r) = entry { return r.segments.map { "\($0)" }.joined() }
                    return nil
                }.last ?? ""
                if structured == nil { stdio.emit(["type": "analysis", "text": analysis]) }
                for attempt in 0..<2 where structured == nil {
                    do {
                        let response = try await session.respond(
                            to: attempt == 0
                                ? "Convert your review above into the structured result. Copy evidence ids exactly as the tools returned them."
                                : "Output only the structured result. No prose.",
                            schema: schema, options: GenerationOptions(temperature: 0.1))
                        structured = response.content
                        break
                    } catch {
                        stdio.emit(["type": "note", "text": "structured attempt \(attempt) failed: \(error)"])
                    }
                }
                guard let content = structured else {
                    stdio.emit(["type": "failure", "message": "structured conversion failed", "analysis": analysis,
                                "transcript": transcriptJson(session.transcript), "elapsedMs": Int(Date().timeIntervalSince(start) * 1000)])
                    return
                }
                value = try JSONSerialization.jsonObject(with: content.jsonString.data(using: .utf8)!, options: [.fragmentsAllowed])
            } else {
                let response = try await session.respond(to: prompt, options: GenerationOptions(temperature: 0.2))
                value = response.content
            }
            stdio.emit(["type": "final", "value": value, "transcript": transcriptJson(session.transcript),
                        "elapsedMs": Int(Date().timeIntervalSince(start) * 1000)])
        } catch {
            stdio.emit(["type": "failure", "message": "\(error)", "elapsedMs": Int(Date().timeIntervalSince(start) * 1000)])
        }
    }
}
