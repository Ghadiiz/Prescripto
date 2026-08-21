import dotenv from 'dotenv';

dotenv.config();

import {
  startHarness,
  tokenFor,
  runCase,
  createEvalPatient,
  deleteEvalPatient,
  FIXTURES,
} from './harness.js';
import { liveCases } from './cases.js';
import { getBudget } from '../src/assistant/agentService.js';
import { resetRateLimits } from '../src/assistant/rateLimit.js';

// The LIVE half of the 2.9 eval. Run with `npm run eval`.
//
// This costs real Gemini quota, which is why it is not part of `npm test` and
// why the file is named so Node's default test discovery cannot match it.
//
// Budget is enforced through 2.8's own accounting rather than a second
// counter: getBudget() is the same state the endpoint consults, so the numbers
// printed here are the numbers that will trip the cap.

// The three ids verified working. Each carries its OWN daily quota, so
// spreading cases across them is what makes a full run affordable.
const MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
];

const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const selectCases = () => {
  const only = arg('only');
  if (only) {
    const ids = only.split(',').map((id) => id.trim().toUpperCase());
    return liveCases.filter((c) => ids.includes(c.id));
  }

  const from = arg('from')?.toUpperCase();
  if (from) {
    const index = liveCases.findIndex((c) => c.id === from);
    if (index === -1) throw new Error(`No live case named ${from}`);
    return liveCases.slice(index);
  }

  return liveCases;
};

const pad = (value, width) => String(value).padEnd(width);

const main = async () => {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set — nothing to run against.');
    process.exit(1);
  }

  const selected = selectCases();
  if (!selected.length) {
    console.error('No cases selected.');
    process.exit(1);
  }

  const estimate = selected.reduce((sum, c) => sum + (c.estimatedCalls ?? 0), 0);
  const budget = getBudget();

  console.log(`\nPrescripto live eval — ${selected.length} case(s)`);
  console.log(
    `Budget: ${budget.callsToday} calls used today, ${budget.remaining} remaining ` +
      `(cap ${budget.callsToday + budget.remaining}). This run estimates ${estimate}.`,
  );

  // Pre-flight. Refusing here is the whole point: the eval must not be the
  // thing that exhausts the day's budget and leaves the demo dead.
  if (budget.remaining < estimate) {
    console.error(
      `\nRefusing to start: ${estimate} estimated calls exceeds the ` +
        `${budget.remaining} remaining. Run a subset with --only=L1,L2 or ` +
        '--from=L4, or wait for the UTC-midnight reset.',
    );
    process.exit(1);
  }

  const harness = await startHarness();
  const results = [];
  let evalPatientId;

  try {
    evalPatientId = await createEvalPatient(harness.db, 'live');
    const ctx = { userId: evalPatientId, role: 'patient' };
    const token = tokenFor(evalPatientId);

    for (const [index, testCase] of selected.entries()) {
      const before = getBudget();

      // Stop cleanly rather than letting a case die mid-flight at the cap.
      if (before.remaining < (testCase.estimatedCalls ?? 0)) {
        console.log(
          `\n${testCase.id} and everything after it SKIPPED — ` +
            `${before.remaining} calls remaining.`,
        );
        break;
      }

      // Round-robin: each model has its own daily quota, so spreading the
      // cases is what keeps any single model well under its 20.
      const model = MODELS[index % MODELS.length];
      process.env.GEMINI_MODELS = model;

      // The per-user limiter is 5/hour and would refuse case 6 onwards. It is
      // not what this eval is testing, and 2.7's own suite covers it.
      resetRateLimits();

      let fixture = null;
      let outcome = 'pass';
      let detail = '';

      try {
        if (testCase.fixture) {
          fixture = await FIXTURES[testCase.fixture](harness.db, ctx.userId);
        }

        const context = testCase.before
          ? await testCase.before({ db: harness.db, ctx, fixture })
          : {};

        const messages = testCase.messages.map((message) =>
          message.replace('{{doctorId}}', fixture?.doctor?.id ?? ''),
        );

        const result = await runCase({
          chat: harness.chat,
          db: harness.db,
          token,
          messages,
        });

        const callsSpent = getBudget().callsToday - before.callsToday;

        await testCase.assert({
          ...result,
          db: harness.db,
          ctx,
          fixture,
          before: context,
          callsSpent,
        });

        results.push({ ...testCase, model, callsSpent, outcome });
        console.log(
          `  ${pad(testCase.id, 4)} ${pad('PASS', 5)} ${pad(model, 24)} ` +
            `${callsSpent} call(s)  ${testCase.title}`,
        );
      } catch (error) {
        outcome = 'FAIL';
        detail = error.message;
        const callsSpent = getBudget().callsToday - before.callsToday;

        results.push({ ...testCase, model, callsSpent, outcome, detail });
        console.log(
          `  ${pad(testCase.id, 4)} ${pad('FAIL', 5)} ${pad(model, 24)} ` +
            `${callsSpent} call(s)  ${testCase.title}`,
        );
        // The transcript is the point of a live failure — it is evidence about
        // the model, not a flake to retry. Retrying would also cost quota.
        console.log(`\n${detail}\n`);
      } finally {
        // Always, even when the assertion threw: a fixture left behind would
        // poison every later run and the app itself.
        if (fixture?.cleanup) await fixture.cleanup();
      }
    }
  } finally {
    if (evalPatientId) await deleteEvalPatient(harness.db, evalPatientId);
    delete process.env.GEMINI_MODELS;
    await harness.close();
  }

  const spent = results.reduce((sum, r) => sum + r.callsSpent, 0);
  const failed = results.filter((r) => r.outcome === 'FAIL');
  const after = getBudget();

  console.log(`\n${'-'.repeat(70)}`);
  console.log(
    `${results.length} case(s) run · ${results.length - failed.length} passed · ` +
      `${failed.length} failed`,
  );
  console.log(
    `Spent ${spent} Gemini call(s). ${after.callsToday} used today, ` +
      `${after.remaining} remaining.`,
  );

  const perModel = new Map();
  for (const r of results) {
    perModel.set(r.model, (perModel.get(r.model) ?? 0) + r.callsSpent);
  }
  for (const [model, count] of perModel) {
    console.log(`  ${pad(model, 24)} ${count} call(s) of ~20/day`);
  }

  if (failed.length) {
    console.log(`\nFailed: ${failed.map((f) => f.id).join(', ')}`);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
