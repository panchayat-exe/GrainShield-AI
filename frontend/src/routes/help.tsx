import { createFileRoute, Link } from "@tanstack/react-router";
import React from "react";
import {
  HelpCircle,
  Camera,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  Clock,
  MapPin,
  Shield,
} from "lucide-react";
import { AppShell, Card } from "@/components/AppShell";

export const Route = createFileRoute("/help")({
  head: () => ({
    meta: [
      { title: "Help & FAQ | GrainShield AI" },
      {
        name: "description",
        content: "Frequently asked questions about GrainShield AI grain transport verification.",
      },
    ],
  }),
  component: Help,
});

interface FaqItem {
  q: string;
  a: string | React.ReactNode;
}

const faqs: FaqItem[] = [
  {
    q: "What is GrainShield AI?",
    a: "GrainShield AI is a government logistics verification platform for the Gujarat State Civil Supplies Corporation (GSCSCL). It uses AI-based image verification to ensure food grain is transported securely and that only authorised vehicles are used at each checkpoint.",
  },
  {
    q: "What is a Checkpoint (CP)?",
    a: (
      <span>
        Each transport trip has up to 4 checkpoints:
        <ul className="mt-2 list-inside list-disc space-y-1 text-muted-foreground">
          <li>
            <strong className="text-foreground">CP1</strong> — Vehicle departs FCI Mandi /
            warehouse.
          </li>
          <li>
            <strong className="text-foreground">CP2</strong> — Vehicle arrives at godown / depot.
          </li>
          <li>
            <strong className="text-foreground">CP3</strong> — Vehicle departs godown for Fair Price
            Shop.
          </li>
          <li>
            <strong className="text-foreground">CP4</strong> — Final delivery at Fair Price Shop.
          </li>
        </ul>
        You must submit one photograph per checkpoint.
      </span>
    ),
  },
  {
    q: "What photograph should I submit?",
    a: "Take a clear photograph of the vehicle's front number plate. Make sure the plate is fully visible, well-lit, and not obscured by dirt, shadow, or objects. The vehicle must be stationary when you photograph it.",
  },
  {
    q: "What does each verification status mean?",
    a: (
      <ul className="list-inside space-y-2">
        <li className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
          <span>
            <strong>Pass</strong> — The number plate was verified successfully. No action needed.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
          <span>
            <strong>Retake</strong> — The photograph was not clear enough. Retake and resubmit.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-purple-600" />
          <span>
            <strong>Manual Review</strong> — A verification officer is reviewing your submission.
            Please wait; you will be notified of the outcome.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
          <span>
            <strong>Processing</strong> — Your photograph is being analysed by the AI. This normally
            takes under 30 seconds.
          </span>
        </li>
        <li className="flex items-start gap-2">
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <span>
            <strong>Rejected</strong> — The submission was rejected by an officer. Contact your area
            supervisor for guidance.
          </span>
        </li>
      </ul>
    ),
  },
  {
    q: "My photograph was sent for Manual Review. What happens next?",
    a: "A GrainShield verification officer will examine the photograph and either approve it or request a retake. This typically takes a few hours during working hours. You can track the status on the Trip Details page.",
  },
  {
    q: "I got a Retake result. How do I resubmit?",
    a: "Open the Submit Trip screen, enter the same vehicle number, select the same trip stage, and upload a new, clearer photograph. A new Trip ID will be automatically generated for the resubmission. Make sure the number plate is clearly visible and well-lit.",
  },
  {
    q: "Why does the app need my location?",
    a: "GrainShield AI records your GPS coordinates at each checkpoint to verify that the vehicle was physically present at the correct location. Location data is only collected while tracking is active during a trip.",
  },
  {
    q: "I cannot find my trip in My Trips. What should I do?",
    a: "Trips you submit are automatically listed under My Trips once submitted. If a trip is missing, it may have been created under a different account. Contact your district GrainShield officer for assistance.",
  },
  {
    q: "How do I contact support?",
    a: "For technical support, contact your district GSCSCL supervisor or the GrainShield helpdesk. For account issues, use the Forgot Password link on the login page.",
  },
];

function FaqRow({ item }: { item: FaqItem }) {
  return (
    <details className="group border-b border-border last:border-0">
      <summary
        className="flex cursor-pointer items-center justify-between gap-3 py-4 text-sm font-medium text-foreground marker:hidden"
        aria-label={item.q}
      >
        <span>{item.q}</span>
        <HelpCircle
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-45"
          aria-hidden="true"
        />
      </summary>
      <div className="pb-4 text-sm text-muted-foreground">{item.a}</div>
    </details>
  );
}

function Help() {
  return (
    <AppShell crumbs={["Help"]} title="Help & FAQ">
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
        {/* Intro */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          <p className="text-sm font-medium text-primary">
            GrainShield AI — Government Food Grain Logistics Verification
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Gujarat State Civil Supplies Corporation Ltd. (GSCSCL) · SFIC PS000006
          </p>
        </div>

        {/* Checkpoint diagram */}
        <Card title="Four-Checkpoint Logistics Workflow">
          <div
            className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4"
            role="list"
            aria-label="Four logistics checkpoints"
          >
            {[
              {
                cp: "CP1",
                label: "Departure",
                desc: "FCI Mandi / Warehouse",
                stage: "first_mile",
              },
              { cp: "CP2", label: "Arrival", desc: "Godown / Depot", stage: "first_mile" },
              { cp: "CP3", label: "Departure", desc: "Godown", stage: "last_mile" },
              { cp: "CP4", label: "Delivery", desc: "Fair Price Shop", stage: "last_mile" },
            ].map((c) => (
              <div
                key={c.cp}
                role="listitem"
                aria-label={`${c.cp} — ${c.label} at ${c.desc}`}
                className="flex flex-col items-center rounded-lg border border-border bg-muted/40 px-3 py-3 text-center"
              >
                <span className="mb-1 text-lg font-bold text-primary">{c.cp}</span>
                <span className="font-medium text-foreground">{c.label}</span>
                <span className="mt-0.5 text-muted-foreground">{c.desc}</span>
                <span className="mt-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  {c.stage === "first_mile" ? "First Mile" : "Last Mile"}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 text-primary" />
            GPS is recorded at each checkpoint for route verification.
          </div>
        </Card>

        {/* FAQ */}
        <Card title="Frequently Asked Questions">
          <div className="divide-y divide-border">
            {faqs.map((f, i) => (
              <FaqRow key={i} item={f} />
            ))}
          </div>
        </Card>

        {/* Quick links */}
        <nav aria-label="Quick navigation links">
          <div className="flex flex-wrap gap-3">
            <Link
              to="/"
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              <Camera className="h-3.5 w-3.5" aria-hidden="true" />
              Submit Trip
            </Link>
            <Link
              to="/my-trips"
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              My Trips
            </Link>
            <Link
              to="/profile"
              className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              My Profile
            </Link>
          </div>
        </nav>
      </div>
    </AppShell>
  );
}
