/**
 * Sol Watch — 单元测试：settings（默认值 + 归一化 + 旧字段迁移）
 */
const mod = (await import('../../src/content/settings.js')).default;

export const name = 'settings';
export const tests = [
  {
    name: 'DEFAULTS 键完整且默认使用会话锚点',
    fn() {
      const d = mod.DEFAULTS;
      const expected = {
        showUserTime: true,
        showAssistantTime: false,
        sendTimeMode: 'session',
        showSolTimeDebugLine: false,
        use24HourFormat: true,
        debug: false
      };
      for (const [k, v] of Object.entries(expected)) {
        if (d[k] !== v) return `${k} 默认应为 ${JSON.stringify(v)}，got ${JSON.stringify(d[k])}`;
      }
      if ('tellModelSendTime' in d) return 'DEFAULTS 不应再包含旧字段';
      return null;
    }
  },
  {
    name: 'normalizeSettings: 布尔覆盖与未知键忽略',
    fn() {
      const n = mod.normalizeSettings({ showUserTime: false, showAssistantTime: true, bogus: 1 });
      if (n.showUserTime !== false) return 'showUserTime 应被覆盖为 false';
      if (n.showAssistantTime !== true) return 'showAssistantTime 应被覆盖为 true';
      if (n.sendTimeMode !== 'session') return '未指定模式应为 session';
      if (n.use24HourFormat !== true) return 'use24HourFormat 应保持默认 true';
      if ('bogus' in n) return '未知键不应出现';
      return null;
    }
  },
  {
    name: '旧字段迁移：false → off，true/缺失 → session',
    fn() {
      if (mod.normalizeSettings({ tellModelSendTime: false }).sendTimeMode !== 'off') {
        return 'tellModelSendTime=false 应迁移为 off';
      }
      if (mod.normalizeSettings({ tellModelSendTime: true }).sendTimeMode !== 'session') {
        return 'tellModelSendTime=true 应迁移为 session';
      }
      if (mod.normalizeSettings({}).sendTimeMode !== 'session') {
        return '字段缺失应默认为 session';
      }
      return null;
    }
  },
  {
    name: '新字段优先：sendTimeMode 覆盖旧布尔值',
    fn() {
      const n = mod.normalizeSettings({ sendTimeMode: 'always', tellModelSendTime: false });
      if (n.sendTimeMode !== 'always') return 'sendTimeMode 应优先于 tellModelSendTime';
      if ('tellModelSendTime' in n) return '归一化结果不应保留旧字段';
      return null;
    }
  },
  {
    name: '非法 sendTimeMode 回退到旧字段，再回退 session',
    fn() {
      if (mod.normalizeSettings({ sendTimeMode: 'bogus', tellModelSendTime: false }).sendTimeMode !== 'off') {
        return '非法新值应回退到旧字段 false→off';
      }
      if (mod.normalizeSettings({ sendTimeMode: 'bogus' }).sendTimeMode !== 'session') {
        return '非法新值且无旧字段应回退 session';
      }
      return null;
    }
  },
  {
    name: 'SEND_TIME_MODES 仅包含三种合法模式',
    fn() {
      const expected = ['session', 'always', 'off'];
      return JSON.stringify(mod.SEND_TIME_MODES) === JSON.stringify(expected)
        ? null
        : `got ${JSON.stringify(mod.SEND_TIME_MODES)}`;
    }
  }
];
