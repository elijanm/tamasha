import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, Music2, CheckCircle, Clock, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { tracksApi } from "@/api/tracks";
import { TrackTable } from "@/components/tracks/TrackTable";
import { formatCount } from "@/utils/format";

export function StaffDashboard() {
  const { data: reviewData, isLoading: reviewLoading } = useQuery({
    queryKey: ["tracks", "review-queue", { limit: 5 }],
    queryFn: () => tracksApi.getReviewQueue({ limit: 5 }),
  });
  const reviewQueue = reviewData?.items ?? [];
  const reviewTotal = reviewData?.total ?? 0;

  const { data: allTracks, isLoading: tracksLoading } = useQuery({
    queryKey: ["tracks", { limit: 1, skip: 0 }],
    queryFn: () => tracksApi.list({ limit: 1 }),
  });

  const { data: readyTracks } = useQuery({
    queryKey: ["tracks", { status: "ready", limit: 1 }],
    queryFn: () => tracksApi.list({ status: "ready", limit: 1 }),
  });

  const { data: pendingTracks } = useQuery({
    queryKey: ["tracks", { status: "pending", limit: 1 }],
    queryFn: () => tracksApi.list({ status: "pending", limit: 1 }),
  });

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="font-display text-2xl font-bold text-stone-100">Staff Dashboard</h1>
        <p className="mt-1 text-sm font-body text-stone-500">
          Archive operations and track metadata management
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          {
            label: "Needs Review",
            value: reviewTotal,
            icon: AlertTriangle,
            color: "text-violet-400",
            bg: "bg-violet-500/10",
          },
          {
            label: "Pending",
            value: pendingTracks?.total ?? 0,
            icon: Clock,
            color: "text-stone-400",
            bg: "bg-stone-800",
          },
          {
            label: "Ready",
            value: readyTracks?.total ?? 0,
            icon: CheckCircle,
            color: "text-emerald-400",
            bg: "bg-emerald-500/10",
          },
          {
            label: "Total",
            value: allTracks?.total ?? 0,
            icon: Music2,
            color: "text-blue-400",
            bg: "bg-blue-500/10",
          },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <Card key={label} className="p-4 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${bg}`}>
              <Icon className={`w-4 h-4 ${color}`} />
            </div>
            <div>
              <p className="text-xs font-mono text-stone-500">{label}</p>
              {tracksLoading || reviewLoading ? (
                <Skeleton className="h-6 w-12 mt-1" />
              ) : (
                <p className={`text-xl font-display font-bold ${color}`}>{formatCount(value)}</p>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* Review Queue Preview */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-mono font-semibold text-stone-600 uppercase tracking-widest">
            Review Queue
            {reviewTotal > 0 && (
              <span className="ml-2 px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-400 text-xs">
                {reviewTotal}
              </span>
            )}
          </h2>
          <Button asChild variant="ghost" size="sm" className="text-xs">
            <Link to="/staff/queue">
              View all <ArrowRight className="h-3 w-3 ml-1" />
            </Link>
          </Button>
        </div>
        <TrackTable
          tracks={reviewQueue ?? []}
          isLoading={reviewLoading}
          showReviewFlag
          editLinkBase="/staff/tracks"
        />
      </div>
    </div>
  );
}
