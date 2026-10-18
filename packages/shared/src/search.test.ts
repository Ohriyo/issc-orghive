import { describe, expect, it } from 'vitest';
import {
  parseSnippet,
  searchQuerySchema,
  SNIPPET_MATCH_END,
  SNIPPET_MATCH_START,
  trimSnippetLead,
} from './search';

const mark = (word: string) => `${SNIPPET_MATCH_START}${word}${SNIPPET_MATCH_END}`;

describe('searchQuerySchema', () => {
  it('trims the query and coerces paging', () => {
    expect(searchQuerySchema.parse({ q: '  bridge  ', page: '2', limit: '8' })).toEqual({
      q: 'bridge',
      page: 2,
      limit: 8,
    });
  });

  it('rejects a query shorter than two characters', () => {
    expect(searchQuerySchema.safeParse({ q: ' a ' }).success).toBe(false);
  });

  it('checks every filter', () => {
    expect(searchQuerySchema.safeParse({ q: 'ab', year: '2026-2028' }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: 'ab', org: 'Not A Slug' }).success).toBe(false);
    expect(
      searchQuerySchema.safeParse({ q: 'ab', college: 'cea', org: 'jpice', type: 'resolution' })
        .success,
    ).toBe(true);
  });

  it('caps paging at the ranked result limit', () => {
    expect(searchQuerySchema.safeParse({ q: 'ab', page: 11 }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: 'ab', limit: 51 }).success).toBe(false);
  });
});

describe('trimSnippetLead', () => {
  it('keeps only the last few words before the first match', () => {
    expect(
      trimSnippetLead(
        [
          { text: 'one two three four five six seven eight ', match: false },
          { text: 'pump', match: true },
        ],
        3,
      ),
    ).toEqual([
      { text: '…six seven eight ', match: false },
      { text: 'pump', match: true },
    ]);
  });

  it('leaves short lead-ins, leading matches and match-free text alone', () => {
    const short = [
      { text: 'a ram ', match: false },
      { text: 'pump', match: true },
    ];
    expect(trimSnippetLead(short)).toBe(short);
    const leading = [{ text: 'pump', match: true }];
    expect(trimSnippetLead(leading)).toBe(leading);
    const none = [{ text: 'one two three four five six seven eight nine', match: false }];
    expect(trimSnippetLead(none, 2)).toBe(none);
  });
});

describe('parseSnippet', () => {
  it('splits marked matches from plain text', () => {
    expect(parseSnippet(`the ${mark('bridge')} load ${mark('test')}`)).toEqual([
      { text: 'the ', match: false },
      { text: 'bridge', match: true },
      { text: ' load ', match: false },
      { text: 'test', match: true },
    ]);
  });

  it('returns plain text unchanged', () => {
    expect(parseSnippet('no matches here')).toEqual([{ text: 'no matches here', match: false }]);
  });

  it('keeps text after an unterminated mark', () => {
    expect(parseSnippet(`a ${SNIPPET_MATCH_START}word`)).toEqual([
      { text: 'a ', match: false },
      { text: 'word', match: true },
    ]);
  });

  it('never emits HTML for markup in the text', () => {
    expect(parseSnippet(`<b>${mark('x')}</b>`)).toEqual([
      { text: '<b>', match: false },
      { text: 'x', match: true },
      { text: '</b>', match: false },
    ]);
  });
});
