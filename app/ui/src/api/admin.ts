import { api } from "./client";
import type { HealthStatus, QueueHealth, StorageMetrics } from "@/types";

export const adminApi = {
  health: async (): Promise<HealthStatus> => {
    const res = await api.get<HealthStatus>("/admin/health");
    return res.data;
  },

  queueHealth: async (): Promise<QueueHealth> => {
    const res = await api.get<QueueHealth>("/admin/queue-health");
    return res.data;
  },

  storageMetrics: async (): Promise<StorageMetrics> => {
    const res = await api.get<StorageMetrics>("/admin/storage-metrics");
    return res.data;
  },

  resetCatalogue: async (): Promise<{ deleted: Record<string, number>; total: number }> => {
    const res = await api.post<{ deleted: Record<string, number>; total: number }>("/admin/reset-catalogue");
    return res.data;
  },
};
