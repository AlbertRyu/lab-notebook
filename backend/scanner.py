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

from models import Sample, Experiment, DataFile, SampleFile

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
SAMPLES_DIR = DATA_DIR / "samples"

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".gif"}
DATA_EXTS = {".dat", ".xy", ".xye", ".csv", ".txt", ".asc"}
PHOTO_DIR_NAMES = {"photos", "images", "picture", "samplepic"}


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


def _normalise_sample_name(name: str) -> str:
    return "".join(ch.lower() for ch in name if ch.isalnum())


def _sample_by_name(session: Session, name: str) -> Optional[Sample]:
    sample = session.exec(select(Sample).where(Sample.name == name)).first()
    if sample is not None:
        return sample

    normalised = _normalise_sample_name(name)
    if not normalised:
        return None
    for sample in session.exec(select(Sample)).all():
        if _normalise_sample_name(sample.name) == normalised:
            return sample
    return None


def is_sample_photo_path(path: str) -> bool:
    parts = [p.lower() for p in Path(path).parts]
    if "samples" in parts:
        sample_root = parts.index("samples")
        photo_dir_index = sample_root + 3
        return len(parts) > photo_dir_index and parts[photo_dir_index] in PHOTO_DIR_NAMES

    measurement_dirs = {"ppms-vsm", "ppms-hc", "pxrd", "sxrd", "fmr", "microscopy", "oop", "ip", "graphs"}
    return not any(part in measurement_dirs for part in parts)


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
    else:
        # Update existing sample fields from meta.yaml when the key is explicitly present
        changed = False
        field_map = {
            "compound": "compound",
            "synthesis_date": "synthesis_date",
            "batch": "batch",
            "crystal_size": "crystal_size",
            "sample_notes": "notes",
        }
        for yaml_key, db_attr in field_map.items():
            if yaml_key in meta:
                val = meta[yaml_key]
                if yaml_key == "synthesis_date" and val is not None:
                    val = str(val)
                setattr(sample, db_attr, val or None)
                changed = True
        if "box" in meta:
            sample.box = str(meta["box"]) if meta.get("box") is not None else None
            changed = True
        if changed:
            session.add(sample)
    return sample


def _sample_from_existing_path(session: Session, folder: Path) -> Optional[Sample]:
    """Prefer an already-known sample encoded in the folder path.

    Expected layout under DATA_DIR/samples is roughly:
      /samples/<compound>/<sample>/<type>/[orientation]
    If one of the ancestors already matches a known sample name, reuse it instead
    of trusting a PPMS header that may only contain the compound name.
    """
    try:
        relative_parts = folder.resolve().relative_to(SAMPLES_DIR.resolve()).parts
    except ValueError:
        return None

    if len(relative_parts) < 2:
        return None

    candidates = [relative_parts[-3], relative_parts[-2]] if len(relative_parts) >= 3 else [relative_parts[-2]]
    seen = set()
    for name in candidates:
        if name in seen:
            continue
        seen.add(name)
        sample = _sample_by_name(session, name)
        if sample is not None:
            return sample
    return _sample_by_name(session, folder.name)


def _upsert_measurement(session: Session, folder: Path, meta: dict, added: dict):
    """Create/update Sample + Experiment + DataFiles for a measurement folder."""
    sample_name = (meta.get("sample") or "").strip()
    exp_type = (meta.get("type") or "").strip()
    if not sample_name or not exp_type:
        return

    source_path = str(folder.resolve())
    sample = _sample_from_existing_path(session, folder)
    if sample is None:
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
    else:
        changed = False
        if exp.sample_id != sample.id:
            exp.sample_id = sample.id
            changed = True
        for attr, key in [("notes", "notes"), ("exp_date", "date"), ("orientation", "orientation")]:
            val = meta.get(key)
            if val is not None and getattr(exp, attr) != val:
                setattr(exp, attr, val)
                changed = True
        if mass is not None and exp.mass != mass:
            exp.mass = mass
            changed = True
        if changed:
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

        ftype = _file_type(f)
        auto_mode = None
        external_field_oe = None
        temperature_k = None
        if ftype == "data" and exp_type in {"ppms-vsm", "ppms-hc"}:
            try:
                from parsers.ppms import parse_dat, detect_mode, diagnostic_constants
                df_data = parse_dat(str(f))
                if df_data:
                    auto_mode = detect_mode(df_data)
                    if exp_type == "ppms-vsm":
                        constants = diagnostic_constants(df_data)
                        external_field_oe = constants.get("external_field_oe")
                        temperature_k = constants.get("temperature_k")
            except Exception:
                auto_mode = None
                external_field_oe = None
                temperature_k = None

        session.add(DataFile(
            experiment_id=exp.id,
            filename=filename,
            path=rel_path,
            file_type=ftype,
            auto_mode=auto_mode,
            external_field_oe=external_field_oe,
            temperature_k=temperature_k,
        ))
        added["files"] += 1


def _import_sample_images(
    session: Session,
    sample: Sample,
    image_files: list[Path],
    base_folder: Path,
    added: dict,
) -> None:
    for f in image_files:
        try:
            rel_path = f.relative_to(DATA_DIR).as_posix()
        except ValueError:
            rel_path = str(f)

        if session.exec(select(SampleFile).where(SampleFile.path == rel_path)).first():
            continue

        try:
            filename = f.relative_to(base_folder).as_posix()
        except ValueError:
            filename = f.name

        session.add(SampleFile(
            sample_id=sample.id,
            filename=filename,
            path=rel_path,
            file_type="image",
        ))
        added["files"] += 1


def _scan_sample_photos(session: Session, folder: Path, added: dict) -> bool:
    """Import image files from sample-level photo folders or queue sample folders."""
    is_photo_dir = folder.name.lower() in PHOTO_DIR_NAMES
    sample = _sample_from_existing_path(session, folder)

    if is_photo_dir:
        if sample is None:
            return False
        image_files = [
            f for f in sorted(folder.rglob("*"))
            if f.is_file() and not f.name.startswith(".") and f.suffix.lower() in IMAGE_EXTS
        ]
        _import_sample_images(session, sample, image_files, folder, added)
        return True

    try:
        folder.resolve().relative_to(SAMPLES_DIR.resolve())
        is_under_samples_dir = True
    except ValueError:
        is_under_samples_dir = False
    if is_under_samples_dir:
        return False

    sample = sample or _sample_by_name(session, folder.name)
    if sample is None:
        return False

    image_files = [
        f for f in sorted(folder.iterdir())
        if f.is_file() and not f.name.startswith(".") and f.suffix.lower() in IMAGE_EXTS
    ]
    _import_sample_images(session, sample, image_files, folder, added)
    return False


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

    if not within_measurement and _scan_sample_photos(session, folder, added):
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


def purge_orphans(session: Session) -> dict:
    """Remove DB records for files/experiments whose paths no longer exist on disk.

    Does NOT delete Sample records — samples may exist without measurements
    (user-created manually). Returns counts of removed rows.
    """
    removed = {"files": 0, "experiments": 0}

    for df in session.exec(select(DataFile)).all():
        if not (DATA_DIR / df.path).exists():
            session.delete(df)
            removed["files"] += 1
    session.flush()

    for sf in session.exec(select(SampleFile)).all():
        is_measurement_file = session.exec(
            select(DataFile).where(DataFile.path == sf.path)
        ).first() is not None
        if is_measurement_file or not is_sample_photo_path(sf.path) or not (DATA_DIR / sf.path).exists():
            session.delete(sf)
            removed["files"] += 1
    session.flush()

    for exp in session.exec(select(Experiment)).all():
        if exp.source_path and not Path(exp.source_path).exists():
            for df in session.exec(select(DataFile).where(DataFile.experiment_id == exp.id)).all():
                session.delete(df)
                removed["files"] += 1
            session.delete(exp)
            removed["experiments"] += 1

    session.commit()
    return removed


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
    removed = purge_orphans(session)
    return {**added, "removed_files": removed["files"], "removed_experiments": removed["experiments"]}
