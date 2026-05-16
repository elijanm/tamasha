import os
import sys
import json
import time
import queue
import getpass
import argparse
import threading
import sqlite3
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv

import boto3
from botocore.config import Config
from boto3.s3.transfer import TransferConfig
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from tqdm import tqdm

# ── Config file ───────────────────────────────────────────────────────────────

CONFIG_DIR  = Path("~/.tamasha_uploader").expanduser()
CONFIG_PATH = CONFIG_DIR / "config.json"

_DEFAULTS = {
    "r2_prefix":   "music",
    "max_workers": 24,
    "max_retries": 3,
    "source_dirs": [],
}


def load_config() -> dict | None:
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text())
        except Exception:
            return None
    return None


def save_config(cfg: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg, indent=2))
    CONFIG_PATH.chmod(0o600)  # owner-read/write only


def _prompt(label: str, default: str = "", secret: bool = False) -> str:
    prompt = f"  {label}"
    if default:
        prompt += f" [{default}]"
    prompt += " : "
    while True:
        val = (getpass.getpass(prompt) if secret else input(prompt)).strip()
        if val:
            return val
        if default:
            return default
        print("    (required — please enter a value)")


def _hr(char: str = "─", width: int = 62) -> None:
    print(char * width)


def run_wizard(existing: dict | None = None) -> dict:
    cfg = dict(_DEFAULTS)
    if existing:
        cfg.update(existing)

    print()
    _hr("═")
    print("  Tamasha Uploader — Setup Wizard")
    _hr("═")
    print(f"  Config will be saved to: {CONFIG_PATH}")
    print()

    # ── R2 Credentials ────────────────────────────────────────────────────────
    _hr()
    print("  Cloudflare R2 Credentials")
    _hr()
    cfg["r2_account_id"]       = _prompt("R2 Account ID    ", cfg.get("r2_account_id", ""))
    cfg["r2_access_key_id"]    = _prompt("R2 Access Key ID ", cfg.get("r2_access_key_id", ""))
    cfg["r2_secret_access_key"] = _prompt("R2 Secret Key    ", cfg.get("r2_secret_access_key", ""), secret=True)
    cfg["r2_bucket"]           = _prompt("R2 Bucket        ", cfg.get("r2_bucket", ""))
    cfg["r2_prefix"]           = _prompt("R2 Prefix        ", cfg.get("r2_prefix", "music"))
    print()

    # ── Source Directories ────────────────────────────────────────────────────
    _hr()
    print("  Source Directories")
    _hr()
    print("  Enter the full path to each music folder.")
    print("  Leave blank when done.\n")

    dirs: list[str] = list(cfg.get("source_dirs", []))

    if dirs:
        print("  Existing directories:")
        for i, d in enumerate(dirs, 1):
            print(f"    {i}. {d}")
        print()
        if input("  Keep existing directories? [Y/n] : ").strip().lower() == "n":
            dirs = []

    idx = len(dirs) + 1
    while True:
        raw = input(f"  Directory {idx} : ").strip()
        if not raw:
            if not dirs:
                print("  (at least one directory is required)")
                continue
            break
        path = Path(raw).expanduser().resolve()
        if not path.exists():
            print(f"  ✗  Path not found: {path}")
            continue
        if not path.is_dir():
            print(f"  ✗  Not a directory: {path}")
            continue
        if str(path) in dirs:
            print(f"  ✗  Already added: {path}")
            continue
        dirs.append(str(path))
        print(f"  ✓  Added: {path}")
        idx += 1

    cfg["source_dirs"] = dirs
    print()

    # ── Performance ───────────────────────────────────────────────────────────
    _hr()
    print("  Performance")
    _hr()
    cfg["max_workers"] = int(_prompt("Max parallel uploads", str(cfg.get("max_workers", 24))))
    cfg["max_retries"] = int(_prompt("Max retries per file", str(cfg.get("max_retries", 3))))
    print()

    # ── Save ──────────────────────────────────────────────────────────────────
    _hr()
    save_config(cfg)
    print(f"  ✓  Config saved to {CONFIG_PATH}")
    _hr()
    print()

    return cfg


def get_config(force_wizard: bool = False) -> dict:
    """Priority: env vars > config file > wizard."""
    # If all required env vars are present, use them without the file
    env_cfg = {
        "r2_account_id":        os.getenv("R2_ACCOUNT_ID"),
        "r2_access_key_id":     os.getenv("R2_ACCESS_KEY_ID"),
        "r2_secret_access_key": os.getenv("R2_SECRET_ACCESS_KEY"),
        "r2_bucket":            os.getenv("R2_BUCKET"),
        "r2_prefix":            os.getenv("R2_PREFIX", "music"),
        "max_workers":          int(os.getenv("MAX_WORKERS", "24")),
        "max_retries":          int(os.getenv("MAX_RETRIES", "3")),
        "source_dirs":          [d for d in [os.getenv("LOCAL_MUSIC_DIR")] if d],
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


# ── Bootstrap config ──────────────────────────────────────────────────────────

load_dotenv()

parser = argparse.ArgumentParser(description="Tamasha Uploader")
parser.add_argument("--setup", action="store_true", help="Re-run the setup wizard")
parser.add_argument("--add-dir", metavar="PATH", help="Add a new source directory and exit")
args = parser.parse_args()

if args.add_dir:
    cfg = load_config() or {}
    path = Path(args.add_dir).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        print(f"✗  Not a valid directory: {path}")
        sys.exit(1)
    dirs = cfg.get("source_dirs", [])
    if str(path) in dirs:
        print(f"Already in config: {path}")
    else:
        dirs.append(str(path))
        cfg["source_dirs"] = dirs
        save_config(cfg)
        print(f"✓  Added: {path}")
    sys.exit(0)

CFG = get_config(force_wizard=args.setup)

ACCOUNT_ID   = CFG["r2_account_id"]
ACCESS_KEY   = CFG["r2_access_key_id"]
SECRET_KEY   = CFG["r2_secret_access_key"]
BUCKET       = CFG["r2_bucket"]
R2_PREFIX    = CFG.get("r2_prefix", "music").strip("/")
MAX_WORKERS  = int(CFG.get("max_workers", 24))
MAX_RETRIES  = int(CFG.get("max_retries", 3))
SOURCE_DIRS  = [Path(d).resolve() for d in CFG.get("source_dirs", [])]

_default_cache = f"~/.tamasha_uploader/{BUCKET or 'default'}_cache.db"
CACHE_DB_PATH  = Path(CFG.get("cache_db", _default_cache)).expanduser()

ALLOWED_EXTENSIONS = {
    ".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".wma", ".aiff",
    ".jpg", ".jpeg", ".png", ".webp", ".gif",
    ".pdf", ".doc", ".docx", ".txt", ".rtf", ".md", ".csv", ".json", ".xml",
    ".zip", ".rar", ".7z",
}

# ── S3 / R2 client ────────────────────────────────────────────────────────────

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

# ── Local upload cache (SQLite) ───────────────────────────────────────────────

_cache_lock = threading.Lock()
_cache_conn: sqlite3.Connection | None = None


def _get_conn() -> sqlite3.Connection:
    global _cache_conn
    if _cache_conn is None:
        CACHE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(CACHE_DB_PATH), check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS uploaded_files (
                r2_key      TEXT    PRIMARY KEY,
                file_size   INTEGER NOT NULL,
                uploaded_at REAL    NOT NULL
            )
        """)
        conn.commit()
        _cache_conn = conn
    return _cache_conn


def cache_hit(r2_key: str, file_size: int) -> bool:
    with _cache_lock:
        row = _get_conn().execute(
            "SELECT file_size FROM uploaded_files WHERE r2_key = ?", (r2_key,)
        ).fetchone()
        return row is not None and row[0] == file_size


def cache_put(r2_key: str, file_size: int) -> None:
    with _cache_lock:
        _get_conn().execute(
            "INSERT OR REPLACE INTO uploaded_files (r2_key, file_size, uploaded_at) VALUES (?, ?, ?)",
            (r2_key, file_size, time.time()),
        )
        _get_conn().commit()


def cache_evict(r2_key: str) -> None:
    with _cache_lock:
        _get_conn().execute("DELETE FROM uploaded_files WHERE r2_key = ?", (r2_key,))
        _get_conn().commit()


def cache_stats() -> tuple[int, int]:
    with _cache_lock:
        row = _get_conn().execute(
            "SELECT COUNT(*), COALESCE(SUM(file_size), 0) FROM uploaded_files"
        ).fetchone()
        return row[0], row[1]


# ── Folder-level progress tracking ───────────────────────────────────────────

_folder_lock   = threading.Lock()
_folder_total: dict[str, int] = {}
_folder_done:  dict[str, int] = {}
_folder_seen:  set[str]       = set()
_active_folders: list[str]    = []
_active_lock   = threading.Lock()


def _folder_key(path: Path, base_dir: Path) -> str:
    """Relative folder path from its base_dir, prefixed with source dir name when multiple."""
    try:
        parts = path.relative_to(base_dir).parts
        folder = str(Path(*parts[:-1])) if len(parts) > 1 else "(root)"
        return f"{base_dir.name}/{folder}" if len(SOURCE_DIRS) > 1 else folder
    except Exception:
        return path.parent.name


def _truncate(label: str, maxlen: int = 38) -> str:
    return label if len(label) <= maxlen else "..." + label[-(maxlen - 3):]


def _on_folder_start(folder: str, progress: tqdm | None) -> None:
    tqdm.write(f"  ↳  {_truncate(folder)}/")
    with _active_lock:
        if folder not in _active_folders:
            _active_folders.append(folder)
        if progress:
            shown = _active_folders[-2:]
            progress.set_description("  ".join(_truncate(f, 22) for f in shown))


def _on_folder_done(folder: str, count: int, progress: tqdm | None) -> None:
    tqdm.write(f"  ✓  {_truncate(folder)}/  ({count} files)")
    with _active_lock:
        if folder in _active_folders:
            _active_folders.remove(folder)
        if progress:
            shown = _active_folders[-2:]
            progress.set_description(
                "  ".join(_truncate(f, 22) for f in shown) if shown else "Uploading"
            )


def _record_file_done(path: Path, base_dir: Path, progress: tqdm | None) -> None:
    folder = _folder_key(path, base_dir)
    with _folder_lock:
        first_in_folder = folder not in _folder_seen
        if first_in_folder:
            _folder_seen.add(folder)
        done = _folder_done.get(folder, 0) + 1
        _folder_done[folder] = done
        total = _folder_total.get(folder, 0)
        last_in_folder = total > 0 and done >= total
    if first_in_folder:
        _on_folder_start(folder, progress)
    if last_in_folder:
        _on_folder_done(folder, done, progress)


# ── Helpers ───────────────────────────────────────────────────────────────────

def normalize_part(name: str) -> str:
    return "_".join(name.strip().split())


def make_r2_key(file_path: Path, base_dir: Path) -> str:
    relative = file_path.relative_to(base_dir)
    parts = [normalize_part(p) for p in relative.parts]
    if R2_PREFIX:
        parts = [R2_PREFIX] + parts
    return "/".join(parts)


def is_allowed_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in ALLOWED_EXTENSIONS


def wait_until_stable(path: Path, checks: int = 3, delay: float = 1.5) -> bool:
    last_size = -1
    for _ in range(checks):
        if not path.exists():
            return False
        size = path.stat().st_size
        if size == last_size:
            return True
        last_size = size
        time.sleep(delay)
    return True


def already_on_r2(r2_key: str, file_size: int) -> bool:
    if cache_hit(r2_key, file_size):
        return True
    try:
        resp = s3.head_object(Bucket=BUCKET, Key=r2_key)
        if resp.get("ContentLength", -1) == file_size:
            cache_put(r2_key, file_size)
            return True
        return False
    except Exception as exc:
        code = getattr(getattr(exc, "response", None), "get", lambda *_: None)
        err_code = exc.response.get("Error", {}).get("Code", "") if hasattr(exc, "response") else ""
        if err_code in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


def _find_base_dir(path: Path) -> Path:
    """Find which SOURCE_DIR this path lives under."""
    for base in SOURCE_DIRS:
        try:
            path.relative_to(base)
            return base
        except ValueError:
            continue
    return SOURCE_DIRS[0]


# ── Upload queue ──────────────────────────────────────────────────────────────
# Queue items: (path, base_dir, retry_count)

upload_queue: queue.Queue[tuple[Path, Path, int] | None] = queue.Queue(maxsize=10000)
seen_recently: dict[str, float] = {}
seen_lock = threading.Lock()


def upload_file(path: Path, base_dir: Path, progress: tqdm | None, retry_count: int) -> None:
    try:
        if not is_allowed_file(path):
            return

        r2_key   = make_r2_key(path, base_dir)
        filesize = path.stat().st_size

        if already_on_r2(r2_key, filesize):
            if progress:
                progress.update(filesize)
            if retry_count == 0:
                _record_file_done(path, base_dir, progress)
            return

        s3.upload_file(
            Filename=str(path),
            Bucket=BUCKET,
            Key=r2_key,
            Config=TRANSFER_CONFIG,
        )
        cache_put(r2_key, filesize)

        if progress:
            progress.update(filesize)

        if retry_count == 0:
            _record_file_done(path, base_dir, progress)

    except Exception as exc:
        attempt = retry_count + 1
        tqdm.write(f"  ✗  [{attempt}/{MAX_RETRIES}] {path.name}: {exc}")
        if retry_count < MAX_RETRIES - 1:
            time.sleep(2 ** retry_count)
            upload_queue.put((path, base_dir, retry_count + 1))
        else:
            tqdm.write(f"  ✗  [GIVE UP] {path}")
            if retry_count == 0:
                _record_file_done(path, base_dir, progress)


def worker_loop(progress: tqdm | None = None) -> None:
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        while True:
            item = upload_queue.get()
            if item is None:
                break
            path, base_dir, retry_count = item
            pool.submit(upload_file, path, base_dir, progress, retry_count)
            upload_queue.task_done()


def enqueue(path: Path, base_dir: Path, retry_count: int = 0) -> None:
    path = path.resolve()
    if not is_allowed_file(path):
        return
    now = time.time()
    with seen_lock:
        if retry_count == 0 and now - seen_recently.get(str(path), 0) < 3:
            return
        seen_recently[str(path)] = now
    upload_queue.put((path, base_dir, retry_count))


# ── Initial scan ──────────────────────────────────────────────────────────────

def initial_scan(progress: tqdm) -> None:
    all_files: list[tuple[Path, Path]] = []  # (file, base_dir)

    for base_dir in SOURCE_DIRS:
        tqdm.write(f"Scanning: {base_dir}")
        files = [p for p in base_dir.rglob("*") if is_allowed_file(p)]
        for f in files:
            all_files.append((f, base_dir))

    total_bytes = sum(p.stat().st_size for p, _ in all_files)
    progress.total = total_bytes
    progress.refresh()

    with _folder_lock:
        for path, base_dir in all_files:
            fk = _folder_key(path, base_dir)
            _folder_total[fk] = _folder_total.get(fk, 0) + 1

    folder_count = len(_folder_total)
    tqdm.write(
        f"Found {len(all_files):,} files across {len(SOURCE_DIRS)} source(s) "
        f"in {folder_count:,} folders ({total_bytes / 1024 ** 3:.2f} GB)"
    )

    for path, base_dir in all_files:
        upload_queue.put((path, base_dir, 0))


# ── Watchdog handler ──────────────────────────────────────────────────────────

class MusicFolderHandler(FileSystemEventHandler):
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir

    def on_created(self, event):
        if not event.is_directory:
            path = Path(event.src_path)
            if wait_until_stable(path):
                enqueue(path, self.base_dir)

    def on_modified(self, event):
        if not event.is_directory:
            path = Path(event.src_path).resolve()
            if wait_until_stable(path):
                try:
                    cache_evict(make_r2_key(path, self.base_dir))
                except Exception:
                    pass
                enqueue(path, self.base_dir)

    def on_moved(self, event):
        if not event.is_directory:
            dest = Path(event.dest_path)
            enqueue(dest, self.base_dir)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    missing = [d for d in SOURCE_DIRS if not d.exists()]
    if missing:
        for d in missing:
            print(f"✗  Source directory not found: {d}")
        sys.exit(1)

    _get_conn()
    cached_files, cached_bytes = cache_stats()

    print(f"Config : {CONFIG_PATH}")
    print(f"Cache  : {CACHE_DB_PATH}")
    print(f"         {cached_files:,} files ({cached_bytes / 1024 ** 3:.2f} GB) cached — skip HEAD requests")
    print(f"Workers: {MAX_WORKERS} parallel  |  chunks: 8 MB  |  retries: {MAX_RETRIES}")
    print()

    for i, d in enumerate(SOURCE_DIRS, 1):
        print(f"  Source {i}: {d}")
    print()

    progress = tqdm(
        total=0,
        unit="B",
        unit_scale=True,
        unit_divisor=1024,
        desc="Uploading",
        dynamic_ncols=True,
        bar_format="{desc}: {percentage:3.0f}%  {n_fmt}/{total_fmt}  [{elapsed}<{remaining}  {rate_fmt}]",
    )

    worker = threading.Thread(target=worker_loop, args=(progress,), daemon=True)
    worker.start()

    initial_scan(progress)

    observer = Observer()
    for base_dir in SOURCE_DIRS:
        observer.schedule(MusicFolderHandler(base_dir), str(base_dir), recursive=True)
    observer.start()

    dir_list = "  ".join(str(d) for d in SOURCE_DIRS)
    tqdm.write(f"Watching: {dir_list}\n")

    try:
        while True:
            time.sleep(2)
    except KeyboardInterrupt:
        tqdm.write("\nStopping...")
        observer.stop()

    observer.join()


if __name__ == "__main__":
    main()
