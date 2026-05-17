import { api } from "./client";
import type { DashboardAnalytics, ArtistAnalytics, TrackAnalytics } from "@/types";

export const analyticsApi = {
  dashboard: async (): Promise<DashboardAnalytics> => {
    const res = await api.get<DashboardAnalytics>("/analytics/dashboard");
    return res.data;
  },

  invalidateDashboard: async (): Promise<void> => {
    await api.post("/analytics/dashboard/invalidate");
  },

  artist: async (artistId: string): Promise<ArtistAnalytics> => {
    const res = await api.get<ArtistAnalytics>(`/analytics/artists/${artistId}`);
    return res.data;
  },

  track: async (trackId: string): Promise<TrackAnalytics> => {
    const res = await api.get<TrackAnalytics>(`/analytics/tracks/${trackId}`);
    return res.data;
  },
};
