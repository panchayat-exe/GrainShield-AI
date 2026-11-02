import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ShieldCheck, Wheat, KeyRound, Check, X } from "lucide-react";
import { adminSignIn, getAdminSession, adminResetPassword } from "@/lib/admin-auth";

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

  // Forgot password modal
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetMessage, setResetMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [resetLoading, setResetLoading] = useState(false);

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

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setResetMessage(null);
    setResetLoading(true);
    try {
      const { error: resetErr } = await adminResetPassword(resetEmail);
      if (resetErr) {
        setResetMessage({ type: "error", text: resetErr });
      } else {
        setResetMessage({
          type: "success",
          text: "Password reset link sent to your official email. Check your inbox.",
        });
      }
    } catch {
      setResetMessage({ type: "error", text: "Failed to dispatch reset email." });
    } finally {
      setResetLoading(false);
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
            <span className="text-sm font-medium text-info">
              Restricted to admin and officer accounts only
            </span>
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
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-foreground">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setResetEmail(email);
                    setShowForgotModal(true);
                  }}
                  className="text-xs text-info hover:underline"
                >
                  Forgot password?
                </button>
              </div>
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
              className="h-11 w-full rounded-md bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {loading ? "Verifying Credentials…" : "Sign In to Admin Portal"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Food, Civil Supplies &amp; Consumer Affairs Department · Government of Gujarat
        </p>
      </div>

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-primary" />
                <h3 className="font-bold text-navy text-base">Reset Officer Password</h3>
              </div>
              <button
                onClick={() => {
                  setShowForgotModal(false);
                  setResetMessage(null);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleResetPassword} className="mt-4 space-y-4">
              <p className="text-xs text-muted-foreground">
                Enter your official registered email address. We will dispatch a secure recovery
                link.
              </p>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="admin@grainshield.gov.in"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
              </div>

              {resetMessage && (
                <div
                  className={`rounded-md p-2.5 text-xs ${
                    resetMessage.type === "success"
                      ? "bg-success-soft text-success"
                      : "bg-danger-soft text-destructive"
                  }`}
                >
                  {resetMessage.text}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowForgotModal(false);
                    setResetMessage(null);
                  }}
                  className="rounded-md border border-input px-3.5 py-1.5 text-xs text-foreground hover:bg-muted"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="rounded-md bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {resetLoading ? "Sending…" : "Send Recovery Link"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
