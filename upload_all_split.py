#!/usr/bin/env python3
"""Upload all split markdown files to the running lab-notebook server via the API."""

import sys
import json
from pathlib import Path
from urllib import request

BASE_URL = "http://localhost:8100"
SPLIT_DIR = Path(__file__).parent / "split_logs"
SKIP = {"log-2025-02-05.md"}  # User already uploaded this one

def encode_multipart_formdata(fields, boundary):
    """Encode multipart form data manually."""
    lines = []
    for (name, filename, content) in fields:
        lines.append(f'--{boundary}')
        lines.append(f'Content-Disposition: form-data; name="{name}"; filename="{filename}"')
        lines.append(f'Content-Type: text/markdown')
        lines.append('')
        lines.append(content)
    lines.append(f'--{boundary}--')
    lines.append('')
    return '\r\n'.join(lines).encode('utf-8')

def upload_file(file_path: Path) -> bool:
    """Upload a single markdown file via /api/notes/upload."""
    url = f"{BASE_URL}/api/notes/upload"

    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    boundary = '----Boundary1234567890'
    data = encode_multipart_formdata([('file', file_path.name, content)], boundary)

    req = request.Request(url, method='POST')
    req.add_header('Content-Type', f'multipart/form-data; boundary={boundary}')
    req.add_header('Content-Length', str(len(data)))

    try:
        with request.urlopen(req, data=data, timeout=30) as response:
            response_body = response.read().decode('utf-8')
            if response.status == 201:
                data = json.loads(response_body)
                print(f"✓ {file_path.name} → OK (id: {data['id']})")
                return True
            else:
                print(f"✗ {file_path.name} → {response.status}: {response_body[:100]}")
                return False
    except Exception as e:
        print(f"✗ {file_path.name} → Exception: {e}")
        return False

def main():
    if not SPLIT_DIR.exists():
        print(f"Error: split directory {SPLIT_DIR} not found")
        sys.exit(1)

    all_files = sorted(SPLIT_DIR.glob("*.md"))
    remaining = [f for f in all_files if f.name not in SKIP]

    print(f"Found {len(remaining)} files remaining to upload...")
    print()

    success = 0
    failed = 0

    for file_path in remaining:
        if upload_file(file_path):
            success += 1
        else:
            failed += 1

    print()
    print(f"Complete: {success} succeeded, {failed} failed")

if __name__ == "__main__":
    main()
