from __future__ import annotations

import struct

from rocksdict import AccessType, Options, Rdict

# Storage layout per RocksDB key (4-byte hash):
#   value = N * 16 bytes, each record = 12-byte ObjectId binary + 4-byte uint32 offset
_RECORD = 16
_META_PREFIX = b"\xff"  # namespace for "track is indexed" sentinel keys


class FingerprintStore:
    def __init__(self, path: str, read_only: bool = False) -> None:
        if read_only:
            self._db: Rdict = Rdict(path, access_type=AccessType.read_only())
        else:
            opts = Options()
            opts.create_if_missing(True)
            self._db = Rdict(path, options=opts)

    def put(self, track_id_bytes: bytes, fingerprints: list[tuple[int, int]]) -> None:
        """Append fingerprint records for a track."""
        batch: dict[bytes, bytes] = {}
        for hash_int, offset in fingerprints:
            key = struct.pack(">I", hash_int)
            record = track_id_bytes[:12] + struct.pack(">I", offset)
            batch[key] = batch.get(key, b"") + record

        for key, new_data in batch.items():
            existing = self._db.get(key, b"")
            self._db[key] = existing + new_data

        self._db[_META_PREFIX + track_id_bytes[:12]] = b"1"

    def is_indexed(self, track_id_bytes: bytes) -> bool:
        return self._db.get(_META_PREFIX + track_id_bytes[:12]) is not None

    def query(self, fingerprints: list[tuple[int, int]]) -> dict[bytes, list[tuple[int, int]]]:
        """Return {track_id_bytes: [(stored_offset, query_offset)]} for all matching hashes."""
        matches: dict[bytes, list[tuple[int, int]]] = {}
        for hash_int, query_offset in fingerprints:
            key = struct.pack(">I", hash_int)
            value = self._db.get(key)
            if not value:
                continue
            for i in range(0, len(value), _RECORD):
                rec = value[i : i + _RECORD]
                if len(rec) < _RECORD:
                    continue
                tid = rec[:12]
                stored_offset = struct.unpack(">I", rec[12:16])[0]
                if tid not in matches:
                    matches[tid] = []
                matches[tid].append((stored_offset, query_offset))
        return matches

    def close(self) -> None:
        self._db.close()
