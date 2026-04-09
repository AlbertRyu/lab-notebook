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

KEEP = re.compile(
    r"^(Temperature \(|Magnetic Field \(|Moment \(|M\. Std\. Err\. \("
    r"|Sample Temp \(|Samp HC \(|Samp HC Err \(|Field \()"
)


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
    if "Samp HC (µJ/K)" in df:
        return "HC"

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


def extract_header_meta(path: str) -> dict:
    """Extract sample/measurement metadata from a PPMS .dat file header.

    Returns a dict with any of these keys (all optional):
      sample  – sample name (from SAMPLE_MATERIAL)
      type    – 'ppms-vsm' or 'ppms-hc' (from BYAPP)
      date    – datetime.date (from FILEOPENTIME)
      notes   – free-text notes (from SAMPLE_COMMENT)
      mass    – sample mass in mg as float (from SAMPLE_MASS)
    """
    meta: dict = {}
    try:
        raw = Path(path).read_bytes()
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("iso-8859-1")
    except OSError:
        return meta

    from datetime import datetime as _DT

    for line in text.splitlines():
        s = line.strip()
        if s == "[Data]":
            break
        if s.startswith("BYAPP,"):
            parts = s.split(",")
            app = parts[1].strip().upper() if len(parts) > 1 else ""
            if app == "VSM":
                meta["type"] = "ppms-vsm"
            elif app == "HEATCAPACITY":
                meta["type"] = "ppms-hc"
            elif app == "HC":
                meta["type"] = "ppms-hc"
        elif s.startswith("INFO,"):
            parts = s.split(",", 2)
            if len(parts) == 3:
                value, key = parts[1].strip(), parts[2].strip()
                if key == "SAMPLE_MATERIAL" and value:
                    meta["sample"] = value
                elif key == "SAMPLE_COMMENT" and value:
                    meta.setdefault("notes", value)
                elif key == "SAMPLE_MASS" and value:
                    # VSM format: INFO,<mass>,SAMPLE_MASS
                    try:
                        meta["mass"] = float(value)
                    except ValueError:
                        pass
                elif key.startswith("MASS:") and value:
                    # HC format: INFO,<mass>,MASS:Sample Mass (mg)
                    try:
                        meta["mass"] = float(value)
                    except ValueError:
                        pass
        elif s.startswith("FILEOPENTIME,"):
            parts = s.split(",")
            if len(parts) >= 3:
                try:
                    meta["date"] = _DT.strptime(parts[2].strip(), "%m/%d/%Y").date()
                except ValueError:
                    pass

    return meta


def to_traces(df: dict, mode: str, label: str, mass: Optional[float] = None) -> list[dict]:
    if mode == "HC":
        T   = df.get("Sample Temp (Kelvin)", [])
        HC  = df.get("Samp HC (µJ/K)", [])
        Err = df.get("Samp HC Err (µJ/K)", [])
        normalize = mass is not None and mass > 0
        x, y, err = [], [], []
        for i in range(min(len(T), len(HC))):
            if T[i] == T[i] and HC[i] == HC[i]:  # NaN guard
                x.append(T[i])
                y.append(HC[i] / mass if normalize else HC[i])
                if i < len(Err) and Err[i] == Err[i]:
                    err.append(Err[i] / mass if normalize else Err[i])
        trace: dict = {"x": x, "y": y, "mode": "markers", "name": label, "type": "scatter",
                       "marker": {"size": 4}}
        if err:
            trace["error_y"] = {"type": "data", "array": err, "visible": True,
                                 "thickness": 1, "width": 3}
        return [trace]

    T = df.get("Temperature (K)", [])
    H = df.get("Magnetic Field (Oe)", [])
    M = df.get("Moment (emu)", [])

    x, y = [], []
    src = T if mode == "MT" else H
    # Only normalize if mass is present and mass > 0 (avoid division by zero)
    normalize = mass is not None and mass > 0
    for i in range(min(len(src), len(M))):
        if src[i] == src[i] and M[i] == M[i]:  # isfinite check
            x.append(src[i])
            if normalize:
                y.append(M[i] / mass)
            else:
                y.append(M[i])

    return [{"x": x, "y": y, "mode": "lines", "name": label, "type": "scatter"}]
