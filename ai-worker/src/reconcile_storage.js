/**
 * GrainShield AI — Storage & Evidence Reconciliation Service
 * 
 * Inspects private storage bucket 'trip-evidence' against the 'trip_evidence' table.
 * Identifies:
 *   1. Orphaned Storage Objects: Files present in storage with no corresponding row in trip_evidence.
 *   2. Missing Evidence Files: Rows in trip_evidence whose storage_path is not in storage.
 * 
 * Supports:
 *   --dry-run (default): Only scans and reports discrepancies.
 *   --execute: Prunes orphaned storage objects older than minAgeMs (default: 1 hour) and logs to audit_logs.
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const idx = line.indexOf("=");
      if (idx > 0 && !line.trim().startsWith("#")) {
        const k = line.substring(0, idx).trim();
        const v = line.substring(idx + 1).trim();
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
}

loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BUCKET = "trip-evidence";

/**
 * Recursively list all files in the bucket.
 */
export async function listAllStorageObjects(prefix = "") {
  const allObjects = [];
  const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
    limit: 100,
    offset: 0,
    sortBy: { column: "created_at", order: "desc" },
  });

  if (error) {
    throw new Error(`Failed to list bucket objects at '${prefix}': ${error.message}`);
  }

  for (const item of data || []) {
    // If id is null or metadata has no mimetype, it might be a folder
    if (item.id === null || !item.metadata) {
      const subPrefix = prefix ? `${prefix}/${item.name}` : item.name;
      const subItems = await listAllStorageObjects(subPrefix);
      allObjects.push(...subItems);
    } else {
      const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
      allObjects.push({
        name: fullPath,
        created_at: item.created_at,
        updated_at: item.updated_at,
        size: item.metadata?.size || 0,
      });
    }
  }

  return allObjects;
}

/**
 * Reconcile storage against database.
 */
export async function reconcileStorage(options = {}) {
  const { execute = false, minAgeMinutes = 60 } = options;
  const now = Date.now();
  const minAgeMs = minAgeMinutes * 60 * 1000;

  console.log(`[reconcile] Scanning storage bucket '${BUCKET}'...`);
  const storageObjects = await listAllStorageObjects();
  console.log(`[reconcile] Found ${storageObjects.length} total storage object(s).`);

  console.log("[reconcile] Fetching all registered evidence paths from database...");
  const { data: dbRows, error: dbErr } = await supabase
    .from("trip_evidence")
    .select("id, trip_id, storage_path, uploaded_at");

  if (dbErr) {
    throw new Error(`Failed to query trip_evidence: ${dbErr.message}`);
  }

  const dbPaths = new Set((dbRows || []).map((r) => r.storage_path));
  console.log(`[reconcile] Found ${dbPaths.size} registered evidence record(s).`);

  const storagePathMap = new Map(storageObjects.map((o) => [o.name, o]));

  // 1. Identify Orphaned Storage Objects
  const orphanedObjects = [];
  const activeOrphanGrace = [];

  for (const obj of storageObjects) {
    if (!dbPaths.has(obj.name)) {
      const createdAtMs = obj.created_at ? new Date(obj.created_at).getTime() : 0;
      const ageMs = now - createdAtMs;
      if (ageMs > minAgeMs) {
        orphanedObjects.push(obj);
      } else {
        activeOrphanGrace.push(obj);
      }
    }
  }

  // 2. Identify Missing Evidence Objects (DB rows with no file in storage)
  const missingStorageRecords = [];
  for (const row of dbRows || []) {
    if (row.storage_path && !storagePathMap.has(row.storage_path)) {
      missingStorageRecords.push(row);
    }
  }

  const report = {
    totalStorageObjects: storageObjects.length,
    totalDbRecords: dbRows.length,
    orphanedCount: orphanedObjects.length,
    gracePeriodCount: activeOrphanGrace.length,
    missingStorageCount: missingStorageRecords.length,
    orphanedObjects,
    missingStorageRecords,
    prunedObjects: [],
  };

  console.log("\n=== RECONCILIATION SUMMARY ===");
  console.log(`Total Storage Objects:      ${report.totalStorageObjects}`);
  console.log(`Total DB Evidence Records:  ${report.totalDbRecords}`);
  console.log(`Orphaned Storage Objects:   ${report.orphanedCount} (eligible for pruning)`);
  console.log(`In-flight / Grace Objects:  ${report.gracePeriodCount} (< ${minAgeMinutes} mins old)`);
  console.log(`Missing Storage Records:    ${report.missingStorageCount} (DB record without storage file)`);

  if (execute && orphanedObjects.length > 0) {
    console.log(`\n[reconcile] Executing pruning of ${orphanedObjects.length} orphaned object(s)...`);
    const pathsToRemove = orphanedObjects.map((o) => o.name);
    const { data: removeData, error: removeErr } = await supabase.storage
      .from(BUCKET)
      .remove(pathsToRemove);

    if (removeErr) {
      console.error("[reconcile] Failed to prune orphaned objects:", removeErr.message);
    } else {
      console.log(`[reconcile] ✓ Successfully pruned ${pathsToRemove.length} orphaned object(s).`);
      report.prunedObjects = pathsToRemove;

      // Log to audit_logs
      await supabase.from("audit_logs").insert({
        actor_id: null,
        action: "storage_reconciliation_pruned",
        entity_type: "storage.objects",
        metadata: {
          pruned_count: pathsToRemove.length,
          pruned_paths: pathsToRemove,
          timestamp: new Date().toISOString(),
        },
      });
    }
  } else if (!execute && orphanedObjects.length > 0) {
    console.log("[reconcile] Dry-run mode: no files were deleted. Pass --execute to prune.");
  }

  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isExecute = process.argv.includes("--execute");
  reconcileStorage({ execute: isExecute, minAgeMinutes: 60 })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Reconciliation error:", err);
      process.exit(1);
    });
}
