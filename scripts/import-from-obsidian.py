#!/usr/bin/env python3
"""Import Obsidian markdown notes into the lab notebook.

Reads .md files from <vault>/<folder>/, copies referenced image assets from
<vault>/<attachments>/ into <out>/assets/<slug>/, and rewrites Obsidian-flavored
syntax into plain markdown the read-only viewer can render.

Rewrites performed:
  ![[image.png]]                   → ![](/files/notes/assets/<slug>/image.png)
  ![[image.png|alt]]               → ![alt](/files/notes/assets/<slug>/image.png)
  ![alt](image.png)                → ![alt](/files/notes/assets/<slug>/image.png)  (if found)
  [[Other Note]]                   → [Other Note](note:<other-slug>)
  [[Other Note|alias]]             → [alias](note:<other-slug>)
  [[Missing Note]]                 → Missing Note  (warning logged)

Wikilink targets must resolve to a .md file in <vault>/<folder>/ to count.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path
from urllib.parse import quote

# ── Helpers ────────────────────────────────────────────────────────────────


def slugify(name: str) -> str:
    """Filename → URL-safe slug. Mirrors Obsidian-friendly ascii lowercasing."""
    s = name.strip().lower()
    s = re.sub(r"[^\w\s-]", "", s, flags=re.UNICODE)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s or "untitled"


IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"}


_FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)


def ensure_title_frontmatter(text: str, original_title: str) -> str:
    """Make sure the note carries `title: <original filename>` frontmatter so
    the viewer shows a human-readable title instead of the slug. If frontmatter
    already exists with a `title:` key, leave it alone."""
    m = _FM_RE.match(text)
    if m:
        if re.search(r"^title:\s*\S", m.group(1), re.MULTILINE):
            return text
        new_fm = f"title: {original_title}\n{m.group(1)}\n"
        return f"---\n{new_fm}---\n{text[m.end():]}"
    return f"---\ntitle: {original_title}\n---\n\n{text}"


def find_attachment(name: str, attachments_dir: Path) -> Path | None:
    """Find an asset by filename inside the attachments folder.

    Obsidian attachment refs are bare filenames; we accept exact match first,
    then a case-insensitive fallback so iPhone uploads with mixed case still
    resolve."""
    direct = attachments_dir / name
    if direct.exists():
        return direct
    target = name.lower()
    for child in attachments_dir.iterdir():
        if child.name.lower() == target:
            return child
    return None


# ── Rewriters ──────────────────────────────────────────────────────────────


# ![[image.png]]  or  ![[image.png|alt text]]
EMBED_RE = re.compile(r"!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]")
# [[Other Note]]  or  [[Other Note|alias]]   (must NOT be preceded by `!`)
WIKILINK_RE = re.compile(r"(?<!\!)\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]")
# ![alt](path)  — only rewrite when path is a bare local filename
MD_IMG_RE = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)\)")


def process_note(
    md_path: Path,
    slug: str,
    out_dir: Path,
    attachments_dir: Path,
    slug_map: dict[str, str],
    stats: dict,
) -> str:
    """Return the rewritten markdown content. Copy referenced assets to disk."""

    text = md_path.read_text(encoding="utf-8")
    asset_root = out_dir / "assets" / slug

    def copy_asset(src_name: str) -> str | None:
        """Copy attachment into the per-note asset folder. Return basename
        used in the rewritten URL, or None if missing."""
        # Strip any path components Obsidian may have included
        bare = Path(src_name).name
        src = find_attachment(bare, attachments_dir)
        if src is None:
            stats["missing_assets"].append(f"{md_path.name}: {src_name}")
            return None
        asset_root.mkdir(parents=True, exist_ok=True)
        dest = asset_root / src.name
        # Avoid redundant work if file is identical size+mtime
        if not dest.exists() or dest.stat().st_size != src.stat().st_size:
            shutil.copy2(src, dest)
            stats["assets_copied"] += 1
        return src.name

    def replace_embed(m: re.Match) -> str:
        target, alt = m.group(1), (m.group(2) or "")
        ext = Path(target).suffix.lower()
        if ext in IMAGE_EXTS or ext == "":
            asset_name = copy_asset(target)
            if asset_name:
                url_name = quote(asset_name)
                return f"![{alt}](/files/notes/assets/{slug}/{url_name})"
            return f"*[missing: {target}]*"
        # Non-image embeds (PDF etc.) — also copy and link
        asset_name = copy_asset(target)
        if asset_name:
            url_name = quote(asset_name)
            return f"[{alt or asset_name}](/files/notes/assets/{slug}/{url_name})"
        return f"*[missing: {target}]*"

    def replace_wikilink(m: re.Match) -> str:
        target, alias = m.group(1).strip(), (m.group(2) or "").strip()
        target_slug = slug_map.get(target.lower())
        display = alias or target
        if target_slug:
            return f"[{display}](note:{target_slug})"
        stats["broken_wikilinks"].append(f"{md_path.name}: [[{target}]]")
        return display

    def replace_md_img(m: re.Match) -> str:
        alt, path = m.group(1), m.group(2)
        # Only rewrite local-looking bare filenames; leave full URLs alone.
        if path.startswith(("http://", "https://", "/", "data:")):
            return m.group(0)
        asset_name = copy_asset(path)
        if asset_name:
            url_name = quote(asset_name)
            return f"![{alt}](/files/notes/assets/{slug}/{url_name})"
        return m.group(0)

    text = EMBED_RE.sub(replace_embed, text)
    text = WIKILINK_RE.sub(replace_wikilink, text)
    text = MD_IMG_RE.sub(replace_md_img, text)
    return text


# ── Main ───────────────────────────────────────────────────────────────────


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    p = argparse.ArgumentParser(
        description="Import Obsidian markdown notes into lab-notebook /data/notes/."
    )
    p.add_argument("--vault", default=Path("~/SyncDokumente/MasterThesisVault"), type=Path, help="Path to the Obsidian vault root")
    p.add_argument("--folder", default="05_writing", help="Subfolder inside the vault to publish")
    p.add_argument("--attachments", default="assets", help="Attachments folder name relative to vault root")
    p.add_argument("--out", default=repo_root / "data" / "notes", type=Path, help="Output dir")
    p.add_argument("--clean", dest="clean", action="store_true", default=True, help="Wipe out/*.md and out/assets/ before importing")
    p.add_argument("--no-clean", dest="clean", action="store_false", help="Keep existing output files before importing")
    args = p.parse_args()

    vault: Path = args.vault.expanduser().resolve()
    src_folder = vault / args.folder
    attachments_dir = vault / args.attachments
    out_dir: Path = args.out.expanduser().resolve()

    if not src_folder.is_dir():
        print(f"Source folder not found: {src_folder}", file=sys.stderr)
        return 1
    if not attachments_dir.is_dir():
        print(f"Attachments folder not found: {attachments_dir}", file=sys.stderr)
        return 1

    out_dir.mkdir(parents=True, exist_ok=True)

    if args.clean:
        for md in out_dir.glob("*.md"):
            md.unlink()
        assets_dir = out_dir / "assets"
        if assets_dir.exists():
            shutil.rmtree(assets_dir)

    md_files = sorted(src_folder.rglob("*.md"))
    if not md_files:
        print(f"No .md files found under {src_folder}", file=sys.stderr)
        return 0

    # Build a {Note Title (lowercase) → slug} map so wikilinks can resolve
    # against either filenames or Obsidian display titles. Also detect slug
    # collisions and bail loudly.
    slug_map: dict[str, str] = {}
    file_for_slug: dict[str, Path] = {}
    for md in md_files:
        title = md.stem
        slug = slugify(title)
        if slug in file_for_slug and file_for_slug[slug] != md:
            print(
                f"Slug collision: '{title}' and '{file_for_slug[slug].stem}' both → {slug!r}.",
                file=sys.stderr,
            )
            return 2
        file_for_slug[slug] = md
        slug_map[title.lower()] = slug

    stats = {
        "notes": 0,
        "assets_copied": 0,
        "broken_wikilinks": [],
        "missing_assets": [],
    }

    for md in md_files:
        slug = slugify(md.stem)
        rewritten = process_note(md, slug, out_dir, attachments_dir, slug_map, stats)
        rewritten = ensure_title_frontmatter(rewritten, md.stem)
        (out_dir / f"{slug}.md").write_text(rewritten, encoding="utf-8")
        stats["notes"] += 1

    print(f"Synced {stats['notes']} notes; copied {stats['assets_copied']} assets.")
    if stats["broken_wikilinks"]:
        print(f"  {len(stats['broken_wikilinks'])} broken wikilink(s):")
        for w in stats["broken_wikilinks"]:
            print(f"    - {w}")
    if stats["missing_assets"]:
        print(f"  {len(stats['missing_assets'])} missing asset(s):")
        for m in stats["missing_assets"]:
            print(f"    - {m}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
