import { useQuery } from "@tanstack/react-query";
import { billingApi } from "@/api/billing";
import { useAuth } from "@/hooks/useAuth";

export function useBillingStatus() {
  const { isAuthenticated, role } = useAuth();

  const { data } = useQuery({
    queryKey: ["billing", "gate-status"],
    queryFn: billingApi.getGateStatus,
    enabled: isAuthenticated,
    staleTime: 60_000,   // re-check every 60s
    refetchInterval: 120_000,
  });

  const isGated = role !== "superadmin" && (data?.is_gated ?? false);
  return { gateStatus: data ?? null, isGated, phase: data?.phase ?? "none" };
}
