"""
PPMS .dat file parser — ported from vsm_visualizer.html JS logic.

File format:
  ...header lines...
  [Data]
  Column1,Column2,...    <- header row
  val,val,...            <- data rows
"""
import re
from pathlib import Path
from typing import Optional

KEEP = re.compile(r"^(Temperature \(|Magnetic Field \(|Moment \(|M\. Std\. Err\. \()")


def parse_dat(path: str) -> Optional[dict]:
    try:
        raw = Path(path).read_bytes()
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("iso-8859-1")
    except OSError:
        return None

    lines = text.splitlines()
    di = next((i for i, l in enumerate(lines) if l.strip() == "[Data]"), None)
    if di is None:
        return None

    headers = lines[di + 1].strip().split(",")
    df: dict[str, list] = {h: [] for h in headers if KEEP.match(h)}

    for line in lines[di + 2 :]:
        row = line.strip()
        if not row:
            continue
        vals = row.split(",")
        for j, h in enumerate(headers):
            if h in df:
                try:
                    df[h].append(float(vals[j]))
                except (ValueError, IndexError):
                    pass

    return df if df else None


def detect_mode(df: dict) -> str:
    T = df.get("Temperature (K)", [])
    H = df.get("Magnetic Field (Oe)", [])
    if not T or not H:
        return "MT"
    span_T = max(T) - min(T)
    span_H = max(H) - min(H)
    return "MH" if span_H > span_T else "MT"


def to_traces(df: dict, mode: str, label: str) -> list[dict]:
    T = df.get("Temperature (K)", [])
    H = df.get("Magnetic Field (Oe)", [])
    M = df.get("Moment (emu)", [])

    x, y = [], []
    src = T if mode == "MT" else H
    for i in range(min(len(src), len(M))):
        if src[i] == src[i] and M[i] == M[i]:  # isfinite check
            x.append(src[i])
            y.append(M[i])

    return [{"x": x, "y": y, "mode": "lines", "name": label, "type": "scatter"}]
