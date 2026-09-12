/**
 * CSV writing: RFC 4180 quoting, spreadsheet-safety, and streaming.
 *
 * Two hazards this module exists to handle:
 * - **Quoting**: fields containing `,` `"` CR or LF must be quoted, with inner quotes doubled.
 * - **Formula injection**: a spreadsheet treats a field starting with `=`, `+`, `-`, `@`, tab or
 *   CR as a formula. `customer_email` is attacker-controlled and barely validated (TD-11), so a
 *   crafted address would execute when the merchant opens the file. Such fields get a `'` prefix.
 *   Numbers are never prefixed — a negative amount is data, not a formula.
 *
 * @see plans/008-csv-export-of-orders.md
 */
import { once } from 'node:events';
import type { Writable } from 'node:stream';

/** Byte-order mark, so Excel on Windows reads the file as UTF-8. */
export const UTF8_BOM = '﻿';

const NEEDS_QUOTING = /[",\r\n]/;
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/**
 * Renders one value as a CSV field.
 *
 * @param value - Value to render; `null` and `undefined` become an empty field.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';

  // Only strings can be mistaken for a formula; numbers keep their sign.
  let text = typeof value === 'string' && FORMULA_PREFIX.test(value) ? `'${value}` : String(value);
  if (NEEDS_QUOTING.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Renders one CSV record, terminated with CRLF as RFC 4180 requires.
 *
 * @param values - Field values, in column order.
 */
export function csvRow(values: readonly unknown[]): string {
  return `${values.map(escapeCsvField).join(',')}\r\n`;
}

/**
 * Streams a CSV document into a writable, respecting backpressure so memory stays flat
 * regardless of how many rows are exported.
 *
 * @param stream - Destination (an HTTP response).
 * @param columns - Header row.
 * @param rows - Row source; iterated lazily.
 * @param toValues - Maps a row to its field values.
 */
export async function writeCsv<T>(
  stream: Writable,
  columns: readonly string[],
  rows: Iterable<T>,
  toValues: (row: T) => readonly unknown[],
): Promise<void> {
  await writeChunk(stream, UTF8_BOM + csvRow(columns));
  for (const row of rows) {
    await writeChunk(stream, csvRow(toValues(row)));
  }
  stream.end();
}

/**
 * Writes a chunk, waiting for `drain` when the buffer is full.
 */
async function writeChunk(stream: Writable, chunk: string): Promise<void> {
  if (!stream.write(chunk)) await once(stream, 'drain');
}
