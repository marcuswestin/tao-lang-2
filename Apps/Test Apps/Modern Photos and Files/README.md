# Modern Photos and Files acceptance

This app consumes the maintained `@tao/device/files` and `@tao/device/photos`
generated actions directly. It supplies no TypeScript adapter or native API mock.
The host supplies the pinned native packages and config plugins. Nothing requests
permission or touches device storage when the app or either scene opens.

The `.test.tao` journeys cover opening each scene and its initial rendered result
labels. They do not exercise native operations. The ordinary Tao test runner uses
its module test host; it does not run
these native acceptance journeys on a device. Source validation, compilation,
shell tests, native builds and the journeys below are separate evidence.
The migrated source passes validation and both shell journeys on 2026-10-05.
The Syntax2 migration has not been accepted on a native host; the native I/O and
permission journeys remain unproved.

## Files native journey

Run `ModernPhotosFiles` in the managed iOS app workflow or Companion. Open **Files
acceptance**, then press **Run file roundtrip**. Require all of the following:

1. `Status: File roundtrip complete`, `Text: Hello native`, and
   `Copy name: renamed.txt`.
2. `Byte size: 5`. Each of `Byte`, `Handle byte` and `Stream byte` renders the
   sequence `0`, `1`, `127`, `128`, `255` in that order.
3. `Stream chunk received: true`, `Stream end reached: true`,
   `Stream locked before release: true` and `Stream locked after release: false`.

The command creates text and byte files, reads fresh native properties, copies
and renames a file, writes and reads through a native handle, closes the handle,
opens a native stream, reads its byte chunk and end-of-stream result, cancels its
reader and releases its lock. Each generated resource registers cleanup
immediately after acquisition. Scope exit closes the
file handle before invalidating its wrapper. The nested reader scope cancels the
reader, releases its lock and invalidates its wrapper before the outer stream
wrapper is invalidated. Repeat the command to prove the owned fixture can be
replaced and the file resources reopened.

The generated
`Reader.Read()` associated action returns
`ReadableStreamBYOBReaderReadForUint8ArrayArrayBufferResult`, a union of
`ReadableStreamReadValueResultUint8ArrayArrayBuffer` and
`ReadableStreamReadDoneResultUint8ArrayArrayBuffer`. The first record has a
required byte-list `Value`; the end-of-stream record has an optional `Value`.
Their `Done` fields use distinct generated one-case types for false and true.

The fixture binds each read result, calls the generated union-member predicate,
then calls its checked projection before accessing `Value` or `Done`. The
projection validates the member again. It uses neither an unchecked cast nor a
handwritten native adapter. The second read must produce the end-of-stream
member; locking and release alone do not satisfy this journey. Source acceptance
does not prove that the native stream returned these results; record all byte and
end-of-stream observations from the host.

Press **Run cancellation resource**. Require `Status: Cancellation complete`,
`Aborted before: false`, `Aborted after: true`, `Reason kind: number`,
`Reason number: 7`, and `Abort check: Abort rejected`. The reason comes from the
generated JSON reader, passes into the generated controller operation, and is
read back through the generated signal and boxed-value readers. This checks a
cancellation resource; it does not prove cancellation of an in-flight transfer.

Press **Remove owned files**. Require `Status: Owned files removed`. Press it
again to prove cleanup is harmless when the directory is absent.

All mutations are confined to the literal
`tao-modern-photos-files-acceptance` directory under this app's `Paths.cache`.
The roundtrip clears only this directory before creating its fixture. It never
opens a user-selected file or accepts an externally supplied deletion path.
Native effects cannot roll back if a later action fails. Lexical cleanup runs on
normal and failed exits, in reverse acquisition order; cleanup failures remain
attached to the original failure, or fail the operation themselves when there is
no earlier failure. Process termination can still bypass cleanup, and cleanup
does not undo file writes, copies, renames or deletes. Preserve a failed run's
reported error and use **Remove owned files** if its owned fixture remains. Do
not remove files outside the named directory to recover this fixture.

## Photos native journeys

Open **Photos acceptance** and press **Check current permission**. Require
`Status: Permission check complete`; record the displayed permission, access
privileges and whether the system allows another request. Checking alone must
not display a consent prompt. The read controls stay disabled until a permission
response grants access.

Use an owned test simulator or a person-controlled device and the normal platform
consent UI. Do not silently grant permission. Each branch requires its own native
observation:

1. **Denied:** Press **Request photo access**, deny access in the platform prompt,
   and require `Permission: denied`, `Access: none`, and disabled read controls.
   Press **Check current permission** again and require the same state without
   a new prompt. `Can ask again` is platform state, not a fixed expectation.
2. **Limited, iOS:** Select limited access through the platform's consent flow or
   app permission settings. Press **Check current permission** and require
   `Permission: granted`, `Access: limited`, and enabled read controls. Read only
   photos permitted by that selection. Changing the selection in system settings
   and checking again must reflect the current native response.
3. **Granted query and pagination:** For deterministic evidence, use a clean owned
   simulator with exactly three task-created image assets, created at distinct
   times, and grant access to all three. Press **Read first photo page** and
   require `Status: Photo query complete`, `Offset: 0`, and `Returned photos: 2`.
   Record both rendered IDs. Press **Read next photo page** and require
   `Offset: 2`, `Returned photos: 1`, and a third ID. Press it again and require
   `Offset: 4` and `Returned photos: 0`. Press **Read first photo page** and
   require the original two IDs again.

Without that controlled library, counts and IDs depend on the authorized
library; record them and do not claim the deterministic three-asset journey
passed. The query uses the generated image predicate, creation-time ordering,
limit, offset and metadata execution actions. It creates, edits and deletes no
Photos assets or albums. The integration owner manages any simulator seeding
and removes only assets that that fixture created.

Record the host, platform, permission branch, visible results and failures for
each journey. A successful build or shell test is not a completed native journey.
