"""
Directory scanner: walks configured root directories and imports measurements into DB.

Scanning strategy (applied per folder, in priority order):
  1. meta.yaml with 'sample' field  → explicit measurement metadata
  2. No meta.yaml, .dat files found → auto-extract metadata from PPMS file headers
  3. None of the above              → skip folder, but still recurse into subfolders

meta.yaml (sits inside the measurement folder alongside data files):
  sample: <sample name>        # required – which sample this measurement belongs to
  type: ppms-vsm               # required – ppms-vsm | ppms-hc | pxrd | sxrd | fmr | microscopy
  date: 2026-01-15             # optional – measurement date
  notes: ""                    # optional – free-text notes
  orientation: OOP             # optional – ppms-vsm only; e.g. "OOP", "IP", or custom text
  # optional sample creation fields (only used when the sample doesn't exist yet):
  compound: Fe3O4
  synthesis_date: 2026-01-01
  batch: B1
  box: A-03
  crystal_size: "0.5 x 0.3 x 0.1 mm"
"""

import os
from pathlib import Path
from typing import Optional

import yaml
from sqlmodel import Session, select

from models import Sample, Experiment, DataFile

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
SAMPLES_DIR = DATA_DIR / "samples"

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".gif"}
DATA_EXTS = {".dat", ".xy", ".xye", ".csv", ".txt", ".asc"}
EXP_TYPES = ["microscopy", "pxrd", "sxrd", "ppms-vsm", "ppms-hc", "fmr"]


def _file_type(path: Path) -> str:
    return "image" if path.suffix.lower() in IMAGE_EXTS else "data"


def _read_meta_yaml(folder: Path) -> Optional[dict]:
    meta_path = folder / "meta.yaml"
    if not meta_path.exists():
        return None
    try:
        return yaml.safe_load(meta_path.read_text(encoding="utf-8")) or {}
    except Exception:
        return {}


def _extract_ppms_meta(folder: Path) -> Optional[dict]:
    """Try PPMS header extraction from .dat files directly in this folder."""
    from parsers.ppms import extract_header_meta

    for f in sorted(folder.iterdir()):
        if f.is_file() and f.suffix.lower() == ".dat":
            meta = extract_header_meta(str(f))
            if meta.get("sample") and meta.get("type"):
                return meta
    return None


def _collect_files(folder: Path) -> list[Path]:
    """Collect data/image files recursively, stopping at sub-measurement boundaries.

    A subfolder that has its own meta.yaml with a 'sample' field defines its own
    measurement; its files are excluded from the parent measurement's file list.
    """
    result = []
    try:
        items = sorted(folder.iterdir())
    except PermissionError:
        return result

    for item in items:
        if item.name.startswith(".") or item.name == "meta.yaml":
            continue
        if item.is_file() and item.suffix.lower() in IMAGE_EXTS | DATA_EXTS:
            result.append(item)
        elif item.is_dir():
            sub_meta = _read_meta_yaml(item)
            if sub_meta is not None and sub_meta.get("sample"):
                continue  # sub-measurement boundary – don't include its files here
            result.extend(_collect_files(item))

    return result


def _upsert_sample(session: Session, meta: dict, added: dict) -> Sample:
    sample_name = meta["sample"].strip()
    sample = session.exec(select(Sample).where(Sample.name == sample_name)).first()
    if sample is None:
        sample = Sample(
            name=sample_name,
            compound=meta.get("compound", sample_name),
            synthesis_date=meta.get("synthesis_date"),
            batch=meta.get("batch"),
            box=str(meta.get("box")) if meta.get("box") is not None else None,
            crystal_size=meta.get("crystal_size"),
            notes=meta.get("sample_notes"),
        )
        session.add(sample)
        session.flush()
        added["samples"] += 1
    return sample


def _upsert_measurement(session: Session, folder: Path, meta: dict, added: dict):
    """Create/update Sample + Experiment + DataFiles for a measurement folder."""
    sample_name = (meta.get("sample") or "").strip()
    exp_type = (meta.get("type") or "").strip()
    if not sample_name or not exp_type:
        return

    source_path = str(folder.resolve())
    sample = _upsert_sample(session, meta, added)

    exp = session.exec(
        select(Experiment).where(Experiment.source_path == source_path)
    ).first()
    if exp is None:
        orientation = meta.get("orientation") if exp_type == "ppms-vsm" else None
        exp = Experiment(
            sample_id=sample.id,
            type=exp_type,
            exp_date=meta.get("date"),
            notes=meta.get("notes"),
            orientation=orientation or None,
            source_path=source_path,
        )
        session.add(exp)
        session.flush()
        added["experiments"] += 1

    for f in _collect_files(folder):
        try:
            rel_path = f.relative_to(DATA_DIR).as_posix()
        except ValueError:
            rel_path = str(f)

        if session.exec(select(DataFile).where(DataFile.path == rel_path)).first():
            continue

        try:
            filename = f.relative_to(folder).as_posix()
        except ValueError:
            filename = f.name

        session.add(DataFile(
            experiment_id=exp.id,
            filename=filename,
            path=rel_path,
            file_type=_file_type(f),
        ))
        added["files"] += 1


def _walk_files_recursive(directory: Path) -> Iterator[Path]:
    for root, _dirs, files in os.walk(directory, followlinks=True):
        for fname in sorted(files):
            yield Path(root) / fname


def _process_old_format(session: Session, sample_dir: Path, meta: dict, added: dict):
    """Handle old-format sample directory (meta.yaml with 'name' field)."""
    sample_name = (meta.get("name") or "").strip() or sample_dir.name

    sample = session.exec(select(Sample).where(Sample.name == sample_name)).first()
    if sample is None:
        sample = Sample(
            name=sample_name,
            compound=meta.get("compound", sample_name),
            synthesis_date=meta.get("synthesis_date"),
            batch=meta.get("batch"),
            box=str(meta.get("box")) if meta.get("box") is not None else None,
            crystal_size=meta.get("crystal_size"),
            notes=meta.get("notes"),
        )
        session.add(sample)
        session.flush()
        added["samples"] += 1
    else:
        for attr, key in [
            ("compound", "compound"), ("synthesis_date", "synthesis_date"),
            ("batch", "batch"), ("crystal_size", "crystal_size"), ("notes", "notes"),
        ]:
            val = meta.get(key)
            if val:
                setattr(sample, attr, val)
        if meta.get("box") is not None:
            sample.box = str(meta["box"])
        session.add(sample)
        session.flush()

    for exp_type in EXP_TYPES:
        exp_dir = sample_dir / exp_type
        if not exp_dir.is_dir():
            continue

        files_in_dir = [
            f for f in _walk_files_recursive(exp_dir)
            if f.suffix.lower() in IMAGE_EXTS | DATA_EXTS
        ]
        if not files_in_dir:
            continue

        source_path = str(exp_dir.resolve())

        # Dedup: prefer source_path match, fall back to old (sample_id, type) key
        exp = session.exec(
            select(Experiment).where(Experiment.source_path == source_path)
        ).first()
        if exp is None:
            exp = session.exec(
                select(Experiment).where(
                    Experiment.sample_id == sample.id,
                    Experiment.type == exp_type,
                    Experiment.source_path.is_(None),
                )
            ).first()
        if exp is None:
            exp = Experiment(sample_id=sample.id, type=exp_type, source_path=source_path)
            session.add(exp)
            session.flush()
            added["experiments"] += 1
        elif exp.source_path is None:
            exp.source_path = source_path
            session.add(exp)
            session.flush()

        for f in files_in_dir:
            rel_path = f.relative_to(DATA_DIR).as_posix()
            rel_name = f.relative_to(exp_dir).as_posix()
            if session.exec(select(DataFile).where(DataFile.path == rel_path)).first():
                continue
            session.add(DataFile(
                experiment_id=exp.id,
                filename=rel_name,
                path=rel_path,
                file_type=_file_type(f),
            ))
            added["files"] += 1


def _scan_dir(session: Session, folder: Path, added: dict, within_measurement: bool = False):
    """Recursively process a folder.

    within_measurement=True means this folder is inside a parent measurement that was
    identified by auto-extraction (no meta.yaml). In that case we skip auto-extraction
    here to avoid creating duplicate experiments for subfolders.
    """
    if not folder.is_dir() or folder.name.startswith("."):
        return

    meta = _read_meta_yaml(folder)

    if meta is not None and meta.get("sample"):
        # New-format explicit measurement
        _upsert_measurement(session, folder, meta, added)
        for sub in sorted(folder.iterdir()):
            if sub.is_dir():
                _scan_dir(session, sub, added, within_measurement=True)
        return

    if meta is not None and meta.get("name"):
        # Old-format sample directory
        _process_old_format(session, folder, meta, added)
        return

    if not within_measurement:
        # Try PPMS header auto-extraction
        auto_meta = _extract_ppms_meta(folder)
        if auto_meta:
            _upsert_measurement(session, folder, auto_meta, added)
            for sub in sorted(folder.iterdir()):
                if sub.is_dir():
                    _scan_dir(session, sub, added, within_measurement=True)
            return

    # No measurement found here: recurse into subfolders
    for sub in sorted(folder.iterdir()):
        if sub.is_dir():
            _scan_dir(session, sub, added, within_measurement=within_measurement)


def scan(session: Session, root_paths: Optional[list[Path]] = None) -> dict:
    """Scan root_paths and upsert all measurements into DB.

    root_paths defaults to [DATA_DIR/samples]. Pass additional paths via the
    SCAN_ROOTS environment variable (colon-separated absolute paths).
    """
    if root_paths is None:
        root_paths = [SAMPLES_DIR]

    added = {"samples": 0, "experiments": 0, "files": 0}

    for root in root_paths:
        if root.exists():
            _scan_dir(session, root, added)

    session.commit()
    return added
