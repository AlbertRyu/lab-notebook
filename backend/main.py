import os
import json
import hmac
import base64
import hashlib
import shutil
import re
import time
from pathlib import Path
from typing import Optional

from fastapi import (
    Depends,
    FastAPI,
    Form,
    HTTPException,
    Request,
    Response,
    Query,
    UploadFile,
    File as FastAPIFile,
)
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
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
NOTES_DIR = DATA_DIR_PATH / "notes"
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


def _get_scan_roots() -> list[Path]:
    """Return configured scan root directories.

    Defaults to DATA_DIR/samples. Override with SCAN_ROOTS env var
    (colon-separated absolute paths, e.g. /data/samples:/data/external/ppms).
    """
    env = os.environ.get("SCAN_ROOTS", "").strip()
    if env:
        return [Path(p.strip()) for p in env.split(":") if p.strip()]
    return [DATA_DIR_PATH / "samples"]

AUTH_COOKIE_NAME = "lab_notebook_auth"
AUTH_TTL_SECONDS = int(os.environ.get("AUTH_TTL_SECONDS", "28800"))  # 8 hours
AUTH_COOKIE_SECURE = os.environ.get("AUTH_COOKIE_SECURE", "false").lower() == "true"


class AuthLogin(BaseModel):
    password: str


def _auth_secret() -> bytes:
    return os.environ.get("AUTH_SECRET", "dev-secret-change-me").encode("utf-8")


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    padding = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode((s + padding).encode("ascii"))


def _make_auth_token() -> str:
    payload = {"exp": int(time.time()) + AUTH_TTL_SECONDS}
    payload_b64 = _b64url_encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    )
    sig = hmac.new(
        _auth_secret(),
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"{payload_b64}.{_b64url_encode(sig)}"


def _is_valid_auth_token(token: str) -> bool:
    try:
        payload_b64, sig_b64 = token.split(".", 1)
    except ValueError:
        return False

    expected_sig = hmac.new(
        _auth_secret(), payload_b64.encode("ascii"), hashlib.sha256
    ).digest()
    try:
        got_sig = _b64url_decode(sig_b64)
    except Exception:
        return False
    if not hmac.compare_digest(got_sig, expected_sig):
        return False

    try:
        payload = json.loads(_b64url_decode(payload_b64))
    except Exception:
        return False

    exp = payload.get("exp")
    return isinstance(exp, int) and exp > int(time.time())


def _is_authenticated(request: Request) -> bool:
    token = request.cookies.get(AUTH_COOKIE_NAME)
    if not token:
        return False
    return _is_valid_auth_token(token)


def require_write_auth(request: Request):
    if not _is_authenticated(request):
        raise HTTPException(401, "Authentication required for write operations")


SEED_DIR = Path(__file__).parent.parent / "seed"


@app.get("/api/auth/me")
def auth_me(request: Request):
    return {"authenticated": _is_authenticated(request)}


@app.post("/api/auth/login")
def auth_login(data: AuthLogin, response: Response):
    configured_password = os.environ.get("LAB_NOTEBOOK_PASSWORD", "")
    if not configured_password:
        raise HTTPException(503, "LAB_NOTEBOOK_PASSWORD is not configured")

    if not hmac.compare_digest(data.password, configured_password):
        raise HTTPException(401, "Invalid password")

    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=_make_auth_token(),
        max_age=AUTH_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=AUTH_COOKIE_SECURE,
        path="/",
    )
    return {"authenticated": True}


@app.post("/api/auth/logout")
def auth_logout(response: Response):
    response.delete_cookie(key=AUTH_COOKIE_NAME, path="/")
    return {"authenticated": False}


@app.on_event("startup")
def on_startup():
    create_db()
    _seed_if_empty()
    # Sync all existing notes to markdown files
    from database import engine
    with Session(engine) as session:
        _sync_all_notes_from_db(session)


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
        scanner.scan(session, _get_scan_roots())


# ── PPMS config (JSON file on disk) ───────────────────────────────────────

PPMS_CONFIG_PATH = DATA_DIR_PATH / "ppms_config.json"


@app.get("/api/ppms-config")
def get_ppms_config():
    if PPMS_CONFIG_PATH.exists():
        try:
            return json.loads(PPMS_CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return []


@app.post("/api/ppms-config")
async def save_ppms_config(request: Request):
    require_write_auth(request)
    data = await request.json()
    if not isinstance(data, list):
        raise HTTPException(400, "Expected a JSON array")
    PPMS_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    PPMS_CONFIG_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {"ok": True}


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
                orientation=exp.orientation,
                mass=exp.mass,
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
def create_sample(
    data: SampleCreate,
    _: None = Depends(require_write_auth),
    session: Session = Depends(get_session),
):
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
    sample_id: int,
    data: SampleCreate,
    _: None = Depends(require_write_auth),
    session: Session = Depends(get_session),
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
def delete_sample(
    sample_id: int,
    _: None = Depends(require_write_auth),
    session: Session = Depends(get_session),
):
    sample = session.get(Sample, sample_id)
    if not sample:
        raise HTTPException(404, "Sample not found")
    # Cascade: delete datafiles → experiments → sample_files → sample
    experiments = session.exec(select(Experiment).where(Experiment.sample_id == sample_id)).all()
    for exp in experiments:
        for df in session.exec(select(DataFile).where(DataFile.experiment_id == exp.id)).all():
            session.delete(df)
        session.delete(exp)
    for sf in session.exec(select(SampleFile).where(SampleFile.sample_id == sample_id)).all():
        session.delete(sf)
    session.delete(sample)
    session.commit()


# ── Sample files (photos) ──────────────────────────────────────────────────


@app.post(
    "/api/samples/{sample_id}/files", response_model=SampleFileRead, status_code=201
)
async def upload_sample_file(
    sample_id: int,
    file: UploadFile = FastAPIFile(...),
    _: None = Depends(require_write_auth),
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
    sample_id: int,
    file_id: int,
    _: None = Depends(require_write_auth),
    session: Session = Depends(get_session),
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
def create_experiment(
    data: ExperimentCreate,
    _: None = Depends(require_write_auth),
    session: Session = Depends(get_session),
):
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
        orientation=exp.orientation,
        files=[],
    )


@app.post(
    "/api/experiments/{exp_id}/files", response_model=DataFileRead, status_code=201
)
async def upload_file(
    exp_id: int,
    file: UploadFile = FastAPIFile(...),
    file_type: str = Query("data"),
    _: None = Depends(require_write_auth),
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
    exp_id: int,
    data: ExperimentCreate,
    _: None = Depends(require_write_auth),
    session: Session = Depends(get_session),
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
        orientation=exp.orientation,
        files=[
            DataFileRead(
                id=f.id, filename=f.filename, path=f.path, file_type=f.file_type
            )
            for f in files
        ],
    )


@app.delete("/api/experiments/{exp_id}", status_code=204)
def delete_experiment(
    exp_id: int,
    _: None = Depends(require_write_auth),
    session: Session = Depends(get_session),
):
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

    # Also clean up files not tracked in DataFile (meta.yaml, .log files, etc.)
    if exp.source_path:
        source = Path(exp.source_path)
        if source.is_dir():
            try:
                (source / "meta.yaml").unlink(missing_ok=True)
            except Exception:
                pass
            for f in source.iterdir():
                if f.is_file():
                    try:
                        f.unlink()
                    except Exception:
                        pass
            try:
                source.rmdir()  # succeeds only if now empty
            except Exception:
                pass

    session.delete(exp)
    session.commit()


@app.delete("/api/experiments/{exp_id}/files/{file_id}", status_code=204)
def delete_experiment_file(
    exp_id: int,
    file_id: int,
    _: None = Depends(require_write_auth),
    session: Session = Depends(get_session),
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
def trigger_scan(
    _: None = Depends(require_write_auth),
    session: Session = Depends(get_session),
):
    result = scanner.scan(session, _get_scan_roots())
    return result


@app.post("/api/scan/folder")
async def scan_uploaded_folder(
    files: list[UploadFile] = FastAPIFile(...),
    paths: list[str] = Form(...),
    _: None = Depends(require_write_auth),
    session: Session = Depends(get_session),
):
    """Accept an uploaded folder (files + their relative paths), save to DATA_DIR,
    then run the scanner on the saved directory."""
    if not files or len(files) != len(paths):
        raise HTTPException(400, "files and paths must be non-empty and equal in length")

    # Validate no path traversal
    for p in paths:
        if ".." in p.split("/"):
            raise HTTPException(400, f"Invalid path: {p}")

    # Root folder name is the first component of the first relative path
    root_name = paths[0].split("/")[0]
    target_dir = DATA_DIR_PATH / "samples" / root_name

    for file, rel_path in zip(files, paths):
        dest = DATA_DIR_PATH / "samples" / rel_path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(await file.read())

    result = scanner.scan(session, [target_dir])
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
    out: list[FileWithContext] = []

    for f, exp, s in rows:
        auto_mode = None
        if exp.type in {"ppms-vsm", "ppms-hc"}:
            try:
                from parsers.ppms import parse_dat, detect_mode

                abs_path = str(DATA_DIR_PATH / f.path)
                df = parse_dat(abs_path)
                auto_mode = detect_mode(df) if df else None
            except Exception:
                auto_mode = None

        out.append(
            FileWithContext(
                id=f.id,
                filename=f.filename,
                path=f.path,
                file_type=f.file_type,
                experiment_id=exp.id,
                exp_type=exp.type,
                sample_id=s.id,
                sample_name=s.name,
                auto_mode=auto_mode,
            )
        )

    return out


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


def _slugify(title: str) -> str:
    """Convert title to a safe filename slug."""
    # Remove special characters, replace spaces with hyphens
    slug = re.sub(r'[^\w\s-]', '', title).strip().lower()
    slug = re.sub(r'[\s-]+', '-', slug)
    # Limit length to avoid too long filenames
    return slug[:50] or 'untitled'


def _note_filename(note: Note) -> Path:
    """Generate filename for a note: {id}-{slug}.md."""
    slug = _slugify(note.title)
    return NOTES_DIR / f"{note.id}-{slug}.md"


def _write_note_file(note: Note) -> None:
    """Write note to markdown file with YAML frontmatter."""
    NOTES_DIR.mkdir(parents=True, exist_ok=True)

    # Format timestamps as ISO 8601
    created_at = note.created_at.isoformat() if note.created_at else ""
    updated_at = note.updated_at.isoformat() if note.updated_at else ""

    # Build markdown content with YAML frontmatter
    content = (
        "---\n"
        f"id: {note.id}\n"
        f"title: {note.title}\n"
        f"pinned: {str(note.pinned).lower()}\n"
        f"created_at: {created_at}\n"
        f"updated_at: {updated_at}\n"
        "---\n\n"
        f"{note.body}"
    )

    # Delete any existing files matching this note id to avoid stale files
    # (if title changed, slug changes so filename changes)
    pattern = f"{note.id}-*.md"
    for old_file in NOTES_DIR.glob(pattern):
        if old_file.exists():
            old_file.unlink()

    # Write new file
    filename = _note_filename(note)
    filename.write_text(content, encoding="utf-8")


def _delete_note_file(note_id: int) -> None:
    """Delete markdown file for a deleted note."""
    pattern = f"{note_id}-*.md"
    for old_file in NOTES_DIR.glob(pattern):
        if old_file.exists():
            old_file.unlink()


def _sync_all_notes_from_db(session: Session) -> None:
    """Sync all existing notes from database to markdown files on startup."""
    notes = session.exec(select(Note)).all()
    for note in notes:
        _write_note_file(note)


@app.get("/api/notes", response_model=list[NoteRead])
def list_notes(
    q: Optional[str] = Query(None),
    session: Session = Depends(get_session),
):
    stmt = select(Note)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(Note.title.like(like) | Note.body.like(like))
    return session.exec(stmt.order_by(Note.pinned.desc(), Note.updated_at.desc())).all()


@app.post("/api/notes", response_model=NoteRead, status_code=201)
def create_note(
    data: NoteCreate,
    _: None = Depends(require_write_auth),
    session: Session = Depends(get_session),
):
    now = _now()
    note = Note(
        title=data.title,
        body=data.body,
        pinned=data.pinned,
        created_at=now,
        updated_at=now,
    )
    session.add(note)
    session.commit()
    session.refresh(note)
    _write_note_file(note)
    return note


@app.get("/api/notes/{note_id}", response_model=NoteRead)
def get_note(note_id: int, session: Session = Depends(get_session)):
    note = session.get(Note, note_id)
    if not note:
        raise HTTPException(404, "Note not found")
    return note


@app.put("/api/notes/{note_id}", response_model=NoteRead)
def update_note(
    note_id: int,
    data: NoteUpdate,
    _: None = Depends(require_write_auth),
    session: Session = Depends(get_session),
):
    note = session.get(Note, note_id)
    if not note:
        raise HTTPException(404, "Note not found")
    if data.title is not None:
        note.title = data.title
    if data.body is not None:
        note.body = data.body
    if data.pinned is not None:
        note.pinned = data.pinned
    note.updated_at = _now()
    session.add(note)
    session.commit()
    session.refresh(note)
    _write_note_file(note)
    return note


@app.delete("/api/notes/{note_id}", status_code=204)
def delete_note(
    note_id: int,
    _: None = Depends(require_write_auth),
    session: Session = Depends(get_session),
):
    note = session.get(Note, note_id)
    if not note:
        raise HTTPException(404, "Note not found")
    session.delete(note)
    session.commit()
    _delete_note_file(note_id)
