"""Safe, dependency-free import/export helpers for desktop data snapshots."""
from __future__ import annotations

import contextlib
import datetime as dt
import json
import os
import shutil
import stat
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Iterator


BACKUP_SCHEMA = "genericagent.data-backup"
BACKUP_FORMAT_VERSION = 1
MAX_ARCHIVE_ENTRIES = 100_000
MAX_ARCHIVE_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024

_DATA_PREFIXES = (
    PurePosixPath("memory"),
    PurePosixPath("temp/model_responses"),
    PurePosixPath("temp/desktop_sessions"),
)


class BackupFormatError(ValueError):
    """Raised when a backup cannot be trusted or is not compatible."""


def _is_relative_to(path: PurePosixPath, parent: PurePosixPath) -> bool:
    return path == parent or parent in path.parents


def _archive_path(name: str) -> PurePosixPath:
    if not name or "\\" in name:
        raise BackupFormatError("invalid backup entry path")
    if any(part in ("", ".", "..") for part in name.split("/")):
        raise BackupFormatError("invalid backup entry path")
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
        raise BackupFormatError("invalid backup entry path")
    return path


def _is_allowed_data_path(path: PurePosixPath) -> bool:
    return any(_is_relative_to(path, prefix) for prefix in _DATA_PREFIXES)


def _iter_regular_files(root: Path) -> Iterator[tuple[Path, PurePosixPath]]:
    root = root.resolve()
    for folder, dirs, files in os.walk(root, followlinks=False):
        folder_path = Path(folder)
        dirs[:] = sorted(
            name for name in dirs
            if not (folder_path / name).is_symlink()
        )
        for name in sorted(files):
            source = folder_path / name
            if source.is_symlink() or not source.is_file():
                continue
            relative = PurePosixPath(source.relative_to(root).as_posix())
            yield source, relative


def _source_files(root: Path) -> list[tuple[Path, PurePosixPath]]:
    files: list[tuple[Path, PurePosixPath]] = []
    for prefix in _DATA_PREFIXES:
        source_root = root.joinpath(*prefix.parts)
        if not source_root.is_dir() or source_root.is_symlink():
            continue
        for source, relative in _iter_regular_files(source_root):
            files.append((source, prefix / relative))
    return files


def _content_counts(paths: list[PurePosixPath]) -> dict[str, int]:
    return {
        "memory": sum(_is_relative_to(path, _DATA_PREFIXES[0]) for path in paths),
        "responses": sum(_is_relative_to(path, _DATA_PREFIXES[1]) for path in paths),
        "sessions": sum(_is_relative_to(path, _DATA_PREFIXES[2]) for path in paths),
    }


def _normalise_source_mode(value: str) -> str:
    if value not in ("included", "localRepository"):
        raise BackupFormatError("invalid backup source mode")
    return value


def _manifest(source_mode: str, paths: list[PurePosixPath]) -> dict:
    exported_at = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    return {
        "schema": BACKUP_SCHEMA,
        "formatVersion": BACKUP_FORMAT_VERSION,
        "exportedAt": exported_at.isoformat().replace("+00:00", "Z"),
        "sourceMode": _normalise_source_mode(source_mode),
        "content": _content_counts(paths),
    }


def export_data_backup(ga_root: str, destination_path: str, source_mode: str) -> dict:
    root = Path(ga_root).expanduser().resolve()
    destination = Path(destination_path).expanduser().resolve()
    if not root.is_dir():
        raise ValueError("current data source is unavailable")
    if destination.suffix.lower() != ".zip":
        raise ValueError("backup destination must be a zip file")
    if not destination.parent.is_dir():
        raise ValueError("backup destination folder does not exist")

    files = _source_files(root)
    paths = [relative for _, relative in files]
    manifest = _manifest(source_mode, paths)

    temp_handle = tempfile.NamedTemporaryFile(
        prefix=f".{destination.stem}.",
        suffix=".tmp",
        dir=destination.parent,
        delete=False,
    )
    temp_path = Path(temp_handle.name)
    temp_handle.close()
    try:
        with zipfile.ZipFile(
            temp_path,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=6,
        ) as archive:
            archive.writestr(
                "manifest.json",
                json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            )
            for source, relative in files:
                archive.write(source, relative.as_posix())
        os.replace(temp_path, destination)
    except Exception:
        with contextlib.suppress(OSError):
            temp_path.unlink()
        raise

    return {
        "ok": True,
        "path": str(destination),
        "formatVersion": BACKUP_FORMAT_VERSION,
        "exportedAt": manifest["exportedAt"],
        "sourceMode": manifest["sourceMode"],
        "content": manifest["content"],
    }


def _validated_zip(archive: zipfile.ZipFile) -> tuple[dict, list[zipfile.ZipInfo]]:
    infos = archive.infolist()
    if len(infos) > MAX_ARCHIVE_ENTRIES:
        raise BackupFormatError("backup contains too many files")
    total_bytes = sum(info.file_size for info in infos)
    if total_bytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES:
        raise BackupFormatError("backup is too large")
    if archive.testzip() is not None:
        raise BackupFormatError("backup is corrupt")

    manifest_info: zipfile.ZipInfo | None = None
    data_infos: list[zipfile.ZipInfo] = []
    seen_paths: set[str] = set()
    for info in infos:
        path = _archive_path(info.filename.rstrip("/"))
        folded_path = path.as_posix().casefold()
        if folded_path in seen_paths:
            raise BackupFormatError("backup contains duplicate file paths")
        seen_paths.add(folded_path)
        unix_mode = (info.external_attr >> 16) & 0o170000
        if unix_mode == stat.S_IFLNK:
            raise BackupFormatError("backup contains links")
        if path == PurePosixPath("manifest.json"):
            if info.is_dir() or manifest_info is not None:
                raise BackupFormatError("backup manifest is invalid")
            manifest_info = info
            continue
        if not _is_allowed_data_path(path):
            raise BackupFormatError("backup contains unsupported files")
        if not info.is_dir():
            data_infos.append(info)

    if manifest_info is None:
        raise BackupFormatError("backup manifest is missing")
    try:
        manifest = json.loads(archive.read(manifest_info).decode("utf-8"))
    except Exception as error:
        raise BackupFormatError("backup manifest is invalid") from error
    if not isinstance(manifest, dict):
        raise BackupFormatError("backup manifest is invalid")
    if manifest.get("schema") != BACKUP_SCHEMA:
        raise BackupFormatError("backup format is not supported")
    if manifest.get("formatVersion") != BACKUP_FORMAT_VERSION:
        raise BackupFormatError("backup version is not supported")
    _normalise_source_mode(str(manifest.get("sourceMode") or ""))
    if not isinstance(manifest.get("exportedAt"), str) or not manifest["exportedAt"]:
        raise BackupFormatError("backup export time is missing")

    actual_counts = _content_counts([
        _archive_path(info.filename) for info in data_infos
    ])
    if manifest.get("content") != actual_counts:
        raise BackupFormatError("backup content summary does not match its files")
    return manifest, data_infos


def _legacy_inspection(root: Path) -> dict:
    files = _source_files(root)
    paths = [relative for _, relative in files]
    legacy_session_files = [
        root / "temp" / "desktop_sessions.json",
        root / "temp" / "desktop_sessions.json.migrated",
    ]
    legacy_session_count = sum(
        path.is_file() and not path.is_symlink() for path in legacy_session_files
    )
    if not files and not legacy_session_count:
        raise BackupFormatError("no memory or session data found")
    counts = _content_counts(paths)
    counts["sessions"] += legacy_session_count
    return {
        "ok": True,
        "sourceType": "legacyFolder",
        "formatVersion": None,
        "exportedAt": None,
        "sourceMode": None,
        "content": counts,
    }


def inspect_import_source(source_path: str) -> dict:
    source = Path(source_path).expanduser().resolve()
    if source.is_dir():
        return _legacy_inspection(source)
    if not source.is_file() or source.suffix.lower() != ".zip":
        raise BackupFormatError("select a compatible backup or data folder")
    try:
        with zipfile.ZipFile(source, "r") as archive:
            manifest, _ = _validated_zip(archive)
    except zipfile.BadZipFile as error:
        raise BackupFormatError("backup is corrupt") from error
    return {
        "ok": True,
        "sourceType": "backupZip",
        "formatVersion": manifest["formatVersion"],
        "exportedAt": manifest["exportedAt"],
        "sourceMode": manifest["sourceMode"],
        "content": manifest["content"],
    }


@contextlib.contextmanager
def materialize_import_source(source_path: str) -> Iterator[Path]:
    source = Path(source_path).expanduser().resolve()
    inspection = inspect_import_source(str(source))
    if inspection["sourceType"] == "legacyFolder":
        yield source
        return

    with tempfile.TemporaryDirectory(prefix="genericagent-data-import-") as temp_dir:
        target_root = Path(temp_dir)
        try:
            with zipfile.ZipFile(source, "r") as archive:
                _, data_infos = _validated_zip(archive)
                for info in data_infos:
                    relative = _archive_path(info.filename)
                    target = target_root.joinpath(*relative.parts)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(info, "r") as reader, target.open("wb") as writer:
                        shutil.copyfileobj(reader, writer)
        except zipfile.BadZipFile as error:
            raise BackupFormatError("backup is corrupt") from error
        yield target_root


def merge_data_files(source_dir: str, ga_root: str) -> dict:
    source = Path(source_dir).expanduser().resolve()
    destination_root = Path(ga_root).expanduser().resolve()
    if not source.is_dir():
        raise ValueError("source data folder is unavailable")
    if source == destination_root:
        raise ValueError("source is the same as current data")

    inspection = _legacy_inspection(source)
    memory_copied = 0
    memory_skipped = 0
    responses_copied = 0
    responses_skipped = 0

    for prefix, copied_key, skipped_key in (
        (_DATA_PREFIXES[0], "memoryCopied", "memorySkipped"),
        (_DATA_PREFIXES[1], "responsesCopied", "responsesSkipped"),
    ):
        copied = 0
        skipped = 0
        source_root = source.joinpath(*prefix.parts)
        if source_root.is_dir() and not source_root.is_symlink():
            for item, relative in _iter_regular_files(source_root):
                target = destination_root.joinpath(*prefix.parts, *relative.parts)
                if target.exists():
                    skipped += 1
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, target)
                copied += 1
        if copied_key == "memoryCopied":
            memory_copied, memory_skipped = copied, skipped
        else:
            responses_copied, responses_skipped = copied, skipped

    return {
        "ok": True,
        "memoryCopied": memory_copied,
        "memorySkipped": memory_skipped,
        "responsesCopied": responses_copied,
        "responsesSkipped": responses_skipped,
        "backupDir": "",
        "sourceType": inspection["sourceType"],
    }
