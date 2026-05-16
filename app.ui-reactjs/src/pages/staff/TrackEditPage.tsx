import { useState, useEffect, type FormEvent } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, Save, Loader2, AlertCircle, ChevronRight } from "lucide-react";
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
import { toast } from "@/hooks/useToast";
import { formatFileSize, formatDate, truncate } from "@/utils/format";
import type { WorkflowTag } from "@/types";

const WORKFLOW_TAGS: WorkflowTag[] = [
  "duplicate_review", "already_worked_on", "already_in_database",
  "needs_compression", "orchard_source", "wav_source", "tamasha_owned",
  "signed_artist", "catalogue_number_only", "missing_metadata", "metadata_review",
];

const GENRES = [
  "Afrobeats", "Bongo Flava", "Genge", "Gospel", "Hip Hop", "Jazz",
  "Kapuka", "Mugithi", "Ohangla", "Rhumba", "Reggae", "R&B",
  "Taarab", "Traditional", "Other",
];

const LANGUAGES = [
  "Swahili", "English", "Sheng", "Kikuyu", "Luo", "Kamba",
  "Luhya", "Kalenjin", "Somali", "Other",
];

export function TrackEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: track, isLoading } = useTrack(id!);
  const { mutate: updateTrack, isPending } = useUpdateTrack();

  const [title, setTitle] = useState("");
  const [album, setAlbum] = useState("");
  const [year, setYear] = useState("");
  const [genre, setGenre] = useState("");
  const [language, setLanguage] = useState("");
  const [selectedTags, setSelectedTags] = useState<WorkflowTag[]>([]);

  // Populate form when track loads
  useEffect(() => {
    if (track) {
      setTitle(track.title ?? "");
      setAlbum(track.album ?? "");
      setYear(track.year?.toString() ?? "");
      setGenre(track.genre ?? "");
      setLanguage(track.language ?? "");
      setSelectedTags(track.workflow_tags ?? []);
    }
  }, [track]);

  const toggleTag = (tag: WorkflowTag) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    updateTrack(
      {
        id: id!,
        data: {
          title: title || undefined,
          album: album || null,
          year: year ? parseInt(year, 10) : null,
          genre: genre || null,
          language: language || null,
          tags: selectedTags,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Track updated", variant: "success" });
        },
        onError: () => {
          toast({ title: "Failed to save", variant: "destructive" });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-5 animate-fadeIn">
        <Skeleton className="h-8 w-64" />
        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-48 w-full" />
          </div>
          <div>
            <Skeleton className="h-48 w-full" />
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

  // Parse inferred metadata confidence scores
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

      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-stone-100">
            {track.title || "Untitled Track"}
          </h1>
          <p className="mt-1 text-xs font-mono text-stone-600 break-all">{track.r2_key_raw}</p>
        </div>
        {track.needs_human_review && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-violet-500/10 border border-violet-500/20">
            <AlertCircle className="w-3.5 h-3.5 text-violet-500" />
            <span className="text-xs font-mono text-violet-400">Needs Review</span>
          </div>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        {/* Main form */}
        <div className="lg:col-span-2">
          <form onSubmit={handleSubmit}>
            <Card>
              <CardHeader>
                <CardTitle>Metadata</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2 space-y-1.5">
                    <Label htmlFor="title">Title</Label>
                    <Input
                      id="title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Track title"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="album">Album</Label>
                    <Input
                      id="album"
                      value={album}
                      onChange={(e) => setAlbum(e.target.value)}
                      placeholder="Album name"
                    />
                  </div>

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

                  <div className="space-y-1.5">
                    <Label>Genre</Label>
                    <Select value={genre} onValueChange={setGenre}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select genre" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {GENRES.map((g) => (
                          <SelectItem key={g} value={g}>{g}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Language</Label>
                    <Select value={language} onValueChange={setLanguage}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select language" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
                        {LANGUAGES.map((l) => (
                          <SelectItem key={l} value={l}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Workflow tags */}
                <div className="space-y-2 pt-2 border-t border-stone-800">
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

                {/* Review reasons */}
                {track.review_reasons.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-stone-800">
                    <Label className="text-stone-500">Review Reasons</Label>
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

                <div className="flex items-center justify-between pt-3 border-t border-stone-800">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => navigate(-1)}
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </Button>
                  <Button type="submit" disabled={isPending}>
                    {isPending ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
                    ) : (
                      <><Save className="h-4 w-4" /> Save Changes</>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </form>
        </div>

        {/* Sidebar: file info + inferred metadata */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">File Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: "Size", value: formatFileSize(track.file_size_bytes) },
                { label: "Status", value: track.status },
                { label: "Version", value: `v${track.metadata_version}` },
                { label: "Streams", value: track.stream_count.toString() },
                { label: "Added", value: formatDate(track.created_at) },
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
                      <span className="text-xs font-mono text-stone-400">{Math.round((value as number) * 100)}%</span>
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
    </div>
  );
}
