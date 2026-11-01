import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  FeedbackSchema,
  MAX_FREE_TEXT_LENGTH,
  MAX_NEXT_FOCUS_LENGTH,
  parseFeedbackBlock,
  parseModelFeedback,
  parseScoreText,
} from './feedback';

const WANT = {
  score: 7,
  strengths: 'Clear structure',
  improve: 'More numbers',
  next_focus: 'Quantify results',
};

describe('parseModelFeedback: table', () => {
  const ok: [string, string][] = [
    ['plain JSON', JSON.stringify(WANT)],
    ['fenced JSON', '```json\n' + JSON.stringify(WANT) + '\n```'],
    ['prose around JSON', 'Sure! Here you go:\n' + JSON.stringify(WANT) + '\nHope that helps.'],
    [
      'trailing comma',
      '{"score": 7, "strengths": "Clear structure", "improve": "More numbers", "next_focus": "Quantify results",}',
    ],
    [
      'trailing comma in array',
      '{"score": 7, "strengths": ["Clear structure",], "improve": "More numbers", "next_focus": "Quantify results"}',
    ],
    [
      'single quotes',
      "{'score': 7, 'strengths': 'Clear structure', 'improve': 'More numbers', 'next_focus': 'Quantify results'}",
    ],
    [
      'smart quotes',
      '{“score”: 7, “strengths”: “Clear structure”, “improve”: “More numbers”, “next_focus”: “Quantify results”}',
    ],
    [
      'bare keys',
      '{score: 7, strengths: "Clear structure", improve: "More numbers", next_focus: "Quantify results"}',
    ],
    [
      'score as 7/10 string',
      '{"score": "7/10", "strengths": "Clear structure", "improve": "More numbers", "next_focus": "Quantify results"}',
    ],
    [
      'score as "7" string',
      '{"score": "7", "strengths": "Clear structure", "improve": "More numbers", "next_focus": "Quantify results"}',
    ],
    [
      'score as 70% string',
      '{"score": "70%", "strengths": "Clear structure", "improve": "More numbers", "next_focus": "Quantify results"}',
    ],
    [
      'score as unquoted 7/10',
      '{"score": 7/10, "strengths": "Clear structure", "improve": "More numbers", "next_focus": "Quantify results"}',
    ],
    [
      'score as unquoted 70%',
      '{"score": 70%, "strengths": "Clear structure", "improve": "More numbers", "next_focus": "Quantify results"}',
    ],
    [
      'array values',
      '{"score": 7, "strengths": ["Clear structure"], "improve": "More numbers", "next_focus": "Quantify results"}',
    ],
    [
      'camelCase key',
      '{"score": 7, "strengths": "Clear structure", "improve": "More numbers", "nextFocus": "Quantify results"}',
    ],
    [
      'key aliases',
      '{"Score": 7, "Strength": "Clear structure", "Improvements": "More numbers", "Next Focus": "Quantify results"}',
    ],
    ['a brace in the prose before the object', 'Use {braces} carefully. ' + JSON.stringify(WANT)],
    ['the object nested in a wrapper', JSON.stringify({ feedback: WANT })],
    ['second object when the first is unusable', '{"foo": 1} then ' + JSON.stringify(WANT)],
  ];
  it.each(ok)('%s', (_name, text) => {
    const r = parseModelFeedback(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.feedback).toEqual(WANT);
  });

  it('plain valid JSON is not marked as repaired; every other path is', () => {
    const plain = parseModelFeedback(JSON.stringify(WANT));
    expect(plain.ok && plain.repaired).toBe(false);
    const fenced = parseModelFeedback('```json\n' + JSON.stringify(WANT) + '\n```');
    expect(fenced.ok && fenced.repaired).toBe(true);
  });

  it('handles raw newlines, tabs and carriage returns inside strings', () => {
    const r = parseModelFeedback(
      '{"score": 7, "strengths": "Clear\n\tstructure\r", "improve": "More numbers", "next_focus": "Quantify results"}',
    );
    expect(r.ok && r.feedback.strengths).toBe('Clear\n\tstructure');
  });

  it('keeps escapes, drops the backslash before an apostrophe, escapes unescaped inner quotes', () => {
    const r = parseModelFeedback(
      "{'score': 7, 'strengths': 'it\\'s \\\"fine\\\" and \"ok\" too', 'improve': 'More', 'next_focus': 'Go'}",
    );
    expect(r.ok && r.feedback.strengths).toBe('it\'s "fine" and "ok" too');
  });

  it('keeps an apostrophe inside a single-quoted string', () => {
    const r = parseModelFeedback(
      "{'score': 7, 'strengths': 'don't stop', 'improve': 'More', 'next_focus': 'Go'}",
    );
    expect(r.ok && r.feedback.strengths).toBe("don't stop");
  });

  it('copes with a string that never closes', () => {
    expect(parseModelFeedback('{"score": 7, "strengths": "oops').ok).toBe(false);
  });

  it('keeps a trailing backslash at the very end', () => {
    expect(parseModelFeedback('{"score": 7, "strengths": "a\\').ok).toBe(false);
  });

  it('allows true, false and null as bare words without failing the parse of the object', () => {
    const r = parseModelFeedback(
      '{"score": 7, "extra": null, "ok": true, "strengths": "S", "improve": "I", "next_focus": "N"}',
    );
    expect(r.ok).toBe(true);
  });

  it('clamps an out-of-range score and flags it', () => {
    const high = parseModelFeedback(
      '{"score": 12, "strengths": "S", "improve": "I", "next_focus": "N"}',
    );
    expect(high.ok && high.feedback.score).toBe(10);
    expect(high.ok && high.flags).toEqual(['score_clamped']);
    const low = parseModelFeedback(
      '{"score": -3, "strengths": "S", "improve": "I", "next_focus": "N"}',
    );
    expect(low.ok && low.feedback.score).toBe(0);
  });

  it('normalises other denominators', () => {
    const r = parseModelFeedback(
      '{"score": "4/5", "strengths": "S", "improve": "I", "next_focus": "N"}',
    );
    expect(r.ok && r.feedback.score).toBe(8);
  });

  it('caps long text and flags it once', () => {
    const long = 'x'.repeat(MAX_NEXT_FOCUS_LENGTH + 50);
    const r = parseModelFeedback(
      JSON.stringify({ score: 5, strengths: 'S', improve: 'I', next_focus: long, nextFocus: long }),
    );
    expect(r.ok && r.feedback.next_focus.length).toBe(MAX_NEXT_FOCUS_LENGTH);
    const both = parseModelFeedback(
      JSON.stringify({
        score: 5,
        strengths: 'S'.repeat(3000),
        improve: 'I'.repeat(3000),
        next_focus: 'N',
      }),
    );
    expect(both.ok && both.flags).toEqual(['text_truncated']);
  });

  it('joins arrays, ignoring non-text items, and stringifies numbers', () => {
    const r = parseModelFeedback(
      '{"score": 5, "strengths": ["A", 2, {"x": 1}, "  "], "improve": 3, "next_focus": ["Go"]}',
    );
    expect(r.ok && r.feedback.strengths).toBe('A; 2');
    expect(r.ok && r.feedback.improve).toBe('3');
  });

  const garbage: [string, string][] = [
    ['plain prose', 'I think you did great, maybe a 7.'],
    ['empty', ''],
    ['only spaces', '   '],
    ['an array', '[1, 2, 3]'],
    ['missing field', '{"score": 7, "strengths": "S", "improve": "I"}'],
    ['empty strengths', '{"score": 7, "strengths": " ", "improve": "I", "next_focus": "N"}'],
    ['empty array field', '{"score": 7, "strengths": [], "improve": "I", "next_focus": "N"}'],
    ['object field', '{"score": 7, "strengths": {"a": 1}, "improve": "I", "next_focus": "N"}'],
    ['unreadable score', '{"score": "great", "strengths": "S", "improve": "I", "next_focus": "N"}'],
    ['non-finite score', '{"score": 1e999, "strengths": "S", "improve": "I", "next_focus": "N"}'],
    ['boolean score', '{"score": true, "strengths": "S", "improve": "I", "next_focus": "N"}'],
    ['zero denominator', '{"score": "5/0", "strengths": "S", "improve": "I", "next_focus": "N"}'],
    ['truncated object', '{"score": 7, "strengths": "S", "improve": "I"'],
    ['unquoted words as values', '{score: 7, strengths: good, improve: more, next_focus: x}'],
    [
      'a bare word that is not JSON',
      '{"score": 7, "strengths": maybe, "improve": "I", "next_focus": "N"}',
    ],
    ['invalid escape', '{"score": 7, "strengths": "a\\d", "improve": "I", "next_focus": "N"}'],
    ['top-level string', '"hello"'],
  ];
  it.each(garbage)('garbage becomes free_text: %s', (_name, text) => {
    const r = parseModelFeedback(text);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.feedback).toBeNull();
      expect(r.freeText).toBe(text.trim());
      expect(r.raw).toBe(text);
    }
  });

  it('caps free text', () => {
    const r = parseModelFeedback('word '.repeat(5000));
    expect(!r.ok && r.freeText.length).toBeLessThanOrEqual(MAX_FREE_TEXT_LENGTH);
  });

  it('gives up after a bounded number of candidate objects', () => {
    const r = parseModelFeedback('{"a":1}'.repeat(50) + JSON.stringify(WANT));
    expect(r.ok).toBe(false);
  });
});

describe('parseScoreText', () => {
  it.each([
    ['7', 7],
    [' 7.5 ', 7.5],
    ['7/10', 7],
    ['7 / 10', 7],
    ['4/5', 8],
    ['70%', 7],
  ])('%s', (text, want) => {
    expect(parseScoreText(text)).toBe(want);
  });
  it.each(['', 'x', '7/', '5/0', '-1'])('%j is unreadable', (text) => {
    expect(parseScoreText(text)).toBeNull();
  });
});

const BLOCK = [
  '===FEEDBACK===',
  'score: 7/10',
  'strengths: Clear structure',
  'improve: More numbers',
  'next_focus: Quantify results',
  '===END===',
].join('\n');

describe('parseFeedbackBlock', () => {
  const ok: [string, string][] = [
    ['valid block', BLOCK],
    ['surrounded by chat text', 'Great session!\n\n' + BLOCK + '\n\nSee you.'],
    ['no END marker', BLOCK.replace('\n===END===', '')],
    ['CRLF line ends', BLOCK.replace(/\n/g, '\r\n')],
    ['old-style CR line ends', BLOCK.replace(/\n/g, '\r')],
    [
      'mixed case',
      BLOCK.replace('===FEEDBACK===', '===Feedback===')
        .replace('score', 'SCORE')
        .replace('===END===', '===end==='),
    ],
    [
      'extra whitespace',
      BLOCK.replace('score: 7/10', '  score :   7 / 10  ').replace(
        '===FEEDBACK===',
        '=== FEEDBACK ===',
      ),
    ],
    ['key aliases', BLOCK.replace('next_focus', 'Next Focus').replace('strengths', 'strength')],
    ['score as 70%', BLOCK.replace('7/10', '70%')],
    ['score as bare number', BLOCK.replace('7/10', '7')],
    [
      'the template echoed first, the answer last',
      '===FEEDBACK===\nscore: <n>/10\n===END===\n' + BLOCK,
    ],
  ];
  it.each(ok)('%s', (_name, text) => {
    const r = parseFeedbackBlock(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.feedback).toEqual(WANT);
  });

  it('joins continuation lines and bullets, ignores empty ones and unknown keys before any field', () => {
    const r = parseFeedbackBlock(
      [
        '===FEEDBACK===',
        'Note: ignored before any field',
        'score: 6',
        'strengths:',
        '- Clear structure',
        '* Good pace',
        '',
        'improve: More numbers',
        'Side note: keeps going',
        'next_focus: Quantify results',
        '===END===',
      ].join('\n'),
    );
    expect(r.ok && r.feedback.strengths).toBe('Clear structure; Good pace');
    expect(r.ok && r.feedback.improve).toBe('More numbers; Side note: keeps going');
  });

  it('clamps and flags like the JSON path', () => {
    const r = parseFeedbackBlock(BLOCK.replace('7/10', '11'));
    expect(r.ok && r.feedback.score).toBe(10);
    expect(r.ok && r.flags).toEqual(['score_clamped']);
  });

  const bad: [string, string][] = [
    ['plain text', 'Overall a solid 7 out of 10.'],
    ['empty', ''],
    ['marker but no fields', '===FEEDBACK===\n===END==='],
    ['missing field', BLOCK.replace('improve: More numbers\n', '')],
    ['unreadable score', BLOCK.replace('7/10', 'good')],
    ['empty score', BLOCK.replace('score: 7/10', 'score:')],
  ];
  it.each(bad)('falls back to free_text: %s', (_name, text) => {
    const r = parseFeedbackBlock(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.freeText).toBe(text.trim());
  });
});

describe('the parse functions never throw', () => {
  it('on any string', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (s) => {
        expect(() => parseModelFeedback(s)).not.toThrow();
        expect(() => parseFeedbackBlock(s)).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });
  it('on any unicode string and on JSON-ish noise', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ unit: 'binary', maxLength: 300 }),
          fc
            .array(
              fc.constantFrom(
                '{',
                '}',
                '"',
                "'",
                ',',
                ':',
                '\\',
                '7',
                '/',
                '%',
                ' ',
                'score',
                '\n',
                '[',
                ']',
                '“',
              ),
              {
                maxLength: 60,
              },
            )
            .map((a) => a.join('')),
        ),
        (s) => {
          expect(() => parseModelFeedback(s)).not.toThrow();
          expect(() => parseFeedbackBlock('===FEEDBACK===\n' + s)).not.toThrow();
        },
      ),
      { numRuns: 500 },
    );
  });
  it('and a successful result always satisfies the schema', () => {
    fc.assert(
      fc.property(
        fc.record({
          score: fc.oneof(
            fc.double({ min: -50, max: 50, noNaN: true }),
            fc.string({ maxLength: 8 }),
          ),
          strengths: fc.string({ maxLength: 40 }),
          improve: fc.string({ maxLength: 40 }),
          next_focus: fc.string({ maxLength: 40 }),
        }),
        (o) => {
          const r = parseModelFeedback(JSON.stringify(o));
          if (r.ok) expect(FeedbackSchema.safeParse(r.feedback).success).toBe(true);
        },
      ),
    );
  });
});
