import { useEffect, useRef, useState } from "react";
import {
  Play, Pause, Volume2, VolumeX, X, Music2, Loader2,
  SkipBack, SkipForward, Repeat, Repeat1,
} from "lucide-react";
import { usePlayerStore, _audio } from "@/store/player";
import { tracksApi } from "@/api/tracks";

const PLAYER_VIS_KEY = "tamasha:settings:player_visible";

function loadPlayerVisible(): boolean {
  try {
    const raw = localStorage.getItem(PLAYER_VIS_KEY);
    return raw === null ? true : raw === "true";
  } catch { return true; }
}

function formatTime(s: number): string {
  if (!isFinite(s) || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function PlayerBar() {
  const {
    track,
    isPlaying,
    isLoadingUrl,
    currentBitrate,
    availableBitrates,
    volume,
    muted,
    currentTime,
    duration,
    queue,
    queueIndex,
    repeat,
    reloadKey,
    setIsPlaying,
    setIsLoadingUrl,
    setCurrentBitrate,
    setAvailableBitrates,
    setVolume,
    setMuted,
    setCurrentTime,
    setDuration,
    nextTrack,
    prevTrack,
    setRepeat,
    close,
  } = usePlayerStore();

  const [playerVisible, setPlayerVisible] = useState<boolean>(loadPlayerVisible);

  // Listen for visibility toggle from Settings page
  useEffect(() => {
    const handler = (e: Event) => setPlayerVisible((e as CustomEvent<boolean>).detail);
    window.addEventListener("tamasha:player-visibility", handler);
    return () => window.removeEventListener("tamasha:player-visibility", handler);
  }, []);

  // Track whether we've registered audio event listeners (do it once)
  const listenersRegistered = useRef(false);

  // Duration tracking refs — accumulate actual seconds played
  const playSegmentStart = useRef<number | null>(null);
  const playedAccum = useRef<number>(0);
  const streamStartedAt = useRef<string | null>(null);
  const lastFlushedTrackId = useRef<string | null>(null);

  // Auto-play unlock: cleanup fn for the one-time document listeners registered when
  // auto-play is blocked by the browser (e.g. after page refresh with no user gesture).
  const autoPlayUnlockCleanup = useRef<(() => void) | null>(null);

  function flushPlayDuration(trackId: string) {
    if (lastFlushedTrackId.current === trackId) return;
    let total = playedAccum.current;
    if (playSegmentStart.current !== null) {
      total += (Date.now() - playSegmentStart.current) / 1000;
    }
    if (total >= 1 && streamStartedAt.current) {
      lastFlushedTrackId.current = trackId;
      tracksApi.logStreamComplete(trackId, Math.floor(total), streamStartedAt.current).catch(() => {});
    }
  }

  // Register audio event listeners once on mount
  useEffect(() => {
    if (listenersRegistered.current) return;
    listenersRegistered.current = true;

    const onTimeUpdate = () => setCurrentTime(_audio.currentTime);
    const onLoadedMetadata = () => {
      setDuration(_audio.duration);
      const savedTime = parseFloat(_audio.dataset.resumeAt ?? "0");
      if (savedTime > 0) {
        _audio.currentTime = savedTime;
        delete _audio.dataset.resumeAt;
      }
    };
    const onEnded = () => {
      if (_audio.dataset.trackId) flushPlayDuration(_audio.dataset.trackId);
      usePlayerStore.getState().nextTrack();
    };
    const onPlay = () => {
      playSegmentStart.current = Date.now();
      setIsPlaying(true);
    };
    const onPause = () => {
      if (playSegmentStart.current !== null) {
        playedAccum.current += (Date.now() - playSegmentStart.current) / 1000;
        playSegmentStart.current = null;
      }
      setIsPlaying(false);
    };

    _audio.addEventListener("timeupdate", onTimeUpdate);
    _audio.addEventListener("loadedmetadata", onLoadedMetadata);
    _audio.addEventListener("ended", onEnded);
    _audio.addEventListener("play", onPlay);
    _audio.addEventListener("pause", onPause);

    const onVisibilityChange = () => {
      if (document.hidden && _audio.dataset.trackId) {
        flushPlayDuration(_audio.dataset.trackId);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      _audio.removeEventListener("timeupdate", onTimeUpdate);
      _audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      _audio.removeEventListener("ended", onEnded);
      _audio.removeEventListener("play", onPlay);
      _audio.removeEventListener("pause", onPause);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load and play whenever the track id or bitrate changes
  useEffect(() => {
    if (!track) return;

    const prevTrackId = _audio.dataset.trackId;
    const isNewTrack = prevTrackId !== track.id;
    // For new tracks: use store's currentTime (0 for fresh plays, >0 when restoring after page refresh)
    // For bitrate switches: use the live audio position
    const resumeAt = isNewTrack ? currentTime : _audio.currentTime;
    // Respect the persisted play/pause state — don't auto-play if user had paused before refresh
    const shouldPlay = usePlayerStore.getState().isPlaying;

    if (isNewTrack && prevTrackId) {
      flushPlayDuration(prevTrackId);
      playedAccum.current = 0;
      playSegmentStart.current = null;
    }

    // Discard any pending auto-play unlock from a previous track
    autoPlayUnlockCleanup.current?.();
    autoPlayUnlockCleanup.current = null;

    setIsLoadingUrl(true);
    tracksApi
      .getStreamUrl(track.id, currentBitrate || undefined)
      .then((data) => {
        setAvailableBitrates(data.available_bitrates);
        if (resumeAt > 0) {
          _audio.dataset.resumeAt = String(resumeAt);
        }
        _audio.dataset.trackId = track.id;
        _audio.src = data.url;
        _audio.load();
        if (!shouldPlay) return Promise.resolve();
        return _audio.play();
      })
      .then(() => {
        if (isNewTrack && shouldPlay) {
          streamStartedAt.current = new Date().toISOString();
          lastFlushedTrackId.current = null;
          tracksApi.logStream(track.id).catch(() => {});
        }
      })
      .catch(() => {
        setIsPlaying(false);
        if (!shouldPlay) return;
        // Auto-play was blocked (browser policy after page refresh with no prior gesture).
        // Resume the moment the user interacts with anything.
        const tryResume = () => {
          _audio.play()
            .then(() => setIsPlaying(true))
            .catch(() => {});
          autoPlayUnlockCleanup.current = null;
        };
        document.addEventListener("click", tryResume, { once: true });
        document.addEventListener("keydown", tryResume, { once: true });
        autoPlayUnlockCleanup.current = () => {
          document.removeEventListener("click", tryResume);
          document.removeEventListener("keydown", tryResume);
        };
      })
      .finally(() => {
        setIsLoadingUrl(false);
      });
  // We intentionally use track?.id, currentBitrate, and reloadKey as dependencies
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, currentBitrate, reloadKey]);

  // Sync play/pause state to the audio element
  useEffect(() => {
    if (!track) return;
    if (isPlaying) {
      _audio.play().catch(() => setIsPlaying(false));
    } else {
      _audio.pause();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);

  // Sync volume and muted state
  useEffect(() => {
    _audio.volume = muted ? 0 : volume;
  }, [volume, muted]);

  if (!track || !playerVisible) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-stone-950/95 backdrop-blur-md border-t border-stone-800 px-4 py-3">
      <div className="max-w-screen-2xl mx-auto flex items-center gap-4">
        {/* Track info */}
        <div className="flex items-center gap-3 w-56 flex-shrink-0 min-w-0">
          <div className="w-9 h-9 rounded-md bg-stone-800 flex items-center justify-center flex-shrink-0">
            <Music2 className="w-4 h-4 text-stone-600" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-body font-medium text-stone-200 truncate">
              {track.title || "Untitled"}
            </p>
            <p className="text-xs font-mono text-stone-600 truncate">
              {track.genre ?? track.album ?? "—"}
            </p>
          </div>
        </div>

        {/* Controls + progress */}
        <div className="flex-1 flex flex-col gap-1.5 min-w-0">
          <div className="flex items-center justify-center gap-3">
            {/* Repeat */}
            <button
              onClick={() => setRepeat(repeat === "off" ? "all" : repeat === "all" ? "one" : "off")}
              title={`Repeat: ${repeat}`}
              className={`transition-colors ${repeat !== "off" ? "text-violet-400" : "text-stone-600 hover:text-stone-400"}`}
            >
              {repeat === "one"
                ? <Repeat1 className="w-3.5 h-3.5" />
                : <Repeat className="w-3.5 h-3.5" />}
            </button>

            {/* Prev */}
            <button
              onClick={() => prevTrack()}
              disabled={queue.length === 0}
              className="text-stone-500 hover:text-stone-200 disabled:opacity-30 transition-colors"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            {/* Play/Pause */}
            <button
              onClick={() => {
                if (isPlaying) {
                  _audio.pause();
                } else {
                  setIsPlaying(true);
                  _audio.play().catch(() => setIsPlaying(false));
                  autoPlayUnlockCleanup.current?.();
                  autoPlayUnlockCleanup.current = null;
                }
              }}
              disabled={isLoadingUrl}
              className="w-8 h-8 rounded-full bg-violet-500 flex items-center justify-center hover:bg-violet-400 transition-colors disabled:opacity-50"
            >
              {isLoadingUrl ? (
                <Loader2 className="w-4 h-4 text-stone-950 animate-spin" />
              ) : isPlaying ? (
                <Pause className="w-4 h-4 text-stone-950" />
              ) : (
                <Play className="w-4 h-4 text-stone-950 ml-0.5" />
              )}
            </button>

            {/* Next */}
            <button
              onClick={() => nextTrack()}
              disabled={queue.length === 0}
              className="text-stone-500 hover:text-stone-200 disabled:opacity-30 transition-colors"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            {/* Queue position indicator */}
            {queue.length > 1 && (
              <span className="text-[10px] font-mono text-stone-700 w-10">
                {queueIndex + 1}/{queue.length}
              </span>
            )}
          </div>

          {/* Seek bar + time */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-stone-600 w-8 text-right flex-shrink-0">
              {formatTime(currentTime)}
            </span>
            <div
              className="flex-1 h-1 bg-stone-800 rounded-full cursor-pointer relative group"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = (e.clientX - rect.left) / rect.width;
                const t = pct * duration;
                _audio.currentTime = t;
                setCurrentTime(t);
              }}
            >
              <div
                className="h-full bg-violet-500 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-violet-400 shadow opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `calc(${progress}% - 6px)` }}
              />
            </div>
            <span className="text-[10px] font-mono text-stone-600 w-8 flex-shrink-0">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Bitrate selector */}
          {availableBitrates.length > 0 && (
            <div className="flex items-center gap-1 bg-stone-900 rounded-md border border-stone-800 overflow-hidden">
              <span className="text-[10px] font-mono text-stone-600 px-2">kbps</span>
              {availableBitrates.map((br) => (
                <button
                  key={br}
                  onClick={() => setCurrentBitrate(br)}
                  className={`px-2 py-1 text-[10px] font-mono transition-colors ${
                    currentBitrate === br
                      ? "bg-violet-500/20 text-violet-400"
                      : "text-stone-500 hover:text-stone-300"
                  }`}
                >
                  {br}
                </button>
              ))}
              {availableBitrates.length === 0 && (
                <button className="px-2 py-1 text-[10px] font-mono bg-violet-500/20 text-violet-400">
                  raw
                </button>
              )}
            </div>
          )}

          {/* Volume */}
          <div className="flex items-center gap-1.5 w-28">
            <button onClick={() => setMuted(!muted)}>
              {muted || volume === 0 ? (
                <VolumeX className="w-3.5 h-3.5 text-stone-500" />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-stone-500" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setVolume(v);
                if (muted && v > 0) setMuted(false);
              }}
              className="flex-1 h-1 accent-violet-500 cursor-pointer"
            />
          </div>

          {/* Close */}
          <button
            onClick={() => {
              if (_audio.dataset.trackId) flushPlayDuration(_audio.dataset.trackId);
              close();
            }}
            className="text-stone-600 hover:text-stone-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
