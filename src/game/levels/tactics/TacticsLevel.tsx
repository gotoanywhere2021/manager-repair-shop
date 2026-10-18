import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LevelScreenProps } from '../../engine/types';
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
  TRANSFER_CORRECT_IDS,
  TRANSFER_OPTIONS,
  VERIFY_INSTRUCTIONS,
  attackSideName,
  buildArchiveSummary,
  buildCompletionResult,
  buildTacticsComparison,
  canComplete,
  chooseFaultInstruction,
  chooseVerifyInstruction,
  completeArchive,
  createInitialTacticsState,
  faultInstructionName,
  faultTotals,
  formatMetricDelta,
  installDualShape,
  installRoleDuties,
  metricsSummary,
  openDiagnose,
  openSummary,
  openTransfer,
  requiredStages,
  resolveDiagnose,
  resolveTransfer,
  reviveTacticsState,
  selectFullbackDuty,
  selectOutShape,
  selectPivotDuty,
  selectPossessionShape,
  shapeMetrics,
  simulateFaultStages,
  skipTransferInShowcase,
  startFaultPlay,
  startRepair,
  startVerify,
  tacticsMetrics,
  verifyInstructionName,
  verifyTotals,
} from './logic';
import type { TacticsConfig, TacticsInitOptions, TacticsMetrics, TacticsState } from './logic';
import './tactics.css';

/* ==========================================================================
   关卡一《战术板》界面。规则全部在 logic.ts，这里只负责把状态画出来。
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

function formationRows(formationId: string): string[][] {
  return FORMATION_ROWS[formationId] ?? FORMATION_ROWS['4-4-2'];
}

function FormationPitch({ formationId, label, tone }: { formationId: string; label: string; tone: 'fault' | 'possession' | 'out' }) {
  const rows = formationRows(formationId);
  return (
    <figure className={`tactics-pitch tactics-pitch-${tone}`}>
      <figcaption className="tactics-pitch-caption">{label}</figcaption>
      <div
        className="tactics-pitch-field"
        role="img"
        aria-label={`${label} 站位示意，从后场到前场共有 ${rows.map((row) => row.length).join('、')} 名球员`}
      >
        {rows.map((row, rowIndex) => (
          <div className="tactics-pitch-row" key={rowIndex}>
            {row.map((player, index) => (
              <span className="tactics-player" key={`${rowIndex}-${index}`}>
                <span className="tactics-player-dot" aria-hidden="true" />
                <span className="tactics-player-name">{player}</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </figure>
  );
}

const METRIC_ITEMS: { key: keyof TacticsMetrics; label: string; tone: 'purple' | 'green' | 'amber' }[] = [
  { key: 'progression', label: '控球推进', tone: 'purple' },
  { key: 'wingProtection', label: '边路保护', tone: 'green' },
  { key: 'centralProtection', label: '中路保护', tone: 'green' },
  { key: 'stamina', label: '体能消耗', tone: 'amber' },
];

function MetricsGrid({ metrics, base }: { metrics: TacticsMetrics; base?: TacticsMetrics }) {
  return (
    <div className="tactics-metrics" aria-label="指标面板">
      {METRIC_ITEMS.map((item) => {
        const value = metrics[item.key];
        const valueLabel = base ? `${value}（${formatMetricDelta(value - base[item.key])}）` : `${value}`;
        return (
          <Meter
            key={item.key}
            label={item.label}
            value={value}
            max={100}
            tone={item.tone}
            valueLabel={valueLabel}
          />
        );
      })}
    </div>
  );
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

function presetOptions<T extends string>(options: { id: T; name: string; description: string; metrics: TacticsMetrics }[]) {
  return options.map((option) => ({
    id: option.id,
    name: option.name,
    description: option.description,
    detail: metricsSummary(option.metrics),
  }));
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

  // 每次状态变化保存真实状态；归档触发后不再回写，避免把完成状态又存回进度。
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
  const metrics = tacticsMetrics(state.config);
  const shapeOnly = shapeMetrics(state.config.possessionShape, state.config.outOfPossessionShape);
  const faultBase = state.fault.played.length > 0 ? faultTotals(state.fault.played) : faultTotals(baselineRef);
  const fixedTotals = verifyTotals(state.verify.results);

  const faultPanel = (
    <Panel
      title="故障试玩：固定一套 4-4-2"
      subtitle={state.fault.done ? '三个阶段的记录已经生成' : `第 ${state.fault.played.length + 1} / ${stages} 阶段`}
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
        successText="对。控球和无球是两种不同的任务，需要两套站位与职责。下一步去维修面板把它们装上。"
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

  let repairPanel: ReactNode = null;
  if (state.phase === 'repair') {
    repairPanel = (
      <Panel
        title={state.repairStep === 'shape' ? '第一次维修：安装双形态战术' : state.repairStep === 'duty' ? '第二次维修：安装职责分工' : '维修完成：两套形态与职责都已就位'}
        subtitle={state.repairStep === 'shape' ? '先决定有球时怎么站、丢球后怎么站' : state.repairStep === 'duty' ? '同一批球员，在两种阶段做不同的任务' : '准备好后进入验证'}
        tone="purple"
      >
        {state.fault.demoPreloaded && (
          <Callout tone="amber" title="演示从这里开始">
            故障记录取自同一套规则基线，玩家没有亲自试玩故障版，因此不会计入「体验故障」证据。
          </Callout>
        )}
        {state.repairStep === 'shape' && (
          <>
            <p>两套形态各管一个阶段。换选择会立即更新下面的指标，也会立刻显示代价。</p>
            <div className="tactics-pickers">
              <PresetPicker
                label="有球形态（控球时）"
                options={presetOptions(POSSESSION_SHAPE_OPTIONS)}
                value={state.config.possessionShape}
                onChange={(id) => apply((current) => selectPossessionShape(current, id))}
                disabled={state.installed.dualShape}
                disabledHint="双形态已经安装，本关不能再改阵型；需要重选请重玩本关。"
              />
              <PresetPicker
                label="无球形态（丢球后）"
                options={presetOptions(OUT_SHAPE_OPTIONS)}
                value={state.config.outOfPossessionShape}
                onChange={(id) => apply((current) => selectOutShape(current, id))}
                disabled={state.installed.dualShape}
                disabledHint="双形态已经安装，本关不能再改阵型；需要重选请重玩本关。"
              />
            </div>
            <MetricsGrid metrics={shapeOnly} />
            <Callout tone="amber" title="取舍">
              推进越强，通常意味着身后空间越大；保护越稳，通常意味着前场人数越少。没有一套站位能同时把两件事做到最好。
            </Callout>
            <div className="tactics-actions">
              <Button onClick={() => apply(installDualShape)} disabled={state.installed.dualShape}>
                安装双形态战术
              </Button>
            </div>
          </>
        )}
        {state.repairStep === 'duty' && (
          <>
            <div className="tactics-pitch-pair">
              <FormationPitch formationId={state.config.possessionShape} label={`有球形态 · ${state.config.possessionShape}`} tone="possession" />
              <FormationPitch
                formationId={state.config.outOfPossessionShape}
                label={`无球形态 · ${OUT_SHAPE_LABELS[state.config.outOfPossessionShape] ?? state.config.outOfPossessionShape}`}
                tone="out"
              />
            </div>
            <div className="tactics-pickers">
              <PresetPicker
                label="边后卫职责"
                options={presetOptions(FULLBACK_DUTY_OPTIONS)}
                value={state.config.fullbackDuty}
                onChange={(id) => apply((current) => selectFullbackDuty(current, id))}
                disabled={state.installed.roleDuties}
                disabledHint="职责分工已经安装，本关不能再改。"
              />
              <PresetPicker
                label="后腰职责"
                options={presetOptions(PIVOT_DUTY_OPTIONS)}
                value={state.config.pivotDuty}
                onChange={(id) => apply((current) => selectPivotDuty(current, id))}
                disabled={state.installed.roleDuties}
                disabledHint="职责分工已经安装，本关不能再改。"
              />
            </div>
            <MetricsGrid metrics={metrics} base={shapeOnly} />
            <Callout tone="amber" title="职责的代价">
              职责越激进，控球收益越高，丢球后的回防距离也越长；双后腰更稳，但会少一个前场接应点。
            </Callout>
            <div className="tactics-actions">
              <Button onClick={() => apply(installRoleDuties)} disabled={state.installed.roleDuties}>
                安装职责分工
              </Button>
            </div>
          </>
        )}
        {state.repairStep === 'done' && (
          <>
            <Callout tone="green" title="两个模块都已安装" icon="✓">
              双形态负责站位，职责分工负责任务。接下来用 3 个比赛阶段验证它们是否真的改变了丢球方式。
            </Callout>
            <div className="tactics-pitch-pair">
              <FormationPitch formationId={state.config.possessionShape} label={`有球形态 · ${state.config.possessionShape}`} tone="possession" />
              <FormationPitch
                formationId={state.config.outOfPossessionShape}
                label={`无球形态 · ${OUT_SHAPE_LABELS[state.config.outOfPossessionShape] ?? state.config.outOfPossessionShape}`}
                tone="out"
              />
            </div>
            <RuleList items={configRuleItems(state.config)} />
            <MetricsGrid metrics={metrics} base={FAULT_METRICS} />
            <Callout tone="neutral" title="代价">
              括号里是相对故障版 4-4-2 的变化。体能消耗上升是真实代价；收益只有在比赛记录里才算数。
            </Callout>
            <div className="tactics-actions">
              <Button onClick={() => apply(startVerify)}>开始验证</Button>
            </div>
          </>
        )}
      </Panel>
    );
  }

  const verifyPanel = (
    <Panel
      title="验证：修复版比赛"
      subtitle={state.verify.done ? `${stages} 个比赛阶段已结束` : `第 ${state.verify.results.length + 1} / ${stages} 阶段`}
      tone="green"
    >
      <div className="tactics-config-chips">
        <Chip tone="purple">有球 {state.config.possessionShape}</Chip>
        <Chip tone="purple">无球 {OUT_SHAPE_LABELS[state.config.outOfPossessionShape] ?? state.config.outOfPossessionShape}</Chip>
        <Chip tone="green">
          边后卫 {FULLBACK_DUTY_OPTIONS.find((item) => item.id === state.config.fullbackDuty)?.name ?? state.config.fullbackDuty}
        </Chip>
        <Chip tone="green">
          后腰 {PIVOT_DUTY_OPTIONS.find((item) => item.id === state.config.pivotDuty)?.name ?? state.config.pivotDuty}
        </Chip>
      </div>
      {state.fault.demoPreloaded && (
        <Callout tone="amber" title="演示从验证开始">
          故障记录取自同一套规则基线，玩家没有亲自试玩故障版，因此不会计入「体验故障」证据。
        </Callout>
      )}
      <div className="tactics-split">
        <div className="tactics-pitch-pair">
          <FormationPitch formationId={state.config.possessionShape} label={`有球形态 · ${state.config.possessionShape}`} tone="possession" />
          <FormationPitch
            formationId={state.config.outOfPossessionShape}
            label={`无球形态 · ${OUT_SHAPE_LABELS[state.config.outOfPossessionShape] ?? state.config.outOfPossessionShape}`}
            tone="out"
          />
        </div>
        <div className="tactics-split-side">
          <Callout tone="amber" title="对手固定倾向">
            {OPPONENT_TENDENCY.map((item) => `${item.label} ${item.chance}%`).join(' · ')}。阶段指令会改变对应一侧的保护数值，但结果仍有少量比赛波动。
          </Callout>
          <MetricsGrid metrics={metrics} base={FAULT_METRICS} />
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
        </div>
      </div>
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
          <ComparisonTable
            head={['对比项', '故障版（一套形态）', '修复版（双形态）']}
            rows={buildTacticsComparison(state).map((row) => [row.label, row.fault, row.fixed])}
          />
          <Callout tone="green" title="双形态的收益与代价">
            收益：丢球后保护数值从 {FAULT_METRICS.wingProtection} / {FAULT_METRICS.centralProtection} 提升到 {metrics.wingProtection} /{' '}
            {metrics.centralProtection}，边路丢球和失球都有机会下降。代价：体能消耗从 {FAULT_METRICS.stamina} 上升到{' '}
            {metrics.stamina}，两套形态切换需要训练；压上强侧能抢回主动，但会暂时放大身后的空间。
          </Callout>
          <div className="tactics-actions">
            <Button onClick={() => apply(openTransfer)}>完成验证，去迁移</Button>
          </div>
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
        <StatTile label="故障版失球" value={`${faultBase.goalsAgainst} 个`} hint="一套 4-4-2" tone="red" />
        <StatTile label="修复版失球" value={`${fixedTotals.goalsAgainst} 个`} hint="双形态 + 职责分工" tone="green" />
        <StatTile
          label="边路丢球变化"
          value={`${faultBase.wingGoalsAgainst} → ${fixedTotals.wingGoalsAgainst}`}
          hint="故障版 → 修复版"
          tone="purple"
        />
        <StatTile label="体能消耗" value={`${metrics.stamina}`} hint={`故障版 ${FAULT_METRICS.stamina}，这是代价`} tone="amber" />
      </div>
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
      <Callout tone="purple" title="核心问题">
        我改了哪条规则？它改变了什么选择？又产生了什么代价？
      </Callout>
      <div className="tactics-actions">
        <Button size="lg" onClick={finishArchive} disabled={!canComplete(state)}>
          完成归档，返回修理铺
        </Button>
        {!canComplete(state) && <span className="tactics-hint">先完成验证，再去迁移题答对，才能归档。</span>}
      </div>
    </Panel>
  );

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
      <Panel title="维修模块" subtitle="模块状态只反映真实安装记录，不是装饰。">
        <ModuleCard
          name="双形态战术"
          englishName="In & Out of Possession"
          summary="控球时与无球时各用一套阵型：有球形态负责推进与创造，无球形态负责保护与压迫。"
          sideEffect="两套形态切换需要训练与角色熟悉度；职责冲突会让球员在两套任务之间犹豫。"
          installed={state.installed.dualShape}
          badge={
            state.installed.dualShape
              ? `有球 ${state.config.possessionShape} · 无球 ${OUT_SHAPE_LABELS[state.config.outOfPossessionShape] ?? state.config.outOfPossessionShape}`
              : undefined
          }
        />
        <ModuleCard
          name="职责分工"
          englishName="Role Duties"
          summary="同一位置可以设置不同职责：边后卫套边或内收，后腰单人保护或双人保护。"
          sideEffect="职责越激进，控球收益越高，丢球后的回防距离也越长。"
          installed={state.installed.roleDuties}
          badge={
            state.installed.roleDuties
              ? `边后卫 ${FULLBACK_DUTY_OPTIONS.find((item) => item.id === state.config.fullbackDuty)?.name ?? state.config.fullbackDuty} · 后腰 ${PIVOT_DUTY_OPTIONS.find((item) => item.id === state.config.pivotDuty)?.name ?? state.config.pivotDuty}`
              : undefined
          }
        />
      </Panel>
      <Panel title="操作记录" subtitle="对比与归档只读这份真实日志。">
        <EventLogList entries={state.eventLog} maxHeight={360} emptyText="还没有操作记录。先完成故障试玩。" />
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
