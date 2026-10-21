import { describe, expect, it } from 'vitest';
import { lbRow as row } from '@/test/leaderboard';
import {
  medalOf,
  parseSemesterValue,
  podiumSignature,
  rankChangeOf,
  scoringNote,
  semesterChoices,
  semesterLabel,
  splitBoard,
  toStandingView,
} from './leaderboard-model';

describe('medalOf', () => {
  it('gives the Top 3 their metal by rank, so ties share it', () => {
    expect([1, 2, 3, 4].map(medalOf)).toEqual(['gold', 'silver', 'bronze', null]);
  });
});

describe('rankChangeOf', () => {
  it.each([
    [2, 'up', 2, 'Up 2 places since the last change'],
    [-1, 'down', 1, 'Down 1 place since the last change'],
    [0, 'same', 0, 'Same place as before'],
    [null, 'new', 0, 'New on the board'],
  ] as const)('%s', (change, direction, places, label) => {
    expect(rankChangeOf(change)).toEqual({ direction, places, label });
  });
});

describe('toStandingView', () => {
  it('shows the breakdown, the profit (negative too) and the review note', () => {
    const view = toStandingView(
      row('jpice', 4, {
        points: 4.5,
        implementedCount: 5,
        lateCount: 1,
        netProfitCentavos: -123_400,
        underReviewCount: 1,
      }),
    );
    expect(view).toMatchObject({
      key: 'jpice',
      medal: null,
      college: 'CEA',
      breakdown: '4.5 pts · 5 projects (1 late)',
      profit: { text: '−₱1,234.00', negative: true, underReview: '(1 report under review)' },
      href: '/orgs/jpice',
    });
  });
});

describe('splitBoard', () => {
  it('puts the first three on the podium and the rest in the list', () => {
    const { podium, list } = splitBoard([row('a', 1), row('b', 2), row('c', 3), row('d', 4)]);
    expect(podium.map((v) => v.key)).toEqual(['a', 'b', 'c']);
    expect(list.map((v) => v.key)).toEqual(['d']);
  });

  it('keeps a tie for third beyond the podium in the list, with its medal', () => {
    const { podium, list } = splitBoard([row('a', 1), row('b', 2), row('c', 3), row('d', 3)]);
    expect(podium).toHaveLength(3);
    expect(list[0]).toMatchObject({ key: 'd', medal: 'bronze' });
  });

  it('puts no one on the podium when a college has nobody in the Top 3', () => {
    const { podium, list } = splitBoard([row('a', 5), row('b', 7)]);
    expect(podium).toEqual([]);
    expect(list.map((v) => v.rank)).toEqual([5, 7]);
  });

  it('handles an empty or short board', () => {
    expect(splitBoard([])).toEqual({ podium: [], list: [] });
    expect(splitBoard([row('a', 1)]).podium).toHaveLength(1);
  });
});

describe('podiumSignature', () => {
  it('changes when the Top 3 order changes, not below it', () => {
    const before = podiumSignature([row('a', 1), row('b', 2), row('c', 3), row('d', 4)]);
    expect(podiumSignature([row('b', 1), row('a', 2), row('c', 3), row('d', 4)])).not.toBe(before);
    expect(podiumSignature([row('a', 1), row('b', 2), row('c', 3), row('e', 4)])).toBe(before);
  });
});

describe('scoringNote', () => {
  it('names the late value in force', () => {
    expect(scoringNote(0.25)).toBe(
      'Ranked by points (1 per implemented project, 0.25 if any of its reports was late), then by net profit reported in submitted Financial Reports.',
    );
  });
});

describe('semesters', () => {
  it('parses a semester value, refusing junk', () => {
    expect(parseSemesterValue('2026-2027:second')).toEqual({
      academicYear: '2026-2027',
      semester: 'second',
    });
    expect(parseSemesterValue('2026-2027:summer')).toBeNull();
    expect(parseSemesterValue('nope')).toBeNull();
    expect(parseSemesterValue(null)).toBeNull();
  });

  it('labels a semester', () => {
    expect(semesterLabel({ academicYear: '2026-2027', semester: 'midyear' })).toBe(
      'Midyear 2026–2027',
    );
  });

  it('offers the current semester first, then the ones before', () => {
    const choices = semesterChoices(new Date('2027-02-01T00:00:00Z'));
    expect(choices.slice(0, 3).map((c) => c.value)).toEqual([
      '2026-2027:second',
      '2026-2027:first',
      '2025-2026:midyear',
    ]);
    expect(choices).toHaveLength(6);
  });
});
