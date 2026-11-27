#!/usr/bin/env node

/**
 * generate-error-fixtures.js
 *
 * Extracts public contract error enums and their assigned discriminant numeric codes
 * from contracts/linkora-contracts/src/errors.rs and writes the canonical ABI fixture
 * to contracts/linkora-contracts/fixtures/contract_errors.json.
 */

const fs = require('fs');
const path = require('path');

const errorsFilePath = path.join(
  __dirname,
  '../contracts/linkora-contracts/src/errors.rs'
);
const fixtureOutputPath = path.join(
  __dirname,
  '../contracts/linkora-contracts/fixtures/contract_errors.json'
);

function parseErrorEnums(src) {
  const result = {};
  const enumRegex = /pub\s+enum\s+([A-Za-z0-9_]+)\s*\{([^}]+)\}/g;
  let match;

  while ((match = enumRegex.exec(src)) !== null) {
    const enumName = match[1];
    const enumBody = match[2];
    const variants = {};

    const variantRegex = /([A-Za-z0-9_]+)\s*=\s*(\d+)/g;
    let varMatch;
    while ((varMatch = variantRegex.exec(enumBody)) !== null) {
      variants[varMatch[1]] = parseInt(varMatch[2], 10);
    }

    if (Object.keys(variants).length > 0) {
      result[enumName] = variants;
    }
  }

  return result;
}

function main() {
  if (!fs.existsSync(errorsFilePath)) {
    console.error(`Error: errors.rs not found at ${errorsFilePath}`);
    process.exit(1);
  }

  const src = fs.readFileSync(errorsFilePath, 'utf8');
  const parsed = parseErrorEnums(src);

  const outDir = path.dirname(fixtureOutputPath);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const jsonContent = JSON.stringify(parsed, null, 2) + '\n';
  fs.writeFileSync(fixtureOutputPath, jsonContent, 'utf8');

  console.log(`Generated contract error fixture at ${fixtureOutputPath}`);
  for (const [name, variants] of Object.entries(parsed)) {
    console.log(`  - ${name}: ${Object.keys(variants).length} variants`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { parseErrorEnums };
