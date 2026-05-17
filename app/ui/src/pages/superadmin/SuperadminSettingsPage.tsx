import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Shield, Receipt, Check, X, Users2, Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { usersApi } from "@/api/users";
import { toast } from "@/hooks/useToast";
import { getInitials } from "@/utils/format";
import type { User } from "@/types";

type AdminsQueryData = { items: User[]; total: number; skip: number; limit: number };

function AccountingToggle({ user }: { user: User }) {
  const qc = useQueryClient();
  const hasAccounting = user.extra_permissions.includes("accounting");

  async function optimisticSet(add: boolean) {
    await qc.cancelQueries({ queryKey: ["superadmin-admins"] });
    const prev = qc.getQueryData<AdminsQueryData>(["superadmin-admins"]);
    qc.setQueryData<AdminsQueryData>(["superadmin-admins"], (old) => {
      if (!old) return old;
      return {
        ...old,
        items: old.items.map((u) =>
          u.id === user.id
            ? {
                ...u,
                extra_permissions: add
                  ? [...u.extra_permissions, "accounting"]
                  : u.extra_permissions.filter((p) => p !== "accounting"),
              }
            : u
        ),
      };
    });
    return { prev };
  }

  const { mutate: grant, isPending: granting } = useMutation({
    mutationFn: () => usersApi.grantPermission(user.id, "accounting"),
    onMutate: () => optimisticSet(true),
    onSuccess: () => toast({ title: `Accounting access granted to ${user.username}`, variant: "success" }),
    onError: (err: any, _: void, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(["superadmin-admins"], ctx.prev);
      toast({ title: err?.response?.data?.detail ?? "Failed to grant permission", variant: "destructive" });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["superadmin-admins"] }),
  });

  const { mutate: revoke, isPending: revoking } = useMutation({
    mutationFn: () => usersApi.revokePermission(user.id, "accounting"),
    onMutate: () => optimisticSet(false),
    onSuccess: () => toast({ title: `Accounting access revoked from ${user.username}`, variant: "success" }),
    onError: (err: any, _: void, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(["superadmin-admins"], ctx.prev);
      toast({ title: err?.response?.data?.detail ?? "Failed to revoke permission", variant: "destructive" });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["superadmin-admins"] }),
  });

  const isPending = granting || revoking;

  return (
    <div className="flex items-center justify-between px-4 py-3.5 rounded-xl border border-stone-800/60 bg-stone-900/40 hover:bg-stone-900/60 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-8 h-8 rounded-full bg-stone-800 border border-stone-700 flex items-center justify-center flex-shrink-0 overflow-hidden">
          {user.profile?.avatar_url ? (
            <img src={user.profile.avatar_url} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="text-xs font-display font-semibold text-stone-400">
              {getInitials(user.username)}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-body font-medium text-stone-200 truncate">
            {user.profile?.display_name || user.username}
          </p>
          <p className="text-xs font-mono text-stone-600 truncate">{user.email}</p>
        </div>
      </div>

      <button
        onClick={() => (hasAccounting ? revoke() : grant())}
        disabled={isPending || !user.is_active}
        title={!user.is_active ? "User is inactive" : undefined}
        className={`
          flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono font-medium
          border transition-all disabled:opacity-40 disabled:cursor-not-allowed
          ${hasAccounting
            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400"
            : "bg-stone-800/60 border-stone-700/60 text-stone-500 hover:bg-emerald-500/10 hover:border-emerald-500/30 hover:text-emerald-400"
          }
        `}
      >
        {isPending ? (
          <span className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
        ) : hasAccounting ? (
          <Check className="w-3.5 h-3.5" />
        ) : (
          <X className="w-3.5 h-3.5" />
        )}
        {hasAccounting ? "Accounting enabled" : "No accounting access"}
      </button>
    </div>
  );
}

export function SuperadminSettingsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["superadmin-admins"],
    queryFn: () => usersApi.list({ role: "admin", limit: 200 }),
    staleTime: 30_000,
  });

  const admins: User[] = data?.items ?? [];

  return (
    <div className="space-y-8 animate-fadeIn max-w-2xl">
      <div>
        <h1 className="font-display text-2xl font-bold text-stone-100">Super Admin Settings</h1>
        <p className="mt-1 text-sm font-body text-stone-500">Manage platform-level permissions for admin users</p>
      </div>

      {/* Accounting permission section */}
      <div className="space-y-4">
        <div className="flex items-start gap-3 pb-4 border-b border-stone-800">
          <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Receipt className="w-4 h-4 text-violet-400" />
          </div>
          <div>
            <h2 className="text-sm font-display font-semibold text-stone-200">Accounting Permission</h2>
            <p className="text-xs font-body text-stone-500 mt-0.5">
              Admins with Accounting access can view the Billing tab in Settings — invoice history, payment status,
              and arrangement details. They cannot create or modify invoices.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/15">
          <Info className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
          <p className="text-xs font-body text-amber-300/80">
            Toggle the button on each admin to grant or revoke billing read access.
            Changes take effect immediately on next page load.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : admins.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 rounded-xl border border-stone-800 bg-stone-900/20">
            <Users2 className="w-8 h-8 text-stone-700 mb-3" />
            <p className="text-sm font-body text-stone-500">No admin users yet</p>
            <p className="text-xs font-body text-stone-600 mt-1">Create admins from the Admin → Settings → Users page</p>
          </div>
        ) : (
          <div className="space-y-2">
            {admins.map((admin) => (
              <AccountingToggle key={admin.id} user={admin} />
            ))}
          </div>
        )}

        {admins.length > 0 && (
          <div className="flex items-center gap-2 pt-1">
            <Shield className="w-3.5 h-3.5 text-stone-600" />
            <p className="text-xs font-mono text-stone-600">
              {admins.filter((a) => a.extra_permissions.includes("accounting")).length} of {admins.length} admin{admins.length !== 1 ? "s" : ""} have accounting access
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
