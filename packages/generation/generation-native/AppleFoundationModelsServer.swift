import Foundation
import FoundationModels
import Network
import Darwin

private let maximumHeaderBytes = 16_384
private let maximumBodyBytes = 262_144
private let requestDeadlineSeconds = 5.0

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
        guard
            CommandLine.arguments.count == 3,
            CommandLine.arguments[1] == "--port",
            let rawPort = UInt16(CommandLine.arguments[2]),
            let token = readLine(strippingNewline: true),
            !token.isEmpty
        else {
            throw NSError(domain: "FoundationModelsServer", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "Expected --port and an authentication token on standard input.",
            ])
        }
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(
            host: "127.0.0.1",
            port: NWEndpoint.Port(rawValue: rawPort)!
        )
        let listener = try NWListener(using: parameters)
        let queue = DispatchQueue(label: "tao.foundation-models")
        listener.newConnectionHandler = { connection in
            connection.start(queue: queue)
            let receiveDeadline = DispatchWorkItem { connection.cancel() }
            queue.asyncAfter(deadline: .now() + requestDeadlineSeconds, execute: receiveDeadline)
            receive(connection, buffer: Data()) { result in
                receiveDeadline.cancel()
                switch result {
                case .request(let request):
                    Task { await handle(request, token: token, connection: connection) }
                case .failure(let status, let message):
                    Task { await sendErrorResponse(connection, status: status, message: message) }
                }
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
        let parentPID = getppid()
        let parentMonitor = DispatchSource.makeTimerSource(queue: queue)
        parentMonitor.schedule(deadline: .now() + 2, repeating: 2)
        parentMonitor.setEventHandler { [parentMonitor] in
            _ = parentMonitor
            if getppid() != parentPID {
                listener.cancel()
                exit(0)
            }
        }
        parentMonitor.resume()
        dispatchMain()
    }

    private static func handle(_ request: HTTPRequest, token: String, connection: NWConnection) async {
        guard secureEquals(request.headers["authorization"] ?? "", "Bearer \(token)") else {
            await sendErrorResponse(connection, status: "401 Unauthorized", message: "Unauthorized")
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
            await sendResponse(connection, status: "200 OK", body: body)
            return
        }
        guard request.method == "POST", request.path == "/generate" else {
            await sendErrorResponse(connection, status: "404 Not Found", message: "Not found")
            return
        }
        await generate(request.body, connection: connection)
    }

    private static func generate(_ body: Data, connection: NWConnection) async {
        guard await send(connection, data: Data(
            "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n".utf8
        )) else {
            connection.cancel()
            return
        }
        do {
            guard
                let request = try JSONSerialization.jsonObject(with: body) as? [String: Any],
                let prompt = request["prompt"] as? String,
                let schemaJSON = request["schema"] as? [String: Any],
                let deadlineMs = request["deadlineMs"] as? Int,
                (1...300_000).contains(deadlineMs)
            else { throw ServerError("Expected prompt, schema, and a valid deadlineMs.") }
            let root = try dynamicSchema(schemaJSON, name: schemaName(schemaJSON["title"] as? String ?? "GeneratedValue"))
            let schema = try GenerationSchema(root: root, dependencies: [])
            let finalJSON = try await withThrowingTaskGroup(of: String.self) { group in
                group.addTask {
                    let stream = LanguageModelSession().streamResponse(to: prompt, schema: schema)
                    var finalJSON: String?
                    for try await snapshot in stream {
                        try Task.checkCancellation()
                        let json = try normalizedJSON(snapshot.rawContent.jsonString)
                        finalJSON = json
                        guard await sendChunk(connection, event: event(type: "partial", normalizedValue: json)) else {
                            throw CancellationError()
                        }
                    }
                    guard let finalJSON else { throw ServerError("Foundation Models returned no value.") }
                    return finalJSON
                }
                group.addTask {
                    try await Task.sleep(nanoseconds: UInt64(deadlineMs) * 1_000_000)
                    throw GenerationDeadlineExceeded(deadlineMs: deadlineMs)
                }
                defer { group.cancelAll() }
                guard let value = try await group.next() else {
                    throw ServerError("Foundation Models returned no value.")
                }
                return value
            }
            _ = await sendChunk(connection, event: event(type: "success", normalizedValue: finalJSON))
        } catch let error as GenerationDeadlineExceeded {
            _ = await sendChunk(connection, event: failureEvent(
                error.localizedDescription,
                code: "cancelled"
            ))
        } catch is CancellationError {
            _ = await sendChunk(connection, event: failureEvent("Generation was cancelled.", code: "cancelled"))
        } catch {
            _ = await sendChunk(connection, event: failureEvent(error.localizedDescription))
        }
        _ = await send(connection, data: Data("0\r\n\r\n".utf8), isComplete: true)
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

    private static func event(type: String, normalizedValue: String) -> String {
        let value = try! JSONSerialization.jsonObject(
            with: Data(normalizedValue.utf8),
            options: [.fragmentsAllowed]
        )
        let data = try! JSONSerialization.data(withJSONObject: ["type": type, "value": value])
        return String(decoding: data, as: UTF8.self) + "\n"
    }

    private static func failureEvent(_ message: String, code: String = "provider_error") -> String {
        let data = try! JSONSerialization.data(withJSONObject: [
            "type": "failure", "code": code, "message": message,
        ])
        return String(decoding: data, as: UTF8.self) + "\n"
    }

    private static func normalizedJSON(_ rawValue: String) throws -> String {
        let value = try JSONSerialization.jsonObject(
            with: Data(rawValue.utf8),
            options: [.fragmentsAllowed]
        )
        let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed])
        return String(decoding: data, as: UTF8.self)
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

private struct GenerationDeadlineExceeded: LocalizedError {
    let deadlineMs: Int
    var errorDescription: String? { "Apple Foundation Models generation exceeded its \(deadlineMs)ms deadline." }
}

private struct ServerError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

private enum RequestParseResult {
    case incomplete
    case request(HTTPRequest)
    case failure(status: String, message: String)
}

private enum RequestReceiveResult {
    case request(HTTPRequest)
    case failure(status: String, message: String)
}

private func receive(
    _ connection: NWConnection,
    buffer: Data,
    completion: @escaping (RequestReceiveResult) -> Void
) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { content, _, complete, error in
        var data = buffer
        if let content { data.append(content) }
        if data.count > maximumHeaderBytes + 4 + maximumBodyBytes {
            completion(.failure(status: "413 Payload Too Large", message: "Request exceeded its size limit."))
            return
        }
        switch parseRequest(data) {
        case .request(let request):
            completion(.request(request))
        case .failure(let status, let message):
            completion(.failure(status: status, message: message))
        case .incomplete:
            if error == nil, !complete {
                receive(connection, buffer: data, completion: completion)
            } else {
                connection.cancel()
            }
        }
    }
}

private func parseRequest(_ data: Data) -> RequestParseResult {
    guard let separator = data.range(of: Data("\r\n\r\n".utf8)) else {
        return data.count > maximumHeaderBytes
            ? .failure(status: "431 Request Header Fields Too Large", message: "Request headers exceeded their size limit.")
            : .incomplete
    }
    guard separator.lowerBound <= maximumHeaderBytes else {
        return .failure(status: "431 Request Header Fields Too Large", message: "Request headers exceeded their size limit.")
    }
    guard let headerText = String(data: data[..<separator.lowerBound], encoding: .utf8) else {
        return .failure(status: "400 Bad Request", message: "Request headers were not valid UTF-8.")
    }
    let lines = headerText.components(separatedBy: "\r\n")
    guard
        let requestLine = lines.first?.split(separator: " ", omittingEmptySubsequences: true),
        requestLine.count == 3,
        requestLine[2] == "HTTP/1.1"
    else {
        return .failure(status: "400 Bad Request", message: "Malformed HTTP request line.")
    }
    var headers: [String: String] = [:]
    for line in lines.dropFirst() {
        guard let colon = line.firstIndex(of: ":"), colon != line.startIndex else {
            return .failure(status: "400 Bad Request", message: "Malformed HTTP header.")
        }
        let name = line[..<colon].lowercased()
        guard headers[name] == nil else {
            return .failure(status: "400 Bad Request", message: "Duplicate HTTP header: \(name).")
        }
        headers[name] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
    }
    let bodyStart = separator.upperBound
    let length: Int
    if let rawLength = headers["content-length"] {
        guard !rawLength.isEmpty, rawLength.allSatisfy({ $0.isASCII && $0.isNumber }), let parsed = Int(rawLength) else {
            return .failure(status: "400 Bad Request", message: "Invalid Content-Length header.")
        }
        length = parsed
    } else {
        length = 0
    }
    guard length <= maximumBodyBytes else {
        return .failure(status: "413 Payload Too Large", message: "Request body exceeded its size limit.")
    }
    let available = data.distance(from: bodyStart, to: data.endIndex)
    guard available >= length else { return .incomplete }
    guard available == length else {
        return .failure(status: "400 Bad Request", message: "Unexpected bytes followed the request body.")
    }
    return .request(HTTPRequest(
        method: String(requestLine[0]), path: String(requestLine[1]), headers: headers,
        body: Data(data[bodyStart..<data.index(bodyStart, offsetBy: length)])
    ))
}

private func sendResponse(_ connection: NWConnection, status: String, body: Data) async {
    let headers = Data(
        "HTTP/1.1 \(status)\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n".utf8
    )
    var response = headers
    response.append(body)
    _ = await send(connection, data: response, isComplete: true)
    connection.cancel()
}

private func sendErrorResponse(_ connection: NWConnection, status: String, message: String) async {
    let body = try! JSONSerialization.data(withJSONObject: ["error": message])
    await sendResponse(connection, status: status, body: body)
}

private func sendChunk(_ connection: NWConnection, event: String) async -> Bool {
    let content = Data(event.utf8)
    var chunk = Data(String(content.count, radix: 16).utf8)
    chunk.append(Data("\r\n".utf8)); chunk.append(content); chunk.append(Data("\r\n".utf8))
    return await send(connection, data: chunk)
}

private func send(_ connection: NWConnection, data: Data, isComplete: Bool = false) async -> Bool {
    await withCheckedContinuation { continuation in
        connection.send(content: data, isComplete: isComplete, completion: .contentProcessed { error in
            continuation.resume(returning: error == nil)
        })
    }
}

private func secureEquals(_ left: String, _ right: String) -> Bool {
    let leftBytes = Array(left.utf8)
    let rightBytes = Array(right.utf8)
    var difference = leftBytes.count ^ rightBytes.count
    for index in 0..<max(leftBytes.count, rightBytes.count) {
        let leftByte = index < leftBytes.count ? leftBytes[index] : 0
        let rightByte = index < rightBytes.count ? rightBytes[index] : 0
        difference |= Int(leftByte ^ rightByte)
    }
    return difference == 0
}
