import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  X, Plus, Loader2, Search, Upload, Music2, FolderArchive,
  CheckSquare, Square, Check, AlertCircle, ImageIcon, ChevronLeft, ChevronRight, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { tracksApi } from "@/api/tracks";
import { artistsApi } from "@/api/artists";
import { toast } from "@/hooks/useToast";
import type { TrackCreatePayload, UploadedTrackMeta } from "@/types";

const GENRES = [
  "Afrobeats", "Benga", "Bongo Flava", "Afro-fusion", "Gospel",
  "Hip-Hop", "R&B", "Reggae", "Dancehall", "Jazz", "Blues",
  "Classical", "Folk", "Electronic", "Other",
];

const LANGUAGES = [
  "Swahili", "English", "Sheng", "Luo", "Kikuyu", "Luganda",
  "Zulu", "Amharic", "French", "Portuguese", "Arabic", "Other",
];

function fmtDuration(s: number | null | undefined): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function fmtBytes(b: number): string {
  if (b === 0) return "—";
  if (b < 1_000_000) return `${(b / 1_000).toFixed(0)} KB`;
  return `${(b / 1_000_000).toFixed(1)} MB`;
}

const MOODS = ["Energetic", "Calm", "Happy", "Melancholic", "Romantic", "Spiritual", "Dark", "Upbeat", "Chill", "Intense"];
const MUSICAL_KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
  "Cm", "C#m", "Dm", "D#m", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "A#m", "Bm"];

// ── Collapsible section ───────────────────────────────────────────────────────

function CollapsibleSection({ title, filledCount, children }: { title: string; filledCount: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
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
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-500/15 text-violet-400">{filledCount} filled</span>
          )}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-4 pb-4 pt-1 space-y-3 border-t border-stone-800">{children}</div>}
    </div>
  );
}

// ── Extended metadata fields ──────────────────────────────────────────────────

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

function extendedMetaToPayload(m: ExtendedMeta) {
  return {
    isrc: m.isrc || null,
    label: m.label || null,
    composer: m.composer || null,
    publisher: m.publisher || null,
    copyright: m.copyright || null,
    featuring: m.featuring || null,
    band: m.band || null,
    producer: m.producer || null,
    remixer: m.remixer || null,
    bpm: m.bpm ? parseFloat(m.bpm) : null,
    musical_key: m.musical_key || null,
    mood: m.mood || null,
    version: m.version || null,
    release_date: m.release_date || null,
    track_number: m.track_number ? parseInt(m.track_number) : null,
    disc_number: m.disc_number ? parseInt(m.disc_number) : null,
    upc: m.upc || null,
    catalogue_number: m.catalogue_number || null,
    explicit: m.explicit,
  };
}

function countFilled(m: ExtendedMeta, keys: (keyof ExtendedMeta)[]) {
  return keys.filter((k) => k === "explicit" ? m[k] : !!m[k]).length;
}

interface ExtendedMetaFieldsProps {
  meta: ExtendedMeta;
  onChange: <K extends keyof ExtendedMeta>(k: K, v: ExtendedMeta[K]) => void;
}

function ExtendedMetaFields({ meta, onChange }: ExtendedMetaFieldsProps) {
  const creditsKeys: (keyof ExtendedMeta)[] = ["composer", "producer", "featuring", "band", "remixer"];
  const rightsKeys: (keyof ExtendedMeta)[] = ["isrc", "label", "publisher", "copyright", "upc", "catalogue_number"];
  const musicalKeys: (keyof ExtendedMeta)[] = ["bpm", "musical_key", "mood", "version", "explicit"];
  const releaseKeys: (keyof ExtendedMeta)[] = ["release_date", "track_number", "disc_number"];

  const field = (label: string, k: keyof ExtendedMeta, placeholder = "") => (
    <div className="space-y-1">
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
      <CollapsibleSection title="Credits" filledCount={countFilled(meta, creditsKeys)}>
        <div className="grid grid-cols-2 gap-2">
          {field("Composer", "composer", "e.g. John Doe")}
          {field("Producer", "producer")}
          {field("Featuring", "featuring", "e.g. feat. Artist B")}
          {field("Band / Group", "band")}
          {field("Remixer", "remixer")}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Rights & Publishing" filledCount={countFilled(meta, rightsKeys)}>
        <div className="grid grid-cols-2 gap-2">
          {field("ISRC", "isrc", "AA-XX0-00-00000")}
          {field("Label", "label")}
          {field("Publisher", "publisher")}
          {field("Copyright", "copyright", "2024 Label Name")}
          {field("UPC", "upc")}
          {field("Catalogue #", "catalogue_number")}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Musical Properties" filledCount={countFilled(meta, musicalKeys)}>
        <div className="grid grid-cols-2 gap-2">
          {field("BPM", "bpm", "120")}
          <div className="space-y-1">
            <label className="block text-[10px] font-mono text-stone-500">Key</label>
            <Select value={meta.musical_key || "__none"} onValueChange={(v) => onChange("musical_key", v === "__none" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>{[<SelectItem key="n" value="__none">—</SelectItem>, ...MUSICAL_KEYS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)]}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="block text-[10px] font-mono text-stone-500">Mood</label>
            <Select value={meta.mood || "__none"} onValueChange={(v) => onChange("mood", v === "__none" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>{[<SelectItem key="n" value="__none">—</SelectItem>, ...MOODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)]}</SelectContent>
            </Select>
          </div>
          {field("Version", "version", "Radio Edit / Extended…")}
          <div className="col-span-2 flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => onChange("explicit", !meta.explicit)}
              className={`flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-md border transition-colors ${meta.explicit ? "border-red-500/40 bg-red-500/10 text-red-400" : "border-stone-700 text-stone-500 hover:text-stone-300"}`}
            >
              {meta.explicit ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
              Explicit content
            </button>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Release Info" filledCount={countFilled(meta, releaseKeys)}>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-3 space-y-1">
            <label className="block text-[10px] font-mono text-stone-500">Release date</label>
            <Input type="date" value={meta.release_date} onChange={(e) => onChange("release_date", e.target.value)} className="h-8 text-xs" />
          </div>
          {field("Track #", "track_number", "1")}
          {field("Disc #", "disc_number", "1")}
        </div>
      </CollapsibleSection>
    </div>
  );
}

// ── Dropzone ──────────────────────────────────────────────────────────────────

interface DropzoneProps {
  accept: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  onFile: (f: File) => void;
  disabled?: boolean;
}

function Dropzone({ accept, label, hint, icon, onFile, disabled }: DropzoneProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  }, [disabled, onFile]);

  return (
    <div
      className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-all
        ${dragging ? "border-violet-500 bg-violet-500/5" : "border-stone-700 hover:border-stone-600 hover:bg-stone-800/30"}
        ${disabled ? "opacity-50 pointer-events-none" : ""}`}
      onClick={() => ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="w-10 h-10 rounded-full bg-stone-800 flex items-center justify-center text-stone-500">
        {icon}
      </div>
      <div className="text-center">
        <p className="text-sm font-body text-stone-300">{label}</p>
        <p className="text-xs font-mono text-stone-600 mt-1">{hint}</p>
      </div>
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onFile(f);
        e.target.value = "";
      }} />
    </div>
  );
}

// ── Upload progress bar ───────────────────────────────────────────────────────

function UploadBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs font-mono text-stone-500">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-violet-500 rounded-full transition-all duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Artwork preview ───────────────────────────────────────────────────────────

function ArtworkThumb({ url }: { url: string | null | undefined }) {
  if (!url) return (
    <div className="w-12 h-12 rounded-md bg-stone-800 flex items-center justify-center flex-shrink-0">
      <ImageIcon className="w-5 h-5 text-stone-700" />
    </div>
  );
  return (
    <img src={url} alt="" className="w-12 h-12 rounded-md object-cover flex-shrink-0 border border-stone-700" />
  );
}

// ── Artist search ─────────────────────────────────────────────────────────────

interface ArtistPickerProps {
  artistId: string | null;
  onChange: (id: string | null) => void;
}

function ArtistPicker({ artistId, onChange }: ArtistPickerProps) {
  const [q, setQ] = useState("");
  const { data } = useQuery({
    queryKey: ["artists-search", q],
    queryFn: () => artistsApi.list({ search: q, limit: 12 }),
    enabled: q.length > 0,
  });

  return (
    <div className="space-y-2">
      <label className="block text-xs font-mono text-stone-400">Artist</label>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-stone-600 pointer-events-none" />
        <Input
          placeholder="Search existing artists…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-9 text-sm pl-8"
        />
      </div>
      {data && data.items.length > 0 && (
        <div className="bg-stone-900 border border-stone-800 rounded-lg overflow-hidden max-h-32 overflow-y-auto">
          {data.items.map((a) => (
            <button
              key={a.id}
              onClick={() => { onChange(artistId === a.id ? null : a.id); setQ(a.display_name); }}
              className={`w-full text-left px-3 py-1.5 text-xs font-body flex justify-between transition-colors
                ${artistId === a.id ? "bg-violet-500/10 text-violet-300" : "text-stone-300 hover:bg-stone-800"}`}
            >
              <span>{a.display_name}</span>
              {a.country && <span className="text-stone-600 font-mono">{a.country}</span>}
            </button>
          ))}
        </div>
      )}
      {artistId && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-violet-400">Selected: {artistId}</span>
          <button className="text-[10px] font-mono text-stone-600 hover:text-stone-400" onClick={() => { onChange(null); setQ(""); }}>
            × clear
          </button>
        </div>
      )}
    </div>
  );
}

// ── Single track form ─────────────────────────────────────────────────────────

interface SingleFormProps {
  onClose: () => void;
  onCreated: () => void;
}

function SingleTrackForm({ onClose, onCreated }: SingleFormProps) {
  const qc = useQueryClient();
  const [uploadPct, setUploadPct] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState<UploadedTrackMeta | null>(null);
  const [extended, setExtended] = useState<ExtendedMeta>(EMPTY_EXTENDED);

  const [form, setForm] = useState<Omit<TrackCreatePayload, "r2_key_raw" | "sha256" | "md5" | "file_size_bytes" | "duration_seconds">>({
    title: "", album: null, year: null, genre: null, language: null, artist_id: null,
  });

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const setExt = <K extends keyof ExtendedMeta>(k: K, v: ExtendedMeta[K]) =>
    setExtended((e) => ({ ...e, [k]: v }));

  async function handleFile(file: File) {
    setUploading(true);
    setUploadPct(0);
    try {
      const meta = await tracksApi.uploadFile(file, setUploadPct);
      setUploaded(meta);
      setForm((f) => ({
        ...f,
        title: meta.title || f.title,
        album: meta.album || f.album,
      }));
    } catch (err: any) {
      toast({ title: err?.response?.data?.detail ?? "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  const createMutation = useMutation({
    mutationFn: () => tracksApi.create({
      ...form,
      ...extendedMetaToPayload(extended),
      r2_key_raw: uploaded!.r2_key_raw,
      sha256: uploaded!.sha256,
      md5: uploaded!.md5,
      file_size_bytes: uploaded!.file_size_bytes,
      duration_seconds: uploaded!.duration_seconds,
      artwork_r2_key: uploaded!.artwork_r2_key,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalogue"] });
      toast({ title: "Track added to catalogue", variant: "success" });
      onCreated();
      onClose();
    },
    onError: (e: any) => toast({ title: e?.response?.data?.detail ?? "Failed to create track", variant: "destructive" }),
  });

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-5">

      {/* Drop / progress / uploaded state */}
      {!uploaded && !uploading && (
        <Dropzone
          accept=".mp3,.flac,.wav,.m4a,.aac,.ogg,.opus,.aiff,.wma"
          label="Drop audio file here or click to browse"
          hint=".mp3 · .flac · .wav · .m4a · .aac · .ogg · .opus · .aiff"
          icon={<Music2 className="w-5 h-5" />}
          onFile={handleFile}
        />
      )}

      {uploading && <UploadBar pct={uploadPct} label={uploadPct < 100 ? "Uploading…" : "Processing…"} />}

      {uploaded && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/8 border border-emerald-500/20">
          <ArtworkThumb url={uploaded.artwork_url} />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-body text-stone-200 truncate">{uploaded.original_filename}</p>
            <p className="text-[10px] font-mono text-stone-500 mt-0.5">
              {fmtDuration(uploaded.duration_seconds)} · {fmtBytes(uploaded.file_size_bytes)}
              {uploaded.artwork_url && <span className="ml-2 text-emerald-500">· artwork found</span>}
            </p>
          </div>
          <button onClick={() => setUploaded(null)} className="text-stone-600 hover:text-stone-400 flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Metadata */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="block text-xs font-mono text-stone-400">Title <span className="text-red-500">*</span></label>
          <Input
            placeholder="Track title"
            value={form.title ?? ""}
            onChange={(e) => set("title", e.target.value)}
            className="h-9 text-sm"
            autoFocus={!uploaded}
          />
        </div>

        <ArtistPicker artistId={form.artist_id ?? null} onChange={(id) => set("artist_id", id)} />

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="block text-xs font-mono text-stone-400">Album</label>
            <Input placeholder="Album name" value={form.album ?? ""} onChange={(e) => set("album", e.target.value || null)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-mono text-stone-400">Year</label>
            <Input type="number" placeholder="2024" value={form.year ?? ""} onChange={(e) => set("year", e.target.value ? parseInt(e.target.value) : null)} className="h-9 text-sm" min={1900} max={2100} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="block text-xs font-mono text-stone-400">Genre</label>
            <Select value={form.genre ?? "__none"} onValueChange={(v) => set("genre", v === "__none" ? null : v)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>{[<SelectItem key="n" value="__none">—</SelectItem>, ...GENRES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)]}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-mono text-stone-400">Language</label>
            <Select value={form.language ?? "__none"} onValueChange={(v) => set("language", v === "__none" ? null : v)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>{[<SelectItem key="n" value="__none">—</SelectItem>, ...LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)]}</SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <ExtendedMetaFields meta={extended} onChange={setExt} />

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={onClose} className="h-8 text-xs">Cancel</Button>
        <Button
          size="sm"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending || !uploaded || !form.title?.trim()}
          className="h-8 text-xs bg-violet-600 hover:bg-violet-500 text-white border-0 gap-1.5"
        >
          {createMutation.isPending
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating…</>
            : <><Plus className="w-3.5 h-3.5" /> Create track</>}
        </Button>
      </div>
    </div>
  );
}

// ── Per-track overrides ───────────────────────────────────────────────────────

interface TrackOverride {
  title: string;
  artistId: string | null;
  included: boolean;
}

// ── Album form ────────────────────────────────────────────────────────────────

interface AlbumFormProps {
  onClose: () => void;
  onCreated: () => void;
}

function AlbumForm({ onClose, onCreated }: AlbumFormProps) {
  const qc = useQueryClient();
  const [uploadPct, setUploadPct] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [tracks, setTracks] = useState<UploadedTrackMeta[]>([]);
  const [overrides, setOverrides] = useState<TrackOverride[]>([]);
  const [activeTab, setActiveTab] = useState(0);

  // Album-level fields
  const [albumName, setAlbumName] = useState("");
  const [albumArtistId, setAlbumArtistId] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [genre, setGenre] = useState<string | null>(null);
  const [language, setLanguage] = useState<string | null>(null);
  const [extended, setExtended] = useState<ExtendedMeta>(EMPTY_EXTENDED);
  const setExt = <K extends keyof ExtendedMeta>(k: K, v: ExtendedMeta[K]) =>
    setExtended((e) => ({ ...e, [k]: v }));

  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(0);

  async function handleFile(file: File) {
    setUploading(true);
    setUploadPct(0);
    try {
      const res = await tracksApi.uploadAlbum(file, setUploadPct);
      setTracks(res.tracks);
      setOverrides(res.tracks.map((t) => ({
        title: t.title || t.original_filename,
        artistId: null,
        included: true,
      })));
      setActiveTab(0);
      if (!albumName && res.tracks[0]?.album) setAlbumName(res.tracks[0].album);
      if (!year && res.tracks[0]?.track_number) {/* keep null */}
    } catch (err: any) {
      toast({ title: err?.response?.data?.detail ?? "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  function patchOverride<K extends keyof TrackOverride>(i: number, key: K, val: TrackOverride[K]) {
    setOverrides((prev) => prev.map((o, idx) => idx === i ? { ...o, [key]: val } : o));
  }

  const includedCount = overrides.filter((o) => o.included).length;

  async function createAll() {
    const toCreate = tracks.filter((_, i) => overrides[i]?.included);
    setCreating(true);
    setCreated(0);
    let count = 0;
    for (const t of toCreate) {
      const i = tracks.indexOf(t);
      const ov = overrides[i];
      try {
        await tracksApi.create({
          title: ov.title || t.original_filename,
          r2_key_raw: t.r2_key_raw,
          sha256: t.sha256,
          md5: t.md5,
          file_size_bytes: t.file_size_bytes,
          duration_seconds: t.duration_seconds,
          album: albumName || t.album || null,
          year: year || null,
          genre: genre || null,
          language: language || null,
          artist_id: ov.artistId ?? albumArtistId,
          artwork_r2_key: t.artwork_r2_key,
          ...extendedMetaToPayload(extended),
        });
        count++;
        setCreated(count);
      } catch {
        // continue
      }
    }
    qc.invalidateQueries({ queryKey: ["catalogue"] });
    toast({ title: `${count} of ${toCreate.length} tracks added`, variant: "success" });
    setCreating(false);
    onCreated();
    onClose();
  }

  const activeTrack = tracks[activeTab];
  const activeOv = overrides[activeTab];

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-4">

        {/* ── Album details — always visible ───────────────────── */}
        <div>
          <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500 mb-3">Album Details</p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-mono text-stone-400">Album name <span className="text-red-500">*</span></label>
              <Input
                placeholder="Album title"
                value={albumName}
                onChange={(e) => setAlbumName(e.target.value)}
                className="h-9 text-sm"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-mono text-stone-400">Year</label>
                <Input type="number" placeholder="2024" value={year ?? ""} onChange={(e) => setYear(e.target.value ? parseInt(e.target.value) : null)} className="h-9 text-sm" min={1900} max={2100} />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-mono text-stone-400">Genre</label>
                <Select value={genre ?? "__none"} onValueChange={(v) => setGenre(v === "__none" ? null : v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>{[<SelectItem key="n" value="__none">—</SelectItem>, ...GENRES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)]}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-mono text-stone-400">Language</label>
                <Select value={language ?? "__none"} onValueChange={(v) => setLanguage(v === "__none" ? null : v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>{[<SelectItem key="n" value="__none">—</SelectItem>, ...LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)]}</SelectContent>
                </Select>
              </div>
            </div>

            <ArtistPicker artistId={albumArtistId} onChange={setAlbumArtistId} />

            <ExtendedMetaFields meta={extended} onChange={setExt} />
          </div>
        </div>

        {/* ── ZIP upload ────────────────────────────────────────── */}
        {tracks.length === 0 && !uploading && (
          <Dropzone
            accept=".zip"
            label="Drop ZIP archive here or click to browse"
            hint="Each audio file in the ZIP becomes a separate track"
            icon={<FolderArchive className="w-5 h-5" />}
            onFile={handleFile}
          />
        )}

        {uploading && <UploadBar pct={uploadPct} label={uploadPct < 100 ? "Uploading ZIP…" : "Extracting & uploading tracks…"} />}

        {/* ── Track list ────────────────────────────────────────── */}
        {tracks.length > 0 && (
          <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-mono uppercase tracking-wider text-stone-500">{tracks.length} tracks · {includedCount} selected</p>
                <button
                  onClick={() => {
                    const allIn = overrides.every((o) => o.included);
                    setOverrides((prev) => prev.map((o) => ({ ...o, included: !allIn })));
                  }}
                  className="flex items-center gap-1 text-[10px] font-mono text-stone-500 hover:text-stone-300 transition-colors"
                >
                  {overrides.every((o) => o.included)
                    ? <><CheckSquare className="w-3 h-3" /> Deselect all</>
                    : <><Square className="w-3 h-3" /> Select all</>}
                </button>
              </div>

              {/* Tab strip */}
              <div className="flex overflow-x-auto border-b border-stone-800 mb-0 gap-0 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-stone-800">
                {tracks.map((t, i) => {
                  const ov = overrides[i];
                  return (
                    <button
                      key={i}
                      onClick={() => setActiveTab(i)}
                      className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono border-b-2 transition-colors whitespace-nowrap
                        ${activeTab === i
                          ? "border-violet-500 text-violet-300 bg-violet-500/5"
                          : "border-transparent text-stone-500 hover:text-stone-300 hover:bg-stone-800/40"
                        }
                        ${!ov?.included ? "opacity-40" : ""}`}
                    >
                      <span className="text-stone-700 text-[10px]">{i + 1}</span>
                      <span className="max-w-[100px] truncate">{ov?.title || t.original_filename}</span>
                      {t.artwork_url && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" title="Has artwork" />}
                    </button>
                  );
                })}
              </div>

              {/* Active track detail */}
              {activeTrack && activeOv && (
                <div className="border border-stone-800 border-t-0 rounded-b-xl p-4 space-y-4 bg-stone-900/40">
                  <div className="flex items-start gap-4">
                    {/* Artwork */}
                    {activeTrack.artwork_url
                      ? <img src={activeTrack.artwork_url} alt="" className="w-20 h-20 rounded-lg object-cover flex-shrink-0 border border-stone-700" />
                      : <div className="w-20 h-20 rounded-lg bg-stone-800 flex items-center justify-center flex-shrink-0 border border-stone-800">
                          <ImageIcon className="w-7 h-7 text-stone-700" />
                        </div>
                    }
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="space-y-1">
                        <label className="block text-[10px] font-mono text-stone-500">Title</label>
                        <input
                          value={activeOv.title}
                          onChange={(e) => patchOverride(activeTab, "title", e.target.value)}
                          className="w-full bg-stone-800 border border-stone-700 rounded-md px-2.5 py-1.5 text-sm font-body text-stone-200 outline-none focus:border-violet-500 transition-colors"
                          placeholder={activeTrack.original_filename}
                        />
                      </div>
                      <div className="flex items-center gap-3 text-[10px] font-mono text-stone-600">
                        <span>{fmtDuration(activeTrack.duration_seconds)}</span>
                        <span>·</span>
                        <span>{fmtBytes(activeTrack.file_size_bytes)}</span>
                        {activeTrack.track_number != null && <><span>·</span><span>Track {activeTrack.track_number}</span></>}
                        {activeTrack.artwork_url && <span className="text-emerald-500">· artwork embedded</span>}
                      </div>
                    </div>
                  </div>

                  {/* Per-track artist override */}
                  <div>
                    <label className="block text-[10px] font-mono text-stone-500 mb-1.5">
                      Artist override <span className="text-stone-700">(leave blank to use album artist)</span>
                    </label>
                    <ArtistPicker
                      artistId={activeOv.artistId}
                      onChange={(id) => patchOverride(activeTab, "artistId", id)}
                    />
                  </div>

                  {/* Include / exclude */}
                  <div className="flex items-center justify-between pt-1 border-t border-stone-800">
                    <span className="text-[10px] font-mono text-stone-500">Include this track</span>
                    <button
                      onClick={() => patchOverride(activeTab, "included", !activeOv.included)}
                      className={`flex items-center gap-1.5 text-[10px] font-mono transition-colors ${activeOv.included ? "text-violet-400 hover:text-violet-300" : "text-stone-600 hover:text-stone-400"}`}
                    >
                      {activeOv.included ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                      {activeOv.included ? "Included" : "Excluded"}
                    </button>
                  </div>

                  {/* Prev / next */}
                  <div className="flex justify-between pt-1">
                    <button
                      onClick={() => setActiveTab((t) => Math.max(0, t - 1))}
                      disabled={activeTab === 0}
                      className="flex items-center gap-1 text-[10px] font-mono text-stone-600 hover:text-stone-300 disabled:opacity-30 transition-colors"
                    >
                      <ChevronLeft className="w-3 h-3" /> prev
                    </button>
                    <span className="text-[10px] font-mono text-stone-700">{activeTab + 1} / {tracks.length}</span>
                    <button
                      onClick={() => setActiveTab((t) => Math.min(tracks.length - 1, t + 1))}
                      disabled={activeTab === tracks.length - 1}
                      className="flex items-center gap-1 text-[10px] font-mono text-stone-600 hover:text-stone-300 disabled:opacity-30 transition-colors"
                    >
                      next <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
          </div>
        )}

        {creating && (
          <UploadBar pct={Math.round((created / includedCount) * 100)} label={`Creating ${created} / ${includedCount}…`} />
        )}
      </div>

      {tracks.length > 0 && (
        <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2 flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 text-xs">Cancel</Button>
          <Button
            size="sm"
            onClick={createAll}
            disabled={creating || includedCount === 0 || !albumName.trim()}
            className="h-8 text-xs bg-violet-600 hover:bg-violet-500 text-white border-0 gap-1.5"
          >
            {creating
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating…</>
              : <><Check className="w-3.5 h-3.5" /> Create {includedCount} track{includedCount !== 1 ? "s" : ""}</>}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Shell ─────────────────────────────────────────────────────────────────────

type Mode = "single" | "album";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export function TrackCreateSheet({ onClose, onCreated }: Props) {
  const [mode, setMode] = useState<Mode>("single");

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg h-full bg-stone-950 border-l border-stone-800 flex flex-col animate-slideInRight overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-violet-500/15 flex items-center justify-center">
              <Upload className="w-3.5 h-3.5 text-violet-400" />
            </div>
            <h2 className="font-display font-bold text-stone-100 text-sm">Upload Track</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Mode tabs */}
        <div className="flex border-b border-stone-800 flex-shrink-0">
          {(["single", "album"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-mono transition-colors border-b-2 ${
                mode === m
                  ? "border-violet-500 text-violet-400"
                  : "border-transparent text-stone-500 hover:text-stone-300"
              }`}
            >
              {m === "single" ? <Music2 className="w-3.5 h-3.5" /> : <FolderArchive className="w-3.5 h-3.5" />}
              {m === "single" ? "Single Track" : "Album / ZIP"}
            </button>
          ))}
        </div>

        {/* Mode body */}
        {mode === "single"
          ? <SingleTrackForm onClose={onClose} onCreated={onCreated} />
          : <AlbumForm onClose={onClose} onCreated={onCreated} />}

        {/* Footer note */}
        <div className="px-5 py-2 border-t border-stone-800 flex-shrink-0">
          <p className="text-[10px] font-mono text-stone-700">
            Audio uploaded to R2 · Tracks start in <span className="text-stone-500">pending</span> · Artwork auto-extracted from tags
          </p>
        </div>
      </div>
    </div>
  );
}
