"""Music archive path parser — handles the actual (dirty) R2 bucket structure.

Folder component classification pipeline:
  1. Detect status markers with full typo/case tolerance
  2. Detect special containers (Duplicates, Orchard WAVs, Singles, etc.)
  3. Extract artist from compound names  (e.g. "4_female_stars_already_worked_on")
  4. Infer artist from album names       (e.g. "Best_of_Franco" → artist=Franco)
  5. Parse filename for track#/artist/title/feat/version
  6. Merge everything with confidence scores
"""
from __future__ import annotations

import os
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import PurePosixPath
from typing import Any

# ── Value types ───────────────────────────────────────────────────────────────

@dataclass
class ConfidentValue:
    value: Any
    confidence: float
    source: str

    def as_dict(self) -> dict:
        return {"value": self.value, "confidence": self.confidence, "source": self.source}


@dataclass
class ParsedMetadata:
    artist: ConfidentValue | None = None
    album: ConfidentValue | None = None
    title: ConfidentValue | None = None
    year: ConfidentValue | None = None
    track_number: ConfidentValue | None = None
    genre: ConfidentValue | None = None
    language: ConfidentValue | None = None
    region: ConfidentValue | None = None
    featuring: ConfidentValue | None = None
    remix_version: ConfidentValue | None = None
    source_collection: ConfidentValue | None = None   # e.g. "Orchard Converted"
    workflow_tags: list[str] = field(default_factory=list)
    needs_human_review: bool = False
    review_reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        out: dict = {}
        for f in self.__dataclass_fields__:
            val = getattr(self, f)
            if isinstance(val, ConfidentValue):
                out[f] = val.as_dict()
            else:
                out[f] = val
        return out


# ── Status-marker normaliser ──────────────────────────────────────────────────
# All variants found in the actual bucket (typos, capitalisation, compounds).

# Regex patterns → canonical tag
_STATUS_PATTERNS: list[tuple[re.Pattern, str]] = [
    # "already_worked_on" and all typos / capitalizations
    (re.compile(r'\bal?r?e?a?d?y[_\s]?worked[_\s]?on\b', re.I), 'already_worked_on'),
    # "worked_on" short form
    (re.compile(r'^worked[_\s]on$', re.I), 'already_worked_on'),
    # "alredy_in_worked_on" — typo meaning "already in worked-on folder"
    (re.compile(r'al[lr]?edy[_\s]in[_\s]worked', re.I), 'already_worked_on'),

    # "already_in_the_database" / "already_in_the_data_base" and typos
    (re.compile(r'\bal?r?e?a?d?y[_\s]in[_\s]the[_\s]data[_\s]?base?\b', re.I), 'already_in_database'),

    # "to_be_compressed"
    (re.compile(r'\bto[_\s]be[_\s]compressed\b', re.I), 'needs_compression'),
]

# Strip these patterns when trying to extract artist from a compound name
_STATUS_STRIP_PATTERNS: list[re.Pattern] = [
    re.compile(r'[_\s]?al?r?e?a?d?y[_\s]?worked[_\s]?on[_\s]?', re.I),
    re.compile(r'[_\s]?worked[_\s]?on[_\s]?', re.I),
    re.compile(r'[_\s]?al[lr]?edy[_\s]in[_\s]worked[_\s]?', re.I),
    re.compile(r'[_\s]?al?r?e?a?d?y[_\s]in[_\s]the[_\s]data[_\s]?base?[_\s]?', re.I),
    re.compile(r'[_\s]?to[_\s]be[_\s]compressed[_\s]?', re.I),
]


def _detect_status(name: str) -> set[str]:
    """Return set of canonical status tags found in a folder name."""
    # Normalize underscores to spaces so \b word boundaries work in compound names
    # e.g. "4_female_stars_already_worked_on" → spaces allow \b before "already"
    normalized = name.replace('_', ' ')
    tags: set[str] = set()
    for pattern, tag in _STATUS_PATTERNS:
        if pattern.search(normalized):
            tags.add(tag)
    return tags


def _strip_status_tokens(name: str) -> str:
    """Remove all status substrings from *name*, returning the remainder."""
    result = name
    for pattern in _STATUS_STRIP_PATTERNS:
        result = pattern.sub('_', result)
    return result.strip('_- ')


# ── Special containers & sources ─────────────────────────────────────────────

_CONTAINERS: dict[str, str] = {
    # normalised lowercase → workflow tag
    "duplicates":       "duplicate_review",
    "duplicate":        "duplicate_review",
    "singles":          "single",
    "single":           "single",
    "various":          "various_artists",
    "various artists":  "various_artists",
    "va":               "various_artists",
    "compilations":     "various_artists",
    # Ownership / rights containers
    "tamasha owned":          "tamasha_owned",
    "tamasha_owned":          "tamasha_owned",
    "tamashas owned":         "tamasha_owned",
    "tamasha's owned":        "tamasha_owned",
    "signed artists":         "signed_artist",
    "signed_artists":         "signed_artist",
    "signed artist":          "signed_artist",
    "signed_artist":          "signed_artist",
    # TCL catalogue-only (track has a number but no name)
    "tcl no tracks":          "catalogue_number_only",
    "tcl_no_tracks":          "catalogue_number_only",
    "no tracks":              "catalogue_number_only",
    "no_tracks":              "catalogue_number_only",
    "tcl no track names":     "catalogue_number_only",
    "catalogue numbers only": "catalogue_number_only",
}

# Sub-strings that mark a special source collection
_SOURCE_MARKERS: list[tuple[re.Pattern, str, str]] = [
    # pattern, source_collection_label, workflow_tag
    (re.compile(r'orchard[_\s]?converted', re.I), "Orchard Converted", "orchard_source"),
]

# Containers where the first real subfolder is the ALBUM (e.g. Duplicates/Album/files)
_ALBUM_FIRST_CONTAINERS: set[str] = {'duplicate_review'}

# Containers where the first real subfolder is the ARTIST (e.g. Tamasha_Owned/Artist/Year/Album/files)
_ARTIST_FIRST_CONTAINERS: set[str] = {'tamasha_owned', 'signed_artist', 'single', 'various_artists'}

# Folders that are pure organisational / skip metadata entirely
_SKIP_FOLDERS: set[str] = {
    "tamasha", "general", "others", "misc", "miscellaneous",
    "music", "raw", "audio",
}


# ── Language / region / genre tables ─────────────────────────────────────────

_LANGUAGE_REGION_MAP: dict[str, tuple[str, str]] = {
    "lingala":    ("Lingala",  "Congo"),
    "swahili":    ("Swahili",  "East Africa"),
    "kikuyu":     ("Kikuyu",   "Kenya"),
    "luo":        ("Luo",      "Kenya"),
    "kamba":      ("Kamba",    "Kenya"),
    "luganda":    ("Luganda",  "Uganda"),
    "hausa":      ("Hausa",    "West Africa"),
    "yoruba":     ("Yoruba",   "Nigeria"),
    "igbo":       ("Igbo",     "Nigeria"),
    "amharic":    ("Amharic",  "Ethiopia"),
    "somali":     ("Somali",   "Somalia"),
    "afrikaans":  ("Afrikaans","South Africa"),
    "zulu":       ("Zulu",     "South Africa"),
    "xhosa":      ("Xhosa",    "South Africa"),
    "shona":      ("Shona",    "Zimbabwe"),
    "ndebele":    ("Ndebele",  "Zimbabwe"),
    "chichewa":   ("Chichewa", "Malawi"),
    "bemba":      ("Bemba",    "Zambia"),
    "tswana":     ("Tswana",   "Botswana"),
}

_GENRE_REGION_MAP: dict[str, tuple[str, str]] = {
    "benga":       ("Benga",       "Kenya"),
    "taarab":      ("Taarab",      "Tanzania"),
    "rumba":       ("Rumba",       "Congo"),
    "soukous":     ("Soukous",     "Congo"),
    "juju":        ("Jùjú",        "Nigeria"),
    "afrobeats":   ("Afrobeats",   "Nigeria"),
    "afrobeat":    ("Afrobeat",    "Nigeria"),
    "highlife":    ("Highlife",    "Ghana"),
    "makossa":     ("Makossa",     "Cameroon"),
    "fuji":        ("Fuji",        "Nigeria"),
    "kizomba":     ("Kizomba",     "Angola"),
    "semba":       ("Semba",       "Angola"),
    "kuduro":      ("Kuduro",      "Angola"),
    "bongo flava": ("Bongo Flava", "Tanzania"),
    "zilipendwa":  ("Zilipendwa",  "East Africa"),
    "mugithi":     ("Mugithi",     "Kenya"),
    "kapuka":      ("Kapuka",      "Kenya"),
    "genge":       ("Genge",       "Kenya"),
    "ohangla":     ("Ohangla",     "Kenya"),
}


def _infer_language_region(text: str) -> tuple[str | None, str | None]:
    lower = text.lower()
    for kw, (lang, region) in _LANGUAGE_REGION_MAP.items():
        if kw in lower:
            return lang, region
    for kw, (_, region) in _GENRE_REGION_MAP.items():
        if kw in lower:
            return None, region
    return None, None


def _infer_genre(text: str) -> str | None:
    lower = text.lower()
    for kw, (genre, _) in _GENRE_REGION_MAP.items():
        if kw in lower:
            return genre
    return None


# ── String helpers ────────────────────────────────────────────────────────────

_YEAR_RE = re.compile(r'\b(19[0-9]{2}|20[0-2][0-9])\b')
# Codes like TCL001, KL123 that look like catalogue numbers, not artist names
_CATALOGUE_CODE_RE = re.compile(r'^[A-Z]{1,5}\d{2,}$', re.I)


def _normalize(s: str) -> str:
    return unicodedata.normalize("NFC", s).strip()


def _humanize(s: str) -> str:
    """Normalize and convert underscores to spaces."""
    s = _normalize(s).strip(' _-.')
    s = s.replace('_', ' ')
    return ' '.join(s.split())


def _parse_year(s: str) -> int | None:
    m = _YEAR_RE.search(s)
    return int(m.group(1)) if m else None


# ── Album-name → artist inference ─────────────────────────────────────────────

_ALBUM_ARTIST_PATTERNS: list[tuple[re.Pattern, int]] = [
    # "Best_of_Franco" / "Best of Tshala_Muana"
    (re.compile(r'^best[_ ]of[_ ](.+)$', re.I), 1),
    # "Greatest_Hits_Franco"
    (re.compile(r'^greatest[_ ]hits[_ ](?:of[_ ])?(.+)$', re.I), 1),
    # "Franco_Greatest_Hits"
    (re.compile(r'^(.+?)[_ ]greatest[_ ]hits', re.I), 1),
    # "The_Best_of_Franco"
    (re.compile(r'^the[_ ]best[_ ]of[_ ](.+)$', re.I), 1),
    # "Franco_-_Collection" / "Franco_Collection"
    (re.compile(r'^(.+?)[_ ](?:collection|anthology|compilation|essentials|classics?)$', re.I), 1),
]


def _artist_from_album(album_raw: str) -> str | None:
    for pattern, group in _ALBUM_ARTIST_PATTERNS:
        m = pattern.match(album_raw)
        if m:
            candidate = _humanize(m.group(group))
            if candidate and len(candidate) > 1:
                return candidate
    return None


# ── Folder component analysis ─────────────────────────────────────────────────

@dataclass
class FolderInfo:
    original: str
    human: str               # underscores→spaces, normalized
    container_tag: str | None
    source_tag: str | None
    source_label: str | None
    status_tags: set[str]
    is_pure_status: bool     # the whole folder is ONLY a status marker
    extracted_artist: str | None   # artist pulled from compound name
    is_skip: bool


def _analyse_folder(name: str) -> FolderInfo:
    lower = name.lower().strip()
    human = _humanize(name)

    # Skip folders
    if lower in _SKIP_FOLDERS:
        return FolderInfo(name, human, None, None, None, set(), False, None, True)

    # Container (Duplicates, Singles, …)
    container_tag = _CONTAINERS.get(lower)

    # Source collection (Orchard Converted, …)
    source_tag = source_label = None
    for pattern, label, stag in _SOURCE_MARKERS:
        if pattern.search(name):
            source_tag = stag
            source_label = label
            break

    # Status detection
    status_tags = _detect_status(name)

    # Tokens too short or too generic to be a real name after stripping status
    _RESIDUAL_NOISE = {'on', 'the', 'a', 'an', 'of', 'in', 'to', 'be', 'at'}

    # Is this ONLY a status marker? → strip status tokens and see if anything meaningful remains
    remainder = _strip_status_tokens(name)
    is_pure_status = bool(status_tags) and (
        not remainder
        or len(remainder) < 2
        or remainder.lower() in _RESIDUAL_NOISE
    )

    # Try to pull an artist from compound names like:
    #   "4_female_stars_already_worked_on" → "4 Female Stars"
    #   "already_worked_on_A.I.C_Mwanza_Town" → "A.I.C Mwanza Town"
    extracted_artist = None
    if status_tags and not is_pure_status and not container_tag and not source_tag:
        candidate = _humanize(remainder)
        if candidate and len(candidate) > 1 and not _YEAR_RE.fullmatch(candidate.strip()):
            extracted_artist = candidate

    return FolderInfo(
        original=name,
        human=human,
        container_tag=container_tag,
        source_tag=source_tag,
        source_label=source_label,
        status_tags=status_tags,
        is_pure_status=is_pure_status,
        extracted_artist=extracted_artist,
        is_skip=(container_tag is None and source_tag is None
                 and not status_tags and lower in _SKIP_FOLDERS),
    )


# ── Filename parser ───────────────────────────────────────────────────────────

# Separator requires an explicit dash with at least one underscore or space on each side.
_SEP    = r'(?:\s+-\s+|_-_|\s+_\s+)'
_FEAT   = r'(?:[_\s]+\((?:feat|ft|featuring)\.?[_\s]+(?P<feat>[^)]+)\))?'
_VER    = r'(?:[_\s]+[\[\(](?P<version>[^\]\)]+)[\]\)])?'
# Only strip 2+ digit leading numbers as track numbers.
# Single digit (e.g. "4") may be part of a band name like "4 Female Stars".
_NUMRE  = re.compile(r'^(\d{2,})[_\s]+(.+)$')

_FILENAME_PATTERNS: list[re.Pattern] = [
    # "01 - Artist - Title (feat. X) [Remix]"
    re.compile(r'^(?P<num>\d{1,3})' + _SEP + r'(?P<artist>.+?)' + _SEP + r'(?P<title>.+?)' + _FEAT + _VER + r'$', re.I),
    # "01 - Title"
    re.compile(r'^(?P<num>\d{1,3})' + _SEP + r'(?P<title>.+?)' + _FEAT + _VER + r'$', re.I),
    # "Artist - Title"
    re.compile(r'^(?P<artist>.+?)' + _SEP + r'(?P<title>.+?)' + _FEAT + _VER + r'$', re.I),
    # bare "Title"
    re.compile(r'^(?P<title>.+?)' + _FEAT + _VER + r'$', re.I),
]


def _parse_filename(stem: str) -> dict:
    """Return dict with keys: num, artist, title, feat, version (all optional)."""
    stem = _normalize(stem)
    out: dict = {}

    # Pre-extract leading track number (e.g. "01_bois_noir")
    m_num = _NUMRE.match(stem)
    if m_num:
        try:
            out['num'] = int(m_num.group(1))
            stem = m_num.group(2)
        except ValueError:
            pass

    for pat in _FILENAME_PATTERNS:
        m = pat.match(stem)
        if not m:
            continue
        gd = m.groupdict()
        if 'num' not in out and gd.get('num'):
            try:
                out['num'] = int(gd['num'])
            except ValueError:
                pass
        for k in ('artist', 'title', 'feat', 'version'):
            if gd.get(k) and k not in out:
                out[k] = _humanize(gd[k])
        break

    return out


# ── Main parse entry point ────────────────────────────────────────────────────

def parse_r2_key(r2_key: str) -> ParsedMetadata:
    """Derive structured metadata from an R2 object key.

    Handles the actual dirty bucket structure:
      Duplicates/AlbumName/Artist_-_Title.mp3
      Duplicates/already_worked_on/Artist/already_worked_on/Artist_-_Title.mp3
      Duplicates/Orchard_Converted_._WAV_files/Artist_or_compound/status/files.mp3
      Duplicates/Best_of_Franco/01_Title.mp3   → infers artist=Franco
    """
    result = ParsedMetadata()
    path   = PurePosixPath(r2_key)
    parts  = list(path.parts)

    # Strip storage prefixes
    while parts and parts[0].lower() in ('music', 'raw'):
        parts.pop(0)

    if not parts:
        result.needs_human_review = True
        result.review_reasons.append('path_too_shallow')
        return result

    filename_stem = path.stem
    folder_parts  = parts[:-1]   # everything except filename

    # ── 1. Analyse each folder component ─────────────────────────────────────
    infos: list[FolderInfo] = [_analyse_folder(p) for p in folder_parts]

    # ── 2. Collect workflow tags from all components ──────────────────────────
    all_tags: set[str] = set()
    for info in infos:
        if info.container_tag:
            all_tags.add(info.container_tag)
        if info.source_tag:
            all_tags.add(info.source_tag)
        all_tags.update(info.status_tags)

    # ── 3. Find the source collection (first one wins) ────────────────────────
    for info in infos:
        if info.source_label:
            result.source_collection = ConfidentValue(info.source_label, 1.0, 'folder_structure')
            break

    # ── 4. Build a list of "meaningful" (non-status, non-container) components
    meaningful: list[FolderInfo] = [
        i for i in infos
        if not i.is_pure_status and not i.container_tag and not i.source_tag and not i.is_skip
    ]

    # ── 5. Extract artist candidates ─────────────────────────────────────────
    artist_candidates: list[tuple[str, float, str]] = []  # (name, conf, source)

    # 5a. Compound folder names that embed artist+status
    for info in infos:
        if info.extracted_artist:
            artist_candidates.append((info.extracted_artist, 0.72, 'compound_folder'))

    # 5b. Meaningful folder names — context-dependent interpretation
    #     Layout: Container / [ArtistOrAlbum] / [StatusFolders] / files
    #     If a meaningful folder immediately follows an already_worked_on folder,
    #     it's almost certainly an artist name.
    prev_was_worked_on = False
    for info in infos:
        if info.container_tag:
            prev_was_worked_on = False
            continue
        if 'already_worked_on' in info.status_tags or 'already_in_database' in info.status_tags:
            prev_was_worked_on = True
            continue
        if info.source_tag:
            prev_was_worked_on = False
            continue
        if info.is_pure_status or info.is_skip:
            continue
        # This is a meaningful folder — is it an artist or album?
        if prev_was_worked_on:
            # Directly follows a worked-on marker → artist folder
            artist_candidates.append((_humanize(info.original), 0.85, 'artist_folder'))
        prev_was_worked_on = False

    # 5c. Album name → artist inference (e.g. "Best_of_Franco" → Franco)
    if meaningful:
        for info in meaningful:
            inferred = _artist_from_album(info.original)
            if inferred:
                artist_candidates.append((inferred, 0.80, 'album_artist_inference'))

    # ── 6. Determine album ────────────────────────────────────────────────────
    # Pattern A (album-first): Container/AlbumName/files → meaningful[0] is album
    # Pattern B (artist-first): Container/Artist/[Year/]Album/files → meaningful[0] is artist
    # Pattern C: Container/worked_on/Artist/worked_on → no album (artist already found in 5b)
    # Pattern D: Container/Source/ArtistName/status → artist from source subfolder
    album_candidate: str | None = None
    album_conf = 0.0

    container_found  = any(i.container_tag for i in infos)
    source_found     = any(i.source_tag for i in infos)
    artist_folder_sources = {s for _, _, s in artist_candidates if s == 'artist_folder'}
    # Use innermost (last) container — e.g. Duplicates/Tamasha_Owned → tamasha_owned wins
    active_container = next((i.container_tag for i in reversed(infos) if i.container_tag), None)

    if container_found and meaningful:
        first_m = meaningful[0]

        if source_found:
            # Orchard / WAV source: first meaningful subfolder is the artist (use extracted if compound)
            if not artist_folder_sources:
                artist_name = first_m.extracted_artist or _humanize(first_m.original)
                artist_candidates.append((artist_name, 0.78, 'source_subfolder'))

        elif active_container in _ARTIST_FIRST_CONTAINERS:
            # Artist-first layout: Container/Artist/[Year/]Album/files
            compound_sources = {s for _, _, s in artist_candidates if s == 'compound_folder'}
            if not artist_folder_sources and not compound_sources:
                artist_name = first_m.extracted_artist or _humanize(first_m.original)
                artist_candidates.append((artist_name, 0.85, 'artist_folder'))
            # Walk subsequent meaningful folders to find album (skip pure-year folders)
            for sub in meaningful[1:]:
                sub_year = _parse_year(sub.original)
                if sub_year:
                    if not result.year:
                        result.year = ConfidentValue(sub_year, 0.88, 'folder_structure')
                    continue
                album_candidate = _humanize(sub.original)
                album_conf = 0.78
                break

        elif not artist_folder_sources:
            # Default / album-first (Duplicates): Container/Album/files → album
            # Skip compound folders that embed status markers — they're artist folders, not albums
            if not first_m.status_tags:
                album_candidate = _humanize(first_m.original)
                album_conf = 0.78
                year = _parse_year(first_m.original)
                if year and not result.year:
                    result.year = ConfidentValue(year, 0.88, 'folder_structure')

    # ── 7. Parse filename ─────────────────────────────────────────────────────
    fn = _parse_filename(filename_stem)

    if fn.get('num'):
        result.track_number = ConfidentValue(fn['num'], 0.92, 'filename')
    if fn.get('title'):
        result.title = ConfidentValue(fn['title'], 0.80, 'filename')
    if fn.get('feat'):
        result.featuring = ConfidentValue(fn['feat'], 0.88, 'filename')
    if fn.get('version'):
        result.remix_version = ConfidentValue(fn['version'], 0.90, 'filename')

    # Artist from filename (lower priority than folder-derived)
    if fn.get('artist') and not artist_candidates:
        artist_candidates.append((fn['artist'], 0.75, 'filename'))
    elif fn.get('artist'):
        # Add as a candidate but folder-based has priority
        artist_candidates.append((fn['artist'], 0.75, 'filename'))

    # ── 8. Pick best artist candidate ────────────────────────────────────────
    # Priority: artist_folder(0.85) > album_artist_inference(0.80) > compound_folder(0.72) > filename(0.75)
    # When multiple sources agree, confidence goes up.
    if artist_candidates:
        # Group by normalised name to detect consensus
        from collections import defaultdict
        by_name: dict[str, list] = defaultdict(list)
        for name, conf, src in artist_candidates:
            by_name[name.lower()].append((name, conf, src))

        best_name = best_conf = None
        best_src  = ''
        for norm, entries in by_name.items():
            # Boost confidence if multiple independent sources agree
            max_conf = max(c for _, c, _ in entries)
            sources  = {s for _, _, s in entries}
            bonus    = 0.05 if len(sources) > 1 else 0.0
            effective = min(0.97, max_conf + bonus)
            if best_conf is None or effective > best_conf:
                best_conf = effective
                best_name = entries[0][0]  # use original casing
                best_src  = '+'.join(sorted(sources))

        if best_name:
            result.artist = ConfidentValue(best_name, best_conf, best_src)

    # Suppress catalogue-number codes (e.g. TCL001) being treated as artist names
    if 'catalogue_number_only' in all_tags and result.artist:
        if _CATALOGUE_CODE_RE.match(result.artist.value.replace(' ', '')):
            result.artist = None

    # ── 9. Set album ─────────────────────────────────────────────────────────
    if album_candidate:
        result.album = ConfidentValue(album_candidate, album_conf, 'folder_structure')

    # ── 10. Year from path text ───────────────────────────────────────────────
    if not result.year:
        year = _parse_year('/'.join(folder_parts))
        if year:
            result.year = ConfidentValue(year, 0.72, 'path_inference')

    # ── 11. Language / region / genre inference ───────────────────────────────
    path_text = r2_key.lower()
    lang, region = _infer_language_region(path_text)
    if lang:
        result.language = ConfidentValue(lang, 0.55, 'path_inference')
    if region:
        result.region = ConfidentValue(region, 0.55, 'path_inference')
    genre = _infer_genre(path_text)
    if genre:
        result.genre = ConfidentValue(genre, 0.50, 'path_inference')

    # ── 12. Finalise workflow tags ────────────────────────────────────────────
    result.workflow_tags = _finalise_tags(all_tags, result)

    # ── 13. Human review flag ─────────────────────────────────────────────────
    needs_review, reasons = should_queue_human_review(result)
    result.needs_human_review = needs_review
    result.review_reasons     = reasons

    return result


# ── Tag finalisation ──────────────────────────────────────────────────────────

def _finalise_tags(raw_tags: set[str], result: ParsedMetadata) -> list[str]:
    tags = set(raw_tags)

    # Completeness tags
    missing = [
        f for f in ('artist', 'title')
        if getattr(result, f) is None
    ]
    low_conf = [
        f for f in ('artist', 'title', 'year', 'album')
        if getattr(result, f) is not None and getattr(result, f).confidence < 0.65
    ]
    if missing or len(low_conf) >= 2:
        tags.add('missing_metadata')
    if len(low_conf) >= 2 or (missing and result.artist is None and result.title is not None):
        tags.add('metadata_review')

    # Source type
    if result.source_collection and 'orchard' in (result.source_collection.value or '').lower():
        tags.add('wav_source')

    return list(dict.fromkeys(sorted(tags)))


# ── Merge helpers (priority chain) ────────────────────────────────────────────

def merge_with_embedded(parsed: ParsedMetadata, embedded: dict) -> ParsedMetadata:
    """Override with embedded audio tag values (highest priority, conf=0.95)."""
    for tag_key, field_name in (
        ('title', 'title'), ('artist', 'artist'),
        ('album', 'album'), ('year', 'year'), ('genre', 'genre'),
    ):
        val = embedded.get(tag_key)
        if not val:
            continue
        if tag_key == 'year':
            try:
                val = int(str(val)[:4])
            except (ValueError, TypeError):
                continue
        setattr(parsed, field_name, ConfidentValue(val, 0.95, 'embedded_metadata'))
    return parsed


def merge_with_existing_db(parsed: ParsedMetadata, db_doc: dict) -> ParsedMetadata:
    """Override with already-verified MongoDB data (conf=0.99, never overwritten)."""
    for db_key, field_name in (
        ('title', 'title'), ('album', 'album'),
        ('year', 'year'),   ('genre', 'genre'), ('language', 'language'),
    ):
        val = db_doc.get(db_key)
        if not val:
            continue
        existing = getattr(parsed, field_name)
        cv = ConfidentValue(val, 0.99, 'existing_db')
        if existing is None or existing.confidence < cv.confidence:
            setattr(parsed, field_name, cv)
    return parsed


# ── Public helpers ────────────────────────────────────────────────────────────

def compute_workflow_tags(parsed: ParsedMetadata) -> list[str]:
    return _finalise_tags(set(parsed.workflow_tags), parsed)


def should_queue_human_review(parsed: ParsedMetadata) -> tuple[bool, list[str]]:
    reasons: list[str] = list(parsed.review_reasons)
    if 'duplicate_review' in parsed.workflow_tags:
        reasons.append('in_duplicates_folder')
    if 'catalogue_number_only' in parsed.workflow_tags:
        reasons.append('track_name_missing')
    if parsed.artist and parsed.artist.confidence < 0.60:
        reasons.append('low_confidence_artist')
    if parsed.title and parsed.title.confidence < 0.60:
        reasons.append('low_confidence_title')
    if parsed.artist is None:
        reasons.append('no_artist')
    # Deduplicate preserving order
    seen: set[str] = set()
    reasons = [r for r in reasons if not (r in seen or seen.add(r))]
    return bool(reasons), reasons
