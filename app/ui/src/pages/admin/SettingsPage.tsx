import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Database, Zap, Server, CheckCircle2, XCircle, RefreshCw,
  AlertCircle, HardDrive, Activity, Music2, Users, Play,
  AlertTriangle, Package, Layers, Settings2, BarChart2,
  Radio, Clock, Disc3, Eye, EyeOff, Fingerprint,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { adminApi } from "@/api/admin";
import { analyticsApi } from "@/api/analytics";
import { syncJobsApi } from "@/api/syncJobs";
import { formatFileSize, formatCount } from "@/utils/format";
import { useAuth } from "@/hooks/useAuth";
import type { SyncJob } from "@/types";

// ─── Status indicator ─────────────────────────────────────────────────────────

type ServiceStatus = "ok" | "offline" | "error" | undefined;

function StatusIcon({ status }: { status: ServiceStatus }) {
  if (status === "ok")      return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
  if (status === "offline") return <AlertCircle  className="w-4 h-4 text-violet-400" />;
  if (status === "error")   return <XCircle      className="w-4 h-4 text-red-400" />;
  return <RefreshCw className="w-4 h-4 text-stone-600 animate-spin" />;
}

function StatusBadge({ status }: { status: ServiceStatus }) {
  const map = {
    ok:      "text-emerald-400",
    offline: "text-violet-400",
    error:   "text-red-400",
  };
  return (
    <div className="flex items-center gap-1.5">
      <StatusIcon status={status} />
      <span className={`text-xs font-mono capitalize ${status ? map[status] : "text-stone-600"}`}>
        {status ?? "checking…"}
      </span>
    </div>
  );
}

// ─── Configurable metric widget definitions ────────────────────────────────────

const ALL_METRIC_KEYS = [
  "total_tracks", "total_artists", "total_listeners",
  "streams_today", "streams_week", "archive_gb",
  "bytes_today", "bytes_week", "bytes_30d",
  "active_jobs", "needs_review",
] as const;

type MetricKey = (typeof ALL_METRIC_KEYS)[number];

const METRIC_META: Record<MetricKey, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  total_tracks:    { label: "Total Tracks",      icon: Music2        },
  total_artists:   { label: "Total Artists",     icon: Users         },
  total_listeners: { label: "Listeners",         icon: Radio         },
  streams_today:   { label: "Streams Today",     icon: Play          },
  streams_week:    { label: "Streams (7 days)",  icon: BarChart2     },
  archive_gb:      { label: "Archive Size",      icon: HardDrive     },
  bytes_today:     { label: "Egress Today",      icon: Activity      },
  bytes_week:      { label: "Egress This Week",  icon: Activity      },
  bytes_30d:       { label: "Egress (30 days)",  icon: Activity      },
  active_jobs:     { label: "Active Jobs",       icon: Clock         },
  needs_review:    { label: "Needs Review",      icon: AlertTriangle },
};

const DEFAULT_ENABLED: MetricKey[] = ["total_tracks", "archive_gb", "streams_today", "active_jobs"];
const LS_KEY = "tamasha:settings:metrics";
const PLAYER_VIS_KEY = "tamasha:settings:player_visible";

function loadEnabledMetrics(): MetricKey[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as MetricKey[];
  } catch { /* ignore */ }
  return DEFAULT_ENABLED;
}

function saveEnabledMetrics(keys: MetricKey[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(keys));
}

// ─── Main page ────────────────────────────────────────────────────────────────

function loadPlayerVisible(): boolean {
  try {
    const raw = localStorage.getItem(PLAYER_VIS_KEY);
    return raw === null ? true : raw === "true";
  } catch { return true; }
}

// ─── Sync job status helpers ──────────────────────────────────────────────────

function JobStatusBadge({ status }: { status: SyncJob["status"] }) {
  const map: Record<SyncJob["status"], { cls: string; label: string }> = {
    queued:    { cls: "text-stone-500",   label: "queued"    },
    running:   { cls: "text-violet-400",   label: "running…"  },
    complete:  { cls: "text-emerald-400", label: "complete"  },
    failed:    { cls: "text-red-400",     label: "failed"    },
    cancelled: { cls: "text-stone-600",   label: "cancelled" },
  };
  const m = map[status] ?? { cls: "text-stone-600", label: status };
  return <span className={`text-xs font-mono ${m.cls}`}>{m.label}</span>;
}

function PoolJobRow({ job }: { job: SyncJob }) {
  const qc = useQueryClient();
  const cancelMutation = useMutation({
    mutationFn: () => syncJobsApi.cancel(job.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pool-jobs"] });
      qc.invalidateQueries({ queryKey: ["enrich-jobs"] });
    },
  });

  const active = job.status === "running" || job.status === "queued";

  return (
    <div className="px-3 py-2.5 rounded-md bg-stone-900 border border-stone-800/60 space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Disc3 className="w-3.5 h-3.5 text-stone-600 flex-shrink-0" />
          <span className="text-xs font-mono text-stone-400 truncate">
            {new Date(job.created_at).toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <JobStatusBadge status={job.status} />
          {active && (
            <button
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="text-[10px] font-mono text-red-500 hover:text-red-400 disabled:opacity-40 transition-colors"
            >
              {cancelMutation.isPending ? "cancelling…" : "cancel"}
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4 text-[10px] font-mono text-stone-600">
        <span>scanned <span className="text-stone-300">{job.objects_scanned}</span></span>
        <span>new <span className="text-emerald-400">{job.objects_new}</span></span>
        <span>updated <span className="text-violet-400">{job.objects_updated}</span></span>
        {job.errors.length > 0 && (
          <span>errors <span className="text-red-400">{job.errors.length}</span></span>
        )}
      </div>
      {active && (
        <div className="h-0.5 bg-stone-800 rounded-full overflow-hidden">
          <div className="h-full bg-violet-500 rounded-full animate-pulse" style={{ width: "60%" }} />
        </div>
      )}
    </div>
  );
}

function FingerprintIndexSection({ role }: { role: string | null }) {
  const isSuperadmin = role === "superadmin";
  const qc = useQueryClient();

  const { data: visData } = useQuery({
    queryKey: ["fingerprint-visible"],
    queryFn: adminApi.getFingerprintVisible,
  });

  const toggleVis = useMutation({
    mutationFn: (v: boolean) => adminApi.setFingerprintVisible(v),
    onSuccess: (data) => qc.setQueryData(["fingerprint-visible"], data),
  });

  const visible = visData?.visible ?? true;

  if (!visible && !isSuperadmin) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-mono font-semibold text-stone-600 uppercase tracking-widest">
          Fingerprint Index
        </h2>
        {isSuperadmin && (
          <button
            onClick={() => toggleVis.mutate(!visible)}
            disabled={toggleVis.isPending}
            className={`flex items-center gap-1.5 text-xs font-mono transition-colors ${
              visible ? "text-violet-400 hover:text-stone-400" : "text-stone-600 hover:text-violet-400"
            }`}
          >
            {visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            {visible ? "Visible to admins" : "Hidden from admins"}
          </button>
        )}
      </div>
      {visible && <FingerprintIndexCard />}
      {!visible && isSuperadmin && (
        <p className="text-[10px] font-mono text-stone-700 italic">
          Section hidden from admins — only superadmin can see this.
        </p>
      )}
    </section>
  );
}

function fmtEta(sec: number): string {
  if (sec < 60)   return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function FingerprintIndexCard() {
  const qc = useQueryClient();
  const triggerFp = useMutation({
    mutationFn: adminApi.triggerFingerprintIndex,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fingerprint-progress"] });
      adminApi.clearFingerprintCancel().catch(() => {});
    },
  });
  const cancelFp = useMutation({
    mutationFn: adminApi.cancelFingerprintIndex,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fingerprint-progress"] }),
  });

  const { data: progress } = useQuery({
    queryKey: ["fingerprint-progress"],
    queryFn: adminApi.fingerprintProgress,
    refetchInterval: 5_000,
  });

  const isRunning  = progress && progress.indexed > 0 && progress.indexed < progress.total && !progress.cancelled;
  const isDone     = progress && progress.total > 0 && progress.indexed >= progress.total;
  const isCancelled = progress?.cancelled;
  const pct        = progress?.pct ?? 0;

  return (
    <Card className="p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-mono text-stone-300 font-medium">Acoustic Fingerprint Index</p>
          <p className="text-xs font-mono text-stone-600 mt-0.5">
            Indexes all canonical tracks into RocksDB for Shazam-style recognition
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isRunning && (
            <button
              onClick={() => cancelFp.mutate()}
              disabled={cancelFp.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-stone-800 hover:bg-red-500/15 border border-stone-700 hover:border-red-500/30 text-xs font-mono text-stone-400 hover:text-red-400 disabled:opacity-40 transition-colors"
            >
              <XCircle className="w-3.5 h-3.5" />
              {cancelFp.isPending ? "Cancelling…" : "Cancel"}
            </button>
          )}
          <button
            onClick={() => triggerFp.mutate()}
            disabled={triggerFp.isPending}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-violet-500 hover:bg-violet-400 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-mono text-stone-950 font-semibold transition-colors"
          >
            <Fingerprint className="w-3.5 h-3.5" />
            {triggerFp.isPending ? "Dispatching…" : isCancelled ? "Resume" : "Build Index"}
          </button>
        </div>
      </div>

      {/* Progress bar + stats */}
      {progress && (
        <div className="space-y-2">
          {/* Counts + pct */}
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-stone-400">
              {progress.indexed.toLocaleString()}
              <span className="text-stone-600"> / {progress.total.toLocaleString()} tracks</span>
            </span>
            <span className={isDone ? "text-emerald-400" : isCancelled ? "text-orange-400" : isRunning ? "text-violet-400" : "text-stone-600"}>
              {pct}%{isCancelled ? " · paused" : ""}
            </span>
          </div>

          {/* Bar */}
          <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${isDone ? "bg-emerald-500" : isCancelled ? "bg-orange-500" : "bg-violet-500"} ${isRunning ? "animate-pulse" : ""}`}
              style={{ width: `${Math.max(pct, pct > 0 ? 1 : 0)}%` }}
            />
          </div>

          {/* Speed + ETA row */}
          <div className="flex items-center justify-between text-[10px] font-mono">
            <div className="flex items-center gap-3">
              {progress.speed_mbps != null && !isCancelled && (
                <span className="text-stone-500">
                  <span className="text-stone-300">{progress.speed_mbps}</span> MB/s
                </span>
              )}
              {progress.bytes_done_mb != null && (
                <span className="text-stone-600">{progress.bytes_done_mb} MB processed</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {isRunning && progress.eta_seconds != null && (
                <span className="text-violet-400">~{fmtEta(progress.eta_seconds)} left</span>
              )}
              {isDone && <span className="text-emerald-500">Complete</span>}
              {isCancelled && <span className="text-orange-400">Paused — click Resume to continue</span>}
              <a href="/recognize" target="_blank" className="text-violet-500 hover:text-violet-400 underline underline-offset-2">
                /recognize →
              </a>
            </div>
          </div>
        </div>
      )}

      {triggerFp.isError && (
        <p className="text-xs font-mono text-red-400">Failed to trigger — is the worker running?</p>
      )}
    </Card>
  );
}

export function SettingsPage() {
  const { role } = useAuth();
  const isStaff = role === "staff";
  const [enabledMetrics, setEnabledMetrics] = useState<MetricKey[]>(loadEnabledMetrics);
  const [configuringMetrics, setConfiguringMetrics] = useState(false);
  const [playerVisible, setPlayerVisible] = useState<boolean>(loadPlayerVisible);
  const [poolDispatch, setPoolDispatch] = useState(false);
  const [enrichBatchSize, setEnrichBatchSize] = useState(200);
  const [enrichMissingOnly, setEnrichMissingOnly] = useState(false);
  const queryClient = useQueryClient();

  const { data: health, isLoading: healthLoading, refetch: refetchHealth } = useQuery({
    queryKey: ["admin-health"],
    queryFn: adminApi.health,
    refetchInterval: 30_000,
  });

  const { data: queueHealth, isLoading: queueLoading } = useQuery({
    queryKey: ["admin-queue-health"],
    queryFn: adminApi.queueHealth,
    refetchInterval: 15_000,
  });

  const { data: storage, isLoading: storageLoading } = useQuery({
    queryKey: ["admin-storage"],
    queryFn: adminApi.storageMetrics,
    refetchInterval: 60_000,
  });

  const { data: analytics } = useQuery({
    queryKey: ["analytics-dashboard"],
    queryFn: analyticsApi.dashboard,
    refetchInterval: 60_000,
  });

  const { data: poolJobs, refetch: refetchPoolJobs } = useQuery({
    queryKey: ["sync-jobs-pool"],
    queryFn: () => syncJobsApi.list({ mode: "pool_all", limit: 5 }),
    enabled: !isStaff,
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((j) => j.status === "running" || j.status === "queued") ? 3_000 : 30_000;
    },
  });

  const triggerPool = useMutation({
    mutationFn: () => syncJobsApi.trigger("pool_all", { dispatch: poolDispatch }),
    onSuccess: (job) => {
      queryClient.setQueryData<{ items: SyncJob[]; total: number }>(["sync-jobs-pool"], (old) => {
        if (!old) return { items: [job], total: 1 };
        return { ...old, items: [job, ...old.items].slice(0, 5) };
      });
    },
  });

  const { data: enrichJobs, refetch: refetchEnrichJobs } = useQuery({
    queryKey: ["sync-jobs-enrich"],
    queryFn: () => syncJobsApi.list({ mode: "batch_enrich_metadata", limit: 5 }),
    enabled: !isStaff,
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((j) => j.status === "running" || j.status === "queued") ? 3_000 : 30_000;
    },
  });

  const triggerEnrich = useMutation({
    mutationFn: () => syncJobsApi.trigger("batch_enrich_metadata", {
      batch_size: enrichBatchSize,
      only_missing_artist: enrichMissingOnly,
    }),
    onSuccess: (job) => {
      queryClient.setQueryData<{ items: SyncJob[]; total: number }>(["sync-jobs-enrich"], (old) => {
        if (!old) return { items: [job], total: 1 };
        return { ...old, items: [job, ...old.items].slice(0, 5) };
      });
    },
  });

  // When the most-recent pool job flips to complete, bust the backend cache and refetch analytics
  const lastPoolStatus = poolJobs?.items[0]?.status;
  const prevLastPoolStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevLastPoolStatus.current && prevLastPoolStatus.current !== "complete" && lastPoolStatus === "complete") {
      analyticsApi.invalidateDashboard().catch(() => {});
      queryClient.invalidateQueries({ queryKey: ["analytics-dashboard"] });
    }
    prevLastPoolStatus.current = lastPoolStatus;
  }, [lastPoolStatus, queryClient]);

  // Worker status: 0 workers = offline (not an error — workers simply aren't running)
  const workerStatus: ServiceStatus = health
    ? health.worker_count > 0 ? "ok" : "offline"
    : undefined;

  // Resolve a metric value from available data
  function resolveMetric(key: MetricKey): string {
    if (!analytics) return "—";
    switch (key) {
      case "total_tracks":    return formatCount(analytics.total_tracks);
      case "total_artists":   return formatCount(analytics.total_artists);
      case "total_listeners": return formatCount(analytics.total_listeners);
      case "streams_today":   return formatCount(analytics.total_streams_today);
      case "streams_week":    return formatCount(analytics.total_streams_week);
      case "archive_gb":      return `${analytics.storage_used_gb.toFixed(2)} GB`;
      case "bytes_today":     return formatFileSize(analytics.bytes_streamed_today ?? 0);
      case "bytes_week":      return formatFileSize(analytics.bytes_streamed_week ?? 0);
      case "bytes_30d":       return formatFileSize(analytics.bytes_streamed_30d ?? 0);
      case "active_jobs":     return formatCount(analytics.active_jobs);
      case "needs_review":    return formatCount(analytics.needs_review_count);
    }
  }

  function togglePlayerVisible() {
    const next = !playerVisible;
    setPlayerVisible(next);
    localStorage.setItem(PLAYER_VIS_KEY, String(next));
    // Dispatch a custom event so PlayerBar can react without a page reload
    window.dispatchEvent(new CustomEvent("tamasha:player-visibility", { detail: next }));
  }

  function toggleMetric(key: MetricKey) {
    const next = enabledMetrics.includes(key)
      ? enabledMetrics.filter((k) => k !== key)
      : [...enabledMetrics, key];
    setEnabledMetrics(next);
    saveEnabledMetrics(next);
  }

  return (
    <div className="space-y-8">
      {/* ── Service Health ──────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-mono font-semibold text-stone-600 uppercase tracking-widest">
            Services
          </h2>
          <button
            onClick={() => refetchHealth()}
            className="flex items-center gap-1.5 text-xs font-mono text-stone-600 hover:text-stone-400 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {([
            { label: "Database",  icon: Database, status: health ? (health.db_connected    ? "ok" : "error")   : undefined },
            { label: "Redis",     icon: Zap,      status: health ? (health.redis_connected  ? "ok" : "error")   : undefined },
            { label: "Workers",   icon: Server,   status: workerStatus, extra: health ? `${health.worker_count} active` : undefined },
            { label: "Platform",  icon: Layers,   status: health ? (health.status === "ok"  ? "ok" : health.status === "degraded" ? "offline" : "error") : undefined },
          ] as const).map(({ label, icon: Icon, status, extra }) => (
            <Card key={label} className="p-4 flex items-start gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                status === "ok" ? "bg-emerald-500/10" : status === "offline" ? "bg-violet-500/10" : status === "error" ? "bg-red-500/10" : "bg-stone-800"
              }`}>
                {healthLoading
                  ? <RefreshCw className="w-4 h-4 text-stone-600 animate-spin" />
                  : <Icon className={`w-4 h-4 ${status === "ok" ? "text-emerald-400" : status === "offline" ? "text-violet-400" : status === "error" ? "text-red-400" : "text-stone-400"}`} />}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-mono text-stone-500 mb-1">{label}</p>
                {healthLoading ? <Skeleton className="h-4 w-16" /> : <StatusBadge status={status as ServiceStatus} />}
                {extra && !healthLoading && (
                  <p className="text-xs font-mono text-stone-700 mt-0.5">{extra}</p>
                )}
                {label === "Workers" && status === "offline" && !healthLoading && (
                  <p className="text-[10px] font-mono text-violet-600/70 mt-0.5">worker process not started</p>
                )}
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* ── Queue Depths ────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-xs font-mono font-semibold text-stone-600 uppercase tracking-widest">
          Job Queues
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {queueLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <Card key={i} className="p-4">
                  <Skeleton className="h-3 w-16 mb-2" />
                  <Skeleton className="h-6 w-10" />
                </Card>
              ))
            : queueHealth
              ? Object.entries(queueHealth.queues).map(([name, info]) => (
                  <Card key={name} className="p-4">
                    <p className="text-[10px] font-mono text-stone-600 truncate mb-2 uppercase tracking-wider">{name}</p>
                    <p className="text-xl font-display font-bold text-stone-100">{formatCount(info.depth)}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs font-mono text-stone-600">queued</span>
                      {info.active_tasks > 0 && (
                        <span className="text-xs font-mono text-violet-400">{info.active_tasks} active</span>
                      )}
                    </div>
                  </Card>
                ))
              : (
                <div className="col-span-5 text-xs font-mono text-stone-600 py-4">
                  No queue data — workers not running
                </div>
              )}
        </div>
        {/* Raw queue depths from health (llen keys) */}
        {health && Object.keys(health.queue_depths).length > 0 && (
          <div className="flex flex-wrap gap-2 mt-1">
            {Object.entries(health.queue_depths).map(([q, d]) => (
              <span key={q} className="px-2 py-0.5 rounded bg-stone-900 border border-stone-800 text-xs font-mono text-stone-500">
                {q}: <span className="text-stone-300">{d}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* ── Storage Volumes ─────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-xs font-mono font-semibold text-stone-600 uppercase tracking-widest">
          Storage Volumes
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {storageLoading
            ? Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="p-4">
                  <Skeleton className="h-3 w-24 mb-2" />
                  <Skeleton className="h-7 w-20" />
                </Card>
              ))
            : storage && [
                { label: "Music Tracks",  value: formatCount(storage.total_objects),          icon: Package },
                { label: "Archive Size",  value: formatFileSize(storage.total_bytes),          icon: HardDrive },
                { label: "Archive (GB)",  value: `${storage.total_gb.toFixed(3)} GB`,          icon: Database },
              ].map(({ label, value, icon: Icon }) => (
                <Card key={label} className="p-4 flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg bg-stone-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Icon className="w-4 h-4 text-stone-400" />
                  </div>
                  <div>
                    <p className="text-xs font-mono text-stone-500 mb-1">{label}</p>
                    <p className="text-xl font-display font-bold text-stone-100">{value}</p>
                  </div>
                </Card>
              ))}
        </div>

        {storage && storage.breakdown.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <HardDrive className="w-3.5 h-3.5 text-stone-600" />
                Volume Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2.5">
                {storage.breakdown.map((item) => {
                  const pct = storage.total_bytes > 0 ? (item.size_bytes / storage.total_bytes) * 100 : 0;
                  return (
                    <div key={item.prefix}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-mono text-stone-400">{item.prefix || "untagged"}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-mono text-stone-600">{formatCount(item.object_count)} files</span>
                          <span className="text-xs font-mono text-stone-300">{formatFileSize(item.size_bytes)}</span>
                        </div>
                      </div>
                      <div className="h-1 bg-stone-800 rounded-full overflow-hidden">
                        <div className="h-full bg-violet-500/60 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ── Interface ───────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-xs font-mono font-semibold text-stone-600 uppercase tracking-widest">
          Interface
        </h2>
        <Card className="p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-stone-800 flex items-center justify-center flex-shrink-0">
              {playerVisible
                ? <Eye className="w-4 h-4 text-stone-400" />
                : <EyeOff className="w-4 h-4 text-stone-600" />}
            </div>
            <div>
              <p className="text-sm font-body font-medium text-stone-200">Bottom Player Bar</p>
              <p className="text-xs font-mono text-stone-600">
                {playerVisible ? "Visible — click to hide" : "Hidden — click to show"}
              </p>
            </div>
          </div>
          <button
            onClick={togglePlayerVisible}
            className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${playerVisible ? "bg-violet-500" : "bg-stone-700"}`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${playerVisible ? "translate-x-5" : "translate-x-0.5"}`}
            />
          </button>
        </Card>
      </section>

      {/* ── Index ───────────────────────────────────────────────────────── */}
      {!isStaff && <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-mono font-semibold text-stone-600 uppercase tracking-widest">
            Index (Pool All)
          </h2>
          <button
            onClick={() => refetchPoolJobs()}
            className="flex items-center gap-1.5 text-xs font-mono text-stone-600 hover:text-stone-400 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
        <Card className="p-4 space-y-4">
          <p className="text-xs font-mono text-stone-500">
            Scan every audio file in R2 and create track stubs for anything not yet indexed.
          </p>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={poolDispatch}
                onChange={(e) => setPoolDispatch(e.target.checked)}
                className="accent-violet-500"
              />
              <span className="text-xs font-mono text-stone-400">
                Dispatch transcode + dedup for new files
              </span>
            </label>
            <button
              onClick={() => triggerPool.mutate()}
              disabled={triggerPool.isPending || poolJobs?.items.some((j) => j.status === "running" || j.status === "queued")}
              className="ml-auto px-4 py-1.5 rounded-md bg-violet-500 hover:bg-violet-400 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-mono text-stone-950 font-semibold transition-colors"
            >
              {triggerPool.isPending ? "Queuing…" : "Run Index"}
            </button>
          </div>
          {triggerPool.isError && (
            <p className="text-xs font-mono text-red-400">Failed to trigger — is the worker running?</p>
          )}
        </Card>

        {poolJobs && poolJobs.items.length > 0 && (
          <div className="space-y-2">
            {poolJobs.items.map((job) => (
              <PoolJobRow key={job.id} job={job} />
            ))}
          </div>
        )}
      </section>}

      {/* ── Extract Music ───────────────────────────────────────────────── */}
      {!isStaff && <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-mono font-semibold text-stone-600 uppercase tracking-widest">
            Extract Music (ID3 + Path)
          </h2>
          <button
            onClick={() => refetchEnrichJobs()}
            className="flex items-center gap-1.5 text-xs font-mono text-stone-600 hover:text-stone-400 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
        <Card className="p-4 space-y-4">
          <p className="text-xs font-mono text-stone-500">
            Read ID3 / Vorbis tags from R2 (partial download) and extract artist, album, title, year, genre.
            Creates artist stubs from discovered names. Falls back to path inference.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="text-xs font-mono text-stone-400">Batch size</span>
              <input
                type="number"
                min={10}
                max={1000}
                step={50}
                value={enrichBatchSize}
                onChange={(e) => setEnrichBatchSize(Number(e.target.value))}
                className="w-20 h-7 px-2 rounded-md bg-stone-800 border border-stone-700 text-xs font-mono text-stone-300 text-center"
              />
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enrichMissingOnly}
                onChange={(e) => setEnrichMissingOnly(e.target.checked)}
                className="accent-violet-500"
              />
              <span className="text-xs font-mono text-stone-400">Only tracks missing artist</span>
            </label>
            <button
              onClick={() => triggerEnrich.mutate()}
              disabled={triggerEnrich.isPending || enrichJobs?.items.some((j) => j.status === "running" || j.status === "queued")}
              className="ml-auto px-4 py-1.5 rounded-md bg-violet-500 hover:bg-violet-400 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-mono text-white font-semibold transition-colors"
            >
              {triggerEnrich.isPending ? "Queuing…" : "Run Extract"}
            </button>
          </div>
          {triggerEnrich.isError && (
            <p className="text-xs font-mono text-red-400">Failed to trigger — is the worker running?</p>
          )}
        </Card>
        {enrichJobs && enrichJobs.items.length > 0 && (
          <div className="space-y-2">
            {enrichJobs.items.map((job) => (
              <PoolJobRow key={job.id} job={job} />
            ))}
          </div>
        )}
      </section>}

      {/* ── Fingerprint Index ───────────────────────────────────────────── */}
      {!isStaff && <FingerprintIndexSection role={role} />}

      {/* ── Configurable Metrics ────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-mono font-semibold text-stone-600 uppercase tracking-widest">
            Platform Metrics
          </h2>
          <button
            onClick={() => setConfiguringMetrics((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-mono text-stone-600 hover:text-violet-400 transition-colors"
          >
            <Settings2 className="w-3 h-3" />
            {configuringMetrics ? "Done" : "Configure"}
          </button>
        </div>

        {configuringMetrics && (
          <Card className="p-4">
            <p className="text-xs font-mono text-stone-500 mb-3">Toggle which metrics appear below</p>
            <div className="flex flex-wrap gap-2">
              {ALL_METRIC_KEYS.map((key) => {
                const active = enabledMetrics.includes(key);
                return (
                  <button
                    key={key}
                    onClick={() => toggleMetric(key)}
                    className={`px-3 py-1.5 rounded-md text-xs font-mono border transition-colors ${
                      active
                        ? "bg-violet-500/15 border-violet-500/30 text-violet-400"
                        : "bg-stone-900 border-stone-800 text-stone-500 hover:text-stone-300"
                    }`}
                  >
                    {METRIC_META[key].label}
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        {enabledMetrics.length > 0 ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {enabledMetrics.map((key) => {
              const meta = METRIC_META[key];
              const Icon = meta.icon;
              const isWarn = key === "needs_review" && (analytics?.needs_review_count ?? 0) > 0;
              return (
                <Card key={key} className={`p-4 ${isWarn ? "border-violet-500/20" : ""}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`w-3.5 h-3.5 ${isWarn ? "text-violet-500" : "text-stone-600"}`} />
                    <p className="text-xs font-mono text-stone-500">{meta.label}</p>
                  </div>
                  <p className={`text-2xl font-display font-bold ${isWarn ? "text-violet-400" : "text-stone-100"}`}>
                    {resolveMetric(key)}
                  </p>
                </Card>
              );
            })}
          </div>
        ) : (
          <p className="text-xs font-mono text-stone-700 py-2">
            No metrics selected — click Configure to add some
          </p>
        )}
      </section>
    </div>
  );
}
