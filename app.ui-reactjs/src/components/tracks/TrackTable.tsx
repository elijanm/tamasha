import { Link } from "react-router-dom";
import { AlertCircle, Music2, ChevronRight } from "lucide-react";
import { WorkflowTagList } from "./WorkflowTagBadge";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFileSize, formatRelativeTime, truncate } from "@/utils/format";
import type { Track } from "@/types";

const STATUS_STYLES = {
  pending:    "bg-stone-700/50 text-stone-400",
  processing: "bg-violet-500/20 text-violet-400",
  ready:      "bg-emerald-500/20 text-emerald-400",
  failed:     "bg-red-500/20 text-red-400",
};

interface TrackTableProps {
  tracks: Track[];
  isLoading?: boolean;
  editLinkBase?: string;
  showReviewFlag?: boolean;
}

export function TrackTable({
  tracks,
  isLoading,
  editLinkBase = "/staff/tracks",
  showReviewFlag = false,
}: TrackTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
    );
  }

  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-stone-600">
        <Music2 className="h-10 w-10 mb-3 opacity-40" />
        <p className="font-body text-sm">No tracks found</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-stone-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-800 bg-stone-900/80">
            <th className="text-left px-4 py-3 font-display font-semibold text-stone-400 text-xs uppercase tracking-wider">Track</th>
            <th className="text-left px-4 py-3 font-display font-semibold text-stone-400 text-xs uppercase tracking-wider">Status</th>
            <th className="text-left px-4 py-3 font-display font-semibold text-stone-400 text-xs uppercase tracking-wider hidden md:table-cell">Tags</th>
            <th className="text-left px-4 py-3 font-display font-semibold text-stone-400 text-xs uppercase tracking-wider hidden lg:table-cell">Size</th>
            <th className="text-left px-4 py-3 font-display font-semibold text-stone-400 text-xs uppercase tracking-wider hidden lg:table-cell">Added</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-800/50">
          {tracks.map((track) => (
            <tr
              key={track.id}
              className="group hover:bg-stone-800/40 transition-colors duration-100"
            >
              <td className="px-4 py-3.5">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded bg-stone-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Music2 className="w-3.5 h-3.5 text-stone-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-display font-medium text-stone-200 truncate max-w-xs">
                      {truncate(track.title || track.r2_key_raw.split("/").pop() || "Untitled", 48)}
                    </p>
                    <p className="text-xs font-mono text-stone-600 truncate max-w-xs">
                      {truncate(track.r2_key_raw, 50)}
                    </p>
                  </div>
                  {showReviewFlag && track.needs_human_review && (
                    <AlertCircle className="h-4 w-4 text-violet-500 flex-shrink-0 mt-1" />
                  )}
                </div>
              </td>
              <td className="px-4 py-3.5">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-mono ${STATUS_STYLES[track.status]}`}>
                  {track.status}
                </span>
              </td>
              <td className="px-4 py-3.5 hidden md:table-cell">
                {track.workflow_tags.length > 0 ? (
                  <WorkflowTagList tags={track.workflow_tags} max={2} />
                ) : (
                  <span className="text-stone-700 text-xs">—</span>
                )}
              </td>
              <td className="px-4 py-3.5 hidden lg:table-cell">
                <span className="font-mono text-xs text-stone-500">
                  {formatFileSize(track.file_size_bytes)}
                </span>
              </td>
              <td className="px-4 py-3.5 hidden lg:table-cell">
                <span className="text-xs text-stone-600">
                  {formatRelativeTime(track.created_at)}
                </span>
              </td>
              <td className="px-4 py-3.5">
                <Link
                  to={`${editLinkBase}/${track.id}`}
                  className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-violet-400 transition-colors group-hover:text-stone-400"
                >
                  Edit
                  <ChevronRight className="h-3 w-3" />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TrackTableSkeleton() {
  return (
    <div className="overflow-x-auto rounded-lg border border-stone-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-800 bg-stone-900/80">
            {["Track", "Status", "Tags", "Size", "Added", ""].map((h, i) => (
              <th key={i} className="text-left px-4 py-3">
                <span className="text-xs font-display text-stone-400 uppercase tracking-wider">{h}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-800/50">
          {Array.from({ length: 6 }).map((_, i) => (
            <tr key={i}>
              <td className="px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <Skeleton className="w-8 h-8 rounded flex-shrink-0" />
                  <div className="space-y-2">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </div>
              </td>
              <td className="px-4 py-3.5"><Skeleton className="h-5 w-20" /></td>
              <td className="px-4 py-3.5 hidden md:table-cell"><Skeleton className="h-5 w-32" /></td>
              <td className="px-4 py-3.5 hidden lg:table-cell"><Skeleton className="h-3 w-14" /></td>
              <td className="px-4 py-3.5 hidden lg:table-cell"><Skeleton className="h-3 w-16" /></td>
              <td className="px-4 py-3.5"><Skeleton className="h-3 w-8" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
