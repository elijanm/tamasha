import { api } from "./client";
import type { Track, TrackCreatePayload, TrackUpdateRequest, TracksListParams, PagedResponse, SkizaClip, StreamUrlResponse, UploadedTrackMeta, UploadAlbumResponse } from "@/types";

const AUDIO_BASE = "/api/v1";

function getToken(): string | null {
  try {
    const raw = localStorage.getItem("tamasha-auth");
    const parsed = JSON.parse(raw || "{}") as { state?: { accessToken?: string } };
    return parsed?.state?.accessToken ?? null;
  } catch {
    return null;
  }
}

export const tracksApi = {
  list: async (params: TracksListParams = {}): Promise<PagedResponse<Track>> => {
    const res = await api.get<PagedResponse<Track>>("/tracks/", { params });
    return res.data;
  },

  uploadFile: async (file: File, onProgress?: (pct: number) => void): Promise<UploadedTrackMeta> => {
    const form = new FormData();
    form.append("file", file);
    const res = await api.post<UploadedTrackMeta>("/tracks/upload-file", form, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: onProgress
        ? (e) => { if (e.total) onProgress(Math.round((e.loaded / e.total) * 100)); }
        : undefined,
    });
    return res.data;
  },

  uploadAlbum: async (file: File, onProgress?: (pct: number) => void): Promise<UploadAlbumResponse> => {
    const form = new FormData();
    form.append("file", file);
    const res = await api.post<UploadAlbumResponse>("/tracks/upload-album", form, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: onProgress
        ? (e) => { if (e.total) onProgress(Math.round((e.loaded / e.total) * 100)); }
        : undefined,
    });
    return res.data;
  },

  create: async (data: TrackCreatePayload): Promise<Track> => {
    const res = await api.post<Track>("/tracks/", data);
    return res.data;
  },

  get: async (id: string): Promise<Track> => {
    const res = await api.get<Track>(`/tracks/${id}`);
    return res.data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/tracks/${id}`);
  },

  update: async (id: string, data: TrackUpdateRequest): Promise<Track> => {
    const res = await api.patch<Track>(`/tracks/${id}`, data);
    return res.data;
  },

  assignArtist: async (id: string, artistId: string): Promise<Track> => {
    const res = await api.patch<Track>(`/tracks/${id}/assign-artist`, { artist_id: artistId });
    return res.data;
  },

  uploadArtwork: async (id: string, file: File): Promise<Track> => {
    const form = new FormData();
    form.append("file", file);
    const res = await api.post<Track>(`/tracks/${id}/artwork`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return res.data;
  },

  getReviewQueue: async (params: { limit?: number; skip?: number } = {}): Promise<PagedResponse<Track>> => {
    const res = await api.get<PagedResponse<Track>>("/tracks/", {
      params: { ...params, needs_review: true },
    });
    return res.data;
  },

  /**
   * Returns metadata (available_bitrates, chosen bitrate) and a backend-proxied
   * audio URL that the <audio> element can load directly without CORS issues.
   */
  getStreamUrl: async (id: string, bitrate?: string): Promise<StreamUrlResponse> => {
    const res = await api.get<Omit<StreamUrlResponse, "url">>(`/tracks/${id}/stream-url`, {
      params: bitrate ? { bitrate } : undefined,
    });
    const chosenBitrate = res.data.bitrate;
    const token = getToken();
    const params = new URLSearchParams();
    if (token) params.set("token", token);
    if (chosenBitrate && chosenBitrate !== "raw") params.set("bitrate", chosenBitrate);
    const url = `${AUDIO_BASE}/tracks/${id}/audio?${params.toString()}`;
    return { ...res.data, url } as StreamUrlResponse;
  },

  logStream: async (id: string): Promise<void> => {
    await api.post(`/tracks/${id}/stream`);
  },

  logStreamComplete: async (id: string, playedSeconds: number, startedAt: string): Promise<void> => {
    await api.post(`/tracks/${id}/stream-complete`, { played_seconds: playedSeconds, started_at: startedAt });
  },

  toggleLike: async (id: string): Promise<void> => {
    await api.post(`/tracks/${id}/like`);
  },

  getLikeStatus: async (id: string): Promise<{ liked: boolean }> => {
    const res = await api.get<{ liked: boolean }>(`/tracks/${id}/like-status`);
    return res.data;
  },

  // Skiza
  listSkizaClips: async (params: { status?: string; skip?: number; limit?: number } = {}): Promise<PagedResponse<SkizaClip>> => {
    const res = await api.get<PagedResponse<SkizaClip>>("/tracks/skiza-clips", { params });
    return res.data;
  },

  listTrackSkizaClips: async (trackId: string): Promise<SkizaClip[]> => {
    const res = await api.get<SkizaClip[]>(`/tracks/${trackId}/skiza-clips`);
    return res.data;
  },

  createSkizaClip: async (trackId: string, data: { title?: string; start_seconds: number; end_seconds: number; notes?: string }): Promise<SkizaClip> => {
    const res = await api.post<SkizaClip>(`/tracks/${trackId}/skiza-clips`, data);
    return res.data;
  },

  updateSkizaClipStatus: async (clipId: string, status: string): Promise<SkizaClip> => {
    const res = await api.patch<SkizaClip>(`/tracks/skiza-clips/${clipId}`, { status });
    return res.data;
  },

  exportCsv: async (): Promise<void> => {
    const token = getToken();
    const res = await fetch(`/api/v1/tracks/export-csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tamasha_catalogue.csv";
    a.click();
    URL.revokeObjectURL(url);
  },

  importCsv: async (
    file: File,
    onProgress?: (pct: number) => void,
  ): Promise<{ updated: number; skipped: number; errors: Array<{ row: number; song_id: string; error: string }> }> => {
    const form = new FormData();
    form.append("file", file);
    const res = await api.post("/tracks/import-csv", form, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: onProgress
        ? (e) => { if (e.total) onProgress(Math.round((e.loaded / e.total) * 100)); }
        : undefined,
    });
    return res.data;
  },
};
