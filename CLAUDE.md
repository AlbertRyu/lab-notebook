# Lab Notebook — Claude Instructions

## What this project is

A self-hosted web app for a HOIP (Hybrid Organic-Inorganic Perovskite) condensed-matter physics lab. It replaces a Notion page as the central project hub, keeping all data local on their server. Studied compounds: Mn-PEA and the Mn-BA family (4Cl-, 4Br-, 4H-, 4F-, 4I-Mn-BA). Primary instruments: PPMS (VSM + Heat Capacity), PXRD, SCXRD, FMR, microscopy.

## Stack

- **Backend:** FastAPI + SQLite via SQLModel, Python 3.12
- **Frontend:** Vanilla HTML/CSS/JS — no build step, no framework
- **Runtime:** Docker (`docker-compose up --build`), host port 8100 → container 8000
- **DB path:** `/data/lab_notebook.db` (Docker volume, not in git)
- **Data dir:** `/data/` (Docker volume); raw sample files go in `/data/samples/`

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
- `AUTH_COOKIE_SECURE` — set `true` behind HTTPS
- `AUTH_TTL_SECONDS` — cookie TTL (default 28800 = 8 hours)

## Repository layout

```
backend/
  main.py          ← FastAPI app, all API routes
  models.py        ← SQLModel ORM + Pydantic schemas
  database.py      ← SQLite engine setup
  scanner.py       ← auto-scans DATA_DIR for sample folders
  parsers/
    ppms.py        ← .DAT parser (PPMS VSM/HC)
    pxrd.py        ← PXRD parser
    fmr.py         ← FMR parser
frontend/
  index.html       ← single-page shell; tabs injected by main.js
  css/             ← one CSS file per tab (base.css for globals)
  tabs/            ← HTML fragments loaded into #pages div
  js/              ← one JS file per tab; main.js handles tab switching + auth
  images/ppms/     ← 17 static PNG graphs (VSM/HC/phase diagrams per compound)
data/              ← Docker volume (not in git)
  lab_notebook.db
  samples/
  ppms_config.json ← PPMS representative graph config (server-persisted JSON)
```

## Architecture patterns

**Tab system:** Each tab is an HTML fragment in `frontend/tabs/`. `main.js` injects them into `#pages` and fires per-tab init functions. Each tab has its own `frontend/js/<tab>.js` and `frontend/css/<tab>.css`.

**Auth:** HMAC-signed cookie, 8-hour TTL. Read endpoints are public. Write operations use the `require_write_auth` FastAPI dependency (POST/PUT/DELETE). The frontend shows/hides edit controls based on the `/api/auth/me` response.

**PPMS config:** Compound card configuration (names, descriptions, image lists) is stored server-side as `/data/ppms_config.json`, not in the database — it's unstructured config, not relational data. Accessed via `GET/POST /api/ppms-config`.

**Frontend hot-reload:** `./frontend` is bind-mounted. HTML/CSS/JS edits take effect on browser refresh without rebuilding the Docker image.

## Key design decisions — do not undo these

- **No decorative banner** on the Overview tab (the blue gradient "ov-cover" was removed).
- **No Properties section** on Overview (PI/Affiliation/Start Date/Status removed).
- **PPMS config as JSON file**, not a DB table.
- **No JS framework or build tool** — keep it vanilla.

## Data model

| Table | Purpose |
|---|---|
| `sample` | name (unique), compound, synthesis_date, batch, box, crystal_size, notes |
| `experiment` | sample_id, type, exp_date, notes, source_path |
| `datafile` | experiment_id, filename, path (relative to DATA_DIR), file_type |
| `samplefile` | sample_id, filename, path, file_type (photos) |
| `note` | title, body, pinned, created_at, updated_at |

Experiment types: `ppms-vsm`, `ppms-hc`, `pxrd`, `sxrd`, `microscopy`, `fmr`

## Science context

- **Sample naming:** `{compound}-{batch}` e.g. `4Cl-Mn-BA - 5`
- **Measurement labels:** OOP = Out-of-Plane, IP = In-Plane, 2P5K = 2.5K base temp, FC/ZFC = Field-Cooled/Zero-Field-Cooled
- **Crystal structure:** 4Cl/4Br/4H → C1c1 Monoclinic (Polar); 4F/4I → Pbnm Orthorhombic (Non-polar)
- **CIF files** hosted externally at seafile.xiaomie-cloud.de
- **Images in `frontend/images/ppms/`:** 17 PNGs named `{compound}_{type}.png` — e.g. `MnPEA_MT.png`, `4Cl_HC.png`, `MnPEA_PhaseDiagram.png`
