import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LevelScreenProps } from '../../engine/types';
import { randomSeed } from '../../engine/rng';
import { LevelWorkbench } from '../../../components/Workbench';
import { Button, Callout, Chip, Meter, Panel, RuleList, StatTile } from '../../../components/Ui';
import { ModuleCard } from '../../../components/ModulePanel';
import { QuizCard } from '../../../components/QuizCard';
import { ComparisonTable, EventLogList } from '../../../components/EventLogView';
import {
  DIAGNOSE_CORRECT_ID,
  DIAGNOSE_OPTIONS,
  KNOWLEDGE_GAIN,
  KNOWLEDGE_MAX,
  REGIONS,
  ROUNDS_FAST,
  ROUNDS_NORMAL,
  SCOUTS_PER_ROUND,
  SCOUT_CANDIDATES,
  TRANSFER_CORRECT_ID,
  TRANSFER_OPTIONS,
  abilityLines,
  assignScout,
  buildArchiveSummary,
  buildCandidateReports,
  buildCompletionResult,
  buildScoutingComparison,
  canAssignScout,
  canComplete,
  candidateReport,
  completeArchive,
  coveredRegions,
  createInitialScoutingState,
  endRound,
  finishFaultPlay,
  inspectCandidate,
  installKnowledgeReports,
  installLimitedScouts,
  isSelectingCandidate,
  knowledgeSummary,
  openSummary,
  openTransfer,
  pickFaultCandidate,
  precisionLabel,
  regionName,
  reportPrecision,
  resolveDiagnose,
  resolveTransfer,
  reviveScoutingState,
  scoutsAvailable,
  selectCandidate,
  skipTransferInShowcase,
  startFaultPlay,
  startRepair,
  startVerify,
  trueOverall,
} from './logic';
import type { CandidateReport, RegionId, ScoutingInitOptions, ScoutingState } from './logic';
import './scouting.css';

/* ==========================================================================
   关卡二《球探室》界面。规则全部在 logic.ts，这里只负责把状态画出来。
   ========================================================================== */

const PRECISION_TONE = {
  unknown: 'neutral',
  wide: 'amber',
  narrow: 'purple',
  precise: 'green',
} as const;

function precisionTone(precision: CandidateReport['precision']) {
  return PRECISION_TONE[precision];
}

function ReportCard({
  name,
  position,
  region,
  knowledge,
  report,
  action,
  footer,
}: {
  name: string;
  position: string;
  region: RegionId;
  knowledge: number;
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
      <div className="scouting-candidate-knowledge">
        <Meter label="区域知识度" value={knowledge} max={KNOWLEDGE_MAX} tone="purple" valueLabel={`${knowledge} / ${KNOWLEDGE_MAX}`} />
      </div>
      <p className="scouting-report">{report.summary}</p>
      {footer}
      {action && <div className="scouting-candidate-actions">{action}</div>}
    </article>
  );
}

export function ScoutingLevel({ level, mode, fastStart, showcaseOptions, savedState, onSaveState, onComplete, onExit }: LevelScreenProps) {
  const [initialSeed] = useState<number>(() => showcaseOptions?.seed ?? randomSeed());
  const initOptions = useMemo<ScoutingInitOptions>(
    () => ({ mode, fastStart, showcaseOptions }),
    [mode, fastStart, showcaseOptions],
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
  const remainingScouts = scoutsAvailable(state);
  const reports = new Map(buildCandidateReports(state).map((report) => [report.candidateId, report]));

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
        successText="对。球探有限、信息需要一轮轮积累，考察才变成判断。下一步去安装模块。"
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
    <Panel title="维修：给信息加上成本" subtitle="两个模块都安装后才能开始派遣" tone="purple">
      {mode === 'showcase' && state.fault.done && !state.evidence.experiencedFault && (
        <Callout tone="amber" title="演示从这里开始">
          故障试玩记录取自规则基线，玩家没有亲自点过考察，因此不会计入「体验故障」证据。
        </Callout>
      )}
      <ModuleCard
        name="有限球探"
        englishName="Limited Scouts"
        summary="只有 2 名球探，可以派往不同区域；每个区域每轮只能安排一名球探；回合结束收回。"
        sideEffect="区域越多，单个区域的知识增长越慢；后手区域可能错过窗口。"
        installed={state.installed.limitedScouts}
        onToggle={!state.installed.limitedScouts ? () => apply(installLimitedScouts) : undefined}
      />
      <ModuleCard
        name="知识度报告"
        englishName="Knowledge Reports"
        summary="知识度从低到高逐级解锁属性区间：低知识度只给模糊评价，高知识度才接近真实能力。"
        sideEffect="报告看起来「很难用」是正常的；它保护你免于被虚假的精确数字骗到。"
        installed={state.installed.knowledgeReports}
        onToggle={!state.installed.knowledgeReports ? () => apply(installKnowledgeReports) : undefined}
      />
      <div className="scouting-rule-strip">
        <Chip tone="purple">{SCOUTS_PER_ROUND} 名球探 / 轮</Chip>
        <Chip tone="purple">{REGIONS.length} 个区域</Chip>
        <Chip tone="amber">同一区域每轮最多 1 人</Chip>
        <Chip tone="green">每轮 +{KNOWLEDGE_GAIN} 知识度，上限 {KNOWLEDGE_MAX}</Chip>
      </div>
      {state.installed.limitedScouts && state.installed.knowledgeReports ? (
        <div className="scouting-actions">
          <Button onClick={() => apply(startVerify)}>开始派遣（{state.rounds} 轮）</Button>
        </div>
      ) : (
        <p className="scouting-hint">先安装上面两个模块：一个负责「派人」，一个负责「报告」。</p>
      )}
    </Panel>
  );

  const verifyPanel = (
    <Panel
      title="验证：有限球探与知识度报告"
      subtitle={
        selecting
          ? '全部轮次结束：只能依据当前报告，从候选里选 1 名'
          : roundsDone
            ? '派遣完成：下面是当时可见的真实报告'
            : `第 ${Math.min(state.round + 1, state.rounds)} / ${state.rounds} 轮派遣`
      }
      tone="green"
    >
      <Callout tone="amber" title="派遣规则">
        每轮 {SCOUTS_PER_ROUND} 名球探；同一区域每轮最多 1 人；人数用完必须结束本轮。轮末球探收回，知识度留在区域里。
      </Callout>
      {mode === 'showcase' && !state.evidence.experiencedFault && (
        <Callout tone="amber" title="演示从验证开始">
          故障考察记录取自规则基线，玩家没有亲自点过「考察」，因此不会计入「体验故障」证据。
        </Callout>
      )}
      <div className="scouting-regions">
        {REGIONS.map((region) => {
          const knowledge = state.knowledge[region.id];
          const precision = reportPrecision(knowledge);
          const dispatched = state.dispatches.includes(region.id);
          const disabled = !canAssignScout(state, region.id);
          let buttonLabel = `派球探到${region.name}`;
          if (dispatched) buttonLabel = '本轮已有球探';
          else if (selecting) buttonLabel = '本轮已结束';
          else if (remainingScouts === 0) buttonLabel = '本轮球探已用完';
          return (
            <article key={region.id} className={`scouting-region${dispatched ? ' is-dispatched' : ''}`}>
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
            </article>
          );
        })}
      </div>
      {dispatchOpen && (
        <div className="scouting-round-bar">
          <Chip tone="neutral">剩余球探 {remainingScouts} / {SCOUTS_PER_ROUND}</Chip>
          <Button onClick={() => apply(endRound)} disabled={state.dispatches.length !== SCOUTS_PER_ROUND}>
            结束本轮并收回球探
          </Button>
        </div>
      )}
      {state.history.length > 0 && (
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
                knowledge={state.knowledge[candidate.region]}
                report={report}
                footer={selected ? <Chip tone="green">已加入候选名单</Chip> : undefined}
                action={
                  selecting ? (
                    <Button size="sm" disabled={selected} onClick={() => apply((current) => selectCandidate(current, candidate.id))}>
                      {selected ? '已选择' : '加入候选名单'}
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
      {state.selectedCandidateId && (
        <>
          <ComparisonTable
            head={['对比项', '故障版（信息全知）', '修复版（有限信息）']}
            rows={buildScoutingComparison(state).map((row) => [row.label, row.fault, row.fixed])}
          />
          <div className="scouting-actions">
            <Button onClick={() => apply(openTransfer)}>完成验证，去迁移</Button>
          </div>
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

  const selectedCandidate = state.selectedCandidateId ? SCOUT_CANDIDATES.find((item) => item.id === state.selectedCandidateId) ?? null : null;
  const selectedReport = selectedCandidate ? candidateReport(selectedCandidate, state.knowledge[selectedCandidate.region]) : null;
  const covered = coveredRegions(state);

  const summaryPanel = (
    <Panel title="归档：球探网络" subtitle="这里只展示真实派遣记录与真实报告" tone="green">
      {state.transfer.skipped && (
        <Callout tone="amber" title="演示跳过迁移题">
          本次不计「迁移」证据，演示仍可完成。
        </Callout>
      )}
      <div className="scouting-stat-grid">
        <StatTile label="派遣轮数" value={`${state.round} / ${state.rounds}`} hint="每轮 2 名球探" tone="purple" />
        <StatTile label="覆盖区域" value={`${covered.length} / ${REGIONS.length}`} hint={covered.map((region) => regionName(region)).join('、') || '没有区域'} tone="green" />
        <StatTile label="知识度上限" value={`${Math.max(...REGIONS.map((region) => state.knowledge[region.id]))}`} hint="单个区域最高知识度" tone="amber" />
        <StatTile label="选择" value={selectedCandidate ? selectedCandidate.name : '—'} hint={selectedReport ? `报告：${precisionLabel(selectedReport.precision)}` : ''} tone="neutral" />
      </div>
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
          当时报告：{selectedReport.summary}。真实能力：{abilityLines(selectedCandidate)}。报告区间{' '}
          {selectedReport.range ? `${selectedReport.range.low}–${selectedReport.range.high}` : '未知'}，不要求选中「最强」球员。
        </Callout>
      )}
      <RuleList
        items={[
          { label: '知识度增长', value: `每次考察 +${KNOWLEDGE_GAIN}（上限 ${KNOWLEDGE_MAX}）` },
          { label: '报告精度阈值', value: '<35 模糊 · 35–74 较窄 · ≥75 接近真实（±3）' },
          { label: '轮末处理', value: '球探收回，知识度留在区域里' },
          { label: '演示参数', value: state.fastPlay ? `快局（${ROUNDS_FAST} 轮）` : `完整（${ROUNDS_NORMAL} 轮）` },
        ]}
      />
      <ol className="scouting-summary-list">
        {buildArchiveSummary(state).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <Callout tone="purple" title="核心问题">
        我改了哪条规则？它改变了什么选择？又产生了什么代价？
      </Callout>
      <div className="scouting-actions">
        <Button size="lg" onClick={finishArchive} disabled={!canComplete(state)}>
          完成归档，返回修理铺
        </Button>
        {!canComplete(state) && <span className="scouting-hint">先完成派遣并选出候选，再答对迁移题，才能归档。</span>}
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
            { label: '球探数量', value: `${SCOUTS_PER_ROUND} 名 / 轮` },
            { label: '区域数量', value: `${REGIONS.length} 个` },
            { label: '同一区域每轮', value: '最多 1 名球探' },
            { label: '每轮结束', value: '球探收回，知识度保留' },
            { label: '知识度', value: `每次 +${KNOWLEDGE_GAIN}，上限 ${KNOWLEDGE_MAX}` },
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
          当前已考察：{covered.length > 0 ? covered.map((region) => `${regionName(region)} ${state.knowledge[region]}`).join(' · ') : '还没有区域'}
        </p>
      </Panel>
      <Panel title="操作记录" subtitle="归档只读这份真实日志。">
        <EventLogList entries={state.eventLog} maxHeight={320} emptyText="还没有操作记录。先完成故障试玩。" />
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
