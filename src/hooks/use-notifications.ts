/**
 * In-app notification system — useNotifications hook + NotificationBell component.
 *
 * Uses Supabase Realtime to deliver real-time notifications to the current user.
 * Notifications are derived from audit_log events relevant to the user's trips.
 *
 * Architecture:
 * - Supabase Realtime subscribes to INSERT events on audit_logs for the user's trips
 * - Toast notifications are shown via the sonner library
 * - A notification count badge is shown in the AppShell header
 */
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { auditActionLabel } from "@/lib/services/audit";
import type { AuditLog } from "@/lib/supabase/types";

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  tripId: string | null;
  createdAt: string;
  read: boolean;
}

const ACTION_TITLES: Record<string, string> = {
  verification_completed: "Verification Complete",
  manual_review_resolved: "Review Resolved",
  trip_status_updated: "Trip Status Updated",
  trip_assigned: "Trip Assigned to You",
  evidence_uploaded: "Evidence Uploaded",
};

function toNotification(log: AuditLog): AppNotification {
  const title = ACTION_TITLES[log.action] ?? auditActionLabel(log.action);
  const meta = log.metadata ?? {};
  let body = "";
  if ("new_status" in meta) body = `Status changed to: ${String(meta["new_status"])}`;
  else if ("decision" in meta) body = `Decision: ${String(meta["decision"])}`;
  else body = title;

  return {
    id: log.id,
    title,
    body,
    tripId: log.trip_id ?? null,
    createdAt: log.created_at,
    read: false,
  };
}

export function useNotifications(userId: string | null) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  useEffect(() => {
    if (!userId) return;

    // Subscribe to audit_logs for trips owned by this user
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "audit_logs",
          // Filter: only events where actor_id != the current user
          // (i.e., someone else changed their trip — a review resolution, assignment, etc.)
        },
        (payload) => {
          const log = payload.new as AuditLog;

          // Only surface events the user cares about
          const surfaced = [
            "verification_completed",
            "manual_review_resolved",
            "trip_assigned",
            "trip_status_updated",
          ];
          if (!surfaced.includes(log.action)) return;
          // Don't notify about user's own actions
          if (log.actor_id === userId) return;

          const notif = toNotification(log);
          setNotifications((prev) => [notif, ...prev.slice(0, 19)]); // cap at 20

          // Show a toast
          toast(notif.title, {
            description: notif.body,
            duration: 5000,
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return { notifications, unreadCount, markAllRead, dismiss };
}
