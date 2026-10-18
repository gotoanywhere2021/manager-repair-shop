import { describe, it, expect } from 'vitest';
import { CODEX_CARDS, CODEX_LOCKED_HINT, getCodexCard } from '../src/content/codex';
import {
  SHOWCASE_SEED,
  SHOWCASE_STEPS,
  SHOWCASE_TOTAL_STEPS,
  isShowcaseStepDone,
  showcaseOptionsFor,
} from '../src/content/showcaseSteps';
import { createEmptyDemo } from '../src/game/progressOps';
import { LEVELS, LEVEL_ORDER, MECHANISM_NAMES, getLevel, isMechanismId } from '../src/game/levels';

const MECHANISM_IDS = Object.keys(MECHANISM_NAMES);
const OLD_THEME_WORDS = ['矿洞', '工坊', '摊位', '遗迹', '桌游'];
const COMMERCIAL_GAME_NAMES = ['Football Manager', 'Sports Interactive', 'Sega', 'SEGA'];

function cardText(mechanismId: (typeof CODEX_CARDS)[number]['mechanismId']): string {
  const card = CODEX_CARDS.find((item) => item.mechanismId === mechanismId);
  if (!card) return '';
  return [
    card.zhName,
    card.enName,
    card.definition,
    card.levelExperience,
    card.decisionStructure,
    card.whenToUse,
    card.misuse,
    card.sideEffect,
    ...card.synergies,
  ].join('\n');
}

describe('经理图鉴卡片', () => {
  it('四张卡齐全，mechanismId 覆盖全部四个系统', () => {
    expect(CODEX_CARDS).toHaveLength(4);
    const ids = CODEX_CARDS.map((card) => card.mechanismId);
    expect(new Set(ids).size).toBe(4);
    expect([...ids].sort()).toEqual([...MECHANISM_IDS].sort());
    for (const id of ids) expect(isMechanismId(id)).toBe(true);
  });

  it('zhName / enName 与 levels.ts 的 MECHANISM_NAMES 完全一致', () => {
    for (const card of CODEX_CARDS) {
      const names = MECHANISM_NAMES[card.mechanismId];
      expect(card.zhName).toBe(names.zh);
      expect(card.enName).toBe(names.en);
    }
  });

  it('每张卡的 levelId 与 LEVELS 一一对应且互不重复', () => {
    const cardLevelIds = CODEX_CARDS.map((card) => card.levelId);
    expect(new Set(cardLevelIds).size).toBe(CODEX_CARDS.length);
    expect([...cardLevelIds].sort()).toEqual([...LEVEL_ORDER].sort());
    expect(CODEX_CARDS.length).toBe(LEVELS.length);

    for (const card of CODEX_CARDS) {
      // levelId 必须指向一个真实存在的关卡，且该关卡的机制就是这张卡。
      const level = getLevel(card.levelId);
      expect(level.mechanismId).toBe(card.mechanismId);
    }
  });

  it('每张卡的教学字段完整且非空', () => {
    for (const card of CODEX_CARDS) {
      for (const field of ['definition', 'levelExperience', 'decisionStructure', 'whenToUse', 'misuse', 'sideEffect'] as const) {
        expect(typeof card[field]).toBe('string');
        expect(card[field].trim().length).toBeGreaterThan(0);
      }
      expect(card.synergies.length).toBeGreaterThanOrEqual(3);
      for (const synergy of card.synergies) {
        expect(typeof synergy).toBe('string');
        expect(synergy.trim().length).toBeGreaterThan(0);
      }
      expect(card.zhName.trim().length).toBeGreaterThan(0);
      expect(card.enName.trim().length).toBeGreaterThan(0);
    }
  });

  it('卡片中文名不重复，且没有旧题材残留', () => {
    const zhNames = CODEX_CARDS.map((card) => card.zhName);
    expect(new Set(zhNames).size).toBe(CODEX_CARDS.length);

    for (const card of CODEX_CARDS) {
      const text = cardText(card.mechanismId);
      for (const word of OLD_THEME_WORDS) {
        expect(text.includes(word), `卡片「${card.zhName}」仍包含旧题材词「${word}」`).toBe(false);
      }
    }
  });

  it('不借用任何商业游戏的名称，也不宣称关联授权', () => {
    const allText = CODEX_CARDS.map((card) => cardText(card.mechanismId)).join('\n');
    for (const name of COMMERCIAL_GAME_NAMES) {
      expect(allText.toLowerCase().includes(name.toLowerCase()), `图鉴卡片不应出现商业游戏名称「${name}」`).toBe(false);
    }
  });

  it('getCodexCard 能按机制 id 取回对应卡片', () => {
    for (const id of MECHANISM_IDS) {
      const card = getCodexCard(id as keyof typeof MECHANISM_NAMES);
      expect(card).toBeDefined();
      expect(card?.mechanismId).toBe(id);
    }
    expect(CODEX_LOCKED_HINT.trim().length).toBeGreaterThan(0);
  });
});

describe('展示模式 8 步流程数据', () => {
  it('共 8 步、序号连续、id 不重复', () => {
    expect(SHOWCASE_STEPS).toHaveLength(8);
    expect(SHOWCASE_TOTAL_STEPS).toBe(SHOWCASE_STEPS.length);
    expect(SHOWCASE_STEPS.map((step) => step.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(SHOWCASE_STEPS.map((step) => step.id)).size).toBe(SHOWCASE_STEPS.length);
    expect(SHOWCASE_STEPS[0].kind).toBe('intro');
    expect(SHOWCASE_STEPS[SHOWCASE_STEPS.length - 1].kind).toBe('codex');
  });

  it('固定种子为 20251018，展示参数使用 fastPlay 并沿用步骤阶段', () => {
    expect(SHOWCASE_SEED).toBe(20251018);
    for (const step of SHOWCASE_STEPS) {
      for (const target of step.targets) {
        const options = showcaseOptionsFor(target);
        expect(options.seed).toBe(SHOWCASE_SEED);
        expect(options.fastPlay).toBe(true);
        expect(options.startPhase).toBe(target.startPhase);
      }
    }
  });

  it('跳转参数匹配新关卡与阶段', () => {
    const targets = SHOWCASE_STEPS.flatMap((step) => step.targets);
    const tacticsPhases = targets
      .filter((target) => target.levelId === 'tactics')
      .map((target) => target.startPhase);
    expect(tacticsPhases).toContain('faultPlay');
    expect(tacticsPhases).toContain('repair');
    expect(tacticsPhases).toContain('verify');

    for (const levelId of ['scouting', 'transfers', 'squad'] as const) {
      const levelTargets = targets.filter((target) => target.levelId === levelId);
      expect(levelTargets.length).toBeGreaterThan(0);
      for (const target of levelTargets) expect(target.startPhase).toBe('verify');
    }

    // 第 8 步打开图鉴，不需要关卡跳转参数。
    const codexStep = SHOWCASE_STEPS[SHOWCASE_STEPS.length - 1];
    expect(codexStep.targets).toEqual([]);
    expect(codexStep.title).toContain('经理图鉴');
  });

  it('演示文案没有旧题材残留', () => {
    for (const step of SHOWCASE_STEPS) {
      const text = [step.title, step.description, step.cue, ...step.targets.map((target) => target.actionLabel)].join(
        '\n',
      );
      for (const word of [...OLD_THEME_WORDS, '机制图鉴']) {
        expect(text.includes(word), `展示步骤「${step.title}」仍包含旧题材词「${word}」`).toBe(false);
      }
    }
  });

  it('步骤完成判断兼容手动标记与 demo.lastCompleted 自动记录', () => {
    const empty = createEmptyDemo();
    const firstLevelStep = SHOWCASE_STEPS.find((step) => (step.autoLevels?.length ?? 0) > 0);
    expect(firstLevelStep).toBeDefined();

    // 未操作时没有任何步骤完成。
    expect(SHOWCASE_STEPS.filter((step) => isShowcaseStepDone(step, empty))).toHaveLength(0);

    // 手动标记的步骤算完成。
    const markedStep = SHOWCASE_STEPS[0];
    expect(isShowcaseStepDone(markedStep, { ...empty, completedSteps: [markedStep.id] })).toBe(true);

    // 关卡返回演示完成记录后，带 autoLevels 的步骤自动算完成。
    const autoLevel = firstLevelStep?.autoLevels?.[0];
    expect(autoLevel).toBeDefined();
    const demo = {
      ...empty,
      completedLevels: autoLevel ? [autoLevel] : [],
      lastCompleted: autoLevel ?? null,
    };
    expect(isShowcaseStepDone(firstLevelStep!, demo)).toBe(true);
  });
});
