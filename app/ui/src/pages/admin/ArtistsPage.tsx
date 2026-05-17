import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Search, RefreshCw, Users, ChevronLeft, ChevronRight, Music2,
  Plus, X, Loader2, Mic2, Pencil, Trash2, Check, ChevronDown,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { artistsApi } from "@/api/artists";
import { toast } from "@/hooks/useToast";
import { formatCount } from "@/utils/format";
import type { Artist, CreateArtistRequest, UpdateArtistRequest } from "@/types";

const PAGE_SIZE = 24;

const STATUS_COLORS: Record<string, string> = {
  pending:  "text-violet-400 bg-violet-500/15",
  approved: "text-emerald-400 bg-emerald-500/15",
  rejected: "text-red-400 bg-red-500/15",
};

const COUNTRIES = [
  "Kenya", "Nigeria", "South Africa", "Ghana", "Tanzania", "Uganda", "Ethiopia",
  "Rwanda", "Senegal", "Cameroon", "Zimbabwe", "Zambia", "Egypt", "Other",
];

const GENRES = [
  "Afrobeats", "Benga", "Bongo Flava", "Afro-fusion", "Gospel",
  "Hip-Hop", "R&B", "Reggae", "Dancehall", "Jazz", "Blues",
  "Classical", "Folk", "Electronic", "Other",
];

// ── Artist Sheet (Create / Edit) ──────────────────────────────────────────────

interface ArtistSheetProps {
  artist?: Artist;
  onClose: () => void;
  onSaved: (a: Artist) => void;
}

function ArtistSheet({ artist, onClose, onSaved }: ArtistSheetProps) {
  const qc = useQueryClient();
  const isEdit = !!artist;

  const [isBand, setIsBand] = useState(artist?.is_band ?? false);
  const [name, setName] = useState(artist?.display_name ?? "");
  const [bio, setBio] = useState(artist?.bio ?? "");
  const [country, setCountry] = useState(artist?.country ?? "");
  const [genreInput, setGenreInput] = useState("");
  const [genres, setGenres] = useState<string[]>(artist?.genres ?? []);
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">(artist?.status ?? "pending");

  const addGenre = (g: string) => {
    const trimmed = g.trim();
    if (trimmed && !genres.includes(trimmed)) setGenres((prev) => [...prev, trimmed]);
    setGenreInput("");
  };
  const removeGenre = (g: string) => setGenres((prev) => prev.filter((x) => x !== g));

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        display_name: name.trim(),
        bio: bio.trim() || null,
        country: country || null,
        genres,
        is_band: isBand,
      };
      if (isEdit) {
        return artistsApi.update(artist.id, { ...payload, status } as UpdateArtistRequest);
      }
      return artistsApi.create(payload as CreateArtistRequest);
    },
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["artists"] });
      toast({ title: isEdit ? "Artist updated" : "Artist created", variant: "success" });
      onSaved(saved);
      onClose();
    },
    onError: (e: any) => toast({ title: e?.response?.data?.detail ?? "Save failed", variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md h-full bg-stone-950 border-l border-stone-800 flex flex-col animate-slideInRight overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-violet-500/15 flex items-center justify-center">
              {isBand ? <Users className="w-3.5 h-3.5 text-violet-400" /> : <Mic2 className="w-3.5 h-3.5 text-violet-400" />}
            </div>
            <h2 className="font-display font-bold text-stone-100 text-sm">
              {isEdit ? "Edit Artist" : "Add Artist"}
            </h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-5">

          {/* Solo / Band toggle */}
          <div>
            <label className="block text-xs font-mono text-stone-400 mb-2">Artist type</label>
            <div className="flex rounded-lg border border-stone-800 overflow-hidden">
              <button
                type="button"
                onClick={() => setIsBand(false)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-mono transition-colors ${
                  !isBand ? "bg-violet-600 text-white" : "text-stone-500 hover:text-stone-300 hover:bg-stone-800/40"
                }`}
              >
                <Mic2 className="w-3.5 h-3.5" /> Solo Artist
              </button>
              <button
                type="button"
                onClick={() => setIsBand(true)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-mono transition-colors ${
                  isBand ? "bg-violet-600 text-white" : "text-stone-500 hover:text-stone-300 hover:bg-stone-800/40"
                }`}
              >
                <Users className="w-3.5 h-3.5" /> Band / Group
              </button>
            </div>
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <label className="block text-xs font-mono text-stone-400">
              {isBand ? "Band name" : "Artist name"} <span className="text-red-500">*</span>
            </label>
            <Input
              placeholder={isBand ? "e.g. Sauti Sol" : "e.g. Diamond Platnumz"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-9 text-sm"
              autoFocus
            />
          </div>

          {/* Bio */}
          <div className="space-y-1.5">
            <label className="block text-xs font-mono text-stone-400">Bio</label>
            <textarea
              placeholder={`Short description of ${isBand ? "the band" : "the artist"}…`}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              className="w-full bg-transparent border border-stone-800 rounded-md px-3 py-2 text-sm font-body text-stone-200 outline-none focus:border-violet-500 transition-colors resize-none"
            />
          </div>

          {/* Country */}
          <div className="space-y-1.5">
            <label className="block text-xs font-mono text-stone-400">Country</label>
            <Select value={country || "__none"} onValueChange={(v) => setCountry(v === "__none" ? "" : v)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select country…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">—</SelectItem>
                {COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Genres */}
          <div className="space-y-1.5">
            <label className="block text-xs font-mono text-stone-400">Genres</label>
            <div className="flex gap-2">
              <Select value="" onValueChange={(v) => { if (v) addGenre(v); }}>
                <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Add genre…" /></SelectTrigger>
                <SelectContent>
                  {GENRES.filter((g) => !genres.includes(g)).map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="flex gap-1">
                <Input
                  placeholder="Custom…"
                  value={genreInput}
                  onChange={(e) => setGenreInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addGenre(genreInput); } }}
                  className="h-8 text-xs w-28"
                />
              </div>
            </div>
            {genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {genres.map((g) => (
                  <span key={g} className="flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-stone-800 text-stone-400">
                    {g}
                    <button type="button" onClick={() => removeGenre(g)} className="text-stone-600 hover:text-stone-300">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Status (edit only) */}
          {isEdit && (
            <div className="space-y-1.5">
              <label className="block text-xs font-mono text-stone-400">Status</label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-stone-800 flex justify-end gap-2 flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 text-xs">Cancel</Button>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !name.trim()}
            className="h-8 text-xs bg-violet-600 hover:bg-violet-500 text-white border-0 gap-1.5"
          >
            {saveMutation.isPending
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
              : <><Check className="w-3.5 h-3.5" /> {isEdit ? "Save changes" : "Create artist"}</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Artist Card ───────────────────────────────────────────────────────────────

function ArtistCard({
  artist, onEdit, onDeleted,
}: { artist: Artist; onEdit: (a: Artist) => void; onDeleted: (id: string) => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => artistsApi.delete(artist.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["artists"] });
      toast({ title: "Artist deleted", variant: "success" });
      onDeleted(artist.id);
    },
    onError: (e: any) => toast({ title: e?.response?.data?.detail ?? "Delete failed", variant: "destructive" }),
  });

  const approveMutation = useMutation({
    mutationFn: () => artistsApi.approve(artist.id),
    onSuccess: (updated) => {
      qc.setQueryData<{ items: Artist[]; total: number }>(["artists"], (old) =>
        old ? { ...old, items: old.items.map((a) => (a.id === updated.id ? updated : a)) } : old
      );
    },
  });

  return (
    <Card className="p-4 flex flex-col gap-3 transition-all hover:border-stone-700 hover:bg-stone-900/80 group relative">
      {/* Action buttons */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(artist); }}
          className="w-6 h-6 rounded bg-stone-800 hover:bg-stone-700 flex items-center justify-center text-stone-500 hover:text-stone-200 transition-colors"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
          className="w-6 h-6 rounded bg-stone-800 hover:bg-red-500/20 flex items-center justify-center text-stone-500 hover:text-red-400 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      <div
        className="flex items-center gap-3 cursor-pointer"
        onClick={() => navigate(`/admin/artists/${artist.id}`)}
      >
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full overflow-hidden bg-stone-800 flex-shrink-0 flex items-center justify-center relative">
          {artist.image_url ? (
            <img src={artist.image_url} alt="" className="w-full h-full object-cover" />
          ) : artist.is_band ? (
            <Users className="w-5 h-5 text-stone-600" />
          ) : (
            <Mic2 className="w-5 h-5 text-stone-600" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className="text-sm font-body font-medium text-stone-200 truncate group-hover:text-stone-100">
              {artist.display_name}
            </p>
            {artist.is_band && (
              <span className="flex-shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/20">
                Band
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="flex items-center gap-0.5 text-[10px] font-mono text-stone-600">
              <Music2 className="w-2.5 h-2.5" />{formatCount(artist.track_count)}
            </span>
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${STATUS_COLORS[artist.status] ?? "text-stone-500 bg-stone-800"}`}>
              {artist.status}
            </span>
            {artist.country && (
              <span className="text-[10px] font-mono text-stone-600">{artist.country}</span>
            )}
          </div>
        </div>
      </div>

      {artist.genres && artist.genres.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {artist.genres.slice(0, 3).map((g) => (
            <span key={g} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-stone-800 text-stone-500">{g}</span>
          ))}
          {artist.genres.length > 3 && <span className="text-[10px] font-mono text-stone-700">+{artist.genres.length - 3}</span>}
        </div>
      )}

      {/* Quick approve for pending */}
      {artist.status === "pending" && (
        <div className="flex gap-1.5 pt-1 border-t border-stone-800/60">
          <button
            onClick={(e) => { e.stopPropagation(); approveMutation.mutate(); }}
            disabled={approveMutation.isPending}
            className="flex-1 text-[10px] font-mono py-1 rounded bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
          >
            Approve
          </button>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="absolute inset-0 rounded-lg bg-stone-950/95 flex flex-col items-center justify-center gap-3 p-4 z-10">
          <p className="text-xs font-body text-stone-300 text-center">Delete <strong>{artist.display_name}</strong>?</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button
              size="sm"
              className="h-7 text-xs bg-red-600 hover:bg-red-500 text-white border-0"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Delete"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ArtistsPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [skip, setSkip] = useState(0);
  const [showSheet, setShowSheet] = useState(false);
  const [editArtist, setEditArtist] = useState<Artist | null>(null);
  const qc = useQueryClient();

  const handleSearch = (v: string) => {
    setSearch(v);
    setSkip(0);
    clearTimeout((window as unknown as Record<string, ReturnType<typeof setTimeout>>).__asearch);
    (window as unknown as Record<string, ReturnType<typeof setTimeout>>).__asearch = setTimeout(
      () => setDebouncedSearch(v), 300
    );
  };

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["artists", { skip, search: debouncedSearch, statusFilter, typeFilter }],
    queryFn: () => artistsApi.list({
      skip,
      limit: PAGE_SIZE,
      search: debouncedSearch || undefined,
      status: statusFilter !== "all" ? statusFilter : undefined,
      is_band: typeFilter === "band" ? true : typeFilter === "solo" ? false : undefined,
    }),
  });

  const artists = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-5 animate-fadeIn pb-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-stone-100">Artists</h1>
          <p className="mt-1 text-sm font-body text-stone-500">
            {total > 0 ? <>{formatCount(total)} artists</> : "Manage artist profiles"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => { setEditArtist(null); setShowSheet(true); }}
            className="h-8 text-xs bg-violet-600 hover:bg-violet-500 text-white border-0 gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" /> Add Artist
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => refetch()} disabled={isFetching}>
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
            placeholder="Search by name…"
            className="pl-9 h-8 text-xs"
          />
        </div>

        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setSkip(0); }}>
          <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex rounded-md border border-stone-800 overflow-hidden h-8">
          {[["all", "All"], ["solo", "Solo"], ["band", "Band"]].map(([v, label]) => (
            <button
              key={v}
              onClick={() => { setTypeFilter(v); setSkip(0); }}
              className={`px-3 text-[11px] font-mono transition-colors ${
                typeFilter === v ? "bg-violet-600 text-white" : "text-stone-500 hover:text-stone-300 hover:bg-stone-800/40"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="w-10 h-10 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {artists.map((artist) => (
            <ArtistCard
              key={artist.id}
              artist={artist}
              onEdit={(a) => { setEditArtist(a); setShowSheet(true); }}
              onDeleted={(id) => {
                qc.setQueryData<typeof data>(
                  ["artists", { skip, search: debouncedSearch, statusFilter, typeFilter }],
                  (old) => old ? { ...old, items: old.items.filter((a) => a.id !== id), total: old.total - 1 } : old
                );
              }}
            />
          ))}
          {artists.length === 0 && (
            <div className="col-span-4 text-center py-12 text-stone-600 text-sm font-body">
              No artists found
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && total > PAGE_SIZE && (
        <div className="flex items-center justify-between">
          <p className="text-xs font-mono text-stone-600">
            {skip + 1}–{Math.min(skip + PAGE_SIZE, total)} of {formatCount(total)}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-7" onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))} disabled={skip === 0}>
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <Button variant="outline" size="sm" className="h-7" onClick={() => setSkip(skip + PAGE_SIZE)} disabled={skip + PAGE_SIZE >= total}>
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Sheet */}
      {showSheet && (
        <ArtistSheet
          artist={editArtist ?? undefined}
          onClose={() => { setShowSheet(false); setEditArtist(null); }}
          onSaved={() => { refetch(); }}
        />
      )}
    </div>
  );
}
