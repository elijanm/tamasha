import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/store/auth";
import { useTheme } from "@/context/ThemeContext";
import { Input } from "@/components/ui/input";
import type { Role } from "@/types";

const ROLE_REDIRECTS: Record<Role, string> = {
  superadmin: "/superadmin/billing",
  admin: "/admin",
  staff: "/staff",
  artist: "/not-enabled",
  listener: "/not-enabled",
};

function useLoginForm() {
  const navigate = useNavigate();
  const { login, isLoading, error, clearError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await login(email, password);
      // Role is now set in the store after login() resolves; read directly from store
      const currentRole = useAuthStore.getState().user?.role as Role | undefined;
      if (currentRole && ROLE_REDIRECTS[currentRole]) {
        navigate(ROLE_REDIRECTS[currentRole]);
        return;
      }
      navigate("/");
    } catch { /* error is in store */ }
  };

  return { email, setEmail, password, setPassword, handleSubmit, isLoading, error };
}

// ── Premium field component ────────────────────────────────────────────────────

function Field({
  id, label, type, placeholder, value, onChange, autoFocus, autoComplete,
}: {
  id: string; label: string; type: string; placeholder: string;
  value: string; onChange: (v: string) => void;
  autoFocus?: boolean; autoComplete?: string;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-[11px] font-semibold uppercase tracking-[0.1em]"
        style={{ color: focused ? "#1c1917" : "#9c9189" }}
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        required
        className="w-full h-12 px-4 rounded-xl text-sm outline-none transition-all duration-150"
        style={{
          background: focused ? "#ffffff" : "#f8f6f3",
          border: `1.5px solid ${focused ? "#1c1917" : "#e5e2dc"}`,
          color: "#1c1917",
          fontFamily: "'DM Sans', 'Inter', sans-serif",
          boxShadow: focused ? "0 0 0 3px rgba(28,25,23,0.06)" : "none",
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </div>
  );
}

// ── Simple (light) form ────────────────────────────────────────────────────────

function SimpleLoginForm() {
  const { email, setEmail, password, setPassword, handleSubmit, isLoading, error } = useLoginForm();

  return (
    <div>
      {/* Header */}
      <div className="mb-9">
        <h2
          className="font-display font-bold mb-2"
          style={{ color: "#0c0a08", fontSize: "26px", letterSpacing: "-0.02em" }}
        >
          Welcome back
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: "#9c9189", fontFamily: "'DM Sans', 'Inter', sans-serif" }}>
          Access the Tamasha archive dashboard
        </p>
      </div>

      {/* Error */}
      {error && (
        <div
          className="mb-6 px-4 py-3 rounded-xl text-sm"
          style={{
            background: "rgba(196,30,42,0.05)",
            border: "1.5px solid rgba(196,30,42,0.18)",
            color: "#c41e2a",
            fontFamily: "'DM Sans', 'Inter', sans-serif",
          }}
        >
          {error}
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-5">
        <Field
          id="email" label="Email address" type="email"
          placeholder="you@example.com" value={email}
          onChange={setEmail} autoFocus autoComplete="email"
        />

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ color: "#9c9189" }}>
              Password
            </span>
            <Link
              to="/forgot-password"
              className="text-[11px] font-medium transition-colors"
              style={{ color: "#9c9189", textDecoration: "underline", textUnderlineOffset: "2px" }}
            >
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="w-full h-12 px-4 rounded-xl text-sm outline-none transition-all duration-150"
            style={{
              background: "#f8f6f3",
              border: "1.5px solid #e5e2dc",
              color: "#1c1917",
              fontFamily: "'DM Sans', 'Inter', sans-serif",
            }}
          />
        </div>

        {/* Submit */}
        <div className="pt-1">
          <button
            type="submit"
            disabled={isLoading}
            className="w-full h-12 rounded-xl flex items-center justify-center gap-2 text-sm font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: "#0c0a08",
              color: "#ffffff",
              fontFamily: "'DM Sans', 'Inter', sans-serif",
              letterSpacing: "0.01em",
              boxShadow: "0 1px 2px rgba(0,0,0,0.18), 0 4px 16px rgba(12,10,8,0.12)",
            }}
            onMouseEnter={(e) => {
              if (!isLoading) (e.currentTarget as HTMLButtonElement).style.background = "#1c1917";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "#0c0a08";
            }}
          >
            {isLoading
              ? <><Loader2 className="h-4 w-4 animate-spin" /> Signing in…</>
              : <>Sign in <ArrowRight className="h-4 w-4" /></>}
          </button>
        </div>
      </form>

      {/* Divider + Pan-African accent */}
      <div className="flex items-center gap-3 my-7">
        <div className="h-px flex-1" style={{ backgroundColor: "#ece9e4" }} />
        <div className="flex gap-1">
          <div className="w-1 h-1 rounded-full" style={{ backgroundColor: "#c41e2a" }} />
          <div className="w-1 h-1 rounded-full" style={{ backgroundColor: "#1a7a1a" }} />
          <div className="w-1 h-1 rounded-full" style={{ backgroundColor: "#ca8a04" }} />
        </div>
        <div className="h-px flex-1" style={{ backgroundColor: "#ece9e4" }} />
      </div>

      <p className="text-sm text-center" style={{ color: "#a8a29e", fontFamily: "'DM Sans', 'Inter', sans-serif" }}>
        No account?{" "}
        <Link
          to="/register"
          className="font-medium transition-colors"
          style={{ color: "#1c1917", textDecoration: "underline", textUnderlineOffset: "3px" }}
        >
          Request access
        </Link>
      </p>
    </div>
  );
}

// ── Default (dark) form ────────────────────────────────────────────────────────

function DefaultLoginForm() {
  const { email, setEmail, password, setPassword, handleSubmit, isLoading, error } = useLoginForm();

  return (
    <div
      className="rounded-2xl p-7 shadow-2xl"
      style={{
        background: "rgba(10,8,20,0.85)",
        border: "1px solid rgba(134,59,255,0.18)",
        backdropFilter: "blur(20px)",
        boxShadow: "0 0 0 1px rgba(134,59,255,0.08), 0 32px 64px rgba(0,0,0,0.6), 0 0 80px rgba(134,59,255,0.05)",
      }}
    >
      <div className="mb-6">
        <h2 className="font-display text-lg font-semibold" style={{ color: "#ede6ff" }}>
          Sign in to your account
        </h2>
        <p className="mt-1 text-sm font-body" style={{ color: "rgba(255,255,255,0.3)" }}>
          Access the Tamasha archive dashboard
        </p>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2.5 rounded-lg text-sm font-body"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5" }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-xs font-mono tracking-wider uppercase" style={{ color: "rgba(255,255,255,0.35)" }}>
            Email
          </label>
          <Input id="email" type="email" placeholder="you@example.com" value={email}
            onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus
            className="h-10 text-sm font-body"
            style={{ background: "rgba(134,59,255,0.05)", border: "1px solid rgba(134,59,255,0.2)", color: "#ede6ff" }} />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-mono tracking-wider uppercase" style={{ color: "rgba(255,255,255,0.35)" }}>
              Password
            </label>
            <Link to="/forgot-password" className="text-[11px] font-mono" style={{ color: "rgba(134,59,255,0.6)" }}>
              Forgot password?
            </Link>
          </div>
          <Input id="password" type="password" placeholder="••••••••" value={password}
            onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password"
            className="h-10 text-sm font-body"
            style={{ background: "rgba(134,59,255,0.05)", border: "1px solid rgba(134,59,255,0.2)", color: "#ede6ff" }} />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full mt-2 h-11 rounded-lg flex items-center justify-center gap-2 text-sm font-mono font-semibold tracking-wide transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: "linear-gradient(135deg, #863bff 0%, #6d28d9 100%)",
            color: "#fff",
            boxShadow: "0 0 32px rgba(134,59,255,0.35), 0 4px 12px rgba(0,0,0,0.4)",
          }}
        >
          {isLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Entering…</> : <>Enter the archive <ArrowRight className="h-4 w-4" /></>}
        </button>
      </form>

      <p className="mt-5 text-center text-sm font-body" style={{ color: "rgba(255,255,255,0.2)" }}>
        No account?{" "}
        <Link to="/register" style={{ color: "rgba(134,59,255,0.8)" }}>Request access</Link>
      </p>
    </div>
  );
}

export function LoginPage() {
  const { theme } = useTheme();
  return theme === "simple" ? <SimpleLoginForm /> : <DefaultLoginForm />;
}
