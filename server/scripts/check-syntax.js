#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const ignoredDirectories = new Set(['node_modules', '.git', 'coverage']);
const files = [];

function collectJavaScript(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        collectJavaScript(path.join(directory, entry.name));
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(path.join(directory, entry.name));
    }
  }
}

collectJavaScript(root);
files.sort();

let failures = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.status !== 0) {
    failures += 1;
    process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${file}\n`);
  }
}

if (failures > 0) {
  process.stderr.write(`\nBackend syntax check failed for ${failures} of ${files.length} JavaScript files.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Backend syntax check passed for ${files.length} JavaScript files.\n`);
}
