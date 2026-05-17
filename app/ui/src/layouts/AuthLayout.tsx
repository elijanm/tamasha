import { Navigate, Outlet } from "react-router-dom";
import { useTheme } from "@/context/ThemeContext";
import { useAuth } from "@/hooks/useAuth";
import type { Role } from "@/types";

const ROLE_HOME: Record<Role, string> = {
  superadmin: "/superadmin/billing",
  admin: "/admin",
  staff: "/staff",
  artist: "/artist",
  listener: "/listener",
};

function SimpleAuthLayout() {
  return (
    <div className="min-h-screen flex" style={{ backgroundColor: "#f5f3ef" }}>

      {/* ── Left panel ─────────────────────────────────────────────────────── */}
      <div
        className="hidden lg:flex flex-col justify-between w-[440px] flex-shrink-0 relative overflow-hidden"
        style={{ backgroundColor: "#0c0a08" }}
      >
        {/* Grain texture */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E")`,
            backgroundRepeat: "repeat",
            backgroundSize: "128px 128px",
            opacity: 0.6,
          }}
        />

        {/* Warm radial glow behind logo */}
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 rounded-full pointer-events-none"
          style={{
            background: "radial-gradient(ellipse, rgba(202,138,4,0.06) 0%, transparent 70%)",
            filter: "blur(40px)",
          }}
        />

        {/* Pan-African vertical accent — left edge */}
        <div className="absolute left-0 top-0 bottom-0 w-[3px] flex flex-col">
          <div className="flex-1" style={{ backgroundColor: "#c41e2a" }} />
          <div className="flex-1" style={{ backgroundColor: "#1a7a1a" }} />
          <div className="flex-1" style={{ backgroundColor: "#ca8a04" }} />
        </div>

        {/* Top: wordmark */}
        <div className="relative z-10 pl-12 pr-10 pt-12">
          <img
            src="https://tamasharecordings.com/img/tamasha-logo.png"
            alt="Tamasha"
            className="h-14 w-auto object-contain"
            style={{ opacity: 0.88 }}
          />
        </div>

        {/* Center: hero text */}
        <div className="relative z-10 pl-12 pr-10">
          <p
            className="font-mono uppercase tracking-[0.16em] mb-5"
            style={{ color: "rgba(255,255,255,0.25)", fontSize: "10px" }}
          >
            African Music Archive
          </p>

          <h1
            className="font-display font-bold leading-[1.1] mb-7"
            style={{
              color: "#ffffff",
              fontSize: "clamp(2rem, 3.2vw, 2.75rem)",
              letterSpacing: "-0.03em",
            }}
          >
            Every recording,<br />in order.
          </h1>

          {/* Pan-African accent bars */}
          <div className="flex items-center gap-2 mb-7">
            <div className="h-[2px] w-10 rounded-full" style={{ backgroundColor: "#c41e2a" }} />
            <div className="h-[2px] w-10 rounded-full" style={{ backgroundColor: "#1a7a1a" }} />
            <div className="h-[2px] w-10 rounded-full" style={{ backgroundColor: "#ca8a04" }} />
          </div>

          <p
            className="font-body leading-relaxed"
            style={{ color: "rgba(255,255,255,0.28)", fontSize: "13px", maxWidth: "280px" }}
          >
            Recordings, royalties, distribution, and Skiza — managed from one place.
          </p>
        </div>

        {/* Bottom: copyright */}
        <div className="relative z-10 pl-12 pb-10">
          <p
            className="font-mono"
            style={{ color: "rgba(255,255,255,0.15)", fontSize: "11px" }}
          >
            © Tamasha Corporation Limited 2026
          </p>
        </div>
      </div>

      {/* ── Right panel ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 py-16 relative">

        {/* Mobile brand */}
        <div className="lg:hidden flex flex-col items-center mb-10">
          <img
            src="https://tamasharecordings.com/img/tamasha-logo.png"
            alt="Tamasha"
            className="h-16 w-auto object-contain mb-4"
            style={{
              filter: "invert(1)",
              opacity: 0.82,
            }}
          />
          <p className="text-[10px] font-mono tracking-widest uppercase" style={{ color: "#a8a29e" }}>
            Every recording, in order.
          </p>
        </div>

        <div className="w-full max-w-[380px] animate-fadeIn">
          <Outlet />
        </div>

        <p className="mt-12 text-[11px] font-mono" style={{ color: "#c7c4c0" }}>
          Protected by session encryption · CSRF enforced
        </p>
      </div>
    </div>
  );
}

function DefaultAuthLayout() {
  return (
    <div className="min-h-screen bg-[#07070e] flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full pointer-events-none"
        style={{ background: "radial-gradient(ellipse, rgba(134,59,255,0.07) 0%, transparent 70%)" }} />
      <div className="absolute top-1/4 right-1/4 w-80 h-80 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(ellipse, rgba(71,191,255,0.04) 0%, transparent 70%)" }} />
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: "radial-gradient(circle at 1px 1px, rgba(134,59,255,0.15) 1px, transparent 0)",
        backgroundSize: "48px 48px",
        opacity: 0.4,
      }} />

      <div className="relative z-10 w-full max-w-sm animate-fadeIn">
        <div className="flex flex-col items-center mb-10">
          <div className="relative mb-5">
            {/* Purple halo behind the logo */}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background: "radial-gradient(ellipse, rgba(134,59,255,0.4) 0%, transparent 70%)",
                filter: "blur(24px)",
                transform: "scale(2.2)",
              }}
            />
            <img
              src="https://tamasharecordings.com/img/tamasha-logo.png"
              alt="Tamasha"
              className="relative h-20 w-auto object-contain"
              style={{
                filter: "drop-shadow(0 0 18px rgba(134,59,255,0.8)) drop-shadow(0 0 6px rgba(71,191,255,0.4))",
                opacity: 0.95,
              }}
            />
          </div>
          <p className="text-[12px] font-mono tracking-[0.14em] uppercase" style={{ color: "rgba(134,59,255,0.65)" }}>
            Every recording, in order.
          </p>
        </div>
        <Outlet />
        <p className="mt-8 text-center text-[11px] font-mono tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.12)" }}>
          Session encrypted · CSRF enforced
        </p>
      </div>
    </div>
  );
}

export function AuthLayout() {
  const { theme } = useTheme();
  const { isAuthenticated, role } = useAuth();

  // Already logged in — send them to their dashboard so the old session
  // can't bleed through to someone trying to log in on the same browser.
  if (isAuthenticated && role) {
    return <Navigate to={ROLE_HOME[role] ?? "/"} replace />;
  }

  return theme === "simple" ? <SimpleAuthLayout /> : <DefaultAuthLayout />;
}
