import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTheme } from "@/context/ThemeContext";
import { useAuth } from "@/hooks/useAuth";
import {
  Users, Music2, AlertTriangle,
  HardDrive, Play, Pause, Heart,
  Radio, ArrowRight, Award, Mic2, Globe2, FileAudio, Copy, ChevronRight, ChevronDown,
} from "lucide-react";
import { usePlayerStore, _audio } from "@/store/player";
import { tracksApi } from "@/api/tracks";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  LineChart, Line, CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { adminApi } from "@/api/admin";
import { analyticsApi } from "@/api/analytics";
import { duplicatesApi } from "@/api/duplicates";
import { formatFileSize, formatCount } from "@/utils/format";

const STATUS_COLORS: Record<string, string> = {
  pending:    "#78716c",
  processing: "#f59e0b",
  ready:      "#34d399",
  failed:     "#f87171",
};

import type { DashboardAnalytics } from "@/types";

const GENRE_COLORS = [
  "#f59e0b", "#34d399", "#60a5fa", "#f87171", "#a78bfa",
  "#fb923c", "#2dd4bf", "#e879f9", "#facc15", "#4ade80",
];

function TopTracksToggle({ analytics, loading }: { analytics: DashboardAnalytics | undefined; loading: boolean }) {
  const [view, setView] = useState<"streams" | "liked">("streams");
  const tracks = view === "streams" ? analytics?.top_tracks : analytics?.top_liked;
  const isEmpty = !loading && (!tracks || tracks.length === 0);

  return (
    <>
      <div className="flex items-center justify-between pb-2">
        <CardTitle className="text-sm">Top Tracks</CardTitle>
        <div className="flex items-center rounded-md border border-stone-800 overflow-hidden text-xs font-mono">
          <button
            onClick={() => setView("streams")}
            className={`px-3 py-1 flex items-center gap-1 transition-colors ${view === "streams" ? "bg-stone-800 text-stone-100" : "text-stone-500 hover:text-stone-300"}`}
          >
            <Play className="w-2.5 h-2.5" /> Streams
          </button>
          <button
            onClick={() => setView("liked")}
            className={`px-3 py-1 flex items-center gap-1 transition-colors ${view === "liked" ? "bg-stone-800 text-stone-100" : "text-stone-500 hover:text-stone-300"}`}
          >
            <Heart className="w-2.5 h-2.5" /> Liked
          </button>
        </div>
      </div>
      {loading ? (
        <div className="space-y-2 pb-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
        </div>
      ) : isEmpty ? (
        <div className="h-[240px] flex items-center justify-center text-stone-700 text-xs font-mono">
          No data yet
        </div>
      ) : (
        <div className="divide-y divide-stone-800/50">
          {tracks!.map((t, i) => (
            <div key={t.track_id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-800/20">
              <span className="text-xs font-mono text-stone-700 w-4 flex-shrink-0">{i + 1}</span>
              <p className="text-sm font-body text-stone-300 flex-1 truncate">{t.title || "Untitled"}</p>
              <div className="flex items-center gap-1 text-xs font-mono text-stone-600 flex-shrink-0">
                {view === "streams"
                  ? <><Play className="w-2.5 h-2.5" />{formatCount(t.stream_count)}</>
                  : <><Heart className="w-2.5 h-2.5" />{formatCount(t.like_count)}</>
                }
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Needs-review inline player list ───────────────────────────────────────────

function NeedsReviewPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ["review-queue-dashboard"],
    queryFn: () => tracksApi.getReviewQueue({ limit: 50 }),
    staleTime: 30_000,
  });

  const activeId  = usePlayerStore((s) => s.track?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);

  function toggle(track: NonNullable<typeof data>["items"][number]) {
    const { setTrack, setIsPlaying } = usePlayerStore.getState();
    if (activeId === track.id) {
      if (isPlaying) { _audio.pause(); setIsPlaying(false); }
      else           { _audio.play().catch(() => {}); setIsPlaying(true); }
    } else {
      setTrack(track);
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-1 mt-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  const tracks = data?.items ?? [];
  if (tracks.length === 0) {
    return (
      <p className="mt-4 text-xs font-mono text-stone-600 text-center py-4">
        No tracks need review
      </p>
    );
  }

  return (
    <div className="mt-3 divide-y divide-stone-800/40 max-h-[360px] overflow-y-auto">
      {tracks.map((track) => {
        const isMine = activeId === track.id;
        return (
          <div
            key={track.id}
            className={`flex items-center gap-3 px-1 py-2 rounded transition-colors ${
              isMine ? "bg-violet-500/5" : "hover:bg-stone-800/30"
            }`}
          >
            {/* Artwork */}
            <div className="w-8 h-8 rounded bg-stone-800 flex items-center justify-center flex-shrink-0 overflow-hidden border border-stone-700/40">
              {track.artwork_url
                ? <img src={track.artwork_url} alt="" className="w-full h-full object-cover" />
                : <Music2 className="w-3 h-3 text-stone-700" />}
            </div>

            {/* Play button */}
            <button
              onClick={() => toggle(track)}
              className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 border transition-colors ${
                isMine
                  ? "bg-violet-500/20 border-violet-500/40 text-violet-400"
                  : "bg-stone-800 border-stone-700 text-stone-400 hover:bg-violet-500/15 hover:border-violet-500/30 hover:text-violet-400"
              }`}
            >
              {isMine && isPlaying
                ? <Pause className="w-3 h-3" />
                : <Play  className="w-3 h-3" />}
            </button>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-mono text-stone-200 truncate">{track.title}</p>
              <p className="text-[10px] font-mono text-stone-600 truncate">
                {track.artist_name ?? track.genre ?? track.album ?? "—"}
              </p>
            </div>

            {/* Reasons */}
            {track.review_reasons?.[0] && (
              <span className="hidden sm:block text-[10px] font-mono text-amber-400/70 truncate max-w-[140px] flex-shrink-0">
                {track.review_reasons[0]}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function AdminDashboard() {
  const { theme } = useTheme();
  const { role } = useAuth();
  const isSimple = theme === "simple";
  const [showReviewPanel, setShowReviewPanel] = useState(false);

  const chartColors = {
    grid:         isSimple ? "#e7e5e4" : "#292524",
    tick:         isSimple ? "#78716c" : "#57534e",
    tickGenre:    isSimple ? "#57534e" : "#a8a29e",
    tooltipBg:    isSimple ? "#ffffff" : "#1c1917",
    tooltipBorder:isSimple ? "#d6d3d1" : "#292524",
    tooltipText:  isSimple ? "#1c1917" : "#d6d3d1",
    accent:       isSimple ? "#c41e2a" : "#f59e0b",
    accentCursor: isSimple ? "rgba(196,30,42,0.06)" : "rgba(245,158,11,0.06)",
  };

  const { data: storage } = useQuery({
    queryKey: ["admin-storage"],
    queryFn: adminApi.storageMetrics,
    refetchInterval: 60_000,
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ["analytics-dashboard"],
    queryFn: analyticsApi.dashboard,
    refetchInterval: 30_000,
  });

  const { data: dupMetrics } = useQuery({
    queryKey: ["duplicate-metrics"],
    queryFn: duplicatesApi.metrics,
    refetchInterval: 60_000,
  });

  const trackStatusData = analytics?.tracks_by_status
    ? Object.entries(analytics.tracks_by_status).map(([status, count]) => ({ status, count }))
    : [];

  return (
    <div className="space-y-5 animate-fadeIn">
      <div>
        <h1 className="font-display text-2xl font-bold text-stone-100">
          {role === "staff" ? "Staff Dashboard" : "Admin Dashboard"}
        </h1>
        <p className="mt-1 text-sm font-body text-stone-500">
          Platform overview, archive metrics, and system health
        </p>
      </div>

      <Tabs defaultValue="music">
        <TabsList className="bg-stone-900 border border-stone-800">
          <TabsTrigger value="music">Music</TabsTrigger>
          <TabsTrigger value="storage">Storage</TabsTrigger>
        </TabsList>

        {/* ── Music tab ─────────────────────────────────────────────────── */}
        <TabsContent value="music" className="space-y-6 mt-5">

          {/* Hero stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {analyticsLoading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i} className="p-4">
                    <Skeleton className="h-3 w-20 mb-3" />
                    <Skeleton className="h-8 w-16" />
                  </Card>
                ))
              : analytics && [
                  { label: "Total Tracks",    value: formatCount(analytics.total_tracks),     icon: Music2,        color: "text-stone-100"  },
                  { label: "Artists",         value: formatCount(analytics.total_artists),    icon: Users,         color: "text-stone-100"  },
                  { label: "Listeners",       value: formatCount(analytics.total_listeners),  icon: Radio,         color: "text-blue-400"   },
                  { label: "Streams Today",   value: formatCount(analytics.total_streams_today), icon: Play,       color: "text-violet-400"  },
                ].map(({ label, value, icon: Icon, color }) => (
                  <Card key={label} className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className="w-3.5 h-3.5 text-stone-600" />
                      <p className="text-xs font-mono text-stone-500">{label}</p>
                    </div>
                    <p className={`text-2xl font-display font-bold ${color}`}>{value}</p>
                  </Card>
                ))}
          </div>

          {/* Secondary stats */}
          {analytics && (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Play className="w-3.5 h-3.5 text-stone-600" />
                  <p className="text-xs font-mono text-stone-500">Streams (7 days)</p>
                </div>
                <p className="text-2xl font-display font-bold text-stone-100">{formatCount(analytics.total_streams_week)}</p>
              </Card>
              <Card
                className={`p-4 border-violet-500/20 transition-colors ${analytics.needs_review_count > 0 ? "cursor-pointer hover:border-violet-500/40 hover:bg-violet-500/[0.03]" : ""} ${showReviewPanel ? "border-violet-500/40 bg-violet-500/[0.03]" : ""}`}
                onClick={() => analytics.needs_review_count > 0 && setShowReviewPanel((v) => !v)}
              >
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-violet-500" />
                  <p className="text-xs font-mono text-stone-500">Needs Review</p>
                  {analytics.needs_review_count > 0 && (
                    <ChevronDown className={`w-3 h-3 text-stone-600 ml-auto transition-transform ${showReviewPanel ? "rotate-180" : ""}`} />
                  )}
                </div>
                <div className="flex items-end justify-between">
                  <p className="text-2xl font-display font-bold text-violet-400">{formatCount(analytics.needs_review_count)}</p>
                  {analytics.needs_review_count > 0 && (
                    <Button asChild variant="ghost" size="sm" className="text-xs h-7 mb-0.5" onClick={(e) => e.stopPropagation()}>
                      <Link to="/staff/queue">Queue <ArrowRight className="w-3 h-3 ml-1" /></Link>
                    </Button>
                  )}
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <HardDrive className="w-3.5 h-3.5 text-stone-600" />
                  <p className="text-xs font-mono text-stone-500">Archive Size</p>
                </div>
                <p className="text-2xl font-display font-bold text-stone-100">{analytics.storage_used_gb.toFixed(2)} GB</p>
              </Card>
            </div>
          )}

          {/* Needs-review expandable track list */}
          {showReviewPanel && (
            <Card>
              <CardHeader className="pb-1 pt-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-violet-500" />
                    Tracks Needing Review
                  </CardTitle>
                  <Button asChild variant="ghost" size="sm" className="text-xs h-7">
                    <Link to="/staff/queue">Open full queue <ArrowRight className="w-3 h-3 ml-1" /></Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <NeedsReviewPanel />
              </CardContent>
            </Card>
          )}

          {/* Stream trend + Tracks by status */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Streams — Last 30 Days</CardTitle>
              </CardHeader>
              <CardContent>
                {analyticsLoading ? (
                  <Skeleton className="h-[160px] w-full" />
                ) : analytics?.stream_trend && analytics.stream_trend.length > 0 ? (
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={analytics.stream_trend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                      <XAxis
                        dataKey="date"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: chartColors.tick, fontSize: 10, fontFamily: "JetBrains Mono" }}
                        tickFormatter={(v) => v.slice(5)}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: chartColors.tick, fontSize: 10, fontFamily: "JetBrains Mono" }}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{ background: chartColors.tooltipBg, border: `1px solid ${chartColors.tooltipBorder}`, borderRadius: 6, fontSize: 12, color: chartColors.tooltipText }}
                        cursor={{ stroke: chartColors.accent, strokeWidth: 1, strokeDasharray: "4 2" }}
                      />
                      <Line
                        type="monotone"
                        dataKey="count"
                        stroke={chartColors.accent}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 3, fill: chartColors.accent }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[160px] flex items-center justify-center text-stone-700 text-xs font-mono">
                    No stream data yet
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Tracks by Status</CardTitle>
              </CardHeader>
              <CardContent>
                {analyticsLoading ? (
                  <Skeleton className="h-[160px] w-full" />
                ) : trackStatusData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={trackStatusData} barSize={28} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <XAxis
                        dataKey="status"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: chartColors.tick, fontSize: 11, fontFamily: "JetBrains Mono" }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: chartColors.tick, fontSize: 10, fontFamily: "JetBrains Mono" }}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{ background: chartColors.tooltipBg, border: `1px solid ${chartColors.tooltipBorder}`, borderRadius: 6, fontSize: 12, color: chartColors.tooltipText }}
                        cursor={{ fill: chartColors.accentCursor }}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {trackStatusData.map((entry) => (
                          <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#78716c"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[160px] flex items-center justify-center text-stone-700 text-xs font-mono">
                    No tracks yet
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Ownership breakdown */}
          {analytics && (
            <div>
              <h2 className="text-xs font-mono font-semibold text-stone-600 uppercase tracking-widest mb-3">Ownership</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { key: "tamasha_owned",  label: "Tamasha Owned",  icon: Award,     color: "text-violet-400",  bg: "bg-violet-500/10"  },
                  { key: "signed_artist",  label: "Signed Artists", icon: Mic2,      color: "text-emerald-400",bg: "bg-emerald-500/10"},
                  { key: "orchard_source", label: "Orchard",        icon: Globe2,    color: "text-blue-400",   bg: "bg-blue-500/10"   },
                  { key: "wav_source",     label: "WAV Source",     icon: FileAudio, color: "text-purple-400", bg: "bg-purple-500/10" },
                ].map(({ key, label, icon: Icon, color, bg }) => (
                  <Card key={key} className="p-4 flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${bg}`}>
                      <Icon className={`w-4 h-4 ${color}`} />
                    </div>
                    <div>
                      <p className="text-xs font-mono text-stone-500">{label}</p>
                      {analyticsLoading
                        ? <Skeleton className="h-6 w-10 mt-1" />
                        : <p className={`text-xl font-display font-bold ${color}`}>{formatCount(analytics.ownership_breakdown[key] ?? 0)}</p>
                      }
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Top tracks (streamed / liked) + Genres */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-0">
                <TopTracksToggle analytics={analytics} loading={analyticsLoading} />
              </CardHeader>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Top Genres</CardTitle>
              </CardHeader>
              <CardContent>
                {analyticsLoading ? (
                  <Skeleton className="h-[220px] w-full" />
                ) : analytics?.genres && analytics.genres.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart
                      data={analytics.genres}
                      layout="vertical"
                      barSize={14}
                      margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
                    >
                      <XAxis
                        type="number"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: chartColors.tick, fontSize: 10, fontFamily: "JetBrains Mono" }}
                        allowDecimals={false}
                      />
                      <YAxis
                        type="category"
                        dataKey="genre"
                        width={90}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: chartColors.tickGenre, fontSize: 11, fontFamily: "DM Sans" }}
                      />
                      <Tooltip
                        contentStyle={{ background: chartColors.tooltipBg, border: `1px solid ${chartColors.tooltipBorder}`, borderRadius: 6, fontSize: 12, color: chartColors.tooltipText }}
                        cursor={{ fill: chartColors.accentCursor }}
                      />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                        {analytics.genres.map((_, i) => (
                          <Cell key={i} fill={GENRE_COLORS[i % GENRE_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[220px] flex items-center justify-center text-stone-700 text-xs font-mono">
                    No genre data yet
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Storage tab ───────────────────────────────────────────────── */}
        <TabsContent value="storage" className="space-y-5 mt-5">
          {/* R2 storage metrics */}
          {storage ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Card className="p-4">
                  <p className="text-xs font-mono text-stone-500 mb-1">Total Objects</p>
                  <p className="text-2xl font-display font-bold text-stone-100">{formatCount(storage.total_objects)}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs font-mono text-stone-500 mb-1">Total Size</p>
                  <p className="text-2xl font-display font-bold text-stone-100">{formatFileSize(storage.total_bytes)}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs font-mono text-stone-500 mb-1">Gigabytes</p>
                  <p className="text-2xl font-display font-bold text-stone-100">{storage.total_gb.toFixed(2)} GB</p>
                </Card>
              </div>

              {storage.breakdown.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Breakdown by Prefix</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {storage.breakdown.map((item) => (
                        <div key={item.prefix} className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-mono text-stone-300">{item.prefix}</p>
                            <p className="text-xs font-mono text-stone-600">{formatCount(item.object_count)} objects</p>
                          </div>
                          <span className="text-sm font-mono text-stone-400">{formatFileSize(item.size_bytes)}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="p-4">
                  <Skeleton className="h-3 w-20 mb-2" />
                  <Skeleton className="h-8 w-24" />
                </Card>
              ))}
            </div>
          )}

          {/* Duplicates detected */}
          <Link to="/admin/settings/duplicates" className="block group">
            <Card className="border transition-colors hover:border-violet-500/30 hover:bg-violet-500/[0.03] cursor-pointer">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
                      <Copy className="w-4 h-4 text-violet-400" />
                    </div>
                    <div>
                      <p className="text-xs font-mono text-stone-500 mb-0.5">Duplicates Detected</p>
                      {dupMetrics ? (
                        <div className="flex items-center gap-3">
                          <span className="text-xl font-display font-bold text-stone-100">
                            {dupMetrics.pending_groups}
                            <span className="text-xs font-mono text-stone-500 ml-1">pending</span>
                          </span>
                          {dupMetrics.reclaimable_bytes > 0 && (
                            <span className="text-xs font-mono text-amber-400/80">
                              {formatFileSize(dupMetrics.reclaimable_bytes)} reclaimable
                            </span>
                          )}
                        </div>
                      ) : (
                        <Skeleton className="h-5 w-24 mt-1" />
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-stone-600 group-hover:text-violet-400 transition-colors" />
                </div>
              </CardContent>
            </Card>
          </Link>

          {/* Bandwidth / bytes-streamed metrics */}
          {analytics && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Card className="p-4">
                  <p className="text-xs font-mono text-stone-500 mb-1">Streamed Today</p>
                  <p className="text-2xl font-display font-bold text-stone-100">{formatFileSize(analytics.bytes_streamed_today ?? 0)}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs font-mono text-stone-500 mb-1">Streamed This Week</p>
                  <p className="text-2xl font-display font-bold text-stone-100">{formatFileSize(analytics.bytes_streamed_week ?? 0)}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs font-mono text-stone-500 mb-1">Streamed (30 days)</p>
                  <p className="text-2xl font-display font-bold text-stone-100">{formatFileSize(analytics.bytes_streamed_30d ?? 0)}</p>
                </Card>
              </div>

              {(analytics.bandwidth_trend ?? []).length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Bandwidth Trend (30 days)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={analytics.bandwidth_trend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: chartColors.tick, fontFamily: "monospace" }} tickFormatter={(d: string) => d.slice(5)} />
                        <YAxis tick={{ fontSize: 10, fill: chartColors.tick, fontFamily: "monospace" }} tickFormatter={(v: number) => formatFileSize(v)} width={60} />
                        <Tooltip
                          contentStyle={{ background: chartColors.tooltipBg, border: `1px solid ${chartColors.tooltipBorder}`, borderRadius: 6, fontSize: 11, color: chartColors.tooltipText }}
                          formatter={(v: number) => [formatFileSize(v), "Bytes streamed"]}
                        />
                        <Bar dataKey="bytes" fill={chartColors.accent} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
