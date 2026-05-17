import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { auditLogsApi } from "@/api/auditLogs";
import { formatRelativeTime, truncate } from "@/utils/format";

export function AuditLogsPage() {
  const [limit] = useState(50);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["audit-logs", limit],
    queryFn: () => auditLogsApi.list({ limit }),
    refetchInterval: 60_000,
  });
  const logs = data?.items;

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-stone-100">Audit Logs</h1>
          <p className="mt-1 text-sm font-body text-stone-500">
            All sensitive actions on the platform
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Actions</CardTitle>
          <CardDescription>{data ? `Last ${data.total} entries` : "Loading…"}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-5 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="space-y-1.5">
                  <Skeleton className="h-3.5 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-800 bg-stone-900/40">
                    {["Action", "Resource", "User", "IP", "When"].map((h) => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-mono font-semibold text-stone-500 uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-800/50">
                  {logs?.map((log) => (
                    <tr key={log.id} className="hover:bg-stone-800/20 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs bg-stone-800 px-2 py-0.5 rounded text-violet-400">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-body text-stone-400">
                          {log.entity_type}
                          {log.entity_id && (
                            <span className="text-stone-600 ml-1 font-mono">
                              #{truncate(log.entity_id, 8)}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono text-stone-500">
                          {log.actor_role
                            ? `${log.actor_role}${log.actor_id ? ` · ${truncate(log.actor_id, 8)}` : ""}`
                            : (log.actor_id ? truncate(log.actor_id, 12) : "—")}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono text-stone-700">
                          {log.actor_ip || "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-stone-600">
                          {formatRelativeTime(log.occurred_at)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {logs?.length === 0 && (
                <div className="flex justify-center py-10 text-stone-600 text-sm font-body">
                  No audit logs yet
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
