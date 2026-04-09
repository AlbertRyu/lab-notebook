# Migration Plan: Reorganize data/samples/ folder structure

## Goal

Reorganize `/data/samples/` from the current ad-hoc layout into a clean hierarchy:

```
/data/samples/{compound}/{sample.name}/{exp_type}/[orientation_subfolder]/
```

### Structure rules
- **ppms-vsm with orientation** → `{compound}/{sample.name}/ppms-vsm/{orientation_folder}/`
  - `orientation_folder` = last path component of the current `experiment.source_path`
  - Preserves existing folder names: `ip`, `oop`, `IP`, `OOP`, `ip-second`, `screening`
- **All other types** (ppms-hc, pxrd, …) → `{compound}/{sample.name}/{exp_type}/`

---

## DB state at time of planning (2026-04-09)

### Samples
```
id  | name                  | compound
----+-----------------------+----------
2   | 4Cl-Mn-BA - HC2       | 4Cl-Mn-BA
3   | 4Cl-Mn-BA - 1         | 4Cl-Mn-BA
4   | 4Cl-Mn-BA - 2         | 4Cl-Mn-BA
5   | 4Cl-Mn-BA - 3         | 4Cl-Mn-BA
6   | 4Cl-Mn-BA - 4         | 4Cl-Mn-BA
7   | 4Cl-Mn-BA - 5         | 4Cl-Mn-BA
9   | 4Cl-Mn-BA - HC1       | 4Cl-Mn-BA
10  | 4Br-Mn-BA - HC1       | 4Br-Mn-BA
11  | 4Br-Mn-BA - 1         | 4Br-Mn-BA
12  | 4Br-Mn-BA - 2         | 4Br-Mn-BA
13  | 4Br-Mn-BA - 3         | 4Br-Mn-BA
14  | 4Br-Mn-BA - 4         | 4Br-Mn-BA
15  | 4H-Mn-BA - HC1        | 4H-Mn-BA
16  | 4H-Mn-BA - 5          | 4H-Mn-BA
17  | 4H-Mn-BA - 4          | 4H-Mn-BA
18  | 4H-Mn-BA - 6          | 4H-Mn-BA
19  | 4H-Mn-BA - 1          | 4H-Mn-BA
20  | 4H-Mn-BA - 2          | 4H-Mn-BA
21  | 4I-Mn-BA - 1          | 4I-Mn-BA
22  | 4I-Mn-BA - 2          | 4I-Mn-BA
23  | 4I-Mn-BA - 3          | 4I-Mn-BA
24  | 4I-Mn-BA - 4          | 4I-Mn-BA
25  | 4F-Mn-BA - 1          | 4F-Mn-BA
26  | 4F-Mn-BA - 2          | 4F-Mn-BA
28  | 4Cl-Mn-BA - Oriented  | 4Cl-Mn-BA
29  | Random Sample         | 4Br-Mn-BA
30  | 4Cl-Mn-BA - 6         | 4Cl-Mn-BA
```

### Complete experiment move table

| Exp ID | Type | Sample | Old path (rel. to data/samples/) | New path |
|--------|------|--------|----------------------------------|----------|
| 15 | ppms-vsm | 4Br-Mn-BA - 1 | 4Br-Mn-BA/VSM/Sample1/ip | 4Br-Mn-BA/4Br-Mn-BA - 1/ppms-vsm/ip |
| 16 | ppms-vsm | 4Br-Mn-BA - 1 | 4Br-Mn-BA/VSM/Sample1/oop | 4Br-Mn-BA/4Br-Mn-BA - 1/ppms-vsm/oop |
| 17 | ppms-vsm | 4Br-Mn-BA - 2 | 4Br-Mn-BA/VSM/Sample2_inOil/ip | 4Br-Mn-BA/4Br-Mn-BA - 2/ppms-vsm/ip |
| 18 | ppms-vsm | 4Br-Mn-BA - 2 | 4Br-Mn-BA/VSM/Sample2_inOil/oop | 4Br-Mn-BA/4Br-Mn-BA - 2/ppms-vsm/oop |
| 19 | ppms-vsm | 4Br-Mn-BA - 3 | 4Br-Mn-BA/VSM/Sample3-inOil/oop | 4Br-Mn-BA/4Br-Mn-BA - 3/ppms-vsm/oop |
| 20 | ppms-vsm | 4Br-Mn-BA - 4 | 4Br-Mn-BA/VSM/Sample4-inOil/oop | 4Br-Mn-BA/4Br-Mn-BA - 4/ppms-vsm/oop |
| 14 | ppms-hc  | 4Br-Mn-BA - HC1 | 4Br-Mn-BA/HeatCapacity/HC1 | 4Br-Mn-BA/4Br-Mn-BA - HC1/ppms-hc |
| 3  | ppms-vsm | 4Cl-Mn-BA - 1 | 4Cl-Mn-BA/VSM/Sample1/ip | 4Cl-Mn-BA/4Cl-Mn-BA - 1/ppms-vsm/ip |
| 4  | ppms-vsm | 4Cl-Mn-BA - 1 | 4Cl-Mn-BA/VSM/Sample1/oop | 4Cl-Mn-BA/4Cl-Mn-BA - 1/ppms-vsm/oop |
| 5  | ppms-vsm | 4Cl-Mn-BA - 2 | 4Cl-Mn-BA/VSM/Sample2/ip | 4Cl-Mn-BA/4Cl-Mn-BA - 2/ppms-vsm/ip |
| 6  | ppms-vsm | 4Cl-Mn-BA - 2 | 4Cl-Mn-BA/VSM/Sample2/oop | 4Cl-Mn-BA/4Cl-Mn-BA - 2/ppms-vsm/oop |
| 7  | ppms-vsm | 4Cl-Mn-BA - 3 | 4Cl-Mn-BA/VSM/Sample3-oil/OOP | 4Cl-Mn-BA/4Cl-Mn-BA - 3/ppms-vsm/OOP |
| 8  | ppms-vsm | 4Cl-Mn-BA - 4 | 4Cl-Mn-BA/VSM/Sample4-oil/OOP | 4Cl-Mn-BA/4Cl-Mn-BA - 4/ppms-vsm/OOP |
| 9  | ppms-vsm | 4Cl-Mn-BA - 5 | 4Cl-Mn-BA/VSM/Sample5-oil/OOP | 4Cl-Mn-BA/4Cl-Mn-BA - 5/ppms-vsm/OOP |
| 13 | ppms-hc  | 4Cl-Mn-BA - HC1 | 4Cl-Mn-BA/HeatCapcity/HC1 | 4Cl-Mn-BA/4Cl-Mn-BA - HC1/ppms-hc |
| 2  | ppms-hc  | 4Cl-Mn-BA - HC2 | 4Cl-Mn-BA/HeatCapcity/HC2 | 4Cl-Mn-BA/4Cl-Mn-BA - HC2/ppms-hc |
| 44 | ppms-vsm | 4Cl-Mn-BA - Oriented | 4Cl-Mn-BA/VSM/oriented_sample/IP | 4Cl-Mn-BA/4Cl-Mn-BA - Oriented/ppms-vsm/IP |
| 45 | ppms-vsm | 4Cl-Mn-BA - Oriented | 4Cl-Mn-BA/VSM/oriented_sample/OOP | 4Cl-Mn-BA/4Cl-Mn-BA - Oriented/ppms-vsm/OOP |
| 37 | ppms-vsm | 4F-Mn-BA - 1 | 4F-Mn-BA/Sample1/ip | 4F-Mn-BA/4F-Mn-BA - 1/ppms-vsm/ip |
| 38 | ppms-vsm | 4F-Mn-BA - 1 | 4F-Mn-BA/Sample1/ip-second | 4F-Mn-BA/4F-Mn-BA - 1/ppms-vsm/ip-second |
| 39 | ppms-vsm | 4F-Mn-BA - 1 | 4F-Mn-BA/Sample1/oop | 4F-Mn-BA/4F-Mn-BA - 1/ppms-vsm/oop |
| 40 | ppms-vsm | 4F-Mn-BA - 2 | 4F-Mn-BA/Sample2/ip | 4F-Mn-BA/4F-Mn-BA - 2/ppms-vsm/ip |
| 27 | ppms-vsm | 4H-Mn-BA - 1 | 4H-Mn-BA/VSM/sample1/ip | 4H-Mn-BA/4H-Mn-BA - 1/ppms-vsm/ip |
| 28 | ppms-vsm | 4H-Mn-BA - 1 | 4H-Mn-BA/VSM/sample1/oop | 4H-Mn-BA/4H-Mn-BA - 1/ppms-vsm/oop |
| 29 | ppms-vsm | 4H-Mn-BA - 2 | 4H-Mn-BA/VSM/sample2/ip | 4H-Mn-BA/4H-Mn-BA - 2/ppms-vsm/ip |
| 30 | ppms-vsm | 4H-Mn-BA - 2 | 4H-Mn-BA/VSM/sample2/oop | 4H-Mn-BA/4H-Mn-BA - 2/ppms-vsm/oop |
| 23 | ppms-vsm | 4H-Mn-BA - 4 | 4H-Mn-BA/VSM/sample-4-inOil/ip | 4H-Mn-BA/4H-Mn-BA - 4/ppms-vsm/ip |
| 24 | ppms-vsm | 4H-Mn-BA - 4 | 4H-Mn-BA/VSM/sample-4-inOil/oop | 4H-Mn-BA/4H-Mn-BA - 4/ppms-vsm/oop |
| 25 | ppms-vsm | 4H-Mn-BA - 4 | 4H-Mn-BA/VSM/sample-4-inOil/screening | 4H-Mn-BA/4H-Mn-BA - 4/ppms-vsm/screening |
| 22 | ppms-vsm | 4H-Mn-BA - 5 | 4H-Mn-BA/VSM/Sample-5-inOil/oop | 4H-Mn-BA/4H-Mn-BA - 5/ppms-vsm/oop |
| 26 | ppms-vsm | 4H-Mn-BA - 6 | 4H-Mn-BA/VSM/sample-6-inOil/oop | 4H-Mn-BA/4H-Mn-BA - 6/ppms-vsm/oop |
| 21 | ppms-hc  | 4H-Mn-BA - HC1 | 4H-Mn-BA/HeatCapacity/HC1 | 4H-Mn-BA/4H-Mn-BA - HC1/ppms-hc |
| 31 | ppms-vsm | 4I-Mn-BA - 1 | 4I-Mn-BA/Sample1-inOil/oop | 4I-Mn-BA/4I-Mn-BA - 1/ppms-vsm/oop |
| 32 | ppms-vsm | 4I-Mn-BA - 2 | 4I-Mn-BA/Sample2-inOil/oop | 4I-Mn-BA/4I-Mn-BA - 2/ppms-vsm/oop |
| 33 | ppms-vsm | 4I-Mn-BA - 3 | 4I-Mn-BA/Sample3-inMixSolvent/oop | 4I-Mn-BA/4I-Mn-BA - 3/ppms-vsm/oop |
| 35 | ppms-vsm | 4I-Mn-BA - 4 | 4I-Mn-BA/Sample4/ip | 4I-Mn-BA/4I-Mn-BA - 4/ppms-vsm/ip |
| 36 | ppms-vsm | 4I-Mn-BA - 4 | 4I-Mn-BA/Sample4/oop | 4I-Mn-BA/4I-Mn-BA - 4/ppms-vsm/oop |
| 34 | pxrd     | 4I-Mn-BA - 4 | 4I-Mn-BA/Sample4/XRD | 4I-Mn-BA/4I-Mn-BA - 4/pxrd |

---

## Script to write: migrate_folders.py

Run from repo root:
```bash
python migrate_folders.py          # dry run first (just prints, touches nothing)
python migrate_folders.py --execute  # actually moves files and updates DB
```

### Script logic

```
HOST_DATA   = ./data
CONTAINER_DATA = /data   (how paths are stored in DB)
DB          = ./data/lab_notebook.db
```

For each row in `experiment JOIN sample`:
1. Compute `new_source_path` (container form):
   - if `type == ppms-vsm` and `orientation != NULL`: `/data/samples/{compound}/{sample.name}/ppms-vsm/{last_folder}/`
   - else: `/data/samples/{compound}/{sample.name}/{type}/`
   - where `last_folder` = `Path(source_path).name`
2. Translate old and new paths to host filesystem
3. If old == new → skip (already correct)
4. If old not on disk → warn and skip
5. If new already exists → warn and skip
6. `new.parent.mkdir(parents=True, exist_ok=True)`
7. `shutil.move(str(old_host), str(new_host))`
8. `UPDATE experiment SET source_path = new_source_path WHERE id = exp_id`
9. For each `datafile` in this experiment: replace old prefix with new prefix in `path`

After all moves:
- Walk `data/samples/` and `rmdir` any now-empty subdirectories (bottom-up)
- Print report: N moved, N DB rows updated, N dirs removed, list of orphan leftovers

### DB tables to update
- `experiment.source_path` — absolute container path e.g. `/data/samples/...`
- `datafile.path` — relative path e.g. `samples/...` (no leading slash)

### Orphan folders (not in DB, will NOT be moved by script)
These will remain after migration and should be reviewed manually:
- `4Cl-Mn-BA/VSM/oriented_sample/graphs`
- `4Cl-Mn-BA/VSM/Sample3-oil/Images`
- `4F-Mn-BA/Sample2/oop`
- `4H-Mn-BA/VSM/d10-Sample`
- `4H-Mn-BA/VSM/sample3(ScreeningBeforeHCMay14th)`
- `4I-Mn-BA/SamplePIC`

---

## After migration: update backend/main.py

The two upload handlers already use the new path scheme (updated in a prior session):
- `upload_sample_file`: `DATA_DIR_PATH / "samples" / sample.compound / sample.name / "photos"`
- `upload_experiment_file`: `DATA_DIR_PATH / "samples" / sample.compound / sample.name / exp.type`

However, for VSM with orientation, new uploads will go to `ppms-vsm/` (no orientation subfolder). If orientation-based subfoldering is desired for new uploads too, `upload_experiment_file` should be updated:

```python
# For ppms-vsm with orientation, add orientation subfolder
if exp.type == "ppms-vsm" and exp.orientation:
    save_dir = DATA_DIR_PATH / "samples" / sample.compound / sample.name / exp.type / exp.orientation
else:
    save_dir = DATA_DIR_PATH / "samples" / sample.compound / sample.name / exp.type
```
