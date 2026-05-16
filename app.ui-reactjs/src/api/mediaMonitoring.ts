import { api } from "./client";
import type {
  RadioStation, RadioStationCreate, RadioStationUpdate,
  AirplayLog, AirplayLogCreate, MonitoringDashboard,
} from "@/types";

export const mediaMonitoringApi = {
  // Stations
  listStations: async (activeOnly = false): Promise<RadioStation[]> => {
    const res = await api.get<RadioStation[]>("/media-monitoring/stations", {
      params: activeOnly ? { active_only: true } : undefined,
    });
    return res.data;
  },

  createStation: async (data: RadioStationCreate): Promise<RadioStation> => {
    const res = await api.post<RadioStation>("/media-monitoring/stations", data);
    return res.data;
  },

  updateStation: async (id: string, data: RadioStationUpdate): Promise<RadioStation> => {
    const res = await api.patch<RadioStation>(`/media-monitoring/stations/${id}`, data);
    return res.data;
  },

  deactivateStation: async (id: string): Promise<void> => {
    await api.delete(`/media-monitoring/stations/${id}`);
  },

  // Airplay logs
  logAirplay: async (data: AirplayLogCreate): Promise<AirplayLog> => {
    const res = await api.post<AirplayLog>("/media-monitoring/airplays", data);
    return res.data;
  },

  listAirplays: async (params: { station_id?: string; track_id?: string; limit?: number; skip?: number } = {}): Promise<AirplayLog[]> => {
    const res = await api.get<AirplayLog[]>("/media-monitoring/airplays", { params });
    return res.data;
  },

  // Dashboard
  dashboard: async (windowDays = 30): Promise<MonitoringDashboard> => {
    const res = await api.get<MonitoringDashboard>("/media-monitoring/dashboard", {
      params: { window_days: windowDays },
    });
    return res.data;
  },
};
