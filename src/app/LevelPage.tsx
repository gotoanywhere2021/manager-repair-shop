import { useApp } from './AppContext';
import { getLevel, isLevelUnlocked } from '../game/levels';
import type { LevelId } from '../game/engine/types';
import { LEVEL_COMPONENTS } from './levelRegistry';
import { Button, Chip, EmptyState } from '../components/Ui';

export function LevelPage({ levelId }: { levelId: LevelId }) {
  const {
    mode,
    fastStart,
    showcaseOptions,
    progress,
    saveLevelState,
    completeLevel,
    exitLevel,
    replayLevel,
    navigate,
  } = useApp();
  const level = getLevel(levelId);
  const LevelComponent = LEVEL_COMPONENTS[levelId];
  const savedState = mode === 'normal' ? progress.levelStates[levelId] : undefined;
  const locked = mode === 'normal' && !isLevelUnlocked(levelId, progress.completedLevels);

  if (locked) {
    return (
      <div className={`level-page theme-${level.theme}`}>
        <header className="level-topbar">
          <button type="button" className="back-link" onClick={exitLevel}>
            <span aria-hidden="true">←</span>返回修理铺
          </button>
          <div className="level-title-wrap">
            <p className="level-order">委托 NO.{String(level.order).padStart(2, '0')}</p>
            <h1 className="level-title">{level.title}</h1>
          </div>
        </header>
        <EmptyState title="这份委托还没有解锁">
          <p>正常模式按顺序解锁委托。先完成上一关，再回到委托板接单。</p>
          <div className="locked-actions">
            <Button onClick={() => navigate({ kind: 'home' })}>返回委托板</Button>
          </div>
        </EmptyState>
      </div>
    );
  }

  return (
    <div className={`level-page theme-${level.theme}`}>
      <header className="level-topbar">
        <button type="button" className="back-link" onClick={exitLevel}>
          <span aria-hidden="true">←</span>
          {mode === 'showcase' ? '返回演示' : '返回修理铺'}
        </button>
        <div className="level-title-wrap">
          <p className="level-order">委托 NO.{String(level.order).padStart(2, '0')} · {level.englishTitle}</p>
          <h1 className="level-title">{level.title}</h1>
        </div>
        <div className="level-topbar-actions">
          {mode === 'showcase' && <Chip tone="amber">演示模式 · 固定种子</Chip>}
          <Button variant="ghost" size="sm" onClick={() => replayLevel(levelId)}>
            重玩本关
          </Button>
        </div>
      </header>
      {mode === 'showcase' && (
        <p className="demo-notice">
          展示模式使用固定种子与短局参数，方便重复演示；本页操作不会写入正式进度，也不会解锁图鉴。
        </p>
      )}
      <LevelComponent
        level={level}
        mode={mode}
        fastStart={fastStart}
        showcaseOptions={showcaseOptions}
        club={mode === 'normal' ? progress.club : undefined}
        savedState={savedState}
        onSaveState={(state) => saveLevelState(levelId, state)}
        onComplete={(result) => completeLevel(levelId, result)}
        onExit={exitLevel}
      />
    </div>
  );
}
