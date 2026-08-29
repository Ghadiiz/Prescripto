#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// A lint ratchet, because the frontends do not lint clean and will not for a
// while.
//
// `frontend` and `admin` carry pre-existing errors that CLAUDE.md has recorded
// for months: React effect rules and context exports whose fixes change
// behaviour, in apps with no test suite to catch a regression. A CI step that
// simply ran eslint would be red on every push and would stop being read
// within a week.
//
// So the gate is "no worse than the committed baseline". That is enforceable
// today, and it is the only version of this check that actually prevents a
// regression rather than describing one.
//
// It fails when the count goes UP, and — deliberately — also when it goes
// DOWN. A ceiling nobody lowers drifts away from reality until it admits a new
// error under the slack of an old one. Fixing errors is good; leaving the
// baseline stale is how the ratchet quietly stops working.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const baselinePath = resolve(here, 'lint-baseline.json');

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

const lint = (app) => {
  const cwd = resolve(repoRoot, app);

  let raw;
  try {
    raw = execFileSync('npx', ['eslint', '.', '-f', 'json'], {
      cwd,
      encoding: 'utf8',
      // eslint exits non-zero when it reports errors, which is the normal case
      // here. The report on stdout is what matters.
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
  } catch (error) {
    raw = error.stdout;
    if (!raw) {
      console.error(`Could not run eslint in ${app}: ${error.message}`);
      process.exit(2);
    }
  }

  const report = JSON.parse(raw);
  const errors = [];
  let warnings = 0;

  for (const file of report) {
    for (const message of file.messages) {
      if (message.severity === 2) {
        errors.push({
          file: file.filePath.slice(cwd.length + 1).replaceAll('\\', '/'),
          line: message.line,
          rule: message.ruleId,
          message: message.message.split('\n')[0],
        });
      } else {
        warnings += 1;
      }
    }
  }

  return { errors, warnings };
};

let failed = false;

for (const [app, allowed] of Object.entries(baseline)) {
  const { errors, warnings } = lint(app);
  const count = errors.length;

  console.log(`\n${app}: ${count} error(s), ${warnings} warning(s) — baseline ${allowed}`);

  if (count > allowed) {
    failed = true;
    console.error(
      `  FAIL: ${count - allowed} more error(s) than the baseline allows.`,
    );
    // Print them all: which ones are new is not knowable from counts alone, so
    // the whole list is the useful output.
    for (const e of errors) {
      console.error(`    ${e.file}:${e.line}  [${e.rule}]  ${e.message}`);
    }
  } else if (count < allowed) {
    failed = true;
    console.error(
      `  FAIL: ${allowed - count} fewer error(s) than the baseline. Good news — ` +
        `now lower "${app}" to ${count} in scripts/lint-baseline.json so the ` +
        'ratchet keeps holding at the new level.',
    );
  } else {
    console.log('  OK: unchanged from the baseline.');
  }
}

if (failed) {
  console.error('\nLint ratchet failed.');
  process.exit(1);
}

console.log('\nLint ratchet passed.');
