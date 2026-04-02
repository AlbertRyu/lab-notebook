import os
from sqlmodel import SQLModel, create_engine, Session
from sqlalchemy import text

DB_PATH = os.environ.get("DB_PATH", "/data/lab_notebook.db")
engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)


def create_db():
    # Import models here so their tables are registered in SQLModel.metadata
    import models  # noqa: F401

    SQLModel.metadata.create_all(engine)
    _migrate_note_pinned_column()


def _migrate_note_pinned_column():
    """Add note.pinned for existing databases created before this field existed."""
    with engine.connect() as conn:
        cols = conn.execute(text("PRAGMA table_info(note)")).fetchall()
        col_names = {row[1] for row in cols}
        if "pinned" not in col_names:
            conn.execute(
                text("ALTER TABLE note ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT 0")
            )
            conn.commit()


def get_session():
    with Session(engine) as session:
        yield session
