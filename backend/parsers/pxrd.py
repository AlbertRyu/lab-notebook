"""
PXRD data parser.

Supports common formats:
  - .xy / .xye : two or three whitespace/tab-separated columns (2theta, intensity [, error])
  - .csv        : comma-separated 2theta, intensity
  - .dat        : same as .xy (non-PPMS, no [Data] marker) OR NICOS semicolon-separated format
"""
import pandas as pd
from pathlib import Path
from typing import Optional


def parse_pxrd(path: str) -> Optional[dict]:
    p = Path(path)
    try:
        text = p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None

    # Check if this is NICOS semicolon-separated format
    has_semicolon = any(';' in line for line in text.splitlines()[:20])
    if has_semicolon:
        # Try NICOS format
        rows = []
        for line in text.splitlines():
            s = line.strip()
            if (not s) or s.startswith("#") or s.startswith("###"):
                continue
            if ';' not in s:
                continue

            try:
                left, right = [p.strip() for p in s.split(';', 1)]
                right_parts = right.split()
                if len(right_parts) < 4:
                    continue

                # ctt ; timer roi1 roi2 image.sum file1
                tt = float(left)
                intens = float(right_parts[3])
                rows.append((tt, intens))
            except ValueError:
                continue

        if not rows:
            return None

        # Sort by two_theta
        rows.sort(key=lambda x: x[0])
        two_theta = [r[0] for r in rows]
        intensity = [r[1] for r in rows]
        return {"2theta": two_theta, "intensity": intensity}

    # Standard whitespace-separated format
    two_theta, intensity, error = [], [], []
    ext = p.suffix.lower()
    sep = "," if ext == ".csv" else None  # None → split on any whitespace

    for line in text.splitlines():
        line = line.strip()
        if (
            not line
            or line.startswith("#")
            or line.startswith("!")
            or line.startswith("'")
        ):
            continue
        parts = line.split(sep) if sep else line.split()
        if len(parts) < 2:
            continue
        try:
            tt = float(parts[0])
            intens = float(parts[1])
        except ValueError:
            continue  # skip header-like rows
        two_theta.append(tt)
        intensity.append(intens)
        if len(parts) >= 3:
            try:
                error.append(float(parts[2]))
            except ValueError:
                error.append(None)

    if not two_theta:
        return None

    result: dict = {"2theta": two_theta, "intensity": intensity}
    if error:
        result["error"] = error
    return result


def to_traces(df: dict, label: str) -> list[dict]:
    traces = [
        {
            "x": df["2theta"],
            "y": df["intensity"],
            "mode": "lines",
            "name": label,
            "type": "scatter",
        }
    ]
    if "error" in df and any(e is not None for e in df["error"]):
        traces[0]["error_y"] = {
            "type": "data",
            "array": [e if e is not None else 0 for e in df["error"]],
            "visible": True,
        }
    return traces
