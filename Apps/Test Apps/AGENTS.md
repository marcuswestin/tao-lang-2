# Test Apps

- Test apps are positive executable examples of implemented Tao behavior. Put diagnostic and invalid-source cases in package tests.
- Keep each entry in `Apps/Test Apps/<Entry Name>/` with its Tao sources and behavior tests. A folder may hold several `app` declarations, one per subject; every check names the app it drives with `run <AppName>`.
- `Apps/Test Apps/README.md` owns each entry's purpose and scope, and `repo-lint` requires a `## <Entry Name>` heading for every folder. Update the entry in the same change that expands an app beyond the documented contract.
- Add only behavior that belongs to that app; create focused package coverage or another app for unrelated cases.
