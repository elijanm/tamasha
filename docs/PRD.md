# Product Requirements Document

## Vision

Tamasha preserves, organizes, enriches, and streams African music collections while enabling artist ownership workflows and Skiza preparation.

## Goals

- archival preservation
- streaming
- metadata enrichment
- artist ownership
- analytics
- duplicate detection
- backup and disaster recovery
- scalable uploads

## User Roles

### Admin
Full visibility and control.

Capabilities:
- analytics dashboards
- user management
- artist assignment
- duplicate management
- storage monitoring
- backup monitoring
- sync orchestration
- Skiza approvals
- metadata editing

### Staff
Operational archive management.

Capabilities:
- uploads
- metadata edits
- artwork management
- duplicate review
- Skiza preparation
- artist updates

### Artist
Assigned-catalog management.

Capabilities:
- manage profile
- view assigned music
- analytics
- upload music for review
- ownership requests

### Listener
Public streaming and discovery.

Capabilities:
- stream
- favorite
- like
- playlists
- follow artists

## Core Features

### Uploading
- resumable uploads
- folder preservation
- retry logic
- manifests
- duplicate hashing

### Streaming
- adaptive bitrate
- HLS
- signed URLs
- waveform previews

### Duplicate Detection
- SHA256
- MD5
- audio fingerprinting
- metadata similarity

### Skiza
- clip editing
- preview
- export
- approval workflow
- provider sync abstraction

### Analytics
Track:
- streams
- likes
- favorites
- completion rate
- geography
- bitrate usage

### Backups
- secondary S3 backups
- checksum verification
- restore manifests
