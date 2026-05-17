import { useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Music2, Play, Pause, Heart, Users, Globe2, Clock,
  ChevronLeft, ChevronRight, Pencil, Check, X, Upload, Loader2,
  Headphones, TrendingUp,
} from "lucide-react";
import { usePlayerStore } from "@/store/player";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "@/context/ThemeContext";
import { artistsApi } from "@/api/artists";
import { analyticsApi } from "@/api/analytics";
import { formatCount } from "@/utils/format";
import type { Track } from "@/types";

const TRACK_STATUS_COLORS: Record<string, string> = {
  pending:    "text-stone-500 bg-stone-800/60",
  processing: "text-yellow-400 bg-yellow-500/10",
  ready:      "text-emerald-400 bg-emerald-500/10",
  failed:     "text-red-400 bg-red-500/10",
};

const BAR_COLORS = [
  "#f59e0b", "#34d399", "#60a5fa", "#f87171", "#a78bfa",
  "#fb923c", "#2dd4bf", "#e879f9",
];

const PAGE_SIZE = 50;

// ── Track row ─────────────────────────────────────────────────────────────────

function TrackRow({ track, index, onPlay }: { track: Track; index: number; onPlay: () => void }) {
  const { track: currentTrack, isPlaying } = usePlayerStore();
  const isActive = currentTrack?.id === track.id;

  const mins = track.duration_seconds ? Math.floor(track.duration_seconds / 60) : null;
  const secs = track.duration_seconds ? Math.floor(track.duration_seconds % 60) : null;
  const dur = mins !== null ? `${mins}:${String(secs).padStart(2, "0")}` : "—";

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 rounded-md cursor-pointer group transition-colors ${isActive ? "bg-violet-500/10" : "hover:bg-stone-800/20"}`}
      onClick={onPlay}
    >
      <span className="w-6 text-right text-xs font-mono flex-shrink-0 group-hover:hidden">
        {isActive && isPlaying
          ? <Play className="w-3 h-3 text-violet-400 ml-auto" />
          : <span className="text-stone-700">{index + 1}</span>}
      </span>
      <div className="w-6 hidden group-hover:flex items-center justify-center flex-shrink-0 text-stone-400">
        {isActive && isPlaying
          ? <Pause className="w-3.5 h-3.5 text-violet-400" />
          : <Play className="w-3.5 h-3.5" />}
      </div>
      <div className={`w-7 h-7 rounded flex items-center justify-center flex-shrink-0 ${isActive ? "bg-violet-500/20" : "bg-stone-800/60"}`}>
        <Music2 className={`w-3.5 h-3.5 ${isActive ? "text-violet-400" : "text-stone-600"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-body truncate ${isActive ? "text-violet-300" : "text-stone-200"}`}>{track.title || "Untitled"}</p>
        {track.album && <p className="text-xs font-mono text-stone-600 truncate">{track.album}</p>}
      </div>
      <div className="hidden md:flex items-center gap-4 text-xs font-mono text-stone-600 flex-shrink-0">
        {track.genre && <span className="w-20 truncate">{track.genre}</span>}
        <span className="w-10">{track.year ?? "—"}</span>
        <span className="w-14 flex items-center gap-1">
          <Play className="w-2.5 h-2.5" />{formatCount(track.stream_count)}
        </span>
      </div>
      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0 ${TRACK_STATUS_COLORS[track.status] ?? "text-stone-500"}`}>
        {track.status}
      </span>
      <span className="w-12 text-right text-xs font-mono text-stone-600 flex-shrink-0">{dur}</span>
    </div>
  );
}

// ── Edit panel ────────────────────────────────────────────────────────────────

function EditPanel({ artistId, initialValues, onDone }: {
  artistId: string;
  initialValues: { display_name: string; bio: string | null; country: string | null; genres: string[] };
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(initialValues.display_name);
  const [bio, setBio] = useState(initialValues.bio ?? "");
  const [country, setCountry] = useState(initialValues.country ?? "");
  const [genres, setGenres] = useState(initialValues.genres.join(", "));
  const avatarRef = useRef<HTMLInputElement>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);

  const updateMutation = useMutation({
    mutationFn: async () => {
      const genreList = genres.split(",").map((g) => g.trim()).filter(Boolean);
      await artistsApi.update(artistId, {
        display_name: name.trim() || undefined,
        bio: bio.trim() || undefined,
        country: country.trim() || undefined,
        genres: genreList,
      });
      if (avatarFile) {
        await artistsApi.uploadAvatar(artistId, avatarFile);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["artist", artistId] });
      onDone();
    },
  });

  function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  }

  const fieldClass = "w-full h-9 px-3 rounded-md text-sm bg-stone-900 border border-stone-800 text-stone-200 outline-none focus:border-violet-500/60 transition-colors font-body";
  const labelClass = "block text-[10px] font-mono text-stone-600 uppercase tracking-wider mb-1";

  return (
    <Card className="p-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Avatar */}
        <div className="md:col-span-2 flex items-center gap-4">
          <div
            className="relative w-16 h-16 rounded-full bg-stone-800 border border-stone-700 overflow-hidden cursor-pointer group flex-shrink-0"
            onClick={() => avatarRef.current?.click()}
          >
            {avatarPreview ? (
              <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Users className="w-7 h-7 text-stone-600" />
              </div>
            )}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <Upload className="w-4 h-4 text-white" />
            </div>
          </div>
          <div>
            <p className="text-xs font-body text-stone-400">Artist photo</p>
            <p className="text-[10px] font-mono text-stone-600 mt-0.5">Click to change · JPEG/PNG/WebP · max 10 MB</p>
            {avatarFile && <p className="text-[10px] font-mono text-violet-400 mt-0.5">{avatarFile.name}</p>}
          </div>
          <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarPick} />
        </div>

        {/* Name */}
        <div>
          <label className={labelClass}>Name</label>
          <input className={fieldClass} value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        {/* Country */}
        <div>
          <label className={labelClass}>Country</label>
          <input className={fieldClass} value={country} onChange={(e) => setCountry(e.target.value)} placeholder="e.g. Kenya" />
        </div>

        {/* Genres */}
        <div className="md:col-span-2">
          <label className={labelClass}>Genres <span className="normal-case text-stone-700">(comma-separated)</span></label>
          <input className={fieldClass} value={genres} onChange={(e) => setGenres(e.target.value)} placeholder="e.g. Rumba, Soukous, Benga" />
        </div>

        {/* Bio */}
        <div className="md:col-span-2">
          <label className={labelClass}>Bio</label>
          <textarea
            className={`${fieldClass} h-24 py-2 resize-none`}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Short biography…"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 mt-4 pt-4 border-t border-stone-800/60">
        <Button
          size="sm"
          onClick={() => updateMutation.mutate()}
          disabled={updateMutation.isPending}
          className="h-8"
        >
          {updateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}
          Save changes
        </Button>
        <Button variant="ghost" size="sm" className="h-8" onClick={onDone} disabled={updateMutation.isPending}>
          <X className="w-3.5 h-3.5 mr-1.5" />Cancel
        </Button>
        {updateMutation.isError && (
          <p className="text-xs text-red-400 font-mono ml-2">Save failed — try again</p>
        )}
      </div>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ArtistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isSimple = theme === "simple";
  const [skip, setSkip] = useState(0);
  const [editing, setEditing] = useState(false);

  const chartColors = {
    tick:         isSimple ? "#78716c" : "#57534e",
    tooltipBg:    isSimple ? "#ffffff" : "#1c1917",
    tooltipBorder:isSimple ? "#d6d3d1" : "#292524",
    tooltipText:  isSimple ? "#1c1917" : "#d6d3d1",
  };

  const { data: artist, isLoading: artistLoading } = useQuery({
    queryKey: ["artist", id],
    queryFn: () => artistsApi.get(id!),
    enabled: !!id,
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ["artist-analytics", id],
    queryFn: () => analyticsApi.artist(id!),
    enabled: !!id,
  });

  const { data: tracksData, isLoading: tracksLoading } = useQuery({
    queryKey: ["artist-tracks", id, skip],
    queryFn: () => artistsApi.tracks(id!, { skip, limit: PAGE_SIZE }),
    enabled: !!id,
  });

  const tracks = tracksData?.items ?? [];
  const total = tracksData?.total ?? 0;

  return (
    <div className="space-y-5 animate-fadeIn pb-6">
      {/* Back */}
      <Button
        variant="ghost" size="sm"
        className="h-8 text-stone-500 hover:text-stone-200 -ml-1"
        onClick={() => navigate("/admin/artists")}
      >
        <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />All Artists
      </Button>

      {/* ── Artist header ──────────────────────────────────────────────────── */}
      {artistLoading ? (
        <div className="flex items-center gap-5">
          <Skeleton className="w-20 h-20 rounded-full flex-shrink-0" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-7 w-52" />
            <Skeleton className="h-4 w-36" />
          </div>
        </div>
      ) : artist ? (
        <div className="flex items-start gap-5">
          <div className="w-20 h-20 rounded-full bg-stone-800 flex-shrink-0 flex items-center justify-center overflow-hidden border border-stone-700">
            {artist.image_url
              ? <img src={artist.image_url} alt="" className="w-full h-full object-cover" />
              : <Users className="w-9 h-9 text-stone-600" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-3 flex-wrap">
              <h1 className="font-display text-2xl font-bold text-stone-100 leading-tight">
                {artist.display_name}
              </h1>
              <Button
                variant="ghost" size="sm"
                className="h-7 mt-0.5 text-stone-500 hover:text-stone-200"
                onClick={() => setEditing((v) => !v)}
              >
                <Pencil className="w-3.5 h-3.5 mr-1.5" />{editing ? "Cancel edit" : "Edit"}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <span className="flex items-center gap-1 text-xs font-mono text-stone-500">
                <Music2 className="w-3 h-3" />{formatCount(total)} tracks
              </span>
              {artist.country && (
                <span className="flex items-center gap-1 text-xs font-mono text-stone-500">
                  <Globe2 className="w-3 h-3" />{artist.country}
                </span>
              )}
              {artist.genres?.length > 0 && artist.genres.map((g) => (
                <span key={g} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-800 text-stone-500">{g}</span>
              ))}
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                artist.status === "approved" ? "text-emerald-400 bg-emerald-500/10" :
                artist.status === "rejected" ? "text-red-400 bg-red-500/10" :
                "text-stone-500 bg-stone-800/60"
              }`}>{artist.status}</span>
            </div>
            {artist.bio && !editing && (
              <p className="mt-2 text-sm font-body text-stone-500 line-clamp-2">{artist.bio}</p>
            )}
          </div>
        </div>
      ) : null}

      {/* Edit panel */}
      {editing && artist && (
        <EditPanel
          artistId={id!}
          initialValues={{
            display_name: artist.display_name,
            bio: artist.bio,
            country: artist.country,
            genres: artist.genres,
          }}
          onDone={() => setEditing(false)}
        />
      )}

      {/* ── Metrics ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {analyticsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-3 w-24 mb-3" />
              <Skeleton className="h-7 w-16" />
            </Card>
          ))
        ) : ([
          { label: "Monthly Listeners", value: formatCount(analytics?.monthly_listeners ?? 0), icon: Headphones, color: "text-blue-400" },
          { label: "Total Streams",      value: formatCount(analytics?.total_streams ?? 0),     icon: Play,      color: "text-violet-400" },
          { label: "Total Likes",        value: formatCount(analytics?.total_likes ?? 0),        icon: Heart,     color: "text-red-400"   },
          { label: "Tracks",             value: formatCount(total),                              icon: Music2,    color: "text-emerald-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`w-3.5 h-3.5 ${color}`} />
              <p className="text-xs font-mono text-stone-500">{label}</p>
            </div>
            <p className={`text-2xl font-display font-bold ${color}`}>{value}</p>
          </Card>
        )))}
      </div>

      {/* ── Top tracks + Geography ─────────────────────────────────────────── */}
      {!analyticsLoading && analytics && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Top tracks bar chart */}
          {analytics.top_tracks.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="w-3.5 h-3.5 text-stone-600" />Top Tracks by Streams
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={analytics.top_tracks.slice(0, 8)}
                    layout="vertical"
                    barSize={14}
                    margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
                  >
                    <XAxis
                      type="number"
                      axisLine={false} tickLine={false}
                      tick={{ fill: chartColors.tick, fontSize: 10, fontFamily: "JetBrains Mono" }}
                      allowDecimals={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="title"
                      width={100}
                      axisLine={false} tickLine={false}
                      tick={{ fill: chartColors.tick, fontSize: 11, fontFamily: "DM Sans" }}
                      tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 14) + "…" : v}
                    />
                    <Tooltip
                      contentStyle={{
                        background: chartColors.tooltipBg,
                        border: `1px solid ${chartColors.tooltipBorder}`,
                        borderRadius: 6, fontSize: 12, color: chartColors.tooltipText,
                      }}
                      formatter={(v: number) => [formatCount(v), "Streams"]}
                    />
                    <Bar dataKey="stream_count" radius={[0, 4, 4, 0]}>
                      {analytics.top_tracks.slice(0, 8).map((_, i) => (
                        <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Listener geography */}
          {analytics.listener_geography.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Globe2 className="w-3.5 h-3.5 text-stone-600" />Listener Geography
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {analytics.listener_geography.slice(0, 8).map((geo, i) => {
                    const pct = analytics.listener_geography[0].count > 0
                      ? Math.round((geo.count / analytics.listener_geography[0].count) * 100)
                      : 0;
                    return (
                      <div key={geo.country} className="flex items-center gap-3">
                        <span className="text-xs font-mono text-stone-500 w-4 flex-shrink-0">{i + 1}</span>
                        <span className="text-sm font-body text-stone-300 w-24 truncate">{geo.country}</span>
                        <div className="flex-1 bg-stone-800/60 rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full bg-violet-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono text-stone-600 w-10 text-right flex-shrink-0">
                          {formatCount(geo.count)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ) : analytics.top_tracks.length === 0 ? (
            <Card className="flex items-center justify-center py-12">
              <p className="text-xs font-mono text-stone-700">No stream data yet</p>
            </Card>
          ) : null}
        </div>
      )}

      {/* ── Discography ───────────────────────────────────────────────────── */}
      <Card>
        <div className="px-4 py-3 border-b border-stone-800/60 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-display font-semibold text-stone-300 flex-shrink-0">
              Discography
              {total > 0 && (
                <span className="ml-2 text-xs font-mono text-stone-600">{formatCount(total)} tracks</span>
              )}
            </h2>
            {tracks.length > 0 && (
              <button
                onClick={() => usePlayerStore.getState().setQueue(tracks, 0)}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-500 hover:bg-violet-400 text-stone-950 text-xs font-mono font-semibold transition-colors flex-shrink-0"
              >
                <Play className="w-3 h-3" />Play All
              </button>
            )}
          </div>
          {total > PAGE_SIZE && (
            <p className="text-xs font-mono text-stone-600 flex-shrink-0">
              {skip + 1}–{Math.min(skip + PAGE_SIZE, total)} of {formatCount(total)}
            </p>
          )}
        </div>

        <div className="py-2">
          {/* Column headers */}
          <div className="flex items-center gap-3 px-4 py-1 mb-1">
            <span className="w-6" /><span className="w-7" />
            <span className="flex-1 text-[10px] font-mono text-stone-700 uppercase tracking-wider">Title</span>
            <span className="hidden md:flex items-center gap-4 text-[10px] font-mono text-stone-700 uppercase tracking-wider flex-shrink-0">
              <span className="w-20">Genre</span>
              <span className="w-10">Year</span>
              <span className="w-14">Streams</span>
            </span>
            <span className="w-14 text-[10px] font-mono text-stone-700 uppercase tracking-wider flex-shrink-0">Status</span>
            <span className="w-12 text-right flex-shrink-0">
              <Clock className="w-3 h-3 text-stone-700 inline" />
            </span>
          </div>

          {tracksLoading ? (
            <div className="space-y-1 px-2">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : tracks.length === 0 ? (
            <div className="py-12 text-center text-stone-600 text-sm font-body">No tracks found</div>
          ) : (
            tracks.map((track, i) => (
              <TrackRow
                key={track.id}
                track={track}
                index={skip + i}
                onPlay={() => usePlayerStore.getState().setQueue(tracks, i)}
              />
            ))
          )}
        </div>

        {!tracksLoading && total > PAGE_SIZE && (
          <div className="px-4 py-3 border-t border-stone-800/60 flex items-center justify-between">
            <p className="text-xs font-mono text-stone-600">
              {skip + 1}–{Math.min(skip + PAGE_SIZE, total)} of {formatCount(total)}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7"
                onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))} disabled={skip === 0}>
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button variant="outline" size="sm" className="h-7"
                onClick={() => setSkip(skip + PAGE_SIZE)} disabled={skip + PAGE_SIZE >= total}>
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
