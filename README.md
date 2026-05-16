# Tamasha Music Archive Platform

Tamasha is a large-scale African music archival, streaming, and preservation platform.

## Apps

### app.backend
FastAPI backend API service.

### app.ui-reactjs
React + Vite frontend.

### app.worker
Celery workers for:
- transcoding
- emails
- analytics
- duplicate detection
- backups

### Uploader
Terminal uploader service for:
- resumable uploads
- folder watching
- metadata extraction
- duplicate hashing
- direct S3/R2 uploads

## Infrastructure

- MongoDB
- Redis
- Cloudflare R2
- Celery
- FFmpeg
- Docker
- Nginx

## Features

- adaptive bitrate streaming
- duplicate detection
- analytics
- artist ownership workflows
- resumable uploads
- archival preservation
- metadata enrichment
- background processing