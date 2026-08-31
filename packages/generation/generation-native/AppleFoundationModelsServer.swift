import Foundation
import FoundationModels
import Network

private struct HTTPRequest {
    let method: String
    let path: String
    let headers: [String: String]
    let body: Data
}

@available(macOS 26.0, *)
@main
struct AppleFoundationModelsServer {
    static func main() throws {
        let arguments = Dictionary(uniqueKeysWithValues: stride(from: 1, to: CommandLine.arguments.count - 1, by: 2).map {
            (CommandLine.arguments[$0], CommandLine.arguments[$0 + 1])
        })
        guard let token = arguments["--token"], let rawPort = UInt16(arguments["--port"] ?? "") else {
            throw NSError(domain: "FoundationModelsServer", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "Expected --port and --token.",
            ])
        }
        let listener = try NWListener(using: .tcp, on: NWEndpoint.Port(rawValue: rawPort)!)
        let queue = DispatchQueue(label: "tao.foundation-models")
        listener.newConnectionHandler = { connection in
            connection.start(queue: queue)
            receive(connection, buffer: Data()) { request in
                Task { await handle(request, token: token, connection: connection) }
            }
        }
        listener.stateUpdateHandler = { state in
            if case .ready = state, let port = listener.port {
                print("READY \(port.rawValue)")
                fflush(stdout)
            } else if case .failed(let error) = state {
                fputs("ERROR Listener failed: \(error)\n", stderr)
                fflush(stderr)
                exit(1)
            }
        }
        listener.start(queue: queue)
        dispatchMain()
    }

    private static func handle(_ request: HTTPRequest, token: String, connection: NWConnection) async {
        guard request.headers["authorization"] == "Bearer \(token)" else {
            await sendResponse(connection, status: "401 Unauthorized", body: "Unauthorized")
            return
        }
        if request.method == "GET", request.path == "/availability" {
            let availability: [String: String]
            switch SystemLanguageModel.default.availability {
            case .available:
                availability = ["status": "available"]
            case .unavailable(let reason):
                availability = ["status": "unavailable", "reason": unavailableReason(reason)]
            }
            let body = try! JSONSerialization.data(withJSONObject: availability)
            await sendResponse(connection, status: "200 OK", body: String(decoding: body, as: UTF8.self))
            return
        }
        guard request.method == "POST", request.path == "/generate" else {
            await sendResponse(connection, status: "404 Not Found", body: "Not found")
            return
        }
        await generate(request.body, connection: connection)
    }

    private static func generate(_ body: Data, connection: NWConnection) async {
        await send(connection, data: Data(
            "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n".utf8
        ))
        do {
            guard
                let request = try JSONSerialization.jsonObject(with: body) as? [String: Any],
                let prompt = request["prompt"] as? String,
                let schemaJSON = request["schema"] as? [String: Any]
            else { throw ServerError("Expected prompt and schema.") }
            let root = try dynamicSchema(schemaJSON, name: schemaName(schemaJSON["title"] as? String ?? "GeneratedValue"))
            let schema = try GenerationSchema(root: root, dependencies: [])
            let stream = LanguageModelSession().streamResponse(to: prompt, schema: schema)
            var finalJSON: String?
            for try await snapshot in stream {
                let json = snapshot.rawContent.jsonString
                finalJSON = json
                await sendChunk(connection, event: event(type: "partial", rawValue: json))
            }
            guard let finalJSON else { throw ServerError("Foundation Models returned no value.") }
            await sendChunk(connection, event: event(type: "success", rawValue: finalJSON))
        } catch {
            await sendChunk(connection, event: failureEvent(error.localizedDescription))
        }
        await send(connection, data: Data("0\r\n\r\n".utf8), isComplete: true)
        connection.cancel()
    }

    private static func dynamicSchema(_ json: [String: Any], name: String) throws -> DynamicGenerationSchema {
        if let choices = json["enum"] as? [String] {
            return DynamicGenerationSchema(name: name, anyOf: choices)
        }
        switch json["type"] as? String {
        case "string": return DynamicGenerationSchema(type: String.self)
        case "boolean": return DynamicGenerationSchema(type: Bool.self)
        case "integer": return DynamicGenerationSchema(type: Int.self)
        case "number": return DynamicGenerationSchema(type: Double.self)
        case "array":
            guard let items = json["items"] as? [String: Any] else { throw ServerError("Array \(name) has no items schema.") }
            return DynamicGenerationSchema(arrayOf: try dynamicSchema(items, name: "\(name)Item"))
        case "object":
            let required = Set(json["required"] as? [String] ?? [])
            let properties = json["properties"] as? [String: [String: Any]] ?? [:]
            return DynamicGenerationSchema(
                name: name,
                description: json["description"] as? String,
                properties: try properties.keys.sorted().map { propertyName in
                    let property = properties[propertyName]!
                    return DynamicGenerationSchema.Property(
                        name: propertyName,
                        description: property["description"] as? String,
                        schema: try dynamicSchema(property, name: "\(name)\(schemaName(propertyName))"),
                        isOptional: !required.contains(propertyName)
                    )
                }
            )
        default: throw ServerError("Unsupported JSON schema type for \(name).")
        }
    }

    private static func event(type: String, rawValue: String) -> String {
        "{\"type\":\"\(type)\",\"value\":\(rawValue)}\n"
    }

    private static func failureEvent(_ message: String) -> String {
        let data = try! JSONSerialization.data(withJSONObject: [
            "type": "failure", "code": "provider_error", "message": message,
        ])
        return String(decoding: data, as: UTF8.self) + "\n"
    }

    private static func schemaName(_ value: String) -> String {
        let cleaned = value.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? Character(String($0)) : "_" }
        return String(cleaned).isEmpty ? "GeneratedValue" : String(cleaned)
    }

    private static func unavailableReason(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
        switch reason {
        case .deviceNotEligible: return "This Mac is not eligible for Apple Intelligence."
        case .appleIntelligenceNotEnabled: return "Apple Intelligence is not enabled."
        case .modelNotReady: return "The Apple Intelligence model is not ready."
        @unknown default: return "Apple Foundation Models is unavailable."
        }
    }
}

private struct ServerError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

private func receive(_ connection: NWConnection, buffer: Data, completion: @escaping (HTTPRequest) -> Void) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 1_048_576) { content, _, complete, error in
        var data = buffer
        if let content { data.append(content) }
        if let request = parseRequest(data) { completion(request); return }
        if error == nil, !complete { receive(connection, buffer: data, completion: completion) }
        else { connection.cancel() }
    }
}

private func parseRequest(_ data: Data) -> HTTPRequest? {
    guard let separator = data.range(of: Data("\r\n\r\n".utf8)) else { return nil }
    let headerText = String(decoding: data[..<separator.lowerBound], as: UTF8.self)
    let lines = headerText.components(separatedBy: "\r\n")
    guard let requestLine = lines.first?.split(separator: " "), requestLine.count >= 2 else { return nil }
    let headers = Dictionary(uniqueKeysWithValues: lines.dropFirst().compactMap { line -> (String, String)? in
        guard let colon = line.firstIndex(of: ":") else { return nil }
        return (line[..<colon].lowercased(), line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces))
    })
    let bodyStart = separator.upperBound
    let length = Int(headers["content-length"] ?? "0") ?? 0
    guard data.distance(from: bodyStart, to: data.endIndex) >= length else { return nil }
    return HTTPRequest(
        method: String(requestLine[0]), path: String(requestLine[1]), headers: headers,
        body: data[bodyStart..<data.index(bodyStart, offsetBy: length)]
    )
}

private func sendResponse(_ connection: NWConnection, status: String, body: String) async {
    let content = Data(body.utf8)
    let headers = Data(
        "HTTP/1.1 \(status)\r\nContent-Type: application/json\r\nContent-Length: \(content.count)\r\nConnection: close\r\n\r\n".utf8
    )
    var response = headers
    response.append(content)
    await send(connection, data: response, isComplete: true)
    connection.cancel()
}

private func sendChunk(_ connection: NWConnection, event: String) async {
    let content = Data(event.utf8)
    var chunk = Data(String(content.count, radix: 16).utf8)
    chunk.append(Data("\r\n".utf8)); chunk.append(content); chunk.append(Data("\r\n".utf8))
    await send(connection, data: chunk)
}

private func send(_ connection: NWConnection, data: Data, isComplete: Bool = false) async {
    await withCheckedContinuation { continuation in
        connection.send(content: data, isComplete: isComplete, completion: .contentProcessed { _ in continuation.resume() })
    }
}
