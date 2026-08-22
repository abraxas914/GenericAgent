"""Safe, dependency-free import/export helpers for desktop data snapshots."""
from __future__ import annotations

import contextlib
import datetime as dt
import errno
import json
import os
import re
import shutil
import stat
import tempfile
import uuid
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Iterable, Iterator


BACKUP_SCHEMA = "genericagent.data-backup"
BACKUP_FORMAT_VERSION = 1
MAX_ARCHIVE_ENTRIES = 100_000
MAX_ARCHIVE_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024

_DATA_PREFIXES = (
    PurePosixPath("memory"),
    PurePosixPath("temp/model_responses"),
    PurePosixPath("temp/desktop_sessions"),
)

_DESKTOP_SESSION_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}")


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
    has_data_folder = any(
        (root.joinpath(*prefix.parts).is_dir()
         and not root.joinpath(*prefix.parts).is_symlink())
        for prefix in _DATA_PREFIXES[:2]
    )
    legacy_session_files = [
        root / "temp" / "desktop_sessions.json",
        root / "temp" / "desktop_sessions.json.migrated",
    ]
    legacy_session_count = sum(
        path.is_file() and not path.is_symlink() for path in legacy_session_files
    )
    if not has_data_folder:
        raise BackupFormatError(
            "not a GA directory (no memory/ or temp/model_responses/)"
        )
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


def _is_desktop_session_id(value: object) -> bool:
    session_id = str(value or "")
    return (
        not session_id.startswith("tui_")
        and _DESKTOP_SESSION_ID_RE.fullmatch(session_id) is not None
    )


def _read_source_sessions(source: Path) -> tuple[list[dict], bool, int]:
    """Read supported Desktop session stores without trusting filenames.

    Corrupt/non-Desktop records are skipped. The skipped count is intentionally
    record-oriented; an unreadable file counts as one skipped source record.
    """
    items: list[dict] = []
    found = False
    skipped = 0
    sessions_dir = source / "temp" / "desktop_sessions"
    if sessions_dir.is_dir() and not sessions_dir.is_symlink():
        for session_file in sorted(sessions_dir.glob("*.json")):
            if session_file.is_symlink() or not session_file.is_file():
                continue
            found = True
            try:
                item = json.loads(session_file.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
                skipped += 1
                continue
            if isinstance(item, dict):
                items.append(item)
            else:
                skipped += 1

    for legacy in (
        source / "temp" / "desktop_sessions.json",
        source / "temp" / "desktop_sessions.json.migrated",
    ):
        if legacy.is_symlink() or not legacy.is_file():
            continue
        found = True
        try:
            document = json.loads(legacy.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
            skipped += 1
            continue
        if not isinstance(document, list):
            skipped += 1
            continue
        for item in document:
            if isinstance(item, dict):
                items.append(item)
            else:
                skipped += 1
    return items, found, skipped


def _existing_session_ids(destination_root: Path) -> set[str]:
    ids: set[str] = set()
    sessions_dir = destination_root / "temp" / "desktop_sessions"
    if not sessions_dir.is_dir() or sessions_dir.is_symlink():
        return ids
    for session_file in sorted(sessions_dir.glob("*.json")):
        if session_file.is_symlink() or not session_file.is_file():
            continue
        if _is_desktop_session_id(session_file.stem):
            ids.add(session_file.stem)
        try:
            item = json.loads(session_file.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
            continue
        if isinstance(item, dict) and _is_desktop_session_id(item.get("id")):
            ids.add(str(item["id"]))
    return ids


def _remove_path(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)


def _copy_tree_strict(source: Path, destination: Path) -> None:
    """Copy a complete tree while refusing links and special files."""
    if source.is_symlink() or not source.is_dir():
        raise ValueError(f"cannot safely copy data folder: {source}")
    destination.mkdir(parents=True, exist_ok=False)
    for item in sorted(source.iterdir(), key=lambda path: path.name):
        if item.is_symlink():
            raise ValueError(f"data folder contains a symbolic link: {item}")
        target = destination / item.name
        if item.is_dir():
            _copy_tree_strict(item, target)
        elif item.is_file():
            shutil.copy2(item, target)
        else:
            raise ValueError(f"data folder contains an unsupported file: {item}")


def _prepare_overlay_target(root: Path, relative: PurePosixPath) -> Path:
    current = root
    for part in relative.parts[:-1]:
        current = current / part
        if current.is_symlink():
            raise ValueError(f"memory destination contains a symbolic link: {current}")
        if current.exists() and not current.is_dir():
            _remove_path(current)
        current.mkdir(exist_ok=True)
    target = root.joinpath(*relative.parts)
    if target.is_symlink() or target.is_dir():
        _remove_path(target)
    return target


def _assert_safe_new_target(root: Path, target: Path) -> None:
    relative = target.relative_to(root)
    current = root
    for part in relative.parts[:-1]:
        current = current / part
        if current.is_symlink():
            raise ValueError(f"data destination contains a symbolic link: {current}")
        if current.exists() and not current.is_dir():
            raise ValueError(f"data destination parent is not a directory: {current}")


def _new_backup_path(destination_root: Path) -> Path:
    timestamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    backup_parent = destination_root / "temp"
    for suffix in range(1000):
        tail = "" if suffix == 0 else f"_{suffix}"
        candidate = backup_parent / f"memory_import_backup_{timestamp}{tail}"
        if not candidate.exists() and not candidate.is_symlink():
            return candidate
    raise OSError("cannot allocate a unique memory backup directory")


def _create_memory_backup(destination_root: Path, memory_root: Path) -> Path:
    backup_dir = _new_backup_path(destination_root)
    backup_parent = backup_dir.parent
    if backup_parent.is_symlink() or (
        backup_parent.exists() and not backup_parent.is_dir()
    ):
        raise ValueError("current backup destination is not a safe directory")
    backup_parent.mkdir(parents=True, exist_ok=True)
    staging = backup_parent / f".{backup_dir.name}.staging-{uuid.uuid4().hex}"
    try:
        staging.mkdir()
        _copy_tree_strict(memory_root, staging / "memory")
        os.replace(staging, backup_dir)
    except Exception:
        with contextlib.suppress(OSError):
            _remove_path(staging)
        raise
    return backup_dir


def _install_file_add_only(staged: Path, target: Path) -> None:
    """Install one staged file without ever replacing an existing path."""
    try:
        os.link(staged, target, follow_symlinks=False)
    except OSError as error:
        unsupported_link_errors = {
            errno.EINVAL,
            errno.EPERM,
            errno.EXDEV,
            getattr(errno, "ENOTSUP", errno.EINVAL),
            getattr(errno, "EOPNOTSUPP", errno.EINVAL),
        }
        if error.errno not in unsupported_link_errors:
            raise

        # Some removable/network filesystems do not implement hard links.
        # O_EXCL retains the add-only contract there; a failed copy removes
        # only the path this call successfully created.
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        flags |= getattr(os, "O_BINARY", 0)
        descriptor: int | None = None
        created = False
        try:
            descriptor = os.open(target, flags, stat.S_IMODE(staged.stat().st_mode))
            created = True
            with staged.open("rb") as reader, os.fdopen(descriptor, "wb") as writer:
                descriptor = None
                shutil.copyfileobj(reader, writer)
                writer.flush()
                os.fsync(writer.fileno())
        except Exception:
            if descriptor is not None:
                with contextlib.suppress(OSError):
                    os.close(descriptor)
            if created:
                with contextlib.suppress(OSError):
                    target.unlink()
            raise
    with contextlib.suppress(OSError):
        staged.unlink()


def merge_data_files(
    source_dir: str,
    ga_root: str,
    *,
    existing_session_ids: Iterable[str] | None = None,
    session_preparer: Callable[[dict], object] | None = None,
) -> dict[str, Any]:
    """Transactionally merge a validated data tree into ``ga_root``.

    ``memory`` is source-wins after a durable full backup, responses and
    Desktop sessions are add-only, and any activation error rolls back files
    installed by this call. ``session_preparer`` lets the bridge validate and
    construct its in-memory Session objects before any destination is changed.
    """
    source = Path(source_dir).expanduser().resolve()
    destination_root = Path(ga_root).expanduser().resolve()
    if not source.is_dir():
        raise ValueError("source data folder is unavailable")
    if not destination_root.is_dir():
        raise ValueError("current data destination is unavailable")
    if source == destination_root:
        raise ValueError("source is the same as current data")

    inspection = _legacy_inspection(source)
    source_memory = source.joinpath(*_DATA_PREFIXES[0].parts)
    source_responses = source.joinpath(*_DATA_PREFIXES[1].parts)
    destination_memory = destination_root.joinpath(*_DATA_PREFIXES[0].parts)
    destination_responses = destination_root.joinpath(*_DATA_PREFIXES[1].parts)
    has_source_memory = source_memory.is_dir() and not source_memory.is_symlink()

    memory_files = list(_iter_regular_files(source_memory)) if has_source_memory else []
    response_files: list[tuple[Path, PurePosixPath, Path]] = []
    responses_skipped = 0
    if source_responses.is_dir() and not source_responses.is_symlink():
        for item, relative in _iter_regular_files(source_responses):
            target = destination_responses.joinpath(*relative.parts)
            if target.exists() or target.is_symlink():
                responses_skipped += 1
                continue
            _assert_safe_new_target(destination_root, target)
            response_files.append((item, relative, target))

    source_session_items, sessions_found, sessions_skipped = _read_source_sessions(source)
    known_session_ids = _existing_session_ids(destination_root)
    if existing_session_ids is not None:
        known_session_ids.update(
            str(value) for value in existing_session_ids if _is_desktop_session_id(value)
        )
    planned_session_ids: set[str] = set()
    session_files: list[tuple[str, dict, Path, object]] = []
    for item in source_session_items:
        session_id = item.get("id")
        if not _is_desktop_session_id(session_id):
            sessions_skipped += 1
            continue
        session_id = str(session_id)
        target = destination_root / "temp" / "desktop_sessions" / f"{session_id}.json"
        if (
            session_id in known_session_ids
            or session_id in planned_session_ids
            or target.exists()
            or target.is_symlink()
        ):
            sessions_skipped += 1
            continue
        _assert_safe_new_target(destination_root, target)
        try:
            prepared = session_preparer(item) if session_preparer is not None else item
        except Exception:
            sessions_skipped += 1
            continue
        planned_session_ids.add(session_id)
        session_files.append((session_id, item, target, prepared))

    backup_dir = ""
    prepared_sessions = [entry[3] for entry in session_files]
    with tempfile.TemporaryDirectory(
        prefix=".genericagent-memory-import-",
        dir=destination_root,
    ) as temp_dir:
        staging_root = Path(temp_dir)
        staged_memory = staging_root / "memory"
        if has_source_memory:
            if destination_memory.is_symlink() or (
                destination_memory.exists() and not destination_memory.is_dir()
            ):
                raise ValueError("current memory destination is not a safe directory")
            if destination_memory.is_dir():
                _copy_tree_strict(destination_memory, staged_memory)
            else:
                staged_memory.mkdir()
            for item, relative in memory_files:
                target = _prepare_overlay_target(staged_memory, relative)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, target)

        staged_responses: list[tuple[Path, Path]] = []
        for item, relative, target in response_files:
            staged = staging_root / "responses" / Path(*relative.parts)
            staged.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item, staged)
            staged_responses.append((staged, target))

        staged_sessions: list[tuple[Path, Path]] = []
        for session_id, item, target, _prepared in session_files:
            staged = staging_root / "sessions" / f"{session_id}.json"
            staged.parent.mkdir(parents=True, exist_ok=True)
            staged.write_text(
                json.dumps(item, ensure_ascii=False, default=str),
                encoding="utf-8",
            )
            staged_sessions.append((staged, target))

        memory_nonempty = (
            destination_memory.is_dir()
            and next(destination_memory.iterdir(), None) is not None
        )
        if has_source_memory and memory_nonempty:
            backup_dir = str(_create_memory_backup(destination_root, destination_memory))

        installed_files: list[Path] = []
        previous_memory = staging_root / "previous-memory"
        memory_original_moved = False
        memory_activated = False
        memory_existed = destination_memory.is_dir()
        try:
            if has_source_memory:
                if memory_existed:
                    os.replace(destination_memory, previous_memory)
                    memory_original_moved = True
                os.replace(staged_memory, destination_memory)
                memory_activated = True

            for staged, target in (*staged_responses, *staged_sessions):
                if target.exists() or target.is_symlink():
                    raise OSError(f"data destination changed during import: {target}")
                _assert_safe_new_target(destination_root, target)
                target.parent.mkdir(parents=True, exist_ok=True)
                # Staging shares the destination filesystem. A hard link gives
                # POSIX/Windows create-if-absent semantics: unlike replace(), it
                # cannot overwrite a response/session created concurrently.
                _install_file_add_only(staged, target)
                installed_files.append(target)
        except Exception as error:
            rollback_errors: list[str] = []
            for target in reversed(installed_files):
                try:
                    target.unlink()
                except OSError as rollback_error:
                    rollback_errors.append(str(rollback_error))
            if memory_activated or memory_original_moved:
                try:
                    if destination_memory.exists() or destination_memory.is_symlink():
                        _remove_path(destination_memory)
                    if memory_original_moved:
                        os.replace(previous_memory, destination_memory)
                except OSError as rollback_error:
                    rollback_errors.append(str(rollback_error))
            if rollback_errors:
                raise OSError(
                    f"data import failed: {error}; rollback failed: "
                    + "; ".join(rollback_errors)
                ) from error
            raise

    result: dict[str, Any] = {
        "ok": True,
        "memoryCopied": len(memory_files),
        "memorySkipped": 0,
        "responsesCopied": len(response_files),
        "responsesSkipped": responses_skipped,
        "sessionsAdded": len(session_files),
        "sessionsSkipped": sessions_skipped,
        "sessionsFileFound": sessions_found,
        "backupDir": backup_dir,
        "sourceType": inspection["sourceType"],
    }
    if session_preparer is not None:
        result["_preparedSessions"] = prepared_sessions
    return result
