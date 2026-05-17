import { useQuery } from "@tanstack/react-query";
import { Lock, Music2, Play, Headphones } from "lucide-react";
import { tracksApi } from "@/api/tracks";
import { usePlayerStore } from "@/store/player";
import { useAuth } from "@/hooks/useAuth";
import type { Role } from "@/types";

const ROLE_LABELS: Partial<Record<Role, string>> = {
  staff:    "Staff",
  artist:   "Artist",
  listener: "Listener",
};

function formatStreams(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function NotEnabledPage() {
  const { role } = useAuth();
  const { setQueue } = usePlayerStore();
  const label = ROLE_LABELS[role as Role] ?? "Dashboard";

  const { data: tracksData } = useQuery({
    queryKey: ["not-enabled-tracks"],
    queryFn: () => tracksApi.list({ status: "ready", limit: 5 }),
    staleTime: 300_000,
  });

  const tracks = tracksData?.items ?? [];

  return (
    <div className="min-h-screen bg-stone-950 flex flex-col items-center justify-center px-6 py-12">
      {/* Lock badge */}
      <div className="w-16 h-16 rounded-2xl bg-stone-900 border border-stone-800 flex items-center justify-center mb-6">
        <Lock className="w-7 h-7 text-stone-500" />
      </div>

      {/* Heading */}
      <h1 className="font-display text-2xl font-bold text-stone-100 text-center mb-2">
        {label} Dashboard Not Available
      </h1>
      <p className="font-body text-sm text-stone-400 text-center max-w-md mb-3">
        The <span className="text-stone-200 font-medium">{label} Portal</span> is part of the
        Tamasha Enterprise licence and has not been enabled for this installation.
      </p>
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-900/30 border border-violet-700/40 text-xs font-mono text-violet-300 mb-8">
        <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
        Enterprise Feature — contact your administrator to enable access
      </div>

      {/* Top tracks */}
      {tracks.length > 0 && (
        <div className="w-full max-w-md">
          <div className="flex items-center gap-2 mb-4">
            <Headphones className="w-4 h-4 text-stone-500" />
            <p className="font-body text-xs text-stone-500 uppercase tracking-widest">
              While you wait — enjoy some music
            </p>
          </div>

          <div className="space-y-1">
            {tracks.map((track, idx) => (
              <button
                key={track.id}
                onClick={() => setQueue(tracks, idx)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-stone-900/60 hover:bg-stone-800/80 border border-stone-800/60 hover:border-stone-700/60 transition-all group text-left"
              >
                {/* Artwork / index */}
                <div className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-stone-800 flex items-center justify-center">
                  {track.artwork_url ? (
                    <img src={track.artwork_url} alt={track.title} className="w-full h-full object-cover" />
                  ) : (
                    <Music2 className="w-4 h-4 text-stone-600" />
                  )}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Play className="w-4 h-4 text-white fill-white" />
                  </div>
                  <span className="absolute top-0 left-0 w-5 h-5 bg-black/60 text-stone-400 text-[10px] font-mono flex items-center justify-center rounded-br-lg group-hover:opacity-0 transition-opacity">
                    {idx + 1}
                  </span>
                </div>

                {/* Title / artist */}
                <div className="flex-1 min-w-0">
                  <p className="font-body text-sm text-stone-200 truncate">{track.title}</p>
                  <p className="font-body text-xs text-stone-500 truncate">
                    {track.artist_name ?? "Unknown Artist"}
                    {track.album && <span className="text-stone-600"> · {track.album}</span>}
                  </p>
                </div>

                {/* Stream count */}
                <span className="font-mono text-xs text-stone-600 flex-shrink-0">
                  {formatStreams(track.stream_count)}
                </span>
              </button>
            ))}
          </div>

          <button
            onClick={() => tracks.length && setQueue(tracks, 0)}
            className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-body font-medium transition-colors"
          >
            <Play className="w-4 h-4 fill-white" />
            Play All
          </button>
        </div>
      )}
    </div>
  );
}
