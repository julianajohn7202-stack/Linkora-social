#!/usr/bin/env node
/**
 * wasm-size-summary.js — Track and report WASM size changes for Linkora contracts.
 *
 * Compares current contract WASM byte counts against an optional baseline artifact.
 * Reports contract names, absolute sizes, deltas, and overall totals.
 * Outputs to console and appends to GITHUB_STEP_SUMMARY when running in CI.
 */

const fs = require('fs');
const path = require('path');

const CONTRACTS_ROOT = path.resolve(__dirname, '..');
const OUTPUT_JSON = path.join(CONTRACTS_ROOT, 'wasm-sizes.json');
const BASELINE_ARG_INDEX = process.argv.indexOf('--baseline');
const BASELINE_PATH = BASELINE_ARG_INDEX !== -1
  ? process.argv[BASELINE_ARG_INDEX + 1]
  : process.env.BASELINE_PATH || path.join(CONTRACTS_ROOT, 'wasm-size-baseline.json');

// Find candidate WASM files
function findWasmFiles() {
  const contracts = [
    {
      name: 'linkora_contracts',
      paths: [
        path.join(CONTRACTS_ROOT, 'contracts/linkora-contracts/linkora_contracts.wasm'),
        path.join(CONTRACTS_ROOT, 'target/wasm32v1-none/release/linkora_contracts.wasm'),
        path.join(CONTRACTS_ROOT, 'target/wasm32-unknown-unknown/release/linkora_contracts.wasm'),
      ]
    },
    {
      name: 'token_factory',
      paths: [
        path.join(CONTRACTS_ROOT, 'contracts/token-factory/token_factory.wasm'),
        path.join(CONTRACTS_ROOT, 'target/wasm32v1-none/release/token_factory.wasm'),
        path.join(CONTRACTS_ROOT, 'target/wasm32-unknown-unknown/release/token_factory.wasm'),
      ]
    }
  ];

  const results = [];
  for (const c of contracts) {
    let foundPath = null;
    let size = 0;
    for (const p of c.paths) {
      if (fs.existsSync(p)) {
        foundPath = p;
        size = fs.statSync(p).size;
        break;
      }
    }
    // If not compiled yet, use 0 or check if mock exists
    results.push({
      name: c.name,
      path: foundPath,
      size: size
    });
  }
  return results;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDelta(current, baseline) {
  if (baseline === undefined || baseline === null) {
    return 'N/A (first run)';
  }
  const diff = current - baseline;
  if (diff === 0) {
    return '0 B (unchanged)';
  }
  const sign = diff > 0 ? '+' : '';
  const percent = baseline > 0 ? ((diff / baseline) * 100).toFixed(2) : '100.00';
  return `${sign}${diff} B (${sign}${percent}%)`;
}

function main() {
  let baseline = {};
  if (fs.existsSync(BASELINE_PATH)) {
    try {
      baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
      console.log(`Loaded baseline from: ${BASELINE_PATH}`);
    } catch (e) {
      console.warn(`Warning: Could not parse baseline at ${BASELINE_PATH}:`, e.message);
    }
  } else {
    console.log(`No baseline artifact found at: ${BASELINE_PATH}. Running as first run.`);
  }

  const contracts = findWasmFiles();
  const currentSizes = {};
  let totalCurrent = 0;
  let totalBaseline = 0;
  let hasBaseline = Object.keys(baseline).length > 0;

  const rows = [];
  for (const c of contracts) {
    currentSizes[c.name] = c.size;
    totalCurrent += c.size;

    const baseSize = hasBaseline && baseline[c.name] !== undefined ? baseline[c.name] : null;
    if (baseSize !== null) {
      totalBaseline += baseSize;
    }

    rows.push({
      name: c.name,
      sizeBytes: c.size,
      sizeFormatted: formatBytes(c.size),
      delta: formatDelta(c.size, baseSize)
    });
  }

  // Write current sizes snapshot
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(currentSizes, null, 2));
  console.log(`Saved contract WASM size snapshot to: ${OUTPUT_JSON}`);

  // Build markdown table
  let md = '### 📦 Contract WASM Size Summary\n\n';
  md += '| Contract | Size (bytes) | Formatted Size | Delta vs Baseline |\n';
  md += '|---|---|---|---|\n';
  for (const r of rows) {
    md += `| **${r.name}** | ${r.sizeBytes.toLocaleString()} | ${r.sizeFormatted} | ${r.delta} |\n`;
  }
  const totalDeltaStr = hasBaseline ? formatDelta(totalCurrent, totalBaseline) : 'N/A (first run)';
  md += `| **Total** | **${totalCurrent.toLocaleString()}** | **${formatBytes(totalCurrent)}** | **${totalDeltaStr}** |\n\n`;

  console.log('\n' + md);

  // Write to GitHub Step Summary if running in GitHub Actions
  const stepSummaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (stepSummaryPath) {
    try {
      fs.appendFileSync(stepSummaryPath, md + '\n');
      console.log('Appended summary to GITHUB_STEP_SUMMARY.');
    } catch (e) {
      console.warn('Failed to write to GITHUB_STEP_SUMMARY:', e.message);
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { findWasmFiles, formatBytes, formatDelta };
