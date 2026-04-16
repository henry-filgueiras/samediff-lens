#!/usr/bin/env node
// Run every hand-crafted scenario through the pipeline and print the reports.
// No git needed — scenarios inject their own file lists.

const scenarios = require('../src/scenarios');
const { runCheck } = require('../src/check');
const { render } = require('../src/report');

const only = process.argv[2]; // optional scenario name filter

let ran = 0;
for (const scenario of scenarios) {
  if (only && scenario.name !== only) continue;
  ran++;
  process.stdout.write('\n' + '═'.repeat(60) + '\n');
  process.stdout.write(`Scenario: ${scenario.name}\n`);
  process.stdout.write(scenario.description + '\n');
  process.stdout.write('═'.repeat(60) + '\n');
  const result = runCheck({
    base: 'HEAD~1',
    head: 'HEAD',
    title: scenario.title,
    body: scenario.body,
    files: scenario.files,
  });
  process.stdout.write(render(result) + '\n');
}

if (only && ran === 0) {
  process.stderr.write(`no scenario named "${only}"\n`);
  process.exit(2);
}
