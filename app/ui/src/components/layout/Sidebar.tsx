import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, ClipboardList, Activity,
  LogOut, ChevronRight, Disc3, Shield, Music2, Headphones,
  Library, Scissors, Play, Pause, Settings, Radio, Users, CreditCard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { usePlayerStore, _audio } from "@/store/player";
import { useTheme } from "@/context/ThemeContext";
import type { Role } from "@/types";

interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  superadmin: [
    { label: "Billing",  to: "/superadmin/billing",  icon: CreditCard },
    { label: "Settings", to: "/superadmin/settings", icon: Settings   },
  ],
  admin: [
    { label: "Dashboard",     to: "/admin",                  icon: LayoutDashboard },
    { label: "Catalogue",     to: "/admin/catalogue",        icon: Library         },
    { label: "Artists",       to: "/admin/artists",          icon: Users           },
    { label: "Browse Music",  to: "/admin/browse",           icon: Headphones      },
    { label: "Skiza",         to: "/admin/skiza",            icon: Scissors        },
    { label: "Media Monitor", to: "/admin/media-monitoring", icon: Radio           },
  ],
  staff: [
    { label: "Dashboard",    to: "/staff",             icon: LayoutDashboard },
    { label: "Review Queue", to: "/staff/queue",        icon: ClipboardList   },
    { label: "Catalogue",    to: "/staff/catalogue",   icon: Library         },
    { label: "Browse Music", to: "/staff/browse",      icon: Headphones      },
    { label: "Skiza",        to: "/staff/skiza",        icon: Scissors        },
  ],
  artist: [
    { label: "Dashboard", to: "/artist", icon: Activity },
  ],
  listener: [
    { label: "Browse", to: "/listener", icon: Headphones },
  ],
};

const ROLE_META: Record<Role, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  superadmin: { label: "Super Admin",  icon: CreditCard, color: "text-violet-300" },
  admin:      { label: "Administrator", icon: Shield,    color: "text-red-400" },
  staff:      { label: "Staff",         icon: Disc3,     color: "text-violet-400" },
  artist:     { label: "Artist",        icon: Music2,    color: "text-emerald-400" },
  listener:   { label: "Listener",      icon: Headphones, color: "text-blue-400" },
};

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const { user, logout, role } = useAuth();
  const navigate = useNavigate();
  const { theme } = useTheme();

  const { track, isPlaying } = usePlayerStore();

  const navItems = role ? (NAV_BY_ROLE[role] ?? []) : [];
  const roleMeta = role ? ROLE_META[role] : null;
  const RoleIcon = roleMeta?.icon ?? Disc3;

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleTogglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (_audio.paused) {
      _audio.play().catch(() => {});
    } else {
      _audio.pause();
    }
  };

  return (
    <aside className="flex flex-col h-full w-64 bg-stone-950 border-r border-stone-800/60">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-stone-800/60">
        <div className="flex items-center gap-3">
          <div className="relative flex-shrink-0">
            {theme !== "simple" && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background: "radial-gradient(ellipse, rgba(134,59,255,0.4) 0%, transparent 70%)",
                  filter: "blur(16px)",
                  transform: "scale(2.4)",
                }}
              />
            )}
            <img
              src="https://tamasharecordings.com/img/tamasha-logo.png"
              alt="Tamasha"
              className="relative h-9 w-auto object-contain"
              style={{
                filter: theme === "simple"
                  ? "invert(1)"
                  : "invert(1) drop-shadow(0 0 18px rgba(134,59,255,0.8)) drop-shadow(0 0 6px rgba(71,191,255,0.4))",
                opacity: 0.95,
              }}
            />
          </div>
          <span
            className="font-display font-bold tracking-tight"
            style={{
              fontSize: "17px",
              color: theme === "simple" ? "#f5f5f4" : "#ede6ff",
              letterSpacing: "-0.02em",
              textShadow: theme !== "simple" ? "0 0 20px rgba(134,59,255,0.5)" : "none",
            }}
          >
            Tamasha
          </span>
        </div>
        {roleMeta && (
          <div className="mt-3 flex items-center gap-1.5">
            <RoleIcon className={cn("w-3 h-3", roleMeta.color)} />
            <span className="text-xs font-mono text-stone-600">{roleMeta.label}</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <p className="px-2 mb-2 text-xs font-mono font-semibold text-stone-700 uppercase tracking-widest">
          Navigation
        </p>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-body transition-all duration-150 group",
                  isActive
                    ? "bg-violet-500/15 text-violet-400 border border-violet-500/20"
                    : "text-stone-500 hover:text-stone-200 hover:bg-stone-800/60"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={cn("w-4 h-4 flex-shrink-0", isActive ? "text-violet-400" : "text-stone-600 group-hover:text-stone-400")} />
                  <span>{item.label}</span>
                  {isActive && <ChevronRight className="w-3 h-3 ml-auto text-violet-500/60" />}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* Settings link (admin only) */}
      {role === "admin" && (
        <div className="px-3 pb-2 border-t border-stone-800/60 pt-2">
          <NavLink
            to="/admin/settings"
            end
            onClick={onClose}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-body transition-all duration-150 group",
                isActive
                  ? "bg-violet-500/15 text-violet-400 border border-violet-500/20"
                  : "text-stone-500 hover:text-stone-200 hover:bg-stone-800/60"
              )
            }
          >
            {({ isActive }) => (
              <>
                <Settings className={cn("w-4 h-4 flex-shrink-0", isActive ? "text-violet-400" : "text-stone-600 group-hover:text-stone-400")} />
                <span>Settings</span>
                {isActive && <ChevronRight className="w-3 h-3 ml-auto text-violet-500/60" />}
              </>
            )}
          </NavLink>
        </div>
      )}

      {/* Now-playing strip */}
      {track && (
        <div className="mx-3 mb-2 px-3 py-2.5 rounded-md bg-stone-900 border border-stone-800/60 flex items-center gap-2.5">
          {/* Animated bars or static icon */}
          <div className="flex-shrink-0 w-5 flex items-end justify-center gap-px h-4">
            {isPlaying ? (
              <>
                {[1, 2, 3].map((b) => (
                  <div
                    key={b}
                    className="w-1 bg-violet-400 rounded-sm animate-pulse"
                    style={{ height: `${6 + b * 3}px`, animationDelay: `${b * 0.15}s` }}
                  />
                ))}
              </>
            ) : (
              <Music2 className="w-3.5 h-3.5 text-stone-600" />
            )}
          </div>

          {/* Track title */}
          <p className="flex-1 min-w-0 text-xs font-body font-medium text-stone-300 truncate">
            {track.title || "Untitled"}
          </p>

          {/* Play/pause toggle */}
          <button
            onClick={handleTogglePlay}
            className="flex-shrink-0 w-6 h-6 rounded-full bg-violet-500/20 hover:bg-violet-500/40 flex items-center justify-center transition-colors"
          >
            {isPlaying ? (
              <Pause className="w-3 h-3 text-violet-400" />
            ) : (
              <Play className="w-3 h-3 text-violet-400 ml-0.5" />
            )}
          </button>
        </div>
      )}

      {/* User info & Logout */}
      <div className="px-3 py-4 border-t border-stone-800/60">
        {user && (
          <NavLink
            to="/profile"
            onClick={onClose}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 px-3 py-2 mb-1 rounded-md transition-colors group",
                isActive ? "bg-violet-500/15" : "hover:bg-stone-800/60"
              )
            }
          >
            <div className="w-7 h-7 rounded-full bg-stone-800 border border-stone-700 overflow-hidden flex items-center justify-center flex-shrink-0">
              {user.profile?.avatar_url ? (
                <img src={user.profile.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs font-mono text-stone-500 uppercase">
                  {user.username.charAt(0)}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-body font-medium text-stone-300 truncate group-hover:text-stone-100">
                {user.profile?.display_name || user.username}
              </p>
              <p className="text-xs font-mono text-stone-600 truncate">{user.email}</p>
            </div>
          </NavLink>
        )}
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-body text-stone-600 hover:text-red-400 hover:bg-red-500/10 transition-all duration-150"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
