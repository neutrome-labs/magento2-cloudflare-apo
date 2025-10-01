#!/usr/bin/env node
/**
 * Build fpc.production.js from workers/fpc.js
 * - Remove lines containing `// no-production` AND also remove the immediate next line
 *   (handles consecutive markers by removing one line after the last marker in the run)
 * - Remove blocks inside `// <no-production>` ... `// </no-production>` (drop markers too)
 * - No special handling for `// <config>` ... `// </config>` blocks anymore
 */

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'workers', 'fpc.js');
const DEST = path.join(__dirname, '..', 'workers', 'fpc.production.js');

function build() {
  const input = fs.readFileSync(SRC, 'utf8');

  const lines = input.split(/\r?\n/);
  const out = [];

  let inNoProdBlock = false;

  const isNoProdMarker = (l) => /\/\/\s*no-production\b/.test(l);

  for (let i = 0; i < lines.length;) {
    const line = lines[i];

    // Handle end of no-production block
    if (inNoProdBlock) {
      if (/\/\/\s*<\/no-production>/.test(line)) {
        inNoProdBlock = false;
        // drop the closing marker line
        i++;
        continue;
      }
      // drop everything inside the block
      i++;
      continue;
    }

    // Start of no-production block: drop marker and enter skip mode
    if (/\/\/\s*<no-production>/.test(line)) {
      inNoProdBlock = true;
      // drop the opening marker line
      i++;
      continue;
    }

    // Single-line no-production marker: remove marker line(s) and the immediate next line once
    if (isNoProdMarker(line)) {
      // skip current marker line
      i++;
      // skip any consecutive marker lines
      while (i < lines.length && isNoProdMarker(lines[i])) {
        i++;
      }
      // skip the immediate next line (if any)
      if (i < lines.length) {
        i++;
      }
      continue;
    }

    // Default: keep the line
    out.push(line);
    i++;
  }

  const output = out.join('\n');
  fs.writeFileSync(DEST, output, 'utf8');
  console.log(`Built: ${path.relative(process.cwd(), DEST)}`);
}

if (require.main === module) {
  try {
    build();
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

module.exports = { build };
