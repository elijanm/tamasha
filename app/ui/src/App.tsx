import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
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
import { BillingPage } from "@/pages/admin/settings/BillingPage";
import { ListenerHome } from "@/pages/listener/ListenerHome";
import { BillingDashboard } from "@/pages/superadmin/BillingDashboard";
import { SuperadminSettingsPage } from "@/pages/superadmin/SuperadminSettingsPage";
import { NotEnabledPage } from "@/pages/NotEnabledPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { Toaster } from "@/components/ui/toaster";
import { useAuth } from "@/hooks/useAuth";
import type { Role } from "@/types";


const ENTERPRISE_ROLES: Role[] = ["artist", "listener"];

const ROLE_REDIRECTS: Record<Role, string> = {
  superadmin: "/superadmin/billing",
  admin: "/admin",
  staff: "/admin",
  artist: "/not-enabled",
  listener: "/not-enabled",
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

      <Route element={<DashboardLayout requiredRole={["admin", "staff"]} />}>
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
          <Route path="billing" element={<BillingPage />} />
        </Route>
        <Route path="/admin/media-monitoring" element={<MediaMonitoringPage />} />
      </Route>

      <Route element={<DashboardLayout requiredRole="superadmin" />}>
        <Route path="/superadmin/billing" element={<BillingDashboard />} />
        <Route path="/superadmin/settings" element={<SuperadminSettingsPage />} />
      </Route>

      {/* Profile — all authenticated roles */}
      <Route element={<DashboardLayout />}>
        <Route path="/profile" element={<ProfilePage />} />
      </Route>

      {/* Staff / artist / listener land on the not-enabled page; all their sub-routes redirect here too */}
      <Route element={<DashboardLayout requiredRole={ENTERPRISE_ROLES} />}>
        <Route path="/not-enabled" element={<NotEnabledPage />} />
        <Route path="/staff/*" element={<Navigate to="/not-enabled" replace />} />
        <Route path="/artist/*" element={<Navigate to="/not-enabled" replace />} />
        <Route path="/listener/*" element={<Navigate to="/not-enabled" replace />} />
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
