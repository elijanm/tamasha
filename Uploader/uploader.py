import os
import time
import queue
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv

import boto3
from botocore.config import Config
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from tqdm import tqdm

load_dotenv()

ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID")
ACCESS_KEY = os.getenv("R2_ACCESS_KEY_ID")
SECRET_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
BUCKET = os.getenv("R2_BUCKET")
LOCAL_DIR = Path(os.getenv("LOCAL_MUSIC_DIR", ".")).resolve()
R2_PREFIX = os.getenv("R2_PREFIX", "music").strip("/")
MAX_WORKERS = int(os.getenv("MAX_WORKERS", "4"))

ALLOWED_EXTENSIONS = {
    # audio
    ".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".wma", ".aiff",

    # images / artwork
    ".jpg", ".jpeg", ".png", ".webp", ".gif",

    # docs / metadata
    ".pdf", ".doc", ".docx", ".txt", ".rtf", ".md", ".csv", ".json", ".xml",

    # archives
    ".zip", ".rar", ".7z",
}

endpoint = f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com"

from boto3.s3.transfer import TransferConfig

TRANSFER_CONFIG = TransferConfig(
    multipart_threshold=16 * 1024 * 1024,
    multipart_chunksize=32 * 1024 * 1024,
    max_concurrency=4,
    use_threads=True,
)

s3 = boto3.client(
    "s3",
    endpoint_url=endpoint,
    aws_access_key_id=ACCESS_KEY,
    aws_secret_access_key=SECRET_KEY,
    config=Config(
        signature_version="s3v4",
        retries={"max_attempts": 5, "mode": "standard"},
        max_pool_connections=MAX_WORKERS + 4,
    ),
    region_name="auto",
)

upload_queue = queue.Queue(maxsize=1000)
seen_recently = {}
seen_lock = threading.Lock()

def remote_file_matches(path: Path, key: str) -> bool:
    try:
        local_size = path.stat().st_size

        response = s3.head_object(
            Bucket=BUCKET,
            Key=key,
        )

        remote_size = response.get("ContentLength", -1)

        return remote_size == local_size

    except s3.exceptions.ClientError as e:
        code = e.response.get("Error", {}).get("Code")
        if code in ("404", "NoSuchKey", "NotFound"):
            return False
        raise

def normalize_part(name: str) -> str:
    return "_".join(name.strip().split())


def make_r2_key(file_path: Path) -> str:
    relative = file_path.relative_to(LOCAL_DIR)
    parts = [normalize_part(part) for part in relative.parts]

    if R2_PREFIX:
        parts = [R2_PREFIX] + parts

    return "/".join(parts)

def is_allowed_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() in ALLOWED_EXTENSIONS


def wait_until_file_stable(path: Path, checks=3, delay=1.5) -> bool:
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

def upload_file(path: Path, progress=None):
    try:
        if not is_allowed_file(path):
            return

        if not wait_until_file_stable(path):
            return

        key = make_r2_key(path)
        file_size = path.stat().st_size

        if remote_file_matches(path, key):
            print(f"Skipping existing: {key}")

            if progress:
                progress.update(file_size)

            return

        print(f"Uploading: {key}")

        s3.upload_file(
            Filename=str(path),
            Bucket=BUCKET,
            Key=key,
            Config=TRANSFER_CONFIG,
        )

        if progress:
            progress.update(file_size)

    except Exception as e:
        print(f"Upload failed for {path}: {e}")

def worker_loop(progress=None):
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        while True:
            path = upload_queue.get()
            if path is None:
                break

            executor.submit(upload_file, path, progress)
            upload_queue.task_done()



def enqueue_file(path: Path):
    path = path.resolve()

    if not is_allowed_file(path):
        return

    now = time.time()

    with seen_lock:
        last = seen_recently.get(str(path), 0)
        if now - last < 3:
            return
        seen_recently[str(path)] = now

    upload_queue.put(path)

def initial_scan(progress):
    print(f"Scanning: {LOCAL_DIR}")

    files = [
        path for path in LOCAL_DIR.rglob("*")
        if is_allowed_file(path)
    ]

    total_bytes = sum(path.stat().st_size for path in files)

    progress.total = total_bytes
    progress.refresh()

    print(f"Found {len(files)} files")
    print(f"Total size: {total_bytes / (1024 ** 3):.2f} GB")

    for path in files:
        enqueue_file(path)
class MusicFolderHandler(FileSystemEventHandler):
    def on_created(self, event):
        if not event.is_directory:
            enqueue_file(Path(event.src_path))

    def on_modified(self, event):
        if not event.is_directory:
            enqueue_file(Path(event.src_path))

    def on_moved(self, event):
        if not event.is_directory:
            enqueue_file(Path(event.dest_path))


def main():
    if not all([ACCOUNT_ID, ACCESS_KEY, SECRET_KEY, BUCKET]):
        raise RuntimeError("Missing R2 credentials or bucket in .env")

    if not LOCAL_DIR.exists():
        raise RuntimeError(f"LOCAL_MUSIC_DIR does not exist: {LOCAL_DIR}")

    progress = tqdm(
        total=0,
        unit="B",
        unit_scale=True,
        unit_divisor=1024,
        desc="Uploading",
    )

    thread = threading.Thread(
        target=worker_loop,
        args=(progress,),
        daemon=True,
    )
    thread.start()

    initial_scan(progress)

    observer = Observer()
    observer.schedule(MusicFolderHandler(), str(LOCAL_DIR), recursive=True)
    observer.start()

    print(f"Watching for changes in: {LOCAL_DIR}")
    print(f"Using {MAX_WORKERS} upload workers")

    try:
        while True:
            time.sleep(2)
    except KeyboardInterrupt:
        print("Stopping...")
        observer.stop()

    observer.join()


if __name__ == "__main__":
    main()