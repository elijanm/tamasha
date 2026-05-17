import { NavLink, Outlet } from "react-router-dom";
import { Settings2, Users, ScrollText, Palette, Copy, Receipt } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export function SettingsLayout() {
  const { hasAccounting } = useAuth();

  const tabs = [
    { label: "General",    to: "/admin/settings",               icon: Settings2,  end: true  },
    { label: "Users",      to: "/admin/settings/users",         icon: Users,      end: false },
    { label: "Audit Log",  to: "/admin/settings/audit-log",     icon: ScrollText, end: false },
    { label: "Themes",     to: "/admin/settings/themes",        icon: Palette,    end: false },
    { label: "Duplicates", to: "/admin/settings/duplicates",    icon: Copy,       end: false },
    ...(hasAccounting
      ? [{ label: "Billing", to: "/admin/settings/billing", icon: Receipt, end: false }]
      : []),
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="font-display text-2xl font-bold text-stone-100">Settings</h1>
        <p className="mt-1 text-sm font-body text-stone-500">Manage the archive platform</p>
      </div>
      <nav className="flex items-center gap-1 border-b border-stone-800">
        {tabs.map(({ label, to, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-4 py-2.5 text-sm font-mono border-b-2 -mb-px transition-colors ${
                isActive
                  ? "border-violet-500 text-violet-400"
                  : "border-transparent text-stone-500 hover:text-stone-300"
              }`
            }
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
