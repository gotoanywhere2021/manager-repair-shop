import { useEffect, useRef, useState } from 'react';
import type { LevelScreenProps } from '../../engine/types';
import { randomSeed } from '../../engine/rng';
import { LevelWorkbench } from '../../../components/Workbench';
import type { PhaseStep } from '../../../components/Workbench';
import {
  Button,
  Callout,
  Chip,
  ConfirmDialog,
  EmptyState,
  Meter,
  Panel,
  RuleList,
  StatTile,
} from '../../../components/Ui';
import { ModuleCard, PresetPicker } from '../../../components/ModulePanel';
import { QuizCard } from '../../../components/QuizCard';
import { ComparisonTable, EventLogList } from '../../../components/EventLogView';
import {
  BASE_SQUAD_TOTAL,
  CANDIDATE_SEEDS,
  COUNTERFACTUAL_CORRECT_ID,
  COUNTERFACTUAL_EXPLANATIONS,
  COUNTERFACTUAL_OPTIONS,
  MICRO_LISTS,
  MODULE_DEGRADE_NOTES,
  MATCH_DECISIONS,
  OUT_PRESETS,
  POSITION_LABELS,
  POSSESSION_PRESETS,
  REFLECTION_OPTIONS,
  REGIONS,
  SCOUT_COUNT,
  SQUAD_LIMIT,
  SQUAD_RULE_LINES,
  TRANSFER_BUDGET,
  WAGE_SPACE,
  YOUTH_MIN,
  abilityReport,
  advanceToReflection,
  answerCounterfactual,
  assignScout,
  canSignCandidate,
  checkMicroList,
  checkRegistration,
  confirmReflection,
  confirmScout,
  confirmTactics,
  createSquadState,
  evaluateGoals,
  evaluateRegistration,
  feeUsed,
  finishMicroTeaching,
  finishSigning,
  formatSquadFee,
  formatSquadWage,
  inspectMicroList,
  isSquadComplete,
  regionKnowledge,
  remainingBudget,
  remainingWage,
  restartRun,
  requiredSignings,
  reviveSquadState,
  scoutAssignmentsTotal,
  setMatchDecision,
  setOutOfPossessionShape,
  setPossessionShape,
  setSquadModule,
  signCandidate,
  skipReflection,
  skipTactics,
  squadSummaryLines,
  startFlow,
  startMicroTeaching,
  unassignScout,
  wageUsed,
} from './logic';
import type { RegistrationResult, SquadActionResult, SquadModuleId, SquadState } from './logic';
import './squad.css';

const SQUAD_STEPS: PhaseStep[] = [
  { phase: 'commission', label: '接单' },
  { phase: 'faultPlay', label: '注册微教学' },
  { phase: 'repair', label: '维修' },
  { phase: 'verify', label: '名单流程' },
  { phase: 'transfer', label: '结算反思' },
  { phase: 'summary', label: '归档' },
];

const MODULE_ALIAS: Record<SquadModuleId, string> = {
  tactics: 'tactics-shapes',
  scouting: 'scout-network',
  transfers: 'transfer-negotiation',
  registration: 'squad-registration',
};

const MODULE_LABELS: Record<SquadModuleId, string> = {
  tactics: '双形态战术',
  scouting: '球探网络',
  transfers: '转会谈判',
  registration: '阵容注册',
};

const FLOW_STEPS: { id: SquadState['step']; label: string }[] = [
  { id: 'scout', label: '① 球探考察' },
  { id: 'transfer', label: '② 转会签约' },
  { id: 'tactics', label: '③ 战术决策' },
  { id: 'registration', label: '④ 注册检查' },
];

function RegistrationChecklist({ result }: { result: RegistrationResult }) {
  return (
    <div className={`squad-checklist${result.enabled ? '' : ' is-degraded'}`}>
      <p className="squad-checklist-note">
        {result.note}
        {!result.enabled && <span className="squad-degraded-tag">退化规则</span>}
      </p>
      {result.enabled ? (
        <ul className="squad-checklist-list">
          {result.items.map((item) => (
            <li key={item.id} className={`squad-check${item.passed ? ' is-pass' : ' is-fail'}${item.skipped ? ' is-skipped' : ''}`}>
              <span className="squad-check-mark" aria-hidden="true">
                {item.skipped ? '≈' : item.passed ? '✓' : '✕'}
              </span>
              <span className="squad-check-label">{item.label}</span>
              <span className="squad-check-value">
                {item.actual} / {item.required}
              </span>
              <span className="visually-hidden">{item.passed ? '通过' : '未通过'}</span>
              {item.detail && <p className="squad-check-detail">{item.detail}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="squad-muted">注册规则未启用：人数、青训、位置覆盖与工资都不检查，名单直接通过。</p>
      )}
    </div>
  );
}

function GoalsList({ state }: { state: SquadState }) {
  const goals = evaluateGoals(state);
  return (
    <ul className="squad-goal-list">
      {goals.map((goal) => (
        <li key={goal.id} className={`squad-goal${goal.achieved ? ' is-achieved' : ''}`}>
          <span className="squad-goal-mark" aria-hidden="true">
            {goal.achieved ? '✓' : '○'}
          </span>
          <div>
            <p className="squad-goal-title">{goal.title}</p>
            <p className="squad-goal-detail">{goal.detail}</p>
          </div>
          <Chip tone={goal.achieved ? 'green' : 'neutral'}>{goal.achieved ? '已达成' : '未达成'}</Chip>
        </li>
      ))}
    </ul>
  );
}

function SettlementContent({ state }: { state: SquadState }) {
  const registration = state.registration ?? evaluateRegistration(state);
  const signed = state.signings
    .map((id) => CANDIDATE_SEEDS.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is (typeof CANDIDATE_SEEDS)[number] => Boolean(candidate));
  const knowledgeById = new Map(
    state.signings.map((id) => {
      const candidate = state.candidates.find((item) => item.id === id);
      return [id, candidate ? regionKnowledge(state, candidate.region) : 0];
    }),
  );
  return (
    <div className="squad-settlement">
      <div className="squad-stat-row">
        <StatTile label="名单人数" value={`${registration.total} / ${SQUAD_LIMIT}`} hint={`现有 ${BASE_SQUAD_TOTAL} 人 + 新援 ${state.signings.length} 人`} />
        <StatTile label="本土青训" value={`${registration.youth} / ${YOUTH_MIN}`} tone={registration.youth >= YOUTH_MIN ? 'green' : 'red'} />
        <StatTile label="转会预算使用" value={formatSquadFee(feeUsed(state))} hint={`上限 ${formatSquadFee(TRANSFER_BUDGET)}`} />
        <StatTile label="周薪使用" value={formatSquadWage(wageUsed(state))} hint={`上限 ${formatSquadWage(WAGE_SPACE)}`} tone={wageUsed(state) <= WAGE_SPACE ? 'green' : 'red'} />
      </div>

      <section className="squad-subsection">
        <h3 className="squad-subtitle">注册检查表</h3>
        <RegistrationChecklist result={registration} />
      </section>

      <section className="squad-subsection">
        <h3 className="squad-subtitle">三项目标证据</h3>
        <GoalsList state={state} />
      </section>

      <section className="squad-subsection">
        <h3 className="squad-subtitle">球探考察记录</h3>
        <ComparisonTable
          head={['区域', '球探人数', '知识度', '报告精度']}
          rows={REGIONS.map((region) => {
            const knowledge = regionKnowledge(state, region.id);
            return [
              region.name,
              state.modules.scouting ? state.scouts.assignments[region.id] : '—',
              state.modules.scouting ? knowledge : '100（信息全开）',
              state.modules.scouting
                ? knowledge <= 0
                  ? '没有报告'
                  : knowledge >= 90
                    ? '区间 ±2'
                    : '区间 ±6'
                : '精确值（退化）',
            ];
          })}
        />
      </section>

      <section className="squad-subsection">
        <h3 className="squad-subtitle">真实签约记录</h3>
        {signed.length === 0 ? (
          <EmptyState title="这次没有签下任何球员">重开本局后才能再次进入转会阶段。</EmptyState>
        ) : (
          <ComparisonTable
            head={['球员', '位置', '区域', '青训', '转会费', '周薪', '选择依据']}
            rows={signed.map((candidate) => {
              const knowledge = knowledgeById.get(candidate.id) ?? 0;
              return [
                candidate.name,
                POSITION_LABELS[candidate.position],
                REGIONS.find((region) => region.id === candidate.region)?.name ?? candidate.region,
                candidate.youth ? '是' : '否',
                formatSquadFee(candidate.transferFee),
                formatSquadWage(candidate.wage),
                knowledge >= 100 ? '信息全开（退化）' : knowledge > 0 ? `知识度 ${knowledge} 的区间报告` : '未考察，盲目签约',
              ];
            })}
          />
        )}
      </section>

      <section className="squad-subsection">
        <h3 className="squad-subtitle">战术与比赛阶段</h3>
        {state.modules.tactics ? (
          <ul className="squad-tactics-summary">
            <li>有球形态：{POSSESSION_PRESETS.find((preset) => preset.id === state.tactics.possessionId)?.name ?? '未设置'}</li>
            <li>无球形态：{OUT_PRESETS.find((preset) => preset.id === state.tactics.outId)?.name ?? '未设置'}</li>
            <li>比赛阶段决策：{MATCH_DECISIONS.find((preset) => preset.id === state.tactics.decisionId)?.name ?? '未设置'}</li>
          </ul>
        ) : (
          <p className="squad-muted">双形态战术未启用：只有一套站位打满全场（退化规则）。</p>
        )}
        {state.tactics.matchReport && <p className="squad-match-report">{state.tactics.matchReport}</p>}
      </section>

      <section className="squad-subsection">
        <h3 className="squad-subtitle">模块状态</h3>
        <ul className="squad-module-summary">
          {(Object.keys(MODULE_LABELS) as SquadModuleId[]).map((id) => (
            <li key={id}>
              <Chip tone={state.modules[id] ? 'green' : 'amber'}>{state.modules[id] ? '已启用' : '已关闭'}</Chip>
              <span>{MODULE_LABELS[id]}</span>
              {!state.modules[id] && <span className="squad-muted">{MODULE_DEGRADE_NOTES[id]}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="squad-subsection">
        <h3 className="squad-subtitle">真实操作记录</h3>
        <EventLogList entries={state.eventLog} maxHeight={260} />
      </section>
    </div>
  );
}

export function SquadLevel({
  level,
  mode,
  fastStart,
  showcaseOptions,
  savedState,
  onSaveState,
  onComplete,
  onExit,
}: LevelScreenProps) {
  const [state, setState] = useState<SquadState>(() => {
    const restored = reviveSquadState(savedState);
    if (restored) return restored;
    return createSquadState({
      mode,
      seed: showcaseOptions?.seed ?? randomSeed(),
      fastStart,
      showcaseOptions,
    });
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [reflectionChoice, setReflectionChoice] = useState<string | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);

  const saveStateRef = useRef(onSaveState);
  saveStateRef.current = onSaveState;
  useEffect(() => {
    saveStateRef.current(state);
  }, [state]);

  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const completedRef = useRef(false);
  useEffect(() => {
    if (state.phase !== 'summary' || completedRef.current) return;
    if (!isSquadComplete(state)) return;
    completedRef.current = true;
    completeRef.current({ evidence: state.evidence, summary: squadSummaryLines(state) });
  }, [state]);

  function apply(result: SquadActionResult) {
    if (!result.ok) {
      setNotice(result.reason ?? '这个操作现在不可用。');
      return;
    }
    setNotice(null);
    setState(result.state);
  }

  const complete = isSquadComplete(state);
  const registration = state.registration ?? evaluateRegistration(state);
  const showRegistrationChecklist = state.step === 'registration' || state.phase === 'transfer' || state.phase === 'summary';
  const goalList = evaluateGoals(state);

  const phaseSteps = SQUAD_STEPS;
  const sideContent = (
    <>
      {mode === 'showcase' && (
        <Panel title="演示模式" tone="amber">
          <p className="squad-muted">
            固定种子 {showcaseOptions?.seed ?? '—'}；{state.fastPlay ? '短局参数：签下 2 人、注册检查从简。' : '完整流程。'}
          </p>
          {state.skippedReflection && <p className="squad-muted">本局已标注「演示跳过反事实与反思题」，不计入 transferred。</p>}
        </Panel>
      )}
      <Panel title="注册规则" subtitle="四个约束同时生效">
        <RuleList items={SQUAD_RULE_LINES.map((line) => ({ label: line.label, value: line.value }))} />
      </Panel>
      <Panel title="模块状态">
        <ul className="squad-side-modules">
          {(Object.keys(MODULE_LABELS) as SquadModuleId[]).map((id) => (
            <li key={id}>
              <Chip tone={state.modules[id] ? 'green' : 'amber'}>{state.modules[id] ? '已启用' : '已关闭'}</Chip>
              <span>{MODULE_LABELS[id]}</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="三项目标" actions={<Chip tone={goalList.every((goal) => goal.achieved) ? 'green' : 'neutral'}>
        {goalList.filter((goal) => goal.achieved).length} / 3
      </Chip>}>
        <ul className="squad-side-goals">
          {goalList.map((goal) => (
            <li key={goal.id} className={goal.achieved ? 'is-done' : ''}>
              <span aria-hidden="true">{goal.achieved ? '✓' : '○'}</span>
              <span>{goal.title.replace('目标', '目标 ')}</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="操作记录" actions={<Chip>{state.eventLog.length} 条</Chip>}>
        <EventLogList entries={state.eventLog} maxHeight={240} />
      </Panel>
    </>
  );

  return (
    <LevelWorkbench
      level={level}
      phase={state.phase}
      evidence={state.evidence}
      steps={phaseSteps}
      sideContent={sideContent}
    >
      {notice && (
        <Callout tone="red" title="这次操作没有生效" icon="⚠">
          {notice}
        </Callout>
      )}

      {state.phase === 'commission' && (
        <Panel title="委托：拼一张能过关的名单" subtitle="客户 韩森 · 俱乐部经理">
          <p>
            韩森凑了 25 个人，注册却被打回：本土青训不够、位置重叠、工资爆表。这一关要把
            双形态战术、球探网络、转会谈判与阵容注册拼进同一份名单。
          </p>
          <ul className="squad-objective-list">
            <li>先做一段可操作的注册微教学：两份 25 人名单为什么一份被退回。</li>
            <li>用 2 名球探考察 3 个区域，在预算与工资内签下球员。</li>
            <li>设置两套战术形态，跑完比赛阶段，最后让名单通过注册检查。</li>
          </ul>
          <p className="squad-muted">毕业关没有最低积分：只看三项目标是否有规则与真实操作证据。</p>
          <Button size="lg" onClick={() => apply(startMicroTeaching(state))}>
            开始注册微教学
          </Button>
        </Panel>
      )}

      {state.phase === 'faultPlay' && (
        <Panel title="注册微教学 · 两份 25 人名单" subtitle="先检查方案 A 与方案 B，再继续维修">
          <Callout tone="amber" title="为什么注册会让「收集强球员」变成「拼名单」" icon="⚠">
            注册规则不是只看总人数：它同时检查本土青训名额与位置覆盖。两名球员可以都是 80 能力，
            但一个能补青训缺口、另一个只会让某个位置更拥挤。
          </Callout>
          <div className="squad-micro-grid">
            {MICRO_LISTS.map((list) => {
              const checked = state.microChecks[list.id];
              const items = checkMicroList(list);
              const failed = items.filter((item) => !item.passed);
              return (
                <article className={`squad-micro-card${checked ? ' is-checked' : ''}`} key={list.id}>
                  <h3 className="squad-micro-title">{list.name}</h3>
                  <p className="squad-muted">{list.description}</p>
                  {checked ? (
                    <div className="squad-micro-result">
                      <p className={failed.length === 0 ? 'squad-micro-pass' : 'squad-micro-fail'}>
                        {failed.length === 0 ? '✓ 注册通过' : `✕ 注册未通过：${failed.length} 项缺口`}
                      </p>
                      <ul className="squad-micro-checks">
                        {items.map((item) => (
                          <li key={item.id} className={item.passed ? 'is-pass' : 'is-fail'}>
                            <span aria-hidden="true">{item.passed ? '✓' : '✕'}</span>
                            {item.label} {item.actual} / {item.required}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => apply(inspectMicroList(state, list.id))}>
                      检查{list.id === 'a' ? '方案 A' : '方案 B'}
                    </Button>
                  )}
                </article>
              );
            })}
          </div>
          <Button
            onClick={() => apply(finishMicroTeaching(state))}
            disabled={!state.microChecks.a || !state.microChecks.b}
          >
            完成微教学，进入维修
          </Button>
          {(!state.microChecks.a || !state.microChecks.b) && (
            <p className="squad-disabled-hint">先把方案 A 与方案 B 都检查一遍。</p>
          )}
        </Panel>
      )}

      {state.phase === 'repair' && (
        <Panel title="维修 · 四个系统一起装进名单" subtitle="正式名单流程开始后模块锁定，修改必须重开本局">
          <div className="squad-module-grid">
            {(Object.keys(MODULE_LABELS) as SquadModuleId[]).map((id) => {
              const definition = level.availableModules.find((item) => item.id === MODULE_ALIAS[id]);
              const installed = state.modules[id];
              return (
                <ModuleCard
                  key={id}
                  name={definition?.name ?? MODULE_LABELS[id]}
                  englishName={definition?.englishName}
                  summary={definition?.description ?? ''}
                  sideEffect={definition?.sideEffect}
                  installed={installed}
                  onToggle={() => apply(setSquadModule(state, id, !installed))}
                  badge={
                    <span className={`squad-module-badge${installed ? ' is-on' : ' is-off'}`}>
                      {installed ? '规则生效中' : `退化：${MODULE_DEGRADE_NOTES[id]}`}
                    </span>
                  }
                />
              );
            })}
          </div>
          <Callout tone="purple" title="三项目标需要哪些模块">
            目标一需要双形态战术，目标二需要球探网络，目标三需要阵容注册；转会谈判决定签约有没有预算与工资代价。
            关掉任一目标模块，结算时会标为未达成并需要重开本局。
          </Callout>
          {!(state.modules.tactics && state.modules.scouting && state.modules.registration) && (
            <Callout tone="amber" title="注意：目标模块还没有全部启用" icon="⚠">
              未启用：
              {[
                !state.modules.tactics ? '双形态战术（目标一）' : '',
                !state.modules.scouting ? '球探网络（目标二）' : '',
                !state.modules.registration ? '阵容注册（目标三）' : '',
              ]
                .filter(Boolean)
                .join('、')}
              。这样开始流程会体验退化规则，但这几项目标不会达成。
            </Callout>
          )}
          <div className="squad-actions">
            <Button onClick={() => apply(startFlow(state))}>开始正式名单流程</Button>
            <span className="squad-muted">开始后模块锁定，但可以先观察关闭模块的退化说明。</span>
          </div>
        </Panel>
      )}

      {state.phase === 'verify' && (
        <>
          <Panel title="名单流程" subtitle={`第 ${state.signings.length} / ${requiredSignings(state)} 签 · ${FLOW_STEPS.find((step) => step.id === state.step)?.label ?? ''}`}>
            <ol className="squad-flow-rail" aria-label="名单流程步骤">
              {FLOW_STEPS.map((step) => {
                const active = step.id === state.step;
                const done = FLOW_STEPS.findIndex((item) => item.id === step.id) < FLOW_STEPS.findIndex((item) => item.id === state.step);
                return (
                  <li key={step.id} className={`squad-flow-step${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}>
                    <span aria-hidden="true">{done ? '✓' : active ? '●' : '○'}</span>
                    {step.label}
                    {active && <span className="squad-flow-current">当前</span>}
                  </li>
                );
              })}
            </ol>

            {state.step === 'scout' && (
              <div className="squad-step-body">
                {!state.modules.scouting && (
                  <Callout tone="amber" title="球探网络未启用（退化）" icon="⚠">
                    所有候选能力瞬间完全公开，知识度恒为 100。没有「知识度不足的报告」，目标二不会达成。
                  </Callout>
                )}
                <p className="squad-muted">
                  你有 {SCOUT_COUNT} 名球探、3 个区域、1 轮考察。派往同一区域的球探越多，知识度越高；
                  知识度不足时报告只给区间，不会直接告诉精确能力。
                </p>
                <ul className="squad-region-grid">
                  {REGIONS.map((region) => {
                    const assigned = state.scouts.assignments[region.id];
                    const knowledge = regionKnowledge(state, region.id);
                    const candidates = state.candidates.filter((candidate) => candidate.region === region.id);
                    return (
                      <li key={region.id} className={`squad-region${assigned > 0 ? ' is-scouted' : ''}`}>
                        <header className="squad-region-head">
                          <div>
                            <p className="squad-region-name">{region.name}</p>
                            <p className="squad-muted">{region.description}</p>
                          </div>
                          <Chip tone={assigned > 0 ? 'green' : 'neutral'}>{assigned > 0 ? `球探 ${assigned}` : '未派遣'}</Chip>
                        </header>
                        <Meter
                          label={state.modules.scouting ? '知识度' : '知识度（退化 100）'}
                          value={state.modules.scouting ? knowledge : 100}
                          max={100}
                          tone={knowledge >= 90 ? 'green' : knowledge > 0 ? 'amber' : 'neutral'}
                          valueLabel={state.modules.scouting ? `${knowledge} / 100` : '100 / 100'}
                        />
                        <ul className="squad-region-candidates">
                          {candidates.map((candidate) => (
                            <li key={candidate.id}>
                              {candidate.name} · {POSITION_LABELS[candidate.position]}
                              {candidate.youth && <Chip tone="purple">青训</Chip>}
                            </li>
                          ))}
                        </ul>
                        {state.modules.scouting && (
                          <div className="squad-region-actions">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={scoutAssignmentsTotal(state) >= SCOUT_COUNT || state.scouts.confirmed}
                              onClick={() => apply(assignScout(state, region.id))}
                              aria-label={`派遣球探：${region.name}`}
                            >
                              派遣 1 名球探
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={assigned <= 0 || state.scouts.confirmed}
                              onClick={() => apply(unassignScout(state, region.id))}
                              aria-label={`撤回球探：${region.name}`}
                            >
                              撤回 1 名
                            </Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <div className="squad-actions">
                  <Button onClick={() => apply(confirmScout(state))} disabled={state.scouts.confirmed}>
                    {state.modules.scouting ? '完成 1 轮考察，进入转会' : '跳过考察（球探未启用），进入转会'}
                  </Button>
                  <span className="squad-muted">已派遣 {scoutAssignmentsTotal(state)} / {SCOUT_COUNT} 名球探。</span>
                </div>
              </div>
            )}

            {state.step === 'transfer' && (
              <div className="squad-step-body">
                <div className="squad-stat-row">
                  <StatTile label="可用转会预算" value={formatSquadFee(remainingBudget(state))} hint={`上限 ${formatSquadFee(TRANSFER_BUDGET)}`} tone={state.modules.transfers ? 'purple' : 'amber'} />
                  <StatTile label="可用周薪空间" value={formatSquadWage(remainingWage(state))} hint={`上限 ${formatSquadWage(WAGE_SPACE)}`} tone={state.modules.transfers ? 'purple' : 'amber'} />
                  <StatTile label="已签下" value={`${state.signings.length} / ${requiredSignings(state)}`} tone={state.signings.length >= requiredSignings(state) ? 'green' : 'neutral'} />
                </div>
                {!state.modules.transfers && (
                  <Callout tone="amber" title="转会谈判未启用（退化）" icon="⚠">
                    报价不受预算与工资限制，签下谁都不扣资源；注册检查仍会计算周薪总额。
                  </Callout>
                )}
                <ul className="squad-candidate-grid">
                  {state.candidates.map((candidate) => {
                    const report = abilityReport(state, candidate);
                    const signed = state.signings.includes(candidate.id);
                    const check = canSignCandidate(state, candidate.id);
                    return (
                      <li key={candidate.id} className={`squad-candidate${signed ? ' is-signed' : ''}`}>
                        <header className="squad-candidate-head">
                          <div>
                            <p className="squad-candidate-name">{candidate.name}</p>
                            <p className="squad-muted">
                              {POSITION_LABELS[candidate.position]} · {REGIONS.find((region) => region.id === candidate.region)?.name}
                            </p>
                          </div>
                          {candidate.youth ? <Chip tone="purple">本土青训</Chip> : <Chip tone="neutral">非青训</Chip>}
                        </header>
                        <p className={`squad-report${report.kind === 'exact' ? ' is-exact' : ''}`}>{report.text}</p>
                        <dl className="squad-candidate-facts">
                          <div>
                            <dt>转会费</dt>
                            <dd>{formatSquadFee(candidate.transferFee)}</dd>
                          </div>
                          <div>
                            <dt>周薪</dt>
                            <dd>{formatSquadWage(candidate.wage)}</dd>
                          </div>
                        </dl>
                        {signed ? (
                          <Chip tone="green" icon="✓">已签约</Chip>
                        ) : (
                          <Button size="sm" disabled={!check.ok} onClick={() => apply(signCandidate(state, candidate.id))}>
                            签下 {candidate.name}
                          </Button>
                        )}
                        {!signed && !check.ok && <p className="squad-disabled-hint">{check.reason}</p>}
                      </li>
                    );
                  })}
                </ul>
                <div className="squad-actions">
                  <Button onClick={() => apply(finishSigning(state))} disabled={state.signings.length === 0}>
                    结束签约，进入战术阶段
                  </Button>
                  <span className="squad-muted">
                    本次需要签下 {requiredSignings(state)} 人；少签会导致名单人数或目标不完整。
                  </span>
                </div>
              </div>
            )}

            {state.step === 'tactics' && (
              <div className="squad-step-body">
                {!state.modules.tactics ? (
                  <>
                    <Callout tone="amber" title="双形态战术未启用（退化）" icon="⚠">
                      只有一套站位打满全场，无法完成有球 / 无球两套形态与比赛阶段决策；目标一不会达成。
                    </Callout>
                    <Button onClick={() => apply(skipTactics(state))}>跳过战术阶段，进入注册检查</Button>
                  </>
                ) : (
                  <>
                    <PresetPicker
                      label="有球形态"
                      options={POSSESSION_PRESETS.map((preset) => ({ id: preset.id, name: preset.name, description: preset.description }))}
                      value={state.tactics.possessionId ?? '未选择'}
                      onChange={(id) => apply(setPossessionShape(state, id))}
                    />
                    <PresetPicker
                      label="无球形态"
                      options={OUT_PRESETS.map((preset) => ({ id: preset.id, name: preset.name, description: preset.description }))}
                      value={state.tactics.outId ?? '未选择'}
                      onChange={(id) => apply(setOutOfPossessionShape(state, id))}
                    />
                    <PresetPicker
                      label="比赛阶段决策（第 65 分钟，1-1）"
                      options={MATCH_DECISIONS.map((preset) => ({ id: preset.id, name: preset.name, description: preset.description }))}
                      value={state.tactics.decisionId ?? '未选择'}
                      onChange={(id) => apply(setMatchDecision(state, id))}
                    />
                    {state.tactics.possessionId && state.tactics.outId && state.tactics.decisionId && (
                      <p className="squad-tactics-preview">{state.tactics.matchReport ?? '提交后会显示这个比赛阶段的文字结果（不作为通关分数）。'}</p>
                    )}
                    <Button
                      onClick={() => apply(confirmTactics(state))}
                      disabled={!state.tactics.possessionId || !state.tactics.outId || !state.tactics.decisionId}
                    >
                      提交比赛阶段，进入注册检查
                    </Button>
                    {(!state.tactics.possessionId || !state.tactics.outId || !state.tactics.decisionId) && (
                      <p className="squad-disabled-hint">有球形态、无球形态与比赛阶段决策都选好后才能提交。</p>
                    )}
                  </>
                )}
              </div>
            )}

            {state.step === 'registration' && (
              <div className="squad-step-body">
                <p className="squad-muted">
                  名单会自动检查人数上限、本土青训、位置覆盖与工资空间；不满足时显示具体缺口。
                </p>
                {showRegistrationChecklist && <RegistrationChecklist result={registration} />}
                <GoalsList state={state} />
                <div className="squad-actions">
                  <Button onClick={() => apply(checkRegistration(state))} disabled={Boolean(state.registration)}>
                    {state.registration ? '已完成注册检查' : '运行注册检查'}
                  </Button>
                  {state.registration && state.registration.passed && (
                    <Button variant="secondary" onClick={() => apply(advanceToReflection(state))}>
                      进入结算与反思
                    </Button>
                  )}
                  {state.registration && (!state.registration.passed || state.signings.length < requiredSignings(state)) && (
                    <Button variant="secondary" onClick={() => setConfirmRestart(true)}>
                      重开本局，补目标
                    </Button>
                  )}
                </div>
                {state.registration && state.registration.passed && state.signings.length < requiredSignings(state) && (
                  <Callout tone="amber" title="签约人数不足" icon="⚠">
                    本次只签下 {state.signings.length} 人，目标是 {requiredSignings(state)} 人；operatedMechanic 证据不会成立。
                    可以重开本局补齐签约人数。
                  </Callout>
                )}
                {state.registration && !state.registration.passed && (
                  <Callout tone="red" title="名单没有通过注册检查" icon="✕">
                    {state.registration.items
                      .filter((item) => !item.passed)
                      .map((item) => `${item.label}：${item.actual} / ${item.required}`)
                      .join('；')}
                    。调整目标需要重开本局，模块与微教学会保留。
                  </Callout>
                )}
              </div>
            )}
          </Panel>
        </>
      )}

      {state.phase === 'transfer' && (
        <Panel title="结算与反思 · 名单背后的代价" subtitle="这里不评高分，只对照真实记录">
          {state.skippedReflection && (
            <Callout tone="amber" title="演示跳过反事实与反思题" icon="🎬">
              本局在展示模式下跳过了反事实题与反思题，evidence.transferred 保持为 false。
            </Callout>
          )}
          <SettlementContent state={state} />
          <section className="squad-subsection">
            <h3 className="squad-subtitle">反事实计算</h3>
            <p className="squad-muted">
              当前名单 {registration.total} 人、本土青训 {registration.youth} 人。假设这份名单的本土青训只有 7 人（差 1 人），
              而人数已经到达 {SQUAD_LIMIT} 人上限。
            </p>
            <QuizCard
              question="直接再签 1 名本土青训球员，注册能通过吗？需要先处理哪个名额？"
              options={COUNTERFACTUAL_OPTIONS}
              correctIds={[COUNTERFACTUAL_CORRECT_ID]}
              explanations={COUNTERFACTUAL_EXPLANATIONS}
              submitLabel="提交反事实计算"
              onResolved={() => apply(answerCounterfactual(state, COUNTERFACTUAL_CORRECT_ID))}
              initiallyResolved={state.counterfactualCorrect}
            />
          </section>
          <section className="squad-subsection">
            <h3 className="squad-subtitle">为什么注册规则会改变你的转会目标选择？</h3>
            <p className="squad-muted">没有唯一正确答案。选一条最接近你这次体验的解释，会得到针对性反馈。</p>
            <ul className="squad-reflection-list" role="radiogroup" aria-label="反思解释">
              {REFLECTION_OPTIONS.map((option) => {
                const selected = reflectionChoice === option.id;
                return (
                  <li key={option.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={`squad-reflection-option${selected ? ' is-selected' : ''}`}
                      onClick={() => setReflectionChoice(option.id)}
                    >
                      {option.label}
                    </button>
                    {selected && <p className="squad-reflection-feedback">{option.feedback}</p>}
                  </li>
                );
              })}
            </ul>
            <div className="squad-actions">
              <Button disabled={!reflectionChoice} onClick={() => reflectionChoice && apply(confirmReflection(state, reflectionChoice))}>
                确认这条解释并归档
              </Button>
              {mode === 'showcase' && (
                <Button variant="secondary" onClick={() => apply(skipReflection(state))}>
                  演示跳过反事实与反思题（不计 transferred）
                </Button>
              )}
            </div>
          </section>
        </Panel>
      )}

      {state.phase === 'summary' && (
        <Panel title="归档 · 赛季名单完成记录" subtitle="三项目标都只有规则与真实操作证据">
          {state.skippedReflection && (
            <Callout tone="amber" title="演示跳过反事实与反思题" icon="🎬">
              本局在展示模式下跳过了反思题，evidence.transferred 保持为 false；其他证据来自真实操作。
            </Callout>
          )}
          <SettlementContent state={state} />
          <section className="squad-subsection">
            <h3 className="squad-subtitle">三项目标总览</h3>
            <GoalsList state={state} />
          </section>
          <section className="squad-subsection">
            <h3 className="squad-subtitle">规则组合 / 真实操作 / 代价</h3>
            <ul className="squad-summary-lines">
              {squadSummaryLines(state).map((line) => (
                <li key={line.slice(0, 14)}>{line}</li>
              ))}
            </ul>
          </section>
          <Callout
            tone={complete ? 'green' : 'red'}
            title={complete ? '委托完成' : '还有目标没有达成'}
            icon={complete ? '✓' : '○'}
          >
            {complete
              ? '三项目标都有对应规则与操作证据，名单通过注册检查。可以完成归档。'
              : `未达成：${goalList
                  .filter((goal) => !goal.achieved)
                  .map((goal) => goal.title)
                  .join('、')}${state.signings.length < requiredSignings(state) ? `；签约人数 ${state.signings.length} / ${requiredSignings(state)}` : ''}。重开本局会清空名单流程成绩，但保留模块配置与微教学。`}
          </Callout>
          <div className="squad-actions">
            {!complete && (
              <Button variant="secondary" onClick={() => setConfirmRestart(true)}>
                重开本局，补目标
              </Button>
            )}
            <Button
              disabled={!complete}
              onClick={() => {
                if (!completedRef.current && isSquadComplete(state)) {
                  completedRef.current = true;
                  completeRef.current({ evidence: state.evidence, summary: squadSummaryLines(state) });
                }
                if (complete) onExit();
              }}
            >
              完成委托并返回修理铺
            </Button>
          </div>
        </Panel>
      )}

      <ConfirmDialog
        open={confirmRestart}
        title="重开本局？"
        description={
          <p>
            会清空本次名单流程的球探、签约、战术与注册成绩，并回到维修阶段；已启用的模块与注册微教学会保留。
            已有操作记录仍会留在日志里。
          </p>
        }
        confirmLabel="重开本局"
        tone="danger"
        onCancel={() => setConfirmRestart(false)}
        onConfirm={() => {
          setConfirmRestart(false);
          apply(restartRun(state));
        }}
      />
    </LevelWorkbench>
  );
}
