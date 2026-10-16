import { describe, expect, it } from 'vitest';
import { emphasize, joinNames } from './emphasis';

const bold = (text: string) => ({ text, strong: true });
const plain = (text: string) => ({ text, strong: false });

describe('emphasize', () => {
  it('marks every known name and keeps the text between them', () => {
    expect(emphasize('The JPICE and PSME meet.', ['JPICE', 'PSME'])).toEqual([
      plain('The '),
      bold('JPICE'),
      plain(' and '),
      bold('PSME'),
      plain(' meet.'),
    ]);
  });

  it('matches names with punctuation, and the longest name first', () => {
    expect(emphasize('ICpEP.SE and CSC-CEA', ['ICpEP.SE', 'CSC', 'CSC-CEA'])).toEqual([
      bold('ICpEP.SE'),
      plain(' and '),
      bold('CSC-CEA'),
    ]);
  });

  it('does not match inside a longer word or a hyphenated word', () => {
    expect(emphasize('All CEA-tizens and CEAs', ['CEA'])).toEqual([
      plain('All CEA-tizens and CEAs'),
    ]);
  });

  it('returns the text unchanged when there are no terms', () => {
    expect(emphasize('Hello', [])).toEqual([plain('Hello')]);
  });
});

describe('joinNames', () => {
  it('reads as a sentence', () => {
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A and B');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
  });
});
