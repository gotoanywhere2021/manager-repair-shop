import type { ReactNode } from 'react';
import { PHASE_LABELS, PHASE_ORDER } from '../game/engine/types';
import type { Evidence, LevelDefinition, LevelPhase } from '../game/engine/types';
import { MECHANISM_NAMES } from '../game/levels';
import { Chip } from './Ui';

export interface PhaseStep {
  phase: LevelPhase;
  label: string;
}

export const DEFAULT_STEPS: PhaseStep[] = PHASE_ORDER.map((phase) => ({ phase, label: PHASE_LABELS[phase] }));

export function CommissionSheet({ level }: { level: LevelDefinition }) {
  const mechanism = MECHANISM_NAMES[level.mechanismId];
  return (
    <article className="commission-sheet">
      <header className="commission-head">
        <span className="commission-avatar" aria-hidden="true">{level.clientAvatar}</span>
        <div>
          <p className="commission-client">
            {level.clientName}
            <span className="commission-role"> · {level.clientRole}</span>
          </p>
          <p className="commission-order">委托单 NO.{String(level.order).padStart(2, '0')}</p>
        </div>
      </header>
      <blockquote className="commission-quote">“{level.complaint}”</blockquote>
      <footer className="commission-foot">
        <span className="commission-topic">学习系统：{mechanism.zh}</span>
        <span className="commission-time">约 {level.estimatedMinutes} 分钟</span>
      </footer>
    </article>
  );
}

export function PhaseRail({ phase, steps = DEFAULT_STEPS }: { phase: LevelPhase; steps?: PhaseStep[] }) {
  const currentIndex = steps.findIndex((step) => step.phase === phase);
  return (
    <nav className="phase-rail" aria-label="维修步骤">
      <ol>
        {steps.map((step, index) => {
          const state = index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'pending';
          return (
            <li key={step.phase} className={`phase-step is-${state}`}>
              <span className="phase-dot" aria-hidden="true">
                {state === 'done' ? '✓' : index + 1}
              </span>
              <span className="phase-label">{step.label}</span>
              {state === 'active' && <span className="phase-now">当前</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const EVIDENCE_ROWS: { key: keyof Evidence; label: string }[] = [
  { key: 'experiencedFault', label: '我体验了原来的问题。' },
  { key: 'operatedMechanic', label: '我操作了系统改变后的游戏。' },
  { key: 'transferred', label: '我能在新情境中识别系统。' },
];

export function EvidencePanel({ evidence }: { evidence: Evidence }) {
  const count = EVIDENCE_ROWS.filter((row) => evidence[row.key]).length;
  return (
    <section className="evidence-panel" aria-label="维修证据">
      <header className="evidence-head">
        <h2 className="evidence-title">维修证据</h2>
        <Chip tone={count === 3 ? 'green' : 'neutral'}>{count} / 3</Chip>
      </header>
      <ul className="evidence-list">
        {EVIDENCE_ROWS.map((row) => {
          const done = evidence[row.key];
          return (
            <li key={row.key} className={`evidence-item${done ? ' is-done' : ''}`}>
              <span className="evidence-mark" aria-hidden="true">{done ? '✓' : '○'}</span>
              <span>{row.label}</span>
              <span className="visually-hidden">{done ? '已完成' : '未完成'}</span>
            </li>
          );
        })}
      </ul>
      <p className="evidence-note">这里只记录你真实做过的操作，不打综合分。</p>
    </section>
  );
}

export interface LevelWorkbenchProps {
  level: LevelDefinition;
  phase: LevelPhase;
  evidence: Evidence;
  /** 右侧栏：规则说明、维修模块、操作记录。 */
  sideContent: ReactNode;
  /** 中间游戏台。 */
  children: ReactNode;
  steps?: PhaseStep[];
}

/**
 * 关卡工作台：桌面端三栏（委托 / 游戏台 / 规则与记录），窄屏改为上下排列。
 * 游戏台在 DOM 中排在最前，窄屏时优先显示。
 */
export function LevelWorkbench({ level, phase, evidence, sideContent, children, steps }: LevelWorkbenchProps) {
  return (
    <div className="workbench">
      <main className="workbench-main" aria-label="游戏台">
        {children}
      </main>
      <aside className="workbench-side workbench-left" aria-label="委托与进度">
        <CommissionSheet level={level} />
        <PhaseRail phase={phase} steps={steps} />
        <EvidencePanel evidence={evidence} />
      </aside>
      <aside className="workbench-side workbench-right" aria-label="规则与操作记录">
        {sideContent}
      </aside>
    </div>
  );
}
