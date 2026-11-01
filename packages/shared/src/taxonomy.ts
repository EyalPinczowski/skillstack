import skillsData from '../../../data/catalog/skills.json';

/** The skill ids of the shipped taxonomy (`data/catalog/skills.json`). */
export const TAXONOMY_SKILL_IDS: ReadonlySet<string> = new Set(
  (skillsData as { skills: { id: string }[] }).skills.map((s) => s.id),
);
