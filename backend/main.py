import os
from pathlib import Path
from typing import Optional

from fastapi import (
    Depends,
    FastAPI,
    HTTPException,
    Query,
    UploadFile,
    File as FastAPIFile,
)
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select

from database import create_db, get_session
from datetime import datetime, timezone
from models import (
    Sample,
    SampleCreate,
    SampleRead,
    SampleDetail,
    Experiment,
    ExperimentCreate,
    ExperimentRead,
    DataFile,
    DataFileRead,
    SampleFile,
    SampleFileRead,
    Note,
    NoteRead,
    NoteCreate,
    NoteUpdate,
    FileWithContext,
)
import scanner

app = FastAPI(title="Lab Notebook")

DATA_DIR_PATH = Path(os.environ.get("DATA_DIR", "/data"))
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


SEED_DIR = Path(__file__).parent.parent / "seed"


@app.on_event("startup")
def on_startup():
    create_db()
    _seed_if_empty()


def _seed_if_empty():
    """On first start, copy seed samples into DATA_DIR/samples/ and scan."""
    samples_dir = DATA_DIR_PATH / "samples"
    samples_dir.mkdir(parents=True, exist_ok=True)

    if not SEED_DIR.exists():
        return
    # Only seed if the samples directory is empty (ignoring hidden files)
    existing = [p for p in samples_dir.iterdir() if not p.name.startswith(".")]
    if existing:
        return

    import shutil

    for seed_sample in SEED_DIR.iterdir():
        if seed_sample.is_dir():
            dest = samples_dir / seed_sample.name
            shutil.copytree(seed_sample, dest)

    # Run initial scan
    from sqlmodel import Session
    from database import engine

    with Session(engine) as session:
        scanner.scan(session)


# ── Static files ───────────────────────────────────────────────────────────

app.mount("/files", StaticFiles(directory=str(DATA_DIR_PATH)), name="files")
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/", include_in_schema=False)
def root():
    return FileResponse(FRONTEND_DIR / "index.html")


# ── Samples ────────────────────────────────────────────────────────────────


@app.get("/api/samples", response_model=list[SampleRead])
def list_samples(
    compound: Optional[str] = Query(None),
    batch: Optional[str] = Query(None),
    box: Optional[str] = Query(None),
    q: Optional[str] = Query(None, description="Search name or compound"),
    session: Session = Depends(get_session),
):
    stmt = select(Sample)
    if compound:
        stmt = stmt.where(Sample.compound == compound)
    if batch:
        stmt = stmt.where(Sample.batch == batch)
    if box:
        stmt = stmt.where(Sample.box == box)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(Sample.name.like(like) | Sample.compound.like(like))
    samples = session.exec(stmt.order_by(Sample.name)).all()
    return samples


@app.get("/api/samples/{sample_id}", response_model=SampleDetail)
def get_sample(sample_id: int, session: Session = Depends(get_session)):
    sample = session.get(Sample, sample_id)
    if not sample:
        raise HTTPException(404, "Sample not found")
    # Eagerly load relationships
    experiments = session.exec(
        select(Experiment).where(Experiment.sample_id == sample_id)
    ).all()
    exp_reads = []
    for exp in experiments:
        files = session.exec(
            select(DataFile).where(DataFile.experiment_id == exp.id)
        ).all()
        exp_reads.append(
            ExperimentRead(
                id=exp.id,
                sample_id=exp.sample_id,
                type=exp.type,
                exp_date=exp.exp_date,
                notes=exp.notes,
                files=[
                    DataFileRead(
                        id=f.id, filename=f.filename, path=f.path, file_type=f.file_type
                    )
                    for f in files
                ],
            )
        )
    sfiles = session.exec(
        select(SampleFile).where(SampleFile.sample_id == sample_id)
    ).all()
    return SampleDetail(
        id=sample.id,
        name=sample.name,
        compound=sample.compound,
        synthesis_date=sample.synthesis_date,
        batch=sample.batch,
        box=sample.box,
        crystal_size=sample.crystal_size,
        notes=sample.notes,
        experiments=exp_reads,
        sample_files=[
            SampleFileRead(
                id=f.id, filename=f.filename, path=f.path, file_type=f.file_type
            )
            for f in sfiles
        ],
    )


@app.post("/api/samples", response_model=SampleRead, status_code=201)
def create_sample(data: SampleCreate, session: Session = Depends(get_session)):
    existing = session.exec(select(Sample).where(Sample.name == data.name)).first()
    if existing:
        raise HTTPException(409, f"Sample '{data.name}' already exists")
    sample = Sample(**data.model_dump())
    session.add(sample)
    session.commit()
    session.refresh(sample)
    return sample


@app.put("/api/samples/{sample_id}", response_model=SampleRead)
def update_sample(
    sample_id: int, data: SampleCreate, session: Session = Depends(get_session)
):
    sample = session.get(Sample, sample_id)
    if not sample:
        raise HTTPException(404, "Sample not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(sample, k, v)
    session.add(sample)
    session.commit()
    session.refresh(sample)
    return sample


@app.delete("/api/samples/{sample_id}", status_code=204)
def delete_sample(sample_id: int, session: Session = Depends(get_session)):
    sample = session.get(Sample, sample_id)
    if not sample:
        raise HTTPException(404, "Sample not found")
    session.delete(sample)
    session.commit()


# ── Sample files (photos) ──────────────────────────────────────────────────


@app.post(
    "/api/samples/{sample_id}/files", response_model=SampleFileRead, status_code=201
)
async def upload_sample_file(
    sample_id: int,
    file: UploadFile = FastAPIFile(...),
    session: Session = Depends(get_session),
):
    sample = session.get(Sample, sample_id)
    if not sample:
        raise HTTPException(404, "Sample not found")
    save_dir = DATA_DIR_PATH / "samples" / sample.name / "photos"
    save_dir.mkdir(parents=True, exist_ok=True)
    save_path = save_dir / file.filename
    save_path.write_bytes(await file.read())
    rel_path = save_path.relative_to(DATA_DIR_PATH).as_posix()
    sf = SampleFile(sample_id=sample_id, filename=file.filename, path=rel_path)
    session.add(sf)
    session.commit()
    session.refresh(sf)
    return SampleFileRead(
        id=sf.id, filename=sf.filename, path=sf.path, file_type=sf.file_type
    )


@app.delete("/api/samples/{sample_id}/files/{file_id}", status_code=204)
def delete_sample_file(
    sample_id: int, file_id: int, session: Session = Depends(get_session)
):
    sf = session.get(SampleFile, file_id)
    if not sf or sf.sample_id != sample_id:
        raise HTTPException(404, "File not found")
    try:
        (DATA_DIR_PATH / sf.path).unlink(missing_ok=True)
    except Exception:
        pass
    session.delete(sf)
    session.commit()


# ── Experiments ────────────────────────────────────────────────────────────


@app.post("/api/experiments", response_model=ExperimentRead, status_code=201)
def create_experiment(data: ExperimentCreate, session: Session = Depends(get_session)):
    if not session.get(Sample, data.sample_id):
        raise HTTPException(404, "Sample not found")
    exp = Experiment(**data.model_dump())
    session.add(exp)
    session.commit()
    session.refresh(exp)
    return ExperimentRead(
        id=exp.id,
        sample_id=exp.sample_id,
        type=exp.type,
        exp_date=exp.exp_date,
        notes=exp.notes,
        files=[],
    )


@app.post(
    "/api/experiments/{exp_id}/files", response_model=DataFileRead, status_code=201
)
async def upload_file(
    exp_id: int,
    file: UploadFile = FastAPIFile(...),
    file_type: str = Query("data"),
    session: Session = Depends(get_session),
):
    exp = session.get(Experiment, exp_id)
    if not exp:
        raise HTTPException(404, "Experiment not found")

    sample = session.get(Sample, exp.sample_id)
    save_dir = DATA_DIR_PATH / "samples" / sample.name / exp.type
    save_dir.mkdir(parents=True, exist_ok=True)

    save_path = save_dir / file.filename
    content = await file.read()
    save_path.write_bytes(content)

    rel_path = save_path.relative_to(DATA_DIR_PATH).as_posix()
    df = DataFile(
        experiment_id=exp_id,
        filename=file.filename,
        path=rel_path,
        file_type=file_type,
    )
    session.add(df)
    session.commit()
    session.refresh(df)
    return DataFileRead(
        id=df.id, filename=df.filename, path=df.path, file_type=df.file_type
    )


@app.put("/api/experiments/{exp_id}", response_model=ExperimentRead)
def update_experiment(
    exp_id: int, data: ExperimentCreate, session: Session = Depends(get_session)
):
    exp = session.get(Experiment, exp_id)
    if not exp:
        raise HTTPException(404, "Experiment not found")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(exp, k, v)
    session.add(exp)
    session.commit()
    session.refresh(exp)
    files = session.exec(select(DataFile).where(DataFile.experiment_id == exp_id)).all()
    return ExperimentRead(
        id=exp.id,
        sample_id=exp.sample_id,
        type=exp.type,
        exp_date=exp.exp_date,
        notes=exp.notes,
        files=[
            DataFileRead(
                id=f.id, filename=f.filename, path=f.path, file_type=f.file_type
            )
            for f in files
        ],
    )


@app.delete("/api/experiments/{exp_id}", status_code=204)
def delete_experiment(exp_id: int, session: Session = Depends(get_session)):
    exp = session.get(Experiment, exp_id)
    if not exp:
        raise HTTPException(404, "Experiment not found")

    files = session.exec(select(DataFile).where(DataFile.experiment_id == exp_id)).all()
    for df in files:
        try:
            (DATA_DIR_PATH / df.path).unlink(missing_ok=True)
        except Exception:
            pass
        session.delete(df)

    session.delete(exp)
    session.commit()


@app.delete("/api/experiments/{exp_id}/files/{file_id}", status_code=204)
def delete_experiment_file(
    exp_id: int, file_id: int, session: Session = Depends(get_session)
):
    df = session.get(DataFile, file_id)
    if not df or df.experiment_id != exp_id:
        raise HTTPException(404, "File not found")
    try:
        (DATA_DIR_PATH / df.path).unlink(missing_ok=True)
    except Exception:
        pass
    session.delete(df)
    session.commit()


# ── Visualization data ─────────────────────────────────────────────────────


@app.get("/api/experiments/{exp_id}/data")
def experiment_data(
    exp_id: int,
    file_id: Optional[int] = Query(
        None, description="Specific file; omit for all data files"
    ),
    mode: Optional[str] = Query(None, description="MT or MH for PPMS"),
    session: Session = Depends(get_session),
):
    exp = session.get(Experiment, exp_id)
    if not exp:
        raise HTTPException(404, "Experiment not found")

    stmt = select(DataFile).where(
        DataFile.experiment_id == exp_id,
        DataFile.file_type == "data",
    )
    if file_id is not None:
        stmt = stmt.where(DataFile.id == file_id)

    files = session.exec(stmt).all()
    if not files:
        return {"traces": [], "xaxis": "", "yaxis": ""}

    traces = []
    xaxis_title = ""
    yaxis_title = ""

    for f in files:
        abs_path = str(DATA_DIR_PATH / f.path)

        if exp.type in {"ppms-vsm", "ppms-hc"}:
            from parsers.ppms import parse_dat, detect_mode, to_traces as ppms_traces

            df = parse_dat(abs_path)
            if df is None:
                continue
            m = mode or detect_mode(df)
            t = ppms_traces(df, m, f.filename)
            traces.extend(t)
            xaxis_title = "Temperature (K)" if m == "MT" else "Magnetic Field (Oe)"
            yaxis_title = "Moment (emu)"

        elif exp.type in {"pxrd", "sxrd"}:
            from parsers.pxrd import parse_pxrd, to_traces as pxrd_traces

            df = parse_pxrd(abs_path)
            if df is None:
                continue
            traces.extend(pxrd_traces(df, f.filename))
            xaxis_title = "2θ (°)"
            yaxis_title = "Intensity (a.u.)"

        elif exp.type == "fmr":
            from parsers.fmr import parse_fmr, to_traces as fmr_traces

            df = parse_fmr(abs_path)
            if df is None:
                continue
            t = fmr_traces(df, f.filename)
            traces.extend(t)
            keys = list(df.keys())
            xaxis_title = keys[0] if keys else "Field"
            yaxis_title = keys[1] if len(keys) > 1 else "Signal"

    return {"traces": traces, "xaxis": xaxis_title, "yaxis": yaxis_title}


# ── Scan ───────────────────────────────────────────────────────────────────


@app.post("/api/scan")
def trigger_scan(session: Session = Depends(get_session)):
    result = scanner.scan(session)
    return result


# ── Filter options ─────────────────────────────────────────────────────────


@app.get("/api/filters")
def get_filters(session: Session = Depends(get_session)):
    compounds = session.exec(select(Sample.compound).distinct()).all()
    batches = session.exec(
        select(Sample.batch).where(Sample.batch.isnot(None)).distinct()
    ).all()
    boxes = session.exec(
        select(Sample.box).where(Sample.box.isnot(None)).distinct()
    ).all()
    return {
        "compounds": sorted(set(compounds)),
        "batches": sorted(set(b for b in batches if b)),
        "boxes": sorted(set(b for b in boxes if b)),
    }


# ── Cross-sample file listing (for Visualization page) ────────────────────


@app.get("/api/files", response_model=list[FileWithContext])
def list_files(
    exp_type: Optional[str] = Query(
        None, description="ppms-vsm | ppms-hc | pxrd | sxrd | microscopy"
    ),
    sample_id: Optional[int] = Query(None),
    session: Session = Depends(get_session),
):
    stmt = (
        select(DataFile, Experiment, Sample)
        .join(Experiment, DataFile.experiment_id == Experiment.id)
        .join(Sample, Experiment.sample_id == Sample.id)
        .where(DataFile.file_type == "data")
    )
    if exp_type:
        stmt = stmt.where(Experiment.type == exp_type)
    if sample_id:
        stmt = stmt.where(Sample.id == sample_id)

    rows = session.exec(stmt).all()
    return [
        FileWithContext(
            id=f.id,
            filename=f.filename,
            path=f.path,
            file_type=f.file_type,
            experiment_id=exp.id,
            exp_type=exp.type,
            sample_id=s.id,
            sample_name=s.name,
        )
        for f, exp, s in rows
    ]


# ── Multi-file visualization (for Visualization page) ─────────────────────


@app.post("/api/plot")
def plot_files(
    file_ids: list[int],
    mode: Optional[str] = Query(None),
    session: Session = Depends(get_session),
):
    """Return Plotly traces for an arbitrary list of file IDs."""
    traces = []
    xaxis_title = ""
    yaxis_title = ""

    for fid in file_ids:
        f = session.get(DataFile, fid)
        if not f:
            continue
        exp = session.get(Experiment, f.experiment_id)
        abs_path = str(DATA_DIR_PATH / f.path)

        if exp.type in {"ppms-vsm", "ppms-hc"}:
            from parsers.ppms import parse_dat, detect_mode, to_traces as ppms_traces

            df = parse_dat(abs_path)
            if df is None:
                continue
            m = mode or detect_mode(df)
            traces.extend(ppms_traces(df, m, f.filename))
            xaxis_title = "Temperature (K)" if m == "MT" else "Magnetic Field (Oe)"
            yaxis_title = "Moment (emu)"

        elif exp.type in {"pxrd", "sxrd"}:
            from parsers.pxrd import parse_pxrd, to_traces as pxrd_traces

            df = parse_pxrd(abs_path)
            if df is None:
                continue
            traces.extend(pxrd_traces(df, f.filename))
            xaxis_title = "2θ (°)"
            yaxis_title = "Intensity (a.u.)"

        elif exp.type == "fmr":
            from parsers.fmr import parse_fmr, to_traces as fmr_traces

            df = parse_fmr(abs_path)
            if df is None:
                continue
            t = fmr_traces(df, f.filename)
            traces.extend(t)
            keys = list(df.keys()) if df else []
            xaxis_title = keys[0] if keys else "Field"
            yaxis_title = keys[1] if len(keys) > 1 else "Signal"

    return {"traces": traces, "xaxis": xaxis_title, "yaxis": yaxis_title}


# ── Notes ──────────────────────────────────────────────────────────────────


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


@app.get("/api/notes", response_model=list[NoteRead])
def list_notes(
    q: Optional[str] = Query(None),
    session: Session = Depends(get_session),
):
    stmt = select(Note)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(Note.title.like(like) | Note.body.like(like))
    return session.exec(stmt.order_by(Note.updated_at.desc())).all()


@app.post("/api/notes", response_model=NoteRead, status_code=201)
def create_note(data: NoteCreate, session: Session = Depends(get_session)):
    now = _now()
    note = Note(title=data.title, body=data.body, created_at=now, updated_at=now)
    session.add(note)
    session.commit()
    session.refresh(note)
    return note


@app.get("/api/notes/{note_id}", response_model=NoteRead)
def get_note(note_id: int, session: Session = Depends(get_session)):
    note = session.get(Note, note_id)
    if not note:
        raise HTTPException(404, "Note not found")
    return note


@app.put("/api/notes/{note_id}", response_model=NoteRead)
def update_note(
    note_id: int, data: NoteUpdate, session: Session = Depends(get_session)
):
    note = session.get(Note, note_id)
    if not note:
        raise HTTPException(404, "Note not found")
    if data.title is not None:
        note.title = data.title
    if data.body is not None:
        note.body = data.body
    note.updated_at = _now()
    session.add(note)
    session.commit()
    session.refresh(note)
    return note


@app.delete("/api/notes/{note_id}", status_code=204)
def delete_note(note_id: int, session: Session = Depends(get_session)):
    note = session.get(Note, note_id)
    if not note:
        raise HTTPException(404, "Note not found")
    session.delete(note)
    session.commit()
