# Sync Schedule

## Purpose

Synchronize R2/S3 objects into MongoDB metadata.

## Modes

### Incremental
Every 15 minutes.

### Metadata Reconciliation
Hourly.

### Full Scan
Nightly.

### Integrity Scan
Weekly.

## Responsibilities

- detect new objects
- queue metadata extraction
- queue duplicate detection
- calculate storage totals
- update Mongo records
