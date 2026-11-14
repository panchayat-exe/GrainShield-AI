"""
Phase 3 patch:
1. Update mobile/app.json — add ACCESS_BACKGROUND_LOCATION, isAndroidBackgroundLocationEnabled
2. Update mobile/hooks/use-gps-tracking.ts — add background location support via expo-task-manager
"""
import json
from pathlib import Path

ROOT = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED")

# ── 1. app.json ──
app_json_path = ROOT / "mobile/app.json"
data = json.loads(app_json_path.read_text(encoding="utf-8"))

android = data["expo"].setdefault("android", {})
perms = android.setdefault("permissions", [])
if "android.permission.ACCESS_BACKGROUND_LOCATION" not in perms:
    perms.append("android.permission.ACCESS_BACKGROUND_LOCATION")
    print("✓ Added ACCESS_BACKGROUND_LOCATION permission")

# Update expo-location plugin config
plugins = data["expo"].get("plugins", [])
for i, plugin in enumerate(plugins):
    if isinstance(plugin, list) and plugin[0] == "expo-location":
        cfg = plugin[1] if len(plugin) > 1 else {}
        cfg["isAndroidBackgroundLocationEnabled"] = True
        cfg["isIosBackgroundLocationEnabled"] = True
        plugins[i] = ["expo-location", cfg]
        print("✓ Added background location to expo-location plugin config")
        break

app_json_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
print("✓ app.json updated")

# ── 2. use-gps-tracking.ts ──
gps_path = ROOT / "mobile/hooks/use-gps-tracking.ts"
text = gps_path.read_text(encoding="utf-8").replace("\r\n", "\n")

# a. Add TaskManager import
if "expo-task-manager" not in text:
    text = text.replace(
        'import * as Location from "expo-location";',
        'import * as Location from "expo-location";\nimport * as TaskManager from "expo-task-manager";'
    )
    print("✓ Added expo-task-manager import")

# b. Add LOCATION_TASK_NAME constant and position cache
if "LOCATION_TASK_NAME" not in text:
    text = text.replace(
        "const PUSH_INTERVAL_MS = 30_000;",
        """const PUSH_INTERVAL_MS = 30_000;
const LOCATION_TASK_NAME = "grainshield-location-task";

// Module-level shared state for background task to access
let _backgroundTripId: string | null = null;
let _backgroundUserId: string | null = null;
let _latestBackgroundPosition: Location.LocationObject | null = null;"""
    )
    print("✓ Added LOCATION_TASK_NAME and background state")

# c. Register background task (before the hook function)
if "TaskManager.defineTask" not in text:
    task_registration = '''
// Register background location task (must be at module level, outside any component/hook)
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }: TaskManager.TaskManagerTaskBody<{ locations: Location.LocationObject[] }>) => {
  if (error) {
    console.warn("[GpsTracking] Background task error:", error.message);
    return;
  }
  if (data?.locations?.length) {
    _latestBackgroundPosition = data.locations[data.locations.length - 1];
  }
});

'''
    # Insert before the hook function
    hook_start = text.find("export function useGpsTracking(")
    text = text[:hook_start] + task_registration + text[hook_start:]
    print("✓ Registered background TaskManager task")

# d. Update startTracking to request background permission and use background updates
OLD_START = """    // Request foreground permission
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      setGpsStatus("error_permission");
      setLastError("Location permission denied. Please allow location access and try again.");
      return;
    }

    // Start watching position
    try {
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 10_000,
          distanceInterval: 10,
        },
        (pos) => {
          latestPositionRef.current = pos;
          setGpsStatus("active");
          setLastError(null);
        }
      );
      subscriptionRef.current = sub;
    } catch {
      setGpsStatus("error_unavailable");
      setLastError("Could not obtain GPS position. Make sure GPS is enabled.");
      return;
    }"""

NEW_START = """    // Request foreground permission
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== "granted") {
      setGpsStatus("error_permission");
      setLastError("Location permission denied. Please allow location access and try again.");
      return;
    }

    // Request background permission (Android 10+ requires explicit grant)
    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    const hasBackground = bgStatus === "granted";

    // Set module-level trip context for background task
    _backgroundTripId = tripId;
    _backgroundUserId = userId;

    if (hasBackground) {
      // Start background location updates via TaskManager
      try {
        const isRegistered = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
        if (!isRegistered) {
          await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
            accuracy: Location.Accuracy.High,
            timeInterval: 10_000,
            distanceInterval: 10,
            showsBackgroundLocationIndicator: true,
            foregroundService: {
              notificationTitle: "GrainShield AI",
              notificationBody: "Tracking trip location…",
              notificationColor: "#7C0A02",
            },
          });
        }
        // Also watch in foreground to update latestPositionRef
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 10 },
          (pos) => {
            latestPositionRef.current = pos;
            setGpsStatus("active");
            setLastError(null);
          }
        );
        subscriptionRef.current = sub;
      } catch (err) {
        console.warn("[GpsTracking] Background start failed, falling back to foreground:", err);
        hasBackground && console.warn("[GpsTracking] Will use foreground only.");
        // Fall through to foreground watch
        try {
          const sub = await Location.watchPositionAsync(
            { accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 10 },
            (pos) => { latestPositionRef.current = pos; setGpsStatus("active"); setLastError(null); }
          );
          subscriptionRef.current = sub;
        } catch {
          setGpsStatus("error_unavailable");
          setLastError("Could not obtain GPS position. Make sure GPS is enabled.");
          return;
        }
      }
    } else {
      // No background permission — foreground only
      try {
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 10 },
          (pos) => {
            latestPositionRef.current = pos;
            setGpsStatus("active");
            setLastError(null);
          }
        );
        subscriptionRef.current = sub;
      } catch {
        setGpsStatus("error_unavailable");
        setLastError("Could not obtain GPS position. Make sure GPS is enabled.");
        return;
      }
    }"""

if OLD_START in text:
    text = text.replace(OLD_START, NEW_START)
    print("✓ Updated startTracking with background location")
else:
    print("⚠ OLD_START block not found — may already be patched or whitespace mismatch")

# e. Update stopTracking to stop background task
OLD_STOP = """  const stopTracking = useCallback(() => {
    if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setGpsStatus("idle");
  }, []);"""

NEW_STOP = """  const stopTracking = useCallback(() => {
    if (subscriptionRef.current) {
      subscriptionRef.current.remove();
      subscriptionRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    // Stop background location updates if running
    Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)
      .then((running) => {
        if (running) return Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      })
      .catch(() => {/* ignore */});
    _backgroundTripId = null;
    _backgroundUserId = null;
    setGpsStatus("idle");
  }, []);"""

if OLD_STOP in text:
    text = text.replace(OLD_STOP, NEW_STOP)
    print("✓ Updated stopTracking to stop background task")
else:
    print("⚠ stopTracking pattern not matched exactly")

# Write back
final = text.replace("\n", "\r\n")
gps_path.write_bytes(final.encode("utf-8"))
print(f"\n✅ use-gps-tracking.ts patched ({len(final)} bytes)")
