import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, ArrowRight, MailX } from "lucide-react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi } from "@/api/auth";

export function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const inviteToken = searchParams.get("token") ?? undefined;
  const inviteEmail = searchParams.get("email") ?? "";

  const [email, setEmail] = useState(inviteEmail);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // No token + invite-only mode: backend will reject with 403
  // We detect this after the first failed attempt OR show a pre-emptive hint
  // when there's no token in the URL at all.
  const isInviteOnly = !inviteToken;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await authApi.register({ email, username, password, invite_token: inviteToken });
      navigate("/login");
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data) {
        const detail = err.response.data?.detail;
        if (typeof detail === "string") {
          setError(detail);
        } else if (Array.isArray(detail) && detail.length > 0) {
          setError(detail.map((e: { msg?: string }) => e.msg ?? "Validation error").join(" · "));
        } else {
          setError(`Registration failed (${err.response.status})`);
        }
      } else {
        setError(err instanceof Error ? err.message : "Registration failed");
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (isInviteOnly) {
    return (
      <div className="bg-stone-900/60 border border-stone-800 rounded-xl p-7 shadow-2xl backdrop-blur-sm text-center">
        <div className="w-12 h-12 rounded-full bg-stone-800 flex items-center justify-center mx-auto mb-4">
          <MailX className="w-5 h-5 text-stone-500" />
        </div>
        <h2 className="font-display text-xl font-semibold text-stone-100 mb-2">Invitation only</h2>
        <p className="text-sm font-body text-stone-500 mb-5">
          Registration is by invitation. Ask an administrator to send you an invite link.
        </p>
        <Link to="/login" className="text-sm text-violet-400 hover:text-violet-300 transition-colors">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="bg-stone-900/60 border border-stone-800 rounded-xl p-7 shadow-2xl backdrop-blur-sm">
      <div className="mb-6">
        <h2 className="font-display text-xl font-semibold text-stone-100">Create account</h2>
        <p className="mt-1 text-sm font-body text-stone-500">
          Join the Tamasha archive platform
        </p>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2.5 rounded-md bg-red-500/10 border border-red-500/20 text-sm font-body text-red-400">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            type="text"
            placeholder="yourname"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
            minLength={3}
            maxLength={32}
            pattern="[a-zA-Z0-9_\-]+"
            title="Letters, numbers, hyphens, and underscores only"
          />
          <p className="text-xs font-body text-stone-600">Letters, numbers, hyphens, and underscores only</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            readOnly={!!inviteEmail}
          />
          {inviteEmail && (
            <p className="text-xs font-body text-stone-600">Pre-filled from your invitation</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            placeholder="Min. 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>

        <Button type="submit" disabled={isLoading} className="w-full">
          {isLoading ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Creating…</>
          ) : (
            <>Create account <ArrowRight className="h-4 w-4" /></>
          )}
        </Button>
      </form>

      <p className="mt-5 text-center text-sm font-body text-stone-600">
        Already have an account?{" "}
        <Link to="/login" className="text-violet-400 hover:text-violet-300 transition-colors">
          Sign in
        </Link>
      </p>
    </div>
  );
}
