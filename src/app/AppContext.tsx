import { createContext, useContext } from 'react';
import type { GameMode, LevelCompletion, LevelId, ShowcaseOptions } from '../game/engine/types';
import type { DemoProgress } from '../game/progressOps';
import type { Progress, Settings } from '../storage/persistence';

export type Route =
  | { kind: 'home' }
  | { kind: 'level'; levelId: LevelId }
  | { kind: 'codex' }
  | { kind: 'showcase' }
  | { kind: 'settings' }
  | { kind: 'references' }
  | { kind: 'knowledge'; topicId?: string };

export type DemoState = DemoProgress;

export interface StartLevelOptions {
  showcase?: boolean;
  fastStart?: boolean;
  showcaseOptions?: ShowcaseOptions;
}

export interface AppContextValue {
  route: Route;
  mode: GameMode;
  fastStart: boolean;
  showcaseOptions: ShowcaseOptions | null;
  progress: Progress;
  settings: Settings;
  demo: DemoState;
  storageWarning: string | null;
  toast: string | null;
  navigate: (route: Route, nextMode?: GameMode) => void;
  startLevel: (levelId: LevelId, options?: StartLevelOptions) => void;
  exitLevel: () => void;
  replayLevel: (levelId: LevelId) => void;
  saveLevelState: (levelId: LevelId, state: unknown) => void;
  completeLevel: (levelId: LevelId, result: LevelCompletion) => void;
  setReduceMotion: (reduce: boolean) => void;
  resetProgress: () => void;
  dismissWarning: () => void;
  dismissToast: () => void;
  markDemoStep: (stepId: string) => void;
  resetDemo: () => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp 必须在 AppProvider 内使用');
  return value;
}
