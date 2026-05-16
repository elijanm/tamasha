# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

# Tamasha Engineering Context

Tamasha is a large-scale African music archival, streaming, analytics, metadata enrichment, artist ownership, and Skiza preparation platform.

---

# Current Codebase State

Only `Uploader/` contains working code. All other apps (`app.backend/`, `app.ui-reactjs/`, `app.worker/`) and infrastructure (`infra/`) are **planned but not yet scaffolded**. When generating new code, create the appropriate directory and scaffold from scratch following the architecture below.

---

# Development Commands

## Uploader

```bash
# Install dependencies
cd Uploader
pip install -r requirements.txt

# Run locally (requires .env with R2 credentials)
python uploader.py

# Build Windows EXE locally
pip install pyinstaller
pyinstaller --onefile uploader.py
# or using the spec file:
pyinstaller uploader.spec

# Generate a sample library for testing
bash Uploader/mockup.sh
```

### Uploader Environment Variables

Copy `Uploader/.env` and configure:

```
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
LOCAL_MUSIC_DIR=     # absolute path to local music folder
R2_PREFIX=music      # prefix in R2 bucket
MAX_WORKERS=24       # concurrent upload workers (default 24)
MAX_RETRIES=3        # per-file retry attempts with exponential backoff
UPLOAD_CACHE_DB=     # optional: override SQLite cache path (default ~/.tamasha_uploader/<bucket>_cache.db)
```

## Docker (full stack — when infra is scaffolded)

```bash
docker compose -f infra/docker/docker-compose.yml up --build
```

Services: backend `:8000`, frontend `:5173`, MongoDB, Redis, Nginx.

---

# Architecture

## Monorepo Layout

```text
tamasha/
├── app.backend/       # FastAPI API service
├── app.ui-reactjs/    # React + Vite frontend
├── app.worker/        # Celery workers
├── Uploader/          # Standalone terminal uploader (Python)
├── infra/             # Docker compose, Nginx config
├── shared/            # Shared types/utilities
└── docs/              # Full product and architecture docs
```

## Data Flow

```
Uploader → Cloudflare R2 (raw source of truth)
                ↓
         app.worker (transcoding, dedup, indexing)
                ↓
           MongoDB (metadata, analytics, jobs)
                ↓
          app.backend (API, auth, streaming)
                ↓
       app.ui-reactjs (dashboards, player, Skiza editor)
```

**R2 is the raw source of truth for media. MongoDB is not.**

## Uploader Architecture

`uploader.py` uses a producer/consumer pattern:
- `MusicFolderHandler` (watchdog) + `initial_scan` → enqueue files
- `upload_queue` (thread-safe queue) → `worker_loop` with `ThreadPoolExecutor`
- `remote_file_matches` does size-based skip check before upload
- `make_r2_key` normalizes spaces to underscores, preserves folder hierarchy
- Multipart upload threshold: 16MB, chunk: 32MB

---

# Tech Stack

## Backend (`app.backend/`)

FastAPI, Pydantic v2, Motor, MongoDB, Redis, Celery, OpenSearch, FFmpeg, JWT

## Frontend (`app.ui-reactjs/`)

React, Vite, TypeScript, TailwindCSS, shadcn/ui, React Query, Zustand, React Router, WaveSurfer.js, HLS.js, TanStack Table, Recharts, Tremor React, Lucide React

### Frontend Folder Structure

```text
app.ui-reactjs/src/
├── api/          # typed API clients (all fetches go through here)
├── hooks/
├── store/        # Zustand: player, sidebar, queue, Skiza editor state
├── routes/
├── layouts/
├── pages/        # admin/ staff/ artist/ listener/ auth/
├── components/   # ui/ player/ tables/ charts/ skiza/ upload/ tracks/
├── features/     # auth/ admin/ staff/ artist/ listener/ streaming/ skiza/
├── lib/
├── utils/
└── types/
```

## Worker (`app.worker/`)

Celery + Redis broker/backend, FFmpeg for transcoding, beat schedule for sync jobs

## Uploader (`Uploader/`)

Python, boto3 (S3v4 for R2), watchdog, tqdm — built into a standalone EXE via PyInstaller

---

# Core Engineering Rules

## Preservation

- Raw uploads in R2 are **immutable archives** — never auto-delete
- Workers must never delete raw objects automatically
- Metadata edits must be versioned

## Workers

- All Celery tasks must be idempotent with exponential retry backoff
- Jobs must emit progress, log failures, and support resumption
- Heavy operations (transcoding, dedup, backups) go to workers, not API handlers

## Backend

- Use service layer — no business logic in route handlers
- All mutations must be audit-logged
- Every sensitive action requires RBAC checks
- Use async APIs; avoid blocking I/O

## Frontend

- All API calls through `src/api/` — never fetch directly in nested components
- Use React Query for server state, Zustand for UI/player state
- Use HLS.js for adaptive bitrate streaming, WaveSurfer.js for Skiza waveform editor
- Protect admin/staff routes; never expose raw R2 keys — use signed URLs
- Do not hardcode Safaricom/provider logic in frontend; use provider-based backend APIs

## Duplicate Detection

- Never auto-delete duplicates — create duplicate groups and allow canonical selection
- Exact: SHA256 + MD5 + file size + duration
- Near: audio fingerprinting + title/metadata similarity

## Sync Schedule

- Incremental: every 15 min — new object detection
- Hourly: metadata reconciliation
- Nightly: full bucket scan + orphan detection
- Weekly: checksum + backup verification

---

# Storage Layout (R2)

```
/music/raw/
/music/transcoded/
/music/skiza/
/music/artwork/
/music/artist-images/
/music/documents/
/music/waveforms/
/music/backups/
```

---

# Skiza Clip States

`draft → pending_review → approved/rejected → exporting → exported → submitted → accepted/failed`

---

# User Roles

Four roles with scoped access: **Admin** (full), **Staff** (archive ops), **Artist** (own content + analytics), **Listener** (streaming only).

---

# Windows EXE Build (CI)

GitHub Actions workflow at `.github/workflows/build-uploader-windows.yml` triggers on `uploader-v*` tags or changes to `Uploader/**`. Produces `tamasha-uploader-windows` artifact.

---

# Related Documentation

Full product and workflow specs live in `docs/`:

- `docs/PRD.md` — primary product requirements
- `docs/architecture.md`
- `docs/roles-and-permissions.md`
- `docs/skiza-workflow.md`
- `docs/sync-schedule.md`
- `docs/frontend_requirements.md`
- `docs/analytics.md`
- `docs/duplicate-detection.md`
- `docs/backup-strategy.md`
- `docs/deployment.md`
- `docs/emails.md`
