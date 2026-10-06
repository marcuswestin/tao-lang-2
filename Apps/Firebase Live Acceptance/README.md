# Firebase Live Acceptance

This app stores each signed-in account's data in a private Firebase store.

From this project directory:

1. Run `tao connect firebase --app FirebaseLiveAcceptance`. Complete Google sign-in locally if
   requested, select your existing Firebase project, and review the proposed setup. Tao retrieves
   the public app config, enables Email/Password sign-in, and configures the default Firestore
   database and the app's private rules. Public settings are saved in `.tao/local/connections.json`;
   the checked-in placeholders in `App.tao` are overridden locally.
2. Run `tao run . --app FirebaseLiveAcceptance` and sign in or create an account.

For Console setup instead, run `tao connect firebase --manual` and follow its direct project links.
To generate deployment files without deploying, run
`tao firebase generate --app FirebaseLiveAcceptance --output .tao/firebase-backend`.
The command creates the local `.tao/firebase-backend` folder with `firestore.rules`,
`firestore.indexes.json`, and `firebase.json`; no separate backend server is needed.
Review existing project rules before deployment. If API setup stops for unfamiliar rules,
review its downloaded current rules and generated candidate, then rerun with `--rules` and
that reviewed combined file. Keep rules for other apps using the same Firebase project.

Run `tao test .` for the local Memory/TestAuth journeys. They do not contact Firebase.

This is the fresh-project fixture for managed Firebase acceptance. The two validation buttons at the bottom of the sign-in screen fill the supplied sample accounts (narcvs+crud@gmail.com and narcvs@gmail.com); neither button submits. Remove them after hosted validation.

The local journeys use Memory and TestAuth. Hosted acceptance separately requires the generated app to load on web and iOS, authenticate, and show writes in both directions without a reload. Keep source-test results separate from that live evidence. Public Firebase settings and private test evidence stay under ignored local directories.
