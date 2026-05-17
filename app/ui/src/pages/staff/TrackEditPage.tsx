import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Save, Loader2, AlertCircle, ChevronRight, ChevronDown,
  Play, Pause, Music2, CheckSquare, Square, Star, Upload, ImageIcon, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkflowTagBadge } from "@/components/tracks/WorkflowTagBadge";
import { useTrack, useUpdateTrack } from "@/hooks/useTracks";
import { artistsApi } from "@/api/artists";
import { tracksApi } from "@/api/tracks";
import { toast } from "@/hooks/useToast";
import { usePlayerStore, _audio } from "@/store/player";
import { formatFileSize, formatDate, truncate } from "@/utils/format";
import type { WorkflowTag } from "@/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const WORKFLOW_TAGS: WorkflowTag[] = [
  "poor_quality",
  "duplicate_review", "already_worked_on", "already_in_database",
  "needs_compression", "orchard_source", "wav_source", "tamasha_owned",
  "signed_artist", "catalogue_number_only", "missing_metadata", "metadata_review",
];

const GENRES = [
  "Afrobeats", "Benga", "Bongo Flava", "Afro-fusion", "Gospel",
  "Hip-Hop", "R&B", "Reggae", "Dancehall", "Jazz", "Blues",
  "Classical", "Folk", "Electronic", "Genge", "Kapuka", "Mugithi",
  "Ohangla", "Rhumba", "Taarab", "Traditional", "Other",
];

const LANGUAGES = [
  "Swahili", "English", "Sheng", "Luo", "Kikuyu", "Luganda",
  "Zulu", "Amharic", "French", "Portuguese", "Arabic",
  "Luhya", "Kamba", "Kalenjin", "Somali", "Other",
];

const MOODS = [
  "Energetic", "Calm", "Happy", "Melancholic", "Romantic",
  "Spiritual", "Dark", "Upbeat", "Chill", "Intense",
];

const MUSICAL_KEYS = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
  "Cm", "C#m", "Dm", "D#m", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "A#m", "Bm",
];

// ─── Extended metadata types ──────────────────────────────────────────────────

interface ExtendedMeta {
  isrc: string; label: string; composer: string; publisher: string; copyright: string;
  featuring: string; band: string; producer: string; remixer: string;
  bpm: string; musical_key: string; mood: string; version: string;
  release_date: string; track_number: string; disc_number: string;
  upc: string; catalogue_number: string; explicit: boolean;
}

const EMPTY_EXTENDED: ExtendedMeta = {
  isrc: "", label: "", composer: "", publisher: "", copyright: "",
  featuring: "", band: "", producer: "", remixer: "",
  bpm: "", musical_key: "", mood: "", version: "",
  release_date: "", track_number: "", disc_number: "",
  upc: "", catalogue_number: "", explicit: false,
};

function countFilled(m: ExtendedMeta, keys: (keyof ExtendedMeta)[]) {
  return keys.filter((k) => (k === "explicit" ? m[k] : !!m[k])).length;
}

// ─── CollapsibleSection ───────────────────────────────────────────────────────

function CollapsibleSection({
  title, filledCount, defaultOpen = false, children,
}: {
  title: string; filledCount: number; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-stone-800 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-mono text-stone-400 hover:bg-stone-800/40 transition-colors"
      >
        <span className="flex items-center gap-2">
          {title}
          {filledCount > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-500/15 text-violet-400">
              {filledCount} filled
            </span>
          )}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-stone-800">{children}</div>
      )}
    </div>
  );
}

// ─── Extended metadata fields (Credits / Rights / Musical / Release) ──────────

function ExtendedMetaFields({
  meta, onChange,
}: {
  meta: ExtendedMeta;
  onChange: <K extends keyof ExtendedMeta>(k: K, v: ExtendedMeta[K]) => void;
}) {
  const creditsKeys: (keyof ExtendedMeta)[] = ["composer", "producer", "featuring", "band", "remixer"];
  const rightsKeys:  (keyof ExtendedMeta)[] = ["isrc", "label", "publisher", "copyright", "upc", "catalogue_number"];
  const musicalKeys: (keyof ExtendedMeta)[] = ["bpm", "musical_key", "mood", "version", "explicit"];
  const releaseKeys: (keyof ExtendedMeta)[] = ["release_date", "track_number", "disc_number"];

  const field = (label: string, k: keyof ExtendedMeta, placeholder = "") => (
    <div className="space-y-1" key={k}>
      <label className="block text-[10px] font-mono text-stone-500">{label}</label>
      <Input
        placeholder={placeholder}
        value={meta[k] as string}
        onChange={(e) => onChange(k, e.target.value as ExtendedMeta[typeof k])}
        className="h-8 text-xs"
      />
    </div>
  );

  return (
    <div className="space-y-2">
      <CollapsibleSection
        title="Credits"
        filledCount={countFilled(meta, creditsKeys)}
        defaultOpen={countFilled(meta, creditsKeys) > 0}
      >
        <div className="grid grid-cols-2 gap-2">
          {field("Composer", "composer", "e.g. John Doe")}
          {field("Producer", "producer")}
          {field("Featuring", "featuring", "feat. Artist B")}
          {field("Band / Group", "band")}
          {field("Remixer", "remixer")}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Rights & Publishing"
        filledCount={countFilled(meta, rightsKeys)}
        defaultOpen={countFilled(meta, rightsKeys) > 0}
      >
        <div className="grid grid-cols-2 gap-2">
          {field("ISRC", "isrc", "AA-XX0-00-00000")}
          {field("Label", "label")}
          {field("Publisher", "publisher")}
          {field("Copyright", "copyright", "2024 Label Name")}
          {field("UPC", "upc")}
          {field("Catalogue #", "catalogue_number")}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Musical Properties"
        filledCount={countFilled(meta, musicalKeys)}
        defaultOpen={countFilled(meta, musicalKeys) > 0}
      >
        <div className="grid grid-cols-2 gap-2">
          {field("BPM", "bpm", "120")}
          <div className="space-y-1">
            <label className="block text-[10px] font-mono text-stone-500">Key</label>
            <Select
              value={meta.musical_key || "__none__"}
              onValueChange={(v) => onChange("musical_key", v === "__none__" ? "" : v)}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">—</SelectItem>
                {MUSICAL_KEYS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] font-mono text-stone-500">Mood</label>
            <Select
              value={meta.mood || "__none__"}
              onValueChange={(v) => onChange("mood", v === "__none__" ? "" : v)}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">—</SelectItem>
                {MOODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {field("Version", "version", "Radio Edit / Extended…")}
          <div className="col-span-2 flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => onChange("explicit", !meta.explicit)}
              className={`flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-md border transition-colors ${
                meta.explicit
                  ? "border-red-500/40 bg-red-500/10 text-red-400"
                  : "border-stone-700 text-stone-500 hover:text-stone-300"
              }`}
            >
              {meta.explicit ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
              Explicit content
            </button>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Release Info"
        filledCount={countFilled(meta, releaseKeys)}
        defaultOpen={countFilled(meta, releaseKeys) > 0}
      >
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-3 space-y-1">
            <label className="block text-[10px] font-mono text-stone-500">Release date</label>
            <Input
              type="date"
              value={meta.release_date}
              onChange={(e) => onChange("release_date", e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          {field("Track #", "track_number", "1")}
          {field("Disc #", "disc_number", "1")}
        </div>
      </CollapsibleSection>
    </div>
  );
}

// ─── Artist search picker ─────────────────────────────────────────────────────

function ArtistPicker({
  value, onChange,
}: {
  value: { id: string; name: string } | null;
  onChange: (a: { id: string; name: string } | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ["artists-picker", search],
    queryFn: () => artistsApi.list({ limit: 20, search: search || undefined }),
    enabled: open,
    staleTime: 30_000,
  });

  return (
    <div className="relative">
      {value ? (
        <div className="flex items-center gap-2 h-9 px-3 rounded-md border border-stone-700 bg-stone-900 text-xs">
          <Star className="w-3 h-3 text-violet-400 flex-shrink-0" />
          <span className="flex-1 truncate text-stone-200">{value.name}</span>
          <button
            type="button"
            onClick={() => { onChange(null); setSearch(""); }}
            className="text-stone-600 hover:text-stone-300 transition-colors text-[10px] font-mono"
          >
            clear
          </button>
        </div>
      ) : (
        <div className="relative">
          <Input
            placeholder="Search artist…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            className="h-9 text-xs pr-8"
          />
          {open && (data?.items ?? []).length > 0 && (
            <div className="absolute z-50 top-full mt-1 w-full rounded-md border border-stone-700 bg-stone-900 shadow-xl overflow-hidden">
              {(data?.items ?? []).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onMouseDown={() => { onChange({ id: a.id, name: a.display_name }); setSearch(""); setOpen(false); }}
                  className="w-full text-left px-3 py-2 text-xs font-mono text-stone-300 hover:bg-stone-800 transition-colors flex items-center gap-2"
                >
                  <Star className="w-3 h-3 text-stone-600 flex-shrink-0" />
                  {a.display_name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Inline play button ───────────────────────────────────────────────────────

// ─── Artwork upload card ──────────────────────────────────────────────────────

function ArtworkCard({
  trackId, currentUrl, trackTitle,
}: {
  trackId: string; currentUrl: string | null; trackTitle: string;
}) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const { mutate: upload, isPending } = useMutation({
    mutationFn: (file: File) => tracksApi.uploadArtwork(trackId, file),
    onSuccess: () => {
      toast({ title: "Artwork updated", variant: "success" });
      qc.invalidateQueries({ queryKey: ["track", trackId] });
      setPreview(null);
    },
    onError: () => toast({ title: "Artwork upload failed", variant: "destructive" }),
  });

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please select an image file", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);
    upload(file);
  }, [upload]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const displayUrl = preview ?? currentUrl;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Artwork</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Image preview / dropzone */}
        <div
          className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-colors cursor-pointer ${
            dragging
              ? "border-violet-500 bg-violet-500/5"
              : displayUrl
              ? "border-stone-700 hover:border-stone-600"
              : "border-dashed border-stone-700 hover:border-stone-600 bg-stone-800/50"
          }`}
          onClick={() => !isPending && fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {displayUrl ? (
            <>
              <img src={displayUrl} alt={trackTitle} className="w-full h-full object-cover" />
              {/* Hover overlay */}
              <div className="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
                <Upload className="w-6 h-6 text-white" />
                <span className="text-xs font-mono text-white">
                  {currentUrl ? "Replace artwork" : "Upload artwork"}
                </span>
              </div>
            </>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-stone-600">
              <ImageIcon className="w-10 h-10 opacity-40" />
              <div className="text-center">
                <p className="text-xs font-mono">Drop image here</p>
                <p className="text-[10px] font-mono text-stone-700 mt-0.5">or click to browse</p>
              </div>
            </div>
          )}

          {/* Upload spinner overlay */}
          {isPending && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
            </div>
          )}
        </div>

        {/* Upload button */}
        <button
          type="button"
          disabled={isPending}
          onClick={() => fileRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 h-8 rounded-md border border-stone-700 bg-stone-900 text-xs font-mono text-stone-400 hover:text-stone-200 hover:border-stone-600 transition-colors disabled:opacity-50"
        >
          {isPending
            ? <><Loader2 className="w-3 h-3 animate-spin" /> Uploading…</>
            : <><Upload className="w-3 h-3" /> {currentUrl ? "Replace" : "Upload"} artwork</>}
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />

        <p className="text-[10px] font-mono text-stone-700 text-center">
          JPEG, PNG, WebP or GIF · max 10 MB
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Inline play button ───────────────────────────────────────────────────────

function InlinePlayButton({ trackId, title }: { trackId: string; title: string }) {
  const activeId  = usePlayerStore((s) => s.track?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isMine = activeId === trackId;

  function toggle() {
    const { setIsPlaying } = usePlayerStore.getState();
    if (!isMine) return;
    if (isPlaying) { _audio.pause(); setIsPlaying(false); }
    else           { _audio.play().catch(() => {}); setIsPlaying(true); }
  }

  if (!isMine) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-violet-500/15 border border-violet-500/30 text-violet-400 text-[10px] font-mono transition-colors hover:bg-violet-500/25"
    >
      {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
      {isPlaying ? "Pause" : "Resume"}
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function TrackEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: track, isLoading } = useTrack(id!);
  const { mutate: updateTrack, isPending } = useUpdateTrack();

  // ── Core metadata ──────────────────────────────────────────────────────────
  const [title, setTitle]       = useState("");
  const [album, setAlbum]       = useState("");
  const [year, setYear]         = useState("");
  const [genre, setGenre]       = useState("");
  const [language, setLanguage] = useState("");
  const [status, setStatus]     = useState<string>("pending");
  const [needsReview, setNeedsReview] = useState(false);
  const [selectedTags, setSelectedTags] = useState<WorkflowTag[]>([]);
  const [artist, setArtist]     = useState<{ id: string; name: string } | null>(null);

  // ── Extended metadata ──────────────────────────────────────────────────────
  const [ext, setExt] = useState<ExtendedMeta>(EMPTY_EXTENDED);

  const setExtField = <K extends keyof ExtendedMeta>(k: K, v: ExtendedMeta[K]) =>
    setExt((prev) => ({ ...prev, [k]: v }));

  // ── Populate when track loads ──────────────────────────────────────────────
  useEffect(() => {
    if (!track) return;
    setTitle(track.title ?? "");
    setAlbum(track.album ?? "");
    setYear(track.year?.toString() ?? "");
    setGenre(track.genre ?? "");
    setLanguage(track.language ?? "");
    setStatus(track.status ?? "pending");
    setNeedsReview(track.needs_human_review ?? false);
    setSelectedTags(track.workflow_tags ?? []);
    if (track.artist_id && track.artist_name) {
      setArtist({ id: track.artist_id, name: track.artist_name });
    }
    setExt({
      isrc:             track.isrc             ?? "",
      label:            track.label            ?? "",
      composer:         track.composer         ?? "",
      publisher:        track.publisher        ?? "",
      copyright:        track.copyright        ?? "",
      featuring:        track.featuring        ?? "",
      band:             track.band             ?? "",
      producer:         track.producer         ?? "",
      remixer:          track.remixer          ?? "",
      bpm:              track.bpm?.toString()  ?? "",
      musical_key:      track.musical_key      ?? "",
      mood:             track.mood             ?? "",
      version:          track.version          ?? "",
      release_date:     track.release_date     ?? "",
      track_number:     track.track_number?.toString() ?? "",
      disc_number:      track.disc_number?.toString()  ?? "",
      upc:              track.upc              ?? "",
      catalogue_number: track.catalogue_number ?? "",
      explicit:         track.explicit         ?? false,
    });
  }, [track]);

  const toggleTag = (tag: WorkflowTag) =>
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    updateTrack(
      {
        id: id!,
        data: {
          title:              title || undefined,
          artist_id:          artist?.id ?? null,
          album:              album || null,
          year:               year ? parseInt(year, 10) : null,
          genre:              genre || null,
          language:           language || null,
          status:             status as "pending" | "processing" | "ready" | "failed",
          workflow_tags:      selectedTags,
          needs_human_review: needsReview,
          // Extended metadata
          isrc:             ext.isrc        || null,
          label:            ext.label       || null,
          composer:         ext.composer    || null,
          publisher:        ext.publisher   || null,
          copyright:        ext.copyright   || null,
          featuring:        ext.featuring   || null,
          band:             ext.band        || null,
          producer:         ext.producer    || null,
          remixer:          ext.remixer     || null,
          bpm:              ext.bpm ? parseFloat(ext.bpm) : null,
          musical_key:      ext.musical_key || null,
          mood:             ext.mood        || null,
          version:          ext.version     || null,
          release_date:     ext.release_date || null,
          track_number:     ext.track_number ? parseInt(ext.track_number) : null,
          disc_number:      ext.disc_number  ? parseInt(ext.disc_number)  : null,
          upc:              ext.upc              || null,
          catalogue_number: ext.catalogue_number || null,
          explicit:         ext.explicit,
        },
      },
      {
        onSuccess: () => toast({ title: "Track updated", variant: "success" }),
        onError:   () => toast({ title: "Failed to save", variant: "destructive" }),
      }
    );
  };

  // ── Global player: set track for preview ──────────────────────────────────
  const activeId = usePlayerStore((s) => s.track?.id);

  function playPreview() {
    if (track) usePlayerStore.getState().setTrack(track);
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-5 animate-fadeIn">
        <Skeleton className="h-8 w-64" />
        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!track) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-stone-600">
        <p className="font-body">Track not found</p>
        <Link to="/staff/queue" className="mt-3 text-sm text-violet-400 hover:underline">
          Back to queue
        </Link>
      </div>
    );
  }

  const inferredEntries = track.inferred_metadata
    ? Object.entries(track.inferred_metadata).filter(([, v]) => typeof v === "number")
    : [];

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-xs font-mono text-stone-600">
        <Link to="/staff" className="hover:text-stone-400 transition-colors">Staff</Link>
        <ChevronRight className="w-3 h-3" />
        <Link to="/staff/queue" className="hover:text-stone-400 transition-colors">Queue</Link>
        <ChevronRight className="w-3 h-3" />
        <span className="text-stone-400">{truncate(track.r2_key_raw.split("/").pop() ?? id!, 40)}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-bold text-stone-100 truncate">
            {track.title || "Untitled Track"}
          </h1>
          <p className="mt-1 text-xs font-mono text-stone-600 break-all">{track.r2_key_raw}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {activeId === track.id
            ? <InlinePlayButton trackId={track.id} title={track.title} />
            : (
              <button
                type="button"
                onClick={playPreview}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-stone-800 border border-stone-700 text-stone-400 text-[10px] font-mono transition-colors hover:bg-violet-500/15 hover:border-violet-500/30 hover:text-violet-400"
              >
                <Play className="w-3 h-3" /> Preview
              </button>
            )
          }
          {track.needs_human_review && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-violet-500/10 border border-violet-500/20">
              <AlertCircle className="w-3.5 h-3.5 text-violet-500" />
              <span className="text-xs font-mono text-violet-400">Needs Review</span>
            </div>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid lg:grid-cols-3 gap-5">

          {/* ── Main form ─────────────────────────────────────────────────── */}
          <div className="lg:col-span-2 space-y-4">

            {/* Core metadata */}
            <Card>
              <CardHeader>
                <CardTitle>Core Metadata</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  {/* Title */}
                  <div className="sm:col-span-2 space-y-1.5">
                    <Label htmlFor="title">Title</Label>
                    <Input
                      id="title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Track title"
                    />
                  </div>

                  {/* Artist */}
                  <div className="sm:col-span-2 space-y-1.5">
                    <Label>Artist</Label>
                    <ArtistPicker value={artist} onChange={setArtist} />
                  </div>

                  {/* Album */}
                  <div className="space-y-1.5">
                    <Label htmlFor="album">Album</Label>
                    <Input
                      id="album"
                      value={album}
                      onChange={(e) => setAlbum(e.target.value)}
                      placeholder="Album name"
                    />
                  </div>

                  {/* Year */}
                  <div className="space-y-1.5">
                    <Label htmlFor="year">Year</Label>
                    <Input
                      id="year"
                      type="number"
                      min={1900}
                      max={new Date().getFullYear() + 1}
                      value={year}
                      onChange={(e) => setYear(e.target.value)}
                      placeholder="e.g. 2023"
                    />
                  </div>

                  {/* Genre */}
                  <div className="space-y-1.5">
                    <Label>Genre</Label>
                    <Select
                      value={genre || "__none__"}
                      onValueChange={(v) => setGenre(v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger><SelectValue placeholder="Select genre" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {GENRES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Language */}
                  <div className="space-y-1.5">
                    <Label>Language</Label>
                    <Select
                      value={language || "__none__"}
                      onValueChange={(v) => setLanguage(v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger><SelectValue placeholder="Select language" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None</SelectItem>
                        {LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Status */}
                  <div className="space-y-1.5">
                    <Label>Status</Label>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="processing">Processing</SelectItem>
                        <SelectItem value="ready">Ready</SelectItem>
                        <SelectItem value="failed">Failed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Extended metadata */}
            <Card>
              <CardHeader>
                <CardTitle>Extended Metadata</CardTitle>
              </CardHeader>
              <CardContent>
                <ExtendedMetaFields meta={ext} onChange={setExtField} />
              </CardContent>
            </Card>

            {/* Workflow tags & review */}
            <Card>
              <CardHeader>
                <CardTitle>Workflow</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Tags */}
                <div className="space-y-2">
                  <Label>Workflow Tags</Label>
                  <div className="flex flex-wrap gap-2">
                    {WORKFLOW_TAGS.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTag(tag)}
                        className={`transition-all duration-150 rounded-sm ${
                          selectedTags.includes(tag)
                            ? "ring-2 ring-violet-500/50 ring-offset-1 ring-offset-stone-900"
                            : "opacity-50 hover:opacity-80"
                        }`}
                      >
                        <WorkflowTagBadge tag={tag} />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Needs review toggle */}
                <div className="flex items-center justify-between pt-3 border-t border-stone-800">
                  <div>
                    <p className="text-xs font-mono text-stone-400">Needs Human Review</p>
                    <p className="text-[10px] font-mono text-stone-600 mt-0.5">
                      Toggle off once metadata has been verified
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNeedsReview((v) => !v)}
                    className={`flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-md border transition-colors ${
                      needsReview
                        ? "border-violet-500/40 bg-violet-500/10 text-violet-400"
                        : "border-stone-700 text-stone-500 hover:text-stone-300"
                    }`}
                  >
                    {needsReview
                      ? <><CheckSquare className="w-3.5 h-3.5" /> Flagged</>
                      : <><Square className="w-3.5 h-3.5" /> Cleared</>}
                  </button>
                </div>

                {/* Review reasons (read-only) */}
                {track.review_reasons.length > 0 && (
                  <div className="space-y-1 pt-2 border-t border-stone-800">
                    <p className="text-[10px] font-mono text-stone-600">System review reasons</p>
                    <ul className="space-y-1">
                      {track.review_reasons.map((reason, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs font-body text-stone-500">
                          <span className="text-violet-500/60 mt-0.5">›</span>
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
                  : <><Save className="h-4 w-4" /> Save Changes</>}
              </Button>
            </div>
          </div>

          {/* ── Sidebar ────────────────────────────────────────────────────── */}
          <div className="space-y-4">

            {/* Artwork */}
            <ArtworkCard trackId={id!} currentUrl={track.artwork_url} trackTitle={track.title} />

            {/* File info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">File Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: "Size",     value: formatFileSize(track.file_size_bytes) },
                  { label: "Status",   value: track.status },
                  { label: "Version",  value: `v${track.metadata_version}` },
                  { label: "Streams",  value: track.stream_count.toString() },
                  { label: "Added",    value: formatDate(track.created_at) },
                  { label: "Updated",  value: formatDate(track.updated_at) },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-xs font-mono text-stone-600">{label}</span>
                    <span className="text-xs font-mono text-stone-400">{value}</span>
                  </div>
                ))}
                <div className="pt-2 border-t border-stone-800">
                  <p className="text-xs font-mono text-stone-600 mb-1">SHA256</p>
                  <p className="text-xs font-mono text-stone-700 break-all">{truncate(track.sha256, 32)}</p>
                </div>
              </CardContent>
            </Card>

            {/* Quality score */}
            {track.quality_score != null && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Quality Score</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 bg-stone-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          track.quality_score >= 70 ? "bg-emerald-500" :
                          track.quality_score >= 40 ? "bg-yellow-500" : "bg-red-500"
                        }`}
                        style={{ width: `${Math.min(100, track.quality_score)}%` }}
                      />
                    </div>
                    <span className="text-sm font-mono font-bold text-stone-200 flex-shrink-0">
                      {track.quality_score}/100
                    </span>
                  </div>
                  {track.quality_breakdown && (
                    <div className="space-y-1 text-[10px] font-mono text-stone-600">
                      {(["format_score", "bitrate_score", "duration_score", "metadata_score", "size_score"] as const).map((k) => {
                        const val = (track.quality_breakdown as Record<string, number>)[k] ?? 0;
                        return (
                          <div key={k} className="flex items-center justify-between">
                            <span className="capitalize">{k.replace("_score", "")}</span>
                            <span className="text-stone-500">{val}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Inferred metadata confidence */}
            {inferredEntries.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Inferred Metadata</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {inferredEntries.map(([key, value]) => (
                    <div key={key}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-mono text-stone-500 capitalize">{key}</span>
                        <span className="text-xs font-mono text-stone-400">
                          {Math.round((value as number) * 100)}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-stone-800">
                        <div
                          className="h-full rounded-full bg-violet-500 transition-all"
                          style={{ width: `${Math.round((value as number) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

          </div>
        </div>
      </form>
    </div>
  );
}
