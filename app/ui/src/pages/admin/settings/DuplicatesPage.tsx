import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import {
  Copy, HardDrive, CheckCircle2, Clock, ScanLine, ChevronDown,
  ChevronUp, Play, Pause, Star, Trash2, RefreshCw, Layers,
  Disc3, XCircle, AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { duplicatesApi } from "@/api/duplicates";
import { syncJobsApi } from "@/api/syncJobs";
import { formatFileSize } from "@/utils/format";
import { usePlayerStore, _audio } from "@/store/player";
import type { DuplicateGroup, DuplicateGroupDetail, DuplicateTrackEntry, QualityBreakdown, SyncJob } from "@/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMethod(m: string) {
  return m === "sha256" ? "Exact" : m === "fingerprint" ? "Acoustic" : m === "md5_size" ? "Default" : "Metadata";
}

function MethodBadge({ method }: { method: string }) {
  const cls =
    method === "sha256"      ? "bg-red-500/10 text-red-400 border-red-500/20" :
    method === "fingerprint" ? "bg-violet-500/10 text-violet-400 border-violet-500/20" :
    method === "md5_size"    ? "bg-orange-500/10 text-orange-400 border-orange-500/20" :
                               "bg-stone-500/10 text-stone-400 border-stone-700";
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${cls}`}>
      {fmtMethod(method)}
    </span>
  );
}

// ─── Quality score bar ────────────────────────────────────────────────────────

function QualityBar({ score, breakdown }: { score: number; breakdown: QualityBreakdown }) {
  const pct = Math.min(100, score);
  const color =
    pct >= 70 ? "bg-emerald-500" :
    pct >= 40 ? "bg-yellow-500" :
                "bg-red-500";

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="w-20 h-1.5 bg-stone-800 rounded-full overflow-hidden flex-shrink-0">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-stone-400 flex-shrink-0">{score}/100</span>
      <div className="hidden xl:flex items-center gap-1 text-[10px] font-mono text-stone-600">
        <span title="Format">fmt:{breakdown.format_score}</span>
        <span>·</span>
        <span title="Bitrate">br:{breakdown.bitrate_score}</span>
        <span>·</span>
        <span title="Metadata">md:{breakdown.metadata_score}</span>
      </div>
    </div>
  );
}

// ─── Inline play button — routes through the global player ───────────────────

function AudioPreview({ track }: { track: DuplicateTrackEntry["track"] }) {
  const activeId  = usePlayerStore((s) => s.track?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isMine = activeId === track.id;

  function toggle() {
    const { setTrack, setIsPlaying } = usePlayerStore.getState();
    if (isMine) {
      if (isPlaying) { _audio.pause(); setIsPlaying(false); }
      else           { _audio.play().catch(() => {}); setIsPlaying(true); }
    } else {
      setTrack(track);
    }
  }

  return (
    <button
      onClick={toggle}
      title={isMine && isPlaying ? "Pause" : `Play ${track.title}`}
      className="w-6 h-6 rounded-full bg-stone-800 hover:bg-violet-500/20 border border-stone-700 hover:border-violet-500/30 flex items-center justify-center transition-colors flex-shrink-0"
    >
      {isMine && isPlaying
        ? <Pause className="w-3 h-3 text-violet-400" />
        : <Play  className="w-3 h-3 text-stone-400" />}
    </button>
  );
}

// ─── Track row inside group ───────────────────────────────────────────────────

function TrackRow({
  entry,
  isCanonical,
  isSuggested,
  onSetCanonical,
  resolving,
}: {
  entry: DuplicateTrackEntry;
  isCanonical: boolean;
  isSuggested: boolean;
  onSetCanonical: () => void;
  resolving: boolean;
}) {
  const { track, quality_score, quality_breakdown } = entry;
  const ext = track.r2_key_raw?.split(".").pop()?.toUpperCase() ?? "?";

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${
      isCanonical
        ? "bg-emerald-500/8 border border-emerald-500/20"
        : "bg-stone-900/60 border border-stone-800/40 hover:border-stone-700/60"
    }`}>
      {/* Artwork */}
      <div className="w-8 h-8 rounded bg-stone-800 flex items-center justify-center flex-shrink-0 overflow-hidden border border-stone-700/50">
        {track.artwork_url
          ? <img src={track.artwork_url} alt="" className="w-full h-full object-cover" />
          : <Disc3 className="w-3.5 h-3.5 text-stone-700" />}
      </div>

      {/* Play */}
      <AudioPreview track={track} />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono text-stone-200 truncate max-w-[200px]">{track.title}</span>
          {track.artist_name && (
            <span className="text-[10px] font-mono text-stone-500 truncate max-w-[120px]">{track.artist_name}</span>
          )}
          {isSuggested && !isCanonical && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-violet-500/10 text-violet-400 border border-violet-500/20">
              suggested
            </span>
          )}
          {isCanonical && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
              <Star className="w-2.5 h-2.5" /> canonical
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-[10px] font-mono text-stone-600 px-1.5 py-0.5 rounded bg-stone-800">{ext}</span>
          <span className="text-[10px] font-mono text-stone-600">{formatFileSize(track.file_size_bytes)}</span>
          {track.duration_seconds && (
            <span className="text-[10px] font-mono text-stone-600">
              {Math.floor(track.duration_seconds / 60)}:{String(Math.floor(track.duration_seconds % 60)).padStart(2, "0")}
            </span>
          )}
        </div>
      </div>

      {/* Quality */}
      <div className="hidden sm:block flex-shrink-0">
        <QualityBar score={quality_score} breakdown={quality_breakdown} />
      </div>

      {/* Action */}
      {!isCanonical && (
        <button
          onClick={onSetCanonical}
          disabled={resolving}
          className="flex-shrink-0 px-3 py-1 rounded-md text-[10px] font-mono bg-stone-800 hover:bg-violet-500/15 border border-stone-700 hover:border-violet-500/30 text-stone-400 hover:text-violet-400 disabled:opacity-40 transition-colors"
        >
          Keep this
        </button>
      )}
    </div>
  );
}

// ─── Group card ───────────────────────────────────────────────────────────────

function GroupCard({ group }: { group: DuplicateGroup }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedCanonical, setSelectedCanonical] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ["duplicate-group", group.id],
    queryFn: () => duplicatesApi.get(group.id),
    enabled: expanded,
    staleTime: 60_000,
  });

  const resolveMut = useMutation({
    mutationFn: (canonicalId: string) => duplicatesApi.resolve(group.id, canonicalId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["duplicates"] });
      qc.invalidateQueries({ queryKey: ["duplicate-metrics"] });
      qc.invalidateQueries({ queryKey: ["duplicate-group", group.id] });
    },
  });

  const suggestedId = detail?.tracks[0]?.track.id ?? null;
  const canonicalId = selectedCanonical ?? suggestedId;

  function handleMerge() {
    if (!canonicalId) return;
    resolveMut.mutate(canonicalId);
  }

  const isResolved = group.status === "resolved";

  return (
    <Card className={`overflow-hidden ${isResolved ? "opacity-70" : ""}`}>
      {/* Header row */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-stone-900/40 transition-colors text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <Copy className="w-4 h-4 text-stone-600 flex-shrink-0" />
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-body text-stone-200 truncate max-w-[260px]">
            {group.representative_title || "Untitled"}
          </span>
          <MethodBadge method={group.detection_method} />
          <span className="text-[10px] font-mono text-stone-500">
            {group.track_count} copies
          </span>
          {group.confidence < 1 && (
            <span className="text-[10px] font-mono text-stone-600">
              {Math.round(group.confidence * 100)}%
            </span>
          )}
          {isResolved && (
            <span className="text-[10px] font-mono text-emerald-500/70 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              resolved · freed {formatFileSize(group.bytes_freed)}
            </span>
          )}
        </div>
        {expanded
          ? <ChevronUp   className="w-4 h-4 text-stone-600 flex-shrink-0" />
          : <ChevronDown className="w-4 h-4 text-stone-600 flex-shrink-0" />}
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-stone-800 px-4 pb-4 pt-3 space-y-2">
          {detailLoading && (
            <div className="space-y-2">
              {Array.from({ length: group.track_count }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}

          {detail && (
            <>
              <div className="space-y-2">
                {detail.tracks.map((entry) => (
                  <TrackRow
                    key={entry.track.id}
                    entry={entry}
                    isCanonical={
                      isResolved
                        ? entry.track.id === group.canonical_track_id
                        : entry.track.id === canonicalId
                    }
                    isSuggested={entry.track.id === suggestedId}
                    onSetCanonical={() => setSelectedCanonical(entry.track.id)}
                    resolving={resolveMut.isPending}
                  />
                ))}
              </div>

              {!isResolved && (
                <div className="flex items-center justify-between pt-2 border-t border-stone-800/60">
                  <p className="text-[10px] font-mono text-stone-600">
                    Selected copy will be kept · others moved to removed-duplicates
                  </p>
                  <button
                    onClick={handleMerge}
                    disabled={!canonicalId || resolveMut.isPending}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-violet-500 hover:bg-violet-400 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-mono text-stone-950 font-semibold transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    {resolveMut.isPending ? "Merging…" : "Merge"}
                  </button>
                </div>
              )}

              {resolveMut.isError && (
                <p className="text-xs font-mono text-red-400">Failed to resolve group.</p>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Storage metrics banner ───────────────────────────────────────────────────

function MetricsBanner() {
  const { data, isLoading } = useQuery({
    queryKey: ["duplicate-metrics"],
    queryFn: duplicatesApi.metrics,
    refetchInterval: 60_000,
  });

  const cards = [
    {
      icon: Copy,
      label: "Duplicate Groups",
      value: isLoading ? null : data?.total_groups ?? 0,
      sub: isLoading ? null : `${data?.pending_groups ?? 0} pending review`,
      color: "text-stone-100",
      iconCls: "text-stone-600",
    },
    {
      icon: HardDrive,
      label: "Reclaimable Storage",
      value: isLoading ? null : formatFileSize(data?.reclaimable_bytes ?? 0),
      sub: isLoading ? null : `${data?.reclaimable_files ?? 0} duplicate files`,
      color: "text-yellow-400",
      iconCls: "text-yellow-600",
    },
    {
      icon: CheckCircle2,
      label: "Already Freed",
      value: isLoading ? null : formatFileSize(data?.bytes_already_freed ?? 0),
      sub: isLoading ? null : `${data?.resolved_groups ?? 0} groups resolved`,
      color: "text-emerald-400",
      iconCls: "text-emerald-600",
    },
    {
      icon: Layers,
      label: "Detection Methods",
      value: isLoading ? null : Object.keys(data?.detection_breakdown ?? {}).length > 0
        ? Object.entries(data!.detection_breakdown)
            .map(([k, v]) => `${fmtMethod(k)} ${v}`)
            .join(" · ")
        : "—",
      sub: null,
      color: "text-stone-300",
      iconCls: "text-stone-600",
      wide: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(({ icon: Icon, label, value, sub, color, iconCls, wide }) => (
        <Card key={label} className={`p-4 flex items-start gap-3 ${wide ? "lg:col-span-1" : ""}`}>
          <div className="w-9 h-9 rounded-lg bg-stone-800 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Icon className={`w-4 h-4 ${iconCls}`} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-mono text-stone-500 mb-1">{label}</p>
            {isLoading
              ? <Skeleton className="h-6 w-20" />
              : <p className={`text-xl font-display font-bold truncate ${color}`}>{value}</p>}
            {sub && !isLoading && (
              <p className="text-[10px] font-mono text-stone-600 mt-0.5">{sub}</p>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

// ─── Scan job row ─────────────────────────────────────────────────────────────

function ScanJobRow({ job }: { job: SyncJob }) {
  const active = job.status === "running" || job.status === "queued";
  const icon =
    job.status === "complete" ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> :
    job.status === "failed"   ? <XCircle      className="w-3.5 h-3.5 text-red-400" /> :
    job.status === "running"  ? <Disc3        className="w-3.5 h-3.5 text-violet-400 animate-spin" /> :
                                <Clock        className="w-3.5 h-3.5 text-stone-500" />;
  const statusCls =
    job.status === "complete" ? "text-emerald-400" :
    job.status === "failed"   ? "text-red-400" :
    job.status === "running"  ? "text-violet-400" :
                                "text-stone-500";

  return (
    <div className="px-3 py-2.5 rounded-md bg-stone-900 border border-stone-800/60 space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <span className="text-xs font-mono text-stone-400 truncate">
            {new Date(job.created_at).toLocaleString()}
          </span>
          <span className={`text-xs font-mono ${statusCls}`}>{job.status}</span>
        </div>
        {job.completed_at && (
          <span className="text-[10px] font-mono text-stone-600 flex-shrink-0">
            {(
              (new Date(job.completed_at).getTime() - new Date(job.started_at ?? job.created_at).getTime()) /
              1000
            ).toFixed(1)}s
          </span>
        )}
      </div>

      {(job.objects_scanned > 0 || job.objects_new > 0) && (
        <div className="flex items-center gap-4 text-[10px] font-mono text-stone-600">
          <span>scanned <span className="text-stone-300">{job.objects_scanned.toLocaleString()}</span></span>
          <span>groups found <span className="text-violet-400">{job.objects_new.toLocaleString()}</span></span>
        </div>
      )}

      {job.errors.length > 0 && (
        <div className="flex items-start gap-1.5 mt-1">
          <AlertCircle className="w-3 h-3 text-red-500 flex-shrink-0 mt-0.5" />
          <span className="text-[10px] font-mono text-red-400">{job.errors[0].message}</span>
        </div>
      )}

      {active && (
        <div className="h-0.5 bg-stone-800 rounded-full overflow-hidden">
          <div className="h-full bg-violet-500 rounded-full animate-pulse" style={{ width: "60%" }} />
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type TabFilter = "pending_review" | "resolved" | "all";

const TABS: { label: string; value: TabFilter }[] = [
  { label: "Pending Review", value: "pending_review" },
  { label: "Resolved",       value: "resolved"       },
  { label: "All",            value: "all"            },
];

export function DuplicatesPage() {
  const { role } = useAuth();
  const isStaff = role === "staff";
  const [tab, setTab] = useState<TabFilter>("pending_review");
  const [page, setPage] = useState(0);
  const LIMIT = 20;
  const qc = useQueryClient();

  const statusParam = tab === "all" ? undefined : tab;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["duplicates", tab, page],
    queryFn: () => duplicatesApi.list({ status: statusParam, skip: page * LIMIT, limit: LIMIT }),
    placeholderData: (prev) => prev,
  });

  const { data: scanJobs, refetch: refetchScanJobs } = useQuery({
    queryKey: ["scan-jobs-dedup"],
    queryFn: () => syncJobsApi.list({ mode: "dedup_scan", limit: 2 }),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((j) => j.status === "running" || j.status === "queued") ? 2_000 : 30_000;
    },
  });

  const scanMut = useMutation({
    mutationFn: duplicatesApi.scan,
    onSuccess: (job) => {
      qc.setQueryData<{ items: SyncJob[]; total: number }>(["scan-jobs-dedup"], (old) => {
        if (!old) return { items: [job], total: 1 };
        return { ...old, items: [job, ...old.items].slice(0, 2) };
      });
    },
  });

  const totalPages = data ? Math.ceil(data.total / LIMIT) : 0;
  const hasActiveScan = scanJobs?.items.some((j) => j.status === "running" || j.status === "queued");

  return (
    <div className="space-y-6">
      {/* Storage metrics above tabs */}
      <MetricsBanner />

      {/* Scan controls + recent job history */}
      {!isStaff && <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-mono text-stone-300 font-medium">Duplicate Scan</p>
            <p className="text-xs font-mono text-stone-600 mt-0.5">
              Groups tracks by content hash and acoustic fingerprint
            </p>
          </div>
          <button
            onClick={() => scanMut.mutate()}
            disabled={scanMut.isPending || !!hasActiveScan}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-violet-500 hover:bg-violet-400 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-mono text-stone-950 font-semibold transition-colors flex-shrink-0"
          >
            <ScanLine className="w-3.5 h-3.5" />
            {scanMut.isPending ? "Queuing…" : hasActiveScan ? "Scanning…" : "Scan Now"}
          </button>
        </div>

        {/* Recent scan job rows */}
        {scanJobs && scanJobs.items.length > 0 && (
          <div className="space-y-2 pt-1 border-t border-stone-800">
            <p className="text-[10px] font-mono text-stone-600 uppercase tracking-wider pt-1">Recent scans</p>
            {scanJobs.items.map((job) => (
              <ScanJobRow key={job.id} job={job} />
            ))}
          </div>
        )}
      </Card>}

      {/* Tab bar + refresh */}
      <div className="flex items-center justify-between gap-4">
        <nav className="flex items-center gap-1 border-b border-stone-800 flex-1">
          {TABS.map(({ label, value }) => (
            <button
              key={value}
              onClick={() => { setTab(value); setPage(0); }}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-mono border-b-2 -mb-px transition-colors ${
                tab === value
                  ? "border-violet-500 text-violet-400"
                  : "border-transparent text-stone-500 hover:text-stone-300"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <button
          onClick={() => {
            qc.invalidateQueries({ queryKey: ["duplicates"] });
            qc.invalidateQueries({ queryKey: ["duplicate-metrics"] });
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-stone-900 border border-stone-800 text-xs font-mono text-stone-500 hover:text-stone-300 transition-colors flex-shrink-0"
        >
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Group list */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : data?.items.length === 0 ? (
        <div className="py-16 text-center">
          <Copy className="w-8 h-8 text-stone-800 mx-auto mb-3" />
          <p className="text-sm font-mono text-stone-600">
            {tab === "pending_review" ? "No duplicates pending review" : "No groups found"}
          </p>
          {tab === "pending_review" && (
            <p className="text-xs font-mono text-stone-700 mt-1">
              Run a scan to detect duplicates across the archive
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {data?.items.map((group) => (
            <GroupCard key={group.id} group={group} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs font-mono text-stone-600">
            {data?.total ?? 0} groups · page {page + 1} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 rounded-md bg-stone-900 border border-stone-800 text-xs font-mono text-stone-400 disabled:opacity-40 hover:text-stone-200 transition-colors"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 rounded-md bg-stone-900 border border-stone-800 text-xs font-mono text-stone-400 disabled:opacity-40 hover:text-stone-200 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
