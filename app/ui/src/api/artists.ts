import { api } from "./client";
import type { Artist, CreateArtistRequest, UpdateArtistRequest, ListParams, PagedResponse, Track } from "@/types";

export const artistsApi = {
  list: async (params: ListParams & { search?: string; status?: string; is_band?: boolean } = {}): Promise<PagedResponse<Artist>> => {
    const res = await api.get<PagedResponse<Artist>>("/artists/", { params });
    return res.data;
  },

  get: async (id: string): Promise<Artist> => {
    const res = await api.get<Artist>(`/artists/${id}`);
    return res.data;
  },

  create: async (data: CreateArtistRequest): Promise<Artist> => {
    const res = await api.post<Artist>("/artists/", data);
    return res.data;
  },

  update: async (id: string, data: UpdateArtistRequest): Promise<Artist> => {
    const res = await api.patch<Artist>(`/artists/${id}`, data);
    return res.data;
  },

  delete: async (id: string): Promise<void> => {
    await api.delete(`/artists/${id}`);
  },

  approve: async (id: string): Promise<Artist> => {
    const res = await api.post<Artist>(`/artists/${id}/approve`);
    return res.data;
  },

  reject: async (id: string): Promise<Artist> => {
    const res = await api.post<Artist>(`/artists/${id}/reject`);
    return res.data;
  },

  tracks: async (id: string, params: ListParams = {}): Promise<PagedResponse<Track>> => {
    const res = await api.get<PagedResponse<Track>>(`/artists/${id}/tracks`, { params });
    return res.data;
  },

  uploadAvatar: async (id: string, file: File): Promise<Artist> => {
    const form = new FormData();
    form.append("file", file);
    const res = await api.post<Artist>(`/artists/${id}/avatar`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return res.data;
  },
};
