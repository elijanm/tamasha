# Architecture

## Monorepo Layout

```text
tamasha/
├── app.backend/
├── app.ui-reactjs/
├── app.worker/
├── Uploader/
├── infra/
└── docs/
```

## Backend

FastAPI service responsible for:
- APIs
- auth
- metadata
- analytics
- streaming
- RBAC

## Frontend

React/Vite application.

Views:
- Admin
- Staff
- Artist
- Listener

## Worker

Celery workers handle:
- transcoding
- duplicate detection
- sync
- emails
- backups

## Storage

Primary:
- Cloudflare R2

Secondary:
- Backblaze B2
- Wasabi
- AWS Glacier

## Database

MongoDB collections:
- users
- artists
- tracks
- uploads
- sync_jobs
- skiza_clips
- analytics
