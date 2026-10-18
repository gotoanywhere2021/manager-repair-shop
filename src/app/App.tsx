import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppContext } from './AppContext';
import type { AppContextValue, DemoState, Route, StartLevelOptions } from './AppContext';
import { AppShell } from './AppShell';
import { isLevelId } from '../game/levels';
import {
  applyLevelCompletion,
  completionMessage,
  createEmptyDemo,
  markDemoStep as markStep,
} from '../game/progressOps';
import type { GameMode, LevelCompletion, LevelId, ShowcaseOptions } from '../game/engine/types';
import {
  clearStoredData,
  getDefaultProgress,
  isStorageAvailable,
  loadProgress,
  loadSettings,
  saveProgress,
  saveSettings,
} from '../storage/persistence';
import type { Progress, Settings } from '../storage/persistence';

const DEFAULT_SHOWCASE_OPTIONS: ShowcaseOptions = {
  seed: 20251018,
  fastPlay: true,
  startPhase: 'faultPlay',
};

function routeToHash(route: Route, mode: GameMode): string {
  switch (route.kind) {
    case 'home':
      return '#/';
    case 'level':
      return mode === 'showcase' ? `#/showcase/level/${route.levelId}` : `#/level/${route.levelId}`;
    case 'codex':
      return mode === 'showcase' ? '#/showcase/codex' : '#/codex';
    case 'showcase':
      return '#/showcase';
    case 'settings':
      return '#/settings';
    case 'references':
      return '#/references';
    case 'knowledge':
      return route.topicId ? `#/knowledge/${route.topicId}` : '#/knowledge';
  }
}

function parseHash(hash: string): { route: Route; mode: GameMode } {
  const clean = hash.replace(/^#/, '');
  const segments = clean.split('/').filter(Boolean);
  if (segments[0] === 'showcase') {
    if (segments[1] === 'level' && isLevelId(segments[2])) {
      return { route: { kind: 'level', levelId: segments[2] }, mode: 'showcase' };
    }
    if (segments[1] === 'codex') return { route: { kind: 'codex' }, mode: 'showcase' };
    return { route: { kind: 'showcase' }, mode: 'showcase' };
  }
  if (segments[0] === 'level' && isLevelId(segments[1])) {
    return { route: { kind: 'level', levelId: segments[1] }, mode: 'normal' };
  }
  if (segments[0] === 'codex') return { route: { kind: 'codex' }, mode: 'normal' };
  if (segments[0] === 'settings') return { route: { kind: 'settings' }, mode: 'normal' };
  if (segments[0] === 'references') return { route: { kind: 'references' }, mode: 'normal' };
  if (segments[0] === 'knowledge') {
    return {
      route: { kind: 'knowledge', topicId: segments[1] ? decodeURIComponent(segments[1]) : undefined },
      mode: 'normal',
    };
  }
  return { route: { kind: 'home' }, mode: 'normal' };
}

function initialRoute(): { route: Route; mode: GameMode } {
  if (typeof window === 'undefined') return { route: { kind: 'home' }, mode: 'normal' };
  return parseHash(window.location.hash);
}

export function App(): ReactNode {
  const initial = useMemo(initialRoute, []);
  const loadedProgress = useMemo(() => loadProgress(), []);
  const loadedSettings = useMemo(() => loadSettings(), []);
  const storageAvailable = useMemo(() => isStorageAvailable(), []);

  const [route, setRoute] = useState<Route>(initial.route);
  const [mode, setMode] = useState<GameMode>(initial.mode);
  const [fastStart, setFastStart] = useState(false);
  const [showcaseOptions, setShowcaseOptions] = useState<ShowcaseOptions | null>(
    initial.mode === 'showcase' ? DEFAULT_SHOWCASE_OPTIONS : null,
  );
  const [progress, setProgress] = useState<Progress>(loadedProgress.progress);
  const [settings, setSettings] = useState<Settings>(loadedSettings.settings);
  const [demo, setDemo] = useState<DemoState>(createEmptyDemo);
  const [storageWarning, setStorageWarning] = useState<string | null>(
    loadedProgress.warning ?? loadedSettings.warning ?? (storageAvailable ? null : '浏览器没有提供本地存储，进度只能保留在当前页面。'),
  );
  const [toast, setToast] = useState<string | null>(null);
  const [runKey, setRunKey] = useState(0);
  const savedOnce = useRef(false);

  // 进度变化后写入 localStorage；展示模式完全不触碰正式进度。
  useEffect(() => {
    if (!savedOnce.current) {
      savedOnce.current = true;
      return;
    }
    saveProgress(progress);
  }, [progress]);

  useEffect(() => {
    saveSettings(settings);
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.reduceMotion = settings.reduceMotion ? 'true' : 'false';
    }
  }, [settings]);

  // 浏览器前进/后退时同步路由。
  useEffect(() => {
    function onHashChange() {
      const next = parseHash(window.location.hash);
      setRoute(next.route);
      setMode(next.mode);
      if (next.mode === 'normal') setShowcaseOptions(null);
      else setShowcaseOptions((current) => current ?? DEFAULT_SHOWCASE_OPTIONS);
      setFastStart(false);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function navigate(nextRoute: Route, nextMode: GameMode = mode) {
    setMode(nextMode);
    setRoute(nextRoute);
    const hash = routeToHash(nextRoute, nextMode);
    if (typeof window !== 'undefined' && window.location.hash !== hash) {
      window.location.hash = hash;
    }
  }

  function startLevel(levelId: LevelId, options: StartLevelOptions = {}) {
    const showcase = options.showcase === true;
    setMode(showcase ? 'showcase' : 'normal');
    setFastStart(options.fastStart === true);
    setShowcaseOptions(options.showcaseOptions ?? (showcase ? DEFAULT_SHOWCASE_OPTIONS : null));
    setRunKey((key) => key + 1);
    if (!showcase) {
      setProgress((current) => ({
        ...current,
        currentLevel: levelId,
        lastSavedAt: new Date().toISOString(),
      }));
    }
    navigate({ kind: 'level', levelId }, showcase ? 'showcase' : 'normal');
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: settings.reduceMotion ? 'auto' : 'smooth' });
    }
  }

  function exitLevel() {
    if (mode === 'showcase') {
      navigate({ kind: 'showcase' }, 'showcase');
    } else {
      setProgress((current) => {
        if (current.currentLevel === null) return current;
        return { ...current, lastSavedAt: new Date().toISOString() };
      });
      navigate({ kind: 'home' }, 'normal');
    }
  }

  function replayLevel(levelId: LevelId) {
    if (mode === 'normal') {
      setProgress((current) => {
        const levelStates = { ...current.levelStates };
        delete levelStates[levelId];
        return { ...current, levelStates, lastSavedAt: new Date().toISOString() };
      });
    }
    setRunKey((key) => key + 1);
    setToast('本关已重新开始，规则状态已重置。');
  }

  function saveLevelState(levelId: LevelId, state: unknown) {
    if (mode === 'showcase') return;
    setProgress((current) => ({
      ...current,
      levelStates: { ...current.levelStates, [levelId]: state },
      lastSavedAt: new Date().toISOString(),
    }));
  }

  function completeLevel(levelId: LevelId, result: LevelCompletion) {
    const outcome = applyLevelCompletion(progress, demo, levelId, result, mode);
    setProgress(outcome.progress);
    setDemo(outcome.demo);
    setToast(completionMessage(levelId, outcome, mode));
  }

  function setReduceMotion(reduce: boolean) {
    setSettings((current) => ({ ...current, reduceMotion: reduce }));
  }

  function resetProgress() {
    clearStoredData();
    setProgress(getDefaultProgress());
    setDemo(createEmptyDemo());
    setSettings({ reduceMotion: settings.reduceMotion });
    setToast('正式进度、图鉴解锁与关卡存档已重置。');
    navigate({ kind: 'home' }, 'normal');
  }

  const contextValue: AppContextValue = {
    route,
    mode,
    fastStart,
    showcaseOptions,
    progress,
    settings,
    demo,
    storageWarning,
    toast,
    navigate,
    startLevel,
    exitLevel,
    replayLevel,
    saveLevelState,
    completeLevel,
    setReduceMotion,
    resetProgress,
    dismissWarning: () => setStorageWarning(null),
    dismissToast: () => setToast(null),
    markDemoStep: (stepId: string) => setDemo((current) => markStep(current, stepId)),
    resetDemo: () => setDemo(createEmptyDemo()),
  };

  return (
    <AppContext.Provider value={contextValue}>
      <AppShell
        key={`${route.kind === 'level' ? route.levelId : route.kind}-${mode}-${runKey}`}
      />
    </AppContext.Provider>
  );
}
