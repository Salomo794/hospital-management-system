// GitHub validates a workflow file before it runs anything. A context used one
// level too high (for example `runner` inside a job-level `env:` block) makes
// the entire file invalid, and the failure surfaces only as "workflow run
// failed" with no jobs, no logs and no failing step. That is exactly what
// happened here, so these assertions read the real workflow file.
//
// A YAML parser is deliberately not required: the checks only need indentation
// and the set of expressions, which keeps the test dependency-free.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.join(__dirname, '..', '..');
const workflowPath = path.join(repositoryRoot, '.github', 'workflows', 'node.js.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const lines = workflow.split('\n');

// Contexts that GitHub does not expose at job level. `secrets`, `vars`, `github`
// and `matrix` are available there; `runner`, `steps`, `job` and `env` are not.
const JOB_LEVEL_FORBIDDEN = ['runner', 'steps', 'job', 'env'];

const indentOf = line => line.length - line.trimStart().length;
const isBlankOrComment = line => line.trim() === '' || line.trimStart().startsWith('#');

// Every `env:` block in the file, with the indent of its keys and the range of
// lines it covers, so an expression can be attributed to the right block.
function envBlocks() {
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() !== 'env:') continue;
    const envIndent = indentOf(lines[index]);
    const block = { headerIndent: envIndent, keyIndent: null, expressionLines: [] };
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (isBlankOrComment(line)) continue;
      const indent = indentOf(line);
      // The block ends at the first line that is not deeper than `env:`.
      if (indent <= envIndent) break;
      if (block.keyIndent === null) block.keyIndent = indent;
      if (line.includes('${{')) block.expressionLines.push({ number: cursor + 1, text: line });
    }
    blocks.push(block);
  }
  return blocks;
}

test('no job-level env block uses a context GitHub only exposes to steps', () => {
  // Job-level env sits directly under a job key, so its `env:` header is
  // indented four spaces. Step-level env is deeper and is allowed to use `runner`.
  const jobLevel = envBlocks().filter(block => block.headerIndent === 4);
  assert.ok(jobLevel.length > 0, 'the workflow still declares a job-level env block');

  const offenders = [];
  for (const block of jobLevel) {
    for (const line of block.expressionLines) {
      for (const context of JOB_LEVEL_FORBIDDEN) {
        if (new RegExp(`\\b${context}\\.`).test(line.text)) {
          offenders.push(`line ${line.number}: "${line.text.trim()}" uses "${context}" at job level`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `job-level env must use literal values only:\n${offenders.join('\n')}`);
});

test('the database path used by the workflow is defined at step level', () => {
  // The seeded database lives under the runner temp directory, which is only
  // addressable from a step. Guards against reintroducing the invalid form.
  const declaration = lines.findIndex(line => line.includes('DB_PATH:'));
  assert.notEqual(declaration, -1, 'the workflow still points the database at the runner temp directory');
  assert.match(lines[declaration], /\$\{\{\s*runner\.temp\s*\}\}/);

  const governingEnv = envBlocks()
    .filter(block => block.expressionLines.some(entry => entry.number === declaration + 1))
    .pop();
  assert.ok(governingEnv, 'DB_PATH is declared inside an env block');
  assert.notEqual(governingEnv.headerIndent, 4, 'DB_PATH must not be declared in a job-level env block');
});

test('every npm script the workflow runs exists in package.json', () => {
  // CI that calls a renamed script fails in a way that looks like a code
  // problem. Check the contract from the manifests instead.
  const scripts = new Set(Object.keys(require(path.join(repositoryRoot, 'package.json')).scripts));
  const invoked = new Set();
  for (const line of lines) {
    for (const match of line.matchAll(/npm\s+(?:run\s+)?([a-z][a-z0-9:-]*)/gi)) invoked.add(match[1]);
  }

  const missing = [...invoked].filter(name => !scripts.has(name));
  assert.deepEqual(missing, [], `workflow runs scripts that package.json does not define: ${missing.join(', ')}`);
});
