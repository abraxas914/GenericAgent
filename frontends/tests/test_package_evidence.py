import importlib.util
import json
import plistlib
import urllib.request
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]


def load_module(name: str, relative: str):
    path = ROOT / relative
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


journey = load_module(
    "real_package_journey",
    "frontends/desktop/e2e/package/real_package_journey.py",
)
evidence = load_module(
    "verify_candidate_evidence",
    "frontends/desktop/e2e/package/verify_candidate_evidence.py",
)


def complete_report(platform: str = "linux"):
    checks = {name: True for name in evidence.COMMON_CHECKS}
    checks["portRecovery"] = "release-then-production-restart"
    if platform == "macos":
        checks["macAppImmutable"] = True
    bootstrap = {
        name: {"phase": "failed" if name == "foreign-port" else "ready"}
        for name in (
            "first-launch",
            "warm-restart",
            "foreign-port",
            "after-port-release",
            "relocated",
            "stale-override",
        )
    }
    return {
        "expectedCommit": "abc1234",
        "releaseVersion": "0.2.0",
        "artifact": {"sha256": "f" * 64},
        "success": True,
        "checks": checks,
        "bootstrap": bootstrap,
        "manualChecklist": {"nativeVisuals": "pass"},
        "screenshots": ["ready.png", "foreign.png"],
    }


def test_candidate_report_contract_accepts_complete_platform_evidence():
    assert evidence.assert_report("linux", complete_report(), "abc1234") == []
    assert evidence.assert_report("macos", complete_report("macos"), "abc1234") == []


def test_candidate_report_contract_rejects_incomplete_manual_and_commit_evidence():
    report = complete_report()
    report["expectedCommit"] = "different"
    report["manualChecklist"]["nativeVisuals"] = "pending"
    failures = evidence.assert_report("linux", report, "abc1234")
    assert any("commit" in failure for failure in failures)
    assert any("manual checklist" in failure for failure in failures)


def test_stdlib_fake_model_emits_sse_and_redacts_auth_in_transcript():
    fake = journey.FakeOpenAI()
    fake.start()
    try:
        request = urllib.request.Request(
            fake.base_url + "/v1/chat/completions",
            data=json.dumps({"model": "e2e-model"}).encode(),
            headers={"Authorization": "Bearer secret", "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=5) as response:
            body = response.read().decode()
        assert "Harness reply" in body
        assert "[DONE]" in body
        assert fake.transcript == [
            {
                "path": "/v1/chat/completions",
                "model": "e2e-model",
                "authorization": "[redacted]",
                "at": fake.transcript[0]["at"],
            }
        ]
    finally:
        fake.stop()


def write_info_plist(root: Path, **overrides):
    contents = root / "Contents"
    contents.mkdir(parents=True, exist_ok=True)
    values = {
        "CFBundleShortVersionString": "0.2.0",
        "CFBundleVersion": "0.2.0",
        **overrides,
    }
    with (contents / "Info.plist").open("wb") as stream:
        plistlib.dump(values, stream)


def test_macos_package_version_comes_from_both_native_bundle_keys(tmp_path):
    write_info_plist(tmp_path)
    assert journey.read_macos_bundle_versions(tmp_path) == ("0.2.0", "0.2.0")


@pytest.mark.parametrize("key", ["CFBundleShortVersionString", "CFBundleVersion"])
@pytest.mark.parametrize("value", ["0.2.1", 200])
def test_macos_package_version_rejects_wrong_or_non_string_keys(tmp_path, key, value):
    write_info_plist(tmp_path, **{key: value})
    with pytest.raises(journey.JourneyFailure, match=key):
        journey.read_macos_bundle_versions(tmp_path)


@pytest.mark.parametrize("key", ["CFBundleShortVersionString", "CFBundleVersion"])
def test_macos_package_version_rejects_missing_keys(tmp_path, key):
    write_info_plist(tmp_path)
    path = tmp_path / "Contents" / "Info.plist"
    with path.open("rb") as stream:
        values = plistlib.load(stream)
    del values[key]
    with path.open("wb") as stream:
        plistlib.dump(values, stream)
    with pytest.raises(journey.JourneyFailure, match=key):
        journey.read_macos_bundle_versions(tmp_path)


@pytest.mark.parametrize("payload", [b"not a plist", b"", plistlib.dumps([])])
def test_macos_package_version_rejects_invalid_or_empty_plist(tmp_path, payload):
    contents = tmp_path / "Contents"
    contents.mkdir()
    (contents / "Info.plist").write_bytes(payload)
    with pytest.raises(journey.JourneyFailure, match="missing or invalid"):
        journey.read_macos_bundle_versions(tmp_path)


def test_macos_package_version_rejects_missing_plist(tmp_path):
    with pytest.raises(journey.JourneyFailure, match="missing or invalid"):
        journey.read_macos_bundle_versions(tmp_path)


def test_package_shape_rejects_excluded_source_package_json(tmp_path):
    package_root = tmp_path / "GenericAgent.app"
    runtime_root = package_root / "Contents" / "Resources" / "runtime"
    application = package_root / "Contents" / "MacOS" / "GenericAgent"
    for path in [
        application,
        runtime_root / "app" / "agentmain.py",
        runtime_root / "app" / "frontends" / "desktop_bridge.py",
        runtime_root / "app" / "frontends" / "desktop" / "static" / "index.html",
        runtime_root / "python" / "bin" / "python3",
        runtime_root / ".prepared",
        runtime_root / "app" / "frontends" / "desktop" / "package.json",
    ]:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{}", encoding="utf-8")
    write_info_plist(package_root)

    candidate = object.__new__(journey.Journey)
    candidate.args = type("Args", (), {"platform": "macos"})()
    candidate.package_root = package_root
    candidate.runtime_root = runtime_root
    candidate.application = application
    candidate.report = {"checks": {}}

    with pytest.raises(journey.JourneyFailure, match="excluded Desktop source metadata"):
        candidate.check_package_shape()

    (runtime_root / "app" / "frontends" / "desktop" / "package.json").unlink()
    candidate.check_package_shape()
    assert candidate.report["checks"] == {
        "packagedVersion": "0.2.0",
        "packagedBundleVersion": "0.2.0",
        "packageShape": True,
    }
