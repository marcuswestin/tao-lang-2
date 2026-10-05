# Firebase Notes

This app stores each signed-in account's data in a private Firebase store.

From this project directory:

1. Run `tao connect firebase --app FirebaseNotes`. Complete Google sign-in locally if
   requested, select your existing Firebase project, and review the proposed setup. Tao retrieves
   the public app config, enables Email/Password sign-in, and configures the default Firestore
   database and the app's private rules. Public settings are saved in `.tao/local/connections.json`;
   the checked-in placeholders in `App.tao` are overridden locally.
2. Run `tao run . --app FirebaseNotes` and sign in or create an account.

For Console setup instead, run `tao connect firebase --manual` and follow its direct project links.
To generate deployment files without deploying, run
`tao firebase generate --app FirebaseNotes --output .tao/firebase-backend`.
The command creates the local `.tao/firebase-backend` folder with `firestore.rules`,
`firestore.indexes.json`, and `firebase.json`; no separate backend server is needed.
Review existing project rules before deployment. If API setup stops for unfamiliar rules,
review its downloaded current rules and generated candidate, then rerun with `--rules` and
that reviewed combined file. Keep rules for other apps using the same Firebase project.

Run `tao test .` for the local Memory/TestAuth journeys. They do not contact Firebase.

The two temporary validation-account buttons at the bottom of sign-in fill the Developer-selected test accounts without submitting. Remove them after hosted validation. The CLI generator retains generic synthetic values for other apps.

## Hosted acceptance

After updating source, rerun API connect to review and deploy the current generated rules, then
run the app. The local Memory/TestAuth journeys and provider fixtures do not prove hosted behavior.

1. On Simulator, sign in and confirm the account loads; create, edit and delete a note.
2. On iPhone, sign into the same account. Change a note on Simulator and check that iPhone updates
   without reloading; change one on iPhone and observe Simulator.
3. On iPhone, disconnect networking, create/edit/delete notes, restart the app, and verify local
   state survives. Reconnect and confirm replay on Simulator.
4. On either device, switch between the two accounts online and offline. Check that the other
   account's notes and pending writes never appear under the new account.
5. From the repository root, run the direct server probe:

   ```sh
   bun run 'Apps/Hosted Firebase/scripts/hostile-probe.ts'
   ```

   Confirm the printed project ID. Enter both existing accounts' passwords only in its hidden
   local prompts. It writes randomized Item fixtures and retains cleanup tombstones. Review the
   printed redacted evidence path: positive controls and hostile responses must pass, with no
   inconclusive results or unfinished cleanup. UI filtering does not substitute for server denial.

If native loading fails, retain the original stage/cause from development app logs. No cache reset
is needed for the bounded Account default repair. Remove the temporary fill buttons after acceptance.
