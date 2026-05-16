import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  X, Music2, Pencil, Check, ChevronRight, AlertTriangle,
  CheckCircle2, Loader2, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImageUpload } from "@/components/ui/ImageUpload";
import { tracksApi } from "@/api/tracks";
import { toast } from "@/hooks/useToast";
import { formatCount } from "@/utils/format";
import type { Track, TrackStatus, WorkflowTag } from "@/types";

const STATUS_COLORS: Record<string, string> = {
  pending:    "text-stone-400 bg-stone-800",
  processing: "text-violet-400 bg-violet-500/15",
  ready:      "text-emerald-400 bg-emerald-500/15",
  failed:     "text-red-400 bg-red-500/15",
  deleted:    "text-stone-600 bg-stone-900",
};

// Allowed workflow transitions from a given status
const NEXT_STATUSES: Record<TrackStatus, TrackStatus[]> = {
  pending:    ["processing", "ready"],
  processing: ["ready", "failed", "pending"],
  ready:      ["pending"],
  failed:     ["pending"],
};

const ALL_WORKFLOW_TAGS: WorkflowTag[] = [
  "duplicate_review", "already_worked_on", "already_in_database",
  "needs_compression", "orchard_source", "wav_source", "tamasha_owned",
  "signed_artist", "catalogue_number_only", "missing_metadata", "metadata_review",
];

const TAG_LABELS: Record<WorkflowTag, string> = {
  duplicate_review:      "Duplicate Review",
  already_worked_on:     "Already Worked On",
  already_in_database:   "Already In DB",
  needs_compression:     "Needs Compression",
  orchard_source:        "Orchard Source",
  wav_source:            "WAV Source",
  tamasha_owned:         "Tamasha Owned",
  signed_artist:         "Signed Artist",
  catalogue_number_only: "Catalogue # Only",
  missing_metadata:      "Missing Metadata",
  metadata_review:       "Metadata Review",
};

function Field({
  label, value, editing, name, onChange, type = "text",
}: {
  label: string;
  value: string | number | null | undefined;
  editing: boolean;
  name: string;
  onChange: (name: string, v: string) => void;
  type?: string;
}) {
  return (
    <div className="flex items-start gap-3 py-2 border-b border-stone-800/50 last:border-0">
      <span className="text-xs font-mono text-stone-600 w-28 flex-shrink-0 pt-1.5">{label}</span>
      {editing ? (
        <Input
          type={type}
          value={value ?? ""}
          onChange={(e) => onChange(name, e.target.value)}
          className="h-7 text-xs flex-1"
        />
      ) : (
        <span className="text-xs font-body text-stone-300 flex-1 break-words pt-1">
          {value != null && value !== "" ? String(value) : <span className="text-stone-700 italic">—</span>}
        </span>
      )}
    </div>
  );
}

interface Props {
  track: Track;
  onClose: () => void;
  onUpdated?: (updated: Track) => void;
  onDeleted?: () => void;
}

export function TrackDetailSheet({ track, onClose, onUpdated, onDeleted }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState({
    title: track.title ?? "",
    album: track.album ?? "",
    year: track.year != null ? String(track.year) : "",
    genre: track.genre ?? "",
    language: track.language ?? "",
  });
  const [localTags, setLocalTags] = useState<WorkflowTag[]>(track.workflow_tags ?? []);
  const [localNeedsReview, setLocalNeedsReview] = useState(track.needs_human_review);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { if (editing) setEditing(false); else onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, editing]);

  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof tracksApi.update>[1]) => tracksApi.update(track.id, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["catalogue"] });
      onUpdated?.(updated);
      setEditing(false);
    },
  });

  const artworkMutation = useMutation({
    mutationFn: (file: File) => tracksApi.uploadArtwork(track.id, file),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["catalogue"] });
      onUpdated?.(updated);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => tracksApi.delete(track.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalogue"] });
      toast({ title: "Track deleted", variant: "success" });
      onDeleted?.();
      onClose();
    },
    onError: () => {
      toast({ title: "Failed to delete track", variant: "destructive" });
      setConfirmDelete(false);
    },
  });

  const saveMetadata = () => {
    updateMutation.mutate({
      title: form.title || undefined,
      album: form.album || null,
      year: form.year ? parseInt(form.year) : null,
      genre: form.genre || null,
      language: form.language || null,
      workflow_tags: localTags,
      needs_human_review: localNeedsReview,
    });
  };

  const advanceStatus = (nextStatus: TrackStatus) => {
    updateMutation.mutate({ status: nextStatus });
  };

  const handleFieldChange = (name: string, value: string) => {
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const toggleTag = (tag: WorkflowTag) => {
    setLocalTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const nextStatuses = NEXT_STATUSES[track.status] ?? [];
  const isSaving = updateMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div ref={overlayRef} className="absolute inset-0 bg-black/60" onClick={() => { if (!editing) onClose(); }} />

      <div className="relative w-full max-w-lg h-full bg-stone-950 border-l border-stone-800 flex flex-col animate-slideInRight overflow-hidden">
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-stone-800 flex-shrink-0">
          <div className="w-10 h-10 rounded-lg bg-stone-800 flex items-center justify-center flex-shrink-0">
            <Music2 className="w-5 h-5 text-stone-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-stone-100 truncate">
              {track.title || <span className="text-stone-600 italic">Untitled</span>}
            </h2>
            <p className="text-xs font-mono text-stone-600 mt-0.5 truncate">{track.id}</p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {!editing ? (
              <Button
                variant="ghost" size="sm"
                onClick={() => setEditing(true)}
                className="h-8 w-8 p-0 text-stone-500 hover:text-violet-400"
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost" size="sm"
                  onClick={() => { setEditing(false); setForm({ title: track.title ?? "", album: track.album ?? "", year: track.year != null ? String(track.year) : "", genre: track.genre ?? "", language: track.language ?? "" }); setLocalTags(track.workflow_tags ?? []); setLocalNeedsReview(track.needs_human_review); }}
                  className="h-8 px-2 text-xs text-stone-500"
                  disabled={isSaving}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={saveMetadata}
                  disabled={isSaving}
                  className="h-8 px-3 bg-violet-500 hover:bg-violet-400 text-stone-950 text-xs font-semibold"
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Check className="w-3.5 h-3.5 mr-1" />Save</>}
                </Button>
              </>
            )}
            <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Status + workflow advancement */}
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <span className={`text-xs font-mono px-2.5 py-1 rounded ${STATUS_COLORS[track.status] ?? "text-stone-500 bg-stone-800"}`}>
                {track.status}
              </span>
              {track.needs_human_review && (
                <span className="text-xs font-mono px-2.5 py-1 rounded text-violet-400 bg-violet-500/15 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> needs review
                </span>
              )}
            </div>

            {/* Workflow advancement */}
            {nextStatuses.length > 0 && !editing && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-mono text-stone-600 uppercase tracking-wider">Advance workflow</p>
                <div className="flex flex-wrap gap-2">
                  {nextStatuses.map((ns) => (
                    <button
                      key={ns}
                      onClick={() => advanceStatus(ns)}
                      disabled={isSaving}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-mono transition-colors disabled:opacity-40 ${
                        ns === "ready"
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                          : ns === "failed"
                          ? "border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
                          : "border-stone-700 text-stone-400 hover:text-stone-200 hover:bg-stone-800"
                      }`}
                    >
                      {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <ChevronRight className="w-3 h-3" />}
                      → {ns}
                    </button>
                  ))}
                  {!track.needs_human_review && (
                    <button
                      onClick={() => updateMutation.mutate({ needs_human_review: true })}
                      disabled={isSaving}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-violet-500/30 bg-violet-500/10 text-violet-400 text-xs font-mono hover:bg-violet-500/20 transition-colors disabled:opacity-40"
                    >
                      <AlertTriangle className="w-3 h-3" /> Flag for review
                    </button>
                  )}
                  {track.needs_human_review && (
                    <button
                      onClick={() => updateMutation.mutate({ needs_human_review: false })}
                      disabled={isSaving}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs font-mono hover:bg-emerald-500/20 transition-colors disabled:opacity-40"
                    >
                      <CheckCircle2 className="w-3 h-3" /> Clear review flag
                    </button>
                  )}
                </div>
              </div>
            )}

            {updateMutation.isError && (
              <p className="text-xs font-mono text-red-400">Save failed — try again</p>
            )}
          </div>

          {/* Metadata fields */}
          <div>
            <p className="text-[10px] font-mono text-stone-600 uppercase tracking-wider mb-2">Metadata</p>
            <div className="bg-stone-900/60 rounded-lg px-3">
              <Field label="Title"    value={form.title}    name="title"    editing={editing} onChange={handleFieldChange} />
              <Field label="Album"    value={form.album}    name="album"    editing={editing} onChange={handleFieldChange} />
              <Field label="Genre"    value={form.genre}    name="genre"    editing={editing} onChange={handleFieldChange} />
              <Field label="Year"     value={form.year}     name="year"     editing={editing} onChange={handleFieldChange} type="number" />
              <Field label="Language" value={form.language} name="language" editing={editing} onChange={handleFieldChange} />
              {!editing && (
                <div className="flex items-start gap-3 py-2">
                  <span className="text-xs font-mono text-stone-600 w-28 flex-shrink-0 pt-1">Artist ID</span>
                  <span className="text-xs font-mono text-stone-500 flex-1 break-all pt-1">
                    {track.artist_id ?? <span className="italic text-stone-700">—</span>}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Workflow tags */}
          <div>
            <p className="text-[10px] font-mono text-stone-600 uppercase tracking-wider mb-2">Workflow Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {ALL_WORKFLOW_TAGS.map((tag) => {
                const active = localTags.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => editing && toggleTag(tag)}
                    disabled={!editing}
                    className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
                      active
                        ? "bg-violet-500/15 border border-violet-500/30 text-violet-400"
                        : editing
                        ? "bg-stone-800 border border-stone-700 text-stone-500 hover:text-stone-300 cursor-pointer"
                        : "bg-stone-900 border border-stone-800 text-stone-700 cursor-default"
                    }`}
                  >
                    {TAG_LABELS[tag]}
                  </button>
                );
              })}
            </div>
            {editing && (
              <p className="text-[10px] font-mono text-stone-700 mt-2">Click tags to toggle. Save to apply.</p>
            )}
          </div>

          {/* Artwork */}
          <div>
            <p className="text-[10px] font-mono text-stone-600 uppercase tracking-wider mb-3">Artwork</p>
            <ImageUpload
              currentUrl={track.artwork_url}
              onFile={(file) => artworkMutation.mutateAsync(file)}
              label="Upload artwork"
              size="lg"
              shape="square"
            />
            {artworkMutation.isError && (
              <p className="text-xs font-mono text-red-400 mt-1">Artwork upload failed</p>
            )}
          </div>

          {/* Audio + storage */}
          <div>
            <p className="text-[10px] font-mono text-stone-600 uppercase tracking-wider mb-2">Audio</p>
            <div className="bg-stone-900/60 rounded-lg px-3">
              <Field label="Duration"  value={track.duration_seconds != null ? `${Math.floor(track.duration_seconds / 60)}m ${Math.round(track.duration_seconds % 60)}s` : null} name="" editing={false} onChange={() => {}} />
              <Field label="File size" value={track.file_size_bytes ? `${(track.file_size_bytes / 1_000_000).toFixed(2)} MB` : null} name="" editing={false} onChange={() => {}} />
              <div className="flex items-start gap-3 py-2">
                <span className="text-xs font-mono text-stone-600 w-28 flex-shrink-0 pt-1">R2 Key</span>
                <span className="text-[10px] font-mono text-stone-600 flex-1 break-all pt-1">{track.r2_key_raw}</span>
              </div>
            </div>
          </div>

          {/* Engagement */}
          <div>
            <p className="text-[10px] font-mono text-stone-600 uppercase tracking-wider mb-2">Engagement</p>
            <div className="bg-stone-900/60 rounded-lg px-3">
              <Field label="Streams" value={formatCount(track.stream_count)} name="" editing={false} onChange={() => {}} />
              <Field label="Likes"   value={formatCount(track.like_count)}   name="" editing={false} onChange={() => {}} />
            </div>
          </div>

          {/* Review reasons */}
          {track.review_reasons && track.review_reasons.length > 0 && (
            <div>
              <p className="text-[10px] font-mono text-stone-600 uppercase tracking-wider mb-2">Review Reasons</p>
              <div className="bg-stone-900/60 rounded-lg px-3 py-2 space-y-1">
                {track.review_reasons.map((r, i) => (
                  <p key={i} className="text-xs font-body text-violet-400">{r}</p>
                ))}
              </div>
            </div>
          )}

          {/* System */}
          <div>
            <p className="text-[10px] font-mono text-stone-600 uppercase tracking-wider mb-2">System</p>
            <div className="bg-stone-900/60 rounded-lg px-3">
              <Field label="Metadata v" value={String(track.metadata_version)} name="" editing={false} onChange={() => {}} />
              <Field label="Created"    value={track.created_at ? new Date(track.created_at).toLocaleString() : null} name="" editing={false} onChange={() => {}} />
              <Field label="Updated"    value={track.updated_at ? new Date(track.updated_at).toLocaleString() : null} name="" editing={false} onChange={() => {}} />
            </div>
          </div>

          {/* Danger zone */}
          <div className="pt-2 border-t border-stone-800/60">
            <p className="text-[10px] font-mono text-stone-600 uppercase tracking-wider mb-3">Danger zone</p>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-red-500/20 bg-red-500/5 text-red-500 text-xs font-mono hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete track
              </button>
            ) : (
              <div className="flex items-center gap-2 p-3 rounded-md bg-red-500/10 border border-red-500/25">
                <p className="text-xs font-mono text-red-400 flex-1">
                  This will soft-delete the track. It can be recovered by an admin.
                </p>
                <button
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleteMutation.isPending}
                  className="text-xs font-mono text-stone-500 hover:text-stone-300 px-2 py-1 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  className="flex items-center gap-1 text-xs font-mono px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
                >
                  {deleteMutation.isPending
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : <Trash2 className="w-3 h-3" />}
                  Confirm delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
