/**
 * OutboxBanner component.
 * Displays offline status and pending outbox queue with one-tap sync.
 */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import {
  getOutboxItems,
  syncAllOutbox,
  type OutboxItem,
} from "@/lib/offline/outbox";
import { Colors, FontSizes, Spacing, Radius } from "@/constants/colors";
import { useAuth } from "@/hooks/use-auth";

export function OutboxBanner() {
  const { user, isOffline } = useAuth();
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [syncing, setSyncing] = useState(false);

  const refreshCount = useCallback(async () => {
    const list = await getOutboxItems();
    setItems(list);
  }, []);

  useEffect(() => {
    void refreshCount();
    const interval = setInterval(refreshCount, 5000);
    return () => clearInterval(interval);
  }, [refreshCount]);

  async function handleSync() {
    if (!user) {
      Alert.alert(
        "Sign In Required",
        "Please sign in to your online account to sync outbox items to Supabase.",
      );
      return;
    }
    setSyncing(true);
    try {
      const result = await syncAllOutbox(user.id);
      await refreshCount();
      if (result.synced > 0 && result.failed === 0) {
        Alert.alert(
          "✅ Sync Complete",
          `Successfully uploaded ${result.synced} trip(s) to Supabase cloud. Trip IDs have been assigned.`,
        );
      } else if (result.synced > 0 && result.failed > 0) {
        Alert.alert(
          "⚠️ Partial Sync",
          `${result.synced} trip(s) uploaded. ${result.failed} failed: ${result.errors[0] ?? "Check internet connection."}`,
        );
      } else if (result.failed > 0) {
        Alert.alert(
          "❌ Sync Failed",
          `Could not connect to Supabase: ${result.errors[0] ?? "Check internet connection and try again."}`,
        );
      } else {
        Alert.alert("Outbox Empty", "All items have already been synced.");
      }
    } finally {
      setSyncing(false);
    }
  }

  if (items.length === 0 && !isOffline) {
    return null;
  }

  return (
    <View style={[styles.container, isOffline && styles.containerOffline]}>
      <View style={styles.textCol}>
        <Text style={styles.title}>
          {isOffline ? "⚡ Offline Field Mode" : "📦 Outbox Queue"}
        </Text>
        <Text style={styles.subtitle}>
          {items.length > 0
            ? `${items.length} trip(s) saved offline — tap Sync Now to upload`
            : "Trips & photos are saved locally on this phone"}
        </Text>
      </View>

      {items.length > 0 && (
        <TouchableOpacity
          style={[styles.syncBtn, syncing && styles.syncBtnDisabled]}
          onPress={handleSync}
          disabled={syncing}
        >
          {syncing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.syncBtnText}>Sync Now</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.warningSoft,
    borderBottomWidth: 1,
    borderBottomColor: Colors.warning,
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  containerOffline: {
    backgroundColor: Colors.infoSoft,
    borderBottomColor: Colors.info,
  },
  textCol: {
    flex: 1,
    marginRight: Spacing[2],
  },
  title: {
    fontSize: FontSizes.xs,
    fontWeight: "700",
    color: Colors.foreground,
  },
  subtitle: {
    fontSize: FontSizes.xs,
    color: Colors.mutedForeground,
  },
  syncBtn: {
    backgroundColor: Colors.saffron,
    paddingHorizontal: Spacing[3],
    paddingVertical: 6,
    borderRadius: Radius.md,
  },
  syncBtnDisabled: {
    opacity: 0.6,
  },
  syncBtnText: {
    color: Colors.saffronForeground,
    fontWeight: "700",
    fontSize: FontSizes.xs,
  },
});
