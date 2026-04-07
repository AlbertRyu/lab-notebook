#!/usr/bin/env python3
"""Manual sync of existing notes from DB to markdown files"""

import os
import re
from pathlib import Path
from datetime import datetime

DATA_DIR_PATH = Path(os.environ.get("DATA_DIR", "/Users/yunxiaoliu/SyncDokumente/Projects/lab-notebook/data"))
NOTES_DIR = DATA_DIR_PATH / "notes"

def _slugify(title: str) -> str:
    """Convert title to a safe filename slug."""
    slug = re.sub(r'[^\w\s-]', '', title).strip().lower()
    slug = re.sub(r'[\s-]+', '-', slug)
    return slug[:50] or 'untitled'

def _write_note_file(note) -> None:
    """Write note to markdown file with YAML frontmatter."""
    NOTES_DIR.mkdir(parents=True, exist_ok=True)

    created_at = note.created_at.isoformat() if note.created_at else ""
    updated_at = note.updated_at.isoformat() if note.updated_at else ""

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

    pattern = f"{note.id}-*.md"
    for old_file in NOTES_DIR.glob(pattern):
        if old_file.exists():
            old_file.unlink()

    slug = _slugify(note.title)
    filename = NOTES_DIR / f"{note.id}-{slug}.md"
    filename.write_text(content, encoding="utf-8")
    print(f"Wrote: {filename.name}")

# Import and run
import sys
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from sqlmodel import Session, select
from database import engine
from models import Note

with Session(engine) as session:
    notes = session.exec(select(Note)).all()
    print(f"Found {len(notes)} notes in database...")
    for note in notes:
        _write_note_file(note)
    print(f"\nDone! All notes written to {NOTES_DIR}/")
