from __future__ import annotations

import json
import stat
import zipfile
from pathlib import Path

import pytest

from frontends.data_backup import (
    BACKUP_FORMAT_VERSION,
    BACKUP_SCHEMA,
    BackupFormatError,
    export_data_backup,
    inspect_import_source,
    materialize_import_source,
    merge_data_files,
)


def _seed_data(root: Path) -> None:
    (root / "memory" / "nested").mkdir(parents=True)
    (root / "memory" / "notes.md").write_text("memory", encoding="utf-8")
    (root / "memory" / "nested" / "facts.json").write_text("{}", encoding="utf-8")
    (root / "temp" / "model_responses").mkdir(parents=True)
    (root / "temp" / "model_responses" / "response.json").write_text("{}", encoding="utf-8")
    (root / "temp" / "desktop_sessions").mkdir(parents=True)
    (root / "temp" / "desktop_sessions" / "sess-one.json").write_text("{}", encoding="utf-8")
    (root / "mykey.py").write_text("secret", encoding="utf-8")
    (root / "agentmain.py").write_text("code", encoding="utf-8")
    (root / "logs").mkdir()
    (root / "logs" / "bridge.log").write_text("private log", encoding="utf-8")


class TestDataBackupExport:
    def test_exports_only_allowed_data_and_private_manifest(self, tmp_path: Path):
        source = tmp_path / "source"
        source.mkdir()
        _seed_data(source)
        destination = tmp_path / "GenericAgent-data-backup.zip"

        result = export_data_backup(str(source), str(destination), "localRepository")

        assert result["content"] == {"memory": 2, "responses": 1, "sessions": 1}
        with zipfile.ZipFile(destination) as archive:
            names = set(archive.namelist())
            assert names == {
                "manifest.json",
                "memory/notes.md",
                "memory/nested/facts.json",
                "temp/model_responses/response.json",
                "temp/desktop_sessions/sess-one.json",
            }
            manifest = json.loads(archive.read("manifest.json"))
        assert manifest["schema"] == BACKUP_SCHEMA
        assert manifest["formatVersion"] == BACKUP_FORMAT_VERSION
        assert manifest["sourceMode"] == "localRepository"
        assert str(source) not in json.dumps(manifest)
        assert "mykey.py" not in names
        assert "agentmain.py" not in names
        assert "logs/bridge.log" not in names

    def test_skips_symlinks(self, tmp_path: Path):
        source = tmp_path / "source"
        (source / "memory").mkdir(parents=True)
        secret = tmp_path / "outside-secret.txt"
        secret.write_text("secret", encoding="utf-8")
        (source / "memory" / "linked.txt").symlink_to(secret)
        destination = tmp_path / "backup.zip"

        export_data_backup(str(source), str(destination), "included")

        with zipfile.ZipFile(destination) as archive:
            assert set(archive.namelist()) == {"manifest.json"}


class TestDataBackupInspection:
    def test_inspects_generated_backup(self, tmp_path: Path):
        source = tmp_path / "source"
        source.mkdir()
        _seed_data(source)
        destination = tmp_path / "backup.zip"
        export_data_backup(str(source), str(destination), "included")

        result = inspect_import_source(str(destination))

        assert result["sourceType"] == "backupZip"
        assert result["sourceMode"] == "included"
        assert result["content"]["sessions"] == 1

    def test_rejects_traversal_before_extraction(self, tmp_path: Path):
        destination = tmp_path / "traversal.zip"
        manifest = {
            "schema": BACKUP_SCHEMA,
            "formatVersion": BACKUP_FORMAT_VERSION,
            "exportedAt": "2026-08-22T00:00:00Z",
            "sourceMode": "included",
            "content": {"memory": 0, "responses": 0, "sessions": 0},
        }
        with zipfile.ZipFile(destination, "w") as archive:
            archive.writestr("manifest.json", json.dumps(manifest))
            archive.writestr("../outside.txt", "escape")

        with pytest.raises(BackupFormatError, match="invalid backup entry path"):
            inspect_import_source(str(destination))

    def test_rejects_symlink_entries(self, tmp_path: Path):
        destination = tmp_path / "link.zip"
        manifest = {
            "schema": BACKUP_SCHEMA,
            "formatVersion": BACKUP_FORMAT_VERSION,
            "exportedAt": "2026-08-22T00:00:00Z",
            "sourceMode": "included",
            "content": {"memory": 1, "responses": 0, "sessions": 0},
        }
        link = zipfile.ZipInfo("memory/link")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        with zipfile.ZipFile(destination, "w") as archive:
            archive.writestr("manifest.json", json.dumps(manifest))
            archive.writestr(link, "../../secret")

        with pytest.raises(BackupFormatError, match="contains links"):
            inspect_import_source(str(destination))

    def test_rejects_manifest_count_mismatch(self, tmp_path: Path):
        destination = tmp_path / "mismatch.zip"
        manifest = {
            "schema": BACKUP_SCHEMA,
            "formatVersion": BACKUP_FORMAT_VERSION,
            "exportedAt": "2026-08-22T00:00:00Z",
            "sourceMode": "included",
            "content": {"memory": 2, "responses": 0, "sessions": 0},
        }
        with zipfile.ZipFile(destination, "w") as archive:
            archive.writestr("manifest.json", json.dumps(manifest))
            archive.writestr("memory/one.md", "one")

        with pytest.raises(BackupFormatError, match="summary"):
            inspect_import_source(str(destination))

    def test_rejects_duplicate_paths_even_when_case_differs(self, tmp_path: Path):
        destination = tmp_path / "duplicates.zip"
        manifest = {
            "schema": BACKUP_SCHEMA,
            "formatVersion": BACKUP_FORMAT_VERSION,
            "exportedAt": "2026-08-22T00:00:00Z",
            "sourceMode": "included",
            "content": {"memory": 2, "responses": 0, "sessions": 0},
        }
        with zipfile.ZipFile(destination, "w") as archive:
            archive.writestr("manifest.json", json.dumps(manifest))
            archive.writestr("memory/Note.md", "one")
            archive.writestr("memory/note.md", "two")

        with pytest.raises(BackupFormatError, match="duplicate"):
            inspect_import_source(str(destination))

    def test_accepts_legacy_session_only_folder(self, tmp_path: Path):
        source = tmp_path / "legacy"
        (source / "temp").mkdir(parents=True)
        (source / "temp" / "desktop_sessions.json").write_text("[]", encoding="utf-8")

        result = inspect_import_source(str(source))

        assert result["sourceType"] == "legacyFolder"
        assert result["content"]["sessions"] == 1


class TestDataBackupImport:
    def test_materializes_backup_and_merges_without_overwrite(self, tmp_path: Path):
        source = tmp_path / "source"
        source.mkdir()
        _seed_data(source)
        backup = tmp_path / "backup.zip"
        export_data_backup(str(source), str(backup), "included")

        target = tmp_path / "target"
        (target / "memory").mkdir(parents=True)
        (target / "memory" / "notes.md").write_text("current", encoding="utf-8")
        with materialize_import_source(str(backup)) as extracted:
            result = merge_data_files(str(extracted), str(target))
            assert (extracted / "temp" / "desktop_sessions" / "sess-one.json").is_file()

        assert result["memoryCopied"] == 1
        assert result["memorySkipped"] == 1
        assert result["responsesCopied"] == 1
        assert (target / "memory" / "notes.md").read_text(encoding="utf-8") == "current"
        assert (target / "memory" / "nested" / "facts.json").is_file()
