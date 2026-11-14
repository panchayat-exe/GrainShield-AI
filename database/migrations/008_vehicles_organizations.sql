-- =============================================================================
-- Migration 008: Vehicles Master Table & Organizations
-- GrainShield AI — Gujarat Food Grain Transport Verification
-- =============================================================================
-- Creates:
--   vehicles      — master registry of all transport vehicles
--   organizations — FCI godowns, GSCSCL godowns, Fair Price Shops
-- Updates:
--   trips         — soft FK validation via trigger (no hard FK to allow historical data)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Vehicle type enum
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE vehicle_type AS ENUM ('truck', 'mini_truck', 'tempo', 'tractor', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2. Organization type enum
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE org_type AS ENUM ('FCI', 'GSCSCL', 'FPS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 3. Organizations table (FCI godowns, GSCSCL godowns, Fair Price Shops)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  org_type        org_type NOT NULL,
  godown_code     text UNIQUE,                    -- official GSCSCL/FCI code
  district        text,
  taluka          text,
  address         text,
  latitude        numeric(10, 7),
  longitude       numeric(10, 7),
  contact_name    text,
  contact_phone   text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 4. Vehicles master table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_number      text NOT NULL UNIQUE,       -- e.g. GJ05AB1234 (normalized, no spaces)
  vehicle_type        vehicle_type NOT NULL DEFAULT 'truck',
  capacity_tonnes     numeric(6, 2),              -- payload capacity in metric tonnes
  owner_name          text,
  owner_phone         text,
  registration_expiry date,
  insurance_expiry    date,
  fitness_expiry      date,
  is_active           boolean NOT NULL DEFAULT true,
  organization_id     uuid REFERENCES organizations(id) ON DELETE SET NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookup by vehicle number (most common query)
CREATE INDEX IF NOT EXISTS idx_vehicles_vehicle_number ON vehicles(vehicle_number);
CREATE INDEX IF NOT EXISTS idx_vehicles_is_active ON vehicles(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_organizations_org_type ON organizations(org_type);
CREATE INDEX IF NOT EXISTS idx_organizations_district ON organizations(district);

-- ---------------------------------------------------------------------------
-- 5. Auto-update updated_at timestamp
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vehicles_updated_at ON vehicles;
CREATE TRIGGER trg_vehicles_updated_at
  BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_organizations_updated_at ON organizations;
CREATE TRIGGER trg_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---------------------------------------------------------------------------
-- 6. RLS Policies
-- ---------------------------------------------------------------------------
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- Vehicles: readable by authenticated users, writable by admins only
DROP POLICY IF EXISTS "vehicles_read" ON vehicles;
CREATE POLICY "vehicles_read" ON vehicles
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "vehicles_admin_write" ON vehicles;
CREATE POLICY "vehicles_admin_write" ON vehicles
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- Organizations: readable by authenticated users, writable by admins only
DROP POLICY IF EXISTS "organizations_read" ON organizations;
CREATE POLICY "organizations_read" ON organizations
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "organizations_admin_write" ON organizations;
CREATE POLICY "organizations_admin_write" ON organizations
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

-- ---------------------------------------------------------------------------
-- 7. Seed data — Gujarat demo organizations
-- ---------------------------------------------------------------------------
INSERT INTO organizations (name, org_type, godown_code, district, taluka) VALUES
  ('FCI Godown Ahmedabad Central',   'FCI',    'FCI-AMD-01', 'Ahmedabad',  'Daskroi'),
  ('FCI Godown Gandhinagar',         'FCI',    'FCI-GNR-01', 'Gandhinagar','Gandhinagar'),
  ('FCI Godown Vadodara',            'FCI',    'FCI-VDR-01', 'Vadodara',   'Vadodara City'),
  ('FCI Godown Surat',               'FCI',    'FCI-SRT-01', 'Surat',      'Surat City'),
  ('FCI Godown Rajkot',              'FCI',    'FCI-RJK-01', 'Rajkot',     'Rajkot City'),
  ('GSCSCL Godown Ahmedabad',        'GSCSCL', 'GS-AMD-01',  'Ahmedabad',  'Daskroi'),
  ('GSCSCL Godown Gandhinagar',      'GSCSCL', 'GS-GNR-01',  'Gandhinagar','Gandhinagar'),
  ('GSCSCL Godown Vadodara',         'GSCSCL', 'GS-VDR-01',  'Vadodara',   'Vadodara City'),
  ('GSCSCL Godown Surat',            'GSCSCL', 'GS-SRT-01',  'Surat',      'Surat City'),
  ('GSCSCL Godown Rajkot',           'GSCSCL', 'GS-RJK-01',  'Rajkot',     'Rajkot City'),
  ('FPS Ward 1 Ahmedabad',           'FPS',    'FPS-AMD-001','Ahmedabad',  'Daskroi'),
  ('FPS Ward 2 Ahmedabad',           'FPS',    'FPS-AMD-002','Ahmedabad',  'Daskroi'),
  ('FPS Ward 1 Gandhinagar',         'FPS',    'FPS-GNR-001','Gandhinagar','Gandhinagar'),
  ('FPS Ward 1 Vadodara',            'FPS',    'FPS-VDR-001','Vadodara',   'Vadodara City'),
  ('FPS Ward 1 Surat',               'FPS',    'FPS-SRT-001','Surat',      'Surat City')
ON CONFLICT (godown_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 8. Seed data — Demo vehicles (Gujarat number plates)
-- ---------------------------------------------------------------------------
INSERT INTO vehicles (vehicle_number, vehicle_type, capacity_tonnes, owner_name, is_active) VALUES
  ('GJ01AB1234', 'truck',      10.0, 'Ramesh Transport Co.',        true),
  ('GJ01CD5678', 'truck',      12.0, 'Gujarat Carriers Pvt Ltd',    true),
  ('GJ05AB9012', 'mini_truck',  5.0, 'Patel Logistics',             true),
  ('GJ05CD3456', 'tempo',       3.0, 'Suresh Hamal',                true),
  ('GJ07AB7890', 'truck',      15.0, 'Mehta Transport',             true),
  ('GJ07CD2345', 'truck',      10.0, 'Bharat Goods Carrier',        true),
  ('GJ09AB6789', 'mini_truck',  7.5, 'Jai Ambe Transport',          true),
  ('GJ09CD0123', 'tractor',     4.0, 'Kisan Transport',             true),
  ('GJ14AB4567', 'truck',      12.0, 'Ahmedabad Freight Services',  true),
  ('GJ14CD8901', 'truck',      10.0, 'National Road Carriers',      true),
  ('GJ18AB2345', 'truck',       8.0, 'Vadodara Transport Corp',     true),
  ('GJ18CD6789', 'mini_truck',  5.0, 'Rajesh Goods Transport',      true),
  ('GJ22AB0123', 'truck',      15.0, 'Surat Freight Lines',         true),
  ('GJ22CD4567', 'truck',      10.0, 'Diamond City Carriers',       true),
  ('GJ25AB8901', 'truck',      12.0, 'Rajkot Transport Agency',     true),
  ('GJ25CD2345', 'tempo',       3.5, 'Saurashtra Goods Co.',        true),
  ('GJ28AB6789', 'truck',       8.0, 'Bhavnagar Transport Ltd',     true),
  ('GJ28CD0123', 'mini_truck',  6.0, 'Coastal Carriers',            true),
  ('GJ30AB4567', 'truck',      10.0, 'Jamnagar Freight',            true),
  ('GJ30CD8901', 'truck',      12.0, 'Gulf Transport Co.',          true)
ON CONFLICT (vehicle_number) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 9. Helper function: validate vehicle number exists in master table
--    Returns true if vehicle_number is registered, false otherwise
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_vehicle_registered(p_vehicle_number text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM vehicles
    WHERE vehicle_number = upper(regexp_replace(p_vehicle_number, '\s+', '', 'g'))
      AND is_active = true
  );
$$;

-- Normalize vehicle_number on insert/update (uppercase, no spaces)
CREATE OR REPLACE FUNCTION normalize_vehicle_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.vehicle_number = upper(regexp_replace(NEW.vehicle_number, '\s+', '', 'g'));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vehicles_normalize ON vehicles;
CREATE TRIGGER trg_vehicles_normalize
  BEFORE INSERT OR UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION normalize_vehicle_number();

-- Also normalize vehicle_number on trips table
DROP TRIGGER IF EXISTS trg_trips_normalize_vehicle ON trips;
CREATE OR REPLACE FUNCTION normalize_trips_vehicle_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.vehicle_number IS NOT NULL THEN
    NEW.vehicle_number = upper(regexp_replace(NEW.vehicle_number, '\s+', '', 'g'));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_trips_normalize_vehicle
  BEFORE INSERT OR UPDATE ON trips
  FOR EACH ROW EXECUTE FUNCTION normalize_trips_vehicle_number();
