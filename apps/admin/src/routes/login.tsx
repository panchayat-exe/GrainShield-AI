import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ShieldCheck, Wheat } from "lucide-react";
import { adminSignIn, getAdminSession } from "@/lib/admin-auth";

export const Route = createFileRoute("/login")({
  // If already logged in as admin, redirect to home
  loader: async () => {
    const session = await getAdminSession();
    if (session) throw redirect({ to: "/" });
    return null;
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { user, error: authError } = await adminSignIn(email, password);
      if (authError || !user) {
        setError(authError ?? "Login failed. Please try again.");
      } else {
        navigate({ to: "/" });
      }
    } catch {
      setError("Unexpected error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="text-center">
          <div className="flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary">
              <Wheat className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <h1 className="mt-4 font-display text-3xl font-bold text-navy">GrainShield AI</h1>
          <p className="mt-1 text-sm text-muted-foreground">Admin Portal — Government of Gujarat</p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-border bg-card p-8 shadow-card">
          <div className="mb-6 flex items-center gap-2 rounded-lg bg-info-soft px-4 py-3">
            <ShieldCheck className="h-5 w-5 text-info" />
            <span className="text-sm font-medium text-info">Restricted to admin and officer accounts only</span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground">
                Official Email Address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="officer@gujarat.gov.in"
                className="mt-1.5 h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-foreground">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1.5 h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {error && (
              <div className="rounded-md bg-danger-soft px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="h-11 w-full rounded-md bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Food, Civil Supplies &amp; Consumer Affairs Department · Gujarat
        </p>
      </div>
    </div>
  );
}
