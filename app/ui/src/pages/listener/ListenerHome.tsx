import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Music2, Play, Pause, Search, Volume2, VolumeX, Loader2,
  Heart, Clock, Disc2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { tracksApi } from "@/api/tracks";
import { usePlayerStore, _audio } from "@/store/player";
import { formatCount } from "@/utils/format";
import type { Track } from "@/types";

const PAGE_SIZE = 20;

function formatTime(s: number) {
  if (!isFinite(s) || isNaN(s)) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function inferredArtist(track: Track): string | null {
  const im = (track as unknown as Record<string, unknown>)?.inferred_metadata as
    Record<string, { value: string; confidence: number }> | undefined;
  return im?.artist?.value ?? null;
}

function displayArtist(track: Track): string {
  if (track.artist_name) return track.artist_name;
  if (track.artist_name_raw) return track.artist_name_raw;
  return inferredArtist(track) ?? "Unknown Artist";
}

interface Props {
  /** Pass null/undefined to show all statuses (admin/staff). Default: "ready" for listeners. */
  statusFilter?: string | null;
}

export function ListenerHome({ statusFilter = "ready" }: Props) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [skip, setSkip] = useState(0);

  // Global player state
  const {
    track: activeTrack,
    isPlaying,
    isLoadingUrl,
    currentTime,
    duration,
    currentBitrate,
    availableBitrates,
    muted,
    setTrack,
    setCurrentBitrate,
    setMuted,
  } = usePlayerStore();

  // Track which IDs have been liked this session (optimistic)
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());

  const handleClickTrack = (track: Track) => {
    if (activeTrack?.id === track.id) {
      // Same track — toggle play/pause via the audio element directly
      if (_audio.paused) {
        _audio.play().catch(() => {});
      } else {
        _audio.pause();
      }
    } else {
      // New track — hand off to the store; PlayerBar will load the URL
      setTrack(track);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    _audio.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
  };

  // Like mutation
  const likeMutation = useMutation({
    mutationFn: (id: string) => tracksApi.toggleLike(id),
    onSuccess: (_, id) => {
      setLikedIds((prev) => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
      qc.invalidateQueries({ queryKey: ["tracks"] });
    },
  });

  // Data
  const { data, isLoading: tracksLoading } = useQuery({
    queryKey: ["tracks", "browse", { status: statusFilter ?? undefined, search, skip }],
    queryFn: () => tracksApi.list({ status: statusFilter ?? undefined, search: search || undefined, limit: PAGE_SIZE, skip }),
  });
  const tracks = data?.items ?? [];
  const total = data?.total ?? 0;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="space-y-6 animate-fadeIn pb-4">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-stone-100">Browse Music</h1>
          <p className="mt-1 text-sm font-body text-stone-500">
            {statusFilter === "ready" ? "Discover the Tamasha archive" : `${formatCount(data?.total)} tracks in archive`}
          </p>
        </div>
        <div className="relative max-w-xs w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-600" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSkip(0); }}
            placeholder="Title, artist, album, genre…"
            className="pl-9"
          />
        </div>
      </div>

      {tracksLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {Array.from({ length: 15 }).map((_, i) => (
            <Card key={i} className="p-4">
              <Skeleton className="aspect-square w-full rounded mb-3" />
              <Skeleton className="h-3.5 w-3/4 mb-1.5" />
              <Skeleton className="h-3 w-1/2" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {tracks.map((track) => {
            const isActive = activeTrack?.id === track.id;
            const isLiked = likedIds.has(track.id);
            const artist = displayArtist(track);
            return (
              <Card
                key={track.id}
                className={`p-3 group cursor-pointer transition-all duration-200 flex flex-col ${
                  isActive
                    ? "border-violet-500/40 shadow-lg shadow-violet-500/10"
                    : "hover:border-stone-700 hover:shadow-lg hover:shadow-violet-500/5"
                }`}
              >
                {/* Artwork / state indicator */}
                <div
                  className="aspect-square w-full rounded-md bg-stone-800 mb-2.5 flex items-center justify-center relative overflow-hidden flex-shrink-0"
                  onClick={() => handleClickTrack(track)}
                >
                  {track.artwork_url && (
                    <img
                      src={track.artwork_url}
                      alt={track.title}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                  )}
                  {isActive && isLoadingUrl ? (
                    <Loader2 className="w-8 h-8 text-violet-400 animate-spin relative z-10" />
                  ) : isActive && isPlaying ? (
                    <div className="flex gap-0.5 items-end h-8 relative z-10">
                      {[1, 2, 3].map((b) => (
                        <div
                          key={b}
                          className="w-1.5 bg-violet-400 rounded-sm animate-pulse"
                          style={{ height: `${20 + b * 10}px`, animationDelay: `${b * 0.15}s` }}
                        />
                      ))}
                    </div>
                  ) : !track.artwork_url ? (
                    <Music2 className="w-10 h-10 text-stone-700" />
                  ) : null}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-violet-500 flex items-center justify-center">
                      {isActive && isPlaying
                        ? <Pause className="w-5 h-5 text-stone-950" />
                        : <Play className="w-5 h-5 text-stone-950 ml-0.5" />
                      }
                    </div>
                  </div>
                </div>

                {/* Track info */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-display font-medium truncate ${isActive ? "text-violet-200" : "text-stone-200"}`}>
                    {track.title || "Untitled"}
                  </p>
                  <p className="text-xs font-body text-stone-500 truncate mt-0.5">{artist}</p>
                  {track.album && (
                    <p className="text-xs font-body text-stone-700 truncate flex items-center gap-1 mt-0.5">
                      <Disc2 className="w-2.5 h-2.5 flex-shrink-0" />
                      {track.album}
                    </p>
                  )}
                </div>

                {/* Stats row */}
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-2.5 text-[10px] font-mono text-stone-700">
                    {(track.stream_count ?? 0) > 0 && (
                      <span className="flex items-center gap-0.5">
                        <Play className="w-2.5 h-2.5" />
                        {formatCount(track.stream_count)}
                      </span>
                    )}
                    {track.duration_seconds && (
                      <span className="flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        {formatTime(track.duration_seconds)}
                      </span>
                    )}
                  </div>
                  {/* Like button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      likeMutation.mutate(track.id);
                      setLikedIds((prev) => {
                        const next = new Set(prev);
                        next.has(track.id) ? next.delete(track.id) : next.add(track.id);
                        return next;
                      });
                    }}
                    className={`flex items-center gap-1 text-[10px] font-mono transition-colors ${
                      isLiked ? "text-red-400" : "text-stone-700 hover:text-red-400"
                    }`}
                  >
                    <Heart className={`w-3 h-3 ${isLiked ? "fill-red-400" : ""}`} />
                    {(track.like_count ?? 0) > 0 && formatCount(track.like_count + (isLiked ? 1 : 0))}
                  </button>
                </div>

                {/* Inline controls when active */}
                {isActive && (
                  <div className="mt-2.5 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                    {/* Progress bar */}
                    <div
                      className="h-1 bg-stone-800 rounded-full cursor-pointer relative group/seek"
                      onClick={handleSeek}
                    >
                      <div className="h-full bg-violet-500 rounded-full" style={{ width: `${progress}%` }} />
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-violet-400 opacity-0 group-hover/seek:opacity-100 transition-opacity"
                        style={{ left: `calc(${progress}% - 5px)` }}
                      />
                    </div>

                    {/* Time + volume */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-stone-600">
                        {formatTime(currentTime)} / {formatTime(duration)}
                      </span>
                      <button
                        onClick={() => setMuted(!muted)}
                        className="text-stone-600 hover:text-stone-400 transition-colors"
                      >
                        {muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                      </button>
                    </div>

                    {/* Bitrate selector */}
                    {availableBitrates.length > 1 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[10px] font-mono text-stone-700">kbps</span>
                        {availableBitrates.map((br) => (
                          <button
                            key={br}
                            onClick={() => setCurrentBitrate(br)}
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors ${
                              br === currentBitrate
                                ? "bg-violet-500/20 text-violet-400"
                                : "text-stone-600 hover:text-stone-400 bg-stone-800"
                            }`}
                          >
                            {br}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
          {tracks.length === 0 && !tracksLoading && (
            <div className="col-span-full flex flex-col items-center justify-center py-16 text-stone-700">
              <Music2 className="w-10 h-10 mb-3 opacity-30" />
              <p className="font-body text-sm">No tracks found</p>
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {!tracksLoading && total > 0 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs font-mono text-stone-600">
            Showing {skip + 1}–{Math.min(skip + PAGE_SIZE, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}
              disabled={skip === 0}
              className="h-7 text-xs"
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSkip(skip + PAGE_SIZE)}
              disabled={skip + PAGE_SIZE >= total}
              className="h-7 text-xs"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
