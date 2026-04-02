"""
Directory scanner: walks data/samples/ and imports samples + experiments into DB.

Expected layout:
  DATA_DIR/
  └── samples/
      └── <sample-name>/
          ├── meta.yaml
          ├── microscopy/   ← image files
          ├── pxrd/         ← .xy .xye .csv .dat
                    ├── sxrd/         ← .xy .xye .csv .dat
                    ├── ppms-vsm/     ← .dat (PPMS format), may have sub-folders (e.g. axis-1/)
                    └── ppms-hc/      ← .dat (PPMS format), may have sub-folders (e.g. axis-1/)
"""

import os
from pathlib import Path
from typing import Optional, Iterator

import yaml
from sqlmodel import Session, select

from models import Sample, Experiment, DataFile

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
SAMPLES_DIR = DATA_DIR / "samples"

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".gif"}
DATA_EXTS = {".dat", ".xy", ".xye", ".csv", ".txt", ".asc"}

EXP_TYPES = ["microscopy", "pxrd", "sxrd", "ppms-vsm", "ppms-hc"]


def _file_type(path: Path) -> str:
    ext = path.suffix.lower()
    if ext in IMAGE_EXTS:
        return "image"
    return "data"


def _walk_files(directory: Path) -> Iterator[Path]:
    """Recursively yield files, following symlinks."""
    for root, _dirs, files in os.walk(directory, followlinks=True):
        for fname in sorted(files):
            yield Path(root) / fname


def scan(session: Session) -> dict:
    """Scan SAMPLES_DIR and upsert all samples/experiments/files."""
    if not SAMPLES_DIR.exists():
        return {"error": "samples directory not found", "path": str(SAMPLES_DIR)}

    added = {"samples": 0, "experiments": 0, "files": 0}

    for sample_dir in sorted(SAMPLES_DIR.iterdir()):
        if not sample_dir.is_dir():
            continue

        meta_path = sample_dir / "meta.yaml"
        if not meta_path.exists():
            continue

        try:
            meta = yaml.safe_load(meta_path.read_text(encoding="utf-8"))
        except Exception:
            continue

        sample_name = meta.get("name") or sample_dir.name

        # Upsert sample
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
            session.flush()  # get sample.id
            added["samples"] += 1
        else:
            # Update mutable fields
            sample.compound = meta.get("compound", sample.compound)
            sample.synthesis_date = meta.get("synthesis_date") or sample.synthesis_date
            sample.batch = meta.get("batch") or sample.batch
            sample.box = (
                str(meta.get("box")) if meta.get("box") is not None else sample.box
            )
            sample.crystal_size = meta.get("crystal_size") or sample.crystal_size
            sample.notes = meta.get("notes") or sample.notes
            session.add(sample)
            session.flush()

        # Scan experiment subdirectories (recurse into sub-folders, e.g. axis-1/, axis-2/)
        for exp_type in EXP_TYPES:
            exp_dir = sample_dir / exp_type
            if not exp_dir.is_dir():
                continue

            files_in_dir = [
                f
                for f in _walk_files(exp_dir)
                if f.suffix.lower() in IMAGE_EXTS | DATA_EXTS
            ]
            if not files_in_dir:
                continue

            # One experiment record per type per sample (upsert)
            exp = session.exec(
                select(Experiment).where(
                    Experiment.sample_id == sample.id,
                    Experiment.type == exp_type,
                )
            ).first()
            if exp is None:
                exp = Experiment(sample_id=sample.id, type=exp_type)
                session.add(exp)
                session.flush()
                added["experiments"] += 1

            # Upsert files
            for f in files_in_dir:
                rel_path = f.relative_to(DATA_DIR).as_posix()
                # Use path relative to exp_dir as filename to preserve sub-folder info
                rel_name = f.relative_to(exp_dir).as_posix()
                exists = session.exec(
                    select(DataFile).where(DataFile.path == rel_path)
                ).first()
                if exists:
                    continue
                df = DataFile(
                    experiment_id=exp.id,
                    filename=rel_name,
                    path=rel_path,
                    file_type=_file_type(f),
                )
                session.add(df)
                added["files"] += 1

    session.commit()
    return added
