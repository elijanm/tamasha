import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/context/ThemeContext";
import {
  Radio, AlertTriangle, Plus, Trash2, Pencil, RefreshCw,
  TrendingUp, Clock, DollarSign, Mic2, Check, X,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { mediaMonitoringApi } from "@/api/mediaMonitoring";
import { tracksApi } from "@/api/tracks";
import { formatCount } from "@/utils/format";
import type { RadioStation, RadioStationCreate, AirplayLogCreate } from "@/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtKES(v: number): string {
  return `KES ${v.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── License banner ───────────────────────────────────────────────────────────

function LicenseBanner() {
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-violet-500/30 bg-violet-500/5">
      <AlertTriangle className="w-4 h-4 text-violet-400 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-body text-violet-300 font-medium">Enterprise licence required</p>
        <p className="text-xs font-body text-stone-500 mt-0.5">
          Media monitoring and airplay revenue tracking requires an enterprise licence.
          Contact{" "}
          <a href="mailto:support@tamasha.app" className="text-violet-400 hover:underline">
            support@tamasha.app
          </a>{" "}
          to get set up before logging airplays.
        </p>
      </div>
    </div>
  );
}

// ─── Station form ─────────────────────────────────────────────────────────────

function StationForm({
  initial,
  onSave,
  onCancel,
  loading,
}: {
  initial?: Partial<RadioStationCreate>;
  onSave: (d: RadioStationCreate) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [name, setName]         = useState(initial?.name ?? "");
  const [freq, setFreq]         = useState(initial?.frequency ?? "");
  const [country, setCountry]   = useState(initial?.country ?? "KE");
  const [region, setRegion]     = useState(initial?.region ?? "");
  const [rate, setRate]         = useState(String(initial?.royalty_rate ?? "0"));

  return (
    <div className="grid grid-cols-2 gap-3 p-4 rounded-lg bg-stone-900/60 border border-stone-800">
      <div>
        <label className="text-xs font-mono text-stone-500 mb-1 block">Station name *</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Capital FM" className="h-8 text-sm" />
      </div>
      <div>
        <label className="text-xs font-mono text-stone-500 mb-1 block">Frequency</label>
        <Input value={freq} onChange={(e) => setFreq(e.target.value)} placeholder="98.4 FM" className="h-8 text-sm" />
      </div>
      <div>
        <label className="text-xs font-mono text-stone-500 mb-1 block">Country</label>
        <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="KE" className="h-8 text-sm" />
      </div>
      <div>
        <label className="text-xs font-mono text-stone-500 mb-1 block">Region</label>
        <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Nairobi" className="h-8 text-sm" />
      </div>
      <div>
        <label className="text-xs font-mono text-stone-500 mb-1 block">Royalty rate (KES per play)</label>
        <Input
          type="number"
          min="0"
          step="0.5"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          className="h-8 text-sm"
        />
      </div>
      <div className="flex items-end gap-2">
        <Button
          size="sm"
          className="h-8 bg-violet-500 hover:bg-violet-400 text-stone-950"
          disabled={!name.trim() || loading}
          onClick={() => onSave({ name: name.trim(), frequency: freq || undefined, country, region: region || undefined, royalty_rate: parseFloat(rate) || 0 })}
        >
          {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Save
        </Button>
        <Button variant="ghost" size="sm" className="h-8" onClick={onCancel}>
          <X className="w-3.5 h-3.5" />
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Log airplay form ─────────────────────────────────────────────────────────

function LogAirplayForm({
  stations,
  onSave,
  onCancel,
  loading,
}: {
  stations: RadioStation[];
  onSave: (d: AirplayLogCreate) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [trackSearch, setTrackSearch] = useState("");
  const [selectedTrackId, setSelectedTrackId] = useState("");
  const [selectedTrackTitle, setSelectedTrackTitle] = useState("");
  const [stationId, setStationId] = useState(stations[0]?.id ?? "");
  const [playedAt, setPlayedAt] = useState(new Date().toISOString().slice(0, 16));
  const [duration, setDuration] = useState("180");
  const [notes, setNotes] = useState("");

  const { data: trackResults } = useQuery({
    queryKey: ["track-search-mm", trackSearch],
    queryFn: () => trackSearch.length >= 2 ? tracksApi.list({ search: trackSearch, limit: 20 }) : Promise.resolve(null),
    enabled: trackSearch.length >= 2,
  });

  return (
    <div className="space-y-3 p-4 rounded-lg bg-stone-900/60 border border-stone-800">
      <p className="text-xs font-mono text-stone-500 uppercase tracking-wider">Log Airplay</p>
      <div className="grid grid-cols-2 gap-3">
        {/* Track search */}
        <div className="col-span-2">
          <label className="text-xs font-mono text-stone-500 mb-1 block">Track *</label>
          {selectedTrackId ? (
            <div className="flex items-center gap-2 h-8 px-3 rounded-md bg-stone-800 border border-stone-700">
              <span className="text-sm text-stone-200 flex-1 truncate">{selectedTrackTitle}</span>
              <button onClick={() => { setSelectedTrackId(""); setSelectedTrackTitle(""); setTrackSearch(""); }} className="text-stone-600 hover:text-stone-300">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <Input
                value={trackSearch}
                onChange={(e) => setTrackSearch(e.target.value)}
                placeholder="Search track title…"
                className="h-8 text-sm"
              />
              {trackResults && trackResults.items.length > 0 && (
                <div className="absolute z-10 top-full mt-1 w-full max-h-40 overflow-y-auto bg-stone-900 border border-stone-700 rounded-md shadow-lg">
                  {trackResults.items.map((t) => (
                    <button
                      key={t.id}
                      className="w-full text-left px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800 truncate"
                      onClick={() => { setSelectedTrackId(t.id); setSelectedTrackTitle(t.title || "Untitled"); setTrackSearch(""); }}
                    >
                      {t.title || "Untitled"}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="text-xs font-mono text-stone-500 mb-1 block">Station *</label>
          <select
            value={stationId}
            onChange={(e) => setStationId(e.target.value)}
            className="w-full h-8 px-2 rounded-md bg-stone-900 border border-stone-700 text-sm text-stone-200 focus:outline-none focus:border-violet-500"
          >
            {stations.filter((s) => s.is_active).map((s) => (
              <option key={s.id} value={s.id}>{s.name}{s.frequency ? ` (${s.frequency})` : ""}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-mono text-stone-500 mb-1 block">Played at</label>
          <Input
            type="datetime-local"
            value={playedAt}
            onChange={(e) => setPlayedAt(e.target.value)}
            className="h-8 text-sm"
          />
        </div>

        <div>
          <label className="text-xs font-mono text-stone-500 mb-1 block">Duration (seconds)</label>
          <Input type="number" min="0" value={duration} onChange={(e) => setDuration(e.target.value)} className="h-8 text-sm" />
        </div>

        <div>
          <label className="text-xs font-mono text-stone-500 mb-1 block">Notes</label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className="h-8 text-sm" />
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          className="h-8 bg-violet-500 hover:bg-violet-400 text-stone-950"
          disabled={!selectedTrackId || !stationId || loading}
          onClick={() => onSave({
            track_id: selectedTrackId,
            station_id: stationId,
            played_at: new Date(playedAt).toISOString(),
            duration_seconds: parseInt(duration) || 0,
            notes: notes || undefined,
          })}
        >
          {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Log Airplay
        </Button>
        <Button variant="ghost" size="sm" className="h-8" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function MediaMonitoringPage() {
  const { theme } = useTheme();
  const isSimple = theme === "simple";
  const chartColors = {
    grid:         isSimple ? "#e7e5e4" : "#292524",
    tick:         isSimple ? "#78716c" : "#57534e",
    tooltipBg:    isSimple ? "#ffffff" : "#1c1917",
    tooltipBorder:isSimple ? "#d6d3d1" : "#292524",
    tooltipText:  isSimple ? "#1c1917" : "#d6d3d1",
    accent:       isSimple ? "#c41e2a" : "#f59e0b",
    revenue:      "#34d399",
  };

  const qc = useQueryClient();
  const [windowDays, setWindowDays] = useState(30);
  const [showAddStation, setShowAddStation] = useState(false);
  const [editingStation, setEditingStation] = useState<RadioStation | null>(null);
  const [showLogForm, setShowLogForm] = useState(false);

  const { data: dashboard, isLoading: dashLoading } = useQuery({
    queryKey: ["mm-dashboard", windowDays],
    queryFn: () => mediaMonitoringApi.dashboard(windowDays),
    refetchInterval: 60_000,
  });

  const { data: stations = [], isLoading: stationsLoading } = useQuery({
    queryKey: ["mm-stations"],
    queryFn: () => mediaMonitoringApi.listStations(),
  });

  const { data: airplays = [], isLoading: airplaysLoading, refetch: refetchAirplays } = useQuery({
    queryKey: ["mm-airplays"],
    queryFn: () => mediaMonitoringApi.listAirplays({ limit: 100 }),
  });

  const createStation = useMutation({
    mutationFn: mediaMonitoringApi.createStation,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mm-stations"] }); setShowAddStation(false); },
  });

  const updateStation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<RadioStationCreate & { is_active: boolean }> }) =>
      mediaMonitoringApi.updateStation(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["mm-stations"] }); setEditingStation(null); },
  });

  const deactivateStation = useMutation({
    mutationFn: mediaMonitoringApi.deactivateStation,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mm-stations"] }),
  });

  const logAirplay = useMutation({
    mutationFn: mediaMonitoringApi.logAirplay,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mm-airplays"] });
      qc.invalidateQueries({ queryKey: ["mm-dashboard"] });
      setShowLogForm(false);
    },
  });

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-stone-100">Media Monitoring</h1>
          <p className="mt-1 text-sm font-body text-stone-500">
            Track radio airplays and revenue across stations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className="h-8 px-2 rounded-md bg-stone-900 border border-stone-800 text-xs font-mono text-stone-300 focus:outline-none focus:border-violet-500"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last 12 months</option>
          </select>
        </div>
      </div>

      {/* License banner */}
      <LicenseBanner />

      <Tabs defaultValue="overview">
        <TabsList className="bg-stone-900 border border-stone-800">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="stations">Stations</TabsTrigger>
          <TabsTrigger value="log">Airplay Log</TabsTrigger>
        </TabsList>

        {/* ── Overview ──────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-5 mt-5">
          {/* Hero stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {dashLoading
              ? Array.from({ length: 4 }).map((_, i) => <Card key={i} className="p-4"><Skeleton className="h-3 w-20 mb-3" /><Skeleton className="h-8 w-16" /></Card>)
              : dashboard && [
                  { label: "Total Airplays",    value: formatCount(dashboard.total_airplays),          icon: Radio,       color: "text-stone-100" },
                  { label: "Total Airtime",     value: fmtDuration(dashboard.total_duration_seconds),  icon: Clock,       color: "text-blue-400"  },
                  { label: "Revenue Generated", value: fmtKES(dashboard.total_revenue),                icon: DollarSign,  color: "text-emerald-400"},
                  { label: "Active Stations",   value: formatCount(dashboard.active_stations),         icon: Mic2,        color: "text-violet-400" },
                ].map(({ label, value, icon: Icon, color }) => (
                  <Card key={label} className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className="w-3.5 h-3.5 text-stone-600" />
                      <p className="text-xs font-mono text-stone-500">{label}</p>
                    </div>
                    <p className={`text-2xl font-display font-bold ${color}`}>{value}</p>
                  </Card>
                ))}
          </div>

          {/* Airplay + Revenue trend */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-stone-600" />
                  Airplay Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                {dashLoading ? <Skeleton className="h-[140px]" /> : dashboard && dashboard.airplay_trend.length > 0 ? (
                  <ResponsiveContainer width="100%" height={140}>
                    <LineChart data={dashboard.airplay_trend} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: chartColors.tick, fontFamily: "monospace" }} tickFormatter={(d: string) => d.slice(5)} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10, fill: chartColors.tick, fontFamily: "monospace" }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: chartColors.tooltipBg, border: `1px solid ${chartColors.tooltipBorder}`, borderRadius: 6, fontSize: 11, color: chartColors.tooltipText }} />
                      <Line type="monotone" dataKey="plays" stroke={chartColors.accent} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <div className="h-[140px] flex items-center justify-center text-xs font-mono text-stone-700">No airplay data yet</div>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <DollarSign className="w-3.5 h-3.5 text-stone-600" />
                  Revenue Trend (KES)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {dashLoading ? <Skeleton className="h-[140px]" /> : dashboard && dashboard.airplay_trend.length > 0 ? (
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={dashboard.airplay_trend} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: chartColors.tick, fontFamily: "monospace" }} tickFormatter={(d: string) => d.slice(5)} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 10, fill: chartColors.tick, fontFamily: "monospace" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: chartColors.tooltipBg, border: `1px solid ${chartColors.tooltipBorder}`, borderRadius: 6, fontSize: 11, color: chartColors.tooltipText }} formatter={(v: number) => [fmtKES(v), "Revenue"]} />
                      <Bar dataKey="revenue" fill={chartColors.revenue} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <div className="h-[140px] flex items-center justify-center text-xs font-mono text-stone-700">No revenue data yet</div>}
              </CardContent>
            </Card>
          </div>

          {/* Top tracks + Revenue by station */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {dashboard && dashboard.top_tracks.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Top Tracks by Airplay</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {dashboard.top_tracks.map((t, i) => (
                      <div key={t.track_id} className="flex items-center gap-3">
                        <span className="text-xs font-mono text-stone-700 w-4 flex-shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-body text-stone-300 truncate">{t.title}</p>
                          <p className="text-[10px] font-mono text-stone-600">{fmtDuration(t.total_duration_seconds)} airtime</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-xs font-mono text-violet-400">{formatCount(t.total_plays)} plays</p>
                          <p className="text-[10px] font-mono text-emerald-500">{fmtKES(t.total_revenue)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {dashboard && dashboard.revenue_by_station.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Revenue by Station</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {dashboard.revenue_by_station.map((s) => {
                      const maxRev = dashboard.revenue_by_station[0]?.total_revenue || 1;
                      const pct = (s.total_revenue / maxRev) * 100;
                      return (
                        <div key={s.station_id}>
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs font-body text-stone-400">{s.station_name}</span>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <span className="text-[10px] font-mono text-stone-600">{formatCount(s.total_plays)} plays</span>
                              <span className="text-xs font-mono text-emerald-400">{fmtKES(s.total_revenue)}</span>
                            </div>
                          </div>
                          <div className="h-1 bg-stone-800 rounded-full">
                            <div className="h-full bg-emerald-500/50 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {dashboard && dashboard.total_airplays === 0 && !dashLoading && (
            <div className="text-center py-12 text-stone-700">
              <Radio className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-mono">No airplay data yet.</p>
              <p className="text-xs font-mono mt-1">Add stations then log airplays from the Airplay Log tab.</p>
            </div>
          )}
        </TabsContent>

        {/* ── Stations ──────────────────────────────────────────────────── */}
        <TabsContent value="stations" className="space-y-4 mt-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-mono text-stone-600">{stations.length} station{stations.length !== 1 ? "s" : ""} registered</p>
            {!showAddStation && (
              <Button size="sm" className="h-8 bg-violet-500 hover:bg-violet-400 text-stone-950" onClick={() => setShowAddStation(true)}>
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add Station
              </Button>
            )}
          </div>

          {showAddStation && (
            <StationForm
              onSave={(d) => createStation.mutate(d)}
              onCancel={() => setShowAddStation(false)}
              loading={createStation.isPending}
            />
          )}

          {editingStation && (
            <StationForm
              initial={editingStation}
              onSave={(d) => updateStation.mutate({ id: editingStation.id, data: d })}
              onCancel={() => setEditingStation(null)}
              loading={updateStation.isPending}
            />
          )}

          <div className="space-y-2">
            {stationsLoading
              ? Array.from({ length: 3 }).map((_, i) => <Card key={i} className="p-4"><Skeleton className="h-4 w-40 mb-2" /><Skeleton className="h-3 w-24" /></Card>)
              : stations.length === 0
                ? <p className="text-xs font-mono text-stone-700 py-4">No stations yet. Add one to start tracking.</p>
                : stations.map((s) => (
                    <Card key={s.id} className={`p-4 flex items-center gap-4 ${!s.is_active ? "opacity-50" : ""}`}>
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${s.is_active ? "bg-emerald-400" : "bg-stone-600"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-body font-medium text-stone-200">{s.name}</p>
                          {s.frequency && <span className="text-[10px] font-mono text-stone-600 bg-stone-800 px-1.5 py-0.5 rounded">{s.frequency}</span>}
                          {s.region && <span className="text-[10px] font-mono text-stone-600">{s.region}, {s.country}</span>}
                        </div>
                        <p className="text-xs font-mono text-emerald-500 mt-0.5">
                          {fmtKES(s.royalty_rate)} / play
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => setEditingStation(s)}
                          className="w-7 h-7 rounded flex items-center justify-center text-stone-600 hover:text-stone-300 hover:bg-stone-800 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {s.is_active && (
                          <button
                            onClick={() => deactivateStation.mutate(s.id)}
                            className="w-7 h-7 rounded flex items-center justify-center text-stone-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </Card>
                  ))}
          </div>
        </TabsContent>

        {/* ── Airplay Log ───────────────────────────────────────────────── */}
        <TabsContent value="log" className="space-y-4 mt-5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-mono text-stone-600">{airplays.length} entries</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-8" onClick={() => refetchAirplays()}>
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
              {!showLogForm && stations.filter((s) => s.is_active).length > 0 && (
                <Button size="sm" className="h-8 bg-violet-500 hover:bg-violet-400 text-stone-950" onClick={() => setShowLogForm(true)}>
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Log Airplay
                </Button>
              )}
            </div>
          </div>

          {showLogForm && (
            <LogAirplayForm
              stations={stations}
              onSave={(d) => logAirplay.mutate(d)}
              onCancel={() => setShowLogForm(false)}
              loading={logAirplay.isPending}
            />
          )}

          {stations.filter((s) => s.is_active).length === 0 && !stationsLoading && (
            <div className="text-xs font-mono text-violet-600 py-2">
              Add at least one active station before logging airplays.
            </div>
          )}

          {airplaysLoading
            ? Array.from({ length: 5 }).map((_, i) => <Card key={i} className="p-4"><Skeleton className="h-4 w-full mb-1" /><Skeleton className="h-3 w-40" /></Card>)
            : airplays.length === 0
              ? <p className="text-xs font-mono text-stone-700 py-4">No airplay logs yet.</p>
              : (
                <div className="space-y-2">
                  {airplays.map((log) => (
                    <Card key={log.id} className="p-3 flex items-center gap-4">
                      <div className="flex-1 min-w-0 grid grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-0.5">
                        <p className="text-sm font-body text-stone-200 truncate col-span-2 lg:col-span-1">{log.track_title || "Untitled"}</p>
                        <p className="text-xs font-mono text-stone-500 truncate">{log.station_name}</p>
                        <p className="text-xs font-mono text-stone-600">
                          {new Date(log.played_at).toLocaleString("en-KE", { dateStyle: "short", timeStyle: "short" })}
                        </p>
                        <p className="text-xs font-mono text-stone-600">{fmtDuration(log.duration_seconds)}</p>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <p className="text-sm font-mono text-emerald-400">{fmtKES(log.revenue)}</p>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
