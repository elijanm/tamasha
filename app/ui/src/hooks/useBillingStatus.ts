import { useQuery } from "@tanstack/react-query";
import { billingApi } from "@/api/billing";
import { useAuth } from "@/hooks/useAuth";

export function useBillingStatus() {
  const { isAuthenticated } = useAuth();

  const { data } = useQuery({
    queryKey: ["billing", "gate-status"],
    queryFn: billingApi.getGateStatus,
    enabled: isAuthenticated,
    staleTime: 30_000,
    gcTime: 0,        // discard cache on unmount — prevents stale is_gated state across logins
    refetchInterval: 60_000,
  });

  const isGated = data?.is_gated ?? false;
  return { gateStatus: data ?? null, isGated, phase: data?.phase ?? "none" };
}
