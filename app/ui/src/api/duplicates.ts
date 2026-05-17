import { api } from "./client";
import type {
  DuplicateGroup,
  DuplicateGroupDetail,
  DuplicateMetrics,
  PagedResponse,
  ListParams,
  SyncJob,
} from "@/types";

export const duplicatesApi = {
  metrics: async (): Promise<DuplicateMetrics> => {
    const res = await api.get<DuplicateMetrics>("/duplicates/metrics");
    return res.data;
  },

  list: async (
    params: ListParams & { status?: string; method?: string } = {}
  ): Promise<PagedResponse<DuplicateGroup>> => {
    const res = await api.get<PagedResponse<DuplicateGroup>>("/duplicates/", { params });
    return res.data;
  },

  get: async (id: string): Promise<DuplicateGroupDetail> => {
    const res = await api.get<DuplicateGroupDetail>(`/duplicates/${id}`);
    return res.data;
  },

  resolve: async (id: string, canonical_track_id: string): Promise<DuplicateGroup> => {
    const res = await api.post<DuplicateGroup>(`/duplicates/${id}/resolve`, { canonical_track_id });
    return res.data;
  },

  scan: async (): Promise<SyncJob> => {
    const res = await api.post<SyncJob>("/duplicates/scan");
    return res.data;
  },
};
