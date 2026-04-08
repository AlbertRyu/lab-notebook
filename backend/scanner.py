"""
Directory scanner: walks configured root directories and imports measurements into DB.

Scanning strategy per folder:
  - Always try PPMS header auto-extraction from .dat files (unless inside an already-
    identified measurement, to avoid duplicates).
  - Always read meta.yaml if present.
  - Merge both sources: PPMS header as base, meta.yaml overrides on conflict.
  - If merged result has 'sample' + 'type' → import as a measurement.
  - Otherwise → skip this folder and recurse into subfolders.

meta.yaml (sits inside the measurement folder alongside data files):
  sample: <sample name>        # which sample this measurement belongs to
  type: ppms-vsm               # ppms-vsm | ppms-hc | pxrd | sxrd | fmr | microscopy
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


def _file_type(path: Path) -> str:
    if path.suffix.lower() in IMAGE_EXTS:
        return "image"
    if "log" in path.name.lower():
        return "log"
    if path.suffix.lower() in DATA_EXTS:
        return "data"
    return "other"


def _read_meta_yaml(folder: Path) -> Optional[dict]:
    meta_path = folder / "meta.yaml"
    if not meta_path.exists():
        return None
    try:
        return yaml.safe_load(meta_path.read_text(encoding="utf-8")) or {}
    except Exception:
        return {}


def _extract_ppms_meta(folder: Path) -> Optional[dict]:
    """Try PPMS header extraction from .dat files.

    - Check for identity (sample+type) only in .dat files directly in this folder
    - Search recursively into subfolders (stopping at sub-measurement boundaries)
      just to find a mass if identity already came from meta.yaml

    This handles:
    - Folders where identity is in meta.yaml at root but mass is in a .dat inside subfolder
    - Mixed VSM/HC folders where only HC files carry mass
    - Does NOT accidentally turn parent folders into measurements that include all subfolders
    """
    from parsers.ppms import extract_header_meta

    identity: Optional[dict] = None  # first file with sample+type (only checked in current folder)
    partial: Optional[dict] = None   # first file with any meta (only checked in current folder)
    mass: Optional[float] = None     # first mass found across all files + subfolders

    # Step 1: check only files directly in this folder for identity
    for f in sorted(folder.iterdir()):
        if not (f.is_file() and f.suffix.lower() == ".dat"):
            continue
        meta = extract_header_meta(str(f))
        if not meta:
            continue
        if partial is None:
            partial = meta
        if identity is None and meta.get("sample") and meta.get("type"):
            identity = meta
        if mass is None and meta.get("mass") is not None:
            mass = meta["mass"]

    # Step 2: if we don't have mass yet, search recursively for mass
    # Start in current folder, then check parent folder's other subfolders (common case: IP/OOP split)
    if mass is None:
        stack = [folder]
        # If we don't find mass in current tree and have a parent, also check parent's other subdirectories
        # This handles common case where mass is only stored in one orientation (OOP/IP) but both orientations use the same crystal
        parent = folder.parent
        if parent != folder:
            stack.append(parent)

        while stack and mass is None:
            current = stack.pop()
            for f in sorted(current.iterdir()):
                if f.name.startswith("."):
                    continue
                if f == folder:
                    continue  # skip ourselves when searching from parent
                if f.is_file() and f.suffix.lower() == ".dat":
                    meta = extract_header_meta(str(f))
                    if meta and meta.get("mass") is not None:
                        mass = meta["mass"]
                        break  # found mass, exit
                elif f.is_dir():
                    # Check if subfolder is its own measurement
                    # Only skip if it's a different sample, but still allow searching it if it's same sample
                    sub_meta = _read_meta_yaml(f)
                    if sub_meta is not None and sub_meta.get("sample"):
                        # If this subfolder is a measurement for the same sample, we *do* want to search it for mass
                        # because it's likely another orientation (OOP/IP) of the same crystal
                        sample_name_current = identity.get("sample") if identity else None
                        sample_name_sub = sub_meta.get("sample")
                        if sample_name_current != sample_name_sub:
                            continue  # different sample, skip
                    # Add to stack for searching
                    stack.append(f)

    best = identity or partial
    # Even if we didn't find any full identity (identity/partial is None), if we found mass return it
    # This handles case where identity comes from meta.yaml but mass is in a .dat in a subfolder
    if best is None:
        if mass is not None:
            return {"mass": mass}
        return None
    if mass is not None:
        best = {**best, "mass": mass}
    return best


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
        if item.is_file():
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
    is_ppms = exp_type in {"ppms-vsm", "ppms-hc"}
    orientation = meta.get("orientation") if exp_type == "ppms-vsm" else None
    raw_mass = meta.get("mass") if is_ppms else None
    try:
        mass = float(raw_mass) if raw_mass is not None else None
    except (ValueError, TypeError):
        mass = None
    if exp is None:
        exp = Experiment(
            sample_id=sample.id,
            type=exp_type,
            exp_date=meta.get("date"),
            notes=meta.get("notes"),
            orientation=orientation or None,
            mass=mass,
            source_path=source_path,
        )
        session.add(exp)
        session.flush()
        added["experiments"] += 1
    elif mass is not None:
        # Update mass if we now found it (even if it had a value before)
        # This fixes rescans after enabling inner folder search
        if exp.mass != mass:
            exp.mass = mass
            session.add(exp)

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


def _merge_meta(ppms: dict, yaml: dict) -> dict:
    """Merge PPMS header metadata with meta.yaml. yaml wins on conflict."""
    merged = {**ppms}
    for k, v in yaml.items():
        if v is not None and v != "":
            merged[k] = v
    return merged


def _scan_dir(session: Session, folder: Path, added: dict, within_measurement: bool = False):
    """Recursively process a folder.

    within_measurement=True means this folder is already inside an identified measurement;
    PPMS auto-extraction is skipped to avoid creating duplicate experiments for subfolders.
    meta.yaml is always read regardless.
    """
    if not folder.is_dir() or folder.name.startswith("."):
        return

    yaml_meta = _read_meta_yaml(folder) or {}
    if yaml_meta.get("skip"):
        return
    ppms_meta = _extract_ppms_meta(folder) or {} if not within_measurement else {}
    merged = _merge_meta(ppms_meta, yaml_meta)

    if merged.get("sample") and merged.get("type"):
        _upsert_measurement(session, folder, merged, added)
        for sub in sorted(folder.iterdir()):
            if sub.is_dir():
                _scan_dir(session, sub, added, within_measurement=True)
        return

    # No measurement identified: recurse into subfolders
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
