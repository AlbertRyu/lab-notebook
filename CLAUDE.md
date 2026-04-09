# Lab Notebook — Claude Instructions

## What this project is

A self-hosted web app for a HOIP (Hybrid Organic-Inorganic Perovskite) condensed-matter physics lab. It replaces a Notion page as the central project hub, keeping all data local on their server. Studied compounds: Mn-PEA and the Mn-BA family (4Cl-, 4Br-, 4H-, 4F-, 4I-Mn-BA). Primary instruments: PPMS (VSM + Heat Capacity), PXRD, SCXRD, FMR, microscopy.

## Stack

- **Backend:** FastAPI + SQLite via SQLModel, Python 3.12
- **Frontend:** Vanilla HTML/CSS/JS — no build step, no framework
- **Runtime:** Docker (`docker-compose up --build`), host port 8100 → container 8000
- **DB path:** `/data/lab_notebook.db` (Docker volume, not in git)
- **Data dir:** `/data/` (Docker volume); raw sample files go in `/data/samples/`, markdown notes in `/data/notes/`

## How to run

```bash
# First time / after backend changes:
docker compose up --build

# Frontend-only changes — no rebuild needed:
# Edit frontend/ files, then just refresh the browser.
# ./frontend is bind-mounted into the container.
```

Environment variables (see `docker-compose.yml`):

- `LAB_NOTEBOOK_PASSWORD` — login password
- `AUTH_SECRET` — HMAC signing key for the auth cookie
- `AUTH_COOKIE_SECURE` — set `true` behind HTTPS (default: false)
- `AUTH_TTL_SECONDS` — cookie TTL (default 28800 = 8 hours)
- `DATA_DIR` — data directory (default: /data)
- `SCAN_ROOTS` — colon-separated scan directories (default: /data/samples)

## Repository layout

```
backend/
  main.py          ← FastAPI app, all API routes
  models.py        ← SQLModel ORM + Pydantic schemas
  database.py      ← SQLite engine setup
  scanner.py       ← auto-scans DATA_DIR for sample folders
  parsers/
    __init__.py
    ppms.py        ← .DAT parser (PPMS VSM/HC)
    pxrd.py        ← PXRD/SCXRD parser
    fmr.py         ← FMR parser
frontend/
  index.html       ← single-page shell; tabs injected by main.js
  css/             ← one CSS file per tab (base.css for globals)
    base.css
    overview.css
    inventory.css
    graph.css
    viz.css
    notes.css
  tabs/            ← HTML fragments loaded into #pages div
    overview.html
    inventory.html
    graph.html
    viz.html
    notes.html
  js/              ← one JS file per tab; main.js handles tab switching + auth
    main.js
    overview.js
    inventory.js
    graph.js
    viz.js
    notes.js
  images/ppms/     ← 17 static PNG graphs (VSM/HC/phase diagrams per compound)
data/              ← Docker volume (not in git)
  lab_notebook.db
  samples/
  notes/           ← markdown notes files with YAML frontmatter
  ppms_config.json ← PPMS representative graph config (server-persisted JSON)
seed/              ← seed data for first run when samples dir is empty
CLAUDE.md
Dockerfile
docker-compose.yml
pyproject.toml      ← Python dependencies
sync_notes.py       ← notes synchronization script
vsm_visualizer.html ← standalone VSM visualizer
lab_notebook_summary.md
```

## Architecture patterns

**Tab system:** Each tab is an HTML fragment in `frontend/tabs/`. `main.js` injects them into `#pages` and fires per-tab init functions. Each tab has its own `frontend/js/<tab>.js` and `frontend/css/<tab>.css`.

**Current tabs:**

- `overview` — Main landing page with compound summary cards
- `inventory` — Sample/experiment management (create/edit/delete samples, experiments, upload files)
- `graph` — Single-experiment interactive visualization with Plotly
- `viz` — Cross-sample visualization: list all data files, select multiple, plot on same axes
- `notes` — Markdown notes management (create/edit/delete notes, search, pin)

**Auth:** HMAC-signed cookie, 8-hour TTL. Read endpoints are public. Write operations use the `require_write_auth` FastAPI dependency (POST/PUT/DELETE). The frontend shows/hides edit controls based on the `/api/auth/me` response.

**PPMS config:** Compound card configuration (names, descriptions, image lists) is stored server-side as `/data/ppms_config.json`, not in the database — it's unstructured config, not relational data. Accessed via `GET/POST /api/ppms-config`.

**Notes system:** Notes are stored both in the database and as markdown files in `/data/notes/` with YAML frontmatter for portability. Synced automatically on changes.

**Frontend hot-reload:** `./frontend` is bind-mounted. HTML/CSS/JS edits take effect on browser refresh without rebuilding the Docker image.

## Key design decisions — do not undo these

- **No decorative banner** on the Overview tab (the blue gradient "ov-cover" was removed).
- **No Properties section** on Overview (PI/Affiliation/Start Date/Status removed).
- **PPMS config as JSON file**, not a DB table.
- **No JS framework or build tool** — keep it vanilla.
- **Notes stored both in DB and as markdown files** — keep both sync'd.

## Data model

| Table | Purpose | Key Fields |
|---|---|---|
| `sample` | Sample metadata | name (unique), compound, synthesis_date, batch, box, crystal_size, notes |
| `experiment` | Experiment metadata | sample_id, type, exp_date, notes, **orientation**, **mass**, source_path |
| `datafile` | Experiment data/file references | experiment_id, filename, path (relative to DATA_DIR), file_type |
| `samplefile` | Sample photo references | sample_id, filename, path, file_type |
| `note` | Markdown notes | title, body, pinned, created_at, updated_at |

Experiment types: `ppms-vsm`, `ppms-hc`, `pxrd`, `sxrd`, `microscopy`, `fmr`

New experiment fields:

- `orientation` — For PPMS-VSM: "OOP" (Out-of-Plane), "IP" (In-Plane), or custom text
- `mass` — Sample mass in mg for PPMS-VSM/HC calculations

## API Routes

**Auth:**

- `GET /api/auth/me` — Check auth status
- `POST /api/auth/login` — Login
- `POST /api/auth/logout` — Logout

**PPMS config:**

- `GET /api/ppms-config` — Get compound card config
- `POST /api/ppms-config` — Save compound card config

**Samples:**

- `GET /api/samples` — List all samples (with filtering)
- `GET /api/samples/{id}` — Get sample with experiments/files
- `POST /api/samples` — Create sample
- `PUT /api/samples/{id}` — Update sample
- `DELETE /api/samples/{id}` — Delete sample
- `POST /api/samples/{id}/files` — Upload sample photo
- `DELETE /api/samples/{id}/files/{id}` — Delete sample photo

**Experiments:**

- `POST /api/experiments` — Create experiment
- `GET /api/experiments/{id}` — Get experiment details
- `PUT /api/experiments/{id}` — Update experiment
- `DELETE /api/experiments/{id}` — Delete experiment
- `GET /api/experiments/{id}/data` — Get parsed experiment data for plotting
- `POST /api/experiments/{id}/files` — Upload experiment file
- `DELETE /api/experiments/{id}/files/{id}` — Delete experiment file

**Scanning:**

- `POST /api/scan` — Trigger full scan of all scan roots
- `POST /api/scan/folder` — Accept and scan uploaded folder

**Filters:**

- `GET /api/filters` — Get filter options (compounds, batches, boxes)

**Visualization:**

- `GET /api/files` — List all data files with context
- `POST /api/plot` — Get Plotly traces for multi-file plotting

**Notes:**

- `GET /api/notes` — List notes (with optional search)
- `GET /api/notes/{id}` — Get note
- `POST /api/notes` — Create note
- `PUT /api/notes/{id}` — Update note
- `DELETE /api/notes/{id}` — Delete note

**Static files:**

- `/files/*` — Serve files from DATA_DIR
- `/static/*` — Serve frontend static files

## Science context

- **Sample naming:** `{compound}-{batch}` e.g. `4Cl-Mn-BA - 5`
- **Measurement labels:** OOP = Out-of-Plane, IP = In-Plane, 2P5K = 2.5K base temp, FC/ZFC = Field-Cooled/Zero-Field-Cooled
- **Crystal structure:** 4Cl/4Br/4H → C1c1 Monoclinic (Polar); 4F/4I → Pbnm Orthorhombic (Non-polar)
- **CIF files** hosted externally at seafile.xiaomie-cloud.de
- **Images in `frontend/images/ppms/`:** 17 PNGs named `{compound}_{type}.png` — e.g. `MnPEA_MT.png`, `4Cl_HC.png`, `MnPEA_PhaseDiagram.png`
