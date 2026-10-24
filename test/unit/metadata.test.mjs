/**
 * Sol Watch — 单元测试：metadata（紧凑/旧版时间元数据构造、识别、注入、替换、剥离）
 */
const mod = (await import('../../src/common/metadata.js')).default;

const OLD = '[SOL_TIME v=1 sent_at="2026-01-01T00:00:00+08:00" timezone="Asia/Shanghai"]';
const COMPACT_RE = /^⟦t=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}⟧$/;

export const name = 'metadata';
export const tests = [
  {
    name: 'buildSolTimeLine: 生成紧凑格式，不含旧字段',
    fn() {
      const line = mod.buildSolTimeLine(new Date('2026-10-23T19:53:37+08:00'));
      if (!COMPACT_RE.test(line)) return `格式不符: ${line}`;
      if (line.includes('SOL_TIME') || line.includes('timezone=') || line.includes('v=1')) {
        return `仍含冗余字段: ${line}`;
      }
      return null;
    }
  },
  {
    name: '识别：新版紧凑 / 旧版 / 非元数据',
    fn() {
      const compact = mod.buildSolTimeLine(new Date('2026-10-23T19:53:37+08:00'));
      if (!mod.isCompactSolTimeLine(compact)) return '新版应识别为 compact';
      if (!mod.isSolTimeLine(compact)) return '新版应识别为元数据';
      if (mod.isLegacySolTimeLine(compact)) return '新版不应识别为 legacy';
      if (!mod.isLegacySolTimeLine(OLD)) return '旧版应识别为 legacy';
      if (!mod.isSolTimeLine(OLD)) return '旧版应识别为元数据';
      if (mod.isCompactSolTimeLine(OLD)) return '旧版不应识别为 compact';
      if (mod.isSolTimeLine('hello world')) return '普通文本应为 false';
      if (mod.isSolTimeLine('[SOL_TIME v=2 sent_at="x" timezone=""]')) return '错误版本应为 false';
      return null;
    }
  },
  {
    name: 'countSolTimeLines: 新旧格式都计数',
    fn() {
      const compact = mod.buildSolTimeLine(new Date('2026-10-23T19:53:37+08:00'));
      if (mod.countSolTimeLines('plain text') !== 0) return '普通文本应为 0';
      if (mod.countSolTimeLines(compact + '\nbody') !== 1) return '新版应计数 1';
      if (mod.countSolTimeLines(OLD + '\nbody') !== 1) return '旧版应计数 1';
      if (mod.countSolTimeLines(OLD + '\n' + compact + '\nbody') !== 2) return '新旧混排应计数 2';
      return null;
    }
  },
  {
    name: 'injectOrReplaceSolTime: 空输入 → null',
    fn() {
      const line = mod.buildSolTimeLine();
      return mod.injectOrReplaceSolTime('', line) === null ? null : '空输入应返回 null';
    }
  },
  {
    name: 'injectOrReplaceSolTime: 首次注入为单换行、原文逐字保留',
    fn() {
      const line = mod.buildSolTimeLine(new Date('2026-10-21T10:36:18+08:00'));
      const original = '第一行\n第二行  **Markdown**  😀';
      const out = mod.injectOrReplaceSolTime(original, line);
      if (out == null) return '不应为 null';
      if (!out.startsWith(line + '\n')) return '应把紧凑元数据放最前并以单个换行分隔';
      if (out.startsWith(line + '\n\n')) return '不应注入空行';
      if (!out.endsWith(original)) return '原文应逐字保留在后';
      return null;
    }
  },
  {
    name: 'injectOrReplaceSolTime: CRLF 原文保持 CRLF',
    fn() {
      const line = mod.buildSolTimeLine(new Date('2026-10-23T19:53:37+08:00'));
      const original = '第一行\r\n第二行';
      const out = mod.injectOrReplaceSolTime(original, line);
      if (!out.startsWith(line + '\r\n')) return 'CRLF 原文应使用 CRLF 分隔';
      if (!out.endsWith(original)) return 'CRLF 正文被改动';
      if (out.replace(/\r\n/g, '').includes('\n')) return 'CRLF 原文中出现了单独的 LF';
      return null;
    }
  },
  {
    name: 'injectOrReplaceSolTime: 旧版首行 → 替换为紧凑格式并收掉双换行',
    fn() {
      const line = mod.buildSolTimeLine(new Date('2026-10-23T19:53:37+08:00'));
      const body = '第一行\n第二行';
      const out = mod.injectOrReplaceSolTime(OLD + '\n\n' + body, line);
      if (out == null) return '不应为 null';
      if (!out.startsWith(line + '\n')) return `首行未替换为紧凑格式: ${out}`;
      if (out.includes(OLD)) return '旧格式仍残留';
      if (out.includes('\n\n')) return '旧版双换行应收为单换行';
      if (!out.endsWith(body)) return '正文被改动';
      return null;
    }
  },
  {
    name: 'injectOrReplaceSolTime: 新版首行 → 仅替换，仍只有一行',
    fn() {
      const oldLine = mod.buildSolTimeLine(new Date('2026-01-01T00:00:00+08:00'));
      const newLine = mod.buildSolTimeLine(new Date('2026-10-23T19:53:37+08:00'));
      const body = '第一行\n第二行';
      const out = mod.injectOrReplaceSolTime(oldLine + '\n' + body, newLine);
      if (mod.countSolTimeLines(out) !== 1) return `重发后应仅 1 行元数据：${out}`;
      if (!out.startsWith(newLine + '\n')) return '应替换为新时间';
      if (mod.stripLeadingSolTime(out) !== body) return '替换后正文应保持不变';
      return null;
    }
  },
  {
    name: 'stripLeadingSolTime: 只剥离开头一条，保留正文后的同格式示例',
    fn() {
      const line = mod.buildSolTimeLine(new Date('2026-10-23T19:53:37+08:00'));
      const body = '第一行\n' + line + ' 这是示例\n第二行';
      const out = mod.stripLeadingSolTime(line + '\n' + body);
      if (out !== body) return `正文后的示例被剥离: ${JSON.stringify(out)}`;
      const oldOut = mod.stripLeadingSolTime(OLD + '\n\n' + ('正文\n' + OLD + ' 旧示例'));
      if (oldOut !== '正文\n' + OLD + ' 旧示例') return `旧版示例被剥离: ${JSON.stringify(oldOut)}`;
      return null;
    }
  },
  {
    name: 'stripLeadingSolTime: 正文不是元数据开头时完全不动',
    fn() {
      const line = mod.buildSolTimeLine(new Date('2026-10-23T19:53:37+08:00'));
      const text = '正文第一行\n' + line + '\n正文第二行';
      if (mod.stripLeadingSolTime(text) !== text) return '正文开头的消息不应被剥离';
      if (mod.stripSolTimeLines(text) !== text) return '兼容别名也不应剥离正文中的示例';
      return null;
    }
  },
  {
    name: 'matchSolTimePrefix: 新旧格式都只匹配 token 本体',
    fn() {
      const compact = mod.buildSolTimeLine(new Date('2026-10-23T19:53:37+08:00'));
      if (mod.matchSolTimePrefix(compact + ' 正文 [链接]') !== compact) return '新版 token 匹配失败';
      if (mod.matchSolTimePrefix(OLD + ' 正文 [链接]') !== OLD) return '旧版 token 匹配失败';
      if (mod.matchSolTimePrefix('正文 ' + compact)) return '非开头不应匹配';
      return null;
    }
  }
];
