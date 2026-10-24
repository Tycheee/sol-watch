#!/usr/bin/env node
/**
 * Sol Watch — 单元测试运行器
 * 逐个加载 test/unit/*.test.mjs，执行其中的 tests，汇总通过/失败。
 * 用法：node test/run-tests.mjs
 */
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const unitDir = join(__dirname, 'unit');

const files = readdirSync(unitDir).filter((f) => f.endsWith('.test.mjs')).sort();

let passed = 0;
let failed = 0;
const failures = [];

for (const file of files) {
  const mod = await import('file://' + join(unitDir, file).replace(/\\/g, '/'));
  for (const t of mod.tests) {
    let err = null;
    try {
      let outcome = t.fn();
      if (outcome && typeof outcome.then === 'function') {
        outcome = await outcome; // 异步用例：resolve 出的字符串/Error 同样是失败信息
      }
      if (outcome instanceof Error) err = outcome.stack || String(outcome);
      else if (outcome) err = String(outcome);
    } catch (e) {
      err = e && e.stack ? e.stack : String(e);
    }
    if (err) {
      failed++;
      failures.push(`[${mod.name}] ${t.name}\n    → ${err}`);
      console.error(`✗ ${mod.name} › ${t.name}\n    ${err}`);
    } else {
      passed++;
      console.log(`✓ ${mod.name} › ${t.name}`);
    }
  }
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failures.length) process.exitCode = 1;
