"""
Tamasha Uploader v2 — Cloudflare R2 music uploader with beautiful TUI
"""
from __future__ import annotations

import os
import sys
import json
import time
import queue
import getpass
import argparse
import threading
import sqlite3
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from dotenv import load_dotenv
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from boto3.s3.transfer import TransferConfig
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from rich.console import Console
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text
from rich.rule import Rule
from rich.align import Align
from rich import box

try:
    from rich.group import Group
except ImportError:
    class Group:  # type: ignore[no-redef]
        def __init__(self, *renderables):
            self._renderables = renderables
        def __rich_console__(self, console, options):
            for r in self._renderables:
                yield r

VERSION = "2.0.0"
BRAND   = "violet"

LOGO = """\
  ████████╗ █████╗ ███╗   ███╗ █████╗ ███████╗██╗  ██╗ █████╗
  ╚══██╔══╝██╔══██╗████╗ ████║██╔══██╗██╔════╝██║  ██║██╔══██╗
     ██║   ███████║██╔████╔██║███████║███████╗███████║███████║
     ██║   ██╔══██║██║╚██╔╝██║██╔══██║╚════██║██╔══██║██╔══██║
     ██║   ██║  ██║██║ ╚═╝ ██║██║  ██║███████║██║  ██║██║  ██║
     ╚═╝   ╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝\
"""

# ── Source directory config ────────────────────────────────────────────────────

@dataclass
class SourceDir:
    path:   Path
    bucket: str
    prefix: str

    def r2_key(self, file_path: Path) -> str:
        relative = file_path.relative_to(self.path)
        parts    = [normalize_part(p) for p in relative.parts]
        if self.prefix:
            parts = [self.prefix] + parts
        return "/".join(parts)

    def to_dict(self) -> dict:
        return {"path": str(self.path), "bucket": self.bucket, "prefix": self.prefix}

    @staticmethod
    def from_entry(entry, default_bucket: str, default_prefix: str) -> "SourceDir":
        if isinstance(entry, str):
            return SourceDir(Path(entry).resolve(), default_bucket, default_prefix)
        return SourceDir(
            Path(entry["path"]).resolve(),
            entry.get("bucket", default_bucket),
            entry.get("prefix", default_prefix),
        )


# ── Terminal helpers ───────────────────────────────────────────────────────────

_ORIG_TERM    = None
_TERM_FD: int = -1

if sys.platform != "win32":
    import tty
    import termios
    import select as _select
    try:
        _TERM_FD   = sys.stdin.fileno()
        _ORIG_TERM = termios.tcgetattr(_TERM_FD)
    except Exception:
        pass


def _clear_screen() -> None:
    os.system("cls" if sys.platform == "win32" else "clear")


def _activate_raw_kb() -> None:
    if _ORIG_TERM and sys.platform != "win32":
        try:
            tty.setcbreak(_TERM_FD)
        except Exception:
            pass


def _restore_normal_kb() -> None:
    if _ORIG_TERM and sys.platform != "win32":
        try:
            termios.tcsetattr(_TERM_FD, termios.TCSADRAIN, _ORIG_TERM)
        except Exception:
            pass


# ── Keyboard reader ────────────────────────────────────────────────────────────

_key_queue: "queue.Queue[str]" = queue.Queue()
_kbd_stop   = threading.Event()
_kbd_active = threading.Event()
_kbd_active.set()


def _start_keyboard_reader() -> None:
    _activate_raw_kb()
    threading.Thread(target=_keyboard_loop, daemon=True).start()


def _keyboard_loop() -> None:
    if sys.platform == "win32":
        import msvcrt
        while not _kbd_stop.is_set():
            if not _kbd_active.is_set():
                time.sleep(0.05)
                continue
            if msvcrt.kbhit():
                ch = msvcrt.getch()
                if ch in (b"\x00", b"\xe0"):
                    if msvcrt.kbhit():
                        sc = msvcrt.getch()
                        _key_queue.put(
                            {"H": "up", "P": "down", "M": "right", "K": "left"}.get(
                                sc.decode("cp437", errors="ignore"), ""
                            )
                        )
                else:
                    try:
                        _key_queue.put(ch.decode("cp437").lower())
                    except Exception:
                        pass
            else:
                time.sleep(0.05)
    else:
        while not _kbd_stop.is_set():
            if not _kbd_active.is_set():
                time.sleep(0.05)
                continue
            try:
                r, _, _ = _select.select([_TERM_FD], [], [], 0.1)
            except Exception:
                time.sleep(0.1)
                continue
            if not r or not _kbd_active.is_set():
                continue
            try:
                ch = os.read(_TERM_FD, 1)
            except Exception:
                continue
            if ch == b"\x1b":
                try:
                    r2, _, _ = _select.select([_TERM_FD], [], [], 0.03)
                    if r2:
                        seq = os.read(_TERM_FD, 2)
                        _key_queue.put(
                            {"[A": "up", "[B": "down", "[C": "right", "[D": "left"}.get(
                                seq.decode("utf-8", errors="ignore"), "esc"
                            )
                        )
                    else:
                        _key_queue.put("esc")
                except Exception:
                    _key_queue.put("esc")
            else:
                try:
                    _key_queue.put(ch.decode("utf-8").lower())
                except Exception:
                    pass


def _get_key() -> Optional[str]:
    try:
        return _key_queue.get_nowait()
    except queue.Empty:
        return None


def _pause_kbd() -> None:
    _kbd_active.clear()
    _restore_normal_kb()


def _resume_kbd() -> None:
    _activate_raw_kb()
    _kbd_active.set()


# ── Config ─────────────────────────────────────────────────────────────────────

CONFIG_DIR  = Path("~/.tamasha_uploader").expanduser()
CONFIG_PATH = CONFIG_DIR / "config.json"
_DEFAULTS   = {"r2_prefix": "music", "max_workers": 24, "max_retries": 3, "source_dirs": []}


def load_config() -> Optional[dict]:
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text())
        except Exception:
            return None
    return None


def save_config(cfg: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2))
    CONFIG_PATH.chmod(0o600)


def _prompt(label: str, default: str = "", secret: bool = False) -> str:
    hint   = (" [hidden]" if secret else f" [{default}]") if default else ""
    prompt = f"  {label}{hint} : "
    while True:
        val = (getpass.getpass(prompt) if secret else input(prompt)).strip()
        if val:
            return val
        if default:
            return default
        print("    (required)")


def _hr(char: str = "─", width: int = 62) -> None:
    print(char * width)


def _print_logo() -> None:
    _clear_screen()
    print()
    print(LOGO)
    sub = f"Uploader v{VERSION}  ·  Music Archival Platform"
    print(" " * max((62 - len(sub)) // 2, 2) + sub)
    print()


def _ask_source_dir(default_bucket: str, default_prefix: str, idx: int) -> Optional[SourceDir]:
    """Interactive prompt for one source directory. Returns None to stop."""
    raw = input(f"  Directory {idx} (blank to finish) : ").strip()
    if not raw:
        return None
    path = Path(raw).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        print(f"  ✗  Not a valid directory: {path}")
        return _ask_source_dir(default_bucket, default_prefix, idx)
    bucket = _prompt(f"    Bucket       ", default_bucket)
    prefix = _prompt(f"    Prefix       ", default_prefix)
    print(f"  ✓  Added: {path}  →  {bucket}/{prefix}")
    return SourceDir(path, bucket, prefix)


def run_wizard(existing: Optional[dict] = None) -> dict:
    cfg = dict(_DEFAULTS)
    if existing:
        cfg.update(existing)

    _print_logo()
    _hr("═")
    print("  Setup Wizard")
    _hr("═")
    print(f"  Config  →  {CONFIG_PATH}")
    print(f"  All credential fields are hidden as you type.\n")

    _hr()
    print("  Credentials")
    _hr()
    cfg["r2_account_id"]        = _prompt("R2 Account ID    ", cfg.get("r2_account_id", ""),        secret=True)
    cfg["r2_access_key_id"]     = _prompt("R2 Access Key ID ", cfg.get("r2_access_key_id", ""),     secret=True)
    cfg["r2_secret_access_key"] = _prompt("R2 Secret Key    ", cfg.get("r2_secret_access_key", ""), secret=True)
    cfg["r2_bucket"]            = _prompt("Default Bucket   ", cfg.get("r2_bucket", ""),            secret=True)
    cfg["r2_prefix"]            = _prompt("Default Prefix   ", cfg.get("r2_prefix", "music"))
    print()

    _hr()
    print("  Source Directories")
    _hr()
    print("  Each directory can upload to a different bucket.")
    print("  Leave blank to accept the default bucket/prefix shown above.\n")

    existing_dirs: list[dict] = []
    for entry in cfg.get("source_dirs", []):
        if isinstance(entry, str):
            existing_dirs.append({"path": entry, "bucket": cfg["r2_bucket"], "prefix": cfg["r2_prefix"]})
        else:
            existing_dirs.append(entry)

    if existing_dirs:
        print("  Existing directories:")
        for i, d in enumerate(existing_dirs, 1):
            print(f"    {i}. {d['path']}  →  {d['bucket']}/{d['prefix']}")
        print()
        if input("  Keep existing? [Y/n] : ").strip().lower() == "n":
            existing_dirs = []

    dirs: list[dict] = list(existing_dirs)
    idx = len(dirs) + 1
    while True:
        src = _ask_source_dir(cfg["r2_bucket"], cfg["r2_prefix"], idx)
        if src is None:
            if not dirs:
                print("  (at least one directory is required)")
                continue
            break
        dirs.append(src.to_dict())
        idx += 1
    cfg["source_dirs"] = dirs
    print()

    _hr()
    print("  Performance")
    _hr()
    cfg["max_workers"] = int(_prompt("Max parallel uploads", str(cfg.get("max_workers", 24))))
    cfg["max_retries"] = int(_prompt("Max retries per file", str(cfg.get("max_retries", 3))))
    print()

    _hr()
    print("  Access PIN")
    _hr()
    print("  Required on every startup. Default: 1234\n")
    cfg["pin"] = _prompt("PIN (4+ chars)       ", cfg.get("pin", "1234"), secret=True)
    print()

    _hr()
    save_config(cfg)
    print(f"  ✓  Config saved to {CONFIG_PATH}")
    _hr()
    print()
    _clear_screen()
    return cfg


def get_config(force_wizard: bool = False) -> dict:
    env_cfg = {
        "r2_account_id":        os.getenv("R2_ACCOUNT_ID"),
        "r2_access_key_id":     os.getenv("R2_ACCESS_KEY_ID"),
        "r2_secret_access_key": os.getenv("R2_SECRET_ACCESS_KEY"),
        "r2_bucket":            os.getenv("R2_BUCKET"),
        "r2_prefix":            os.getenv("R2_PREFIX", "music"),
        "max_workers":          int(os.getenv("MAX_WORKERS", "24")),
        "max_retries":          int(os.getenv("MAX_RETRIES", "3")),
        "source_dirs":          [d for d in [os.getenv("LOCAL_MUSIC_DIR")] if d],
        "pin":                  os.getenv("UPLOADER_PIN", "1234"),
    }
    if not force_wizard and all([
        env_cfg["r2_account_id"], env_cfg["r2_access_key_id"],
        env_cfg["r2_secret_access_key"], env_cfg["r2_bucket"],
        env_cfg["source_dirs"],
    ]):
        return env_cfg
    if not force_wizard:
        existing = load_config()
        if existing and all([
            existing.get("r2_account_id"), existing.get("r2_access_key_id"),
            existing.get("r2_secret_access_key"), existing.get("r2_bucket"),
            existing.get("source_dirs"),
        ]):
            return existing
    return run_wizard(load_config() if not force_wizard else None)


# ── Bootstrap ──────────────────────────────────────────────────────────────────

load_dotenv()

_ap = argparse.ArgumentParser(description="Tamasha Uploader")
_ap.add_argument("--setup",   action="store_true", help="Re-run the setup wizard")
_ap.add_argument("--add-dir", metavar="PATH",       help="Add a source directory and exit")
_args = _ap.parse_args()


if _args.add_dir:
    _ecfg = load_config() or {}
    _p    = Path(_args.add_dir).expanduser().resolve()
    if not _p.exists() or not _p.is_dir():
        print(f"✗  Not a valid directory: {_p}")
        sys.exit(1)
    _db  = _ecfg.get("r2_bucket", "")
    _dp  = _ecfg.get("r2_prefix", "music")
    _existing_paths = [
        (e if isinstance(e, str) else e["path"]) for e in _ecfg.get("source_dirs", [])
    ]
    if str(_p) in _existing_paths:
        print(f"Already in config: {_p}")
    else:
        bucket = input(f"  Bucket [{_db}] : ").strip() or _db
        prefix = input(f"  Prefix [{_dp}] : ").strip() or _dp
        dirs   = list(_ecfg.get("source_dirs", []))
        dirs.append({"path": str(_p), "bucket": bucket, "prefix": prefix})
        _ecfg["source_dirs"] = dirs
        save_config(_ecfg)
        print(f"✓  Added: {_p}  →  {bucket}/{prefix}")
    sys.exit(0)

CFG         = get_config(force_wizard=_args.setup)
ACCOUNT_ID  = CFG["r2_account_id"]
ACCESS_KEY  = CFG["r2_access_key_id"]
SECRET_KEY  = CFG["r2_secret_access_key"]
DEFAULT_BUCKET = CFG.get("r2_bucket", "")
DEFAULT_PREFIX = CFG.get("r2_prefix", "music").strip("/")
MAX_WORKERS = int(CFG.get("max_workers", 24))
MAX_RETRIES = int(CFG.get("max_retries", 3))
SOURCE_DIRS: list[SourceDir] = [
    SourceDir.from_entry(e, DEFAULT_BUCKET, DEFAULT_PREFIX)
    for e in CFG.get("source_dirs", [])
]

_default_cache = f"~/.tamasha_uploader/{DEFAULT_BUCKET or 'default'}_cache.db"
CACHE_DB_PATH  = Path(CFG.get("cache_db", _default_cache)).expanduser()

ALLOWED_EXTENSIONS = {
    ".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".wma", ".aiff",
    ".jpg", ".jpeg", ".png", ".webp", ".gif",
    ".pdf", ".doc", ".docx", ".txt", ".rtf", ".md", ".csv", ".json", ".xml",
    ".zip", ".rar", ".7z",
}

TRANSFER_CONFIG = TransferConfig(
    multipart_threshold=8 * 1024 * 1024,
    multipart_chunksize=8 * 1024 * 1024,
    max_concurrency=8,
    use_threads=True,
)

s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com",
    aws_access_key_id=ACCESS_KEY,
    aws_secret_access_key=SECRET_KEY,
    config=Config(
        signature_version="s3v4",
        retries={"max_attempts": 10, "mode": "adaptive"},
        max_pool_connections=MAX_WORKERS * 2,
    ),
    region_name="auto",
)

# ── SQLite ─────────────────────────────────────────────────────────────────────

_cache_lock = threading.Lock()
_cache_conn: Optional[sqlite3.Connection] = None


def _get_conn() -> sqlite3.Connection:
    global _cache_conn
    if _cache_conn is None:
        CACHE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(CACHE_DB_PATH), check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS uploaded_files (
                r2_key      TEXT    PRIMARY KEY,
                file_size   INTEGER NOT NULL,
                uploaded_at REAL    NOT NULL
            );
            CREATE TABLE IF NOT EXISTS upload_log (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                r2_key      TEXT    NOT NULL,
                file_path   TEXT    NOT NULL,
                status      TEXT    NOT NULL,
                error       TEXT,
                bytes       INTEGER DEFAULT 0,
                duration    REAL    DEFAULT 0,
                logged_at   REAL    NOT NULL
            );
            CREATE TABLE IF NOT EXISTS failed_files (
                r2_key      TEXT PRIMARY KEY,
                file_path   TEXT NOT NULL,
                base_dir    TEXT NOT NULL,
                bucket      TEXT NOT NULL DEFAULT '',
                error       TEXT,
                retries     INTEGER DEFAULT 0,
                failed_at   REAL NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                started_at   REAL NOT NULL,
                ended_at     REAL,
                files_done   INTEGER DEFAULT 0,
                files_failed INTEGER DEFAULT 0,
                bytes_done   INTEGER DEFAULT 0
            );
        """)
        conn.commit()
        _cache_conn = conn
    return _cache_conn


def _ckey(bucket: str, r2_key: str) -> str:
    return f"{bucket}\x00{r2_key}"


def cache_hit(bucket: str, r2_key: str, file_size: int) -> bool:
    with _cache_lock:
        row = _get_conn().execute(
            "SELECT file_size FROM uploaded_files WHERE r2_key=?", (_ckey(bucket, r2_key),)
        ).fetchone()
        return row is not None and row[0] == file_size


def cache_put(bucket: str, r2_key: str, file_size: int) -> None:
    with _cache_lock:
        _get_conn().execute(
            "INSERT OR REPLACE INTO uploaded_files (r2_key, file_size, uploaded_at) VALUES (?,?,?)",
            (_ckey(bucket, r2_key), file_size, time.time()),
        )
        _get_conn().commit()


def cache_evict(bucket: str, r2_key: str) -> None:
    with _cache_lock:
        _get_conn().execute("DELETE FROM uploaded_files WHERE r2_key=?", (_ckey(bucket, r2_key),))
        _get_conn().commit()


def cache_stats() -> tuple[int, int]:
    with _cache_lock:
        row = _get_conn().execute(
            "SELECT COUNT(*), COALESCE(SUM(file_size),0) FROM uploaded_files"
        ).fetchone()
        return row[0], row[1]


def _log_upload(r2_key: str, path: str, status: str, error: Optional[str], nbytes: int, dur: float) -> None:
    with _cache_lock:
        _get_conn().execute(
            "INSERT INTO upload_log (r2_key,file_path,status,error,bytes,duration,logged_at)"
            " VALUES (?,?,?,?,?,?,?)",
            (r2_key, path, status, error, nbytes, dur, time.time()),
        )
        _get_conn().commit()


def _add_failed(r2_key: str, file_path: str, base_dir: str, bucket: str, error: str, retries: int) -> None:
    with _cache_lock:
        _get_conn().execute(
            "INSERT OR REPLACE INTO failed_files (r2_key,file_path,base_dir,bucket,error,retries,failed_at)"
            " VALUES (?,?,?,?,?,?,?)",
            (r2_key, file_path, base_dir, bucket, error, retries, time.time()),
        )
        _get_conn().commit()


def get_failed_files() -> list[dict]:
    with _cache_lock:
        rows = _get_conn().execute(
            "SELECT r2_key,file_path,base_dir,bucket,error,retries,failed_at FROM failed_files"
            " ORDER BY failed_at DESC LIMIT 100"
        ).fetchall()
        return [
            {"r2_key": r[0], "file_path": r[1], "base_dir": r[2],
             "bucket": r[3], "error": r[4], "retries": r[5], "failed_at": r[6]}
            for r in rows
        ]


def clear_failed_files() -> int:
    with _cache_lock:
        cur = _get_conn().execute("DELETE FROM failed_files")
        _get_conn().commit()
        return cur.rowcount


def start_session() -> int:
    with _cache_lock:
        cur = _get_conn().execute("INSERT INTO sessions (started_at) VALUES (?)", (time.time(),))
        _get_conn().commit()
        return cur.lastrowid  # type: ignore[return-value]


def end_session(sid: int, files_done: int, files_failed: int, bytes_done: int) -> None:
    with _cache_lock:
        _get_conn().execute(
            "UPDATE sessions SET ended_at=?,files_done=?,files_failed=?,bytes_done=? WHERE id=?",
            (time.time(), files_done, files_failed, bytes_done, sid),
        )
        _get_conn().commit()


def get_previous_incomplete() -> Optional[tuple]:
    with _cache_lock:
        return _get_conn().execute(
            "SELECT id,started_at,files_done FROM sessions WHERE ended_at IS NULL"
            " ORDER BY started_at DESC LIMIT 1"
        ).fetchone()


def get_upload_history(limit: int = 20) -> list[dict]:
    with _cache_lock:
        rows = _get_conn().execute(
            "SELECT file_path,status,bytes,duration,logged_at FROM upload_log"
            " ORDER BY logged_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [
            {"file_path": r[0], "status": r[1], "bytes": r[2], "duration": r[3], "logged_at": r[4]}
            for r in rows
        ]


# ── Stats ──────────────────────────────────────────────────────────────────────

@dataclass
class FileProgress:
    path:       str
    name:       str
    size:       int
    bucket:     str
    bytes_done: int   = 0
    started:    float = field(default_factory=time.time)

    @property
    def pct(self) -> float:
        return self.bytes_done / self.size if self.size else 0.0

    @property
    def elapsed(self) -> float:
        return time.time() - self.started

    @property
    def speed(self) -> float:
        e = self.elapsed
        return self.bytes_done / e if e > 0.1 else 0.0


class UploadStats:
    def __init__(self) -> None:
        self._lock         = threading.Lock()
        self.files_done    = 0
        self.files_skipped = 0
        self.files_failed  = 0
        self.bytes_done    = 0
        self.total_files   = 0
        self.total_bytes   = 0
        self.start_time    = time.time()
        self.active: dict[str, FileProgress]         = {}
        self.recent: deque[tuple[str, str, int]]     = deque(maxlen=40)
        self._speed_buf: deque[tuple[float, int]]    = deque(maxlen=30)

    def start_file(self, path: str, size: int, bucket: str) -> None:
        with self._lock:
            self.active[path] = FileProgress(path=path, name=Path(path).name, size=size, bucket=bucket)

    def progress_file(self, path: str, chunk: int) -> None:
        with self._lock:
            if path in self.active:
                self.active[path].bytes_done += chunk
            self.bytes_done += chunk
            self._speed_buf.append((time.time(), self.bytes_done))

    def done_file(self, path: str, size: int, skipped: bool = False) -> None:
        with self._lock:
            self.active.pop(path, None)
            if skipped:
                self.files_skipped += 1
            else:
                self.files_done += 1
            self.recent.appendleft((Path(path).name, "skip" if skipped else "ok", size))

    def fail_file(self, path: str) -> None:
        with self._lock:
            self.active.pop(path, None)
            self.files_failed += 1
            self.recent.appendleft((Path(path).name, "fail", 0))

    def speed_bps(self) -> float:
        with self._lock:
            buf = list(self._speed_buf)
        if len(buf) < 2:
            return 0.0
        dt = buf[-1][0] - buf[0][0]
        db = buf[-1][1] - buf[0][1]
        return db / dt if dt > 0.1 else 0.0

    def eta_secs(self) -> Optional[float]:
        spd = self.speed_bps()
        with self._lock:
            remaining = self.total_bytes - self.bytes_done
        if spd > 0 and remaining > 0:
            return remaining / spd
        return None

    def elapsed(self) -> float:
        return time.time() - self.start_time

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "files_done":    self.files_done,
                "files_skipped": self.files_skipped,
                "files_failed":  self.files_failed,
                "bytes_done":    self.bytes_done,
                "total_files":   self.total_files,
                "total_bytes":   self.total_bytes,
                "active":        dict(self.active),
                "recent":        list(self.recent),
            }


# ── Format helpers ─────────────────────────────────────────────────────────────

def _fmt_bytes(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


def _fmt_speed(bps: float) -> str:
    return f"{_fmt_bytes(bps)}/s"


def _fmt_eta(secs: Optional[float]) -> str:
    if secs is None or secs < 0:
        return "--:--"
    h, rem = divmod(int(secs), 3600)
    m, s   = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"


def _fmt_elapsed(secs: float) -> str:
    h, rem = divmod(int(secs), 3600)
    m, s   = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}"


def _trunc(s: str, n: int) -> str:
    return s if len(s) <= n else "…" + s[-(n - 1):]


# ── Upload engine ──────────────────────────────────────────────────────────────

upload_queue: "queue.Queue[tuple[Path, SourceDir, int] | None]" = queue.Queue(maxsize=20000)
seen_recently: dict[str, float] = {}
seen_lock      = threading.Lock()
pause_event    = threading.Event()
pause_event.set()

_stats: Optional[UploadStats]   = None
_observer: Optional[Observer]   = None


def normalize_part(name: str) -> str:
    return "_".join(name.strip().split())


def is_allowed_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in ALLOWED_EXTENSIONS


def wait_until_stable(path: Path, checks: int = 3, delay: float = 1.5) -> bool:
    last = -1
    for _ in range(checks):
        if not path.exists():
            return False
        sz = path.stat().st_size
        if sz == last:
            return True
        last = sz
        time.sleep(delay)
    return True


def already_on_r2(src: SourceDir, r2_key: str, file_size: int) -> bool:
    if cache_hit(src.bucket, r2_key, file_size):
        return True
    try:
        resp = s3.head_object(Bucket=src.bucket, Key=r2_key)
        if resp.get("ContentLength", -1) == file_size:
            cache_put(src.bucket, r2_key, file_size)
            return True
        return False
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


def upload_file(path: Path, src: SourceDir, retry_count: int) -> None:
    if not is_allowed_file(path):
        return

    r2_key   = src.r2_key(path)
    filesize = path.stat().st_size
    t0       = time.time()

    if _stats:
        _stats.start_file(str(path), filesize, src.bucket)

    try:
        if already_on_r2(src, r2_key, filesize):
            if _stats:
                _stats.done_file(str(path), filesize, skipped=True)
            _log_upload(r2_key, str(path), "skipped", None, filesize, 0)
            return

        def _cb(chunk: int) -> None:
            if _stats:
                _stats.progress_file(str(path), chunk)

        s3.upload_file(
            Filename=str(path),
            Bucket=src.bucket,
            Key=r2_key,
            Config=TRANSFER_CONFIG,
            Callback=_cb,
        )
        cache_put(src.bucket, r2_key, filesize)
        duration = time.time() - t0

        if _stats:
            _stats.done_file(str(path), filesize)
        _log_upload(r2_key, str(path), "ok", None, filesize, duration)

    except Exception as exc:
        err_str = str(exc)[:200]
        attempt = retry_count + 1
        if retry_count < MAX_RETRIES - 1:
            time.sleep(min(2 ** retry_count, 60))
            upload_queue.put((path, src, retry_count + 1))
        else:
            if _stats:
                _stats.fail_file(str(path))
            _add_failed(r2_key, str(path), str(src.path), src.bucket, err_str, attempt)
            _log_upload(r2_key, str(path), "failed", err_str, 0, 0)


def worker_loop() -> None:
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        while True:
            pause_event.wait()
            item = upload_queue.get()
            if item is None:
                break
            path, src, retry = item
            pool.submit(upload_file, path, src, retry)
            upload_queue.task_done()


def enqueue(path: Path, src: SourceDir, retry_count: int = 0) -> None:
    path = path.resolve()
    if not is_allowed_file(path):
        return
    now = time.time()
    with seen_lock:
        if retry_count == 0 and now - seen_recently.get(str(path), 0) < 3:
            return
        seen_recently[str(path)] = now
    upload_queue.put((path, src, retry_count))


def scan_source(src: SourceDir, stats: Optional[UploadStats] = None) -> int:
    """Scan one SourceDir and enqueue its files. Returns file count."""
    files = [p for p in src.path.rglob("*") if is_allowed_file(p)]
    if stats:
        stats.total_files += len(files)
        stats.total_bytes += sum(p.stat().st_size for p in files)
    for f in files:
        upload_queue.put((f, src, 0))
    return len(files)


def initial_scan(stats: UploadStats) -> None:
    all_files: list[tuple[Path, SourceDir]] = []
    for src in SOURCE_DIRS:
        for f in src.path.rglob("*"):
            if is_allowed_file(f):
                all_files.append((f, src))
    stats.total_files = len(all_files)
    stats.total_bytes = sum(p.stat().st_size for p, _ in all_files)
    for path, src in all_files:
        upload_queue.put((path, src, 0))


# ── Watchdog ───────────────────────────────────────────────────────────────────

class MusicFolderHandler(FileSystemEventHandler):
    def __init__(self, src: SourceDir) -> None:
        self.src = src

    def on_created(self, event):
        if not event.is_directory:
            p = Path(event.src_path)
            if wait_until_stable(p):
                enqueue(p, self.src)

    def on_modified(self, event):
        if not event.is_directory:
            p = Path(event.src_path).resolve()
            if wait_until_stable(p):
                try:
                    cache_evict(self.src.bucket, self.src.r2_key(p))
                except Exception:
                    pass
                enqueue(p, self.src)

    def on_moved(self, event):
        if not event.is_directory:
            enqueue(Path(event.dest_path), self.src)


# ── TUI rendering ──────────────────────────────────────────────────────────────

_console = Console()

MODE_DETAIL = "detail"
MODE_SIMPLE = "simple"


def _bar(pct: float, width: int = 36) -> Text:
    filled = max(0, min(width, int(width * pct)))
    t = Text()
    t.append("█" * filled,           style=f"bold {BRAND}")
    t.append("░" * (width - filled),  style="dim")
    return t


def _render_header(paused: bool) -> Table:
    t = Table.grid(expand=True, padding=(0, 1))
    t.add_column(ratio=2)
    t.add_column(ratio=1, justify="center")
    t.add_column(ratio=1, justify="right")

    title = Text()
    title.append("◈ ", style=f"bold {BRAND}")
    title.append("TAMASHA UPLOADER", style=f"bold {BRAND}")
    title.append(f"  v{VERSION}", style="dim")

    status = (
        Text(" ⏸  PAUSED ", style="bold black on yellow")
        if paused else
        Text(f" ▶  UPLOADING ", style=f"bold white on {BRAND}")
    )

    hint = Text()
    hint.append("[P]", style=f"bold {BRAND}")
    hint.append(" Pause  ", style="dim")
    hint.append("[M]", style=f"bold {BRAND}")
    hint.append(" Menu  ", style="dim")
    hint.append("[Q]", style=f"bold {BRAND}")
    hint.append(" Quit", style="dim")

    t.add_row(title, status, hint)
    return t


def _render_progress(stats: UploadStats, paused: bool) -> Panel:
    sn      = stats.snapshot()
    total_b = max(sn["total_bytes"], 1)
    pct     = min(sn["bytes_done"] / total_b, 1.0)
    speed   = stats.speed_bps()
    eta     = stats.eta_secs()

    bar_grid = Table.grid(expand=True, padding=(0, 1))
    bar_grid.add_column(width=8,  justify="right", no_wrap=True)
    bar_grid.add_column(ratio=1)
    bar_grid.add_column(width=24, justify="right", no_wrap=True)
    bar_grid.add_row(
        Text(f"{pct * 100:5.1f}%", style=f"bold {BRAND}"),
        _bar(pct),
        Text(f"{_fmt_bytes(sn['bytes_done'])} / {_fmt_bytes(sn['total_bytes'])}", style="dim white"),
    )

    stats_grid = Table.grid(expand=True, padding=(0, 2))
    stats_grid.add_column(ratio=1)
    stats_grid.add_column(ratio=1, justify="center")
    stats_grid.add_column(ratio=1, justify="right")

    left = Text()
    left.append(f"✓ {sn['files_done']:,}", style="bold green")
    left.append("  skip ", style="dim")
    left.append(f"{sn['files_skipped']:,}", style="dim")
    if sn["files_failed"]:
        left.append("  ✗ ", style="dim")
        left.append(f"{sn['files_failed']:,}", style="bold red")

    center = Text(f"of {sn['total_files']:,} files", style="dim white", justify="center")

    right = Text(justify="right")
    right.append(_fmt_speed(speed), style="bold green" if speed > 0 else "dim")
    right.append("  ETA ", style="dim")
    right.append(_fmt_eta(eta), style="cyan")
    right.append("  ⏱ ", style="dim")
    right.append(_fmt_elapsed(stats.elapsed()), style="dim white")

    stats_grid.add_row(left, center, right)

    return Panel(
        Group(bar_grid, stats_grid),
        title="[bold]Progress[/]",
        border_style="yellow" if paused else BRAND,
        padding=(0, 1),
    )


def _render_active(stats: UploadStats) -> Optional[Panel]:
    sn     = stats.snapshot()
    active = sn["active"]
    if not active:
        return None

    t = Table(box=None, padding=(0, 1), show_header=False, expand=True)
    t.add_column(width=24, no_wrap=True)
    t.add_column(width=12, no_wrap=True)
    t.add_column(width=14, no_wrap=True, justify="right")
    t.add_column(width=10, justify="right", no_wrap=True)
    t.add_column(width=14, justify="right", no_wrap=True)

    for fp in list(active.values())[:6]:
        bar_w  = 12
        filled = int(bar_w * fp.pct)
        mini   = Text()
        mini.append("█" * filled,          style=BRAND)
        mini.append("░" * (bar_w - filled), style="dim")

        t.add_row(
            Text(_trunc(fp.name, 22), style="white"),
            mini,
            Text(f"{_fmt_bytes(fp.bytes_done)}/{_fmt_bytes(fp.size)}", style="dim"),
            Text(_fmt_speed(fp.speed), style="green"),
            Text(_trunc(fp.bucket, 12), style=f"dim {BRAND}"),
        )

    return Panel(
        t,
        title=f"[bold]Active[/] [dim]· {len(active)} uploading[/]",
        border_style="dim",
        padding=(0, 0),
    )


def _render_log(stats: UploadStats) -> Panel:
    sn     = stats.snapshot()
    recent = sn["recent"]

    t = Table(box=None, padding=(0, 1), show_header=False, expand=True)
    t.add_column(width=2,  no_wrap=True)
    t.add_column(ratio=1,  no_wrap=True)
    t.add_column(width=10, justify="right", no_wrap=True)

    for name, status, size in list(recent)[:14]:
        if status == "ok":
            icon, name_s = Text("✓", style="green"), "white"
        elif status == "skip":
            icon, name_s = Text("↩", style="dim"), "dim"
        else:
            icon, name_s = Text("✗", style="bold red"), "red"
        t.add_row(icon, Text(_trunc(name, 55), style=name_s), Text(_fmt_bytes(size) if size else "", style="dim"))

    if not recent:
        t.add_row(Text(""), Text("[dim]―  waiting for uploads  ―[/]"), Text(""))

    return Panel(t, title="[bold]Activity[/]", border_style="dim", padding=(0, 0))


def _render_sources() -> Panel:
    cached_files, cached_bytes = cache_stats()

    meta = Table(box=None, padding=(0, 1), show_header=False, expand=True)
    meta.add_column(width=10, no_wrap=True)
    meta.add_column(ratio=1,  no_wrap=True)
    meta.add_row(Text("Config",  style="dim"), Text(str(CONFIG_PATH),  style="white"))
    meta.add_row(Text("Cache",   style="dim"), Text(
        f"{CACHE_DB_PATH}  "
        f"[dim]({cached_files:,} files / {_fmt_bytes(cached_bytes)} cached)[/]",
        style="white",
    ))
    meta.add_row(Text("Workers", style="dim"), Text(
        f"{MAX_WORKERS} parallel  •  retries: {MAX_RETRIES}", style="white"
    ))

    dirs = Table(box=None, padding=(0, 1), show_header=False, expand=True)
    dirs.add_column(width=3,  no_wrap=True)
    dirs.add_column(ratio=2,  no_wrap=True)
    dirs.add_column(ratio=1,  no_wrap=True)
    dirs.add_column(width=9,  justify="right", no_wrap=True)

    for i, src in enumerate(SOURCE_DIRS, 1):
        dirs.add_row(
            Text(f"{i}.", style="dim"),
            Text(_trunc(str(src.path), 38), style="white"),
            Text(f"{src.bucket}/{src.prefix}", style=f"dim {BRAND}"),
            Text("watching", style=f"dim {BRAND}"),
        )

    return Panel(Group(meta, Rule(style="dim"), dirs), title="[bold]Sources & Config[/]",
                 border_style=BRAND, padding=(0, 0))


def _render_footer(mode: str, show_src: bool) -> Text:
    t = Text(justify="center")
    keys = [
        ("[P]", "Pause"),
        ("[S]", f"Mode:{mode[0].upper()}"),
        ("[D]", "Dirs" if not show_src else "Hide"),
        ("[R]", "Reports"),
        ("[M]", "Menu"),
        ("[Q]", "Quit"),
    ]
    for i, (k, label) in enumerate(keys):
        if i:
            t.append("  │  ", style="dim")
        t.append(k, style=f"bold {BRAND}")
        t.append(f" {label}", style="dim white")
    return t


def make_display(stats: UploadStats, paused: bool, mode: str, show_sources: bool) -> Group:
    parts: list = [_render_header(paused), _render_progress(stats, paused)]
    if mode == MODE_DETAIL:
        ap = _render_active(stats)
        if ap:
            parts.append(ap)
    parts.append(_render_log(stats))
    if show_sources:
        parts.append(_render_sources())
    parts.append(Rule(style="dim"))
    parts.append(Align(_render_footer(mode, show_sources), align="center"))
    return Group(*parts)


# ── Reports ────────────────────────────────────────────────────────────────────

def show_reports(stats: UploadStats) -> None:
    _pause_kbd()
    sn = stats.snapshot()
    _console.print()
    _console.rule(f"[bold {BRAND}]◈  Reports[/]")
    _console.print()

    t = Table(title="Session Statistics", box=box.SIMPLE_HEAVY, border_style=BRAND, min_width=44,
              title_style=f"bold {BRAND}")
    t.add_column("Metric", style="dim white", width=22)
    t.add_column("Value",  style="bold white", justify="right")
    t.add_row("Files uploaded",  f"[green]{sn['files_done']:,}[/]")
    t.add_row("Files skipped",   f"{sn['files_skipped']:,}")
    t.add_row("Files failed",    f"[{'bold red' if sn['files_failed'] else 'dim'}]{sn['files_failed']:,}[/]")
    t.add_row("Total files",     f"{sn['total_files']:,}")
    t.add_row("Data uploaded",   _fmt_bytes(sn["bytes_done"]))
    t.add_row("Total data",      _fmt_bytes(sn["total_bytes"]))
    t.add_row("Session time",    _fmt_elapsed(stats.elapsed()))
    t.add_row("Current speed",   _fmt_speed(stats.speed_bps()))
    _console.print(t)

    failed = get_failed_files()
    if failed:
        _console.print()
        ft = Table(title=f"Failed Files ({len(failed)})", box=box.SIMPLE_HEAVY, border_style="red",
                   min_width=60, title_style="bold red")
        ft.add_column("File",    style="white",   max_width=32)
        ft.add_column("Bucket",  style=f"{BRAND}", max_width=16)
        ft.add_column("Error",   style="dim red",  max_width=22)
        ft.add_column("Retries", style="yellow",   justify="right", width=7)
        for ff in failed[:20]:
            ft.add_row(
                _trunc(Path(ff["file_path"]).name, 30),
                _trunc(ff.get("bucket", ""), 14),
                _trunc(ff["error"] or "", 20),
                str(ff["retries"]),
            )
        _console.print(ft)

    history = get_upload_history(12)
    if history:
        _console.print()
        ht = Table(title="Recent Uploads", box=box.SIMPLE_HEAVY, border_style="dim", min_width=60)
        ht.add_column("File",   style="white",  max_width=36)
        ht.add_column("Status", width=8)
        ht.add_column("Size",   style="dim",    justify="right", width=10)
        ht.add_column("Speed",  style="green",  justify="right", width=10)
        for h in history:
            s_style = {"ok": "green", "skipped": "dim", "failed": "bold red"}.get(h["status"], "dim")
            spd     = _fmt_speed(h["bytes"] / h["duration"]) if h["duration"] else "--"
            ht.add_row(_trunc(Path(h["file_path"]).name, 34),
                       f"[{s_style}]{h['status']}[/]", _fmt_bytes(h["bytes"]), spd)
        _console.print(ht)

    _console.print()
    input("  Press Enter to return...")
    _resume_kbd()


# ── Add directory (live) ───────────────────────────────────────────────────────

def _menu_add_directory(stats: UploadStats) -> None:
    """Interactive add-directory from the menu. Scans and starts watching immediately."""
    _console.print()
    _console.rule(f"[bold {BRAND}]Add Source Directory[/]")
    _console.print()

    raw = input("  Path (blank to cancel) : ").strip()
    if not raw:
        return
    path = Path(raw).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        _console.print(f"  [red]✗  Not a valid directory: {path}[/]")
        return

    existing_paths = [str(s.path) for s in SOURCE_DIRS]
    if str(path) in existing_paths:
        _console.print(f"  [yellow]Already watching: {path}[/]")
        return

    bucket = input(f"  Bucket [{DEFAULT_BUCKET}] : ").strip() or DEFAULT_BUCKET
    prefix = input(f"  Prefix [{DEFAULT_PREFIX}] : ").strip() or DEFAULT_PREFIX

    src = SourceDir(path, bucket, prefix)
    SOURCE_DIRS.append(src)

    # Persist to config
    cfg = load_config() or dict(CFG)
    dirs = list(cfg.get("source_dirs", []))
    dirs.append(src.to_dict())
    cfg["source_dirs"] = dirs
    save_config(cfg)

    # Start watching
    if _observer:
        _observer.schedule(MusicFolderHandler(src), str(src.path), recursive=True)

    # Scan and enqueue
    count = scan_source(src, stats)
    _console.print(
        f"  [green]✓  Added: {path}  →  {bucket}/{prefix}[/]\n"
        f"  [dim]Enqueued {count:,} files for upload.[/]"
    )


# ── PIN verify ────────────────────────────────────────────────────────────────

def _verify_pin(live: Live) -> bool:
    """Pause live, ask PIN. Returns True if correct, False if cancelled/failed."""
    live.stop()
    _pause_kbd()
    expected = (load_config() or {}).get("pin", "1234")
    print()
    _hr("─")
    granted = False
    for attempt in range(1, 4):
        entered = getpass.getpass("  PIN : ").strip()
        if entered == expected:
            granted = True
            break
        left = 3 - attempt
        if left:
            print(f"  ✗  Wrong PIN — {left} attempt(s) left.")
        else:
            print("  ✗  Access denied.")
    _hr("─")
    print()
    _resume_kbd()
    live.start(refresh=True)
    return granted


# ── Menu ───────────────────────────────────────────────────────────────────────

def show_menu(
    live:          Live,
    stats:         UploadStats,
    paused_ref:    list[bool],
    mode_ref:      list[str],
    show_src_ref:  list[bool],
) -> bool:
    live.stop()
    _pause_kbd()

    while True:
        _console.print()
        _console.rule(f"[bold {BRAND}]◈  Menu[/]")
        _console.print()
        _console.print(f"  [bold {BRAND}][1][/]  {'[yellow]Resume uploads[/]' if paused_ref[0] else 'Pause uploads'}")
        _console.print(f"  [bold {BRAND}][2][/]  Toggle view  [dim](current: [cyan]{mode_ref[0]}[/])[/]")
        _console.print(f"  [bold {BRAND}][3][/]  {'Hide source dirs' if show_src_ref[0] else 'Show source dirs'}")
        _console.print(f"  [bold {BRAND}][4][/]  Reports")
        _console.print(f"  [bold {BRAND}][5][/]  Add source directory")
        _console.print(f"  [bold {BRAND}][6][/]  Retry failed files")
        _console.print(f"  [bold {BRAND}][7][/]  Clear failed file list")
        _console.print(f"  [bold {BRAND}][8][/]  Reconfigure (wizard)")
        _console.print(f"  [bold red][9][/]  Reset — wipe all config & start fresh")
        _console.print(f"  [bold {BRAND}][0][/]  Back")
        _console.print(f"  [bold red][Q][/]  Quit")
        _console.print()

        choice = input("  Choice : ").strip().lower()

        if choice == "1":
            if paused_ref[0]:
                paused_ref[0] = False
                pause_event.set()
                _console.print("  [bold green]▶  Resumed.[/]")
            else:
                paused_ref[0] = True
                pause_event.clear()
                _console.print("  [bold yellow]⏸  Paused.[/]")
            time.sleep(0.6)
            break

        elif choice == "2":
            mode_ref[0] = MODE_SIMPLE if mode_ref[0] == MODE_DETAIL else MODE_DETAIL
            _console.print(f"  [green]View → {mode_ref[0]}[/]")
            time.sleep(0.4)
            break

        elif choice == "3":
            show_src_ref[0] = not show_src_ref[0]
            _console.print(f"  [green]Source dirs {'shown' if show_src_ref[0] else 'hidden'}.[/]")
            time.sleep(0.4)
            break

        elif choice == "4":
            show_reports(stats)

        elif choice == "5":
            _menu_add_directory(stats)
            time.sleep(0.8)
            break

        elif choice == "6":
            failed = get_failed_files()
            if not failed:
                _console.print("  [green]No failed files.[/]")
            else:
                for ff in failed:
                    p   = Path(ff["file_path"])
                    src = SourceDir(Path(ff["base_dir"]), ff.get("bucket", DEFAULT_BUCKET), DEFAULT_PREFIX)
                    enqueue(p, src)
                clear_failed_files()
                _console.print(f"  [green]✓  Re-queued {len(failed)} file(s).[/]")
            time.sleep(1.0)
            break

        elif choice == "7":
            n = clear_failed_files()
            _console.print(f"  [green]✓  Cleared {n} record(s).[/]")
            time.sleep(0.7)
            break

        elif choice == "8":
            new_cfg = run_wizard(load_config())
            save_config(new_cfg)
            _console.print("[yellow]⚠  Restart to apply new credentials / directory settings.[/]")
            input("  Press Enter to continue...")
            break

        elif choice == "9":
            _console.print()
            _console.print("  [bold red]This will delete the config file and exit.[/]")
            _console.print("  [dim]Upload cache (skip list) will NOT be cleared.[/]")
            confirm = input("  Type  YES  to confirm : ").strip()
            if confirm == "YES":
                if CONFIG_PATH.exists():
                    CONFIG_PATH.unlink()
                    _console.print(f"  [green]✓  Deleted {CONFIG_PATH}[/]")
                else:
                    _console.print("  [dim]Config file was already absent.[/]")
                _console.print("  [dim]Run the uploader again to go through setup wizard.[/]")
                _resume_kbd()
                sys.exit(0)
            else:
                _console.print("  [dim]Reset cancelled.[/]")
                time.sleep(0.7)

        elif choice in ("0", ""):
            break

        elif choice == "q":
            _resume_kbd()
            live.start(refresh=True)
            return True

        else:
            _console.print("  [dim]Unknown option.[/]")

    _resume_kbd()
    live.start(refresh=True)
    return False


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    global _stats, _observer

    missing = [s for s in SOURCE_DIRS if not s.path.exists()]
    if missing:
        for s in missing:
            _console.print(f"[bold red]✗  Source directory not found: {s.path}[/]")
        sys.exit(1)

    _get_conn()
    cached_files, cached_bytes = cache_stats()
    session_id = start_session()
    prev = get_previous_incomplete()

    _console.print()
    _console.rule(f"[bold {BRAND}]◈  TAMASHA UPLOADER  v{VERSION}[/]")
    _console.print()

    if prev:
        pt = time.strftime("%Y-%m-%d %H:%M", time.localtime(prev[1]))
        _console.print(
            f"  [yellow]⚠  Previous session from {pt} interrupted "
            f"({prev[2]:,} files done). Already-uploaded files will be skipped.[/]\n"
        )

    _console.print("  [dim]Scanning...[/]")

    stats  = UploadStats()
    _stats = stats

    initial_scan(stats)

    _console.print(
        f"  [green]✓[/]  Found [bold]{stats.total_files:,}[/] files  "
        f"([dim]{_fmt_bytes(stats.total_bytes)}[/])"
    )
    _console.print()
    time.sleep(0.4)

    threading.Thread(target=worker_loop, daemon=True).start()

    _observer = Observer()
    for src in SOURCE_DIRS:
        _observer.schedule(MusicFolderHandler(src), str(src.path), recursive=True)
    _observer.start()

    _start_keyboard_reader()

    paused_ref   = [False]
    mode_ref     = [MODE_DETAIL]
    show_src_ref = [False]
    quit_app     = False

    with Live(
        make_display(stats, paused_ref[0], mode_ref[0], show_src_ref[0]),
        console=_console,
        refresh_per_second=4,
        screen=False,
        transient=False,
    ) as live:
        try:
            while not quit_app:
                key = _get_key()

                if key in ("p", " "):
                    if paused_ref[0]:
                        paused_ref[0] = False
                        pause_event.set()
                    else:
                        paused_ref[0] = True
                        pause_event.clear()

                elif key == "s":
                    mode_ref[0] = MODE_SIMPLE if mode_ref[0] == MODE_DETAIL else MODE_DETAIL

                elif key == "d":
                    if _verify_pin(live):
                        show_src_ref[0] = not show_src_ref[0]

                elif key in ("m", "esc"):
                    if _verify_pin(live):
                        quit_app = show_menu(live, stats, paused_ref, mode_ref, show_src_ref)

                elif key == "r":
                    live.stop()
                    _pause_kbd()
                    show_reports(stats)
                    _resume_kbd()
                    live.start(refresh=True)

                elif key in ("q", "\x03"):
                    quit_app = True
                    break

                live.update(make_display(stats, paused_ref[0], mode_ref[0], show_src_ref[0]))
                time.sleep(0.15)

        except KeyboardInterrupt:
            quit_app = True

    _kbd_stop.set()
    _restore_normal_kb()
    _observer.stop()
    _observer.join()

    sn = stats.snapshot()
    end_session(session_id, sn["files_done"], sn["files_failed"], sn["bytes_done"])

    _console.print()
    _console.rule("[bold]Session Complete[/]")
    _console.print(f"  [green]✓[/]  Uploaded:  [bold]{sn['files_done']:,}[/] files  ({_fmt_bytes(sn['bytes_done'])})")
    _console.print(f"  [dim]↩[/]  Skipped:   [bold]{sn['files_skipped']:,}[/] (already on R2)")
    if sn["files_failed"]:
        _console.print(f"  [red]✗[/]  Failed:    [bold]{sn['files_failed']:,}[/]  (retry from menu next run)")
    _console.print(f"  [dim]Time:      {_fmt_elapsed(stats.elapsed())}[/]")
    _console.print()


if __name__ == "__main__":
    main()
