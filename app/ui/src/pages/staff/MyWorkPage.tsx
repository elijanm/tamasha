import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  Music2, Upload, Users, Copy, TrendingUp, Activity,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { auditLogsApi } from "@/api/auditLogs";

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toISODateStart(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0)).toISOString();
}
function toISODateEnd(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59)).toISOString();
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type PresetKey = "today" | "yesterday" | "this_week" | "last_7" | "last_30";

interface DateRange { from: Date; to: Date; label: string }

function getPreset(key: PresetKey): DateRange {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (key) {
    case "today":
      return { from: today, to: today, label: "Today" };
    case "yesterday": {
      const y = addDays(today, -1);
      return { from: y, to: y, label: "Yesterday" };
    }
    case "this_week": {
      const dow = today.getDay();
      const mon = addDays(today, -(dow === 0 ? 6 : dow - 1));
      return { from: mon, to: today, label: "This Week" };
    }
    case "last_7":
      return { from: addDays(today, -6), to: today, label: "Last 7 Days" };
    case "last_30":
      return { from: addDays(today, -29), to: today, label: "Last 30 Days" };
  }
}

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today",     label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This Week" },
  { key: "last_7",    label: "Last 7 Days" },
  { key: "last_30",   label: "Last 30 Days" },
];

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  color = "text-stone-100",
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color?: string;
  loading?: boolean;
}) {
  return (
    <Card className="p-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg bg-stone-800 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-stone-500" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-mono text-stone-500 mb-1">{label}</p>
        {loading
          ? <Skeleton className="h-7 w-14" />
          : <p className={`text-2xl font-display font-bold ${color}`}>{value.toLocaleString()}</p>}
      </div>
    </Card>
  );
}

// ─── Timeline chart ───────────────────────────────────────────────────────────

function TimelineChart({
  data,
  isHourly,
  loading,
}: {
  data: { bucket: string; count: number }[];
  isHourly: boolean;
  loading: boolean;
}) {
  if (loading) return <Skeleton className="h-40 w-full" />;
  if (!data.length) return (
    <div className="h-40 flex items-center justify-center text-xs font-mono text-stone-600">
      No activity in this period
    </div>
  );

  const formatted = data.map((d) => ({
    label: isHourly
      ? new Date(d.bucket + "Z").toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      : new Date(d.bucket + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    count: d.count,
  }));

  const max = Math.max(...formatted.map((d) => d.count));

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={formatted} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 10, fill: "#78716c", fontFamily: "monospace" }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: "#78716c", fontFamily: "monospace" }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            background: "#1c1917",
            border: "1px solid #292524",
            borderRadius: 8,
            fontSize: 11,
            fontFamily: "monospace",
            color: "#e7e5e4",
          }}
          cursor={{ fill: "#292524" }}
        />
        <Bar dataKey="count" name="Actions" radius={[3, 3, 0, 0]}>
          {formatted.map((entry, i) => (
            <Cell
              key={i}
              fill={entry.count === max ? "#8b5cf6" : "#44403c"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Action breakdown ─────────────────────────────────────────────────────────

function ActionLabel({ action }: { action: string }) {
  const map: Record<string, string> = {
    "track.create":         "Track Created",
    "track.update":         "Track Updated",
    "track.delete":         "Track Deleted",
    "track.assign_artist":  "Artist Assigned",
    "track.update_artwork": "Artwork Updated",
    "upload.initiate":      "Upload Started",
    "upload.complete":      "Upload Completed",
    "upload.retry":         "Upload Retried",
    "artist.create":        "Artist Created",
    "artist.update":        "Artist Updated",
    "artist.approve":       "Artist Approved",
    "artist.reject":        "Artist Rejected",
    "duplicate.resolve":    "Duplicate Resolved",
    "r2_pool.ingest":       "Track Indexed",
  };
  return <span>{map[action] ?? action}</span>;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function MyWorkPage() {
  const [preset, setPreset] = useState<PresetKey>("today");
  const [customOffset, setCustomOffset] = useState(0); // shift days back for custom navigation

  const range = useMemo(() => {
    const base = getPreset(preset);
    if (customOffset === 0) return base;
    const days = Math.round((base.to.getTime() - base.from.getTime()) / 86400000) + 1;
    const shift = -customOffset * days;
    return {
      from: addDays(base.from, shift),
      to: addDays(base.to, shift),
      label: `${fmtDate(addDays(base.from, shift))} – ${fmtDate(addDays(base.to, shift))}`,
    };
  }, [preset, customOffset]);

  const isHourly = (range.to.getTime() - range.from.getTime()) / 86400000 <= 1;

  const { data, isLoading } = useQuery({
    queryKey: ["my-work", range.from.toISOString(), range.to.toISOString()],
    queryFn: () => auditLogsApi.myWork({
      from_date: toISODateStart(range.from),
      to_date: toISODateEnd(range.to),
    }),
    staleTime: 60_000,
  });

  const t = data?.totals;

  return (
    <div className="space-y-6">
      {/* Header + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-stone-900 border border-stone-800">
          {PRESETS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setPreset(key); setCustomOffset(0); }}
              className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
                preset === key && customOffset === 0
                  ? "bg-violet-500/20 text-violet-400 border border-violet-500/30"
                  : "text-stone-500 hover:text-stone-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Period navigation */}
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => setCustomOffset((o) => o + 1)}
            className="w-7 h-7 flex items-center justify-center rounded-md border border-stone-800 bg-stone-900 text-stone-500 hover:text-stone-300 transition-colors"
            title="Previous period"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-mono text-stone-500 min-w-[160px] text-center">
            {customOffset === 0 ? range.label : range.label}
          </span>
          <button
            onClick={() => setCustomOffset((o) => Math.max(0, o - 1))}
            disabled={customOffset === 0}
            className="w-7 h-7 flex items-center justify-center rounded-md border border-stone-800 bg-stone-900 text-stone-500 hover:text-stone-300 disabled:opacity-30 transition-colors"
            title="Next period"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Projection banner */}
      {data?.projected_today != null && data.projected_today > 0 && (
        <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-violet-500/20 bg-violet-500/5">
          <TrendingUp className="w-4 h-4 text-violet-400 flex-shrink-0" />
          <p className="text-sm font-mono text-stone-300">
            On track for{" "}
            <span className="text-violet-400 font-semibold">{data.projected_today.toLocaleString()}</span>
            {" "}actions today at your current pace
          </p>
        </div>
      )}

      {/* Total actions highlight */}
      <div className="flex items-center gap-3 px-4 py-4 rounded-xl border border-stone-800 bg-stone-900/60">
        <Activity className="w-5 h-5 text-violet-400 flex-shrink-0" />
        <div>
          <p className="text-xs font-mono text-stone-500 mb-0.5">Total Actions</p>
          {isLoading
            ? <Skeleton className="h-8 w-16" />
            : <p className="text-3xl font-display font-bold text-stone-100">
                {(t?.total_actions ?? 0).toLocaleString()}
              </p>}
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard icon={Music2}   label="Tracks Created"      value={t?.tracks_created ?? 0}      color="text-violet-400" loading={isLoading} />
        <StatCard icon={Music2}   label="Tracks Updated"      value={t?.tracks_updated ?? 0}      color="text-stone-100"  loading={isLoading} />
        <StatCard icon={Upload}   label="Uploads Completed"   value={t?.uploads_completed ?? 0}   color="text-emerald-400" loading={isLoading} />
        <StatCard icon={Users}    label="Artists Created"     value={t?.artists_created ?? 0}     color="text-blue-400"  loading={isLoading} />
        <StatCard icon={Copy}     label="Duplicates Resolved" value={t?.duplicates_resolved ?? 0} color="text-orange-400" loading={isLoading} />
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Users}    label="Artists Updated"     value={t?.artists_updated ?? 0}          loading={isLoading} />
        <StatCard icon={Music2}   label="Artist Assigned"     value={t?.tracks_assigned_artist ?? 0}   loading={isLoading} />
        <StatCard icon={Music2}   label="Artwork Updated"     value={t?.tracks_artwork_updated ?? 0}   loading={isLoading} />
        <StatCard icon={Music2}   label="Tracks Deleted"      value={t?.tracks_deleted ?? 0}            loading={isLoading} />
      </div>

      {/* Timeline chart */}
      <Card className="p-4 space-y-3">
        <p className="text-xs font-mono font-semibold text-stone-500 uppercase tracking-wider">
          Activity — {isHourly ? "by Hour" : "by Day"}
        </p>
        <TimelineChart
          data={data?.timeline ?? []}
          isHourly={isHourly}
          loading={isLoading}
        />
      </Card>

      {/* Action breakdown */}
      {!isLoading && data && data.action_counts.length > 0 && (
        <Card className="p-4 space-y-2">
          <p className="text-xs font-mono font-semibold text-stone-500 uppercase tracking-wider mb-3">
            Action Breakdown
          </p>
          {data.action_counts.map(({ action, count }) => {
            const pct = data.totals.total_actions > 0
              ? Math.round((count / data.totals.total_actions) * 100)
              : 0;
            return (
              <div key={action} className="flex items-center gap-3">
                <span className="text-xs font-mono text-stone-400 w-44 truncate flex-shrink-0">
                  <ActionLabel action={action} />
                </span>
                <div className="flex-1 h-1.5 bg-stone-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-violet-500/60 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-stone-300 w-8 text-right flex-shrink-0">{count}</span>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
