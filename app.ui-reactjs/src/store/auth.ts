import { create } from "zustand";
import { persist } from "zustand/middleware";
import { authApi } from "@/api/auth";
import { _audio } from "@/store/player";
import type { User } from "@/types";

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoading: boolean;
  error: string | null;

  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setTokens: (access: string, refresh: string) => void;
  setUser: (user: User) => void;
  clearError: () => void;
  fetchMe: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isLoading: false,
      error: null,

      login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const tokens = await authApi.login({ email, password });
          set({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
          });
          const user = await authApi.me();
          set({ user, isLoading: false });
          // Resume playback if a track was active when the user last logged out
          const { usePlayerStore } = await import("@/store/player");
          const player = usePlayerStore.getState();
          if (player.track) {
            player.setIsPlaying(true);
            player.bumpReloadKey();
          }
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "Login failed";
          set({ error: message, isLoading: false });
          throw err;
        }
      },

      logout: async () => {
        // Stop audio immediately; keep player track/position so it resumes on next login
        _audio.pause();
        // Import lazily to avoid circular dep at module init time
        const { usePlayerStore } = await import("@/store/player");
        usePlayerStore.getState().setIsPlaying(false);
        try {
          await authApi.logout();
        } catch {
          // Proceed regardless
        } finally {
          set({ user: null, accessToken: null, refreshToken: null });
        }
      },

      setTokens: (access, refresh) => {
        set({ accessToken: access, refreshToken: refresh });
      },

      setUser: (user) => set({ user }),

      clearError: () => set({ error: null }),

      fetchMe: async () => {
        const token = get().accessToken;
        if (!token) return;
        try {
          const user = await authApi.me();
          set({ user });
        } catch {
          set({ user: null, accessToken: null, refreshToken: null });
        }
      },
    }),
    {
      name: "tamasha-auth",
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
      }),
    }
  )
);
