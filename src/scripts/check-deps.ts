/**
 * Dependency vulnerability gate for CI (`npm run check:deps`).
 *
 * Runs `npm audit --json` and applies the repository's severity policy:
 * - `critical` / `high` → error, exit code 1 (blocks the PR).
 * - `moderate` / `low` → warning, exit code 0.
 * - `info` → ignored.
 * - If `npm audit` cannot run (network/registry failure, unexpected output),
 *   the gate fails closed with exit code 1 and states that nothing was checked.
 *
 * Under GitHub Actions (`GITHUB_ACTIONS=true`) findings are emitted as workflow
 * annotations so they show up on the pull request.
 *
 * @see plans/003-check-deps-script.md
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Severity levels reported by `npm audit`. */
export type Severity = 'info' | 'low' | 'moderate' | 'high' | 'critical';

/** Severities that fail the gate. */
export const BLOCKING_SEVERITIES: ReadonlySet<Severity> = new Set<Severity>(['critical', 'high']);

/** Severities reported as warnings without failing the gate. */
export const WARNING_SEVERITIES: ReadonlySet<Severity> = new Set<Severity>(['moderate', 'low']);

/** An advisory entry inside a vulnerability's `via` list. */
export interface AuditAdvisory {
  name: string;
  title: string;
  url: string;
  severity: Severity;
}

/** Fix information as reported by `npm audit` in `fixAvailable`. */
export type AuditFix = boolean | { name: string; version: string; isSemVerMajor: boolean };

/** One vulnerable package in an `npm audit --json` (report v2). */
export interface AuditVulnerability {
  name: string;
  severity: Severity;
  isDirect: boolean;
  /** Advisories affecting this package, or names of vulnerable packages it depends on. */
  via: Array<string | AuditAdvisory>;
  range: string;
  /** Lockfile paths where the package is installed, e.g. `node_modules/qs`. */
  nodes: string[];
  fixAvailable: AuditFix;
}

/** The subset of the `npm audit --json` (report v2) this script relies on. */
export interface AuditReport {
  vulnerabilities: Record<string, AuditVulnerability>;
}

/** A single reportable finding. */
export interface Finding {
  level: 'error' | 'warning';
  packageName: string;
  severity: Severity;
  message: string;
}

/** Result of applying the severity policy to an audit report. */
export interface Evaluation {
  errors: Finding[];
  warnings: Finding[];
  /** Number of vulnerable packages per severity. */
  counts: Record<Severity, number>;
  exitCode: 0 | 1;
}

/** Outcome of running and parsing `npm audit`. */
export type AuditOutcome = { ok: true; report: AuditReport } | { ok: false; reason: string };

/**
 * Tells whether a lockfile node (e.g. `node_modules/qs`) is a dev-only dependency.
 * Returns `undefined` when the node is unknown.
 */
export type DevOnlyLookup = (node: string) => boolean | undefined;

/**
 * Applies the severity policy to a parsed `npm audit --json` report.
 *
 * @param report - Parsed audit report.
 * @param isDevOnly - Optional lookup used to label findings as `prod` or `dev`.
 * @returns Errors, warnings, per-severity counts and the gate's exit code.
 */
export function evaluateAudit(report: AuditReport, isDevOnly?: DevOnlyLookup): Evaluation {
  const counts: Record<Severity, number> = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  const errors: Finding[] = [];
  const warnings: Finding[] = [];

  for (const vuln of Object.values(report.vulnerabilities)) {
    if (!(vuln.severity in counts)) continue;
    counts[vuln.severity] += 1;

    const level = BLOCKING_SEVERITIES.has(vuln.severity)
      ? 'error'
      : WARNING_SEVERITIES.has(vuln.severity)
        ? 'warning'
        : undefined;
    if (!level) continue;

    const finding: Finding = {
      level,
      packageName: vuln.name,
      severity: vuln.severity,
      message: describeVulnerability(vuln, isDevOnly),
    };
    (level === 'error' ? errors : warnings).push(finding);
  }

  return { errors, warnings, counts, exitCode: errors.length > 0 ? 1 : 0 };
}

/**
 * Parses the raw output of `npm audit --json`.
 *
 * The exit code of `npm audit` is not used to decide pass/fail (it is non-zero
 * whenever anything is found); it only enriches the reason when the output is unusable.
 *
 * @param stdout - Standard output of `npm audit --json`.
 * @param stderr - Standard error, used as extra detail when the audit could not run.
 * @param status - Exit code of `npm audit`, if any.
 * @returns The parsed report, or the reason the audit could not be evaluated.
 */
export function parseAuditOutput(stdout: string, stderr = '', status: number | null = null): AuditOutcome {
  const detail = stderr.trim().split(/\r?\n/).slice(-3).join(' | ');
  const fail = (reason: string): AuditOutcome => ({ ok: false, reason: detail ? `${reason} — ${detail}` : reason });

  if (!stdout.trim()) return fail(`npm audit produced no output (exit code ${status ?? 'unknown'})`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return fail('npm audit output is not valid JSON');
  }

  if (!isRecord(parsed)) return fail('unexpected npm audit report format');

  if (isRecord(parsed.error)) {
    // npm 11 puts the reason in a top-level `message`, with `error.summary`/`detail` often empty.
    const parts = [parsed.error.code, parsed.error.summary, parsed.error.detail, parsed.message]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .map((part) => part.replace(/\s+/g, ' ').trim());
    if (parts.length === 0) return fail('npm audit reported an error');
    return { ok: false, reason: [...new Set(parts)].join(': ') };
  }

  if (!isRecord(parsed.vulnerabilities)) return fail('unexpected npm audit report format (missing "vulnerabilities")');

  return { ok: true, report: parsed as unknown as AuditReport };
}

/**
 * Runs `npm audit --json` in the given directory and parses its output.
 *
 * @param cwd - Directory containing `package.json` and `package-lock.json`.
 * @returns The parsed report, or the reason the audit could not run.
 */
export function runAudit(cwd: string = process.cwd()): AuditOutcome {
  // A shell is required on Windows (`npm` is `npm.cmd`). The command is a constant
  // string with no user input, so there is nothing to escape.
  const result = spawnSync('npm audit --json', {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: true,
  });
  if (result.error) return { ok: false, reason: `failed to start npm: ${result.error.message}` };
  return parseAuditOutput(result.stdout ?? '', result.stderr ?? '', result.status);
}

/**
 * Builds a {@link DevOnlyLookup} from `package-lock.json` (lockfile v2/v3 `packages` map).
 *
 * @param lockfilePath - Path to the lockfile.
 * @returns The lookup, or `undefined` if the lockfile can't be read.
 */
export function loadDevOnlyLookup(lockfilePath = 'package-lock.json'): DevOnlyLookup | undefined {
  try {
    const lock: unknown = JSON.parse(readFileSync(lockfilePath, 'utf8'));
    if (!isRecord(lock) || !isRecord(lock.packages)) return undefined;
    const packages = lock.packages;
    return (node) => {
      const entry = packages[node];
      return isRecord(entry) ? entry.dev === true : undefined;
    };
  } catch {
    return undefined;
  }
}

/**
 * Formats a finding for the console or as a GitHub Actions annotation.
 *
 * @param finding - Finding to format.
 * @param githubActions - Emit a `::error` / `::warning` workflow command instead of plain text.
 */
export function formatFinding(finding: Finding, githubActions: boolean): string {
  if (githubActions) {
    const title = `${finding.severity} vulnerability: ${finding.packageName}`;
    return `::${finding.level} title=${escapeProperty(title)}::${escapeData(finding.message)}`;
  }
  return `${finding.level === 'error' ? 'ERROR' : 'WARN '} ${finding.message}`;
}

/**
 * Formats the message shown when `npm audit` could not run.
 *
 * @param reason - Why the audit could not run.
 * @param githubActions - Emit a `::error` workflow command instead of plain text.
 */
export function formatAuditFailure(reason: string, githubActions: boolean): string {
  const message = `npm audit could not run: ${reason}. No dependencies were checked, so the gate fails closed.`;
  return githubActions
    ? `::error title=${escapeProperty('npm audit could not run')}::${escapeData(message)}`
    : `ERROR ${message}`;
}

/**
 * Formats the one-line summary printed at the end of a run.
 *
 * @param evaluation - Result of {@link evaluateAudit}.
 */
export function formatSummary(evaluation: Evaluation): string {
  const { counts, errors, warnings } = evaluation;
  const totals = `critical: ${counts.critical}, high: ${counts.high}, moderate: ${counts.moderate}, low: ${counts.low}, info: ${counts.info}`;
  if (errors.length > 0) return `✖ check:deps FAILED — ${errors.length} blocking vulnerable package(s) (${totals})`;
  if (warnings.length > 0) return `⚠ check:deps PASSED with ${warnings.length} warning(s) (${totals})`;
  return '✔ No known vulnerabilities';
}

/**
 * Entry point: runs the audit, prints findings and a summary, and sets `process.exitCode`.
 */
export function main(): void {
  const githubActions = process.env.GITHUB_ACTIONS === 'true';
  // Workflow commands must go to stdout to be picked up by the runner.
  const printError = githubActions ? console.log : console.error;
  const printWarning = githubActions ? console.log : console.warn;

  const outcome = runAudit();
  if (!outcome.ok) {
    printError(formatAuditFailure(outcome.reason, githubActions));
    process.exitCode = 1;
    return;
  }

  const evaluation = evaluateAudit(outcome.report, loadDevOnlyLookup());
  for (const finding of evaluation.errors) printError(formatFinding(finding, githubActions));
  for (const finding of evaluation.warnings) printWarning(formatFinding(finding, githubActions));
  console.log(formatSummary(evaluation));
  process.exitCode = evaluation.exitCode;
}

/**
 * Builds the human-readable description of a vulnerable package.
 */
function describeVulnerability(vuln: AuditVulnerability, isDevOnly?: DevOnlyLookup): string {
  const scope = [vuln.isDirect ? 'direct' : 'transitive'];
  const dependencyType = classifyDependencyType(vuln.nodes, isDevOnly);
  if (dependencyType) scope.push(dependencyType);

  const advisories = vuln.via
    .filter((entry): entry is AuditAdvisory => typeof entry === 'object' && entry !== null)
    .map((advisory) => `${advisory.title} (${advisory.url})`);
  const parents = vuln.via.filter((entry): entry is string => typeof entry === 'string');
  const causes = parents.length > 0 ? [...advisories, `via ${parents.join(', ')}`] : advisories;

  return `${vuln.name} ${vuln.range} [${vuln.severity}] (${scope.join(', ')}) — ${causes.join('; ')} — ${describeFix(vuln.fixAvailable)}`;
}

/**
 * Labels a package as `dev` when every installed node is dev-only, `prod` otherwise,
 * or `undefined` when that can't be determined.
 */
function classifyDependencyType(nodes: string[], isDevOnly?: DevOnlyLookup): 'prod' | 'dev' | undefined {
  if (!isDevOnly || nodes.length === 0) return undefined;
  const flags = nodes.map(isDevOnly);
  if (flags.some((flag) => flag === undefined)) return undefined;
  return flags.every(Boolean) ? 'dev' : 'prod';
}

/**
 * Describes the `fixAvailable` field of a vulnerability.
 */
function describeFix(fix: AuditFix): string {
  if (fix === true) return 'fix available';
  if (fix === false) return 'no fix available';
  return `fix available: ${fix.name}@${fix.version}${fix.isSemVerMajor ? ' (semver-major)' : ''}`;
}

/**
 * Narrows an unknown value to a plain object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Escapes the message part of a GitHub Actions workflow command.
 */
function escapeData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

/**
 * Escapes a property value (e.g. `title`) of a GitHub Actions workflow command.
 */
function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
