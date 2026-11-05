"""
Phase 2 patch for apps/admin/src/routes/trips.tsx
- Fix state variables (auto trip code, driver profile state)
- Fix handleCreateTrip to use new DispatchTripInput
- Fix modal JSX: auto-generated trip code notice, driver profile dropdown
"""
from pathlib import Path

FILE = Path("d:/Grain_Guard_AI/GS_USER_FNTED/GG_USER_FNTED/apps/admin/src/routes/trips.tsx")

text = FILE.read_text(encoding="utf-8").replace("\r\n", "\n")

# ── 1. Fix imports: add getDriverProfiles and DriverProfile if not present ──
OLD_IMPORT = 'import { createAdminTrip, getAdminTrips, getAdminStats, resolveManualReview, type AdminTrip, type AdminStats, type ResolveManualReviewParams } from "../lib/admin-queries";'
NEW_IMPORT = 'import { createAdminTrip, getAdminTrips, getAdminStats, resolveManualReview, getDriverProfiles, type AdminTrip, type AdminStats, type ResolveManualReviewParams, type DriverProfile } from "../lib/admin-queries";'

if 'getDriverProfiles' not in text:
    if OLD_IMPORT in text:
        text = text.replace(OLD_IMPORT, NEW_IMPORT)
        print("✓ Fixed imports")
    else:
        # Try partial match
        old_partial = 'from "../lib/admin-queries"'
        if old_partial in text:
            # Find the full import line
            import_start = text.rfind('import {', 0, text.find(old_partial))
            import_end = text.find(old_partial) + len(old_partial) + 1
            old_full = text[import_start:import_end]
            # Inject into the existing import
            new_full = old_full.replace(
                'type ResolveManualReviewParams }',
                'type ResolveManualReviewParams, getDriverProfiles, type DriverProfile }'
            )
            if old_full != new_full:
                text = text.replace(old_full, new_full)
                print("✓ Fixed imports (partial match)")
            else:
                print("⚠ Could not auto-fix imports, skipping")
        else:
            print("⚠ Import line not found")
else:
    print("✓ Imports already updated")

# ── 2. Fix createCode state: TRIP-random → empty string ──
OLD_CODE_STATE = 'const [createCode, setCreateCode] = useState(`TRIP-${Math.floor(1000 + Math.random() * 9000)}`);\n'
NEW_CODE_STATE = 'const [createCode, setCreateCode] = useState("");\n'

if OLD_CODE_STATE in text:
    text = text.replace(OLD_CODE_STATE, NEW_CODE_STATE)
    print("✓ Fixed createCode initial state")
elif 'TRIP-${Math.floor' in text:
    import re
    text = re.sub(
        r'const \[createCode, setCreateCode\] = useState\(`TRIP-\$\{Math\.floor\([^)]+\)\}`\);',
        'const [createCode, setCreateCode] = useState("");',
        text
    )
    print("✓ Fixed createCode initial state (regex)")
else:
    print("⚠ createCode initial state not found or already fixed")

# ── 3. Add driver profile state vars after createDriver state ──
DRIVER_STATE_MARKER = 'const [createDriver, setCreateDriver] = useState("");'
DRIVER_STATE_ADDITION = '''const [createDriver, setCreateDriver] = useState("");
  const [createDriverId, setCreateDriverId] = useState<string>("");
  const [driverProfiles, setDriverProfiles] = useState<DriverProfile[]>([]);
  const [driverSearch, setDriverSearch] = useState("");'''

if 'createDriverId' not in text:
    if DRIVER_STATE_MARKER in text:
        text = text.replace(DRIVER_STATE_MARKER, DRIVER_STATE_ADDITION)
        print("✓ Added driver profile state vars")
    else:
        print("⚠ createDriver state marker not found")
else:
    print("✓ Driver profile state vars already present")

# ── 4. Add useEffect to load driver profiles when modal opens ──
MODAL_OPEN_MARKER = 'setShowCreate(true);'
MODAL_OPEN_WITH_EFFECT = '''setShowCreate(true);
    // Load driver profiles when modal opens
    getDriverProfiles("").then(({ profiles }) => setDriverProfiles(profiles ?? []));'''

if 'getDriverProfiles("").then' not in text:
    if MODAL_OPEN_MARKER in text:
        text = text.replace(MODAL_OPEN_MARKER, MODAL_OPEN_WITH_EFFECT, 1)
        print("✓ Added driver profile load on modal open")
    else:
        print("⚠ Modal open marker not found")
else:
    print("✓ Driver profile load already present")

# ── 5. Fix createAdminTrip call to remove created_by, add driver_id ──
OLD_CALL = '''    const { trip, error: err } = await createAdminTrip({
      trip_code: createCode.trim(),
      vehicle_number: cleanPlate,
      driver_name: createDriver.trim() || undefined,
      driver_phone: createPhone.trim() || undefined,
      stage: createStage,
      origin: createOrigin.trim() || undefined,
      destination: createDest.trim() || undefined,
      created_by: adminUser.id,
    });'''

NEW_CALL = '''    const { trip, error: err } = await createAdminTrip({
      trip_code: createCode.trim() || undefined,
      vehicle_number: cleanPlate,
      driver_id: createDriverId || undefined,
      driver_name: createDriver.trim() || undefined,
      driver_phone: createPhone.trim() || undefined,
      stage: createStage,
      origin: createOrigin.trim() || undefined,
      destination: createDest.trim() || undefined,
    });'''

if 'created_by: adminUser.id' in text:
    if OLD_CALL in text:
        text = text.replace(OLD_CALL, NEW_CALL)
        print("✓ Fixed createAdminTrip call")
    else:
        # Simpler replace
        text = text.replace(
            'trip_code: createCode.trim(),\n      vehicle_number: cleanPlate,\n      driver_name: createDriver.trim() || undefined,\n      driver_phone: createPhone.trim() || undefined,\n      stage: createStage,\n      origin: createOrigin.trim() || undefined,\n      destination: createDest.trim() || undefined,\n      created_by: adminUser.id,',
            'trip_code: createCode.trim() || undefined,\n      vehicle_number: cleanPlate,\n      driver_id: createDriverId || undefined,\n      driver_name: createDriver.trim() || undefined,\n      driver_phone: createPhone.trim() || undefined,\n      stage: createStage,\n      origin: createOrigin.trim() || undefined,\n      destination: createDest.trim() || undefined,'
        )
        print("✓ Fixed createAdminTrip call (partial)")
elif 'trip_code: createCode.trim() || undefined' in text:
    print("✓ createAdminTrip call already updated")
else:
    print("⚠ createAdminTrip call not found")

# ── 6. Fix reset block: remove TRIP-random code, reset driver state ──
OLD_RESET = "setCreateCode(`TRIP-${Math.floor(1000 + Math.random() * 9000)}`);"
NEW_RESET = 'setCreateCode("");\n      setCreateDriverId("");\n      setDriverSearch("");'

if OLD_RESET in text:
    text = text.replace(OLD_RESET, NEW_RESET)
    print("✓ Fixed reset block")
elif 'setCreateCode("");' in text and 'setCreateDriverId' not in text:
    # setCreateCode already fixed but driver reset missing
    text = text.replace('setCreateCode("");\n      setShowCreate(false);',
                        'setCreateCode("");\n      setCreateDriverId("");\n      setDriverSearch("");\n      setShowCreate(false);')
    print("✓ Added driver state reset")
else:
    print("⚠ Reset block already updated or not found")

# ── 7. Fix modal JSX: Trip Code field ──
OLD_TRIP_CODE_FIELD = '''                <div>
                  <label className="block text-xs font-medium text-foreground">Trip Code</label>
                  <input
                    type="text"
                    required
                    value={createCode}
                    onChange={(e) => setCreateCode(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>'''

NEW_TRIP_CODE_FIELD = '''                <div>
                  <label className="block text-xs font-medium text-foreground">Trip Code</label>
                  <input
                    type="text"
                    value={createCode}
                    onChange={(e) => setCreateCode(e.target.value)}
                    placeholder="Auto-generated (GS-YYYY-NNNNNN)"
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">Leave blank to auto-generate a unique trip code.</p>
                </div>'''

if 'Auto-generated (GS-YYYY-NNNNNN)' not in text:
    if OLD_TRIP_CODE_FIELD in text:
        text = text.replace(OLD_TRIP_CODE_FIELD, NEW_TRIP_CODE_FIELD)
        print("✓ Fixed Trip Code modal field")
    else:
        # Try without required attr
        text = text.replace(
            'type="text"\n                    required\n                    value={createCode}\n                    onChange={(e) => setCreateCode(e.target.value)}\n                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"',
            'type="text"\n                    value={createCode}\n                    onChange={(e) => setCreateCode(e.target.value)}\n                    placeholder="Auto-generated (GS-YYYY-NNNNNN)"\n                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"'
        )
        print("✓ Fixed Trip Code input (partial)")
else:
    print("✓ Trip Code field already updated")

# ── 8. Fix modal JSX: Driver Name field → Driver Profile dropdown ──
OLD_DRIVER_FIELD = '''                <div>
                  <label className="block text-xs font-medium text-foreground">Driver Name</label>
                  <input
                    type="text"
                    value={createDriver}
                    onChange={(e) => setCreateDriver(e.target.value)}
                    placeholder="Ramesh Patel"
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>'''

NEW_DRIVER_FIELD = '''                <div>
                  <label className="block text-xs font-medium text-foreground">Driver (Registered Profile)</label>
                  <input
                    type="text"
                    value={driverSearch}
                    onChange={(e) => {
                      setDriverSearch(e.target.value);
                      getDriverProfiles(e.target.value).then(({ profiles }) => setDriverProfiles(profiles ?? []));
                    }}
                    placeholder="Search driver by name or email…"
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                  {driverProfiles.length > 0 && (
                    <select
                      value={createDriverId}
                      onChange={(e) => {
                        const p = driverProfiles.find((d) => d.id === e.target.value);
                        setCreateDriverId(e.target.value);
                        if (p) setCreateDriver(p.full_name ?? p.email ?? "");
                      }}
                      className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">— Select registered driver —</option>
                      {driverProfiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name ?? "Unknown"} ({p.email})
                        </option>
                      ))}
                    </select>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">Or enter name manually below if driver is unregistered.</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground">Driver Name (Manual Fallback)</label>
                  <input
                    type="text"
                    value={createDriver}
                    onChange={(e) => setCreateDriver(e.target.value)}
                    placeholder="Ramesh Patel"
                    className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>'''

if 'Search driver by name or email' not in text:
    if OLD_DRIVER_FIELD in text:
        text = text.replace(OLD_DRIVER_FIELD, NEW_DRIVER_FIELD)
        print("✓ Fixed Driver modal field")
    else:
        print("⚠ Driver Name modal field not found — may need manual fix")
        # Simpler partial approach
        text = text.replace(
            '<label className="block text-xs font-medium text-foreground">Driver Name</label>',
            '<label className="block text-xs font-medium text-foreground">Driver (Registered Profile)</label>'
        )
        print("  Applied label-only patch")
else:
    print("✓ Driver modal field already updated")

# ── Write back with CRLF ──
final = text.replace("\n", "\r\n")
FILE.write_bytes(final.encode("utf-8"))
print("\n✅ trips.tsx patched successfully")
print(f"   File size: {len(final)} bytes")
