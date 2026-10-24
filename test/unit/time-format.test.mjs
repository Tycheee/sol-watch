/**
 * Sol Watch — 单元测试：time-format
 * 含夏令时（DST）断言：通过子进程以 TZ=America/New_York 验证 UTC offset。
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mod = (await import('../../src/common/time-format.js')).default;

export const name = 'time-format';
export const tests = [
  {
    name: 'normalizeTimestamp: 秒数原样',
    fn() {
      const r = mod.normalizeTimestamp(1767180600);
      return r === 1767180600 ? null : `got ${r}`;
    }
  },
  {
    name: 'normalizeTimestamp: 毫秒转为秒',
    fn() {
      const r = mod.normalizeTimestamp(1767180600000);
      return r === 1767180600 ? null : `got ${r}`;
    }
  },
  {
    name: 'normalizeTimestamp: 数字字符串',
    fn() {
      const r = mod.normalizeTimestamp('1767180600');
      return r === 1767180600 ? null : `got ${r}`;
    }
  },
  {
    name: 'normalizeTimestamp: ISO 字符串',
    fn() {
      const r = mod.normalizeTimestamp('2026-09-30T13:30:00Z');
      return r === Math.round(Date.parse('2026-09-30T13:30:00Z') / 1000) ? null : `got ${r}`;
    }
  },
  {
    name: 'normalizeTimestamp: Date 对象',
    fn() {
      const d = new Date(1767180600 * 1000);
      const r = mod.normalizeTimestamp(d);
      return r === 1767180600 ? null : `got ${r}`;
    }
  },
  {
    name: 'normalizeTimestamp: null/空串/非法 → null',
    fn() {
      for (const bad of [null, undefined, '', 'abc', NaN]) {
        if (mod.normalizeTimestamp(bad) != null) return `应返回 null：${String(bad)}`;
      }
      return null;
    }
  },
  {
    name: 'normalizeTimestamp: 0/负数 → null（不伪造）',
    fn() {
      if (mod.normalizeTimestamp(0) != null) return '0 应返回 null';
      if (mod.normalizeTimestamp(-5) != null) return '负数应返回 null';
      return null;
    }
  },
  {
    name: 'formatClockTime: 24h 制格式 MM/DD HH:mm:ss',
    fn() {
      const r = mod.formatClockTime(1767180600, true);
      return /^\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(r) ? null : `got ${r}`;
    }
  },
  {
    name: 'formatClockTime: 12h 制格式含 AM/PM',
    fn() {
      const r = mod.formatClockTime(1767180600, false);
      return /^\d{2}\/\d{2} \d{1,2}:\d{2}:\d{2} (AM|PM)$/.test(r) ? null : `got ${r}`;
    }
  },
  {
    name: 'normalizeTimestamp: 毫秒阈值边界（1e12 视为毫秒 → 秒）',
    fn() {
      const r = mod.normalizeTimestamp(1e12);
      return r === 1e9 ? null : `got ${r}`;
    }
  },
  {
    name: 'formatClockTime: 非法输入返回空串',
    fn() {
      return mod.formatClockTime(null, true) === '' ? null : '应返回空串';
    }
  },
  {
    name: 'formatSentAt: YYYY-MM-DDTHH:mm:ss±HH:MM',
    fn() {
      const r = mod.formatSentAt(new Date(1767180600 * 1000));
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(r) ? null : `got ${r}`;
    }
  },
  {
    name: 'formatUtcOffset: 符号与分钟对齐',
    fn() {
      // 上海 UTC+8 → +08:00
      const r = mod.formatUtcOffset(new Date('2026-01-15T00:00:00+08:00'));
      return r === '+08:00' ? null : `got ${r}`;
    }
  },
  {
    name: 'resolveIanaTimezone: 返回非空字符串',
    fn() {
      const tz = mod.resolveIanaTimezone();
      return typeof tz === 'string' && tz.length > 0 ? null : `got ${tz}`;
    }
  },
  {
    name: 'DST 子进程断言（America/New_York 2026：1 月 EST -05:00，6 月 EDT -04:00）',
    fn() {
      const script = `
        const tf = require('./src/common/time-format.js');
        const jan = new Date('2026-01-15T12:00:00');
        const jun = new Date('2026-06-15T12:00:00');
        process.stdout.write(JSON.stringify({ jan: tf.formatUtcOffset(jan), jun: tf.formatUtcOffset(jun) }));
      `;
      const res = spawnSync(process.execPath, ['-e', script], {
        cwd: ROOT,
        env: { ...process.env, TZ: 'America/New_York' },
        encoding: 'utf8'
      });
      if (res.status !== 0) return `子进程失败: ${res.stderr}`;
      const out = JSON.parse(res.stdout);
      if (out.jan !== '-05:00') return `1月应为 -05:00，got ${out.jan}`;
      if (out.jun !== '-04:00') return `6月应为 -04:00，got ${out.jun}`;
      return null;
    }
  }
];
