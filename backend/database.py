import os
from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy import text

DB_PATH = os.environ.get("DB_PATH", "/data/lab_notebook.db")
engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)


def create_db():
    # Import models here so their tables are registered in SQLModel.metadata
    import models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    _drop_note_table()
    _migrate_experiment_source_path()


def _drop_note_table():
    """The note table was retired when notes moved to filesystem-only storage.
    Drop it from any pre-existing database so it doesn't show up in tooling."""
    with engine.connect() as conn:
        conn.execute(text("DROP TABLE IF EXISTS note"))
        conn.commit()


def _migrate_experiment_source_path():
    """Add experiment.source_path for databases created before this field existed."""
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(experiment)")).fetchall()
        col_names = {row[1] for row in cols}
        if "source_path" not in col_names:
            conn.execute(text("ALTER TABLE experiment ADD COLUMN source_path TEXT"))
            conn.commit()


def get_session():
    with Session(engine) as session:
        yield session
