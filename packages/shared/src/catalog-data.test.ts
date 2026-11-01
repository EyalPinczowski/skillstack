import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface CatalogItem {
  id: string;
  type: string;
  url: string | null;
  price: number | null;
  cost_type: string;
  url_verified: boolean;
  price_verified: boolean;
}

const items = (
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../data/catalog/catalog.json', import.meta.url)),
      'utf8',
    ),
  ) as { items: CatalogItem[] }
).items;

describe('catalog verification flags', () => {
  it('only marks a url verified when it is an https url', () => {
    const bad = items.filter((i) => i.url_verified && !i.url?.startsWith('https://'));
    expect(bad.map((i) => i.id)).toEqual([]);
  });

  it('never marks a missing price (check price) as verified', () => {
    const bad = items.filter((i) => i.price === null && i.price_verified);
    expect(bad.map((i) => i.id)).toEqual([]);
  });

  it('keeps a numeric price on free items so price caps do not drop them', () => {
    const bad = items.filter((i) => i.cost_type === 'free' && i.price === null);
    expect(bad.map((i) => i.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Catalog structure: prerequisites, role paths and the added fields. The Python
// build lint (data/catalog/build/lint.py) is the gate; these tests re-check the
// generated files and prove each rule fails when the data is mutated.
// ---------------------------------------------------------------------------

interface StructItem {
  id: string;
  url: string | null;
  url_verified: boolean;
  price_verified: boolean;
  cost_type: string;
  price: number | null;
  subscription_period: string | null;
  skills: string[];
  prerequisites: string[];
  prerequisite_kinds: Record<string, string>;
  last_verified_at: string | null;
  subscription_group: string | null;
  skill_depth: Record<string, string>;
}
interface RolePath {
  id: string;
  suggested_path: { core: string[] };
}

const dataDir = fileURLToPath(new URL('../../../data/catalog/', import.meta.url));
const structItems = (
  JSON.parse(readFileSync(`${dataDir}catalog.json`, 'utf8')) as { items: StructItem[] }
).items;
const roles = (JSON.parse(readFileSync(`${dataDir}roles.json`, 'utf8')) as { roles: RolePath[] })
  .roles;

function missingPrereq(its: StructItem[]): string[] {
  const ids = new Set(its.map((i) => i.id));
  return its.flatMap((i) =>
    i.prerequisites.filter((p) => !ids.has(p)).map((p) => `${i.id} -> ${p}`),
  );
}

function findCycle(its: StructItem[]): string[] | null {
  const byId = new Map(its.map((i) => [i.id, i]));
  const state = new Map<string, number>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    state.set(id, 1);
    stack.push(id);
    for (const p of byId.get(id)?.prerequisites ?? []) {
      if (!byId.has(p)) continue;
      if (state.get(p) === 1) return [...stack.slice(stack.indexOf(p)), p];
      if (!state.has(p)) {
        const found = visit(p);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const i of its) {
    if (!state.has(i.id)) {
      const found = visit(i.id);
      if (found) return found;
    }
  }
  return null;
}

/** Core items whose required prerequisite is missing from core or comes after the item. */
function brokenCore(its: StructItem[], rs: RolePath[]): string[] {
  const byId = new Map(its.map((i) => [i.id, i]));
  const out: string[] = [];
  for (const r of rs) {
    const core = r.suggested_path.core;
    for (const [n, id] of core.entries()) {
      const it = byId.get(id);
      for (const p of it?.prerequisites ?? []) {
        if ((it?.prerequisite_kinds[p] ?? 'required') !== 'required') continue;
        const at = core.indexOf(p);
        if (at < 0 || at > n) out.push(`${r.id}: ${id} needs ${p}`);
      }
    }
  }
  return out;
}

function httpsViolations(its: StructItem[]): string[] {
  return its.filter((i) => i.url_verified && !i.url?.startsWith('https://')).map((i) => i.id);
}

const clone = <T>(v: T): T => structuredClone(v);

describe('catalog prerequisites', () => {
  it('only references items that exist', () => {
    expect(missingPrereq(structItems)).toEqual([]);
  });

  it('detects a missing prerequisite id (mutation)', () => {
    const m = clone(structItems);
    m[0]!.prerequisites.push('does-not-exist');
    expect(missingPrereq(m)).toEqual([`${m[0]!.id} -> does-not-exist`]);
  });

  it('has no prerequisite cycle', () => {
    expect(findCycle(structItems)).toBeNull();
  });

  it('reports the exact cycle when one is introduced (mutation)', () => {
    const m = clone(structItems);
    const kaggle = m.find((i) => i.id === 'kaggle-pandas')!;
    const python = m.find((i) => i.id === 'kaggle-python')!;
    expect(kaggle.prerequisites).toContain('kaggle-python');
    python.prerequisites.push('kaggle-pandas');
    const cycle = findCycle(m)!;
    // The cycle is reported closed (first id repeated last); where it starts depends on the walk.
    expect(cycle[0]).toBe(cycle[cycle.length - 1]);
    expect([...new Set(cycle)].sort()).toEqual(['kaggle-pandas', 'kaggle-python']);
  });

  it('has exactly one prerequisite kind per prerequisite, required or recommended', () => {
    for (const i of structItems) {
      expect(Object.keys(i.prerequisite_kinds).sort(), i.id).toEqual([...i.prerequisites].sort());
      for (const k of Object.values(i.prerequisite_kinds)) {
        expect(['required', 'recommended']).toContain(k);
      }
    }
  });
});

describe('role suggested_path core is closed under required prerequisites', () => {
  it('holds for every role, with prerequisites first', () => {
    expect(brokenCore(structItems, roles)).toEqual([]);
  });

  it('fails when a required prerequisite is removed from core (mutation)', () => {
    const m = clone(roles);
    const qa = m.find((r) => r.id === 'qa-tester')!;
    expect(qa.suggested_path.core).toContain('scrum-guide');
    qa.suggested_path.core = qa.suggested_path.core.filter((x) => x !== 'scrum-guide');
    expect(brokenCore(structItems, m)).toContain('qa-tester: psm-1 needs scrum-guide');
  });

  it('fails when a prerequisite comes after its dependent (mutation)', () => {
    const m = clone(roles);
    const qa = m.find((r) => r.id === 'qa-tester')!;
    const core = qa.suggested_path.core;
    core.splice(core.indexOf('scrum-guide'), 1);
    core.push('scrum-guide');
    expect(brokenCore(structItems, m)).toContain('qa-tester: psm-1 needs scrum-guide');
  });

  it('does not require a recommended prerequisite (mutation)', () => {
    const m = clone(structItems);
    const psm = m.find((i) => i.id === 'psm-1')!;
    psm.prerequisite_kinds['scrum-open'] = 'recommended';
    const rs = clone(roles);
    for (const r of rs) {
      r.suggested_path.core = r.suggested_path.core.filter((x) => x !== 'scrum-open');
    }
    expect(brokenCore(m, rs)).toEqual([]);
  });
});

describe('verified urls', () => {
  it('has no verified url without https (build lint rule)', () => {
    expect(httpsViolations(structItems)).toEqual([]);
  });

  it('detects a verified http url (mutation)', () => {
    const m = clone(structItems);
    const v = m.find((i) => i.url_verified)!;
    v.url = v.url!.replace('https://', 'http://');
    expect(httpsViolations(m)).toEqual([v.id]);
  });
});

describe('added catalog fields', () => {
  it('last_verified_at is a date or null, and only set on url-verified items', () => {
    for (const i of structItems) {
      if (i.last_verified_at === null) continue;
      expect(i.last_verified_at, i.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(i.url_verified, i.id).toBe(true);
    }
    expect(structItems.some((i) => i.last_verified_at === '2026-11-01')).toBe(true);
  });

  it('subscription_group is set only on subscriptions and members agree on price and period', () => {
    const groups = new Map<string, StructItem[]>();
    for (const i of structItems) {
      if (i.subscription_group === null) continue;
      expect(i.cost_type, i.id).toBe('subscription');
      groups.set(i.subscription_group, [...(groups.get(i.subscription_group) ?? []), i]);
    }
    expect([...groups.keys()]).toContain('coursera-plus');
    for (const members of groups.values()) {
      expect(new Set(members.map((m) => m.subscription_period)).size).toBe(1);
      const prices = new Set(members.map((m) => m.price).filter((p) => p !== null));
      expect(prices.size).toBeLessThanOrEqual(1);
    }
  });

  it('skill_depth is unset by default', () => {
    for (const i of structItems) {
      expect(Object.keys(i.skill_depth), i.id).toEqual([]);
    }
  });

  it('keeps the unusable prerequisites but marks them unverified', () => {
    for (const id of ['power-bi-learn-path', 'scrum-open']) {
      const it = structItems.find((i) => i.id === id)!;
      expect(it.url_verified).toBe(false);
      expect(it.last_verified_at).toBeNull();
    }
  });
});

describe('ai-900 and ai-901', () => {
  it('keeps ai-900, adds ai-901 without inventing a price, and no role path uses ai-900', () => {
    const ai900 = structItems.find((i) => i.id === 'ai-900');
    const ai901 = structItems.find((i) => i.id === 'ai-901');
    expect(ai900).toBeDefined();
    expect(ai901?.price).toBeNull();
    expect(ai901?.price_verified).toBe(false);
    expect(ai901?.url_verified).toBe(true);
    for (const r of roles) expect(r.suggested_path.core).not.toContain('ai-900');
  });
});

// ---------------------------------------------------------------------------
// Catalog expansion (batch 3): 18 skills, 8 roles and 58 items derived from O*NET / ESCO
// occupation data and official provider pages checked on 2026-11-01.
// ---------------------------------------------------------------------------

interface ExpItem extends StructItem {
  type: string;
  notes: string;
  roles: string[];
  est_hours: number;
}
interface ExpRole {
  id: string;
  skills: { skill: string; weight: number }[];
  sources?: { system: string }[];
}

const expItems = structItems as ExpItem[];
const expRoles = (JSON.parse(readFileSync(`${dataDir}roles.json`, 'utf8')) as { roles: ExpRole[] })
  .roles;
const skillIds = new Set(
  (
    JSON.parse(readFileSync(`${dataDir}skills.json`, 'utf8')) as { skills: { id: string }[] }
  ).skills.map((s) => s.id),
);

const NEW_ROLES = [
  'customer-support-specialist',
  'technical-support-specialist',
  'administrative-coordinator',
  'bookkeeping-clerk',
  'procurement-specialist',
  'marketing-coordinator',
  'technical-writer',
  'learning-development-coordinator',
];
const NEW_SKILLS = [
  'erp-systems',
  'customer-service',
  'ticketing-helpdesk',
  'office-administration',
  'bookkeeping-accounting',
  'procurement-sourcing',
  'demand-inventory-planning',
  'data-privacy-confidentiality',
  'change-management',
  'stakeholder-management',
  'work-management-tools',
  'windows-m365-admin',
  'security-monitoring-siem',
  'content-social-marketing',
  'market-research',
  'data-cleaning-etl',
  'negotiation',
  'training-facilitation',
];

describe('catalog expansion (batch 3)', () => {
  it('has the expected totals', () => {
    expect(expItems).toHaveLength(180);
    expect(expRoles).toHaveLength(27);
    expect(skillIds.size).toBe(59);
  });

  it('adds the 18 new skills and 8 new roles, with O*NET sources on the roles', () => {
    for (const s of NEW_SKILLS) expect(skillIds.has(s), s).toBe(true);
    for (const id of NEW_ROLES) {
      const r = expRoles.find((x) => x.id === id);
      expect(r, id).toBeDefined();
      expect(r!.sources?.length ?? 0, id).toBeGreaterThan(0);
      expect(
        r!.sources!.some((s) => s.system === 'O*NET'),
        id,
      ).toBe(true);
    }
  });

  it('only uses skill ids that exist in the taxonomy (items and roles)', () => {
    for (const i of expItems) {
      for (const s of i.skills) expect(skillIds.has(s), `${i.id}: ${s}`).toBe(true);
    }
    for (const r of expRoles) {
      for (const s of r.skills) expect(skillIds.has(s.skill), `${r.id}: ${s.skill}`).toBe(true);
    }
  });

  it('keeps role weights between 1 and 5', () => {
    for (const r of expRoles) {
      for (const s of r.skills) {
        expect(s.weight).toBeGreaterThanOrEqual(1);
        expect(s.weight).toBeLessThanOrEqual(5);
      }
    }
  });

  it('flags every unverified url or price with "needs check" in the notes of the new items', () => {
    const added = expItems.filter((i) => i.roles.some((r) => NEW_ROLES.includes(r)));
    expect(added.length).toBeGreaterThan(30);
    for (const i of added) {
      if (!i.url_verified || !i.price_verified) {
        expect(i.notes.toLowerCase(), i.id).toContain('needs check');
      }
    }
  });

  it('lets an item without a url exist only while unverified and flagged', () => {
    const noUrl = expItems.filter((i) => i.type !== 'practice' && !i.url);
    expect(noUrl.map((i) => i.id).sort()).toEqual([
      'futurelearn-understanding-gdpr',
      'google-digital-garage-digital-marketing',
      'opensap-building-tomorrows-erp',
      'servicenow-welcome-to-servicenow',
      'splunk-intro-to-splunk-elearning',
      'tableau-free-training-videos',
      'tryhackme-soc-level-1',
    ]);
    for (const i of noUrl) {
      expect(i.url_verified, i.id).toBe(false);
      expect(i.last_verified_at, i.id).toBeNull();
      expect(i.notes.toLowerCase(), i.id).toContain('needs check');
    }
  });

  it('does not invent exam prices and keeps new Coursera items in one subscription group', () => {
    for (const id of ['sc-900', 'comptia-a-plus-v15', 'aipb-certified-bookkeeper']) {
      const it = expItems.find((i) => i.id === id)!;
      expect(it.price, id).toBeNull();
      expect(it.price_verified, id).toBe(false);
    }
    const coursera = expItems.filter(
      (i) => i.id.startsWith('coursera-') && i.cost_type === 'subscription',
    );
    expect(coursera.length).toBeGreaterThan(10);
    for (const i of coursera) {
      expect(i.subscription_group, i.id).toBe('coursera-plus');
      expect(i.price_verified, i.id).toBe(false);
    }
  });

  it('puts the order hints from the proposal in as recommended edges', () => {
    const byId = new Map(expItems.map((i) => [i.id, i]));
    expect(byId.get('google-technical-writing-two')!.prerequisite_kinds).toEqual({
      'google-tech-writing': 'recommended',
    });
    expect(byId.get('sc-900-practice-assessment')!.prerequisite_kinds).toEqual({
      'sc-900': 'recommended',
    });
  });
});
