import { describe, expect, it } from 'vitest';
import {
  MAX_PARSE_INPUT_LENGTH,
  parseFeedbackBlock,
  parseModelFeedback,
  parseScoreText,
} from './feedback';

const timed = (fn: () => void): number => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};

describe('hostile input stays fast (B1, B2)', () => {
  const hostile: [string, string][] = [
    ['a long run of equals after the marker', '===feedback===\n' + '='.repeat(40_000)],
    ['equals only', '='.repeat(60_000)],
    ['marker words with no equals', 'feedback end '.repeat(5000)],
    ['equals before a word, repeated', '=== feedback '.repeat(5000)],
    ['spaces between equals', '=\t'.repeat(30_000) + 'feedback'],
    ['1 MB of equals', '='.repeat(1_000_000)],
    ['1 MB of marker text', '===feedback===\nscore: 1\n'.repeat(40_000)],
    ['a digit run after a brace', '{' + '1'.repeat(80_000)],
    ['a digit run with trailing junk', '{"score": ' + '9'.repeat(60_000) + 'x'],
    ['1 MB of digits', '{' + '7'.repeat(1_000_000)],
    ['many braces', '{'.repeat(60_000)],
    ['many commas and spaces', '{' + ', '.repeat(30_000)],
  ];
  it.each(hostile)('%s', (_n, text) => {
    expect(timed(() => parseFeedbackBlock(text))).toBeLessThan(400);
    expect(timed(() => parseModelFeedback(text))).toBeLessThan(400);
  });

  it('only the first 64 KB are read', () => {
    const block = '===FEEDBACK===\nscore: 7\nstrengths: S\nimprove: I\nnext_focus: N\n===END===';
    expect(parseFeedbackBlock('x'.repeat(MAX_PARSE_INPUT_LENGTH) + block).ok).toBe(false);
    expect(parseFeedbackBlock('x'.repeat(1000) + block).ok).toBe(true);
    const json = '{"score": 7, "strengths": "S", "improve": "I", "next_focus": "N"}';
    expect(parseModelFeedback(' '.repeat(MAX_PARSE_INPUT_LENGTH) + json).ok).toBe(false);
  });

  it('marker edge cases', () => {
    const body = 'score: 7\nstrengths: S\nimprove: I\nnext_focus: N\n';
    expect(parseFeedbackBlock('==feedback==\n' + body).ok).toBe(false);
    expect(parseFeedbackBlock('===feedback==\n' + body).ok).toBe(false);
    expect(parseFeedbackBlock('====  FeedBack \t ====\n' + body).ok).toBe(true);
    expect(parseFeedbackBlock('===feedback===\n' + body + '==end==\nextra: x').ok).toBe(true);
    expect(
      parseFeedbackBlock('weekend ===feedback===\n' + body + 'the end\n===  END  ===').ok,
    ).toBe(true);
  });

  it('prototype-looking keys are not aliases', () => {
    const r = parseModelFeedback(
      '{"constructor": 1, "__proto__": 2, "score": 7, "strengths": "S", "improve": "I", "next_focus": "N"}',
    );
    expect(r.ok).toBe(true);
    expect(parseScoreText('7')).toBe(7);
  });
});
