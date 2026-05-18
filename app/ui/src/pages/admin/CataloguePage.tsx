import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search, Filter, RefreshCw, AlertTriangle, User,
  ChevronLeft, ChevronRight, Info, Play, Pause, Loader2, Music2, Plus, Disc3, FileSpreadsheet,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { TrackDetailSheet } from "@/components/tracks/TrackDetailSheet";
import { TrackCreateSheet } from "@/components/tracks/TrackCreateSheet";
import { BulkMetadataModal } from "@/components/tracks/BulkMetadataModal";
import { tracksApi } from "@/api/tracks";
import { usePlayerStore, _audio } from "@/store/player";
import { formatCount } from "@/utils/format";
import type { Track, WorkflowTag } from "@/types";

const STATUS_OPTIONS = ["all", "pending", "processing", "ready", "failed", "deleted"];
const TAG_OPTIONS: Array<{ value: WorkflowTag; label: string }> = [
  { value: "tamasha_owned",        label: "Tamasha Owned" },
  { value: "signed_artist",        label: "Signed Artist" },
  { value: "orchard_source",       label: "Orchard Source" },
  { value: "wav_source",           label: "WAV Source" },
  { value: "duplicate_review",     label: "Duplicate Review" },
  { value: "missing_metadata",     label: "Missing Metadata" },
  { value: "metadata_review",      label: "Metadata Review" },
  { value: "needs_compression",    label: "Needs Compression" },
  { value: "already_in_database",  label: "Already In DB" },
  { value: "catalogue_number_only", label: "Catalogue # Only" },
];

const STATUS_COLORS: Record<string, string> = {
  pending:    "text-stone-400 bg-stone-800",
  processing: "text-violet-400 bg-violet-500/15",
  ready:      "text-emerald-400 bg-emerald-500/15",
  failed:     "text-red-400 bg-red-500/15",
  deleted:    "text-stone-600 bg-stone-900",
};

const PAGE_SIZE = 50;

export function CataloguePage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [tag, setTag] = useState("all");
  const [noArtist, setNoArtist] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [skip, setSkip] = useState(0);
  const [selected, setSelected] = useState<Track | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [view, setView] = useState<"tracks" | "albums">("tracks");

  // Global player state — no local audio state
  const {
    track: activeTrack,
    isPlaying,
    isLoadingUrl,
    setTrack,
  } = usePlayerStore();

  const handlePlayClick = (e: React.MouseEvent, track: Track) => {
    e.stopPropagation();
    if (activeTrack?.id === track.id) {
      // Toggle via the singleton audio element
      if (_audio.paused) {
        _audio.play().catch(() => {});
      } else {
        _audio.pause();
      }
    } else {
      setTrack(track);
    }
  };

  // Filters
  const handleSearch = (v: string) => {
    setSearch(v);
    setSkip(0);
    clearTimeout((window as unknown as Record<string, ReturnType<typeof setTimeout>>).__csearch);
    (window as unknown as Record<string, ReturnType<typeof setTimeout>>).__csearch = setTimeout(
      () => setDebouncedSearch(v),
      300
    );
  };

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["catalogue", { debouncedSearch, status, tag, noArtist, needsReview, skip }],
    queryFn: () =>
      tracksApi.list({
        search: debouncedSearch || undefined,
        status: (status !== "all" ? status : undefined) as never,
        workflow_tag: tag !== "all" ? tag : undefined,
        no_artist: noArtist || undefined,
        needs_review: needsReview || undefined,
        skip,
        limit: PAGE_SIZE,
      }),
  });

  const tracks = data?.items ?? [];
  const total = data?.total ?? 0;

  // Albums view — fetch all tracks with an album, group client-side
  const { data: albumsData, isLoading: albumsLoading } = useQuery({
    queryKey: ["catalogue-albums"],
    queryFn: () => tracksApi.list({ limit: 500, skip: 0 }),
    enabled: view === "albums",
  });

  const albumGroups = useMemo(() => {
    if (!albumsData) return [];
    const map = new Map<string, { name: string; tracks: Track[]; artist: string | null; year: number | null; artwork: string | null }>();
    for (const t of albumsData.items) {
      const key = t.album ?? "__none__";
      if (!map.has(key)) map.set(key, { name: t.album ?? "Unknown Album", tracks: [], artist: t.artist_name ?? t.artist_name_raw ?? null, year: t.year ?? null, artwork: t.artwork_url ?? null });
      map.get(key)!.tracks.push(t);
      if (!map.get(key)!.artwork && t.artwork_url) map.get(key)!.artwork = t.artwork_url;
    }
    return [...map.entries()]
      .filter(([k]) => k !== "__none__")
      .map(([, v]) => v)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [albumsData]);

  const resetFilters = () => {
    setSearch(""); setDebouncedSearch(""); setStatus("all");
    setTag("all"); setNoArtist(false); setNeedsReview(false); setSkip(0);
  };

  const hasFilters = search || status !== "all" || tag !== "all" || noArtist || needsReview;

  return (
    <div className="space-y-5 animate-fadeIn pb-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-stone-100">Catalogue</h1>
          <p className="mt-1 text-sm font-body text-stone-500">
            {total > 0 ? <>{formatCount(total)} tracks</> : "Browse all tracks"}
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            size="sm"
            onClick={() => setShowCreate(true)}
            className="h-8 text-xs bg-violet-600 hover:bg-violet-500 text-white border-0 gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> Add Track
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowBulk(true)}
            className="h-8 text-xs gap-1.5"
            title="Bulk metadata update via CSV"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> Bulk Update
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-600" />
          <Input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search title, album, genre…"
            className="pl-9 h-8 text-xs"
          />
        </div>

        <Select value={status} onValueChange={(v) => { setStatus(v); setSkip(0); }}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{s === "all" ? "All statuses" : s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={tag} onValueChange={(v) => { setTag(v); setSkip(0); }}>
          <SelectTrigger className="w-44 h-8 text-xs"><SelectValue placeholder="Tag" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tags</SelectItem>
            {TAG_OPTIONS.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          onClick={() => { setNoArtist(!noArtist); setSkip(0); }}
          className={`flex items-center gap-1.5 px-3 h-8 rounded-md border text-xs font-mono transition-colors ${
            noArtist
              ? "border-violet-500/40 bg-violet-500/10 text-violet-400"
              : "border-stone-700 text-stone-500 hover:text-stone-300"
          }`}
        >
          <User className="w-3 h-3" /> No Artist
        </button>

        <button
          onClick={() => { setNeedsReview(!needsReview); setSkip(0); }}
          className={`flex items-center gap-1.5 px-3 h-8 rounded-md border text-xs font-mono transition-colors ${
            needsReview
              ? "border-violet-500/40 bg-violet-500/10 text-violet-400"
              : "border-stone-700 text-stone-500 hover:text-stone-300"
          }`}
        >
          <AlertTriangle className="w-3 h-3" /> Needs Review
        </button>

        {hasFilters && (
          <button
            onClick={resetFilters}
            className="text-xs font-mono text-stone-600 hover:text-stone-400 px-2 h-8"
          >
            Clear
          </button>
        )}
      </div>

      {/* View tabs */}
      <div className="flex gap-0 border-b border-stone-800">
        {(["tracks", "albums"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-mono border-b-2 transition-colors capitalize ${
              view === v
                ? "border-violet-500 text-violet-400"
                : "border-transparent text-stone-500 hover:text-stone-300"
            }`}
          >
            {v === "tracks" ? <Music2 className="w-3.5 h-3.5" /> : <Disc3 className="w-3.5 h-3.5" />}
            {v === "tracks" ? `Tracks${total > 0 ? ` (${total})` : ""}` : `Albums${albumGroups.length > 0 ? ` (${albumGroups.length})` : ""}`}
          </button>
        ))}
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          {view === "tracks" ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/40">
                  <th className="w-10 px-3 py-3" />
                  {["Title", "Artist", "Album", "Genre", "Year", "Status", "Tags", ""].map((h) => (
                    <th
                      key={h}
                      className="text-left px-4 py-3 text-xs font-mono font-semibold text-stone-600 uppercase tracking-wider whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800/40">
                {isLoading
                  ? Array.from({ length: 12 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 9 }).map((_, j) => (
                          <td key={j} className="px-4 py-3">
                            <Skeleton className="h-3.5 w-full" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : tracks.map((track) => {
                      const isActive = activeTrack?.id === track.id;
                      return (
                        <tr
                          key={track.id}
                          className={`transition-colors cursor-pointer group ${
                            isActive
                              ? "bg-violet-500/5 border-l-2 border-l-violet-500/40"
                              : "hover:bg-stone-800/20"
                          }`}
                          onClick={() => setSelected(track)}
                        >
                          <td className="pl-3 pr-1 py-3 w-10">
                            <button
                              onClick={(e) => handlePlayClick(e, track)}
                              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                                isActive
                                  ? "bg-violet-500 text-stone-950 hover:bg-violet-400"
                                  : "bg-stone-800 text-stone-500 hover:bg-stone-700 hover:text-stone-300 opacity-0 group-hover:opacity-100"
                              }`}
                            >
                              {isActive && isLoadingUrl ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : isActive && isPlaying ? (
                                <Pause className="w-3 h-3" />
                              ) : (
                                <Play className="w-3 h-3 ml-0.5" />
                              )}
                            </button>
                          </td>
                          <td className="px-4 py-3 max-w-[220px]">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded flex-shrink-0 overflow-hidden bg-stone-800 flex items-center justify-center">
                                {isActive && isPlaying ? (
                                  <div className="flex gap-px items-end h-4">
                                    {[1, 2, 3].map((b) => (
                                      <div key={b} className="w-1 bg-violet-400 rounded-sm animate-pulse" style={{ height: `${5 + b * 3}px`, animationDelay: `${b * 0.12}s` }} />
                                    ))}
                                  </div>
                                ) : track.artwork_url ? (
                                  <img src={track.artwork_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <Music2 className="w-3.5 h-3.5 text-stone-700" />
                                )}
                              </div>
                              <span className={`font-body truncate ${isActive ? "text-violet-200" : "text-stone-200"}`}>
                                {track.title || <span className="text-stone-600 italic">Untitled</span>}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 max-w-[150px]">
                            {track.artist_name || track.artist_name_raw
                              ? <span className="text-xs text-stone-300 truncate block">{track.artist_name || track.artist_name_raw}</span>
                              : <span className="text-xs font-mono text-stone-700 italic">—</span>}
                          </td>
                          <td className="px-4 py-3 max-w-[150px]">
                            <span className="text-xs text-stone-500 truncate block">{track.album ?? "—"}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-stone-500">{track.genre ?? "—"}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs font-mono text-stone-600">{track.year ?? "—"}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-mono px-2 py-0.5 rounded ${STATUS_COLORS[track.status] ?? "text-stone-500"}`}>
                              {track.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 max-w-[200px]">
                            <div className="flex flex-wrap gap-1">
                              {track.workflow_tags?.slice(0, 3).map((t) => (
                                <span key={t} className="text-xs font-mono px-1.5 py-0.5 rounded bg-stone-800 text-stone-500 whitespace-nowrap">
                                  {t.replace(/_/g, " ")}
                                </span>
                              ))}
                              {(track.workflow_tags?.length ?? 0) > 3 && (
                                <span className="text-xs font-mono text-stone-700">+{track.workflow_tags.length - 3}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <Info className="w-3.5 h-3.5 text-stone-700 group-hover:text-violet-500 transition-colors" />
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          ) : (
            /* ── Albums view ────────────────────────────────────── */
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/40">
                  <th className="w-12 px-3 py-3" />
                  {["Album", "Artist", "Year", "Genre", "Tracks", ""].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-mono font-semibold text-stone-600 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-800/40">
                {albumsLoading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 6 }).map((_, j) => (
                          <td key={j} className="px-4 py-3"><Skeleton className="h-3.5 w-full" /></td>
                        ))}
                      </tr>
                    ))
                  : albumGroups.map((album) => (
                      <tr
                        key={album.name}
                        className="transition-colors cursor-pointer group hover:bg-stone-800/20"
                        onClick={() => { setView("tracks"); setSearch(album.name); setDebouncedSearch(album.name); setSkip(0); }}
                      >
                        <td className="pl-3 pr-1 py-2 w-12">
                          <div className="w-9 h-9 rounded-md overflow-hidden bg-stone-800 flex items-center justify-center flex-shrink-0">
                            {album.artwork
                              ? <img src={album.artwork} alt="" className="w-full h-full object-cover" />
                              : <Disc3 className="w-4 h-4 text-stone-700" />}
                          </div>
                        </td>
                        <td className="px-4 py-2 max-w-[220px]">
                          <span className="font-body text-stone-200 truncate block">{album.name}</span>
                        </td>
                        <td className="px-4 py-2 max-w-[150px]">
                          <span className="text-xs text-stone-400 truncate block">{album.artist ?? <span className="text-stone-700 italic">—</span>}</span>
                        </td>
                        <td className="px-4 py-2">
                          <span className="text-xs font-mono text-stone-600">{album.year ?? "—"}</span>
                        </td>
                        <td className="px-4 py-2">
                          <span className="text-xs text-stone-500">{album.tracks[0]?.genre ?? "—"}</span>
                        </td>
                        <td className="px-4 py-2">
                          <span className="text-xs font-mono px-2 py-0.5 rounded bg-stone-800/60 text-stone-500">
                            {album.tracks.length} track{album.tracks.length !== 1 ? "s" : ""}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          <Info className="w-3.5 h-3.5 text-stone-700 group-hover:text-violet-500 transition-colors" />
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          )}
          {!isLoading && view === "tracks" && tracks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-stone-700">
              <Filter className="w-8 h-8 mb-3 opacity-30" />
              <p className="text-sm font-body">No tracks match the current filters</p>
            </div>
          )}
          {!albumsLoading && view === "albums" && albumGroups.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-stone-700">
              <Disc3 className="w-8 h-8 mb-3 opacity-30" />
              <p className="text-sm font-body">No albums found — tracks need an album name set</p>
            </div>
          )}
        </div>
      </Card>

      {/* Pagination — tracks view only */}
      {view === "tracks" && !isLoading && total > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-xs font-mono text-stone-600">
            {skip + 1}–{Math.min(skip + PAGE_SIZE, total)} of {formatCount(total)}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}
              disabled={skip === 0}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => setSkip(skip + PAGE_SIZE)}
              disabled={skip + PAGE_SIZE >= total}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {selected && (
        <TrackDetailSheet
          track={selected}
          onClose={() => setSelected(null)}
          onUpdated={(updated) => { setSelected(updated); refetch(); }}
          onDeleted={() => { setSelected(null); refetch(); }}
        />
      )}

      {showCreate && (
        <TrackCreateSheet
          onClose={() => setShowCreate(false)}
          onCreated={() => refetch()}
        />
      )}

      <BulkMetadataModal
        open={showBulk}
        onClose={() => setShowBulk(false)}
        onImported={() => refetch()}
      />
    </div>
  );
}
