import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock, Music2, Play, Pause, Shuffle, TrendingUp, Loader2 } from "lucide-react";
import { tracksApi } from "@/api/tracks";
import { usePlayerStore } from "@/store/player";
import { useAuth } from "@/hooks/useAuth";
import type { Role, Track } from "@/types";

const ROLE_LABELS: Partial<Record<Role, string>> = {
  staff:    "Staff",
  artist:   "Artist",
  listener: "Listener",
};

function formatTime(s: number) {
  if (!s || !isFinite(s)) return "";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function formatStreams(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n > 0 ? String(n) : "";
}

function TrackRow({
  track,
  idx,
  isActive,
  isPlaying,
  isLoadingUrl,
  onPlay,
}: {
  track: Track;
  idx: number;
  isActive: boolean;
  isPlaying: boolean;
  isLoadingUrl: boolean;
  onPlay: () => void;
}) {
  return (
    <button
      onClick={onPlay}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all group text-left ${
        isActive
          ? "bg-violet-500/10 border-violet-500/30"
          : "bg-stone-900/40 hover:bg-stone-800/60 border-stone-800/50 hover:border-stone-700/60"
      }`}
    >
      {/* Artwork / index */}
      <div className="relative w-11 h-11 rounded-lg overflow-hidden flex-shrink-0 bg-stone-800 flex items-center justify-center">
        {track.artwork_url ? (
          <img src={track.artwork_url} alt={track.title} className="w-full h-full object-cover" />
        ) : (
          <Music2 className="w-4 h-4 text-stone-600" />
        )}
        {/* Play overlay */}
        <div className={`absolute inset-0 flex items-center justify-center transition-opacity ${isActive ? "bg-black/40 opacity-100" : "bg-black/50 opacity-0 group-hover:opacity-100"}`}>
          {isActive && isLoadingUrl ? (
            <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
          ) : isActive && isPlaying ? (
            <div className="flex gap-[3px] items-end h-4">
              {[1, 2, 3].map((b) => (
                <div key={b} className="w-[3px] bg-violet-400 rounded-sm animate-pulse"
                  style={{ height: `${6 + b * 4}px`, animationDelay: `${b * 0.15}s` }} />
              ))}
            </div>
          ) : (
            <Play className="w-4 h-4 text-white fill-white" />
          )}
        </div>
        {/* Index badge when not active */}
        {!isActive && (
          <span className="absolute top-0 left-0 w-5 h-5 bg-black/60 text-stone-400 text-[10px] font-mono flex items-center justify-center rounded-br-lg group-hover:opacity-0 transition-opacity">
            {idx + 1}
          </span>
        )}
      </div>

      {/* Title / artist */}
      <div className="flex-1 min-w-0">
        <p className={`font-body text-sm font-medium truncate ${isActive ? "text-violet-200" : "text-stone-200"}`}>
          {track.title || "Untitled"}
        </p>
        <p className="font-body text-xs text-stone-500 truncate mt-0.5">
          {track.artist_name ?? "Unknown Artist"}
          {track.album && <span className="text-stone-700"> · {track.album}</span>}
        </p>
      </div>

      {/* Duration + streams */}
      <div className="flex-shrink-0 text-right">
        {track.duration_seconds ? (
          <p className="font-mono text-xs text-stone-600">{formatTime(track.duration_seconds)}</p>
        ) : null}
        {(track.stream_count ?? 0) > 0 && (
          <p className="font-mono text-[10px] text-stone-700 mt-0.5">{formatStreams(track.stream_count)} plays</p>
        )}
      </div>
    </button>
  );
}

export function NotEnabledPage() {
  const { role } = useAuth();
  const { track: activeTrack, isPlaying, isLoadingUrl, setQueue } = usePlayerStore();
  const label = ROLE_LABELS[role as Role] ?? "Dashboard";

  const [mode, setMode] = useState<"top" | "random">("top");
  const [randomSeed, setRandomSeed] = useState(0);

  const { data: topData } = useQuery({
    queryKey: ["not-enabled-top"],
    queryFn: () => tracksApi.list({ limit: 5, sort_by: "stream_count" }),
    staleTime: 300_000,
  });

  // Fetch a larger pool for random selection; re-fetch on shuffle
  const { data: poolData, isLoading: poolLoading } = useQuery({
    queryKey: ["not-enabled-pool", randomSeed],
    queryFn: async () => {
      const res = await tracksApi.list({ limit: 50 });
      // Fisher-Yates shuffle then take 5
      const arr = [...res.items];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr.slice(0, 5);
    },
    enabled: mode === "random",
    staleTime: 0,
  });

  const tracks: Track[] = mode === "top"
    ? (topData?.items ?? [])
    : (poolData ?? []);

  const handleShuffle = useCallback(() => {
    setMode("random");
    setRandomSeed((s) => s + 1);
  }, []);

  const handleTop = useCallback(() => {
    setMode("top");
  }, []);

  return (
    <div className="min-h-screen bg-stone-950 flex flex-col items-center justify-center px-6 py-12">

      {/* Lock badge */}
      <div className="w-16 h-16 rounded-2xl bg-stone-900 border border-stone-800 flex items-center justify-center mb-6">
        <Lock className="w-7 h-7 text-stone-500" />
      </div>

      {/* Heading */}
      <h1 className="font-display text-2xl font-bold text-stone-100 text-center mb-2">
        {label} Portal Not Available
      </h1>
      <p className="font-body text-sm text-stone-400 text-center max-w-sm mb-3">
        The <span className="text-stone-200 font-medium">{label} Portal</span> is part of the
        Tamasha Enterprise licence and has not been enabled for this installation.
      </p>
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-900/30 border border-violet-700/40 text-xs font-mono text-violet-300 mb-10">
        <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
        Contact your administrator to enable access
      </div>

      {/* Music section */}
      <div className="w-full max-w-md">
        {/* Header row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {mode === "top"
              ? <TrendingUp className="w-4 h-4 text-stone-500" />
              : <Shuffle className="w-4 h-4 text-violet-400" />
            }
            <p className="font-body text-xs text-stone-500 uppercase tracking-widest">
              {mode === "top" ? "Most played" : "Shuffled picks"}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleTop}
              className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-mono transition-colors ${
                mode === "top"
                  ? "bg-stone-800 text-stone-300 border border-stone-700"
                  : "text-stone-600 hover:text-stone-400"
              }`}
            >
              <TrendingUp className="w-3 h-3" />
              Top
            </button>
            <button
              onClick={handleShuffle}
              disabled={poolLoading}
              className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-mono transition-colors ${
                mode === "random"
                  ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                  : "text-stone-600 hover:text-violet-400"
              }`}
            >
              {poolLoading
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Shuffle className="w-3 h-3" />
              }
              Shuffle
            </button>
          </div>
        </div>

        {/* Track list */}
        {tracks.length > 0 ? (
          <>
            <div className="space-y-1.5">
              {tracks.map((track, idx) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  idx={idx}
                  isActive={activeTrack?.id === track.id}
                  isPlaying={isPlaying}
                  isLoadingUrl={isLoadingUrl}
                  onPlay={() => setQueue(tracks, idx)}
                />
              ))}
            </div>

            <button
              onClick={() => tracks.length && setQueue(tracks, 0)}
              className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-body font-medium transition-colors"
            >
              <Play className="w-4 h-4 fill-white" />
              Play All
            </button>
          </>
        ) : (
          <div className="py-8 text-center">
            <Music2 className="w-8 h-8 text-stone-700 mx-auto mb-2" />
            <p className="text-xs font-body text-stone-600">No tracks available yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
