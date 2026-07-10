# Windows Desktop E2E

This folder contains the Windows validation harness for the portable desktop package. It simulates the user path:

1. Download a GitHub Actions artifact, or use a local zip.
2. Verify commit, SHA-256, and required package files.
3. Extract to a clean directory.
4. Launch `GenericAgent.exe` directly.
5. Wait for first-run prepare, bridge identity, and bootstrap `ready`.
6. In `Full` mode, inject an unknown process on port `14168`, verify `port_conflict`, release it, and retry from setup.

## Full Run

```powershell
.\frontends\desktop\e2e\windows\Invoke-WindowsUserJourney.ps1 `
  -Repo abraxas914/GenericAgent `
  -RunId 29071095889 `
  -ExpectedCommit 696ddfc `
  -Mode Full
```

Use `-PackageZip C:\path\GenericAgent-Desktop-Windows-Portable.zip` when the artifact has expired or has already been downloaded.

## Modes

- `Smoke`: package verification, extraction, first launch, prepare marker, bridge identity, bootstrap ready.
- `FailureOnly`: assumes the package can be extracted and focuses on the unknown port conflict and setup retry path.
- `Full`: runs `Smoke`, then the failure path.

## Manual Checks

The script collects screenshots and writes these checklist items to the report for the tester to mark externally:

- Loading, prepare, setup, and main windows always show the Windows titlebar.
- Right side has exactly minimize, maximize, and close.
- Blank titlebar area drags the window; button area does not.
- Minimize works.
- Maximize and restore work.
- Close hides to tray instead of exiting.
- Sidebar nav sits directly below the custom titlebar with no blank row.

## Report

Reports are written under `<WorkDir>\report`:

- `e2e-report.json`
- `bootstrap-events.jsonl`
- `bootstrap-latest.json`
- screenshots such as `loading-first.png`, `main-ready.png`, and `setup-failure.png`

Failures exit non-zero and keep diagnostics unless `-KeepWorkDir` is omitted and cleanup succeeds.
