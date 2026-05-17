import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Shield, User as UserIcon, Disc3, Headphones, ShieldCheck,
  UserPlus, Mail, ToggleLeft, ToggleRight, Search, X, Eye, EyeOff,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { usersApi, type CreateUserPayload, type UsersListParams } from "@/api/users";
import { toast } from "@/hooks/useToast";
import { formatDate, getInitials } from "@/utils/format";
import type { Role, User } from "@/types";

const ROLES: Role[] = ["admin", "staff", "artist", "listener"];

const ROLE_ICONS: Record<Role, React.ComponentType<{ className?: string }>> = {
  superadmin: ShieldCheck, admin: Shield, staff: Disc3, artist: UserIcon, listener: Headphones,
};

const ROLE_COLORS: Record<Role, string> = {
  superadmin: "text-amber-400", admin: "text-red-400", staff: "text-violet-400",
  artist: "text-emerald-400", listener: "text-blue-400",
};

const ROLE_BG: Record<Role, string> = {
  superadmin: "bg-amber-500/10 text-amber-400",
  admin: "bg-red-500/10 text-red-400",
  staff: "bg-violet-500/10 text-violet-400",
  artist: "bg-emerald-500/10 text-emerald-400",
  listener: "bg-blue-500/10 text-blue-400",
};

// ── Invite / Create panel ─────────────────────────────────────────────────────

function InvitePanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CreateUserPayload>({
    email: "", username: "", password: "", role: "listener", send_invite: true,
  });
  const [showPw, setShowPw] = useState(false);

  const { mutate, isPending } = useMutation({
    mutationFn: () => usersApi.create(form),
    onSuccess: (user) => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast({ title: `User ${user.username} created`, variant: "success" });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: err?.response?.data?.detail ?? "Failed to create user", variant: "destructive" });
    },
  });

  const set = (k: keyof CreateUserPayload, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="border border-stone-700/60 rounded-xl bg-stone-900/60 backdrop-blur-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-display font-semibold text-stone-200">Invite new user</h3>
        <button onClick={onClose} className="text-stone-500 hover:text-stone-300 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500">Email</label>
          <Input
            type="email" placeholder="user@example.com" value={form.email}
            onChange={(e) => set("email", e.target.value)}
            className="h-9 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500">Username</label>
          <Input
            placeholder="username" value={form.username}
            onChange={(e) => set("username", e.target.value)}
            className="h-9 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500">Password</label>
          <div className="relative">
            <Input
              type={showPw ? "text" : "password"} placeholder="min 8 chars" value={form.password}
              onChange={(e) => set("password", e.target.value)}
              className="h-9 text-sm pr-9"
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300"
            >
              {showPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        <div className="space-y-1">
          <label className="block text-[10px] font-mono uppercase tracking-wider text-stone-500">Role</label>
          <Select value={form.role} onValueChange={(v) => set("role", v)}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <div
          className={`w-8 h-4.5 rounded-full transition-colors relative flex-shrink-0 ${form.send_invite ? "bg-violet-600" : "bg-stone-700"}`}
          style={{ height: "18px", width: "32px" }}
          onClick={() => set("send_invite", !form.send_invite)}
        >
          <span
            className="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-all"
            style={{ left: form.send_invite ? "calc(100% - 16px)" : "2px" }}
          />
        </div>
        <span className="text-xs font-body text-stone-400">Send welcome email to user</span>
      </label>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onClose} className="h-8 text-xs">Cancel</Button>
        <Button
          size="sm"
          onClick={() => mutate()}
          disabled={isPending || !form.email || !form.username || !form.password}
          className="h-8 text-xs bg-violet-600 hover:bg-violet-500 text-white border-0"
        >
          {isPending ? "Creating…" : "Create user"}
        </Button>
      </div>
    </div>
  );
}

// ── User row ──────────────────────────────────────────────────────────────────

function UserRow({ user }: { user: User }) {
  const qc = useQueryClient();
  const [newRole, setNewRole] = useState<Role>(user.role);

  const { mutate: changeRole, isPending: roleChanging } = useMutation({
    mutationFn: (role: Role) => usersApi.updateRole(user.id, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast({ title: "Role updated", variant: "success" });
    },
    onError: () => {
      toast({ title: "Failed to update role", variant: "destructive" });
      setNewRole(user.role);
    },
  });

  const { mutate: toggleActive, isPending: toggling } = useMutation({
    mutationFn: () => user.is_active ? usersApi.deactivate(user.id) : usersApi.activate(user.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast({ title: user.is_active ? "User deactivated" : "User activated", variant: "success" });
    },
    onError: () => toast({ title: "Failed to update status", variant: "destructive" }),
  });

  const { mutate: sendInvite, isPending: sending } = useMutation({
    mutationFn: () => usersApi.sendInvite(user.id),
    onSuccess: () => toast({ title: `Invite sent to ${user.email}`, variant: "success" }),
    onError: () => toast({ title: "Failed to send invite", variant: "destructive" }),
  });

  const RoleIcon = ROLE_ICONS[user.role];

  return (
    <tr className="border-b border-stone-800/50 hover:bg-stone-800/20 transition-colors">
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-stone-800 flex items-center justify-center flex-shrink-0">
            <span className="text-xs font-display font-semibold text-stone-400">
              {getInitials(user.username)}
            </span>
          </div>
          <div>
            <p className="text-sm font-body font-medium text-stone-200">{user.username}</p>
            <p className="text-xs font-mono text-stone-600">{user.email}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3.5">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs font-mono ${ROLE_BG[user.role]}`}>
          <RoleIcon className="w-3 h-3" />
          {user.role}
        </span>
      </td>
      <td className="px-4 py-3.5">
        <button
          onClick={() => toggleActive()}
          disabled={toggling}
          className="flex items-center gap-1.5 text-xs font-mono transition-colors"
          style={{ color: user.is_active ? "#34d399" : "#57534e" }}
        >
          {user.is_active
            ? <ToggleRight className="w-4 h-4" />
            : <ToggleLeft className="w-4 h-4" />}
          {user.is_active ? "active" : "inactive"}
        </button>
      </td>
      <td className="px-4 py-3.5 hidden lg:table-cell">
        <span className="text-xs font-mono text-stone-600">{formatDate(user.created_at)}</span>
      </td>
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-2">
          <Select value={newRole} onValueChange={(v) => setNewRole(v as Role)}>
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {newRole !== user.role && (
            <Button
              size="sm" variant="outline"
              onClick={() => changeRole(newRole)}
              disabled={roleChanging}
              className="h-7 text-xs"
            >
              Save
            </Button>
          )}
        </div>
      </td>
      <td className="px-4 py-3.5">
        <button
          onClick={() => sendInvite()}
          disabled={sending}
          className="flex items-center gap-1 text-xs font-mono text-stone-500 hover:text-violet-400 transition-colors disabled:opacity-40"
          title="Resend invite email"
        >
          <Mail className="w-3.5 h-3.5" />
          {sending ? "sending…" : "invite"}
        </button>
      </td>
    </tr>
  );
}

// ── Stats infographic ─────────────────────────────────────────────────────────

const ROLE_STROKE: Record<Role, string> = {
  superadmin: "#fbbf24", admin: "#f87171", staff: "#a78bfa", artist: "#34d399", listener: "#60a5fa",
};

const ROLE_FILL_BG: Record<Role, string> = {
  superadmin: "rgba(251,191,36,0.15)",
  admin: "rgba(248,113,113,0.15)",
  staff: "rgba(167,139,250,0.15)",
  artist: "rgba(52,211,153,0.15)",
  listener: "rgba(96,165,250,0.15)",
};

function DonutRing({ active, total }: { active: number; total: number }) {
  const R = 36;
  const SW = 7;
  const circ = 2 * Math.PI * R;
  const pct = total > 0 ? active / total : 0;
  const dash = pct * circ;
  const gap = circ - dash;
  const cx = 44;

  return (
    <svg width={cx * 2} height={cx * 2} viewBox={`0 0 ${cx * 2} ${cx * 2}`} className="flex-shrink-0">
      {/* Track */}
      <circle cx={cx} cy={cx} r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={SW} />
      {/* Inactive arc */}
      {pct < 1 && (
        <circle
          cx={cx} cy={cx} r={R} fill="none"
          stroke="rgba(87,83,78,0.5)" strokeWidth={SW}
          strokeDasharray={`${gap} ${dash}`}
          strokeDashoffset={-(dash)}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cx})`}
        />
      )}
      {/* Active arc */}
      {pct > 0 && (
        <circle
          cx={cx} cy={cx} r={R} fill="none"
          stroke="#34d399" strokeWidth={SW}
          strokeDasharray={`${dash} ${gap}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cx})`}
          style={{ filter: "drop-shadow(0 0 6px rgba(52,211,153,0.5))" }}
        />
      )}
      {/* Center: total */}
      <text x={cx} y={cx - 4} textAnchor="middle" fill="#e7e5e4" fontSize="18" fontWeight="700" fontFamily="'DM Mono', monospace">{total}</text>
      <text x={cx} y={cx + 12} textAnchor="middle" fill="#78716c" fontSize="9" fontFamily="'DM Mono', monospace" letterSpacing="0.08em">TOTAL</text>
    </svg>
  );
}

function StatsBar({ users }: { users: User[] }) {
  const total = users.length;
  const active = users.filter((u) => u.is_active).length;
  const inactive = total - active;
  const activePct = total > 0 ? Math.round((active / total) * 100) : 0;

  const counts = ROLES.reduce((acc, r) => {
    acc[r] = users.filter((u) => u.role === r).length;
    return acc;
  }, {} as Record<Role, number>);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

      {/* Left: active/total donut */}
      <div className="bg-stone-900/60 border border-stone-800/60 rounded-xl p-5 flex items-center gap-5">
        <DonutRing active={active} total={total} />
        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500 mb-1">Activity</p>
            <div className="flex items-end gap-2">
              <span className="text-2xl font-display font-bold text-emerald-400" style={{ lineHeight: 1 }}>{active}</span>
              <span className="text-xs font-mono text-stone-500 mb-0.5">active · {activePct}%</span>
            </div>
          </div>
          {/* Segmented bar */}
          <div>
            <div className="flex h-2 rounded-full overflow-hidden gap-px">
              <div
                className="bg-emerald-500 transition-all duration-700 rounded-l-full"
                style={{ width: `${activePct}%`, boxShadow: "0 0 6px rgba(52,211,153,0.4)" }}
              />
              <div
                className="bg-stone-700 flex-1 rounded-r-full"
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] font-mono text-emerald-500">{active} active</span>
              <span className="text-[10px] font-mono text-stone-600">{inactive} inactive</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right: role breakdown */}
      <div className="bg-stone-900/60 border border-stone-800/60 rounded-xl p-5 space-y-3">
        <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500">By role</p>

        {/* Stacked bar */}
        <div className="flex h-2 rounded-full overflow-hidden gap-px">
          {ROLES.map((r) => {
            const w = total > 0 ? (counts[r] / total) * 100 : 0;
            return w > 0 ? (
              <div
                key={r}
                className="transition-all duration-700"
                style={{ width: `${w}%`, backgroundColor: ROLE_STROKE[r], opacity: 0.85 }}
              />
            ) : null;
          })}
          {total === 0 && <div className="flex-1 bg-stone-800 rounded-full" />}
        </div>

        {/* Role rows */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-1">
          {ROLES.map((r) => {
            const RoleIcon = ROLE_ICONS[r];
            const pct = total > 0 ? Math.round((counts[r] / total) * 100) : 0;
            return (
              <div key={r} className="flex items-center gap-2">
                <div
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: ROLE_STROKE[r] }}
                />
                <RoleIcon className="w-3 h-3 flex-shrink-0" style={{ color: ROLE_STROKE[r] }} />
                <span className="text-xs font-mono capitalize" style={{ color: ROLE_STROKE[r] }}>
                  {r}
                </span>
                <span className="text-xs font-mono text-stone-400 ml-auto">{counts[r]}</span>
                <span className="text-[10px] font-mono text-stone-600 w-7 text-right">{pct}%</span>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}

const PAGE_SIZE = 25;

// ── Main page ─────────────────────────────────────────────────────────────────

export function UsersPage() {
  const [showInvite, setShowInvite] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [skip, setSkip] = useState(0);

  const params: UsersListParams = {
    limit: PAGE_SIZE,
    skip,
    role: roleFilter !== "all" ? roleFilter : undefined,
    search: search || undefined,
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ["users", params],
    queryFn: () => usersApi.list(params),
  });

  const allUsers = data?.items ?? [];
  const total = data?.total ?? 0;

  const filtered = allUsers;

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-stone-100">Users</h1>
          <p className="mt-1 text-sm font-body text-stone-500">Manage platform users, roles, and access</p>
        </div>
        <Button
          onClick={() => setShowInvite(!showInvite)}
          className="flex-shrink-0 h-9 text-xs bg-violet-600 hover:bg-violet-500 text-white border-0 gap-1.5"
        >
          <UserPlus className="w-3.5 h-3.5" />
          Invite user
        </Button>
      </div>

      {showInvite && <InvitePanel onClose={() => setShowInvite(false)} />}

      {!isLoading && !isError && allUsers.length > 0 && <StatsBar users={allUsers} />}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div>
              <CardTitle>All Users</CardTitle>
              <CardDescription>{data ? `${total} user${total !== 1 ? "s" : ""}` : "Loading…"}</CardDescription>
            </div>
            <div className="flex items-center gap-2 sm:ml-auto">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-500" />
                <Input
                  placeholder="Search users…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setSkip(0); }}
                  className="h-8 pl-8 pr-3 text-xs w-48"
                />
              </div>
              <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v as Role | "all"); setSkip(0); }}>
                <SelectTrigger className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-5 space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="w-8 h-8 rounded-full" />
                  <div className="space-y-1.5 flex-1">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="py-12 text-center">
              <p className="text-sm font-body text-red-400">Failed to load users</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm font-body text-stone-500">
                {search || roleFilter !== "all" ? "No users match your filters" : "No users yet"}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-800 bg-stone-900/40">
                      {["User", "Role", "Status", "Joined", "Change Role", ""].map((h, i) => (
                        <th key={i} className="text-left px-4 py-3 text-xs font-mono font-semibold text-stone-500 uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((user) => (
                      <UserRow key={user.id} user={user} />
                    ))}
                  </tbody>
                </table>
              </div>
              {total > PAGE_SIZE && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-stone-800/50">
                  <p className="text-xs font-mono text-stone-600">
                    Showing {skip + 1}–{Math.min(skip + PAGE_SIZE, total)} of {total}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline" size="sm"
                      onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}
                      disabled={skip === 0}
                      className="h-7 text-xs"
                    >
                      Prev
                    </Button>
                    <Button
                      variant="outline" size="sm"
                      onClick={() => setSkip(skip + PAGE_SIZE)}
                      disabled={skip + PAGE_SIZE >= total}
                      className="h-7 text-xs"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
