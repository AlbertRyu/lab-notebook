#!/usr/bin/env python3
"""Split experiment log into individual markdown files with YAML frontmatter.

Output files go to split_logs/ directory. Then you can upload them one-by-one
via the "Upload MD" button in the Notes UI.
"""

import os
import re
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional

BASE_DIR = Path(__file__).parent
SOURCE_MD = BASE_DIR / "Experiment_Log" / "Experiment Log 31a926cb73558004809ef2b2524613b5.md"
OUTPUT_DIR = BASE_DIR / "split_logs"

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
    if ' - ' in date_str or '–' in date_str:
        date_str = date_str.split(' - ')[0].split('–')[0].strip()
    date_str = re.sub(r'[,\s]+$', '', date_str)
    for fmt in ["%B %d, %Y", "%B %d %Y", "%B %d,%Y"]:
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.strftime("%Y-%m-%d"), date_str
        except ValueError:
            continue
    return None, date_str

def split_into_entries(content: str) -> List[Dict]:
    matches = list(DATE_PATTERN.finditer(content))
    if not matches:
        return []
    entries = []
    for i, match in enumerate(matches):
        start_idx = match.start()
        end_idx = matches[i+1].start() if i + 1 < len(matches) else len(content)
        date_str = match.group().strip()
        entry_content = content[start_idx:end_idx].strip()
        log_date, display_date = parse_date(date_str)
        if not log_date:
            print(f"Warning: Could not parse date: {date_str}")
            log_date = "unknown"
        entries.append({
            "date_str": display_date,
            "log_date": log_date,
            "content": entry_content,
        })
    return entries

def fix_image_links(content: str) -> str:
    """Update image links to point to the final location after upload."""
    def replace_link(match):
        alt = match.group(1)
        path = match.group(2)
        filename = Path(path).name
        filename_encoded = filename.replace(' ', '%20')
        new_path = f"/files/notes/assets/experiment-log/{filename_encoded}"
        return f"![{alt}]({new_path})"
    image_pattern = re.compile(r'!\[(.*?)\]\((.*?)\)')
    return image_pattern.sub(replace_link, content)

def main():
    OUTPUT_DIR.mkdir(exist_ok=True)
    content = SOURCE_MD.read_text(encoding='utf-8')
    entries = split_into_entries(content)
    print(f"Found {len(entries)} entries. Writing to {OUTPUT_DIR}/...")

    for entry in entries:
        body = fix_image_links(entry['content'])
        title = f"Log {entry['log_date']}"
        slug = title.lower().replace(' ', '-')
        filename = OUTPUT_DIR / f"{slug}.md"

        yaml_frontmatter = f"""---
title: {title}
note_type: daily_log
pinned: false
log_date: {entry['log_date']}
---

"""
        full_content = yaml_frontmatter + body
        filename.write_text(full_content, encoding='utf-8')
        print(f"  Created: {filename.name}")

    print(f"\nDone! {len(entries)} split files created in split_logs/ directory.")
    print("\nNext steps:")
    print("1. Copy all images from Experiment_Log/Experiment Log/ to")
    print(f"   data/notes/assets/experiment-log/ (create the directory first)")
    print("2. In the Notes tab, use \"Upload MD\" to upload each .md file from split_logs/")
    print("3. The backend will automatically create the notes in the database.")

if __name__ == "__main__":
    main()
