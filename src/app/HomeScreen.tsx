import { useApp } from './AppContext';
import {
  LEVELS,
  MECHANISM_NAMES,
  getLevel,
  isLevelUnlocked,
  levelCardStatus,
  summarizeProgress,
} from '../game/levels';
import type { LevelDefinition } from '../game/engine/types';
import type { LevelProgressSummary } from '../game/levels';
import { Button, Chip, Meter, Panel } from '../components/Ui';

const STATUS_LABEL = {
  'not-started': '未开始',
  'in-progress': '进行中',
  completed: '已完成',
} as const;

const STATUS_TONE = {
  'not-started': 'neutral',
  'in-progress': 'amber',
  completed: 'green',
} as const;

export function HomeScreen() {
  const { progress, demo, startLevel, navigate } = useApp();
  const summary = summarizeProgress(progress.completedLevels);
  const unlockedCount = progress.unlockedMechanisms.length;
  const cta =
    summary.completedCount === 0
      ? '开始维修'
      : summary.completedCount >= LEVELS.length
        ? '再修一遍'
        : '继续维修';

  return (
    <div className="home">
      <section className="home-hero">
        <div className="hero-copy">
          <p className="eyebrow">俱乐部系统维修台 · 足球经理教学实验</p>
          <h1 className="hero-title">
            足球经理<span className="hero-title-accent">修理铺</span>
          </h1>
          <p className="hero-tagline">修好四个坏系统，看懂每个选择。</p>
          <p className="hero-desc">
            先试玩坏掉的战术、球探、转会与注册，再亲手装上能跑起来的规则。
            用比赛记录、球探报告和注册名单，看清每个选择从哪里来、又要付出什么。
          </p>
          <div className="hero-actions">
            <Button size="lg" onClick={() => startLevel(summary.nextLevel)}>
              {cta}
            </Button>
            <Button size="lg" variant="secondary" onClick={() => startLevel('tactics', { fastStart: true })}>
              30 秒体验战术板
            </Button>
          </div>
          <div className="hero-meta">
            <Chip tone="purple" icon="🧰">
              已完成 {summary.completedCount} / {LEVELS.length}
            </Chip>
            <Chip tone="green" icon="🗂">
              图鉴 {unlockedCount} / 4
            </Chip>
            <button type="button" className="link-button" onClick={() => navigate({ kind: 'knowledge' })}>
              机制原理
            </button>
            <button type="button" className="link-button" onClick={() => navigate({ kind: 'settings' })}>
              设置与存档
            </button>
          </div>
          <p className="hero-disclaimer">
            非官方作品：灵感来自足球经理类游戏，不使用真实俱乐部、球员或教练名称，数值为原创简化原型。
          </p>
        </div>
        <div className="hero-visual hero-pitch" aria-hidden="true">
          <div className="bench-card bench-commission">
            <span className="bench-tag">战术板</span>
            <strong>有球 4-3-3</strong>
            <p>套边 + 内收，控球时拉开宽度。</p>
          </div>
          <div className="bench-card bench-module">
            <span className="bench-tag">球探报告</span>
            <strong>知识度 42%</strong>
            <p>“左脚，擅长内切，速度区间 78–85。”</p>
          </div>
          <div className="bench-card bench-mechanism">
            <span className="bench-tag">转会报价</span>
            <strong>€18M + 周薪 €65k</strong>
            <p>预算与工资空间同时占用。</p>
          </div>
          <span className="bench-arrow">规则变化 → 决策变化</span>
        </div>
      </section>

      <section className="how-strip" aria-label="维修流程">
        {[
          ['01', '接单', '读一个具体的糟糕体验。'],
          ['02', '试玩故障', '亲自感受系统坏在哪。'],
          ['03', '安装规则', '战术 / 球探 / 转会 / 注册。'],
          ['04', '验证迁移', '用真实记录看懂选择的变化。'],
        ].map(([step, title, desc]) => (
          <div className="how-step" key={step}>
            <span className="how-index">{step}</span>
            <div>
              <p className="how-title">{title}</p>
              <p className="how-desc">{desc}</p>
            </div>
          </div>
        ))}
      </section>

      <ClubOffice summary={summary} />

      <section className="home-section">
        <header className="section-head">
          <div>
            <h2 className="section-title">委托板</h2>
            <p className="section-subtitle">四个俱乐部系统，四种被改坏的决策。正常模式按顺序解锁。</p>
          </div>
          <Meter
            label="维修进度"
            value={summary.completedCount}
            max={LEVELS.length}
            tone="green"
            valueLabel={`${summary.percent}%`}
          />
        </header>
        <div className="commission-grid">
          {LEVELS.map((level) => (
            <CommissionCard
              key={level.id}
              level={level}
              status={levelCardStatus(level.id, progress)}
              unlocked={isLevelUnlocked(level.id, progress.completedLevels)}
              onStart={() => startLevel(level.id)}
            />
          ))}
        </div>
      </section>

      <section className="home-tools">
        <Panel
          title="经理图鉴"
          subtitle={`已解锁 ${unlockedCount} / 4 张卡。完成对应委托后自动记录。`}
          tone="green"
          actions={
            <Button variant="secondary" onClick={() => navigate({ kind: 'codex' })}>
              打开图鉴
            </Button>
          }
        >
          <p className="tool-copy">
            每张卡包含：一句话定义、本关体验、决策结构、适用情况、常见误用、副作用与联动建议。
          </p>
          <div className="codex-mini-row" aria-hidden="true">
            {Object.values(MECHANISM_NAMES).map((mechanism) => (
              <span className="codex-mini" key={mechanism.zh}>
                {mechanism.zh}
              </span>
            ))}
          </div>
        </Panel>
        <Panel
          title="机制原理馆"
          subtitle="四关背后的桌游机制知识：行动选取、工人放置、拍卖与谈判、成套收集。"
          tone="purple"
          actions={
            <Button variant="secondary" onClick={() => navigate({ kind: 'knowledge' })}>
              打开原理馆
            </Button>
          }
        >
          <p className="tool-copy">
            从「规则 → 选择 → 体验」拆解每个系统：它借用了哪类桌游机制、为什么会产生这种体验、常见误用是什么。
            先玩一关再读，效果最好。
          </p>
          <div className="codex-mini-row" aria-hidden="true">
            {['行动选取', '工人放置', '拍卖与谈判', '成套收集'].map((label) => (
              <span className="codex-mini" key={label}>
                {label}
              </span>
            ))}
          </div>
        </Panel>
        <Panel
          title="展示模式"
          subtitle="约 5 分钟演示完整价值，固定种子，可直接跳转。"
          tone="amber"
          actions={
            <Button variant="secondary" onClick={() => navigate({ kind: 'showcase' }, 'showcase')}>
              进入展示模式
            </Button>
          }
        >
          <p className="tool-copy">
            给评委或朋友演示时，用固定种子重复同一场维修；演示中的操作与完成记录不会写入正式进度。
          </p>
          <p className="tool-note">当前演示记录：{demo.completedSteps.length} 个步骤已完成。</p>
        </Panel>
      </section>

      <footer className="home-footer">
        <p>
          所有对比数字都来自你在本页的真实操作记录，不含虚构用户数据。创作参考见
          <button type="button" className="link-button" onClick={() => navigate({ kind: 'references' })}>
            设计参考
          </button>
          。
        </p>
        <p>《足球经理修理铺》v5.1 · 非官方足球经理题材 · 进度保存在本机浏览器。</p>
      </footer>
    </div>
  );
}

function CommissionCard({
  level,
  status,
  unlocked,
  onStart,
}: {
  level: LevelDefinition;
  status: keyof typeof STATUS_LABEL;
  unlocked: boolean;
  onStart: () => void;
}) {
  const mechanism = MECHANISM_NAMES[level.mechanismId];
  const actionLabel = !unlocked
    ? '完成上一关后解锁'
    : status === 'completed'
      ? '重新试玩'
      : status === 'in-progress'
        ? '继续维修'
        : '开始维修';
  return (
    <article className={`commission-card${unlocked ? '' : ' is-locked'}${status === 'completed' ? ' is-completed' : ''}`}>
      <header className="commission-card-head">
        <span className="card-no">委托 NO.{String(level.order).padStart(2, '0')}</span>
        {unlocked ? (
          <Chip tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Chip>
        ) : (
          <Chip tone="neutral" icon="🔒">
            未解锁
          </Chip>
        )}
      </header>
      <div className="commission-card-body">
        <span className="card-avatar" aria-hidden="true">
          {level.clientAvatar}
        </span>
        <div>
          <h3 className="card-title">{level.title}</h3>
          <p className="card-client">
            {level.clientName} · {level.clientRole}
          </p>
        </div>
      </div>
      <p className="card-complaint">“{level.complaint}”</p>
      <div className="card-topic">
        <span>学习系统</span>
        <strong>{mechanism.zh}</strong>
        <span className="card-topic-en">{mechanism.en}</span>
      </div>
      <Button
        variant={unlocked ? (status === 'completed' ? 'secondary' : 'primary') : 'secondary'}
        fullWidth
        disabled={!unlocked}
        onClick={onStart}
      >
        {actionLabel}
      </Button>
    </article>
  );
}

function ClubOffice({ summary }: { summary: LevelProgressSummary }) {
  const { progress, startLevel } = useApp();
  const club = progress.club;
  const latest = club.timeline[club.timeline.length - 1];
  const nextLevel = getLevel(summary.nextLevel);
  const seasonDone = summary.completedCount >= LEVELS.length;
  const week = Math.min(summary.completedCount + 1, LEVELS.length);

  return (
    <section className="club-office" aria-label="俱乐部办公室">
      <header className="club-office-head">
        <div>
          <p className="eyebrow">俱乐部办公室 · 赛季进行中</p>
          <h2 className="club-office-title">
            {club.name}
            <span>{club.season} 赛季</span>
          </h2>
          <p className="club-office-meta">
            第 {week} 周 · 已完成 {summary.completedCount} / {LEVELS.length} 份系统维修
            {club.failures > 0 ? ` · 返工 ${club.failures} 次` : ''}
          </p>
        </div>
        <div className="club-office-side">
          <Chip tone="purple">董事会委托：修好四个系统</Chip>
          <span className="club-office-resources">
            转会预算 €{club.transferBudget}M · 周薪空间 €{club.wageBudget}k · 已签 {club.signings.length} 人
          </span>
          {latest && <span className="club-office-time">最近更新 {formatClubTime(latest.at)}</span>}
        </div>
      </header>

      <div className="club-office-grid">
        <div className="club-latest">
          <p className="club-label">最近一份维修结果</p>
          {latest ? (
            <>
              <h3>{latest.headline}</h3>
              <ul>
                {latest.details.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="club-empty">
              还没有结果。完成第一份委托后，这里会记录真实的比赛、报告、签约或名单数据，而不是虚构评分。
            </p>
          )}
        </div>

        <div className="club-next">
          <p className="club-label">{seasonDone ? '赛季收官' : '下一份委托'}</p>
          {seasonDone ? (
            <p className="club-empty">
              四个系统都修好了。你可以重玩任意一关，或者打开经理图鉴回看四张系统卡。
            </p>
          ) : (
            <>
              <h3>
                {nextLevel.title}
                <span className="club-next-client">
                  {nextLevel.clientName} · {nextLevel.clientRole}
                </span>
              </h3>
              <blockquote>“{nextLevel.complaint}”</blockquote>
              <Button size="sm" onClick={() => startLevel(nextLevel.id)}>
                继续处理
              </Button>
            </>
          )}
        </div>
      </div>

      <ol className="club-timeline" aria-label="赛季维修时间线">
        {LEVELS.map((level) => {
          const entry = club.timeline.find((item) => item.levelId === level.id);
          const completed = Boolean(entry);
          const current = !completed && isLevelUnlocked(level.id, progress.completedLevels);
          return (
            <li
              key={level.id}
              className={`club-timeline-item${completed ? ' is-done' : ''}${current ? ' is-current' : ''}`}
            >
              <span className="club-timeline-dot" aria-hidden="true">
                {completed ? '✓' : level.order}
              </span>
              <div>
                <p className="club-timeline-title">{level.title}</p>
                <p className="club-timeline-text">
                  {entry ? entry.headline : current ? '待维修' : '未解锁'}
                </p>
              </div>
            </li>
          );
        })}
      </ol>

      {(club.tactics || club.signings.length > 0 || club.scoutedCandidates.length > 0) && (
        <div className="club-assets" aria-label="跨关资源">
          {club.tactics && (
            <p>
              <span className="club-assets-label">战术板产出</span>
              有球 {club.tactics.possessionShape} · 无球 {outOfPossessionLabel(club.tactics.outOfPossessionShape)} · 边后卫{' '}
              {dutyLabel(club.tactics.fullbackDuty)} · 后腰 {dutyLabel(club.tactics.pivotDuty)}
            </p>
          )}
          {club.scoutedCandidates.length > 0 && (
            <p>
              <span className="club-assets-label">球探报告</span>
              {club.scoutedCandidates.map((candidate) => `${candidate.name}（${candidate.position}，知识度 ${candidate.knowledge}%）`).join(' · ')}
            </p>
          )}
          {club.signings.length > 0 && (
            <p>
              <span className="club-assets-label">已签约</span>
              {club.signings.map((signing) => `${signing.name}（${signing.position}）`).join(' · ')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function formatClubTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '刚刚';
  return date.toLocaleString('zh-CN', { hour12: false });
}

const OUT_SHAPE_LABELS: Record<string, string> = {
  '4-4-2-mid': '4-4-2 中位块',
  '4-1-4-1': '4-1-4-1',
  '5-3-2-low': '5-3-2 低位块',
};

function outOfPossessionLabel(value: string): string {
  return OUT_SHAPE_LABELS[value] ?? value;
}

const DUTY_LABELS: Record<string, string> = {
  overlap: '套边',
  invert: '内收',
  single: '单后腰',
  double: '双后腰',
};

function dutyLabel(value: string): string {
  return DUTY_LABELS[value] ?? value;
}

