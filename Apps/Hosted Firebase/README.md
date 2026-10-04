# Firebase Notes

This app stores each signed-in account's data in a private Firebase store. Set up a Firebase
project with Email/Password sign-in and Firestore before running the app.

From this project directory:

1. Run `tao connect firebase .` to save the public connection settings locally in
   `.tao/local/connections.json`. The checked-in placeholders in `App.tao` are overridden locally.
2. Run `tao firebase generate . --app FirebaseNotes --output .tao/firebase-backend`.
   Review and combine those rules with any existing rules in that Firebase project before deploying:
   a Firestore rules deployment replaces the project's current rules. Generation does not deploy.
3. Run `tao dev . --app FirebaseNotes` and sign in or create an account.

Run `tao test .` for the local Memory/TestAuth journeys. They do not contact Firebase.

The Fill validation credentials button only fills synthetic example values and never submits. Remove it after hosted validation.
