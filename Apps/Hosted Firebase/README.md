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
