import { describe, it, expect } from 'vitest';
import {
  applyDemoCompletion,
  applyLevelCompletion,
  completionMessage,
  createEmptyDemo,
  markDemoStep,
} from '../src/game/progressOps';
import { LEVELS, isLevelUnlocked, summarizeProgress } from '../src/game/levels';
import { getDefaultProgress } from '../src/storage/persistence';
import type { LevelCompletion } from '../src/game/engine/types';

const COMPLETION: LevelCompletion = {
  evidence: { experiencedFault: true, operatedMechanic: true, transferred: true },
  summary: ['完成故障试玩', '安装双形态战术', '完成验证'],
};

const NOW = '2026-10-18T12:00:00.000Z';

describe('正常模式关卡完成', () => {
  it('完成战术板：记录关卡、解锁双形态战术、清除该关暂存状态', () => {
    const progress = {
      ...getDefaultProgress(),
      currentLevel: 'tactics' as const,
      levelStates: { tactics: { phase: 'verify' } },
    };
    const demo = createEmptyDemo();

    const outcome = applyLevelCompletion(progress, demo, 'tactics', COMPLETION, 'normal', NOW);

    expect(outcome.completed).toBe(true);
    expect(outcome.unlockedMechanism).toBe('tactics-shapes');
    expect(outcome.progress.completedLevels).toEqual(['tactics']);
    expect(outcome.progress.unlockedMechanisms).toEqual(['tactics-shapes']);
    expect(outcome.progress.levelStates.tactics).toBeUndefined();
    expect(outcome.progress.currentLevel).toBeNull();
    expect(outcome.progress.completedAt.tactics).toBe(NOW);
    expect(outcome.progress.lastSavedAt).toBe(NOW);

    // 原对象不被就地修改。
    expect(progress.completedLevels).toEqual([]);
    expect(progress.levelStates.tactics).toBeDefined();
    expect(progress.unlockedMechanisms).toEqual([]);

    // 正常模式完成不写演示记录。
    expect(outcome.demo).toBe(demo);
    expect(outcome.demo.completedLevels).toEqual([]);
  });

  it('重复完成同一关：completed=false 且 progress 引用不变', () => {
    const first = applyLevelCompletion(getDefaultProgress(), createEmptyDemo(), 'tactics', COMPLETION, 'normal', NOW);
    const second = applyLevelCompletion(first.progress, first.demo, 'tactics', COMPLETION, 'normal', NOW);

    expect(second.completed).toBe(false);
    expect(second.unlockedMechanism).toBeNull();
    expect(second.progress).toBe(first.progress);
    expect(second.demo).toBe(first.demo);
  });

  it('完成提示文案包含关卡与解锁的图鉴卡名称', () => {
    const outcome = applyLevelCompletion(getDefaultProgress(), createEmptyDemo(), 'tactics', COMPLETION, 'normal', NOW);
    const message = completionMessage('tactics', outcome, 'normal');
    expect(message).toContain('战术板');
    expect(message).toContain('双形态战术');
    expect(message).toContain('经理图鉴');

    const repeated = applyLevelCompletion(outcome.progress, outcome.demo, 'tactics', COMPLETION, 'normal', NOW);
    expect(completionMessage('tactics', repeated, 'normal')).toContain('正式进度保持不变');
  });
});

describe('展示模式不写正式进度', () => {
  it('showcase 完成只更新 demo，progress 引用不变、unlockedMechanism=null', () => {
    const progress = getDefaultProgress();
    const demo = createEmptyDemo();

    const outcome = applyLevelCompletion(progress, demo, 'squad', COMPLETION, 'showcase', NOW);

    expect(outcome.completed).toBe(true);
    expect(outcome.progress).toBe(progress);
    expect(outcome.unlockedMechanism).toBeNull();
    expect(outcome.progress.unlockedMechanisms).toEqual([]);
    expect(outcome.progress.completedLevels).toEqual([]);
    expect(outcome.demo).not.toBe(demo);
    expect(outcome.demo.completedLevels).toEqual(['squad']);
    expect(outcome.demo.lastCompleted).toBe('squad');
    expect(outcome.demo.completedSteps).toEqual([]);
  });

  it('演示范畴的完成提示明确说明不写正式进度、不解锁图鉴', () => {
    const outcome = applyLevelCompletion(getDefaultProgress(), createEmptyDemo(), 'tactics', COMPLETION, 'showcase', NOW);
    const message = completionMessage('tactics', outcome, 'showcase');
    expect(message).toContain('演示完成');
    expect(message).toContain('不会写入正式进度');
    expect(message).toContain('不会解锁图鉴');
  });
});

describe('关卡顺序解锁', () => {
  it('按 tactics → scouting → transfers → squad 顺序逐关解锁', () => {
    expect(LEVELS.map((level) => level.id)).toEqual(['tactics', 'scouting', 'transfers', 'squad']);

    expect(isLevelUnlocked('tactics', [])).toBe(true);
    expect(isLevelUnlocked('scouting', [])).toBe(false);
    expect(isLevelUnlocked('transfers', [])).toBe(false);
    expect(isLevelUnlocked('squad', [])).toBe(false);

    expect(isLevelUnlocked('scouting', ['tactics'])).toBe(true);
    expect(isLevelUnlocked('transfers', ['tactics'])).toBe(false);

    expect(isLevelUnlocked('transfers', ['tactics', 'scouting'])).toBe(true);
    expect(isLevelUnlocked('squad', ['tactics', 'scouting'])).toBe(false);

    expect(isLevelUnlocked('squad', ['tactics', 'scouting', 'transfers'])).toBe(true);
    for (const level of LEVELS) {
      expect(isLevelUnlocked(level.id, ['tactics', 'scouting', 'transfers', 'squad'])).toBe(true);
    }
  });
});

describe('进度汇总', () => {
  it('summarizeProgress 统计已完成数、下一关与百分比', () => {
    expect(summarizeProgress([])).toEqual({ completedCount: 0, totalCount: 4, nextLevel: 'tactics', percent: 0 });
    expect(summarizeProgress(['tactics'])).toEqual({
      completedCount: 1,
      totalCount: 4,
      nextLevel: 'scouting',
      percent: 25,
    });
    expect(summarizeProgress(['tactics', 'scouting'])).toEqual({
      completedCount: 2,
      totalCount: 4,
      nextLevel: 'transfers',
      percent: 50,
    });
    const all = summarizeProgress(['tactics', 'scouting', 'transfers', 'squad']);
    expect(all.completedCount).toBe(4);
    expect(all.totalCount).toBe(4);
    expect(all.percent).toBe(100);
    expect(all.nextLevel).toBe('tactics');
  });
});

describe('演示进度', () => {
  it('markDemoStep 去重且不修改原对象', () => {
    const demo = createEmptyDemo();
    const once = markDemoStep(demo, 'intro');
    expect(once.completedSteps).toEqual(['intro']);
    expect(demo.completedSteps).toEqual([]);

    const again = markDemoStep(once, 'intro');
    expect(again).toBe(once);

    const twice = markDemoStep(again, 'codex');
    expect(twice.completedSteps).toEqual(['intro', 'codex']);
    expect(twice).not.toBe(again);
  });

  it('applyDemoCompletion 不重复添加同一关，并记录 lastCompleted', () => {
    const demo = createEmptyDemo();
    const once = applyDemoCompletion(demo, 'tactics');
    expect(once.completedLevels).toEqual(['tactics']);
    expect(once.lastCompleted).toBe('tactics');
    expect(demo.completedLevels).toEqual([]);

    const repeated = applyDemoCompletion(once, 'tactics');
    expect(repeated.completedLevels).toEqual(['tactics']);
    expect(repeated.completedLevels).toHaveLength(1);
    expect(repeated.lastCompleted).toBe('tactics');

    const next = applyDemoCompletion(repeated, 'scouting');
    expect(next.completedLevels).toEqual(['tactics', 'scouting']);
    expect(next.lastCompleted).toBe('scouting');
  });
});
