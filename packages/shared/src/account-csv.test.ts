import { describe, expect, it } from 'vitest';
import { ACCOUNT_CSV_MAX_ROWS, parseCsv, readAccountCsv } from './account-csv';

describe('parseCsv', () => {
  it('reads quoted cells, escaped quotes, CRLF and a byte-order mark; drops blank lines', () => {
    const text = '﻿Organization,Officer name\r\n"JPICE","Dela Cruz, Juan ""JD"""\r\n\r\nPSME,Ana\n';
    expect(parseCsv(text)).toEqual([
      ['Organization', 'Officer name'],
      ['JPICE', 'Dela Cruz, Juan "JD"'],
      ['PSME', 'Ana'],
    ]);
  });
});

describe('readAccountCsv', () => {
  const header = 'Organization,College,Officer name,Position,Contact email';

  it('maps columns by their header, in any order and case', () => {
    const table = readAccountCsv(
      `contact email,POSITION,officer name,college,organization\nrosa@nwssu.test,President,Rosa Lim,CEA,JPICE`,
      ['organization', 'officerName', 'officerPosition', 'officerEmail'],
    );
    expect(table).toEqual({
      ok: true,
      rows: [
        {
          line: 2,
          organization: 'JPICE',
          college: 'CEA',
          officerName: 'Rosa Lim',
          officerPosition: 'President',
          officerEmail: 'rosa@nwssu.test',
          accountEmail: '',
        },
      ],
    });
  });

  it('names missing columns, and refuses empty or oversized files', () => {
    expect(
      readAccountCsv('Organization,College\nJPICE,CEA', ['organization', 'officerName']),
    ).toEqual({
      ok: false,
      error: 'Missing column: officer name. The first row must name the columns.',
    });
    expect(readAccountCsv('', ['organization'])).toMatchObject({ ok: false });
    expect(readAccountCsv(header, ['organization'])).toMatchObject({
      ok: false,
      error: 'The file has a header but no rows.',
    });
    const many = [
      header,
      ...Array.from({ length: ACCOUNT_CSV_MAX_ROWS + 1 }, () => 'A,B,C,D,e@x.test'),
    ];
    expect(readAccountCsv(many.join('\n'), ['organization'])).toMatchObject({ ok: false });
  });
});
