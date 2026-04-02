"""
FMR data parser — generic two-column (field, signal) format.

Supports:
  - Whitespace/tab-separated columns
  - Optional comment lines starting with #
  - First non-comment row may be a header; it is skipped if non-numeric
"""
from pathlib import Path
from typing import Optional


def parse_fmr(path: str) -> Optional[dict]:
    try:
        text = Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None

    field, signal = [], []
    headers: list[str] = []

    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        try:
            field.append(float(parts[0]))
            signal.append(float(parts[1]))
            if not headers:
                headers = ["Field", "Signal"]
        except ValueError:
            if not field:
                headers = parts  # treat as header row
            continue

    if not field:
        return None

    col_x = headers[0] if headers else "Field"
    col_y = headers[1] if len(headers) > 1 else "Signal"
    return {col_x: field, col_y: signal}


def to_traces(df: dict, label: str) -> list[dict]:
    keys = list(df.keys())
    x_key = keys[0] if keys else "Field"
    y_key = keys[1] if len(keys) > 1 else "Signal"
    return [
        {
            "x": df[x_key],
            "y": df[y_key],
            "mode": "lines",
            "name": label,
            "type": "scatter",
        }
    ]
