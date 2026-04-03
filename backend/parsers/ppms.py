"""
PPMS .dat file parser — ported from vsm_visualizer.html JS logic.

File format:
  ...header lines...
  [Data]
  Column1,Column2,...    <- header row
  val,val,...            <- data rows
"""

import re
import math
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
    di = next((i for i, line in enumerate(lines) if line.strip() == "[Data]"), None)
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
    def _clean(vals: list) -> list[float]:
        return [
            float(v) for v in vals if isinstance(v, (int, float)) and math.isfinite(v)
        ]

    def _axis_score(vals: list[float]) -> tuple[float, float]:
        """
        Return (score, span). Higher score means this axis behaves more like a scan axis.
        Score is unit-agnostic and based on:
          1) how often the value changes along acquisition order
          2) how many distinct levels appear
        """
        n = len(vals)
        if n < 3:
            return 0.0, 0.0

        vmin = min(vals)
        vmax = max(vals)
        span = vmax - vmin
        if span <= 0:
            return 0.0, 0.0

        # Relative tolerance keeps behavior stable across different units (K vs Oe).
        tol = max(span * 1e-4, 1e-12)
        diffs = [abs(vals[i + 1] - vals[i]) for i in range(n - 1)]
        changing = sum(1 for d in diffs if d > tol)
        change_ratio = changing / max(1, n - 1)

        # Quantize by relative tolerance and count unique levels.
        q = max(span * 1e-3, tol)
        unique_ratio = len({int(round(v / q)) for v in vals}) / n

        score = 0.65 * change_ratio + 0.35 * unique_ratio
        return score, span

    T = _clean(df.get("Temperature (K)", []))
    H = _clean(df.get("Magnetic Field (Oe)", []))
    if len(T) < 3 or len(H) < 3:
        return "MT"

    score_T, span_T = _axis_score(T)
    score_H, span_H = _axis_score(H)

    # Fast-path for common PPMS patterns: one axis nearly constant.
    if span_T < 0.1 and span_H > 20:
        return "MH"
    if span_H < 5 and span_T > 0.5:
        return "MT"

    return "MH" if score_H > score_T else "MT"


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
