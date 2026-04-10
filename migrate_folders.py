"""
Migration script: reorganize data/samples/ to
  {compound}/{sample.name}/{exp_type}/[orientation_subfolder]/

Run from repo root:
  python migrate_folders.py           # dry run (prints only)
  python migrate_folders.py --execute # moves files + updates DB
"""

import shutil
import sqlite3
import sys
from pathlib import Path

REPO_ROOT      = Path(__file__).parent
HOST_DATA      = REPO_ROOT / "data"
CONTAINER_DATA = Path("/data")
DB_PATH        = HOST_DATA / "lab_notebook.db"
SAMPLES_HOST   = HOST_DATA / "samples"

EXECUTE = "--execute" in sys.argv


def c2h(p: str) -> Path:
    """Container path (/data/...) → host path."""
    return HOST_DATA / Path(p).relative_to(CONTAINER_DATA)


def h2c(p: Path) -> str:
    """Host path → container path (/data/...)."""
    return (CONTAINER_DATA / p.relative_to(HOST_DATA)).as_posix()


def new_source_path(exp_type: str, orientation, source_path: str,
                    compound: str, sample_name: str) -> str:
    last_folder = Path(source_path).name
    base = f"/data/samples/{compound}/{sample_name}"
    if exp_type == "ppms-vsm" and orientation:
        return f"{base}/ppms-vsm/{last_folder}"
    else:
        return f"{base}/{exp_type}"


def main():
    con = sqlite3.connect(DB_PATH)
    rows = con.execute("""
        SELECT e.id, e.type, e.orientation, e.source_path,
               s.name, s.compound
        FROM experiment e
        JOIN sample s ON e.sample_id = s.id
        ORDER BY s.compound, s.name, e.type, e.orientation
    """).fetchall()

    moves_done = 0
    db_rows_updated = 0
    skipped = []

    for exp_id, exp_type, orientation, source_path, sample_name, compound in rows:
        new_sp = new_source_path(exp_type, orientation, source_path, compound, sample_name)

        if source_path == new_sp:
            continue  # already correct

        old_host = c2h(source_path)
        new_host = c2h(new_sp)

        if not old_host.exists():
            skipped.append(f"  MISSING  {old_host.relative_to(SAMPLES_HOST)}")
            continue

        if new_host.exists():
            skipped.append(f"  EXISTS   {new_host.relative_to(SAMPLES_HOST)}  (target already present)")
            continue

        print(f"  {'MOVE' if EXECUTE else 'WOULD MOVE'}  "
              f"{old_host.relative_to(SAMPLES_HOST)}")
        print(f"           → {new_host.relative_to(SAMPLES_HOST)}")

        if EXECUTE:
            new_host.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(old_host), str(new_host))
            moves_done += 1

            # Update experiment.source_path
            con.execute("UPDATE experiment SET source_path = ? WHERE id = ?",
                        (new_sp, exp_id))
            db_rows_updated += 1

            # Update datafile.path (relative, no leading slash)
            old_rel = source_path.lstrip("/")   # data/samples/...  → wait, source_path is /data/samples/...
            # datafile.path stores e.g. "samples/4Br-Mn-BA/VSM/..."
            old_df_prefix = "/".join(source_path.lstrip("/").split("/")[1:])  # strip "data/"
            new_df_prefix = "/".join(new_sp.lstrip("/").split("/")[1:])
            df_rows = con.execute(
                "SELECT id, path FROM datafile WHERE experiment_id = ?", (exp_id,)
            ).fetchall()
            for df_id, df_path in df_rows:
                if df_path.startswith(old_df_prefix):
                    new_df_path = new_df_prefix + df_path[len(old_df_prefix):]
                    con.execute("UPDATE datafile SET path = ? WHERE id = ?",
                                (new_df_path, df_id))
                    db_rows_updated += 1

    if EXECUTE:
        con.commit()

    # Clean up empty intermediate dirs (bottom-up)
    dirs_removed = 0
    if EXECUTE:
        for d in sorted(SAMPLES_HOST.rglob("*"), reverse=True):
            if d.is_dir() and d != SAMPLES_HOST:
                try:
                    d.rmdir()
                    print(f"  RMDIR    {d.relative_to(SAMPLES_HOST)}")
                    dirs_removed += 1
                except OSError:
                    pass  # not empty

    con.close()

    print()
    if skipped:
        print("Skipped:")
        for s in skipped:
            print(s)
        print()

    if EXECUTE:
        print(f"Done. {moves_done} folders moved, {db_rows_updated} DB rows updated, "
              f"{dirs_removed} empty dirs removed.")
    else:
        print("Dry run complete. Run with --execute to apply.")


if __name__ == "__main__":
    main()
