/**
 * GrainShield AI – Admin Frontend Unit Tests
 * Run: npm test -- --passWithNoTests (vitest run)
 */
import { describe, it, expect } from 'vitest'

// ---------------------------------------------------------------------------
// CSV export helper (mirrors reports.tsx logic)
// ---------------------------------------------------------------------------
function buildCsvRow(values: (string | number | null | undefined)[]): string {
  return values
    .map((v) => {
      const s = String(v ?? '')
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s
    })
    .join(',')
}

function buildCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  return [headers.join(','), ...rows.map(buildCsvRow)].join('\n')
}

// ---------------------------------------------------------------------------
// Pagination helper
// ---------------------------------------------------------------------------
function buildPageRange(page: number, total: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = (page - 1) * pageSize
  const to = Math.min(from + pageSize - 1, total - 1)
  return { from, to, totalPages, hasPrev: page > 1, hasNext: page < totalPages }
}

// ---------------------------------------------------------------------------
// Filter query builder (mirrors trips.tsx)
// ---------------------------------------------------------------------------
type TripFilters = { stage?: string; status?: string; search?: string; page: number }

function buildFilterDescription(f: TripFilters): string {
  const parts: string[] = []
  if (f.stage) parts.push(`stage=${f.stage}`)
  if (f.status) parts.push(`status=${f.status}`)
  if (f.search) parts.push(`search="${f.search}"`)
  parts.push(`page=${f.page}`)
  return parts.join(', ')
}

// ---------------------------------------------------------------------------
// Role badge helper
// ---------------------------------------------------------------------------
type Role = 'user' | 'officer' | 'admin' | 'super_admin'

const ROLE_LABELS: Record<Role, string> = {
  user: 'User',
  officer: 'Officer',
  admin: 'Admin',
  super_admin: 'Super Admin',
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role as Role] ?? role
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('CSV builder', () => {
  it('builds header + rows', () => {
    const csv = buildCsv(
      ['Name', 'District', 'Count'],
      [['Ahmedabad', 'Central', 42], ['Surat', 'South', 18]],
    )
    expect(csv).toContain('Name,District,Count')
    expect(csv).toContain('Ahmedabad,Central,42')
    expect(csv).toContain('Surat,South,18')
  })

  it('escapes commas in fields', () => {
    const row = buildCsvRow(['Name, with comma', 'Value'])
    expect(row).toBe('"Name, with comma",Value')
  })

  it('escapes double quotes', () => {
    const row = buildCsvRow(['Say "hello"', 'ok'])
    expect(row).toBe('"Say ""hello""",ok')
  })

  it('handles null and undefined', () => {
    const row = buildCsvRow([null, undefined, 'real'])
    expect(row).toBe(',,real')
  })
})

describe('Pagination', () => {
  it('first page of 3', () => {
    const p = buildPageRange(1, 30, 10)
    expect(p.totalPages).toBe(3)
    expect(p.from).toBe(0)
    expect(p.to).toBe(9)
    expect(p.hasPrev).toBe(false)
    expect(p.hasNext).toBe(true)
  })

  it('last page', () => {
    const p = buildPageRange(3, 30, 10)
    expect(p.hasPrev).toBe(true)
    expect(p.hasNext).toBe(false)
  })

  it('partial last page', () => {
    const p = buildPageRange(2, 15, 10)
    expect(p.totalPages).toBe(2)
    expect(p.to).toBe(14)
  })

  it('single page', () => {
    const p = buildPageRange(1, 5, 10)
    expect(p.totalPages).toBe(1)
    expect(p.hasPrev).toBe(false)
    expect(p.hasNext).toBe(false)
  })
})

describe('Filter description builder', () => {
  it('all filters', () => {
    const desc = buildFilterDescription({ stage: 'first_mile', status: 'pass', search: 'GJ05', page: 2 })
    expect(desc).toContain('stage=first_mile')
    expect(desc).toContain('status=pass')
    expect(desc).toContain('search="GJ05"')
    expect(desc).toContain('page=2')
  })

  it('no optional filters', () => {
    const desc = buildFilterDescription({ page: 1 })
    expect(desc).toBe('page=1')
  })
})

describe('Role labels', () => {
  it('known roles', () => {
    expect(roleLabel('user')).toBe('User')
    expect(roleLabel('officer')).toBe('Officer')
    expect(roleLabel('admin')).toBe('Admin')
    expect(roleLabel('super_admin')).toBe('Super Admin')
  })
  it('unknown role falls back to raw value', () => {
    expect(roleLabel('custom_role')).toBe('custom_role')
  })
})
