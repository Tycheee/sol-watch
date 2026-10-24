/**
 * Sol Watch — 单元测试：session-anchor（三种模式 + 30 分钟/跨天/会话隔离）
 */
const mod = (await import('../../src/content/session-anchor.js')).default;

const local = (y, m, d, h, min, s = 0) => new Date(y, m - 1, d, h, min, s).getTime();

function prepare(now) {
  let value = now;
  mod.reset();
  mod.setNowForTests(() => value);
  return {
    set(next) { value = next; },
    get() { return value; }
  };
}

export const name = 'session-anchor';
export const tests = [
  {
    name: 'session: 页面生命周期首次发送需要注入',
    fn() {
      prepare(local(2026, 10, 23, 10, 0));
      if (!mod.shouldInject('session', 'id:a', false)) return '首次应注入';
      mod.markInjected('id:a');
      if (mod.shouldInject('session', 'id:a', false)) return '刚注入后 30 分钟内不应再注入';
      return null;
    }
  },
  {
    name: 'session: 满 30 分钟重新注入',
    fn() {
      const clock = prepare(local(2026, 10, 23, 10, 0));
      mod.markInjected('id:a');
      clock.set(local(2026, 10, 23, 10, 29, 59));
      if (mod.shouldInject('session', 'id:a', false)) return '29:59 不应注入';
      clock.set(local(2026, 10, 23, 10, 30, 0));
      if (!mod.shouldInject('session', 'id:a', false)) return '满 30 分钟应重新注入';
      return null;
    }
  },
  {
    name: 'session: 跨本地日期重新注入（即使不足 30 分钟）',
    fn() {
      const clock = prepare(local(2026, 10, 23, 23, 59, 0));
      mod.markInjected('id:a');
      clock.set(local(2026, 10, 24, 0, 1, 0));
      if (!mod.shouldInject('session', 'id:a', false)) return '跨天应重新注入';
      return null;
    }
  },
  {
    name: 'session: 不同 conversation 状态隔离',
    fn() {
      const clock = prepare(local(2026, 10, 23, 10, 0));
      mod.markInjected('id:a');
      if (!mod.shouldInject('session', 'id:b', false)) return '另一个会话应独立注入';
      mod.markInjected('id:b');
      clock.set(local(2026, 10, 23, 10, 5));
      if (mod.shouldInject('session', 'id:b', false)) return 'B 注入后 5 分钟不应再注入';
      return null;
    }
  },
  {
    name: 'session: 页面生命周期 reset 后重新成为锚点',
    fn() {
      prepare(local(2026, 10, 23, 10, 0));
      mod.markInjected('id:a');
      if (mod.shouldInject('session', 'id:a', false)) return '刚注入后不应再注入';
      mod.reset();
      if (!mod.shouldInject('session', 'id:a', false)) return 'reset 后应重新注入';
      return null;
    }
  },
  {
    name: 'session: 首行已有元数据时必须注入（编辑/重发/retry）',
    fn() {
      prepare(local(2026, 10, 23, 10, 0));
      mod.markInjected('id:a');
      if (!mod.shouldInject('session', 'id:a', true)) return '已有元数据时应强制替换';
      return null;
    }
  },
  {
    name: 'always 每条注入，off 完全不注入',
    fn() {
      prepare(local(2026, 10, 23, 10, 0));
      mod.markInjected('id:a');
      if (!mod.shouldInject('always', 'id:a', false)) return 'always 应始终注入';
      if (mod.shouldInject('off', 'id:a', true)) return 'off 应始终不注入';
      return null;
    }
  },
  {
    name: '未知模式按 session 处理',
    fn() {
      prepare(local(2026, 10, 23, 10, 0));
      if (!mod.shouldInject('bogus', 'id:a', false)) return '未知模式首次应注入';
      mod.markInjected('id:a');
      if (mod.shouldInject('bogus', 'id:a', false)) return '未知模式应按 session 的 30 分钟规则';
      return null;
    }
  }
];
