import { MECHANISM_NAMES, getLevel } from './levels';
import type { GameMode, LevelCompletion, LevelId, MechanismId } from './engine/types';
import type { Progress } from '../storage/persistence';

/** 展示模式的内存进度：不写入正式存档。 */
export interface DemoProgress {
  completedSteps: string[];
  completedLevels: LevelId[];
  lastCompleted: LevelId | null;
}

export function createEmptyDemo(): DemoProgress {
  return { completedSteps: [], completedLevels: [], lastCompleted: null };
}

export function markDemoStep(demo: DemoProgress, stepId: string): DemoProgress {
  if (demo.completedSteps.includes(stepId)) return demo;
  return { ...demo, completedSteps: [...demo.completedSteps, stepId] };
}

export function applyDemoCompletion(demo: DemoProgress, levelId: LevelId): DemoProgress {
  return {
    ...demo,
    completedLevels: demo.completedLevels.includes(levelId)
      ? demo.completedLevels
      : [...demo.completedLevels, levelId],
    lastCompleted: levelId,
  };
}

export interface CompletionOutcome {
  /** 本次是否写入了一条新的完成记录。 */
  completed: boolean;
  /** 正常模式解锁的机制；展示模式或重复完成时为 null。 */
  unlockedMechanism: MechanismId | null;
  progress: Progress;
  demo: DemoProgress;
}

/**
 * 应用一次关卡完成。
 * 展示模式只更新内存中的演示进度，正式进度对象原样返回（引用不变，便于测试断言）。
 */
export function applyLevelCompletion(
  progress: Progress,
  demo: DemoProgress,
  levelId: LevelId,
  result: LevelCompletion,
  mode: GameMode,
  nowIso: string = new Date().toISOString(),
): CompletionOutcome {
  if (mode === 'showcase') {
    return {
      completed: true,
      unlockedMechanism: null,
      progress,
      demo: applyDemoCompletion(demo, levelId),
    };
  }

  if (progress.completedLevels.includes(levelId)) {
    return { completed: false, unlockedMechanism: null, progress, demo };
  }

  const mechanism = getLevel(levelId).mechanismId;
  const levelStates = { ...progress.levelStates };
  delete levelStates[levelId];
  const club = result.clubUpdate
    ? {
        ...progress.club,
        timeline: [
          ...progress.club.timeline,
          {
            levelId,
            headline: result.clubUpdate.headline,
            details: result.clubUpdate.details,
            at: nowIso,
          },
        ].slice(-8),
      }
    : progress.club;
  const nextProgress: Progress = {
    ...progress,
    completedLevels: [...progress.completedLevels, levelId],
    unlockedMechanisms: progress.unlockedMechanisms.includes(mechanism)
      ? progress.unlockedMechanisms
      : [...progress.unlockedMechanisms, mechanism],
    levelStates,
    currentLevel: null,
    completedAt: { ...progress.completedAt, [levelId]: nowIso },
    lastSavedAt: nowIso,
    club,
  };
  return { completed: true, unlockedMechanism: mechanism, progress: nextProgress, demo };
}

/** 生成完成提示文案，展示模式会说明不写入正式进度。 */
export function completionMessage(levelId: LevelId, outcome: CompletionOutcome, mode: GameMode): string {
  const level = getLevel(levelId);
  if (mode === 'showcase') {
    return `演示完成：${level.title}。演示记录不会写入正式进度，也不会解锁图鉴。`;
  }
  if (!outcome.completed) {
    return `已重新完成「${level.title}」。正式进度保持不变。`;
  }
  const mechanismName = outcome.unlockedMechanism ? MECHANISM_NAMES[outcome.unlockedMechanism].zh : '';
  return `委托完成：${level.title}。图鉴卡「${mechanismName}」已解锁，可在经理图鉴中查看。`;
}
