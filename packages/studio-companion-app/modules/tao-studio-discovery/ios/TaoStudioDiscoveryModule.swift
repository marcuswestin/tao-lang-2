import ExpoModulesCore
import Foundation

/// Discovers Tao Studio gateways on the local network. JavaScript still authenticates each result
/// against the Studio public key pinned by the original QR/deep-link pairing.
public final class TaoStudioDiscoveryModule: Module {
  private var requests: [UUID: TaoStudioDiscoveryRequest] = [:]

  public func definition() -> ModuleDefinition {
    Name("TaoStudioDiscovery")

    AsyncFunction("discover") { (timeoutMs: Double, promise: Promise) in
      let id = UUID()
      let request = TaoStudioDiscoveryRequest(timeout: max(0.1, min(timeoutMs / 1000, 5))) { [weak self] records in
        self?.requests.removeValue(forKey: id)
        promise.resolve(records)
      }
      self.requests[id] = request
      request.start()
    }.runOnQueue(.main)

    OnDestroy {
      DispatchQueue.main.async {
        for request in self.requests.values {
          request.cancel()
        }
        self.requests.removeAll()
      }
    }
  }
}

private final class TaoStudioDiscoveryRequest: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
  private let browser = NetServiceBrowser()
  private let completion: ([[String: String]]) -> Void
  private var finished = false
  private var records: [[String: String]] = []
  private var services: [NetService] = []
  private let timeout: TimeInterval
  private var timer: Timer?

  init(timeout: TimeInterval, completion: @escaping ([[String: String]]) -> Void) {
    self.timeout = timeout
    self.completion = completion
  }

  func start() {
    browser.delegate = self
    browser.searchForServices(ofType: "_tao-studio._tcp.", inDomain: "local.")
    timer = Timer.scheduledTimer(withTimeInterval: timeout, repeats: false) { [weak self] _ in
      self?.finish()
    }
  }

  func cancel() {
    finish()
  }

  func netServiceBrowser(
    _ browser: NetServiceBrowser,
    didFind service: NetService,
    moreComing: Bool
  ) {
    services.append(service)
    service.delegate = self
    service.resolve(withTimeout: timeout)
  }

  func netServiceDidResolveAddress(_ sender: NetService) {
    guard
      let host = sender.hostName,
      sender.port > 0,
      let data = sender.txtRecordData()
    else {
      return
    }
    let txt = NetService.dictionary(fromTXTRecord: data)
    guard
      let protocolData = txt["protocol"],
      let protocolName = String(data: protocolData, encoding: .utf8),
      let keyData = txt["studioPublicKey"],
      let studioPublicKey = String(data: keyData, encoding: .utf8)
    else {
      return
    }
    let record = [
      "host": host,
      "port": String(sender.port),
      "protocol": protocolName,
      "studioPublicKey": studioPublicKey,
    ]
    if !records.contains(record) {
      records.append(record)
    }
  }

  private func finish() {
    guard !finished else {
      return
    }
    finished = true
    timer?.invalidate()
    timer = nil
    browser.stop()
    for service in services {
      service.stop()
      service.delegate = nil
    }
    services.removeAll()
    completion(records)
  }
}
