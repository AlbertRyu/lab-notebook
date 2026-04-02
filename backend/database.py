import os
from sqlmodel import SQLModel, create_engine, Session

DB_PATH = os.environ.get("DB_PATH", "/data/lab_notebook.db")
engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)


def create_db():
    # Import models here so their tables are registered in SQLModel.metadata
    import models  # noqa: F401
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
