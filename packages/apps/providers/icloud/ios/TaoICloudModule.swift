import ExpoModulesCore
import Foundation

/// TaoICloudModule exposes the app's iCloud Drive container to Tao datasources as named documents:
/// coordinated reads and writes, newest-wins conflict resolution, and change events driven by a
/// metadata query. Documents live outside the container's `Documents/` folder, so the Files app
/// never surfaces them while iCloud still syncs them between the account's devices.
public final class TaoICloudModule: Module {
  /// Watches are main-thread objects (metadata queries), so the table is main-thread confined.
  private var watches: [String: DocumentWatch] = [:]
  /// Reads may wait for a download; running them concurrently keeps one stalled document from
  /// blocking every other datasource's calls through this module.
  private let documentQueue = DispatchQueue(label: "tao.icloud.documents", attributes: .concurrent)

  public func definition() -> ModuleDefinition {
    Name("TaoICloud")
    Events("documentChanged")

    AsyncFunction("readDocument") { (container: String?, name: String) throws -> String? in
      try ICloudDocuments.read(try ICloudDocuments.url(container: container, name: name))
    }.runOnQueue(documentQueue)

    AsyncFunction("writeDocument") { (container: String?, name: String, contents: String) throws in
      try ICloudDocuments.write(contents, to: try ICloudDocuments.url(container: container, name: name))
    }.runOnQueue(documentQueue)

    // JavaScript names the watch so no event can arrive before its owner knows the identifier. The
    // container URL resolves off the main thread, as Apple requires; only the watch starts on it,
    // synchronously, so a stop that follows this call's return never races the start.
    AsyncFunction("startWatching") { (watchId: String, container: String?, name: String) throws in
      let url = try ICloudDocuments.url(container: container, name: name)
      DispatchQueue.main.sync {
        self.watches.removeValue(forKey: watchId)?.stop()
        let watch = DocumentWatch(url: url) { [weak self] event in
          var body = event
          body["watchId"] = watchId
          self?.sendEvent("documentChanged", body)
        }
        self.watches[watchId] = watch
        watch.start()
      }
    }.runOnQueue(documentQueue)

    AsyncFunction("stopWatching") { (watchId: String) in
      self.watches.removeValue(forKey: watchId)?.stop()
    }.runOnQueue(.main)

    OnDestroy {
      DispatchQueue.main.async {
        for watch in self.watches.values {
          watch.stop()
        }
        self.watches.removeAll()
      }
    }
  }
}

/// ICloudDocuments owns the file-level protocol: where a document lives, how it is read and
/// written under file coordination, and how conflicting versions collapse to the newest one.
enum ICloudDocuments {
  static let folderName = "Tao Data"
  /// How long a read waits for iCloud's metadata to say whether a document that is absent locally
  /// exists in the cloud, so a freshly signed-in device does not mount empty and then win the
  /// conflict against the account's real data.
  static let locateTimeout: TimeInterval = 8

  static func url(container: String?, name: String) throws -> URL {
    guard let root = FileManager.default.url(forUbiquityContainerIdentifier: container) else {
      throw Exception(
        name: "ICloudUnavailable",
        description: container == nil
          ? "iCloud is unavailable: sign in to iCloud on this device and check the app's iCloud entitlement."
          : "iCloud container '\(container!)' is unavailable: sign in to iCloud on this device and check that the app's entitlement names this container."
      )
    }
    return root
      .appendingPathComponent(folderName, isDirectory: true)
      .appendingPathComponent(name, isDirectory: false)
  }

  /// read returns the document's contents, or nil when no document exists locally or in iCloud.
  /// An item known to iCloud but not yet local is downloaded first; a coordinated read of an
  /// undownloaded ubiquitous item waits for that download.
  static func read(_ url: URL) throws -> String? {
    if !FileManager.default.fileExists(atPath: url.path) && !existsInCloud(url) {
      return nil
    }
    try resolveConflicts(at: url, keepNewest: true)
    try? FileManager.default.startDownloadingUbiquitousItem(at: url)
    var coordinationError: NSError?
    var outcome: Result<String?, Error> = .success(nil)
    NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { readURL in
      do {
        let data = try Data(contentsOf: readURL)
        outcome = .success(String(decoding: data, as: UTF8.self))
      } catch let error as NSError where isMissingFile(error) {
        outcome = .success(nil)
      } catch {
        outcome = .failure(error)
      }
    }
    if let coordinationError {
      if isMissingFile(coordinationError) {
        return nil
      }
      throw coordinationError
    }
    return try outcome.get()
  }

  /// write replaces the document atomically. A snapshot written here supersedes every conflicting
  /// version, since the runtime committed it over the newest contents it had seen.
  static func write(_ contents: String, to url: URL) throws {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try coordinatedWrite(at: url) { writeURL in
      try Data(contents.utf8).write(to: writeURL, options: .atomic)
    }
    try resolveConflicts(at: url, keepNewest: false)
  }

  /// resolveConflicts collapses iCloud's conflict versions. With keepNewest the version with the
  /// latest modification date becomes the current contents (last snapshot wins, as the InstantDB
  /// provider behaves); without it the current contents stand. Either way the conflicts are marked
  /// resolved and the other versions removed, under coordination, so they never accumulate.
  static func resolveConflicts(at url: URL, keepNewest: Bool) throws {
    guard let conflicts = NSFileVersion.unresolvedConflictVersionsOfItem(at: url), !conflicts.isEmpty else {
      return
    }
    if keepNewest, let current = NSFileVersion.currentVersionOfItem(at: url) {
      let newest = conflicts.reduce(current) { best, candidate in
        modificationDate(candidate) > modificationDate(best) ? candidate : best
      }
      if newest !== current {
        try coordinatedWrite(at: url) { writeURL in
          _ = try newest.replaceItem(at: writeURL)
        }
      }
    }
    for conflict in conflicts {
      conflict.isResolved = true
    }
    try coordinatedWrite(at: url) { writeURL in
      try NSFileVersion.removeOtherVersionsOfItem(at: writeURL)
    }
  }

  /// existsInCloud asks iCloud's metadata whether the document exists anywhere, bounded by
  /// `locateTimeout`. Offline, the query finishes from local knowledge almost at once.
  static func existsInCloud(_ url: URL) -> Bool {
    let query = NSMetadataQuery()
    query.searchScopes = [NSMetadataQueryUbiquitousDataScope, NSMetadataQueryUbiquitousDocumentsScope]
    query.predicate = NSPredicate(format: "%K == %@", NSMetadataItemFSNameKey, url.lastPathComponent)
    let finished = DispatchSemaphore(value: 0)
    var found = false
    var observer: NSObjectProtocol?
    DispatchQueue.main.async {
      observer = NotificationCenter.default.addObserver(
        forName: .NSMetadataQueryDidFinishGathering,
        object: query,
        queue: .main
      ) { _ in
        query.disableUpdates()
        found = DocumentWatch.item(for: url, in: query) != nil
        query.stop()
        finished.signal()
      }
      query.start()
    }
    if finished.wait(timeout: .now() + locateTimeout) == .timedOut {
      DispatchQueue.main.async {
        query.stop()
      }
    }
    if let observer {
      NotificationCenter.default.removeObserver(observer)
    }
    return found
  }

  private static func coordinatedWrite(at url: URL, _ body: (URL) throws -> Void) throws {
    var coordinationError: NSError?
    var bodyError: Error?
    NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { writeURL in
      do {
        try body(writeURL)
      } catch {
        bodyError = error
      }
    }
    if let coordinationError {
      throw coordinationError
    }
    if let bodyError {
      throw bodyError
    }
  }

  private static func modificationDate(_ version: NSFileVersion) -> Date {
    version.modificationDate ?? .distantPast
  }

  private static func isMissingFile(_ error: NSError) -> Bool {
    (error.domain == NSCocoaErrorDomain
      && (error.code == NSFileReadNoSuchFileError || error.code == NSFileNoSuchFileError))
      || (error.domain == NSPOSIXErrorDomain && error.code == Int(ENOENT))
  }
}

/// DocumentWatch follows one document through a metadata query and reports each distinct contents
/// it observes. A not-yet-downloaded change starts its download; the query fires again once the
/// download lands. Reads run off the main thread so a large document never stalls the query.
final class DocumentWatch {
  private let url: URL
  private let query = NSMetadataQuery()
  private let emit: ([String: Any?]) -> Void
  private let readQueue = DispatchQueue(label: "tao.icloud.document-watch")
  private var observers: [NSObjectProtocol] = []
  private var lastPublished: String??

  init(url: URL, emit: @escaping ([String: Any?]) -> Void) {
    self.url = url
    self.emit = emit
    query.searchScopes = [NSMetadataQueryUbiquitousDataScope, NSMetadataQueryUbiquitousDocumentsScope]
    query.predicate = NSPredicate(format: "%K == %@", NSMetadataItemFSNameKey, url.lastPathComponent)
  }

  static func item(for url: URL, in query: NSMetadataQuery) -> NSMetadataItem? {
    let path = url.standardizedFileURL.path
    let items = (query.results as? [NSMetadataItem]) ?? []
    return items.first { item in
      (item.value(forAttribute: NSMetadataItemPathKey) as? String).map {
        URL(fileURLWithPath: $0).standardizedFileURL.path == path
      } ?? false
    }
  }

  func start() {
    let center = NotificationCenter.default
    for name in [NSNotification.Name.NSMetadataQueryDidFinishGathering, .NSMetadataQueryDidUpdate] {
      observers.append(center.addObserver(forName: name, object: query, queue: .main) { [weak self] _ in
        self?.refresh()
      })
    }
    query.start()
  }

  func stop() {
    query.stop()
    for observer in observers {
      NotificationCenter.default.removeObserver(observer)
    }
    observers.removeAll()
  }

  private func refresh() {
    query.disableUpdates()
    let match = Self.item(for: url, in: query)
    let downloadingStatus = match?.value(forAttribute: NSMetadataUbiquitousItemDownloadingStatusKey) as? String
    query.enableUpdates()

    readQueue.async { [weak self] in
      guard let self else {
        return
      }
      do {
        guard match != nil else {
          self.publish(nil)
          return
        }
        if downloadingStatus != nil && downloadingStatus != NSMetadataUbiquitousItemDownloadingStatusCurrent {
          try FileManager.default.startDownloadingUbiquitousItem(at: self.url)
          return
        }
        self.publish(try ICloudDocuments.read(self.url))
      } catch {
        self.emit(["error": error.localizedDescription])
      }
    }
  }

  private func publish(_ contents: String?) {
    if case .some(let previous) = lastPublished, previous == contents {
      return
    }
    lastPublished = .some(contents)
    emit(["contents": contents])
  }
}
