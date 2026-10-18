import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../src/app/App';
import { PROGRESS_STORAGE_KEY, getDefaultProgress } from '../src/storage/persistence';
import type { LevelId, MechanismId } from '../src/game/engine/types';

vi.stubGlobal('scrollTo', vi.fn());

function clickButton(name: RegExp | string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

function seedCompleted(completedLevels: LevelId[], unlockedMechanisms: MechanismId[]) {
  const progress = {
    ...getDefaultProgress(),
    completedLevels,
    unlockedMechanisms,
    lastSavedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
}

beforeEach(() => {
  window.localStorage.clear();
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('用户流程冒烟测试（足球经理题材）', () => {
  it('从主页进入战术板，完整走完一关并解锁下一关', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('足球经理修理铺');
    expect(screen.getByText('委托板')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: '开始维修' })[0]);
    expect(screen.getByRole('heading', { name: '战术板' })).toBeTruthy();
    expect(screen.getByText(/约 4 分钟/)).toBeTruthy();

    clickButton('开始故障试玩');
    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: /压上/ }));
    }
    expect(screen.getByText('所有阶段的共同点')).toBeTruthy();
    clickButton('带着问题去诊断');

    fireEvent.click(screen.getByRole('radio', { name: /控球和无球需要两套不同的站位与职责/ }));
    clickButton('提交判断');
    clickButton('开始维修');
    // v4 移除了「推荐组合」快捷按钮，需要从模块池逐个安装正确结构。
    fireEvent.click(screen.getAllByRole('button', { name: /安装模块：双形态战术/ })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: /安装模块：职责分工/ })[0]);
    clickButton('开始验证');

    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: /保护边路/ }));
    }
    clickButton('完成验证，去迁移');

    fireEvent.click(screen.getByRole('checkbox', { name: /有球形态：/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /无球形态：/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /职责分工：/ }));
    clickButton('提交判断');
    clickButton('进入归档');
    clickButton(/完成归档/);

    // finishArchive 会返回主页并写入正式进度。
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('足球经理修理铺');
    expect(screen.getAllByText(/已完成 1 \/ 4/).length).toBeGreaterThan(0);
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as {
      completedLevels: string[];
      unlockedMechanisms: string[];
      levelStates: Record<string, unknown>;
      club: {
        week: number;
        transferBudget: number;
        failures: number;
        tactics: { possessionShape: string } | null;
        timeline: { levelId: string; headline: string }[];
      };
    };
    expect(parsed.completedLevels).toContain('tactics');
    expect(parsed.unlockedMechanisms).toContain('tactics-shapes');
    expect(parsed.levelStates.tactics).toBeUndefined();
    // 俱乐部时间线写入真实战术板结果，并把战术配置带入后续关卡。
    expect(parsed.club.timeline).toHaveLength(1);
    expect(parsed.club.timeline[0].levelId).toBe('tactics');
    expect(parsed.club.timeline[0].headline).toContain('战术板');
    expect(parsed.club.tactics?.possessionShape).toBe('4-3-3');
    expect(parsed.club.week).toBe(1);
    expect(parsed.club.failures).toBe(0);
    expect(parsed.club.transferBudget).toBe(45);
    expect(screen.getByText('最近一份维修结果')).toBeTruthy();
    expect(screen.getByText('战术板产出')).toBeTruthy();
    expect(screen.getAllByText(/最近更新/).length).toBeGreaterThan(0);

    // 第二关已解锁。
    const startButtons = screen.getAllByRole('button', { name: '开始维修' });
    expect(startButtons.length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: '完成上一关后解锁' }).length).toBe(2);
  });

  it('刷新式重新挂载后能恢复关卡内状态', () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: '开始维修' })[0]);
    clickButton('开始故障试玩');
    fireEvent.click(screen.getByRole('button', { name: /压上/ }));
    fireEvent.click(screen.getByRole('button', { name: /平衡/ }));
    expect(screen.getByText('故障试玩：固定一套 4-4-2')).toBeTruthy();

    cleanup();
    render(<App />);
    expect(screen.getByRole('heading', { name: '战术板' })).toBeTruthy();
    expect(screen.getByText('故障试玩：固定一套 4-4-2')).toBeTruthy();
    // 第 3 阶段还没打，页面仍显示“第 3 / 3 阶段”。
    expect(screen.getByText(/第 3 \/ 3 阶段/)).toBeTruthy();
  });

  it('展示模式不影响正式进度，且能返回演示页', () => {
    render(<App />);
    clickButton('进入展示模式');
    expect(screen.getByRole('heading', { name: '展示模式' })).toBeTruthy();
    expect(screen.getByText(/演示不写入正式进度/)).toBeTruthy();

    clickButton(/试玩故障版/);
    expect(screen.getAllByText(/固定种子/).length).toBeGreaterThan(0);
    clickButton(/返回演示/);
    expect(screen.getByRole('heading', { name: '展示模式' })).toBeTruthy();

    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { completedLevels: string[]; currentLevel: string | null };
      expect(parsed.completedLevels).toEqual([]);
      expect(parsed.currentLevel).toBeNull();
    }
  });

  it('按顺序完成三关后解锁毕业关，且没有锁定委托', () => {
    seedCompleted(
      ['tactics', 'scouting', 'transfers'],
      ['tactics-shapes', 'scout-network', 'transfer-negotiation'],
    );
    render(<App />);
    expect(screen.getAllByText(/已完成 3 \/ 4/).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: '完成上一关后解锁' })).toHaveLength(0);
    expect(screen.getByRole('button', { name: '开始维修' })).toBeTruthy();
  });

  it('设置页可以重置全部进度', () => {
    seedCompleted(['tactics'], ['tactics-shapes']);
    render(<App />);
    expect(screen.getByText(/图鉴 1 \/ 4/)).toBeTruthy();

    clickButton('设置与存档');
    expect(screen.getByRole('heading', { name: '设置与存档' })).toBeTruthy();
    clickButton('重置全部进度');
    expect(screen.getByRole('dialog', { name: '确定重置全部进度？' })).toBeTruthy();
    clickButton('确认重置');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('足球经理修理铺');
    expect(screen.getAllByText(/已完成 0 \/ 4/).length).toBeGreaterThan(0);

    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { completedLevels: string[]; unlockedMechanisms: string[] };
      expect(parsed.completedLevels).toEqual([]);
      expect(parsed.unlockedMechanisms).toEqual([]);
    }
  });

  it('30 秒体验入口直接进入故障试玩', () => {
    render(<App />);
    clickButton('30 秒体验战术板');
    expect(screen.getByRole('heading', { name: '战术板' })).toBeTruthy();
    expect(screen.getByText('故障试玩：固定一套 4-4-2')).toBeTruthy();
  });

  it('主页可以打开机制原理馆，并读到四关底层机制', () => {
    render(<App />);
    clickButton('机制原理');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('底层知识');
    expect(screen.getByText('四关的底层机制')).toBeTruthy();
    expect(screen.getByText('机制基础课')).toBeTruthy();
    expect(screen.getByText('双形态战术：把“阶段”变成两套规则')).toBeTruthy();
    expect(screen.getByText('球探网络：把“信息”做成有限资源')).toBeTruthy();
    expect(screen.getAllByText(/术语表/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/机制百科全书/).length).toBeGreaterThan(0);
  });

  it('关卡顶栏可以深链到该关的机制原理', () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: '开始维修' })[0]);
    clickButton('机制原理');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('底层知识');
    expect(screen.getByText('双形态战术：把“阶段”变成两套规则')).toBeTruthy();
  });
});
