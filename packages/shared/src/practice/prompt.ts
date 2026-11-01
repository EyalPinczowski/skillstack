/**
 * The practice prompt builder. The only way text about a practice reaches a model.
 *
 * `PracticePromptInput` is a strict allowlist: it has no field for a user, email, display name,
 * id or URL, and unknown keys are rejected. Every string is redacted (with the user's known
 * identifiers) and then checked again; anything that still looks personal throws
 * `PiiLeakError`, so the caller fails closed. Pure and deterministic.
 */
import { z } from 'zod';
import { PERSONA_IDS, PERSONAS, personaForKind, type PersonaId } from './personas';
import { assertNoPii, redactPii, type RedactOptions } from './redact';

export const PracticePromptInputSchema = z
  .object({
    practiceKind: z.string().max(60).optional(),
    /** Optional override; by default the persona follows from the kind (and the task title). */
    personaId: z.enum(PERSONA_IDS).optional(),
    task: z
      .object({
        title: z.string().min(1).max(200),
        promptTemplate: z.string().max(4000).optional(),
        howToSteps: z.array(z.string().max(500)).max(30).default([]),
        plannedMinutes: z.number().int().min(1).max(600),
      })
      .strict(),
    /** `next_focus` from the previous feedback of the same kind. */
    nextFocus: z.string().max(1000).optional(),
    /** Task titles and skill ids of this week's tasks. */
    weekTopics: z
      .array(
        z
          .object({ title: z.string().min(1).max(200), skillId: z.string().max(100).optional() })
          .strict(),
      )
      .max(30)
      .default([]),
    jobDescription: z.string().max(8000).optional(),
  })
  .strict();
export type PracticePromptInput = z.input<typeof PracticePromptInputSchema>;

/** Appended to the copy-and-paste prompt so the answer can be pasted back and parsed. */
export const FEEDBACK_BLOCK_INSTRUCTION = [
  'When the practice is over, end your last message with a feedback block in exactly this format and nothing after it:',
  '===FEEDBACK===',
  'score: <a number from 0 to 10>/10',
  'strengths: <one or two sentences>',
  'improve: <one or two sentences>',
  'next_focus: <one sentence: what to work on next time>',
  '===END===',
].join('\n');

/** Sent as the last instruction of an in-app session to get machine-readable feedback. */
export const FEEDBACK_JSON_INSTRUCTION =
  'The practice is over. Reply with only a JSON object and nothing else, in this shape: ' +
  '{"score": <number from 0 to 10>, "strengths": "<text>", "improve": "<text>", "next_focus": "<text>"}.';

/** Sent once when the first answer was not valid JSON. */
export const RETRY_JSON_INSTRUCTION =
  'Return only valid JSON matching {"score": number 0-10, "strengths": string, "improve": string, "next_focus": string}. No other text.';

export const PERSONAL_DETAILS_HINT = "Don't include names or contact details.";

export interface BuiltPracticePrompt {
  personaId: PersonaId;
  /** The locked persona prompt, for the in-app chat. */
  system: string;
  /** The task description, for the first user turn of the in-app chat. */
  user: string;
  /** System text, task description and the feedback-block instruction, for "Open in Claude". */
  copyText: string;
  /** How many personal details were removed while building. */
  redactions: number;
}

/**
 * Redacts one piece of user-controlled text and verifies the result. Use it for every chat turn
 * too. Throws `PiiLeakError` when something personal survives.
 */
export function sanitizeUserText(
  text: string,
  options: RedactOptions = {},
): {
  text: string;
  count: number;
} {
  const result = redactPii(text, options);
  assertNoPii(result.text, options);
  return result;
}

/** Builds the prompt for one practice from the allowlisted input. Throws on invalid input. */
export function buildPracticePrompt(
  input: PracticePromptInput,
  options: RedactOptions = {},
): BuiltPracticePrompt {
  const parsed = PracticePromptInputSchema.parse(input);
  let redactions = 0;
  const clean = (text: string): string => {
    const r = sanitizeUserText(text, options);
    redactions += r.count;
    return r.text;
  };

  const persona =
    parsed.personaId !== undefined
      ? PERSONAS[parsed.personaId]
      : personaForKind(parsed.practiceKind, parsed.task.title);

  const lines: string[] = [
    `Practice: ${persona.label}`,
    `Time available: ${parsed.task.plannedMinutes} minutes`,
    `Task: ${clean(parsed.task.title)}`,
  ];
  if (parsed.task.promptTemplate) {
    lines.push('', 'What I want from this session:', clean(parsed.task.promptTemplate));
  }
  if (parsed.task.howToSteps.length > 0) {
    lines.push('', 'Steps I plan to follow:');
    parsed.task.howToSteps.forEach((step, i) => lines.push(`${i + 1}. ${clean(step)}`));
  }
  if (parsed.jobDescription) {
    lines.push(
      '',
      'Job description for the role I am preparing for:',
      clean(parsed.jobDescription),
    );
  }
  if (parsed.nextFocus) {
    lines.push(
      '',
      `What I wanted to work on after my last session of this kind: ${clean(parsed.nextFocus)}`,
    );
  }
  if (parsed.weekTopics.length > 0) {
    lines.push('', 'Topics I am studying this week:');
    for (const topic of parsed.weekTopics) {
      const title = clean(topic.title);
      lines.push(topic.skillId ? `- ${title} (${clean(topic.skillId)})` : `- ${title}`);
    }
  }
  const user = lines.join('\n');
  const copyText = `${persona.system}\n\n${user}\n\n${FEEDBACK_BLOCK_INSTRUCTION}`;
  // Final gate on the whole text. Known identifiers are not checked here: they were removed
  // field by field above, and a short name must not trip on our own fixed wording.
  assertNoPii(copyText);
  return { personaId: persona.id, system: persona.system, user, copyText, redactions };
}
