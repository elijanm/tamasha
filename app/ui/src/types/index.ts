// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PagedResponse<T> {
  items: T[];
  total: number;
  skip: number;
  limit: number;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export type Role = "superadmin" | "admin" | "staff" | "artist" | "listener";

export interface UserProfile {
  full_name?: string;
  avatar_url?: string;
  bio?: string;
}

export interface User {
  id: string;
  email: string;
  username: string;
  role: Role;
  is_active: boolean;
  is_verified: boolean;
  profile?: UserProfile;
  artist_id?: string | null;
  created_at: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
}

// ─── Tracks ───────────────────────────────────────────────────────────────────

export type TrackStatus = "pending" | "processing" | "ready" | "failed";

export type WorkflowTag =
  | "duplicate_review"
  | "already_worked_on"
  | "already_in_database"
  | "needs_compression"
  | "orchard_source"
  | "wav_source"
  | "tamasha_owned"
  | "signed_artist"
  | "catalogue_number_only"
  | "missing_metadata"
  | "metadata_review"
  | "poor_quality";

export interface TrackExtendedMeta {
  isrc?: string | null;
  label?: string | null;
  composer?: string | null;
  publisher?: string | null;
  copyright?: string | null;
  featuring?: string | null;
  band?: string | null;
  producer?: string | null;
  remixer?: string | null;
  bpm?: number | null;
  musical_key?: string | null;
  mood?: string | null;
  version?: string | null;
  release_date?: string | null;
  track_number?: number | null;
  disc_number?: number | null;
  upc?: string | null;
  catalogue_number?: string | null;
  explicit?: boolean;
}

export interface Track extends TrackExtendedMeta {
  id: string;
  r2_key_raw: string;
  r2_keys_transcoded: Record<string, string>;
  title: string;
  album: string | null;
  artist_id: string | null;
  artist_name: string | null;
  artist_name_raw: string | null;
  year: number | null;
  genre: string | null;
  language: string | null;
  duration_seconds: number | null;
  status: TrackStatus;
  workflow_tags: WorkflowTag[];
  needs_human_review: boolean;
  review_reasons: string[];
  inferred_metadata: Record<string, unknown> | null;
  metadata_version: number;
  file_size_bytes: number;
  sha256: string;
  stream_count: number;
  like_count: number;
  artwork_r2_key: string | null;
  artwork_url: string | null;
  quality_score: number | null;
  quality_breakdown: QualityBreakdown | null;
  created_at: string;
  updated_at: string;
}

export interface StreamUrlResponse {
  url: string;
  bitrate: string;
  available_bitrates: string[];
  r2_key: string;
  expires_in: number;
}

export interface TrackUpdateRequest extends TrackExtendedMeta {
  title?: string;
  album?: string | null;
  year?: number | null;
  genre?: string | null;
  language?: string | null;
  tags?: WorkflowTag[];
  status?: TrackStatus;
  workflow_tags?: WorkflowTag[];
  needs_human_review?: boolean;
}

export interface TrackCreatePayload extends TrackExtendedMeta {
  title: string;
  r2_key_raw: string;
  album?: string | null;
  year?: number | null;
  genre?: string | null;
  language?: string | null;
  duration_seconds?: number | null;
  artist_id?: string | null;
  file_size_bytes?: number;
  sha256?: string | null;
  md5?: string | null;
  artwork_r2_key?: string | null;
  tags?: string[];
}

export interface UploadedTrackMeta {
  r2_key_raw: string;
  file_size_bytes: number;
  sha256: string;
  md5: string;
  duration_seconds: number | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  track_number: number | null;
  original_filename: string;
  artwork_r2_key: string | null;
  artwork_url: string | null;
}

export interface UploadAlbumResponse {
  tracks: UploadedTrackMeta[];
  count: number;
}

export interface TracksListParams {
  limit?: number;
  skip?: number;
  artist_id?: string;
  status?: TrackStatus;
  genre?: string;
  no_artist?: boolean;
  workflow_tag?: string;
  needs_review?: boolean;
  search?: string;
}

export type SkizaStatus =
  | "draft" | "pending_review" | "approved" | "rejected"
  | "exporting" | "exported" | "submitted" | "accepted" | "failed";

export interface SkizaClip {
  id: string;
  track_id: string;
  title: string;
  start_seconds: number;
  end_seconds: number;
  notes: string;
  status: SkizaStatus;
  created_at: string;
  updated_at: string;
}

// ─── Artists ──────────────────────────────────────────────────────────────────

export interface Artist {
  id: string;
  slug: string;
  display_name: string;
  bio: string | null;
  image_url: string | null;
  country: string | null;
  genres: string[];
  status: "pending" | "approved" | "rejected";
  is_band: boolean;
  track_count: number;
  auto_created: boolean;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateArtistRequest {
  display_name: string;
  bio?: string;
  genres?: string[];
  country?: string;
  image_url?: string;
  is_band?: boolean;
}

export interface UpdateArtistRequest {
  display_name?: string;
  bio?: string | null;
  genres?: string[];
  country?: string | null;
  image_url?: string | null;
  is_band?: boolean;
  status?: "pending" | "approved" | "rejected";
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface TopTrackItem {
  track_id: string;
  title: string;
  stream_count: number;
  like_count: number;
}

export interface GenreItem {
  genre: string;
  count: number;
}

export interface StreamTrendPoint {
  date: string;
  count: number;
}

export interface BandwidthTrendPoint {
  date: string;
  bytes: number;
}

export interface DashboardAnalytics {
  total_tracks: number;
  total_artists: number;
  total_listeners: number;
  total_streams_today: number;
  total_streams_week: number;
  needs_review_count: number;
  top_tracks: TopTrackItem[];
  top_liked: TopTrackItem[];
  tracks_by_status: Record<string, number>;
  ownership_breakdown: Record<string, number>;
  genres: GenreItem[];
  stream_trend: StreamTrendPoint[];
  storage_used_gb: number;
  active_jobs: number;
  bytes_streamed_today: number;
  bytes_streamed_week: number;
  bytes_streamed_30d: number;
  bandwidth_trend: BandwidthTrendPoint[];
}

export interface ArtistAnalytics {
  artist_id: string;
  monthly_listeners: number;
  total_streams: number;
  total_likes: number;
  top_tracks: Array<{ track_id: string; title: string; stream_count: number; like_count: number }>;
  listener_geography: Array<{ country: string; count: number }>;
}

export interface TrackAnalytics {
  track_id: string;
  stream_count: number;
  like_count: number;
  streams_by_day: Array<{ date: string; count: number }>;
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export interface HealthStatus {
  status: "ok" | "degraded" | "down";
  db_connected: boolean;
  redis_connected: boolean;
  worker_count: number;
  queue_depths: Record<string, number>;
}

export interface QueueInfo {
  depth: number;
  active_tasks: number;
  scheduled_tasks: number;
}

export interface QueueHealth {
  queues: Record<string, QueueInfo>;
}

export interface StoragePrefixBreakdown {
  prefix: string;
  object_count: number;
  size_bytes: number;
}

export interface StorageMetrics {
  total_objects: number;
  total_bytes: number;
  total_gb: number;
  breakdown: StoragePrefixBreakdown[];
}

// ─── Sync Jobs ────────────────────────────────────────────────────────────────

export type SyncJobMode =
  | "incremental" | "metadata_reconciliation" | "full_scan" | "integrity_scan"
  | "pool_all" | "batch_enrich_metadata" | "dedup_scan";

export type SyncJobStatus = "queued" | "running" | "complete" | "failed" | "cancelled";

export interface SyncJobError {
  key: string;
  message: string;
}

export interface SyncJob {
  id: string;
  mode: SyncJobMode;
  triggered_by: string | null;
  status: SyncJobStatus;
  celery_task_id: string | null;
  objects_scanned: number;
  objects_new: number;
  objects_updated: number;
  objects_orphaned: number;
  errors: SyncJobError[];
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────

export interface AuditLog {
  id: string;
  actor_id: string | null;
  actor_role: string;
  actor_ip: string;
  actor_ua: string;
  action: string;
  entity_type: string;
  entity_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  request_id: string;
  occurred_at: string;
}

// ─── Media Monitoring ─────────────────────────────────────────────────────────

export interface RadioStation {
  id: string;
  name: string;
  frequency: string | null;
  country: string;
  region: string | null;
  royalty_rate: number;
  is_active: boolean;
  created_at: string;
}

export interface RadioStationCreate {
  name: string;
  frequency?: string;
  country?: string;
  region?: string;
  royalty_rate?: number;
}

export interface RadioStationUpdate {
  name?: string;
  frequency?: string;
  country?: string;
  region?: string;
  royalty_rate?: number;
  is_active?: boolean;
}

export interface AirplayLog {
  id: string;
  track_id: string;
  track_title: string | null;
  station_id: string;
  station_name: string | null;
  played_at: string;
  duration_seconds: number;
  revenue: number;
  notes: string | null;
  logged_by: string | null;
  created_at: string;
}

export interface AirplayLogCreate {
  track_id: string;
  station_id: string;
  played_at: string;
  duration_seconds?: number;
  notes?: string;
}

export interface TrackAirplaySummary {
  track_id: string;
  title: string;
  total_plays: number;
  total_duration_seconds: number;
  total_revenue: number;
}

export interface StationRevenueSummary {
  station_id: string;
  station_name: string;
  total_plays: number;
  total_revenue: number;
}

export interface AirplayTrendPoint {
  date: string;
  plays: number;
  revenue: number;
}

export interface MonitoringDashboard {
  total_airplays: number;
  total_duration_seconds: number;
  total_revenue: number;
  active_stations: number;
  top_tracks: TrackAirplaySummary[];
  revenue_by_station: StationRevenueSummary[];
  airplay_trend: AirplayTrendPoint[];
}

// ─── Duplicates ───────────────────────────────────────────────────────────────

export interface QualityBreakdown {
  format_score: number;
  bitrate_score: number;
  duration_score: number;
  metadata_score: number;
  size_score: number;
  total: number;
}

export interface DuplicateTrackEntry {
  track: Track;
  quality_score: number;
  quality_breakdown: QualityBreakdown;
  stream_url: string | null;
}

export interface DuplicateGroup {
  id: string;
  detection_method: "sha256" | "fingerprint" | "md5_size" | "metadata";
  confidence: number;
  track_count: number;
  canonical_track_id: string | null;
  representative_title: string | null;
  status: "pending_review" | "resolved";
  bytes_freed: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DuplicateGroupDetail extends DuplicateGroup {
  tracks: DuplicateTrackEntry[];
}

export interface DuplicateMetrics {
  total_groups: number;
  pending_groups: number;
  resolved_groups: number;
  reclaimable_files: number;
  reclaimable_bytes: number;
  bytes_already_freed: number;
  detection_breakdown: Record<string, number>;
}

// ─── Billing ──────────────────────────────────────────────────────────────────

export interface PlatformCostConfig {
  id: string;
  monthly_amount_usd: number;
  description: string;
  is_active: boolean;
  reminder_days: number[];
  created_at: string;
}

export interface Invoice {
  id: string;
  period_month: number;
  period_year: number;
  period_label: string;
  amount_usd: number;
  paid_amount_usd: number;
  balance_usd: number;
  status: "pending" | "overdue" | "suspended" | "data_available" | "deleted" | "paid" | "partial";
  due_date: string;
  paid_at: string | null;
  notes: string | null;
  data_export_r2_key: string | null;
  data_export_expires_at: string | null;
  days_overdue: number;
  created_at: string;
  updated_at: string;
}

export interface PaymentArrangement {
  id: string;
  invoice_id: string;
  installments: number;
  amounts_usd: number[];
  due_dates: string[];
  total_usd: number;
  status: string;
  created_at: string;
}

export type BillingPhase = "none" | "grace" | "warning" | "data_available" | "deleted";

export interface BillingGateStatus {
  is_gated: boolean;
  phase: BillingPhase;
  gate_message: string;
  current_invoice: Invoice | null;
  grace_days_remaining: number | null;
  deletion_days_remaining: number | null;
  download_days_remaining: number | null;
  data_export_url: string | null;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  skip: number;
}

export interface ListParams {
  limit?: number;
  skip?: number;
  [key: string]: unknown;
}
