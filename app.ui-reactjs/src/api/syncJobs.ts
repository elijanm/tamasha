import { api } from "./client";
import type { SyncJob, SyncJobMode, ListParams, PagedResponse } from "@/types";

export const syncJobsApi = {
  list: async (params: ListParams = {}): Promise<PagedResponse<SyncJob>> => {
    const res = await api.get<PagedResponse<SyncJob>>("/sync-jobs/", { params });
    return res.data;
  },

  get: async (jobId: string): Promise<SyncJob> => {
    const res = await api.get<SyncJob>(`/sync-jobs/${jobId}`);
    return res.data;
  },

  trigger: async (
    mode: SyncJobMode,
    opts: {
      prefix?: string;
      dispatch?: boolean;
      batch_size?: number;
      only_missing_artist?: boolean;
    } = {},
  ): Promise<SyncJob> => {
    const res = await api.post<SyncJob>("/sync-jobs/trigger", {
      mode,
      prefix: opts.prefix ?? "music/",
      dispatch: opts.dispatch ?? false,
      batch_size: opts.batch_size ?? 100,
      only_missing_artist: opts.only_missing_artist ?? false,
    });
    return res.data;
  },

  cancel: async (jobId: string): Promise<SyncJob> => {
    const res = await api.post<SyncJob>(`/sync-jobs/${jobId}/cancel`);
    return res.data;
  },
};
