import { api } from "./client";
import type { AuditLog, ListParams, PagedResponse, WorkSummary } from "@/types";

export const auditLogsApi = {
  list: async (params: ListParams = {}): Promise<PagedResponse<AuditLog>> => {
    const res = await api.get<PagedResponse<AuditLog>>("/audit-logs/", { params });
    return res.data;
  },

  myWork: async (params: { from_date: string; to_date: string }): Promise<WorkSummary> => {
    const res = await api.get<WorkSummary>("/audit-logs/my-work", { params });
    return res.data;
  },
};
