import { useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Navigate } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { PlayerBar } from "@/components/player/PlayerBar";
import { useAuth } from "@/hooks/useAuth";
import { usePlayerStore } from "@/store/player";
import type { Role } from "@/types";

interface DashboardLayoutProps {
  requiredRole?: Role | Role[];
}

export function DashboardLayout({ requiredRole }: DashboardLayoutProps) {
  const { isAuthenticated, role } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const track = usePlayerStore((s) => s.track);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requiredRole) {
    const allowed = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    // Admin has access to everything
    const hasAccess = role === "admin" || allowed.includes(role as Role);
    if (!hasAccess) {
      return <Navigate to="/unauthorized" replace />;
    }
  }

  return (
    <div className="flex h-screen bg-stone-950 overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:flex flex-shrink-0">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="relative flex h-full">
            <Sidebar onClose={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto bg-stone-950">
          <div className={`p-5 max-w-screen-2xl mx-auto ${track ? "pb-20" : ""}`}>
            <Outlet />
          </div>
        </main>
      </div>

      <PlayerBar />
    </div>
  );
}
