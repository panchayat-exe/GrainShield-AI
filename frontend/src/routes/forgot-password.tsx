import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Wheat, Landmark, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { resetPassword } from "@/lib/auth";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [{ title: "Forgot Password | GrainShield AI" }],
  }),
  component: ForgotPassword,
});

const input =
  "h-12 w-full rounded-xl border border-input bg-card px-3 text-sm outline-none focus:border-info";

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email) {
      setError("Please enter your email address.");
      return;
    }
    setLoading(true);
    const { error: err } = await resetPassword(email);
    setLoading(false);
    if (err) {
      setError(err);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="mx-auto max-w-md px-4 pt-10">
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-success/40 bg-success-soft p-6 text-center">
            <CheckCircle2 className="h-14 w-14 text-success" />
            <h1 className="text-xl font-bold">Check your email</h1>
            <p className="text-sm text-muted-foreground">
              If an account exists for <strong>{email}</strong>, you will receive a password-reset
              link within a few minutes.
            </p>
            <Link to="/login" className="text-info underline text-sm">
              Back to Sign In
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-md px-4 pt-10">
        <h1 className="text-2xl font-bold">Forgot Password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enter your email and we will send you a reset link.
        </p>

        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
          className="mt-6 space-y-4"
        >
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          <label className="block text-sm font-medium">
            Email <span className="text-danger">*</span>
            <input
              className={`${input} mt-1`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-saffron font-semibold text-saffron-foreground disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Send Reset Link"}
          </button>
        </form>
        <p className="mt-4 text-center text-sm">
          <Link to="/login" className="text-info hover:underline">
            Back to Sign In
          </Link>
        </p>
      </main>
    </div>
  );
}

function Header() {
  return (
    <header className="bg-header text-maroon-foreground shadow-md">
      <div className="flex items-center justify-between px-4 py-1.5 text-[11px] opacity-90">
        <span className="flex items-center gap-1.5">
          <Landmark className="h-3.5 w-3.5" />
          Government of Gujarat
        </span>
      </div>
      <div className="flex items-center gap-3 px-4 pb-3">
        <Wheat className="h-8 w-8 text-saffron" />
        <div>
          <p className="text-lg font-bold leading-none tracking-tight">
            GRAINSHIELD <span className="text-saffron">AI</span>
          </p>
          <p className="text-[11px] opacity-80">AI-Powered Food Grain Transport Verification</p>
        </div>
      </div>
    </header>
  );
}
