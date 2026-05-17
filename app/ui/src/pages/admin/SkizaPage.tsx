import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.js";
import type { Region } from "wavesurfer.js/dist/plugins/regions.js";
import {
  Plus, RefreshCw, ChevronLeft, ChevronRight, Clock, Music2,
  AlertTriangle, Play, Pause, SkipBack, Loader2, X, Scissors,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { tracksApi } from "@/api/tracks";
import { formatCount } from "@/utils/format";
import type { SkizaStatus, Track } from "@/types";

const SKIZA_STATUSES: SkizaStatus[] = [
  "draft", "pending_review", "approved", "rejected",
  "exporting", "exported", "submitted", "accepted", "failed",
];

const STATUS_STYLE: Record<SkizaStatus, string> = {
  draft:          "bg-stone-800 text-stone-400",
  pending_review: "bg-violet-500/15 text-violet-400",
  approved:       "bg-emerald-500/15 text-emerald-400",
  rejected:       "bg-red-500/15 text-red-400",
  exporting:      "bg-blue-500/15 text-blue-400",
  exported:       "bg-sky-500/15 text-sky-400",
  submitted:      "bg-purple-500/15 text-purple-400",
  accepted:       "bg-emerald-500/20 text-emerald-300",
  failed:         "bg-red-500/20 text-red-300",
};

const FLOW: SkizaStatus[] = [
  "draft", "pending_review", "approved", "exporting", "exported", "submitted", "accepted",
];

function fmt(s: number): string {
  if (!isFinite(s) || isNaN(s)) return "0:00.0";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ds = Math.floor((s % 1) * 10);
  return `${m}:${String(sec).padStart(2, "0")}.${ds}`;
}

// ── Waveform clip editor ───────────────────────────────────────────────────────

function WaveformClipEditor({
  track,
  onSuccess,
  onCancel,
}: {
  track: Track;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionRef = useRef<Region | null>(null);

  const [waveReady, setWaveReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [clipStart, setClipStart] = useState(0);
  const [clipEnd, setClipEnd] = useState(30);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");

  // Fetch stream URL, then init WaveSurfer
  const { data: streamData, isLoading: urlLoading } = useQuery({
    queryKey: ["stream-url-for-clip", track.id],
    queryFn: () => tracksApi.getStreamUrl(track.id),
    staleTime: 55 * 60 * 1000, // just under the 1-hour expiry
  });

  useEffect(() => {
    if (!streamData?.url || !containerRef.current) return;

    // Destroy any previous instance
    wsRef.current?.destroy();
    wsRef.current = null;
    regionRef.current = null;
    setWaveReady(false);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#44403c",
      progressColor: "#7c3aed",
      cursorColor: "#a78bfa",
      cursorWidth: 2,
      height: 96,
      barWidth: 2,
      barGap: 1,
      barRadius: 3,
      normalize: true,
      interact: true,
      url: streamData.url,
    });

    const regions = ws.registerPlugin(RegionsPlugin.create());
    wsRef.current = ws;

    ws.on("ready", () => {
      const dur = ws.getDuration();
      setDuration(dur);
      setWaveReady(true);

      const end = Math.min(30, dur);
      setClipStart(0);
      setClipEnd(end);

      regionRef.current = regions.addRegion({
        start: 0,
        end: end,
        color: "rgba(124, 58, 237, 0.18)",
        drag: true,
        resize: true,
        minLength: 1,
        maxLength: 30,
      });
    });

    ws.on("timeupdate", (t) => setCurrentTime(t));
    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("finish", () => setIsPlaying(false));

    regions.on("region-updated", (region) => {
      setClipStart(parseFloat(region.start.toFixed(2)));
      setClipEnd(parseFloat(region.end.toFixed(2)));
    });

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamData?.url]);

  // Space bar = play/pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        wsRef.current?.playPause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const createMutation = useMutation({
    mutationFn: () =>
      tracksApi.createSkizaClip(track.id, {
        title,
        start_seconds: clipStart,
        end_seconds: clipEnd,
        notes,
      }),
    onSuccess,
  });

  const clipDuration = parseFloat((clipEnd - clipStart).toFixed(2));
  const isLoading = urlLoading || !waveReady;

  function updateRegion(newStart: number, newEnd: number) {
    setClipStart(newStart);
    setClipEnd(newEnd);
    regionRef.current?.setOptions({ start: newStart, end: newEnd });
  }

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-stone-800/60">
        <div className="flex items-center gap-2.5 min-w-0">
          <Scissors className="w-4 h-4 text-violet-400 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-body font-medium text-stone-200 truncate leading-tight">
              {track.title || "Untitled"}
            </p>
            <p className="text-xs font-mono text-stone-600 truncate">
              {track.album ?? track.genre ?? track.status}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 flex-shrink-0" onClick={onCancel}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <div className="p-5 space-y-5">
        {/* Waveform container */}
        <div
          className="relative rounded-xl overflow-hidden border border-stone-800"
          style={{ background: "#0c0a08" }}
        >
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center z-10">
              <div className="flex items-center gap-2 text-stone-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs font-mono">
                  {urlLoading ? "Fetching audio…" : "Drawing waveform…"}
                </span>
              </div>
            </div>
          )}
          <div
            ref={containerRef}
            className="px-3 py-3"
            style={{ opacity: isLoading ? 0.1 : 1, transition: "opacity 0.3s" }}
          />
          {/* Time markers */}
          <div
            className="flex items-center justify-between px-3 pb-2 text-[10px] font-mono"
            style={{ color: "rgba(120,113,108,0.6)" }}
          >
            <span>{fmt(currentTime)}</span>
            <span className="text-violet-500/60">
              {waveReady ? `▐ ${fmt(clipStart)} — ${fmt(clipEnd)} ▌` : "—"}
            </span>
            <span>{fmt(duration)}</span>
          </div>
        </div>

        {/* Transport */}
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => wsRef.current?.seekTo(0)}
            disabled={!waveReady}
            className="p-1.5 rounded-lg text-stone-500 hover:text-stone-200 hover:bg-stone-800/60 transition-colors disabled:opacity-30"
            title="Back to start"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            onClick={() => wsRef.current?.playPause()}
            disabled={!waveReady}
            className="w-10 h-10 rounded-full bg-violet-500 hover:bg-violet-400 flex items-center justify-center text-white shadow-lg shadow-violet-500/20 transition-colors disabled:opacity-40"
            title="Play / Pause (Space)"
          >
            {isPlaying
              ? <Pause className="w-4 h-4" />
              : <Play className="w-4 h-4 ml-0.5" />}
          </button>

          <button
            onClick={() => regionRef.current?.play()}
            disabled={!waveReady}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-violet-500/15 text-violet-400 hover:bg-violet-500/25 transition-colors disabled:opacity-30"
            title="Preview clip only"
          >
            <Play className="w-3 h-3" />
            Preview clip
          </button>
        </div>

        {/* Clip time display */}
        <div className="grid grid-cols-3 gap-2">
          <div className="p-3 rounded-lg bg-stone-900/60 border border-stone-800 text-center">
            <p className="text-[10px] font-mono text-stone-600 uppercase tracking-wider mb-1.5">Start</p>
            <p className="text-base font-mono text-violet-400 tabular-nums">{fmt(clipStart)}</p>
          </div>
          <div className="p-3 rounded-lg bg-violet-500/8 border border-violet-500/25 text-center">
            <p className="text-[10px] font-mono text-stone-600 uppercase tracking-wider mb-1.5">Duration</p>
            <p className="text-base font-mono text-violet-300 tabular-nums">{fmt(clipDuration)}</p>
          </div>
          <div className="p-3 rounded-lg bg-stone-900/60 border border-stone-800 text-center">
            <p className="text-[10px] font-mono text-stone-600 uppercase tracking-wider mb-1.5">End</p>
            <p className="text-base font-mono text-violet-400 tabular-nums">{fmt(clipEnd)}</p>
          </div>
        </div>

        {/* Fine-tune seconds */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-mono text-stone-600 uppercase tracking-wider block mb-1">
              Start (s)
            </label>
            <Input
              type="number" step={0.1} min={0} max={clipEnd - 1}
              value={clipStart}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && v >= 0 && v < clipEnd) updateRegion(parseFloat(v.toFixed(2)), clipEnd);
              }}
              className="h-8 text-xs font-mono"
            />
          </div>
          <div>
            <label className="text-[10px] font-mono text-stone-600 uppercase tracking-wider block mb-1">
              End (s)
            </label>
            <Input
              type="number" step={0.1} min={clipStart + 1} max={duration || 9999}
              value={clipEnd}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && v > clipStart) updateRegion(clipStart, parseFloat(v.toFixed(2)));
              }}
              className="h-8 text-xs font-mono"
            />
          </div>
        </div>

        {/* Metadata */}
        <div className="space-y-2">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Clip title (optional)"
            className="h-9 text-sm"
          />
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes…"
            className="h-9 text-sm"
          />
        </div>

        {/* Submit */}
        <Button
          className="w-full h-10"
          disabled={createMutation.isPending || !waveReady || clipEnd <= clipStart}
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />Creating…</>
            : <><Scissors className="w-3.5 h-3.5 mr-2" />Create Clip</>}
        </Button>

        {createMutation.isError && (
          <p className="text-xs text-red-400 font-mono text-center">
            Skiza clip creation requires an enterprise licence — contact your administrator
          </p>
        )}

        <p className="text-[10px] font-mono text-stone-700 text-center">
          Drag the purple region on the waveform to adjust · Space to play/pause
        </p>
      </div>
    </Card>
  );
}

// ── Clip card ─────────────────────────────────────────────────────────────────

interface ClipCardProps {
  clip: {
    id: string; track_id: string; title: string;
    start_seconds: number; end_seconds: number;
    status: SkizaStatus; notes: string;
  };
  trackTitle?: string;
}

function ClipCard({ clip, trackTitle }: ClipCardProps) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (status: SkizaStatus) => tracksApi.updateSkizaClipStatus(clip.id, status),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["skiza-clips"] }),
  });

  const flowIdx = FLOW.indexOf(clip.status);
  const next = flowIdx >= 0 && flowIdx < FLOW.length - 1 ? FLOW[flowIdx + 1] : null;
  const duration = clip.end_seconds - clip.start_seconds;

  return (
    <div className="p-4 bg-stone-900/40 rounded-lg border border-stone-800 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-body font-medium text-stone-200 truncate">
            {clip.title || trackTitle || "Untitled"}
          </p>
          {trackTitle && clip.title && (
            <p className="text-xs font-mono text-stone-600 truncate mt-0.5">{trackTitle}</p>
          )}
        </div>
        <span className={`text-xs font-mono px-2 py-0.5 rounded flex-shrink-0 ${STATUS_STYLE[clip.status]}`}>
          {clip.status.replace(/_/g, " ")}
        </span>
      </div>

      <div className="flex items-center gap-4 text-xs font-mono text-stone-600">
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" /> {fmt(clip.start_seconds)} → {fmt(clip.end_seconds)}
        </span>
        <span>{duration.toFixed(1)}s</span>
      </div>

      {clip.notes && <p className="text-xs font-body text-stone-600 italic">{clip.notes}</p>}

      {/* Flow progress */}
      <div className="flex items-center gap-1 flex-wrap">
        {FLOW.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
              s === clip.status ? "bg-violet-500/20 text-violet-400"
              : i < flowIdx ? "bg-stone-800 text-stone-500"
              : "text-stone-800"
            }`}>{s.replace(/_/g, " ")}</span>
            {i < FLOW.length - 1 && <span className="text-stone-800 text-[10px]">→</span>}
          </div>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        {next && (
          <Button size="sm" variant="outline" className="h-7 text-xs"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(next)}>
            → {next.replace(/_/g, " ")}
          </Button>
        )}
        {clip.status !== "rejected" && clip.status !== "failed" && (
          <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500 hover:text-red-400"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate("rejected")}>
            Reject
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

export function SkizaPage() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [skip, setSkip] = useState(0);
  const [createFor, setCreateFor] = useState<Track | null>(null);
  const queryClient = useQueryClient();

  const { data: clipsData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["skiza-clips", { statusFilter, skip }],
    queryFn: () => tracksApi.listSkizaClips({
      status: statusFilter !== "all" ? statusFilter : undefined,
      skip,
      limit: PAGE_SIZE,
    }),
  });

  const [trackSearch, setTrackSearch] = useState("");
  const [debouncedTrackSearch, setDebouncedTrackSearch] = useState("");

  const { data: tracksData } = useQuery({
    queryKey: ["tracks-for-skiza", { search: debouncedTrackSearch }],
    queryFn: () => tracksApi.list({ search: debouncedTrackSearch || undefined, limit: 100 }),
  });

  const clips = clipsData?.items ?? [];
  const total = clipsData?.total ?? 0;
  const trackMap = Object.fromEntries((tracksData?.items ?? []).map((t) => [t.id, t.title]));

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* License banner */}
      <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-violet-500/30 bg-violet-500/5">
        <AlertTriangle className="w-4 h-4 text-violet-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-body text-violet-300 font-medium">Enterprise licence required</p>
          <p className="text-xs font-body text-stone-500 mt-0.5">
            Skiza clip distribution requires an enterprise licence.
            Contact <a href="mailto:support@tamasha.app" className="text-violet-400 hover:underline">support@tamasha.app</a> to get set up before submitting clips.
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-stone-100">Skiza Clips</h1>
          <p className="mt-1 text-sm font-body text-stone-500">
            Manage Skiza clip workflow — {formatCount(total)} clips
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-8">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Status filter chips */}
      <div className="grid grid-cols-3 lg:grid-cols-5 gap-2">
        {(["draft", "pending_review", "approved", "exported", "accepted"] as SkizaStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(statusFilter === s ? "all" : s); setSkip(0); }}
            className={`p-3 rounded-lg border text-left transition-all ${
              statusFilter === s ? "border-violet-500/40 bg-violet-500/10" : "border-stone-800 bg-stone-900/40 hover:border-stone-700"
            }`}
          >
            <p className={`text-xs font-mono ${STATUS_STYLE[s]?.split(" ")[1] ?? "text-stone-500"}`}>
              {s.replace(/_/g, " ")}
            </p>
          </button>
        ))}
      </div>

      {/* Waveform editor — full width when active */}
      {createFor && (
        <WaveformClipEditor
          track={createFor}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["skiza-clips"] });
            setCreateFor(null);
          }}
          onCancel={() => setCreateFor(null)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Clip list */}
        <div className="lg:col-span-2 space-y-3">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setSkip(0); }}>
            <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {SKIZA_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)
            : clips.length === 0
            ? (
              <div className="flex flex-col items-center justify-center py-16 text-stone-700">
                <Music2 className="w-8 h-8 mb-3 opacity-30" />
                <p className="text-sm font-body">No clips yet</p>
              </div>
            )
            : clips.map((clip) => (
                <ClipCard
                  key={clip.id}
                  clip={clip as Parameters<typeof ClipCard>[0]["clip"]}
                  trackTitle={trackMap[clip.track_id]}
                />
              ))
          }

          {!isLoading && total > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs font-mono text-stone-600">{skip + 1}–{Math.min(skip + PAGE_SIZE, total)} of {total}</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-7"
                  onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))} disabled={skip === 0}>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="sm" className="h-7"
                  onClick={() => setSkip(skip + PAGE_SIZE)} disabled={skip + PAGE_SIZE >= total}>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Create panel */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Plus className="w-4 h-4" /> Create New Clip
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-stone-600 block">Select Track</label>
                <Input
                  value={trackSearch}
                  onChange={(e) => {
                    setTrackSearch(e.target.value);
                    clearTimeout((window as unknown as Record<string, ReturnType<typeof setTimeout>>).__tskSearch);
                    (window as unknown as Record<string, ReturnType<typeof setTimeout>>).__tskSearch = setTimeout(
                      () => setDebouncedTrackSearch(e.target.value), 300
                    );
                  }}
                  placeholder="Search tracks…"
                  className="h-8 text-xs"
                />
                {(tracksData?.items ?? []).length > 0 && (
                  <div className="max-h-48 overflow-y-auto rounded-md border border-stone-800 bg-stone-950 divide-y divide-stone-800/50">
                    {(tracksData?.items ?? []).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => { setCreateFor(t); setTrackSearch(t.title || "Untitled"); }}
                        className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                          createFor?.id === t.id
                            ? "bg-violet-500/15 text-violet-300"
                            : "text-stone-400 hover:bg-stone-800/60 hover:text-stone-200"
                        }`}
                      >
                        <span className="font-body block truncate">{t.title || "Untitled"}</span>
                        <span className="font-mono text-stone-600 text-[10px]">{t.album ?? t.genre ?? t.status}</span>
                      </button>
                    ))}
                  </div>
                )}
                {tracksData && (tracksData?.items ?? []).length === 0 && debouncedTrackSearch && (
                  <p className="text-xs font-mono text-stone-700 px-1">No tracks match</p>
                )}
              </div>

              {createFor ? (
                <div className="p-3 rounded-lg bg-violet-500/8 border border-violet-500/20 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-body text-violet-300 truncate">{createFor.title || "Untitled"}</p>
                    <p className="text-[10px] font-mono text-stone-600">Editor open above ↑</p>
                  </div>
                  <Button
                    variant="ghost" size="sm" className="h-6 w-6 p-0 flex-shrink-0"
                    onClick={() => setCreateFor(null)}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              ) : (
                <p className="text-xs font-mono text-stone-700 text-center py-2">
                  Select a track to open the editor
                </p>
              )}
            </CardContent>
          </Card>

          {/* Workflow reference */}
          <Card className="p-4">
            <p className="text-xs font-mono text-stone-600 uppercase tracking-widest mb-3">Workflow</p>
            <div className="space-y-2">
              {FLOW.map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_STYLE[s]?.split(" ")[0] ?? "bg-stone-800"}`} />
                  <span className="text-xs font-mono text-stone-500">{s.replace(/_/g, " ")}</span>
                  {i < FLOW.length - 1 && <div className="w-px h-3 bg-stone-800 ml-1" />}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
