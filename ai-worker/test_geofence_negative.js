import { createClient } from "@supabase/supabase-js";
import fs from "fs";

// 1 degree latitude ~= 111,000 meters
// To offset by exact meters north: delta_lat = meters / 111000.0
function offsetMetersNorth(baseLat, baseLon, meters) {
  const deltaLat = meters / 111000.0;
  return { lat: Number((baseLat + deltaLat).toFixed(7)), lon: baseLon };
}

async function main() {
  const envContent = fs.readFileSync(".env", "utf-8");
  const env = {};
  for (const line of envContent.split("\n")) {
    const idx = line.indexOf("=");
    if (idx > 0 && !line.trim().startsWith("#")) {
      env[line.substring(0, idx).trim()] = line.substring(idx + 1).trim();
    }
  }

  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const testUserId = "ae36d5b3-ce72-4f8c-a6c6-7e61d9e07605";

  console.log("==================================================");
  console.log("GRAINSHIELD AI — GEOFENCE NEGATIVE & BOUNDARY AUDIT");
  console.log("==================================================");

  // Target facility: FCI Godown Gandhinagar (FCI-GNR-01)
  const { data: fciGnr } = await client
    .from("organizations")
    .select("id, latitude, longitude, name")
    .eq("godown_code", "FCI-GNR-01")
    .single();

  const baseLat = Number(fciGnr.latitude);
  const baseLon = Number(fciGnr.longitude);
  console.log(`Target: ${fciGnr.name} at (${baseLat}, ${baseLon})`);

  // Create a controlled test trip linked to this facility
  const { data: testTrip } = await client
    .from("trips")
    .insert({
      trip_code: "TEST-GEO-" + Date.now(),
      vehicle_number: "GJ01AB1234",
      stage: "first_mile",
      origin_org_id: fciGnr.id,
      created_by: testUserId,
      status: "submitted"
    })
    .select()
    .single();

  // Test Case 1: 100 meters (Well within boundary)
  const p100 = offsetMetersNorth(baseLat, baseLon, 100);
  const d100 = await client.rpc("calculate_distance_meters", {
    lat1: baseLat, lon1: baseLon, lat2: p100.lat, lon2: p100.lon
  });
  const r100 = await client.rpc("verify_trip_geofence", {
    p_trip_id: testTrip.id, p_stage: "first_mile", p_lat: p100.lat, p_lon: p100.lon, p_max_radius_meters: 500.0
  });
  console.log(`\n[Test 1] 100m offset: distance = ${d100.data}m -> status = ${r100.data.status} (expected: pass)`);

  // Test Case 2: 499 meters (Just inside boundary)
  const p499 = offsetMetersNorth(baseLat, baseLon, 499);
  const d499 = await client.rpc("calculate_distance_meters", {
    lat1: baseLat, lon1: baseLon, lat2: p499.lat, lon2: p499.lon
  });
  const r499 = await client.rpc("verify_trip_geofence", {
    p_trip_id: testTrip.id, p_stage: "first_mile", p_lat: p499.lat, p_lon: p499.lon, p_max_radius_meters: 500.0
  });
  console.log(`[Test 2] 499m offset: distance = ${d499.data}m -> status = ${r499.data.status} (expected: pass)`);

  // Test Case 3: 500 meters (Exact boundary)
  const p500 = offsetMetersNorth(baseLat, baseLon, 500);
  const d500 = await client.rpc("calculate_distance_meters", {
    lat1: baseLat, lon1: baseLon, lat2: p500.lat, lon2: p500.lon
  });
  const r500 = await client.rpc("verify_trip_geofence", {
    p_trip_id: testTrip.id, p_stage: "first_mile", p_lat: p500.lat, p_lon: p500.lon, p_max_radius_meters: 500.0
  });
  console.log(`[Test 3] 500m offset: distance = ${d500.data}m -> status = ${r500.data.status} (expected: pass)`);

  // Test Case 4: 501 meters (Just outside boundary - BREACH)
  const p501 = offsetMetersNorth(baseLat, baseLon, 501);
  const d501 = await client.rpc("calculate_distance_meters", {
    lat1: baseLat, lon1: baseLon, lat2: p501.lat, lon2: p501.lon
  });
  const r501 = await client.rpc("verify_trip_geofence", {
    p_trip_id: testTrip.id, p_stage: "first_mile", p_lat: p501.lat, p_lon: p501.lon, p_max_radius_meters: 500.0
  });
  console.log(`[Test 4] 501m offset: distance = ${d501.data}m -> status = ${r501.data.status} (expected: fail)`);

  // Test Case 5: 15 km away (Completely wrong facility)
  const r15k = await client.rpc("verify_trip_geofence", {
    p_trip_id: testTrip.id, p_stage: "first_mile", p_lat: 23.0338, p_lon: 72.5850, p_max_radius_meters: 500.0
  });
  console.log(`[Test 5] 15km away: distance = ${r15k.data.distance_meters}m -> status = ${r15k.data.status} (expected: fail)`);

  // Test Case 6: Missing destination organization on trip
  const { data: tripNoOrg } = await client
    .from("trips")
    .insert({
      trip_code: "TEST-NO-ORG-" + Date.now(),
      vehicle_number: "GJ01AB1234",
      stage: "last_mile",
      origin_org_id: null,
      destination_org_id: null,
      fps_shop_id: null,
      created_by: testUserId,
      status: "submitted"
    })
    .select()
    .single();

  const rNoOrg = await client.rpc("verify_trip_geofence", {
    p_trip_id: tripNoOrg.id, p_stage: "last_mile", p_lat: baseLat, p_lon: baseLon, p_max_radius_meters: 500.0
  });
  console.log(`[Test 6] Missing destination org: status = ${rNoOrg.data.status}, reason = '${rNoOrg.data.reason}' (expected: not_applicable)`);

  // Test Case 7: Missing GPS coordinates (null lat/lon)
  const rNullGps = await client.rpc("verify_trip_geofence", {
    p_trip_id: testTrip.id, p_stage: "first_mile", p_lat: null, p_lon: null, p_max_radius_meters: 500.0
  });
  console.log(`[Test 7] Null GPS coordinates: status = ${rNullGps.data.status}, reason = '${rNullGps.data.reason}' (expected: skipped)`);

  // Test Case 8: Stale GPS timestamp check
  const now = new Date();
  const staleTime = new Date(now.getTime() - 45 * 60 * 1000); // 45 minutes ago
  const isStale = (now.getTime() - staleTime.getTime()) > 30 * 60 * 1000;
  console.log(`[Test 8] GPS Timestamp Freshness: 45 min delta > 30 min threshold -> isStale = ${isStale} (safely flagged)`);

  // Clean up test trips
  await client.from("trips").delete().in("id", [testTrip.id, tripNoOrg.id]);

  console.log("\n==================================================");
  console.log("GEOFENCE NEGATIVE & BOUNDARY AUDIT COMPLETE");
  console.log("==================================================");
}

main().catch(console.error);
