import CloudKit
import ExpoModulesCore
import Foundation
#if canImport(UIKit)
import UIKit
#endif

/// TaoCloudKitModule exposes one CloudKit record zone per Tao datasource through `CKSyncEngine`:
/// JavaScript hands it whole records to save, the engine batches, retries, and resolves account
/// state, and every fetched change, successful save, conflict, and failure comes back as a
/// `cloudKitEvent`. Records are opaque to this module — field names and values are whatever the
/// Tao provider chose — so the merge policy lives in JavaScript, next to the fold.
public final class TaoCloudKitModule: Module {
  private var sessions: [String: Any] = [:]
  private static let cloudKitContainersInfoKey = "TaoCloudKitContainerIdentifiers"

  public func definition() -> ModuleDefinition {
    Name("TaoCloudKit")
    Events("cloudKitEvent")

    AsyncFunction("start") { (sessionId: String, container: String?, zoneName: String, stateFileName: String) throws in
      if #available(iOS 17.0, macOS 14.0, *) {
        self.stopSession(sessionId)
        let session = try CloudKitZoneSession(
          container: container,
          zoneName: zoneName,
          stateFileName: stateFileName
        ) { [weak self] event in
          var body = event
          body["sessionId"] = sessionId
          self?.sendEvent("cloudKitEvent", body)
        }
        self.sessions[sessionId] = session
      } else {
        throw Self.unavailable()
      }
    }.runOnQueue(.main)

    AsyncFunction("replayInbox") { (sessionId: String) throws in
      if #available(iOS 17.0, macOS 14.0, *) {
        try self.session(sessionId).replayInbox()
      } else {
        throw Self.unavailable()
      }
    }.runOnQueue(.main)

    AsyncFunction("stop") { (sessionId: String) in
      self.stopSession(sessionId)
    }.runOnQueue(.main)

    AsyncFunction("fetchChanges") { (sessionId: String) async throws in
      if #available(iOS 17.0, macOS 14.0, *) {
        try await self.session(sessionId).fetchChanges()
      } else {
        throw Self.unavailable()
      }
    }

    AsyncFunction("sendChanges") { (sessionId: String, records: [[String: Any]]) async throws in
      if #available(iOS 17.0, macOS 14.0, *) {
        try await self.session(sessionId).send(records: records)
      } else {
        throw Self.unavailable()
      }
    }

    AsyncFunction("acknowledgeFetched") { (sessionId: String, batchId: String) throws in
      if #available(iOS 17.0, macOS 14.0, *) {
        try self.session(sessionId).acknowledge(batchId: batchId)
      } else {
        throw Self.unavailable()
      }
    }

    OnDestroy {
      DispatchQueue.main.async {
        for sessionId in Array(self.sessions.keys) {
          self.stopSession(sessionId)
        }
      }
    }
  }

  private static func unavailable() -> Exception {
    Exception(
      name: "CloudKitUnavailable",
      description: "CloudKit sync needs iOS 17 or later; this device runs an older system."
    )
  }

  /// The Expo plugin writes this declaration while adding the matching signed entitlement. iOS has
  /// no public API to read the current process's entitlements, so do not call CKContainer.default()
  /// unless that build-time handoff proves the plugin participated in this app's configuration.
  @available(iOS 17.0, macOS 14.0, *)
  fileprivate static func container(_ requested: String?) throws -> CKContainer {
    let declared = Bundle.main.object(forInfoDictionaryKey: cloudKitContainersInfoKey) as? [String] ?? []
    guard !declared.isEmpty else {
      throw Exception(
        name: "CloudKitConfigurationMissing",
        description: "CloudKit sync needs an iCloud container configured by tao-icloud. Add the CloudKit service to this app's Expo configuration and rebuild.",
      )
    }
    if let requested {
      guard declared.contains(requested) else {
        throw Exception(
          name: "CloudKitConfigurationMissing",
          description: "CloudKit sync requested a container that this app's tao-icloud configuration does not declare.",
        )
      }
      return CKContainer(identifier: requested)
    }
    guard let bundleIdentifier = Bundle.main.bundleIdentifier else {
      throw Exception(
        name: "CloudKitConfigurationMissing",
        description: "CloudKit sync cannot derive this app's default iCloud container because the bundle has no identifier.",
      )
    }
    let defaultContainer = "iCloud.\(bundleIdentifier)"
    guard declared.contains(defaultContainer) else {
      throw Exception(
        name: "CloudKitConfigurationMissing",
        description: "CloudKit sync needs the app's default iCloud container declared by tao-icloud before it can use CKContainer.default().",
      )
    }
    return CKContainer.default()
  }

  private func stopSession(_ sessionId: String) {
    guard let session = sessions.removeValue(forKey: sessionId) else {
      return
    }
    if #available(iOS 17.0, macOS 14.0, *), let zone = session as? CloudKitZoneSession {
      zone.stop()
    }
  }

  @available(iOS 17.0, macOS 14.0, *)
  private func session(_ sessionId: String) throws -> CloudKitZoneSession {
    guard let session = sessions[sessionId] as? CloudKitZoneSession else {
      throw Exception(name: "CloudKitSessionMissing", description: "CloudKit session '\(sessionId)' is not started.")
    }
    return session
  }
}

/// CloudKitZoneSession is one `CKSyncEngine` over one record zone of the private database.
///
/// Fetched changes are written to an inbox file before the delegate returns and stay there until
/// JavaScript acknowledges them, so the engine's change token never advances past records the
/// Tao fold has not persisted; a relaunch replays the inbox first.
@available(iOS 17.0, macOS 14.0, *)
final class CloudKitZoneSession: NSObject, CKSyncEngineDelegate {
  private static let fieldPrefix = "F_"
  private static let zoneRetryLimit = 3

  private let database: CKDatabase
  private let zoneID: CKRecordZone.ID
  private let stateURL: URL
  private let inboxURL: URL
  private let emit: ([String: Any?]) -> Void
  private var engine: CKSyncEngine!
  /// Records JavaScript asked to save, keyed by record name, until the engine has sent them.
  private var outgoing: [String: CKRecord] = [:]
  /// The server's latest copy of each record this session has seen, so a later save carries the
  /// change tag CloudKit needs; a copy missing after relaunch surfaces as a conflict that heals.
  private var known: [String: CKRecord] = [:]
  private var zoneRetries: [String: Int] = [:]
  private var inbox: [[String: Any]] = []
  /// Once an inbox write fails, no later engine position may become durable in this session: the
  /// old state must refetch the unrecorded batch after relaunch.
  private var inboxPersistenceFailed = false
  private var stopped = false
  private let lock = NSLock()

  init(container: String?, zoneName: String, stateFileName: String, emit: @escaping ([String: Any?]) -> Void) throws {
    let ckContainer = try TaoCloudKitModule.container(container)
    self.database = ckContainer.privateCloudDatabase
    self.zoneID = CKRecordZone.ID(zoneName: zoneName, ownerName: CKCurrentUserDefaultName)
    self.emit = emit
    let support = try FileManager.default.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    ).appendingPathComponent("TaoCloudKit", isDirectory: true)
    try FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)
    self.stateURL = support.appendingPathComponent(stateFileName, isDirectory: false)
    self.inboxURL = support.appendingPathComponent("\(stateFileName).inbox.json", isDirectory: false)
    super.init()

    // Restore the durable inbox before consulting the engine checkpoint. If an existing inbox
    // cannot be restored, initialization fails and the advanced checkpoint is never handed to
    // CKSyncEngine, so fetched changes cannot disappear behind a corrupt replay file.
    inbox = try Self.loadInbox(at: inboxURL)
    var configuration = CKSyncEngine.Configuration(
      database: database,
      stateSerialization: Self.loadState(at: stateURL),
      delegate: self
    )
    configuration.automaticallySync = true
    engine = CKSyncEngine(configuration)
    engine.state.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: zoneID))])
    // Pushes reach the engine only while the app is registered for remote notifications, and a
    // return to the foreground is the moment a person expects another device's edits to show.
    DispatchQueue.main.async {
      #if canImport(UIKit)
      UIApplication.shared.registerForRemoteNotifications()
      self.foregroundObserver = NotificationCenter.default.addObserver(
        forName: UIApplication.didBecomeActiveNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        guard let self, !self.isStopped else {
          return
        }
        Task {
          try? await self.engine.fetchChanges()
        }
      }
      #endif
    }
  }

  private var foregroundObserver: NSObjectProtocol?

  private var isStopped: Bool {
    lock.lock()
    defer { lock.unlock() }
    return stopped
  }

  /// stop mutes the session; the engine finishes in-flight work against a session that no longer
  /// reports or enqueues anything, and is released with the session.
  func stop() {
    lock.lock()
    stopped = true
    lock.unlock()
    if let foregroundObserver {
      NotificationCenter.default.removeObserver(foregroundObserver)
      self.foregroundObserver = nil
    }
  }

  func replayInbox() {
    lock.lock()
    let batches = inbox
    lock.unlock()
    for batch in batches {
      report(batch)
    }
  }

  func fetchChanges() async throws {
    try await engine.fetchChanges()
  }

  func send(records: [[String: Any]]) async throws {
    var changes: [CKSyncEngine.PendingRecordZoneChange] = []
    lock.lock()
    for descriptor in records {
      guard let name = descriptor["name"] as? String, let type = descriptor["type"] as? String else {
        continue
      }
      let fields = descriptor["fields"] as? [String: Any] ?? [:]
      let recordID = CKRecord.ID(recordName: name, zoneID: zoneID)
      // A copy, so a batch the engine is serializing never sees a later send's fields.
      let record = (known[name]?.copy() as? CKRecord) ?? CKRecord(recordType: type, recordID: recordID)
      for (key, value) in fields {
        record[Self.fieldPrefix + key] = Self.recordValue(value)
      }
      outgoing[name] = record
      changes.append(.saveRecord(recordID))
    }
    let active = !stopped
    lock.unlock()
    guard active else {
      return
    }
    engine.state.add(pendingRecordZoneChanges: changes)
    try await engine.sendChanges()
  }

  func acknowledge(batchId: String) throws {
    lock.lock()
    let remaining = inbox.filter { ($0["batchId"] as? String) != batchId }
    do {
      // The acknowledged effect becomes authoritative only after the new inbox is durable.
      try Self.saveInbox(remaining, at: inboxURL)
      inbox = remaining
      lock.unlock()
    } catch {
      lock.unlock()
      throw error
    }
  }

  // MARK: CKSyncEngineDelegate

  func handleEvent(_ event: CKSyncEngine.Event, syncEngine: CKSyncEngine) async {
    switch event {
    case .stateUpdate(let update):
      lock.lock()
      let mayAdvance = !inboxPersistenceFailed
      lock.unlock()
      guard mayAdvance else {
        return
      }
      do {
        try Self.saveState(update.stateSerialization, at: stateURL)
      } catch {
        report(["kind": "failed", "message": "CloudKit could not persist its checkpoint: \(error.localizedDescription)"])
      }
    case .accountChange(let change):
      report(["kind": "accountChanged", "message": Self.describe(change.changeType)])
    case .fetchedDatabaseChanges(let changes):
      if changes.deletions.contains(where: { $0.zoneID == zoneID }) {
        lock.lock()
        known.removeAll()
        outgoing.removeAll()
        zoneRetries.removeAll()
        let active = !stopped
        lock.unlock()
        if active {
          engine.state.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: zoneID))])
        }
        report(["kind": "zoneDeleted"])
      }
    case .fetchedRecordZoneChanges(let changes):
      let batch: [String: Any] = [
        "kind": "fetched",
        // A process-local counter aliases after acknowledgement/relaunch. UUID survives both and
        // makes every durable inbox effect independently acknowledgeable.
        "batchId": UUID().uuidString,
        "modifications": changes.modifications.map { Self.describe($0.record) },
        "deletions": changes.deletions.map { $0.recordID.recordName },
      ]
      lock.lock()
      let snapshot = inbox + [batch]
      do {
        // Durable before the session mutates its known records or reports the batch. If this fails,
        // the old engine state is retained and a relaunch refetches the server changes.
        try Self.saveInbox(snapshot, at: inboxURL)
        inbox = snapshot
        for modification in changes.modifications {
          known[modification.record.recordID.recordName] = modification.record
        }
        for deletion in changes.deletions {
          known.removeValue(forKey: deletion.recordID.recordName)
        }
        lock.unlock()
        report(batch)
      } catch {
        inboxPersistenceFailed = true
        lock.unlock()
        report(["kind": "failed", "message": "CloudKit could not persist a fetched batch: \(error.localizedDescription)"])
      }
    case .sentDatabaseChanges(let sent):
      for failure in sent.failedZoneSaves {
        report(["kind": "failed", "message": "CloudKit could not create the record zone: \(failure.error.localizedDescription)"])
      }
    case .sentRecordZoneChanges(let sent):
      var savedRecords: [[String: Any]] = []
      var conflicts: [[String: Any]] = []
      var failures: [[String: Any]] = []
      var retries: [CKSyncEngine.PendingRecordZoneChange] = []
      lock.lock()
      for record in sent.savedRecords {
        let name = record.recordID.recordName
        known[name] = record
        outgoing.removeValue(forKey: name)
        zoneRetries.removeValue(forKey: name)
        savedRecords.append(Self.describe(record))
      }
      for failure in sent.failedRecordSaves {
        let name = failure.record.recordID.recordName
        switch failure.error.code {
        case .serverRecordChanged:
          if let server = failure.error.serverRecord {
            known[name] = server
            conflicts.append(["name": name, "server": Self.describe(server)])
          } else {
            failures.append(["name": name, "reason": Self.describe(failure.error.code)])
          }
        case .zoneNotFound:
          let attempts = (zoneRetries[name] ?? 0) + 1
          zoneRetries[name] = attempts
          if attempts <= Self.zoneRetryLimit {
            retries.append(.saveRecord(failure.record.recordID))
          } else {
            outgoing.removeValue(forKey: name)
            failures.append(["name": name, "reason": Self.describe(failure.error.code)])
          }
        case .batchRequestFailed:
          // Another record in this atomic batch was refused; this one is untouched and goes again.
          retries.append(.saveRecord(failure.record.recordID))
        case .unknownItem:
          known.removeValue(forKey: name)
          outgoing.removeValue(forKey: name)
          failures.append(["name": name, "reason": Self.describe(failure.error.code)])
        default:
          outgoing.removeValue(forKey: name)
          failures.append(["name": name, "reason": Self.describe(failure.error.code)])
        }
      }
      let active = !stopped
      lock.unlock()
      if active && !retries.isEmpty {
        engine.state.add(pendingDatabaseChanges: [.saveZone(CKRecordZone(zoneID: zoneID))])
        engine.state.add(pendingRecordZoneChanges: retries)
      }
      report(["kind": "sent", "savedRecords": savedRecords, "conflicts": conflicts, "failures": failures])
    case .willFetchChanges, .willFetchRecordZoneChanges, .didFetchRecordZoneChanges, .didFetchChanges,
         .willSendChanges, .didSendChanges:
      break
    @unknown default:
      break
    }
  }

  func nextRecordZoneChangeBatch(
    _ context: CKSyncEngine.SendChangesContext,
    syncEngine: CKSyncEngine
  ) async -> CKSyncEngine.RecordZoneChangeBatch? {
    let pending = syncEngine.state.pendingRecordZoneChanges.filter { context.options.scope.contains($0) }
    lock.lock()
    let records = outgoing
    lock.unlock()
    // A pending change without a record to send — JavaScript has not re-sent it since a relaunch —
    // leaves the engine's state rather than lingering as a change the batch skips forever.
    let orphaned = pending.filter { change in
      if case .saveRecord(let recordID) = change {
        return records[recordID.recordName] == nil
      }
      return false
    }
    if !orphaned.isEmpty {
      syncEngine.state.remove(pendingRecordZoneChanges: orphaned)
    }
    let sendable = pending.filter { !orphaned.contains($0) }
    var batch = await CKSyncEngine.RecordZoneChangeBatch(pendingChanges: sendable) { recordID in
      records[recordID.recordName]
    }
    // A change-set lands all-or-nothing: if one record of the batch is refused, the rest come
    // back as `batchRequestFailed` and are queued again behind the resolved conflict.
    batch?.atomicByZone = true
    return batch
  }

  // MARK: Reporting

  private func report(_ body: [String: Any]) {
    lock.lock()
    let active = !stopped
    lock.unlock()
    if active {
      emit(body.mapValues { $0 })
    }
  }

  // MARK: Record description

  private static func describe(_ record: CKRecord) -> [String: Any] {
    var fields: [String: Any] = [:]
    for key in record.allKeys() where key.hasPrefix(fieldPrefix) {
      fields[String(key.dropFirst(fieldPrefix.count))] = plainValue(record[key])
    }
    return ["name": record.recordID.recordName, "type": record.recordType, "fields": fields]
  }

  private static func describe(_ code: CKError.Code) -> String {
    switch code {
    case .serverRecordChanged: return "serverRecordChanged"
    case .zoneNotFound: return "zoneNotFound"
    case .unknownItem: return "unknownItem"
    case .quotaExceeded: return "quotaExceeded"
    case .networkUnavailable, .networkFailure: return "networkUnavailable"
    case .notAuthenticated: return "notAuthenticated"
    case .permissionFailure: return "permissionFailure"
    default: return "ckError\(code.rawValue)"
    }
  }

  private static func describe(_ change: CKSyncEngine.Event.AccountChange.ChangeType) -> String {
    switch change {
    case .signIn: return "The iCloud account signed in."
    case .signOut: return "The iCloud account signed out."
    case .switchAccounts: return "The iCloud account switched."
    @unknown default: return "The iCloud account changed."
    }
  }

  /// Field values are numbers or text: the Tao provider spells booleans as 1 and 0, relations and
  /// stamps as text, so nothing here depends on CloudKit's number typing.
  private static func recordValue(_ value: Any) -> CKRecordValue? {
    if let number = value as? NSNumber {
      return number
    }
    if let string = value as? String {
      return string as NSString
    }
    return nil
  }

  private static func plainValue(_ value: CKRecordValue?) -> Any {
    guard let value else {
      return NSNull()
    }
    if let number = value as? NSNumber {
      return number.doubleValue
    }
    if let string = value as? String {
      return string
    }
    return String(describing: value)
  }

  // MARK: Persistence

  private static func loadState(at url: URL) -> CKSyncEngine.State.Serialization? {
    guard let data = try? Data(contentsOf: url) else {
      return nil
    }
    return try? JSONDecoder().decode(CKSyncEngine.State.Serialization.self, from: data)
  }

  private static func saveState(_ state: CKSyncEngine.State.Serialization, at url: URL) throws {
    let data = try JSONEncoder().encode(state)
    try data.write(to: url, options: .atomic)
  }

  private static func loadInbox(at url: URL) throws -> [[String: Any]] {
    guard FileManager.default.fileExists(atPath: url.path) else {
      return []
    }

    let data: Data
    do {
      data = try Data(contentsOf: url)
    } catch {
      throw inboxLoadError(at: url, cause: error)
    }

    let value: Any
    do {
      value = try JSONSerialization.jsonObject(with: data)
    } catch {
      throw inboxLoadError(at: url, cause: error)
    }
    guard let batches = value as? [[String: Any]] else {
      throw inboxLoadError(at: url)
    }

    var batchIds = Set<String>()
    for batch in batches {
      guard batch["kind"] as? String == "fetched",
        let batchId = batch["batchId"] as? String,
        !batchId.isEmpty,
        batch["modifications"] is [[String: Any]],
        batch["deletions"] is [String],
        batchIds.insert(batchId).inserted
      else {
        throw inboxLoadError(at: url)
      }
    }
    return batches
  }

  private static func inboxLoadError(at url: URL, cause: Error? = nil) -> NSError {
    var details: [String: Any] = [
      NSLocalizedDescriptionKey:
        "CloudKit could not restore its durable inbox '\(url.lastPathComponent)'. Sync did not start, so its saved checkpoint was not used without those changes.",
    ]
    if let cause {
      details[NSUnderlyingErrorKey] = cause
    }
    return NSError(domain: "TaoCloudKitInbox", code: 1, userInfo: details)
  }

  private static func saveInbox(_ batches: [[String: Any]], at url: URL) throws {
    let data = try JSONSerialization.data(withJSONObject: batches)
    try data.write(to: url, options: .atomic)
  }
}
