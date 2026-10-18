import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ClubUpdate, LevelScreenProps } from '../../engine/types';
import { randomSeed } from '../../engine/rng';
import { LevelWorkbench } from '../../../components/Workbench';
import { Button, Callout, Chip, Meter, Panel, RuleList, StatTile } from '../../../components/Ui';
import { ModuleCard } from '../../../components/ModulePanel';
import { QuizCard } from '../../../components/QuizCard';
import { ComparisonTable, EventLogList } from '../../../components/EventLogView';
import {
  DIAGNOSE_CORRECT_ID,
  DIAGNOSE_OPTIONS,
  KNOWLEDGE_MAX,
  REGIONS,
  SCOUTING_MODULES,
  SCOUTING_TARGETS,
  SCOUT_CANDIDATES,
  TRANSFER_CORRECT_ID,
  TRANSFER_OPTIONS,
  abilityLines,
  archiveBlockReason,
  assignScout,
  budgetAfterRetries,
  buildArchiveSummary,
  buildCandidateReports,
  buildClubUpdate,
  buildCompletionResult,
  buildScoutingComparison,
  canAssignScout,
  canComplete,
  candidateReport,
  completeArchive,
  createInitialScoutingState,
  dispatchRuleSummary,
  endRound,
  evaluateScoutingVerification,
  findCandidate,
  finishFaultPlay,
  formatBudgetM,
  inspectCandidate,
  isSelectingCandidate,
  isVerificationDone,
  knowledgeSummary,
  loadoutModuleNames,
  moduleKnowledgeGain,
  moduleScoutsPerRound,
  openSummary,
  openTransfer,
  pickFaultCandidate,
  precisionDescription,
  precisionLabel,
  regionName,
  remainingBudget,
  reportPrecision,
  resolveDiagnose,
  resolveTransfer,
  retryVerification,
  RETRY_COST_MILLIONS,
  reviveScoutingState,
  SCOUT_NETWORK_FEE_MILLIONS,
  scoutsAvailable,
  selectCandidate,
  skipTransferInShowcase,
  startFaultPlay,
  startRepair,
  startVerify,
  toggleScoutingModule,
  trueOverall,
} from './logic';
import type {
  CandidateReport,
  RegionId,
  ScoutingInitOptions,
  ScoutingState,
  ScoutingTargetCheck,
} from './logic';
import './scouting.css';

/* ==========================================================================
   关卡二《球探室》界面（v2：模块池 / 失败重试 / 知识度与报告可视化）
   ========================================================================== */

const PRECISION_TONE = {
  unknown: 'neutral',
  unreliable: 'red',
  wide: 'amber',
  narrow: 'purple',
  precise: 'green',
} as const;

function precisionTone(precision: CandidateReport['precision']) {
  return PRECISION_TONE[precision];
}

/** 报告区间条：只画区间与知识度，不显示真实精确值。 */
function RangeBar({ report }: { report: CandidateReport }) {
  if (!report.range) {
    return <p className="scouting-range-empty">未知：还没有可用的报告区间。</p>;
  }
  const { low, high } = report.range;
  const width = Math.max(1, high - low);
  return (
    <div className="scouting-range">
      <div className="scouting-range-head">
        <span>报告区间</span>
        <strong>
          {low} – {high}
        </strong>
        <span className="scouting-range-precision">知识度 {report.knowledge}%</span>
      </div>
      <div className="scouting-range-track" role="img" aria-label={`报告区间 ${low} 到 ${high}，知识度 ${report.knowledge}%`}>
        <span
          className={`scouting-range-fill is-${report.precision}`}
          style={{ left: `${Math.max(0, Math.min(100, low))}%`, width: `${Math.min(100, width)}%` }}
        />
      </div>
      <p className="scouting-range-note">
        {precisionDescription(report.precision)} 不会显示真实精确值。
      </p>
    </div>
  );
}

function ReportCard({
  name,
  position,
  region,
  report,
  action,
  footer,
}: {
  name: string;
  position: string;
  region: RegionId;
  report: CandidateReport;
  action?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <article className={`scouting-candidate is-${report.precision}`}>
      <header className="scouting-candidate-head">
        <div>
          <p className="scouting-candidate-name">{name}</p>
          <p className="scouting-candidate-meta">
            {position} · {regionName(region)}
          </p>
        </div>
        <Chip tone={precisionTone(report.precision)}>{precisionLabel(report.precision)}</Chip>
      </header>
      <RangeBar report={report} />
      <p className="scouting-report">{report.summary}</p>
      {footer}
      {action && <div className="scouting-candidate-actions">{action}</div>}
    </article>
  );
}

function TargetList({ targets }: { targets: ScoutingTargetCheck[] }) {
  return (
    <ul className="scouting-targets" aria-label="验证目标">
      {targets.map((target) => (
        <li key={target.id} className={`scouting-target${target.met ? ' is-met' : ' is-missed'}`}>
          <span className="scouting-target-mark" aria-hidden="true">
            {target.met ? '✓' : '✗'}
          </span>
          <span className="scouting-target-body">
            <span className="scouting-target-label">{target.label}</span>
            <span className="scouting-target-detail">
              要求 {target.requirement} · 实际 {target.actual}
            </span>
          </span>
          <span className="visually-hidden">{target.met ? '已达成' : '未达成'}</span>
        </li>
      ))}
    </ul>
  );
}

function ClubUpdateBox({ update }: { update: ClubUpdate }) {
  return (
    <div className="scouting-club-update">
      <p className="scouting-club-headline">{update.headline}</p>
      <ul className="bullet-list">
        {update.details.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {update.nextBrief && <p className="scouting-club-next">下一份委托：{update.nextBrief}</p>}
    </div>
  );
}

export function ScoutingLevel({ level, mode, fastStart, showcaseOptions, club, savedState, onSaveState, onComplete, onExit }: LevelScreenProps) {
  const [initialSeed] = useState<number>(() => showcaseOptions?.seed ?? randomSeed());
  const initOptions = useMemo<ScoutingInitOptions>(
    () => ({ mode, fastStart, showcaseOptions, startingBudget: mode === 'normal' ? club?.transferBudget : undefined }),
    [mode, fastStart, showcaseOptions, club?.transferBudget],
  );
  const [state, setState] = useState<ScoutingState>(
    () => reviveScoutingState(savedState, initOptions) ?? createInitialScoutingState(initOptions, initialSeed),
  );

  const saveRef = useRef(onSaveState);
  const completedRef = useRef(false);

  useEffect(() => {
    saveRef.current = onSaveState;
  }, [onSaveState]);

  useEffect(() => {
    if (completedRef.current) return;
    saveRef.current(state);
  }, [state]);

  function apply(transform: (current: ScoutingState) => ScoutingState) {
    setState((current) => {
      const next = transform(current);
      return next === current ? current : next;
    });
  }

  function finishArchive() {
    if (completedRef.current || !canComplete(state)) return;
    completedRef.current = true;
    const next = completeArchive(state);
    setState(next);
    onComplete(buildCompletionResult(next));
    onExit();
  }

  const selecting = isSelectingCandidate(state);
  const roundsDone = state.round >= state.rounds;
  const dispatchOpen = !selecting && !roundsDone;
  const verification = evaluateScoutingVerification(state);
  const done = isVerificationDone(state);
  const scoutsPerRound = moduleScoutsPerRound(state);
  const knowledgeGain = moduleKnowledgeGain(state);
  const remainingScouts = scoutsAvailable(state);
  const reports = new Map(buildCandidateReports(state).map((report) => [report.candidateId, report]));
  const loadoutNames = loadoutModuleNames(state.loadout);
  const clubUpdate = buildClubUpdate(state);
  const selectedCandidate = state.selectedCandidateId ? findCandidate(state.selectedCandidateId) ?? null : null;
  const selectedReport = selectedCandidate
    ? reports.get(selectedCandidate.id) ?? candidateReport(selectedCandidate, state.knowledge[selectedCandidate.region])
    : null;
  const covered = REGIONS.filter((region) => state.knowledge[region.id] > 0);
  const budgetNow = budgetAfterRetries(state);
  const finalBudget = remainingBudget(state);
  const budgetAfterRetry = Math.max(0, Math.round((budgetNow - RETRY_COST_MILLIONS) * 10) / 10);

  const commissionPanel = (
    <Panel title="接单：考察变成一个没有成本的按钮" subtitle={`${level.clientName} · ${level.clientRole}`} tone="purple">
      <Callout tone="amber" title="投诉原文" icon="🗣">
        {level.complaint}
      </Callout>
      <div className="scouting-commission">
        <div>
          <p className="scouting-brief-title">客户目标</p>
          <ul className="bullet-list">
            {level.teachingObjectives.map((objective) => (
              <li key={objective}>{objective}</li>
            ))}
          </ul>
        </div>
        <div className="scouting-fault-summary">
          <p className="scouting-fault-title">故障版的考察</p>
          <p>5 名候选 · 点一下「考察」→ 全部精确属性瞬间可见</p>
          <p className="scouting-hint">没有球探数量、没有区域容量、没有等待轮次。</p>
        </div>
      </div>
      <Callout tone="neutral" title="本关完成条件">
        {level.completionRequirements.join(' · ')}
      </Callout>
      <div className="scouting-actions">
        <Button size="lg" onClick={() => apply(startFaultPlay)}>
          开始故障试玩
        </Button>
      </div>
    </Panel>
  );

  const faultPanel = (
    <Panel title="故障试玩：信息全知" subtitle={state.fault.picked ? '已挑出一名候选，可以结束试玩' : '点击考察，所有精确属性立刻出现'}>
      <Callout tone="red" title="故障版的考察立刻给出全部精确值" icon="⚠">
        点一次「考察」，这名候选的速度、技术、意识、潜力全部瞬间可见。没有球探名额，也没有等待；考察不需要判断，只需要点按钮。
      </Callout>
      <div className="scouting-candidate-grid">
        {state.candidateOrder.map((candidateId) => {
          const candidate = SCOUT_CANDIDATES.find((item) => item.id === candidateId);
          if (!candidate) return null;
          const inspected = state.fault.inspected.includes(candidate.id);
          const picked = state.fault.picked === candidate.id;
          const overall = trueOverall(candidate);
          return (
            <article key={candidate.id} className={`scouting-candidate${picked ? ' is-picked' : ''}`}>
              <header className="scouting-candidate-head">
                <div>
                  <p className="scouting-candidate-name">{candidate.name}</p>
                  <p className="scouting-candidate-meta">
                    {candidate.position} · {regionName(candidate.region)}
                  </p>
                </div>
                <Chip tone={inspected ? 'red' : 'neutral'}>{inspected ? '已全知' : '待考察'}</Chip>
              </header>
              <p className="scouting-report">
                {inspected ? `精确属性：${abilityLines(candidate)}` : '故障版里点一下「考察」，全部精确信息瞬间出现。'}
              </p>
              {inspected && <p className="scouting-hint">再点也不会有更多信息——故障版的信息本来就是一次给全的。</p>}
              <div className="scouting-candidate-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={inspected || state.fault.picked !== null}
                  onClick={() => apply((current) => inspectCandidate(current, candidate.id))}
                >
                  {inspected ? `已看到总评 ${overall}` : '考察（瞬间全知）'}
                </Button>
                <Button
                  size="sm"
                  disabled={!inspected || state.fault.picked !== null}
                  onClick={() => apply((current) => pickFaultCandidate(current, candidate.id))}
                >
                  {picked ? '已加入候选名单' : '加入候选名单'}
                </Button>
              </div>
              {picked && <Chip tone="green">故障版选择：{candidate.name}</Chip>}
            </article>
          );
        })}
      </div>
      {state.fault.picked && (
        <>
          <Callout tone="amber" title="但这次选择没有判断">
            因为所有信息都免费且瞬间完整，挑谁都不需要取舍。下一步诊断：考察为什么会失去意义。
          </Callout>
          <div className="scouting-actions">
            <Button onClick={() => apply(finishFaultPlay)}>结束故障试玩，去诊断</Button>
          </div>
        </>
      )}
    </Panel>
  );

  const diagnosePanel = (
    <Panel title="诊断：考察为什么没意义？" subtitle="看刚才的故障试玩：信息免费且瞬间完整。">
      <QuizCard
        question="为什么「点一下就看到全部精确属性」让考察失去意义？"
        hint="判断缺的是哪条规则，而不是候选强不强。"
        options={DIAGNOSE_OPTIONS.map((option) => ({ id: option.id, label: option.label }))}
        correctIds={[DIAGNOSE_CORRECT_ID]}
        explanations={Object.fromEntries(DIAGNOSE_OPTIONS.map((option) => [option.id, option.explanation]))}
        wrongHint="提示：问题不在点击速度，也不在候选质量，而在信息有没有成本。"
        successText="对。球探有限、信息需要一轮轮积累，考察才变成判断。下一步去维修台挑模块。"
        initiallyResolved={state.diagnose.resolved}
        onResolved={() => apply(resolveDiagnose)}
      />
      {state.diagnose.resolved && (
        <div className="scouting-actions">
          <Button onClick={() => apply(startRepair)}>开始维修</Button>
        </div>
      )}
    </Panel>
  );

  const repairPanel = (
    <Panel title="维修台：4 个模块自由配置" subtitle="两个槽位各二选一；可以先自由组合，再由派遣结果检验" tone="purple">
      {mode === 'showcase' && state.fault.done && !state.evidence.experiencedFault && (
        <Callout tone="amber" title="演示从这里开始">
          故障试玩记录取自规则基线，玩家没有亲自点过考察，因此不会计入「体验故障」证据。
        </Callout>
      )}
      <div className="scouting-slots">
        {(['dispatch', 'report'] as const).map((slot) => (
          <section className="scouting-slot" key={slot}>
            <p className="scouting-slot-title">{slot === 'dispatch' ? '派遣模块（二选一）' : '报告模块（二选一）'}</p>
            <div className="scouting-slot-cards">
              {SCOUTING_MODULES.filter((module) => module.slot === slot).map((module) => {
                const installed = state.loadout[slot] === module.id;
                return (
                  <ModuleCard
                    key={module.id}
                    name={module.name}
                    englishName={module.englishName}
                    summary={module.description}
                    sideEffect={module.sideEffect}
                    installed={installed}
                    badge={<span className="scouting-module-effect">{module.effect}</span>}
                    onToggle={() => apply((current) => toggleScoutingModule(current, module.id))}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <Callout tone="neutral" title="当前派遣规则">
        {dispatchRuleSummary(state)}
      </Callout>
      <div className="scouting-rule-strip">
        <Chip tone="purple">每轮 {scoutsPerRound} 名球探</Chip>
        <Chip tone="purple">{REGIONS.length} 个区域</Chip>
        <Chip tone="amber">每区域每轮最多 1 人</Chip>
        <Chip tone={knowledgeGain > 0 ? 'green' : 'red'}>每次考察 +{knowledgeGain} 知识度</Chip>
        <Chip tone="neutral">{state.rounds} 轮派遣</Chip>
      </div>
      <div className="scouting-budget-strip" role="note">
        <Chip tone="amber">俱乐部转会预算 €{formatBudgetM(budgetNow)}M</Chip>
        <Chip tone={state.failureCount > 0 ? 'red' : 'neutral'}>本关返工 {state.failureCount} 次</Chip>
        <span className="scouting-hint">
          验证未达成后每次由俱乐部承担 €{formatBudgetM(RETRY_COST_MILLIONS)}M 考察成本；完成时另扣 €
          {formatBudgetM(SCOUT_NETWORK_FEE_MILLIONS)}M 球探网络维护费（最低 0）。
        </span>
      </div>
      <Callout tone="amber" title="验证目标">
        至少 {SCOUTING_TARGETS.coverageMin} 个区域知识度 ≥ {SCOUTING_TARGETS.knowledgeThreshold}，且选中候选的报告精度至少「
        {precisionLabel(SCOUTING_TARGETS.reportPrecisionMin)}」。未达成可以回到维修台重新配置。
      </Callout>
      <div className="scouting-actions">
        <Button onClick={() => apply(startVerify)}>
          {state.attempts > 0 ? `重新派遣（第 ${state.attempts + 1} 次尝试）` : `开始派遣（${state.rounds} 轮）`}
        </Button>
      </div>
    </Panel>
  );

  const verifyPanel = (
    <Panel
      title="验证：有限球探与知识度报告"
      subtitle={
        selecting
          ? '全部轮次结束：只能依据当前报告，从候选里选 1 名'
          : done
            ? verification.passed
              ? '选择完成：目标全部达成'
              : '选择完成：有目标没达成，可以回到维修台重新配置'
            : `第 ${Math.min(state.round + 1, state.rounds)} / ${state.rounds} 轮派遣`
      }
      tone={done && !verification.passed ? 'amber' : 'green'}
    >
      <div className="scouting-dispatch-head">
        <p className="scouting-dispatch-title">{dispatchRuleSummary(state)}</p>
        <div className="scouting-scout-tokens" aria-label={`剩余球探 ${remainingScouts} 名`}>
          {Array.from({ length: scoutsPerRound }).map((_, index) => (
            <span key={index} className={`scouting-scout-token${index < state.dispatches.length ? ' is-used' : ''}`} aria-hidden="true">
              {index < state.dispatches.length ? '○' : '●'}
            </span>
          ))}
          <span className="scouting-scout-text">
            {remainingScouts > 0 ? `剩余 ${remainingScouts} 名球探` : '本轮球探已用完'}
          </span>
        </div>
      </div>
      <div className="scouting-budget-strip" role="note">
        <Chip tone="amber">俱乐部转会预算 €{formatBudgetM(budgetNow)}M</Chip>
        <Chip tone={state.failureCount > 0 ? 'red' : 'neutral'}>本关返工 {state.failureCount} 次</Chip>
        <span className="scouting-hint">完成时另扣 €{formatBudgetM(SCOUT_NETWORK_FEE_MILLIONS)}M 球探网络维护费。</span>
      </div>
      {mode === 'showcase' && !state.evidence.experiencedFault && (
        <Callout tone="amber" title="演示从验证开始">
          故障考察记录取自规则基线，玩家没有亲自点过「考察」，因此不会计入「体验故障」证据。
        </Callout>
      )}
      <div className="scouting-map" aria-label="球探区域地图">
        {REGIONS.map((region) => {
          const knowledge = state.knowledge[region.id];
          const precision = reportPrecision(knowledge);
          const dispatched = state.dispatches.includes(region.id);
          const disabled = !canAssignScout(state, region.id);
          let buttonLabel = `派球探到${region.name}`;
          if (dispatched) buttonLabel = '本轮已有球探';
          else if (roundsDone) buttonLabel = '本轮已结束';
          else if (remainingScouts === 0) buttonLabel = '本轮球探已用完';
          return (
            <article
              key={region.id}
              className={`scouting-map-node scouting-region${dispatched ? ' is-dispatched' : ''}`}
              style={{ left: `${region.mapX * 100}%`, top: `${region.mapY * 100}%` }}
            >
              <header className="scouting-region-head">
                <h3 className="scouting-region-name">{region.name}</h3>
                <Chip tone={precisionTone(precision)}>{precisionLabel(precision)}</Chip>
              </header>
              <p className="scouting-region-desc">{region.description}</p>
              <Meter
                label="知识度"
                value={knowledge}
                max={KNOWLEDGE_MAX}
                tone={precision === 'unknown' ? 'neutral' : precision === 'wide' ? 'amber' : 'green'}
                valueLabel={`${knowledge} / ${KNOWLEDGE_MAX}`}
              />
              <p className="scouting-hint">{knowledgeSummary(state, region.id)}</p>
              {dispatchOpen && (
                <Button size="sm" variant="secondary" disabled={disabled} onClick={() => apply((current) => assignScout(current, region.id))}>
                  {buttonLabel}
                </Button>
              )}
              {dispatched && <span className="scouting-region-token" aria-hidden="true">● 球探已就位</span>}
            </article>
          );
        })}
      </div>
      {dispatchOpen && (
        <div className="scouting-round-bar">
          <Chip tone="neutral">剩余球探 {remainingScouts} / {scoutsPerRound}</Chip>
          <Button onClick={() => apply(endRound)} disabled={state.dispatches.length !== scoutsPerRound}>
            结束本轮并收回球探
          </Button>
        </div>
      )}
      {state.history.length > 0 && (
        <ComparisonTable
          head={['轮次', '考察区域', `每次知识度`, '知识度变化']}
          rows={state.history.map((record) => [
            `第 ${record.round} 轮`,
            record.regions.map((region) => regionName(region)).join('、'),
            `+${record.knowledgeGain}`,
            record.regions
              .map((region) => `${regionName(region)} ${record.knowledgeBefore[region]} → ${record.knowledgeAfter[region]}`)
              .join('；'),
          ])}
        />
      )}
      <div className="scouting-report-section">
        <p className="scouting-section-title">候选报告（只显示报告允许看到的信息）</p>
        <div className="scouting-candidate-grid">
          {state.candidateOrder.map((candidateId) => {
            const candidate = SCOUT_CANDIDATES.find((item) => item.id === candidateId);
            if (!candidate) return null;
            const report = reports.get(candidate.id) ?? candidateReport(candidate, state.knowledge[candidate.region]);
            const selected = state.selectedCandidateId === candidate.id;
            return (
              <ReportCard
                key={candidate.id}
                name={candidate.name}
                position={candidate.position}
                region={candidate.region}
                report={report}
                footer={selected ? <Chip tone="green">已加入候选名单</Chip> : undefined}
                action={
                  selecting ? (
                    <Button size="sm" onClick={() => apply((current) => selectCandidate(current, candidate.id))}>
                      加入候选名单
                    </Button>
                  ) : undefined
                }
              />
            );
          })}
        </div>
        {selecting && (
          <Callout tone="amber" title="只能依据当前报告">
            选择时不允许显示真实精确值。知识度与区间都在卡片上；没考察过的区域仍然是「未知」。
          </Callout>
        )}
      </div>
      {done && (
        <>
          <p className="scouting-target-title">
            验证目标（{verification.targets.filter((target) => target.met).length} / {verification.targets.length} 达成）
          </p>
          <TargetList targets={verification.targets} />
          {verification.passed ? (
            <>
              <ComparisonTable
                head={['对比项', '故障版（信息全知）', '修复版（有限信息）']}
                rows={buildScoutingComparison(state).map((row) => [row.label, row.fault, row.fixed])}
              />
              <div className="scouting-actions">
                <Button onClick={() => apply(openTransfer)}>完成验证，去迁移</Button>
              </div>
            </>
          ) : (
            <>
              <Callout tone="red" title="验证未达成" icon="⚠">
                未达成：{verification.failed.map((target) => `${target.label}（${target.actual}，要求 ${target.requirement}）`).join('；')}。
                本次返工俱乐部承担 €{formatBudgetM(RETRY_COST_MILLIONS)}M 返工成本（考察费用），转会预算将受影响：€{formatBudgetM(
                  budgetNow,
                )}M → €{formatBudgetM(budgetAfterRetry)}M（完成时另扣 €{formatBudgetM(SCOUT_NETWORK_FEE_MILLIONS)}M 维护费）。
                点击下面的按钮清空本轮派遣与选择，保留故障证据，回到维修台重新配置。
              </Callout>
              <div className="scouting-actions">
                <Button onClick={() => apply(retryVerification)}>回到维修台重新配置</Button>
              </div>
            </>
          )}
        </>
      )}
    </Panel>
  );

  const transferPanel = (
    <Panel title="迁移：哪个情境才是「球探网络」？" subtitle="从三个情境里选出同时具备有限球探、区域容量、轮末收回、信息逐步积累的那个。">
      <QuizCard
        question="下面哪个情境具有「球探网络」的结构？"
        hint="看四件事：球探是否有限、区域是否有容量、轮末是否收回、信息是否逐步变清楚。"
        options={TRANSFER_OPTIONS.map((option) => ({ id: option.id, label: option.label }))}
        correctIds={[TRANSFER_CORRECT_ID]}
        explanations={Object.fromEntries(TRANSFER_OPTIONS.map((option) => [option.id, option.explanation]))}
        wrongHint="提示：只有一个选项同时具备四个特征。"
        successText="对。有限球探、区域容量、轮末收回、信息逐步积累，四件事同时成立才是球探网络。"
        initiallyResolved={state.transfer.resolved}
        onResolved={() => apply(resolveTransfer)}
      />
      {state.transfer.resolved && (
        <div className="scouting-actions">
          <Button onClick={() => apply(openSummary)}>进入归档</Button>
        </div>
      )}
      {mode === 'showcase' && !state.transfer.resolved && (
        <div className="scouting-skip">
          <Callout tone="amber" title="演示跳过迁移题">
            展示模式允许跳过迁移题；跳过后仍可完成演示，但 evidence.transferred 会保持 false。
          </Callout>
          <Button variant="secondary" onClick={() => apply(skipTransferInShowcase)}>
            演示跳过迁移题
          </Button>
        </div>
      )}
    </Panel>
  );

  const summaryPanel = (
    <Panel title="归档：球探网络" subtitle="这里只展示真实派遣记录与真实报告" tone="green">
      {state.transfer.skipped && (
        <Callout tone="amber" title="演示跳过迁移题">
          本次不计「迁移」证据，演示仍可完成。
        </Callout>
      )}
      <div className="scouting-stat-grid">
        <StatTile label="派遣轮数" value={`${state.round} / ${state.rounds}`} hint={`每轮 ${scoutsPerRound} 名球探`} tone="purple" />
        <StatTile
          label="覆盖区域"
          value={`${covered.length} / ${REGIONS.length}`}
          hint={covered.map((region) => regionName(region.id)).join('、') || '没有区域'}
          tone="green"
        />
        <StatTile
          label="知识度上限"
          value={`${Math.max(...REGIONS.map((region) => state.knowledge[region.id]))}`}
          hint="单个区域最高知识度"
          tone="amber"
        />
        <StatTile
          label="选择"
          value={selectedCandidate ? selectedCandidate.name : '—'}
          hint={selectedReport ? `报告：${precisionLabel(selectedReport.precision)}` : ''}
          tone="neutral"
        />
      </div>
      <p className="scouting-target-title">验证目标（全部达成）</p>
      <TargetList targets={verification.targets} />
      <ComparisonTable
        head={['对比项', '故障版（信息全知）', '修复版（有限信息）']}
        rows={buildScoutingComparison(state).map((row) => [row.label, row.fault, row.fixed])}
      />
      <div className="scouting-summary-block">
        <p className="scouting-section-title">真实派遣记录</p>
        {state.history.length === 0 ? (
          <p className="scouting-hint">没有派遣记录。</p>
        ) : (
          <ComparisonTable
            head={['轮次', '考察区域', '知识度变化']}
            rows={state.history.map((record) => [
              `第 ${record.round} 轮`,
              record.regions.map((region) => regionName(region)).join('、'),
              record.regions
                .map((region) => `${regionName(region)} ${record.knowledgeBefore[region]} → ${record.knowledgeAfter[region]}`)
                .join('；'),
            ])}
          />
        )}
      </div>
      {selectedCandidate && selectedReport && (
        <Callout tone="green" title="选择结果（真实能力现在揭晓）">
          当时报告：{selectedReport.summary}。真实能力：{abilityLines(selectedCandidate)}。不要求选中「最强」球员。
        </Callout>
      )}
      <Callout tone="amber" title="俱乐部成本">
        本关返工 {state.failureCount} 次，俱乐部承担 €{formatBudgetM(state.failureCount * RETRY_COST_MILLIONS)}M 考察成本，加上 €
        {formatBudgetM(SCOUT_NETWORK_FEE_MILLIONS)}M 球探网络维护费；剩余转会预算 €{formatBudgetM(finalBudget)}M（最低 0，不会为负）。
      </Callout>
      <RuleList
        items={[
          { label: '知识度增长', value: `每次考察 +${knowledgeGain}（上限 ${KNOWLEDGE_MAX}）` },
          { label: '报告精度阈值', value: '<35 模糊 · 35–74 较窄 · ≥75 接近真实（±3）' },
          { label: '轮末处理', value: '球探收回，知识度留在区域里' },
          { label: '模块组合', value: loadoutNames.length > 0 ? loadoutNames.join('、') : '没有模块' },
        ]}
      />
      <ol className="scouting-summary-list">
        {buildArchiveSummary(state).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <Callout tone="purple" title="写入俱乐部时间线（真实数据）">
        <ClubUpdateBox update={clubUpdate} />
      </Callout>
      <div className="scouting-actions">
        <Button size="lg" onClick={finishArchive} disabled={!canComplete(state)}>
          完成归档，返回修理铺
        </Button>
        {!canComplete(state) && <span className="scouting-hint">{archiveBlockReason(state)}</span>}
      </div>
    </Panel>
  );

  const mainContent: ReactNode =
    state.phase === 'commission'
      ? commissionPanel
      : state.phase === 'faultPlay'
        ? faultPanel
        : state.phase === 'diagnose'
          ? diagnosePanel
          : state.phase === 'repair'
            ? repairPanel
            : state.phase === 'verify'
              ? verifyPanel
              : state.phase === 'transfer'
                ? transferPanel
                : summaryPanel;

  const sideContent = (
    <>
      <Panel title="派遣规则" subtitle="这些数字就是维修后真正生效的规则。">
        <RuleList
          items={[
            { label: '球探数量', value: `${scoutsPerRound} 名 / 轮` },
            { label: '区域数量', value: `${REGIONS.length} 个` },
            { label: '同一区域每轮', value: '最多 1 名球探' },
            { label: '每轮结束', value: '球探收回，知识度保留' },
            { label: '知识度', value: `每次 +${knowledgeGain}，上限 ${KNOWLEDGE_MAX}` },
          ]}
        />
      </Panel>
      <Panel title="模块状态" subtitle="点击维修台的模块卡即可安装/卸载。">
        <ul className="scouting-module-status">
          {SCOUTING_MODULES.map((module) => {
            const installed = state.loadout[module.slot] === module.id;
            return (
              <li key={module.id} className={installed ? 'is-installed' : ''}>
                <span aria-hidden="true">{installed ? '●' : '○'}</span>
                <span>{module.name}</span>
              </li>
            );
          })}
        </ul>
        {state.attempts > 0 && <p className="scouting-hint">已重新派遣 {state.attempts} 次。</p>}
      </Panel>
      <Panel title="俱乐部预算" subtitle="失败返工会真实扣款，最低 0。">
        <RuleList
          items={[
            { label: '当前可用预算', value: `€${formatBudgetM(budgetNow)}M`, tone: state.failureCount > 0 ? 'amber' : 'neutral' },
            { label: '本关返工次数', value: `${state.failureCount} 次`, tone: state.failureCount > 0 ? 'red' : 'neutral' },
            { label: '单次考察成本', value: `€${formatBudgetM(RETRY_COST_MILLIONS)}M` },
            { label: '完成时维护费', value: `€${formatBudgetM(SCOUT_NETWORK_FEE_MILLIONS)}M` },
            { label: '完成后剩余', value: `€${formatBudgetM(finalBudget)}M` },
          ]}
        />
      </Panel>
      <Panel title="报告精度阈值" subtitle="信息不是免费的，报告也不是一次给全。">
        <RuleList
          items={[
            { label: '0', value: '未知：只显示名字与位置' },
            { label: '1–34', value: '很宽的模糊区间' },
            { label: '35–74', value: '较窄区间' },
            { label: '75–100', value: '接近真实值（±3）' },
          ]}
        />
        <p className="scouting-hint">
          当前已考察：{covered.length > 0 ? covered.map((region) => `${regionName(region.id)} ${state.knowledge[region.id]}`).join(' · ') : '还没有区域'}
        </p>
      </Panel>
      {(state.phase === 'verify' || state.phase === 'transfer' || state.phase === 'summary') && (
        <Panel title="验证目标" subtitle="归档前必须全部达成。">
          <TargetList targets={verification.targets} />
        </Panel>
      )}
      <Panel title="操作记录" subtitle="归档只读这份真实日志。">
        <EventLogList entries={state.eventLog} maxHeight={280} emptyText="还没有操作记录。先完成故障试玩。" />
      </Panel>
    </>
  );

  return (
    <LevelWorkbench level={level} phase={state.phase} evidence={state.evidence} sideContent={sideContent}>
      {mode === 'showcase' && (
        <Callout tone="amber" title="演示模式">
          固定种子 {state.seed}，快局参数 {state.fastPlay ? '开启（1 轮派遣）' : '关闭（2 轮派遣）'}。本页不写入正式进度。
        </Callout>
      )}
      {mainContent}
    </LevelWorkbench>
  );
}
