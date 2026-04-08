#!/usr/bin/env python3
"""Import split experiment log from Experiment_Log into the Notes system.

Parses a single markdown file with multiple dated entries, splits into individual
daily_log notes, migrates images, and adds them to the database.
"""

import os
import re
import shutil
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional

import locale
locale.setlocale(locale.LC_TIME, 'en_US.UTF-8')

# Environment setup
BASE_DIR = Path(__file__).parent.parent
DATA_DIR_PATH = Path(os.environ.get("DATA_DIR", BASE_DIR / "data"))
NOTES_DIR = DATA_DIR_PATH / "notes"
ASSETS_DIR = NOTES_DIR / "assets" / "experiment-log"
SOURCE_MD = BASE_DIR / "Experiment_Log" / "Experiment Log 31a926cb73558004809ef2b2524613b5.md"
SOURCE_IMAGES_DIR = BASE_DIR / "Experiment_Log" / "Experiment Log"

# Add backend to path
import sys
sys.path.insert(0, str(BASE_DIR / "backend"))

from sqlmodel import Session, engine
from database import engine
from models import Note

# Import the _write_note_file function from main by reading it dynamically
# We'll replicate its functionality here to keep things clean

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
        f"note_type: {note.note_type}\n"
        f"pinned: {str(note.pinned).lower()}\n"
        f"created_at: {created_at}\n"
        f"updated_at: {updated_at}\n"
        f"log_date: {note.log_date or ''}\n"
        f"next_steps: {json.dumps(note.next_steps) if note.next_steps else 'null'}\n"
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

# Parsing logic

DATE_PATTERN = re.compile(
    r'^('
    r'(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,\s+\d{4}'
    r'|'
    r'(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d+,?\s+\d{4}'
    r'|'
    r'(?:\w+\s+\d+,\s+\d{4})\s*[-–]\s*(?:\w+\s+\d+,\s+\d{4})'
    r')\s*$',
    re.MULTILINE
)

def parse_date(date_str: str) -> Optional[str]:
    """Parse human date like "March 6, 2026" to YYYY-MM-DD. For ranges, take first day."""
    # Handle ranges
    if ' - ' in date_str or '–' in date_str:
        date_str = date_str.split(' - ')[0].split('–')[0].strip()

    # Clean up
    date_str = re.sub(r'[,\s]+$', '', date_str)

    for fmt in [
        "%B %d, %Y",
        "%B %d %Y",
        "%B %d,%Y",
    ]:
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None

def split_into_entries(content: str) -> List[Dict]:
    """Split the full markdown content into individual entries by date headers."""
    # Find all date matches
    matches = list(DATE_PATTERN.finditer(content))
    if not matches:
        return []

    entries = []

    for i, match in enumerate(matches):
        start_idx = match.start()
        end_idx = matches[i+1].start() if i + 1 < len(matches) else len(content)

        date_str = match.group().strip()
        entry_content = content[start_idx:end_idx].strip()
        parsed_date = parse_date(date_str)

        if not parsed_date:
            print(f"Warning: Could not parse date: {date_str} — skipping")
            continue

        entries.append({
            "date_str": date_str,
            "log_date": parsed_date,
            "content": entry_content,
        })

    return entries

def fix_image_links(content: str) -> str:
    """Update image links to point to the new location in /files/notes/assets/experiment-log/."""
    # Various forms:
    # ![alt](Experiment%20Log/filename.png)
    # ![alt](Experiment Log/filename.png)
    # ![alt](img260306-1.jpg) when already in same dir

    def replace_link(match):
        alt = match.group(1)
        path = match.group(2)
        # Extract filename from path
        filename = Path(path).name
        # URL encode spaces
        filename_encoded = filename.replace(' ', '%20')
        new_path = f"/files/notes/assets/experiment-log/{filename_encoded}"
        return f"![{alt}]({new_path})"

    # Match any markdown image link
    image_pattern = re.compile(r'!\[(.*?)\]\((.*?)\)')
    return image_pattern.sub(replace_link, content)

def copy_images():
    """Copy all images from source to assets directory."""
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    copied = 0
    skipped = 0

    for img_path in SOURCE_IMAGES_DIR.iterdir():
        if img_path.name.startswith('.'):
            continue
        if img_path.is_dir():
            continue
        # Check if it's an image
        ext = img_path.suffix.lower()
        if ext not in ['.jpg', '.jpeg', '.png', '.gif', '.heic', '.heif']:
            continue

        dest_path = ASSETS_DIR / img_path.name
        if not dest_path.exists():
            shutil.copy2(img_path, dest_path)
            print(f"Copied image: {img_path.name}")
            copied += 1
        else:
            skipped += 1

    print(f"\nImage copy complete: {copied} copied, {skipped} already existed")
    return copied + skipped

def main():
    # Read source file
    if not SOURCE_MD.exists():
        print(f"Error: Source file not found: {SOURCE_MD}")
        sys.exit(1)

    content = SOURCE_MD.read_text(encoding='utf-8')
    entries = split_into_entries(content)

    if not entries:
        print("No dated entries found. Exiting.")
        sys.exit(0)

    print(f"Found {len(entries)} dated entries:")
    for e in entries:
        print(f"  - {e['log_date']} → {e['date_str']}")

    # Preview first entry
    print("\nFirst entry preview (first 500 chars):")
    first = entries[0]
    preview = fix_image_links(first['content'])
    print(preview[:500] + "..." if len(preview) > 500 else preview)

    # Confirm
    print(f"\nReady to create {len(entries)} new daily_log notes in the database.")
    response = input("Continue? (y/N): ")
    if response.lower() not in ['y', 'yes']:
        print("Aborted.")
        sys.exit(0)

    # Copy images
    print("\nCopying images...")
    total_images = copy_images()
    print(f"Total images available: {total_images}")

    # Create notes in database
    from datetime import datetime as dt, timezone
    import json

    created_count = 0

    with Session(engine) as session:
        for entry in entries:
            body = entry['content']
            body = fix_image_links(body)

            title = f"Log {entry['log_date']}"
            now = dt.now(timezone.utc)

            note = Note(
                title=title,
                body=body,
                pinned=False,
                note_type="daily_log",
                tags=None,
                status=None,
                linked_sample_ids=None,
                log_date=entry['log_date'],
                next_steps=None,
                created_at=now,
                updated_at=now,
            )

            session.add(note)
            session.commit()
            session.refresh(note)

            # Replicate what backend does - write the markdown file
            # We need to do this here because we're running outside the API
            # but we need to follow the same pattern
            NOTES_DIR.mkdir(parents=True, exist_ok=True)

            created_at = note.created_at.isoformat() if note.created_at else ""
            updated_at = note.updated_at.isoformat() if note.updated_at else ""

            file_content = (
                "---\n"
                f"id: {note.id}\n"
                f"title: {note.title}\n"
                f"note_type: {note.note_type}\n"
                f"pinned: {str(note.pinned).lower()}\n"
                f"created_at: {created_at}\n"
                f"updated_at: {updated_at}\n"
                f"log_date: {note.log_date or ''}\n"
                "---\n\n"
                f"{note.body}"
            )

            pattern = f"{note.id}-*.md"
            for old_file in NOTES_DIR.glob(pattern):
                if old_file.exists():
                    old_file.unlink()

            slug = _slugify(note.title)
            filename = NOTES_DIR / f"{note.id}-{slug}.md"
            filename.write_text(file_content, encoding="utf-8")

            created_count += 1
            print(f"Created note {note.id}: {title}")

    print(f"\n✅ Import complete! Created {created_count} notes.")
    print("\nNext steps:")
    print("1. Go to the Notes tab in your browser")
    print("2. Click 'Log' filter to see only imported daily logs")
    print("3. Verify images load correctly and dates are set")

if __name__ == "__main__":
    main()
