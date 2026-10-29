/**
 * Safe Supabase Connectivity & Authentication Check
 * Tests that the configured SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY can
 * authenticate and query the verification queue without exposing credentials.
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");

if (typeof process.loadEnvFile === "function" && existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // Ignore if already loaded
  }
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

console.log("=== Supabase Connection & Auth Test ===");
console.log(`Project URL: ${url ? url : "[MISSING]"}`);

if (!url) {
  console.error("FAIL: SUPABASE_URL is not set in ai-worker/.env");
  process.exit(1);
}

if (!key) {
  console.error("FAIL: Neither SUPABASE_SERVICE_ROLE_KEY nor SUPABASE_SECRET_KEY is set in ai-worker/.env");
  process.exit(1);
}

if (key.includes("YOUR_") || key.includes("placeholder")) {
  console.error("FAIL: Key still contains placeholder value ('YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE').");
  console.error("Please update ai-worker/.env with your real secret key from the Supabase dashboard:");
  console.error("  Dashboard -> Project Settings -> API -> Project API Keys -> service_role (secret)");
  process.exitCode = 1;
} else if (key.startsWith("sb_publishable_")) {
  console.error("FAIL: The configured key is a publishable/anon key ('sb_publishable_...').");
  console.error("The worker requires the server-side service_role secret key to bypass RLS and process jobs.");
  console.error("Please paste the 'service_role' (secret) key into ai-worker/.env instead.");
  process.exitCode = 1;
} else {
  const maskedKey = key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : "[too short]";
  console.log(`Configured key: length=${key.length}, masked=${maskedKey}`);

  const client = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    console.log("Testing Supabase connectivity and service permissions:");

    // 1. verification_results
    const { data: verRows, error: verErr } = await client
      .from("verification_results")
      .select("id, status")
      .limit(1);
    if (verErr) throw new Error(`verification_results table access failed: ${verErr.message}`);
    console.log(`  ✓ verification_results table accessible (${verRows.length} sample row)`);

    // 2. trips
    const { data: tripRows, error: tripErr } = await client
      .from("trips")
      .select("id, vehicle_number")
      .limit(1);
    if (tripErr) throw new Error(`trips table access failed: ${tripErr.message}`);
    console.log(`  ✓ trips table accessible (${tripRows.length} sample row)`);

    // 3. trip_evidence
    const { data: evRows, error: evErr } = await client
      .from("trip_evidence")
      .select("id, storage_path")
      .limit(1);
    if (evErr) throw new Error(`trip_evidence table access failed: ${evErr.message}`);
    console.log(`  ✓ trip_evidence table accessible (${evRows.length} sample row)`);

    // 4. storage bucket trip-evidence
    const { data: bucketList, error: bucketErr } = await client.storage
      .from("trip-evidence")
      .list("", { limit: 1 });
    if (bucketErr) throw new Error(`trip-evidence storage access failed: ${bucketErr.message}`);
    console.log(`  ✓ trip-evidence private storage bucket accessible (${bucketList.length} items listed)`);

    console.log("\n=======================================================");
    console.log("SUCCESS: All Supabase worker permissions are verified!");
    console.log("=======================================================");
  } catch (err) {
    console.error(`FAIL: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

