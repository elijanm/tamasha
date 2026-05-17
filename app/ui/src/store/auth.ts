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
          const { usePlayerStore } = await import("@/store/player");
          const player = usePlayerStore.getState();
          if (player.ownerId && player.ownerId !== user.id) {
            // Different user — wipe the previous session's player state entirely
            player.close();
          } else if (player.track) {
            // Same user — resume where they left off
            player.setOwnerId(user.id);
            player.setIsPlaying(true);
            player.bumpReloadKey();
          } else {
            player.setOwnerId(user.id);
          }
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : "Login failed";
          set({ error: message, isLoading: false });
          throw err;
        }
      },

      logout: async () => {
        // Fully clear the player so the next user starts with a clean slate
        const { usePlayerStore } = await import("@/store/player");
        usePlayerStore.getState().close();
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
