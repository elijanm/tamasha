import { api } from "./client";
import type { AuditLog, ListParams, PagedResponse } from "@/types";

export const auditLogsApi = {
  list: async (params: ListParams = {}): Promise<PagedResponse<AuditLog>> => {
    const res = await api.get<PagedResponse<AuditLog>>("/audit-logs/", { params });
    return res.data;
  },
};
