import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAudit,
  formatAuditFailure,
  formatFinding,
  parseAuditOutput,
  type AuditReport,
  type AuditVulnerability,
  type Severity,
} from '../src/scripts/check-deps.js';

/**
 * Builds a vulnerability entry shaped like `npm audit --json` (report v2).
 */
function vuln(name: string, severity: Severity, overrides: Partial<AuditVulnerability> = {}): AuditVulnerability {
  return {
    name,
    severity,
    isDirect: false,
    via: [{ name, title: `${name} advisory`, url: `https://github.com/advisories/${name}`, severity }],
    range: '<1.0.0',
    nodes: [`node_modules/${name}`],
    fixAvailable: true,
    ...overrides,
  };
}

/**
 * Builds an audit report from a list of vulnerabilities.
 */
function report(...vulns: AuditVulnerability[]): AuditReport {
  return { vulnerabilities: Object.fromEntries(vulns.map((v) => [v.name, v])) };
}

/** Real report captured during plan 001 (esbuild low, qs + express moderate). */
const PLAN_001_REPORT: AuditReport = report(
  vuln('esbuild', 'low', {
    via: [{ name: 'esbuild', title: 'esbuild allows arbitrary file read when running the development server on Windows', url: 'https://github.com/advisories/GHSA-g7r4-m6w7-qqqr', severity: 'low' }],
    range: '0.27.3 - 0.28.0',
  }),
  vuln('express', 'moderate', { isDirect: true, via: ['qs'], range: '4.22.2' }),
  vuln('qs', 'moderate', {
    via: [
      { name: 'qs', title: 'qs array-limit bypass via bracket-key comma parsing', url: 'https://github.com/advisories/GHSA-x5fp-wj9c-mxmx', severity: 'moderate' },
      { name: 'qs', title: 'qs: Denial of Service via Attacker Controlled isBuffer', url: 'https://github.com/advisories/GHSA-4mjr-xmp4-gh2g', severity: 'moderate' },
    ],
    range: '2.2.5 - 6.15.3',
  }),
);

test('check-deps: no vulnerabilities passes with nothing reported', () => {
  const result = evaluateAudit(report());
  assert.equal(result.exitCode, 0);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
});

test('check-deps: low and moderate only produce warnings and pass', () => {
  const result = evaluateAudit(PLAN_001_REPORT);
  assert.equal(result.exitCode, 0);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.warnings.map((w) => w.packageName).sort(), ['esbuild', 'express', 'qs']);
  assert.deepEqual(result.counts, { info: 0, low: 1, moderate: 2, high: 0, critical: 0 });
});

test('check-deps: high blocks', () => {
  const result = evaluateAudit(report(vuln('lodash', 'high')));
  assert.equal(result.exitCode, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]!.severity, 'high');
});

test('check-deps: critical blocks and moderates are still reported as warnings', () => {
  const result = evaluateAudit(report(vuln('minimist', 'critical'), vuln('qs', 'moderate'), vuln('debug', 'low')));
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.errors.map((e) => e.packageName), ['minimist']);
  assert.deepEqual(result.warnings.map((w) => w.packageName).sort(), ['debug', 'qs']);
});

test('check-deps: info is ignored', () => {
  const result = evaluateAudit(report(vuln('left-pad', 'info')));
  assert.equal(result.exitCode, 0);
  assert.equal(result.errors.length + result.warnings.length, 0);
  assert.equal(result.counts.info, 1);
});

test('check-deps: message includes advisory, direct/transitive, prod/dev and fix info', () => {
  const result = evaluateAudit(
    report(
      vuln('esbuild', 'low', { fixAvailable: { name: 'tsx', version: '4.23.13', isSemVerMajor: false } }),
      vuln('express', 'moderate', { isDirect: true, via: ['qs'], fixAvailable: false }),
    ),
    (node) => node === 'node_modules/esbuild',
  );
  const byName = Object.fromEntries(result.warnings.map((w) => [w.packageName, w.message]));
  assert.match(byName.esbuild!, /\(transitive, dev\)/);
  assert.match(byName.esbuild!, /esbuild advisory \(https:\/\/github\.com\/advisories\/esbuild\)/);
  assert.match(byName.esbuild!, /fix available: tsx@4\.23\.13$/);
  assert.match(byName.express!, /\(direct, prod\)/);
  assert.match(byName.express!, /via qs/);
  assert.match(byName.express!, /no fix available$/);
});

test('check-deps: parseAuditOutput accepts a valid report', () => {
  const outcome = parseAuditOutput(JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }), '', 0);
  assert.equal(outcome.ok, true);
});

test('check-deps: parseAuditOutput fails closed on empty output', () => {
  const outcome = parseAuditOutput('', 'npm ERR! network', 1);
  assert.equal(outcome.ok, false);
  assert.match(!outcome.ok ? outcome.reason : '', /no output \(exit code 1\).*network/);
});

test('check-deps: parseAuditOutput fails closed on invalid JSON', () => {
  const outcome = parseAuditOutput('<html>502 Bad Gateway</html>', '', 1);
  assert.equal(outcome.ok, false);
  assert.match(!outcome.ok ? outcome.reason : '', /not valid JSON/);
});

test('check-deps: parseAuditOutput fails closed on an npm error payload', () => {
  const stdout = JSON.stringify({ error: { code: 'ENOTFOUND', summary: 'request to https://registry.npmjs.org failed' } });
  const outcome = parseAuditOutput(stdout, '', 1);
  assert.equal(outcome.ok, false);
  assert.match(!outcome.ok ? outcome.reason : '', /^ENOTFOUND: request to https:\/\/registry\.npmjs\.org failed/);
});

test('check-deps: parseAuditOutput reads the npm 11 top-level message on registry failure', () => {
  // Real output of `npm audit --json` (npm 11) with an unreachable registry.
  const stdout = JSON.stringify({
    message: 'request to http://127.0.0.1:9/-/npm/v1/security/advisories/bulk failed, reason: connect ECONNREFUSED 127.0.0.1:9',
    error: { summary: '', detail: '' },
  });
  const outcome = parseAuditOutput(stdout, 'npm error A complete log of this run can be found in: x.log', 0);
  assert.equal(outcome.ok, false);
  const reason = !outcome.ok ? outcome.reason : '';
  assert.match(reason, /ECONNREFUSED 127\.0\.0\.1:9$/);
  assert.doesNotMatch(reason, /complete log/);
});

test('check-deps: parseAuditOutput fails closed on an unexpected shape', () => {
  const outcome = parseAuditOutput(JSON.stringify({ auditReportVersion: 2 }), '', 0);
  assert.equal(outcome.ok, false);
});

test('check-deps: GitHub Actions annotations are escaped', () => {
  const line = formatFinding(
    { level: 'warning', packageName: 'qs', severity: 'moderate', message: '100% bad\nsecond line' },
    true,
  );
  assert.equal(line, '::warning title=moderate vulnerability%3A qs::100%25 bad%0Asecond line');
  assert.match(formatAuditFailure('ENOTFOUND', true), /^::error title=npm audit could not run::npm audit could not run: ENOTFOUND\./);
});

test('check-deps: plain console output uses ERROR / WARN prefixes', () => {
  assert.match(formatFinding({ level: 'error', packageName: 'x', severity: 'high', message: 'm' }, false), /^ERROR m$/);
  assert.match(formatFinding({ level: 'warning', packageName: 'x', severity: 'low', message: 'm' }, false), /^WARN  m$/);
});
