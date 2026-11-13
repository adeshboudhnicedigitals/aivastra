export type CsvCell = string | number | null | undefined;

/**
 * One CSV cell. Quotes when needed, and neutralises a text cell a spreadsheet would run as a
 * formula (leading = + - @ tab CR): item and branch names are merchant-typed, and an export is
 * opened in Excel. Numbers are written as they are, so a negative number stays a number.
 */
export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: CsvCell[][]): string {
  return `${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** Saves text as a UTF-8 file (with a BOM so Excel reads rupee signs and accents correctly). */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
