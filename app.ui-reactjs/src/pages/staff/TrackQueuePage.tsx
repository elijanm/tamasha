import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Filter, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { TrackTable } from "@/components/tracks/TrackTable";
import { tracksApi } from "@/api/tracks";
import type { WorkflowTag } from "@/types";

const ALL_TAGS: WorkflowTag[] = [
  "duplicate_review", "already_worked_on", "already_in_database",
  "needs_compression", "orchard_source", "wav_source", "tamasha_owned",
  "signed_artist", "catalogue_number_only", "missing_metadata", "metadata_review",
];

const TAG_LABELS: Record<WorkflowTag, string> = {
  duplicate_review:       "Duplicate Review",
  already_worked_on:      "Already Worked On",
  already_in_database:    "Already In Database",
  needs_compression:      "Needs Compression",
  orchard_source:         "Orchard Source",
  wav_source:             "WAV Source",
  tamasha_owned:          "Tamasha Owned",
  signed_artist:          "Signed Artist",
  catalogue_number_only:  "Catalogue # Only",
  missing_metadata:       "Missing Metadata",
  metadata_review:        "Metadata Review",
};

const PAGE_SIZE = 20;

export function TrackQueuePage() {
  const [skip, setSkip] = useState(0);
  const [tagFilter, setTagFilter] = useState<string>("all");

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["tracks", "review-queue", { skip, tagFilter }],
    queryFn: () => tracksApi.getReviewQueue({ limit: PAGE_SIZE, skip }),
  });
  const tracks = data?.items ?? [];
  const total = data?.total ?? 0;

  const filtered = tagFilter === "all"
    ? tracks
    : tracks.filter((t) => t.workflow_tags.includes(tagFilter as WorkflowTag));

  return (
    <div className="space-y-5 animate-fadeIn">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-stone-100">Review Queue</h1>
          <p className="mt-1 text-sm font-body text-stone-500">
            Tracks flagged for human review
            {filtered.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-400 text-xs font-mono">
                {filtered.length}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Filter className="w-3.5 h-3.5 text-stone-500" />
            <Select value={tagFilter} onValueChange={setTagFilter}>
              <SelectTrigger className="w-48 h-8 text-xs">
                <SelectValue placeholder="Filter by tag" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tags</SelectItem>
                {ALL_TAGS.map((tag) => (
                  <SelectItem key={tag} value={tag}>{TAG_LABELS[tag]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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

      <TrackTable
        tracks={filtered}
        isLoading={isLoading}
        showReviewFlag
        editLinkBase="/staff/tracks"
      />

      {/* Pagination */}
      {!isLoading && total > 0 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs font-mono text-stone-600">
            Showing {skip + 1}–{Math.min(skip + PAGE_SIZE, total)} of {total}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}
              disabled={skip === 0}
              className="h-7 text-xs"
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSkip(skip + PAGE_SIZE)}
              disabled={skip + PAGE_SIZE >= total}
              className="h-7 text-xs"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
