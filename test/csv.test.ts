import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { UTF8_BOM, csvRow, escapeCsvField, writeCsv } from '../src/lib/csv.js';

/** Collects everything written to a stream. */
async function collect(write: (stream: PassThrough) => Promise<void>): Promise<string> {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  await write(stream);
  return Buffer.concat(chunks).toString('utf8');
}

test('csv: plain values pass through untouched', () => {
  assert.equal(escapeCsvField('ana@example.com'), 'ana@example.com');
  assert.equal(escapeCsvField(11136), '11136');
  assert.equal(escapeCsvField(null), '');
  assert.equal(escapeCsvField(undefined), '');
});

test('csv: separators, quotes and newlines are quoted (RFC 4180)', () => {
  assert.equal(escapeCsvField('Doe, Jane'), '"Doe, Jane"');
  assert.equal(escapeCsvField('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCsvField('line1\nline2'), '"line1\nline2"');
  assert.equal(escapeCsvField('carriage\rreturn'), '"carriage\rreturn"');
});

test('csv: formula-looking strings are neutralised', () => {
  // A spreadsheet would execute these; customer_email is attacker-controlled (TD-11).
  assert.equal(escapeCsvField('=HYPERLINK("http://evil","click")'), '"\'=HYPERLINK(""http://evil"",""click"")"');
  assert.equal(escapeCsvField('+1234'), "'+1234");
  assert.equal(escapeCsvField('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(escapeCsvField('-cmd'), "'-cmd");
});

test('csv: negative numbers are data, not formulas', () => {
  // Refund amounts are negative; prefixing them would corrupt every refund row.
  assert.equal(escapeCsvField(-11136), '-11136');
  assert.equal(escapeCsvField(-0.5), '-0.5');
});

test('csv: records end with CRLF', () => {
  assert.equal(csvRow(['a', 'b']), 'a,b\r\n');
});

test('csv: the document starts with a BOM and the header row', async () => {
  const output = await collect((stream) =>
    writeCsv(stream, ['id', 'amount'], [{ id: 'o1', amount: -5 }], (row) => [row.id, row.amount]),
  );

  assert.ok(output.startsWith(UTF8_BOM), 'expected a UTF-8 BOM for Excel');
  assert.equal(output, `${UTF8_BOM}id,amount\r\no1,-5\r\n`);
});

test('csv: rows are pulled lazily from the source', async () => {
  let produced = 0;
  function* rows(): Generator<number> {
    for (let i = 0; i < 3; i++) {
      produced += 1;
      yield i;
    }
  }

  const output = await collect((stream) => writeCsv(stream, ['n'], rows(), (n) => [n]));
  assert.equal(produced, 3);
  assert.equal(output, `${UTF8_BOM}n\r\n0\r\n1\r\n2\r\n`);
});
