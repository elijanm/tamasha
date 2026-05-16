import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "@/context/ThemeContext";
import { AuthLayout } from "@/layouts/AuthLayout";
import { DashboardLayout } from "@/layouts/DashboardLayout";
import { SettingsLayout } from "@/layouts/SettingsLayout";
import { LoginPage } from "@/pages/auth/LoginPage";
import { RegisterPage } from "@/pages/auth/RegisterPage";
import { AdminDashboard } from "@/pages/admin/AdminDashboard";
import { UsersPage } from "@/pages/admin/UsersPage";
import { AuditLogsPage } from "@/pages/admin/AuditLogsPage";
import { CataloguePage } from "@/pages/admin/CataloguePage";
import { ArtistsPage } from "@/pages/admin/ArtistsPage";
import { ArtistDetailPage } from "@/pages/admin/ArtistDetailPage";
import { SkizaPage } from "@/pages/admin/SkizaPage";
import { SettingsPage } from "@/pages/admin/SettingsPage";
import { MediaMonitoringPage } from "@/pages/admin/MediaMonitoringPage";
import { ThemesPage } from "@/pages/admin/settings/ThemesPage";
import { DuplicatesPage } from "@/pages/admin/settings/DuplicatesPage";
import { StaffDashboard } from "@/pages/staff/StaffDashboard";
import { TrackQueuePage } from "@/pages/staff/TrackQueuePage";
import { TrackEditPage } from "@/pages/staff/TrackEditPage";
import { ArtistDashboard } from "@/pages/artist/ArtistDashboard";
import { ListenerHome } from "@/pages/listener/ListenerHome";
import { BillingDashboard } from "@/pages/superadmin/BillingDashboard";
import { Toaster } from "@/components/ui/toaster";
import { useAuth } from "@/hooks/useAuth";
import type { Role } from "@/types";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

const ROLE_REDIRECTS: Record<Role, string> = {
  superadmin: "/superadmin/billing",
  admin: "/admin",
  staff: "/staff",
  artist: "/artist",
  listener: "/listener",
};

function RootRedirect() {
  const { isAuthenticated, role } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Navigate to={role ? (ROLE_REDIRECTS[role] ?? "/login") : "/login"} replace />;
}

function UnauthorizedPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-stone-950 text-stone-600">
      <p className="font-display text-6xl font-bold text-stone-800 mb-4">403</p>
      <p className="font-body text-sm">You don&apos;t have access to this page</p>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />

      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route element={<DashboardLayout requiredRole="admin" />}>
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/users" element={<UsersPage />} />
        <Route path="/admin/audit-logs" element={<AuditLogsPage />} />
        <Route path="/admin/catalogue" element={<CataloguePage />} />
        <Route path="/admin/artists" element={<ArtistsPage />} />
        <Route path="/admin/artists/:id" element={<ArtistDetailPage />} />
        <Route path="/admin/skiza" element={<SkizaPage />} />
        <Route path="/admin/browse" element={<ListenerHome statusFilter={null} />} />
        <Route path="/admin/settings" element={<SettingsLayout />}>
          <Route index element={<SettingsPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="audit-log" element={<AuditLogsPage />} />
          <Route path="themes" element={<ThemesPage />} />
          <Route path="duplicates" element={<DuplicatesPage />} />
        </Route>
        <Route path="/admin/media-monitoring" element={<MediaMonitoringPage />} />
      </Route>

      <Route element={<DashboardLayout requiredRole={["staff", "admin"] as Role[]} />}>
        <Route path="/staff" element={<StaffDashboard />} />
        <Route path="/staff/queue" element={<TrackQueuePage />} />
        <Route path="/staff/tracks/:id" element={<TrackEditPage />} />
        <Route path="/staff/catalogue" element={<CataloguePage />} />
        <Route path="/staff/skiza" element={<SkizaPage />} />
        <Route path="/staff/browse" element={<ListenerHome statusFilter={null} />} />
      </Route>

      <Route element={<DashboardLayout requiredRole="superadmin" />}>
        <Route path="/superadmin/billing" element={<BillingDashboard />} />
      </Route>

      <Route element={<DashboardLayout requiredRole="artist" />}>
        <Route path="/artist" element={<ArtistDashboard />} />
      </Route>

      <Route element={<DashboardLayout requiredRole="listener" />}>
        <Route path="/listener" element={<ListenerHome />} />
      </Route>

      <Route path="/unauthorized" element={<UnauthorizedPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppRoutes />
          <Toaster />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
