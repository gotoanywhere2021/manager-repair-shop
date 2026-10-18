import { useApp } from './AppContext';
import { Button, Chip } from '../components/Ui';
import { CODEX_CARDS, CODEX_LOCKED_HINT } from '../content/codex';
import type { CodexCard } from '../content/codex';
import { getLevel, isLevelUnlocked } from '../game/levels';
import type { LevelDefinition } from '../game/engine/types';
import '../content/codex.css';

/**
 * 经理图鉴：正常模式按已解锁系统显示全文，未解锁卡只保留轮廓与学习入口；
 * 展示模式（mode === 'showcase'）不写正式进度，因此四张卡全部开放并明确标注。
 */
export function CodexScreen() {
  const { mode, progress, startLevel, navigate } = useApp();
  const isShowcase = mode === 'showcase';
  const unlockedCount = isShowcase ? CODEX_CARDS.length : progress.unlockedMechanisms.length;

  function handleGoToLevel(card: CodexCard) {
    if (isLevelUnlocked(card.levelId, progress.completedLevels)) {
      startLevel(card.levelId);
      return;
    }
    // 对应关卡还没解锁：先回委托板，让玩家从当前进度继续。
    navigate({ kind: 'home' });
  }

  function handleBackHome() {
    navigate({ kind: 'home' }, 'normal');
  }

  return (
    <div className="page codex-page">
      <button type="button" className="back-link" onClick={handleBackHome}>
        <span aria-hidden="true">←</span> 返回修理铺
      </button>

      <header className="page-header">
        <p className="eyebrow">{isShowcase ? '展示模式 · 图鉴总览' : '维修档案 · 系统卡'}</p>
        <h1 className="page-title">经理图鉴</h1>
        <p className="page-lead">
          每张卡记录一个系统怎么改变决策：一句话定义、你刚才亲手体验过的那一次、决策结构，以及适用情况、常见误用与可能的副作用。
        </p>
        <div className="codex-meta-row">
          <Chip tone={unlockedCount > 0 ? 'green' : 'neutral'} icon="🗂">
            {isShowcase ? `演示开放 ${unlockedCount} / ${CODEX_CARDS.length}` : `已解锁 ${unlockedCount} / ${CODEX_CARDS.length}`}
          </Chip>
          {isShowcase && <Chip tone="amber">演示模式：全部图鉴已开放</Chip>}
          {isShowcase && (
            <Button variant="secondary" size="sm" onClick={() => navigate({ kind: 'showcase' }, 'showcase')}>
              返回演示流程
            </Button>
          )}
        </div>
      </header>

      {isShowcase && (
        <div className="codex-showcase-note" role="note">
          <strong>演示模式：全部图鉴已开放</strong>
          <span>这些卡片在演示里可以直接翻阅，方便对照刚才的操作；演示不会解锁正式图鉴，也不会写入正式进度。</span>
        </div>
      )}

      <div className="codex-grid">
        {CODEX_CARDS.map((card, index) => {
          const level = getLevel(card.levelId);
          const unlocked = isShowcase || progress.unlockedMechanisms.includes(card.mechanismId);
          return (
            <CodexCardView
              key={card.mechanismId}
              card={card}
              index={index + 1}
              level={level}
              unlocked={unlocked}
              showcase={isShowcase}
              onGoToLevel={() => handleGoToLevel(card)}
            />
          );
        })}
      </div>

      <footer className="codex-footnote">
        <p>
          卡片与案例为原创，题材参考足球经理类游戏的公开介绍；非官方作品，不代表任何商业游戏规则，也不代表任何真实俱乐部、球员或教练。
        </p>
        {!isShowcase && (
          <button type="button" className="link-button" onClick={() => navigate({ kind: 'references' }, 'normal')}>
            查看设计参考
          </button>
        )}
        <Button variant="secondary" onClick={handleBackHome}>
          返回修理铺
        </Button>
      </footer>
    </div>
  );
}

function CodexCardView({
  card,
  index,
  level,
  unlocked,
  showcase,
  onGoToLevel,
}: {
  card: CodexCard;
  index: number;
  level: LevelDefinition;
  unlocked: boolean;
  showcase: boolean;
  onGoToLevel: () => void;
}) {
  if (!unlocked) {
    return (
      <article className="codex-card codex-card-locked" aria-label={`未解锁的系统卡：${card.zhName}`}>
        <header className="codex-card-top">
          <span className="codex-card-no">图鉴卡 NO.{String(index).padStart(2, '0')}</span>
          <Chip tone="neutral" icon="🔒">
            未解锁
          </Chip>
        </header>
        <div className="codex-silhouette" aria-hidden="true">
          <span>?</span>
        </div>
        <h2 className="codex-card-title">{card.zhName}</h2>
        <p className="codex-card-en">{card.enName}</p>
        <p className="codex-locked-hint">
          {CODEX_LOCKED_HINT}具体内容会在你完成「{level.title}」委托后出现，这里先不剧透。
        </p>
        <Button variant="secondary" fullWidth onClick={onGoToLevel}>
          去完成委托
        </Button>
      </article>
    );
  }

  return (
    <article className={`codex-card codex-card-open${showcase ? ' is-showcase' : ''}`} aria-label={`已解锁的系统卡：${card.zhName}`}>
      <header className="codex-card-top">
        <span className="codex-card-no">图鉴卡 NO.{String(index).padStart(2, '0')}</span>
        <Chip tone={showcase ? 'amber' : 'green'} icon={showcase ? '🎬' : '✓'}>
          {showcase ? '演示开放' : '已解锁'}
        </Chip>
      </header>
      <div className="codex-card-heading">
        <h2 className="codex-card-title">{card.zhName}</h2>
        <span className="codex-card-en">{card.enName}</span>
      </div>
      <p className="codex-card-definition">{card.definition}</p>

      <div className="codex-fields">
        <CodexField label="本关体验">{card.levelExperience}</CodexField>
        <CodexField label="决策结构">{card.decisionStructure}</CodexField>
        <CodexField label="适用情况">{card.whenToUse}</CodexField>
        <CodexField label="常见误用" tone="amber">
          {card.misuse}
        </CodexField>
        <CodexField label="可能的副作用" tone="red">
          {card.sideEffect}
        </CodexField>
      </div>

      <div className="codex-synergies">
        <span className="codex-field-label">可联动系统</span>
        <ul className="codex-synergy-list">
          {card.synergies.map((synergy) => (
            <li className="codex-synergy" key={synergy}>
              {synergy}
            </li>
          ))}
        </ul>
      </div>

      <footer className="codex-card-foot">
        <span>
          对应委托：{level.title} · {level.englishTitle}
        </span>
        <span className="codex-card-foot-tag">规则变化 → 决策变化</span>
      </footer>
    </article>
  );
}

function CodexField({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: 'amber' | 'red';
  children: string;
}) {
  return (
    <div className={`codex-field${tone ? ` codex-field-${tone}` : ''}`}>
      <span className="codex-field-label">{label}</span>
      <p className="codex-field-body">{children}</p>
    </div>
  );
}
