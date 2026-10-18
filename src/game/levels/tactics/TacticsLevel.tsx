import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ClubUpdate, LevelScreenProps } from '../../engine/types';
import { randomSeed } from '../../engine/rng';
import { LevelWorkbench } from '../../../components/Workbench';
import { ArrowFlow, Button, Callout, Chip, Meter, Panel, RuleList, StatTile } from '../../../components/Ui';
import { ModuleCard, PresetPicker } from '../../../components/ModulePanel';
import { QuizCard } from '../../../components/QuizCard';
import { ComparisonTable, EventLogList } from '../../../components/EventLogView';
import {
  DIAGNOSE_CORRECT_ID,
  DIAGNOSE_OPTIONS,
  FAULT_INSTRUCTIONS,
  FAULT_METRICS,
  FULLBACK_DUTY_OPTIONS,
  OUT_SHAPE_OPTIONS,
  OPPONENT_TENDENCY,
  PIVOT_DUTY_OPTIONS,
  POSSESSION_SHAPE_OPTIONS,
  TACTICS_MODULES,
  TACTICS_TARGETS,
  TRANSFER_CORRECT_IDS,
  TRANSFER_OPTIONS,
  VERIFY_INSTRUCTIONS,
  archiveBlockReason,
  attackSideName,
  buildArchiveSummary,
  buildClubUpdate,
  buildCompletionResult,
  buildInstructionMapping,
  buildTacticsComparison,
  canComplete,
  chooseFaultInstruction,
  chooseVerifyInstruction,
  completeArchive,
  createInitialTacticsState,
  evaluateTacticsVerification,
  faultInstructionName,
  faultTotals,
  formatMetricDelta,
  installTacticsModule,
  loadoutModuleNames,
  metricsSummary,
  openDiagnose,
  openSummary,
  openTransfer,
  protectionRiskLabel,
  requiredStages,
  resolveDiagnose,
  resolveTransfer,
  retryVerification,
  reviveTacticsState,
  selectFullbackDuty,
  selectOutShape,
  selectPivotDuty,
  selectPossessionShape,
  simulateFaultStages,
  skipTransferInShowcase,
  startFaultPlay,
  startRepair,
  startVerify,
  toggleTacticsModule,
  verificationMetrics,
  verifyInstructionName,
  verifyTotals,
} from './logic';
import type {
  FullbackDutyId,
  PivotDutyId,
  TacticsConfig,
  TacticsInitOptions,
  TacticsLoadout,
  TacticsMetrics,
  TacticsState,
  TargetCheck,
} from './logic';
import './tactics.css';

/* ==========================================================================
   关卡一《战术板》界面（v2：模块池 / 失败重试 / 决策可视化）。
   规则全部在 logic.ts，这里只负责把状态画出来。
   ========================================================================== */

const FORMATION_ROWS: Record<string, string[][]> = {
  '4-4-2': [
    ['门将'],
    ['左后卫', '左中卫', '右中卫', '右后卫'],
    ['左前卫', '左中场', '右中场', '右前卫'],
    ['左前锋', '右前锋'],
  ],
  '4-3-3': [
    ['门将'],
    ['左后卫', '左中卫', '右中卫', '右后卫'],
    ['左中场', '后腰', '右中场'],
    ['左边锋', '中锋', '右边锋'],
  ],
  '3-2-5': [
    ['门将'],
    ['左中卫', '中卫', '右中卫'],
    ['左后腰', '右后腰'],
    ['左边锋', '左中场', '中锋', '右中场', '右边锋'],
  ],
  '4-2-3-1': [
    ['门将'],
    ['左后卫', '左中卫', '右中卫', '右后卫'],
    ['左后腰', '右后腰'],
    ['左边锋', '前腰', '右边锋'],
    ['中锋'],
  ],
  '4-4-2-mid': [
    ['门将'],
    ['左后卫', '左中卫', '右中卫', '右后卫'],
    ['左前卫', '左中场', '右中场', '右前卫'],
    ['左前锋', '右前锋'],
  ],
  '4-1-4-1': [
    ['门将'],
    ['左后卫', '左中卫', '右中卫', '右后卫'],
    ['后腰'],
    ['左前卫', '左中场', '右中场', '右前卫'],
    ['中锋'],
  ],
  '5-3-2-low': [
    ['门将'],
    ['左翼卫', '左中卫', '中卫', '右中卫', '右翼卫'],
    ['左中场', '中场', '右中场'],
    ['左前锋', '右前锋'],
  ],
};

const OUT_SHAPE_LABELS: Record<string, string> = {
  '4-4-2-mid': '4-4-2 中位块',
  '4-1-4-1': '4-1-4-1',
  '5-3-2-low': '5-3-2 低位块',
};

const FULLBACK_NAME_RE = /边后卫|翼卫/;
const PIVOT_NAME_RE = /后腰/;

interface DutyDisplay {
  fullbackDuty: FullbackDutyId;
  pivotDuty: PivotDutyId;
}

interface PitchPlayer {
  name: string;
  fullback: boolean;
  pivot: boolean;
}

function formationRows(formationId: string): string[][] {
  return FORMATION_ROWS[formationId] ?? FORMATION_ROWS['4-4-2'];
}

/**
 * 职责要真的画在阵型图上：
 * - 后腰：单后腰只留 1 个点，双后腰显示 2 个点；
 * - 边后卫：套边 → 压上箭头 ↑，内收 → 进入中场的斜箭头 ↘。
 */
function buildPitchRows(formationId: string, duties?: DutyDisplay): PitchPlayer[][] {
  const rows = formationRows(formationId).map((row) =>
    row.map((name) => ({ name, fullback: FULLBACK_NAME_RE.test(name), pivot: PIVOT_NAME_RE.test(name) })),
  );
  if (!duties) return rows;
  const targetPivots = duties.pivotDuty === 'double' ? 2 : 1;
  return rows.map((row) => {
    const next = [...row];
    if (!next.some((player) => player.pivot)) return next;
    while (next.filter((player) => player.pivot).length > targetPivots) {
      const pivotIndexes = next.map((player, index) => (player.pivot ? index : -1)).filter((index) => index >= 0);
      next.splice(pivotIndexes[pivotIndexes.length - 1], 1);
    }
    while (next.filter((player) => player.pivot).length < targetPivots) {
      const pivotIndexes = next.map((player, index) => (player.pivot ? index : -1)).filter((index) => index >= 0);
      const insertAt = pivotIndexes.length > 0 ? pivotIndexes[0] + 1 : next.length;
      next.splice(insertAt, 0, { name: '后腰', fullback: false, pivot: true });
    }
    return next;
  });
}

function FormationPitch({
  formationId,
  label,
  tone,
  duties,
}: {
  formationId: string;
  label: string;
  tone: 'fault' | 'possession' | 'out';
  duties?: DutyDisplay;
}) {
  const rows = buildPitchRows(formationId, duties);
  return (
    <figure className={`tactics-pitch tactics-pitch-${tone}`}>
      <figcaption className="tactics-pitch-caption">{label}</figcaption>
      <div
        className="tactics-pitch-field"
        role="img"
        aria-label={`${label} 站位示意${duties ? `，边后卫${duties.fullbackDuty === 'overlap' ? '套边压上' : '内收'}，${duties.pivotDuty === 'double' ? '双后腰' : '单后腰'}` : ''}`}
      >
        {rows.map((row, rowIndex) => (
          <div className="tactics-pitch-row" key={rowIndex}>
            {row.map((player, index) => (
              <span
                className={`tactics-player${player.fullback ? ' is-fullback' : ''}${player.pivot ? ' is-pivot' : ''}${
                  player.fullback && duties ? ` duty-${duties.fullbackDuty}` : ''
                }`}
                key={`${rowIndex}-${index}`}
              >
                {player.fullback && duties && (
                  <span className={`tactics-duty-arrow is-${duties.fullbackDuty}`} aria-hidden="true">
                    {duties.fullbackDuty === 'overlap' ? '↑ 套边' : '↘ 内收'}
                  </span>
                )}
                <span className="tactics-player-dot" aria-hidden="true" />
                <span className="tactics-player-name">{player.name}</span>
                {player.pivot && duties && (
                  <span className="tactics-pivot-mark" aria-hidden="true">
                    {duties.pivotDuty === 'double' ? '×2' : '×1'}
                  </span>
                )}
              </span>
            ))}
          </div>
        ))}
      </div>
      {duties && (
        <p className="tactics-duty-legend">
          <span>{duties.fullbackDuty === 'overlap' ? '↑ 边后卫套边：压上提供宽度' : '↘ 边后卫内收：进入中场保护中路'}</span>
          <span>{duties.pivotDuty === 'double' ? '后腰 ×2：双后腰' : '后腰 ×1：单后腰'}</span>
        </p>
      )}
    </figure>
  );
}

const METRIC_ITEMS: { key: keyof TacticsMetrics; label: string; tone: 'purple' | 'green' | 'amber'; explain: string }[] = [
  {
    key: 'progression',
    label: '控球推进',
    tone: 'purple',
    explain: '越高越能制造机会；但它单独赢不了比赛。',
  },
  {
    key: 'wingProtection',
    label: '边路保护',
    tone: 'green',
    explain: '对手 60% 从右路来，这一项直接决定边路丢球。',
  },
  {
    key: 'centralProtection',
    label: '中路保护',
    tone: 'green',
    explain: '对手偶尔走中路，这一项决定禁区正面是否安全。',
  },
  {
    key: 'stamina',
    label: '体能消耗',
    tone: 'amber',
    explain: `两套形态与职责的真实代价；验证目标是不超过 ${TACTICS_TARGETS.staminaMax}。`,
  },
];

function MetricsGrid({ metrics, base = FAULT_METRICS }: { metrics: TacticsMetrics; base?: TacticsMetrics }) {
  return (
    <div className="tactics-metrics" aria-label="指标面板">
      {METRIC_ITEMS.map((item) => {
        const value = metrics[item.key];
        const delta = value - base[item.key];
        return (
          <div className="tactics-metric-card" key={item.key}>
            <div className="tactics-metric-head">
              <span className="tactics-metric-label">{item.label}</span>
              <strong className="tactics-metric-value">{value}</strong>
              <span className={`tactics-metric-delta${delta > 0 ? ' is-up' : delta < 0 ? ' is-down' : ''}`}>
                相对故障版 {formatMetricDelta(delta)}
              </span>
            </div>
            <Meter value={value} max={100} tone={item.tone} valueLabel={`${value} / 100`} />
            <p className="tactics-metric-explain">{item.explain}</p>
          </div>
        );
      })}
    </div>
  );
}

function TargetList({ targets }: { targets: TargetCheck[] }) {
  return (
    <ul className="tactics-targets" aria-label="验证目标">
      {targets.map((target) => (
        <li key={target.id} className={`tactics-target${target.met ? ' is-met' : ' is-missed'}`}>
          <span className="tactics-target-mark" aria-hidden="true">
            {target.met ? '✓' : '✗'}
          </span>
          <span className="tactics-target-body">
            <span className="tactics-target-label">{target.label}</span>
            <span className="tactics-target-detail">
              要求 {target.requirement} · 实际 {target.actual}
            </span>
          </span>
          <span className="visually-hidden">{target.met ? '已达成' : '未达成'}</span>
        </li>
      ))}
    </ul>
  );
}

function presetOptions<T extends string>(options: { id: T; name: string; description: string; metrics: TacticsMetrics }[]) {
  return options.map((option) => ({
    id: option.id,
    name: option.name,
    description: option.description,
    detail: metricsSummary(option.metrics),
  }));
}

function configRuleItems(config: TacticsConfig) {
  return [
    { label: '有球形态', value: config.possessionShape },
    { label: '无球形态', value: OUT_SHAPE_LABELS[config.outOfPossessionShape] ?? config.outOfPossessionShape },
    {
      label: '边后卫职责',
      value: FULLBACK_DUTY_OPTIONS.find((item) => item.id === config.fullbackDuty)?.name ?? config.fullbackDuty,
    },
    {
      label: '后腰职责',
      value: PIVOT_DUTY_OPTIONS.find((item) => item.id === config.pivotDuty)?.name ?? config.pivotDuty,
    },
  ];
}

function ModuleStatus({ loadout }: { loadout: TacticsLoadout }) {
  return (
    <ul className="tactics-module-status">
      {TACTICS_MODULES.map((module) => {
        const installed = loadout[module.slot] === module.id;
        return (
          <li key={module.id} className={installed ? 'is-installed' : ''}>
            <span aria-hidden="true">{installed ? '●' : '○'}</span>
            <span>{module.name}</span>
            <span className="tactics-module-tag">{module.correct ? '推荐' : '有副作用'}</span>
          </li>
        );
      })}
    </ul>
  );
}

function ClubUpdateBox({ update }: { update: ClubUpdate }) {
  return (
    <div className="tactics-club-update">
      <p className="tactics-club-headline">{update.headline}</p>
      <ul className="bullet-list">
        {update.details.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {update.nextBrief && <p className="tactics-club-next">下一份委托：{update.nextBrief}</p>}
    </div>
  );
}

export function TacticsLevel({ level, mode, fastStart, showcaseOptions, savedState, onSaveState, onComplete, onExit }: LevelScreenProps) {
  const [initialSeed] = useState<number>(() => showcaseOptions?.seed ?? randomSeed());
  const initOptions = useMemo<TacticsInitOptions>(
    () => ({ mode, fastStart, showcaseOptions }),
    [mode, fastStart, showcaseOptions],
  );
  const [state, setState] = useState<TacticsState>(
    () => reviveTacticsState(savedState, initOptions) ?? createInitialTacticsState(initOptions, initialSeed),
  );

  const saveRef = useRef(onSaveState);
  const completedRef = useRef(false);
  const baselineRef = useMemo(() => simulateFaultStages(state.fastPlay ? 2 : 3), [state.fastPlay]);

  useEffect(() => {
    saveRef.current = onSaveState;
  }, [onSaveState]);

  useEffect(() => {
    if (completedRef.current) return;
    saveRef.current(state);
  }, [state]);

  function apply(transform: (current: TacticsState) => TacticsState) {
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

  const stages = requiredStages(state);
  const metrics = verificationMetrics(state);
  const verification = evaluateTacticsVerification(state);
  const loadoutNames = loadoutModuleNames(state.loadout);
  const faultBase = state.fault.played.length > 0 ? faultTotals(state.fault.played) : faultTotals(baselineRef);
  const fixedTotals = verifyTotals(state.verify.results);
  const clubUpdate = buildClubUpdate(state);
  const dutyDisplay: DutyDisplay = {
    fullbackDuty: state.config.fullbackDuty,
    pivotDuty: state.config.pivotDuty,
  };

  const commissionPanel = (
    <Panel title="接单：一支只有一套站位的球队" subtitle={`${level.clientName} · ${level.clientRole}`} tone="purple">
      <Callout tone="amber" title="投诉原文" icon="🗣">
        {level.complaint}
      </Callout>
      <div className="tactics-split">
        <div className="tactics-split-side">
          <p className="tactics-brief-title">客户目标</p>
          <ul className="bullet-list">
            {level.teachingObjectives.map((objective) => (
              <li key={objective}>{objective}</li>
            ))}
          </ul>
          <ArrowFlow from="只有一套 4-4-2" to="控球与丢球后共用同一批位置" label="故障结构" />
        </div>
        <FormationPitch formationId="4-4-2" label="故障版唯一站位：4-4-2" tone="fault" />
      </div>
      <Callout tone="neutral" title="本关完成条件">
        {level.completionRequirements.join(' · ')}
      </Callout>
      <div className="tactics-actions">
        <Button size="lg" onClick={() => apply(startFaultPlay)}>
          开始故障试玩
        </Button>
      </div>
    </Panel>
  );

  const faultPanel = (
    <Panel
      title="故障试玩：固定一套 4-4-2"
      subtitle={state.fault.done ? '阶段的记录已经生成' : `第 ${state.fault.played.length + 1} / ${stages} 阶段`}
      tone="red"
    >
      <div className="tactics-split">
        <FormationPitch formationId="4-4-2" label="唯一的一套站位" tone="fault" />
        <div className="tactics-split-side">
          <p>
            这是一套固定的 4-4-2：控球时它就在这里，丢球后它仍然在这里。每个阶段你可以喊一条临场指令。
          </p>
          <div className="tactics-instruction-grid" role="group" aria-label="临场指令">
            {FAULT_INSTRUCTIONS.map((option) => (
              <Button
                key={option.id}
                variant="secondary"
                className="tactics-instruction"
                disabled={state.fault.done}
                onClick={() => apply((current) => chooseFaultInstruction(current, option.id))}
              >
                <span className="tactics-instruction-name">{option.name}</span>
                <span className="tactics-instruction-hint">{option.hint}</span>
              </Button>
            ))}
          </div>
          <p className="tactics-hint">三种指令都不会改变站位结构；注意看比赛记录里对手从哪一侧制造机会。</p>
        </div>
      </div>
      {state.fault.played.length > 0 && (
        <ComparisonTable
          head={['阶段', '临场指令', '我方机会', '对手机会', '对手边路机会', '失球']}
          rows={state.fault.played.map((result) => [
            `第 ${result.stage} 阶段`,
            faultInstructionName(result.instruction),
            `${result.ourChances} 次`,
            `${result.opponentChances} 次`,
            `${result.opponentWingChances} 次`,
            `${result.goalsAgainst} 个`,
          ])}
        />
      )}
      {state.fault.done && (
        <>
          <Callout tone="red" title="所有阶段的共同点" icon="⚠">
            无论怎么喊，前后场只有一套站位，边路空当始终存在。压上、平衡、回收只改变强度，不改变结构。
          </Callout>
          <div className="tactics-actions">
            <Button onClick={() => apply(openDiagnose)}>带着问题去诊断</Button>
          </div>
        </>
      )}
    </Panel>
  );

  const diagnosePanel = (
    <Panel title="诊断：问题出在哪条规则上？" subtitle="看刚才的比赛记录：每一阶段的边路机会都没有下降。">
      <QuizCard
        question="为什么临场指令救不了这条边路？"
        hint="判断是哪条规则导致了「边路空当始终存在」，而不是谁跑得不够。"
        options={DIAGNOSE_OPTIONS.map((option) => ({ id: option.id, label: option.label }))}
        correctIds={[DIAGNOSE_CORRECT_ID]}
        explanations={Object.fromEntries(DIAGNOSE_OPTIONS.map((option) => [option.id, option.explanation]))}
        wrongHint="提示：换指令、换球员、要求多跑，都没有改变「站位只有一套」这件事。"
        successText="对。控球和无球是两种不同的任务，需要两套站位与职责。下一步去维修台挑模块。"
        initiallyResolved={state.diagnose.resolved}
        onResolved={() => apply(resolveDiagnose)}
      />
      {state.diagnose.resolved && (
        <div className="tactics-actions">
          <Button onClick={() => apply(startRepair)}>开始维修</Button>
        </div>
      )}
    </Panel>
  );

  const repairPanel = (
    <Panel
      title="维修台：4 个模块自由配置"
      subtitle="两个槽位各二选一；也可以什么都不装、装错模块直接验证"
      tone="purple"
    >
      {state.fault.demoPreloaded && (
        <Callout tone="amber" title="演示从这里开始">
          故障记录取自同一套规则基线，玩家没有亲自试玩故障版，因此不会计入「体验故障」证据。
        </Callout>
      )}
      <div className="tactics-slots">
        {(['shape', 'attack'] as const).map((slot) => (
          <section className="tactics-slot" key={slot}>
            <p className="tactics-slot-title">{slot === 'shape' ? '形态模块（二选一）' : '职责 / 进攻模块（二选一）'}</p>
            <div className="tactics-slot-cards">
              {TACTICS_MODULES.filter((module) => module.slot === slot).map((module) => {
                const installed = state.loadout[slot] === module.id;
                return (
                  <ModuleCard
                    key={module.id}
                    name={`${module.name}${module.correct ? '' : ' · 错误模块'}`}
                    englishName={module.englishName}
                    summary={module.description}
                    sideEffect={module.sideEffect}
                    installed={installed}
                    badge={<span className="tactics-module-effect">{module.effect}</span>}
                    onToggle={() => apply((current) => toggleTacticsModule(current, module.id))}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <Callout tone="neutral" title="当前组合">
        已安装：{loadoutNames.length > 0 ? loadoutNames.join('、') : '没有模块'}。错误模块会真实改写下面的指标与验证结果；不需要它时点一下就能卸载。
      </Callout>
      {(state.loadout.shape !== 'dual-shape' || state.loadout.attack !== 'role-duties') && (
        <div className="tactics-quick-install">
          <p className="tactics-hint">推荐组合：双形态战术 + 职责分工。也可以不按推荐来，直接从上面的模块池里挑。</p>
          {state.loadout.shape !== 'dual-shape' && (
            <Button size="sm" variant="success" onClick={() => apply((current) => installTacticsModule(current, 'dual-shape'))}>
              安装双形态战术
            </Button>
          )}
          {state.loadout.attack !== 'role-duties' && (
            <Button size="sm" variant="success" onClick={() => apply((current) => installTacticsModule(current, 'role-duties'))}>
              安装职责分工
            </Button>
          )}
        </div>
      )}
      <div className="tactics-pickers">
        <PresetPicker
          label="有球形态（控球时）"
          options={presetOptions(POSSESSION_SHAPE_OPTIONS)}
          value={state.config.possessionShape}
          onChange={(id) => apply((current) => selectPossessionShape(current, id))}
          disabled={state.loadout.shape !== 'dual-shape'}
          disabledHint="先安装「双形态战术」，阵型选择才会在验证里生效。"
        />
        <PresetPicker
          label="无球形态（丢球后）"
          options={presetOptions(OUT_SHAPE_OPTIONS)}
          value={state.config.outOfPossessionShape}
          onChange={(id) => apply((current) => selectOutShape(current, id))}
          disabled={state.loadout.shape !== 'dual-shape'}
          disabledHint="先安装「双形态战术」，阵型选择才会在验证里生效。"
        />
        <PresetPicker
          label="边后卫职责"
          options={presetOptions(FULLBACK_DUTY_OPTIONS)}
          value={state.config.fullbackDuty}
          onChange={(id) => apply((current) => selectFullbackDuty(current, id))}
          disabled={state.loadout.attack !== 'role-duties'}
          disabledHint="先安装「职责分工」，职责才会在验证里生效。"
        />
        <PresetPicker
          label="后腰职责"
          options={presetOptions(PIVOT_DUTY_OPTIONS)}
          value={state.config.pivotDuty}
          onChange={(id) => apply((current) => selectPivotDuty(current, id))}
          disabled={state.loadout.attack !== 'role-duties'}
          disabledHint="先安装「职责分工」，职责才会在验证里生效。"
        />
      </div>
      <div className="tactics-pitch-pair">
        <FormationPitch
          formationId={state.loadout.shape === 'dual-shape' ? state.config.possessionShape : '4-4-2'}
          label={state.loadout.shape === 'dual-shape' ? `有球形态 · ${state.config.possessionShape}` : '未安装双形态：只有 4-4-2'}
          tone="possession"
          duties={state.loadout.attack === 'role-duties' ? dutyDisplay : undefined}
        />
        <FormationPitch
          formationId={state.loadout.shape === 'dual-shape' ? state.config.outOfPossessionShape : '4-4-2'}
          label={state.loadout.shape === 'dual-shape' ? `无球形态 · ${OUT_SHAPE_LABELS[state.config.outOfPossessionShape] ?? state.config.outOfPossessionShape}` : '未安装双形态：只有 4-4-2'}
          tone="out"
          duties={state.loadout.attack === 'role-duties' ? dutyDisplay : undefined}
        />
      </div>
      <MetricsGrid metrics={metrics} />
      <Callout tone="amber" title="取舍与代价">
        边路保护越高，通常推进与体能代价越大；人盯人和长传冲吊会让结果真实变差。验证目标：机会≥{stages * TACTICS_TARGETS.chancesPerStage}、失球≤
        {TACTICS_TARGETS.goalsAgainstMax}、边路丢球≤{TACTICS_TARGETS.wingGoalsAgainstMax}、体能≤{TACTICS_TARGETS.staminaMax}。
      </Callout>
      <div className="tactics-actions">
        <Button onClick={() => apply(startVerify)}>
          {state.verify.attempts > 0 ? `重新验证（第 ${state.verify.attempts + 1} 次尝试）` : '开始验证'}
        </Button>
      </div>
    </Panel>
  );

  const verifyPanel = (
    <Panel
      title="验证：修复版比赛"
      subtitle={
        state.verify.done
          ? verification.passed
            ? '比赛结束：目标全部达成'
            : '比赛结束：有目标没达成，可以回到维修台重新配置'
          : `第 ${state.verify.results.length + 1} / ${stages} 阶段`
      }
      tone={state.verify.done && !verification.passed ? 'amber' : 'green'}
    >
      <div className="tactics-config-chips">
        <Chip tone="purple">
          {state.loadout.shape === 'dual-shape'
            ? `有球 ${state.config.possessionShape}`
            : state.loadout.shape === 'man-marking'
              ? '全场人盯人（错误模块）'
              : '形态模块：未安装'}
        </Chip>
        <Chip tone="purple">
          {state.loadout.shape === 'dual-shape'
            ? `无球 ${OUT_SHAPE_LABELS[state.config.outOfPossessionShape] ?? state.config.outOfPossessionShape}`
            : state.loadout.shape === 'man-marking'
              ? '边路保护 −30'
              : '只有一套 4-4-2'}
        </Chip>
        <Chip tone="green">
          {state.loadout.attack === 'role-duties'
            ? `边后卫${FULLBACK_DUTY_OPTIONS.find((item) => item.id === state.config.fullbackDuty)?.name ?? ''}`
            : state.loadout.attack === 'long-ball'
              ? '长传冲吊（错误模块）'
              : '职责模块：未安装'}
        </Chip>
        <Chip tone="green">
          {state.loadout.attack === 'role-duties'
            ? `后腰${PIVOT_DUTY_OPTIONS.find((item) => item.id === state.config.pivotDuty)?.name ?? ''}`
            : state.loadout.attack === 'long-ball'
              ? '每阶段少 1 次机会'
              : '没有职责分工'}
        </Chip>
      </div>
      {state.fault.demoPreloaded && (
        <Callout tone="amber" title="演示从验证开始">
          故障记录取自同一套规则基线，玩家没有亲自试玩故障版，因此不会计入「体验故障」证据。
        </Callout>
      )}
      <div className="tactics-pitch-pair">
        <FormationPitch
          formationId={state.loadout.shape === 'dual-shape' ? state.config.possessionShape : '4-4-2'}
          label={state.loadout.shape === 'dual-shape' ? `有球形态 · ${state.config.possessionShape}` : '形态模块未生效：4-4-2'}
          tone="possession"
          duties={state.loadout.attack === 'role-duties' ? dutyDisplay : undefined}
        />
        <FormationPitch
          formationId={state.loadout.shape === 'dual-shape' ? state.config.outOfPossessionShape : '4-4-2'}
          label={state.loadout.shape === 'dual-shape' ? `无球形态 · ${OUT_SHAPE_LABELS[state.config.outOfPossessionShape] ?? state.config.outOfPossessionShape}` : '形态模块未生效：4-4-2'}
          tone="out"
          duties={state.loadout.attack === 'role-duties' ? dutyDisplay : undefined}
        />
      </div>
      <MetricsGrid metrics={metrics} />
      <Callout tone="amber" title="对手固定倾向与阶段指令的对应">
        对手倾向：{OPPONENT_TENDENCY.map((item) => `${item.label} ${item.chance}%`).join(' · ')}。下表是每条阶段指令对三路的保护值（保护越高越安全）。
      </Callout>
      <ComparisonTable
        head={['阶段指令', '右路 60%', '中路 20%', '左路 20%', '这条指令在做什么']}
        rows={buildInstructionMapping(state).map((row) => [
          row.name,
          `${row.rightProtection}（${protectionRiskLabel(row.rightProtection)}）`,
          `${row.centerProtection}（${protectionRiskLabel(row.centerProtection)}）`,
          `${row.leftProtection}（${protectionRiskLabel(row.leftProtection)}）`,
          row.note,
        ])}
      />
      {!state.verify.done && (
        <div className="tactics-instruction-grid" role="group" aria-label="阶段指令">
          {VERIFY_INSTRUCTIONS.map((option) => (
            <Button
              key={option.id}
              variant="secondary"
              className="tactics-instruction"
              disabled={state.verify.done}
              onClick={() => apply((current) => chooseVerifyInstruction(current, option.id))}
            >
              <span className="tactics-instruction-name">{option.name}</span>
              <span className="tactics-instruction-hint">{option.hint}</span>
            </Button>
          ))}
        </div>
      )}
      {state.verify.results.length > 0 && (
        <ComparisonTable
          head={['阶段', '阶段指令', '对手进攻方向', '我方机会', '失球', '边路丢球']}
          rows={state.verify.results.map((result) => [
            `第 ${result.stage} 阶段`,
            verifyInstructionName(result.instruction),
            attackSideName(result.attackSide),
            `${result.chancesFor} 次`,
            `${result.goalsAgainst} 个`,
            `${result.wingGoalsAgainst} 个`,
          ])}
        />
      )}
      {state.verify.done && (
        <>
          <p className="tactics-target-title">验证目标（{verification.targets.filter((target) => target.met).length} / {verification.targets.length} 达成）</p>
          <TargetList targets={verification.targets} />
          {verification.passed ? (
            <>
              <ComparisonTable
                head={['对比项', '故障版（一套形态）', '修复版（双形态）']}
                rows={buildTacticsComparison(state).map((row) => [row.label, row.fault, row.fixed])}
              />
              <Callout tone="green" title="双形态的收益与代价">
                收益：失球 {faultBase.goalsAgainst} → {fixedTotals.goalsAgainst}，边路丢球 {faultBase.wingGoalsAgainst} →{' '}
                {fixedTotals.wingGoalsAgainst}。代价：体能消耗 {FAULT_METRICS.stamina} → {metrics.stamina}，两套形态切换需要训练。
              </Callout>
              <div className="tactics-actions">
                <Button onClick={() => apply(openTransfer)}>完成验证，去迁移</Button>
              </div>
            </>
          ) : (
            <>
              <Callout tone="red" title="验证未达成" icon="⚠">
                未达成：{verification.failed.map((target) => `${target.label}（${target.actual}，要求 ${target.requirement}）`).join('；')}。
                点击下面的按钮清空本轮验证成绩，保留故障证据，回到维修台重新配置模块或阵型。
              </Callout>
              <div className="tactics-actions">
                <Button onClick={() => apply(retryVerification)}>回到维修台重新配置</Button>
              </div>
            </>
          )}
        </>
      )}
    </Panel>
  );

  const transferPanel = (
    <Panel title="迁移：换一支球队也要能判断" subtitle="新情境：对手改打三中卫，另一支球队需要同时设置控球与无球方案。">
      <QuizCard
        question="要把「双形态战术」完整搬过去，必须同时搬哪几样？"
        hint="多选。这不是问球员能力，而是问这个结构由哪些部分组成。"
        options={TRANSFER_OPTIONS.map((option) => ({ id: option.id, label: option.label }))}
        correctIds={TRANSFER_CORRECT_IDS}
        explanations={Object.fromEntries(TRANSFER_OPTIONS.map((option) => [option.id, option.explanation]))}
        multiSelect
        wrongHint="提示：找「站位」和「职责」相关的选项；球员总评、主场气氛、换人名额都不是形态结构。"
        successText="对。有球形态、无球形态与职责分工三样一起搬，双形态才成立。"
        initiallyResolved={state.transfer.resolved}
        onResolved={() => apply(resolveTransfer)}
      />
      {state.transfer.resolved && (
        <div className="tactics-actions">
          <Button onClick={() => apply(openSummary)}>进入归档</Button>
        </div>
      )}
      {mode === 'showcase' && !state.transfer.resolved && (
        <div className="tactics-skip">
          <Callout tone="amber" title="演示跳过迁移题">
            展示模式允许直接跳过迁移题；跳过后仍可完成演示，但 evidence.transferred 会保持 false，「迁移」证据不计入。
          </Callout>
          <Button variant="secondary" onClick={() => apply(skipTransferInShowcase)}>
            演示跳过迁移题
          </Button>
        </div>
      )}
    </Panel>
  );

  const summaryPanel = (
    <Panel title="归档：双形态战术" subtitle="这里只展示真实做过的操作和真实比赛记录" tone="green">
      {state.transfer.skipped && (
        <Callout tone="amber" title="演示跳过迁移题">
          本次不计「迁移」证据，演示仍可完成。
        </Callout>
      )}
      <div className="tactics-stat-grid">
        <StatTile label="故障版失球" value={`${faultBase.goalsAgainst} 个`} hint={`${state.fault.played.length} 个阶段，一套 4-4-2`} tone="red" />
        <StatTile label="修复版失球" value={`${fixedTotals.goalsAgainst} 个`} hint={`${state.verify.results.length} 个阶段，双形态 + 职责`} tone="green" />
        <StatTile
          label="边路丢球变化"
          value={`${faultBase.wingGoalsAgainst} → ${fixedTotals.wingGoalsAgainst}`}
          hint="故障版 → 修复版"
          tone="purple"
        />
        <StatTile label="体能消耗" value={`${metrics.stamina}`} hint={`故障版 ${FAULT_METRICS.stamina}，目标上限 ${TACTICS_TARGETS.staminaMax}`} tone="amber" />
      </div>
      <p className="tactics-target-title">验证目标（全部达成）</p>
      <TargetList targets={verification.targets} />
      <ComparisonTable
        head={['对比项', '故障版（一套形态）', '修复版（双形态）']}
        rows={buildTacticsComparison(state).map((row) => [row.label, row.fault, row.fixed])}
      />
      <RuleList items={configRuleItems(state.config)} />
      <ol className="tactics-summary-list">
        {buildArchiveSummary(state).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <Callout tone="purple" title="写入俱乐部时间线（真实数据）">
        <ClubUpdateBox update={clubUpdate} />
      </Callout>
      <div className="tactics-actions">
        <Button size="lg" onClick={finishArchive} disabled={!canComplete(state)}>
          完成归档，返回修理铺
        </Button>
        {!canComplete(state) && <span className="tactics-hint">{archiveBlockReason(state)}</span>}
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
      <Panel title="维修模块" subtitle="4 个模块，两个槽位各二选一；点击安装/卸载。">
        <ModuleStatus loadout={state.loadout} />
        {loadoutNames.length > 0 && <p className="tactics-hint">当前：{loadoutNames.join('、')}</p>}
        {state.verify.attempts > 0 && <p className="tactics-hint">已重新验证 {state.verify.attempts} 次。</p>}
      </Panel>
      {(state.phase === 'verify' || state.phase === 'transfer' || state.phase === 'summary') && (
        <Panel title="验证目标" subtitle="归档前必须全部达成。">
          <TargetList targets={verification.targets} />
        </Panel>
      )}
      <Panel title="操作记录" subtitle="对比与归档只读这份真实日志。">
        <EventLogList entries={state.eventLog} maxHeight={320} emptyText="还没有操作记录。先完成故障试玩。" />
      </Panel>
    </>
  );

  return (
    <LevelWorkbench level={level} phase={state.phase} evidence={state.evidence} sideContent={sideContent}>
      {mode === 'showcase' && (
        <Callout tone="amber" title="演示模式">
          固定种子 {state.seed}，短局参数 {state.fastPlay ? '开启（2 个阶段）' : '关闭（3 个阶段）'}。本页不写入正式进度。
        </Callout>
      )}
      {mainContent}
    </LevelWorkbench>
  );
}
