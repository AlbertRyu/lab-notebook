from sqlmodel import SQLModel, Field, Relationship
from typing import Optional, List
from datetime import date as Date, datetime as Datetime


class Sample(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True, unique=True)
    compound: str
    synthesis_date: Optional[Date] = Field(default=None)
    batch: Optional[str] = Field(default=None)
    box: Optional[str] = Field(default=None)
    crystal_size: Optional[str] = Field(default=None)
    notes: Optional[str] = Field(default=None)

    experiments: List["Experiment"] = Relationship(back_populates="sample")
    sample_files: List["SampleFile"] = Relationship(back_populates="sample")


class Experiment(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    sample_id: int = Field(foreign_key="sample.id")
    type: str  # microscopy | pxrd | sxrd | ppms-vsm | ppms-hc | fmr
    exp_date: Optional[Date] = Field(default=None)
    notes: Optional[str] = Field(default=None)
    orientation: Optional[str] = Field(default=None)  # for ppms-vsm: "OOP", "IP", or custom text
    source_path: Optional[str] = Field(default=None, index=True)  # folder path, used for dedup on scan

    sample: Optional[Sample] = Relationship(back_populates="experiments")
    files: List["DataFile"] = Relationship(back_populates="experiment")


class SampleFile(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    sample_id: int = Field(foreign_key="sample.id")
    filename: str
    path: str  # relative to DATA_DIR
    file_type: str = Field(default="image")

    sample: Optional[Sample] = Relationship(back_populates="sample_files")


class DataFile(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    experiment_id: int = Field(foreign_key="experiment.id")
    filename: str
    path: str  # relative to DATA_DIR
    file_type: str  # image | data | screenshot

    experiment: Optional[Experiment] = Relationship(back_populates="files")


# ── Response schemas (no table=True) ──────────────────────────────────────


class SampleFileRead(SQLModel):
    id: int
    filename: str
    path: str
    file_type: str


class DataFileRead(SQLModel):
    id: int
    filename: str
    path: str
    file_type: str


class ExperimentRead(SQLModel):
    id: int
    sample_id: int
    type: str
    exp_date: Optional[Date]
    notes: Optional[str]
    orientation: Optional[str] = None
    files: List[DataFileRead] = []


class SampleRead(SQLModel):
    id: int
    name: str
    compound: str
    synthesis_date: Optional[Date]
    batch: Optional[str]
    box: Optional[str]
    crystal_size: Optional[str]
    notes: Optional[str]


class SampleDetail(SampleRead):
    experiments: List[ExperimentRead] = []
    sample_files: List[SampleFileRead] = []


class SampleCreate(SQLModel):
    name: str
    compound: str
    synthesis_date: Optional[Date] = None
    batch: Optional[str] = None
    box: Optional[str] = None
    crystal_size: Optional[str] = None
    notes: Optional[str] = None


class ExperimentCreate(SQLModel):
    sample_id: int
    type: str
    exp_date: Optional[Date] = None
    notes: Optional[str] = None
    orientation: Optional[str] = None


# ── Notes ──────────────────────────────────────────────────────────────────


class Note(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    body: str = Field(default="")
    pinned: bool = Field(default=False)
    created_at: Optional[Datetime] = Field(default=None)
    updated_at: Optional[Datetime] = Field(default=None)


class NoteRead(SQLModel):
    id: int
    title: str
    body: str
    pinned: bool = False
    created_at: Optional[Datetime]
    updated_at: Optional[Datetime]


class NoteCreate(SQLModel):
    title: str
    body: str = ""
    pinned: bool = False


class NoteUpdate(SQLModel):
    title: Optional[str] = None
    body: Optional[str] = None
    pinned: Optional[bool] = None


# ── Cross-sample file listing ──────────────────────────────────────────────


class FileWithContext(SQLModel):
    id: int
    filename: str
    path: str
    file_type: str
    experiment_id: int
    exp_type: str
    sample_id: int
    sample_name: str
    auto_mode: Optional[str] = None
