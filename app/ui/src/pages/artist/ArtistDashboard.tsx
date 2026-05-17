import { useQuery } from "@tanstack/react-query";
import { Music2, Play, Heart, TrendingUp } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { analyticsApi } from "@/api/analytics";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/context/ThemeContext";
import { formatCount } from "@/utils/format";

export function ArtistDashboard() {
  const { theme } = useTheme();
  const isSimple = theme === "simple";
  const chartColors = {
    grid:         isSimple ? "#e7e5e4" : "#292524",
    tick:         isSimple ? "#78716c" : "#57534e",
    tooltipBg:    isSimple ? "#ffffff" : "#1c1917",
    tooltipBorder:isSimple ? "#d6d3d1" : "#292524",
    tooltipText:  isSimple ? "#1c1917" : "#d6d3d1",
    accent:       isSimple ? "#c41e2a" : "#f59e0b",
  };

  const { user } = useAuth();
  const artistId = user?.artist_id;

  const { data: analytics, isLoading } = useQuery({
    queryKey: ["artist-analytics", artistId],
    queryFn: () => analyticsApi.artist(artistId!),
    enabled: !!artistId,
  });

  if (!artistId) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-stone-600 space-y-2">
        <Music2 className="w-10 h-10 opacity-30" />
        <p className="font-body text-sm">No artist profile linked to your account</p>
        <p className="font-body text-xs text-stone-700">Contact staff to link your profile</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="font-display text-2xl font-bold text-stone-100">Artist Dashboard</h1>
        <p className="mt-1 text-sm font-body text-stone-500">
          Your tracks and performance analytics
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Tracks", value: analytics?.total_tracks, icon: Music2, color: "text-violet-400" },
          { label: "Total Streams", value: analytics?.total_streams, icon: Play, color: "text-blue-400" },
          { label: "Total Likes", value: analytics?.total_likes, icon: Heart, color: "text-red-400" },
          { label: "Top Track Streams", value: analytics?.top_tracks?.[0]?.streams, icon: TrendingUp, color: "text-emerald-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`w-3.5 h-3.5 ${color}`} />
              <p className="text-xs font-mono text-stone-500">{label}</p>
            </div>
            {isLoading ? (
              <Skeleton className="h-7 w-20 mt-1" />
            ) : (
              <p className={`text-2xl font-display font-bold ${color}`}>
                {value !== undefined ? formatCount(value) : "—"}
              </p>
            )}
          </Card>
        ))}
      </div>

      {/* Streams chart */}
      {analytics?.streams_by_month && analytics.streams_by_month.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Monthly Streams</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={analytics.streams_by_month}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: chartColors.tick, fontSize: 11, fontFamily: "JetBrains Mono" }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: chartColors.tick, fontSize: 11, fontFamily: "JetBrains Mono" }}
                />
                <Tooltip
                  contentStyle={{
                    background: chartColors.tooltipBg,
                    border: `1px solid ${chartColors.tooltipBorder}`,
                    borderRadius: 6,
                    fontFamily: "DM Sans",
                    fontSize: 12,
                    color: chartColors.tooltipText,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke={chartColors.accent}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: chartColors.accent }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Top Tracks */}
      {analytics?.top_tracks && analytics.top_tracks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Top Tracks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {analytics.top_tracks.map((track, i) => (
              <div key={track.track_id} className="flex items-center gap-3">
                <span className="w-6 text-xs font-mono text-stone-600 text-right">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-body text-stone-300 truncate">{track.title}</p>
                </div>
                <div className="flex items-center gap-1 text-xs font-mono text-stone-500">
                  <Play className="w-3 h-3" />
                  {formatCount(track.streams)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}
    </div>
  );
}
