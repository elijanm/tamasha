import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Track } from "@/types";

// Module-level singleton audio element — persists across route changes
export const _audio =
  typeof window !== "undefined" ? new Audio() : ({} as HTMLAudioElement);

export type RepeatMode = "off" | "one" | "all";

export interface PlayerState {
  track: Track | null;
  isPlaying: boolean;
  isLoadingUrl: boolean;
  currentBitrate: string;
  availableBitrates: string[];
  volume: number;
  muted: boolean;
  currentTime: number;
  duration: number;
  queue: Track[];
  queueIndex: number;
  repeat: RepeatMode;
  reloadKey: number;

  setTrack: (track: Track, bitrate?: string) => void;
  setQueue: (tracks: Track[], startIndex?: number) => void;
  nextTrack: () => void;
  prevTrack: () => void;
  setRepeat: (mode: RepeatMode) => void;
  setIsPlaying: (v: boolean) => void;
  setIsLoadingUrl: (v: boolean) => void;
  setCurrentBitrate: (b: string) => void;
  setAvailableBitrates: (bs: string[]) => void;
  setVolume: (v: number) => void;
  setMuted: (v: boolean) => void;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  bumpReloadKey: () => void;
  close: () => void;
  toggle: () => void;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      track: null,
      isPlaying: false,
      isLoadingUrl: false,
      currentBitrate: "",
      availableBitrates: [],
      volume: 0.8,
      muted: false,
      currentTime: 0,
      duration: 0,
      queue: [],
      queueIndex: 0,
      repeat: "off",
      reloadKey: 0,

      setTrack: (track, bitrate = "") =>
        set({
          track,
          currentBitrate: bitrate,
          isPlaying: true,
          currentTime: 0,
          duration: 0,
          availableBitrates: [],
        }),

      setQueue: (tracks, startIndex = 0) => {
        if (!tracks.length) return;
        const idx = Math.max(0, Math.min(startIndex, tracks.length - 1));
        set({ queue: tracks, queueIndex: idx });
        get().setTrack(tracks[idx]);
      },

      nextTrack: () => {
        const { queue, queueIndex, repeat } = get();
        if (!queue.length) return;
        if (repeat === "one") {
          _audio.currentTime = 0;
          _audio.play().catch(() => {});
          return;
        }
        const next = queueIndex + 1;
        if (next < queue.length) {
          set({ queueIndex: next });
          get().setTrack(queue[next]);
        } else if (repeat === "all") {
          set({ queueIndex: 0 });
          get().setTrack(queue[0]);
        } else {
          set({ isPlaying: false });
        }
      },

      prevTrack: () => {
        const { queue, queueIndex } = get();
        if (!queue.length) return;
        if (_audio.currentTime > 3) {
          // Restart current track if past 3 s
          _audio.currentTime = 0;
          return;
        }
        const prev = Math.max(0, queueIndex - 1);
        set({ queueIndex: prev });
        get().setTrack(queue[prev]);
      },

      setRepeat: (mode) => set({ repeat: mode }),

      bumpReloadKey: () => set((s) => ({ reloadKey: s.reloadKey + 1 })),

      setIsPlaying: (v) => set({ isPlaying: v }),
      setIsLoadingUrl: (v) => set({ isLoadingUrl: v }),
      setCurrentBitrate: (b) => set({ currentBitrate: b }),
      setAvailableBitrates: (bs) => set({ availableBitrates: bs }),
      setVolume: (v) => set({ volume: v }),
      setMuted: (v) => set({ muted: v }),
      setCurrentTime: (t) => set({ currentTime: t }),
      setDuration: (d) => set({ duration: d }),
      close: () => {
        _audio.pause();
        set({
          track: null,
          isPlaying: false,
          isLoadingUrl: false,
          currentTime: 0,
          duration: 0,
          availableBitrates: [],
          currentBitrate: "",
        });
      },
      toggle: () => {
        const { isPlaying } = get();
        set({ isPlaying: !isPlaying });
      },
    }),
    {
      name: "tamasha-player",
      partialize: (state) => ({
        track: state.track,
        isPlaying: state.isPlaying,
        currentTime: state.currentTime,
        currentBitrate: state.currentBitrate,
        volume: state.volume,
        muted: state.muted,
        queue: state.queue,
        queueIndex: state.queueIndex,
        repeat: state.repeat,
      }),
    }
  )
);
