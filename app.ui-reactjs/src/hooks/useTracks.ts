import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { tracksApi } from "@/api/tracks";
import type { TracksListParams, TrackUpdateRequest } from "@/types";

export const TRACKS_KEY = "tracks";

export function useTracks(params: TracksListParams = {}) {
  return useQuery({
    queryKey: [TRACKS_KEY, params],
    queryFn: () => tracksApi.list(params),
  });
}

export function useTrack(id: string) {
  return useQuery({
    queryKey: [TRACKS_KEY, id],
    queryFn: () => tracksApi.get(id),
    enabled: !!id,
  });
}

export function useReviewQueue(params: { limit?: number; skip?: number } = {}) {
  return useQuery({
    queryKey: [TRACKS_KEY, "review-queue", params],
    queryFn: () => tracksApi.getReviewQueue(params),
  });
}

export function useUpdateTrack() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: TrackUpdateRequest }) =>
      tracksApi.update(id, data),
    onSuccess: (updatedTrack) => {
      queryClient.invalidateQueries({ queryKey: [TRACKS_KEY] });
      queryClient.setQueryData([TRACKS_KEY, updatedTrack.id], updatedTrack);
    },
  });
}
