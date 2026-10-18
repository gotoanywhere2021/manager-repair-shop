import { useEffect, useRef, useState } from 'react';
import type { LevelScreenProps } from '../../engine/types';
import { randomSeed } from '../../engine/rng';
import { LevelWorkbench } from '../../../components/Workbench';
import {
  ArrowFlow,
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
import { ModuleCard } from '../../../components/ModulePanel';
import { QuizCard } from '../../../components/QuizCard';
import { ComparisonTable, EventLogList } from '../../../components/EventLogView';
import {
  DIAGNOSE_CORRECT_ID,
  DIAGNOSE_EXPLANATIONS,
  DIAGNOSE_OPTIONS,
  RIVAL_HIJACK_AT,
  REWORK_COST,
  TRANSFER_FAULT_NOTE,
  TRANSFER_MODULE_IDS,
  TRANSFER_MODULE_POOL,
  TRANSFER_QUIZ_CORRECT_ID,
  TRANSFER_QUIZ_EXPLANATIONS,
  TRANSFER_QUIZ_OPTIONS,
  TRANSFER_RULE_LINES,
  advanceToTransfer,
  answerTransfer,
  archiveProblems,
  buildTransfersClubPatch,
  buildTransfersClubUpdate,
  budgetBase,
  budgetLimit,
  canWaitTarget,
  closeWindow,
  createTransfersState,
  directSign,
  finishFaultPlay,
  formatFee,
  formatWage,
  isGoalMet,
  missedTargets,
  offer,
  previewOffer,
  previewWait,
  reconfigure,
  requiredSignings,
  resolveDiagnosis,
  reviveTransfersState,
  reworkCostPaid,
  reworkCount,
  roundLimit,
  setModule,
  signedCount,
  signedPlayers,
  skipTransfer,
  startFaultPlay,
  startWindow,
  tierName,
  transfersComparison,
  transferSummaryLines,
  verificationValid,
  wageLimit,
  waitTarget,
} from './logic';
import type { TransferActionResult, TransferModuleId, TransfersState, TransferTier } from './logic';
import { canAdvanceToTransfer } from './logic';
import './transfers.css';

const TIERS: TransferTier[] = ['low', 'normal', 'high'];

function moduleInfo(level: LevelScreenProps['level'], id: TransferModuleId) {
  const pooled = TRANSFER_MODULE_POOL.find((module) => module.id === id);
  if (!pooled) return null;
  if (id === 'budget' || id === 'negotiation') {
    const definition = level.availableModules.find((item) => item.id === id);
    if (definition) {
      return {
        ...pooled,
        name: definition.name,
        englishName: definition.englishName,
        description: definition.description,
        sideEffect: definition.sideEffect ?? pooled.sideEffect,
      };
    }
  }
  return pooled;
}

function SettlementDetails({ state }: { state: TransfersState }) {
  const signed = signedPlayers(state);
  const missed = missedTargets(state);
  const problems = archiveProblems(state);
  const negotiationLog = state.eventLog.filter((entry) =>
    ['offer-low', 'offer-normal', 'offer-high', 'wait'].includes(entry.action),
  );
  const spend = Math.max(0, budgetBase(state) - state.budget);
  const wageAdded = Math.max(0, state.startWageBudget - state.wage);
  const reworks = reworkCount(state);
  return (
    <div className="transfers-settlement">
      <div className="transfers-stat-row">
        <StatTile
          label="签约人数"
          value={`${signed.length} / ${requiredSignings(state)}`}
          hint={isGoalMet(state) ? '已达到目标' : '还需要继续签人'}
          tone={isGoalMet(state) ? 'green' : 'red'}
        />
        <StatTile
          label="已花费预算"
          value={formatFee(spend)}
          hint={`本次可用 ${formatFee(budgetLimit(state))}`}
          tone={spend <= budgetLimit(state) ? 'green' : 'red'}
        />
        <StatTile
          label="新增周薪"
          value={formatWage(wageAdded)}
          hint={`俱乐部空间 ${formatWage(state.startWageBudget)}`}
          tone={state.wage >= 0 ? 'green' : 'red'}
        />
        <StatTile
          label="返工"
          value={`${reworks} 次`}
          hint={`已承担 ${formatFee(reworks * REWORK_COST)}`}
          tone={reworks > 0 ? 'amber' : 'neutral'}
        />
        <StatTile label="验证次数" value={`第 ${state.verifyAttempt} 次`} hint={`已报价/等待 ${state.actionsTaken} 次`} />
      </div>

      <div className="transfers-meter-row">
        <Meter
          label={state.modules.budget ? '转会预算' : '转会预算（规则未启用，本次不扣预算）'}
          value={state.modules.budget ? state.budget : 0}
          max={budgetLimit(state)}
          tone={state.modules.budget ? (state.budget > 0 ? 'green' : 'amber') : 'amber'}
          valueLabel={`${formatFee(state.budget)} / ${formatFee(budgetLimit(state))}`}
        />
        <Meter
          label={state.modules.budget ? '周薪空间' : '周薪空间（规则未启用，本次不占工资）'}
          value={state.modules.budget ? state.wage : 0}
          max={wageLimit(state)}
          tone={state.modules.budget ? (state.wage > 0 ? 'green' : 'amber') : 'amber'}
          valueLabel={`${formatWage(state.wage)} / ${formatWage(wageLimit(state))}`}
        />
      </div>

      {problems.length === 0 ? (
        <Callout tone="green" icon="✓" title="目标达成，验证有效">
          至少签下 {requiredSignings(state)} 人，验证配置完整，可以进入迁移题。
        </Callout>
      ) : (
        <Callout tone="red" icon="✕" title="还不能归档">
          <ul className="transfers-problem-list">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          <p className="transfers-muted">
            回到维修台重新配置会记 1 次返工：俱乐部承担 {formatFee(REWORK_COST)} 返工成本（谈判/经纪），转会预算将受影响（下次验证可用{' '}
            {formatFee(
              (state.modules.galaxy ? Math.floor(Math.max(0, budgetBase(state) - REWORK_COST) * 0.3) : Math.max(0, budgetBase(state) - REWORK_COST)),
            )}
            ）。
          </p>
        </Callout>
      )}

      <section className="transfers-subsection">
        <h3 className="transfers-subtitle">真实签约记录</h3>
        {signed.length === 0 ? (
          <EmptyState title="这次窗口一个人都没签下">窗口关闭时，没签成也是一种真实结果。</EmptyState>
        ) : (
          <ComparisonTable
            head={['球员', '位置', '签约轮次', '周薪', '经纪人佣金']}
            rows={signed.map((player) => [
              player.name,
              player.position,
              `第 ${player.signedRound ?? '?'} 轮`,
              formatWage(player.wage),
              formatFee(player.agentFee),
            ])}
          />
        )}
      </section>

      <section className="transfers-subsection">
        <h3 className="transfers-subtitle">错过原因</h3>
        {missed.length === 0 ? (
          <p className="transfers-muted">三名候选全部签下。</p>
        ) : (
          <ul className="transfers-missed-list">
            {missed.map((item) => (
              <li key={item.name}>
                <span aria-hidden="true">✕</span>
                <strong>{item.name}</strong>
                <span>{item.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="transfers-subsection">
        <h3 className="transfers-subtitle">真实出价与等待记录</h3>
        <EventLogList entries={negotiationLog} emptyText="这次窗口没有发出任何报价，也没有等待。" maxHeight={220} />
      </section>

      <section className="transfers-subsection">
        <h3 className="transfers-subtitle">故障版与修复版对比</h3>
        <ComparisonTable
          head={['比较项', '故障版', '修复版']}
          rows={transfersComparison(state).map((row) => [row.label, row.fault, row.fixed])}
        />
      </section>
    </div>
  );
}

function NegotiationCard({
  state,
  playerId,
  onAction,
}: {
  state: TransfersState;
  playerId: string;
  onAction: (action: TransferActionResult) => void;
}) {
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return null;
  const signed = player.status === 'signed';
  const lost = player.status === 'lost';
  const tiers = TIERS.map((tier) => previewOffer(state, player.id, tier)).filter(
    (preview): preview is NonNullable<typeof preview> => Boolean(preview),
  );
  const wait = canWaitTarget(state, player.id);
  const waitInfo = previewWait(state);
  const priceChanged = player.askingPrice !== player.valuation;

  return (
    <li className={`transfers-player${signed ? ' is-signed' : ''}${lost ? ' is-lost' : ''}`}>
      <header className="transfers-player-head">
        <div>
          <p className="transfers-player-name">{player.name}</p>
          <p className="transfers-player-pos">{player.position}</p>
        </div>
        {signed && <Chip tone="green" icon="✓">已签约</Chip>}
        {lost && <Chip tone="red" icon="✕">被截胡</Chip>}
        {!signed && !lost && <Chip tone="neutral">待谈</Chip>}
      </header>
      {player.source === 'scout' && (
        <div className="transfers-scout-report">
          <Chip tone="purple" icon="🔭">
            球探室报告
          </Chip>
          <p>
            知识度 {player.knowledge ?? 0}% · {player.scoutRegionLabel ?? '球探室报告'} · 初始竞争兴趣由知识度决定
          </p>
        </div>
      )}
      <dl className="transfers-player-facts">
        <div>
          <dt>当前要价</dt>
          <dd>
            {formatFee(player.askingPrice)}
            {priceChanged && (
              <span className="transfers-price-change">
                原 {formatFee(player.valuation)}
                {player.askingPrice < player.valuation ? ' ↓' : ' ↑'}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>周薪</dt>
          <dd>{formatWage(player.wage)}</dd>
        </div>
        <div>
          <dt>经纪人佣金</dt>
          <dd>{formatFee(player.agentFee)}</dd>
        </div>
      </dl>
      <Meter
        label="竞争对手兴趣"
        value={player.rivalInterest}
        max={RIVAL_HIJACK_AT}
        tone={player.rivalInterest >= 80 ? 'red' : player.rivalInterest >= 50 ? 'amber' : 'green'}
        valueLabel={`${player.rivalInterest} / ${RIVAL_HIJACK_AT}`}
      />
      {!signed && !lost && (
        <>
          <div className="transfers-tier-list">
            {tiers.map((preview) => (
              <div
                key={preview.tier}
                className={`transfers-tier${preview.expectedSuccess ? ' is-ok' : ' is-risk'}${
                  preview.allowed ? '' : ' is-blocked'
                }`}
              >
                <Button
                  size="sm"
                  variant={preview.tier === 'high' ? 'secondary' : preview.tier === 'low' ? 'ghost' : 'primary'}
                  disabled={!preview.allowed}
                  onClick={() => onAction(offer(state, player.id, preview.tier))}
                  aria-label={`${tierName(preview.tier)}：${player.name}，本次花费 ${formatFee(preview.totalCost)}`}
                >
                  {tierName(preview.tier)} {formatFee(preview.totalCost)}
                </Button>
                <div className="transfers-tier-copy">
                  <p className="transfers-tier-expected">
                    <span aria-hidden="true">{preview.expectedSuccess ? '◆' : '⚠'}</span> {preview.expectedText}
                  </p>
                  <p className="transfers-tier-condition">{preview.condition}</p>
                  {preview.allowed && preview.budgetAfter !== null && (
                    <p className="transfers-tier-condition">
                      签约后：预算 {formatFee(Math.max(0, preview.budgetAfter))} / 周薪{' '}
                      {formatWage(Math.max(0, preview.wageAfter ?? 0))}
                    </p>
                  )}
                  {!preview.allowed && <p className="transfers-tier-blocked">不可提交：{preview.blockedReason}</p>}
                </div>
              </div>
            ))}
          </div>
          <div className="transfers-wait-row">
            <Button
              size="sm"
              variant="secondary"
              disabled={!wait.ok}
              onClick={() => onAction(waitTarget(state, player.id))}
              aria-label={`等待一轮：${player.name}`}
            >
              等待一轮
            </Button>
            <p className="transfers-tier-condition">{waitInfo.text}</p>
          </div>
        </>
      )}
      {signed && <p className="transfers-muted">这笔签约已经占用预算与周薪，不能再报价。</p>}
      {lost && <p className="transfers-muted">竞争对手已经赢下这名目标，永久失去。</p>}
    </li>
  );
}

export function TransfersLevel({
  level,
  mode,
  fastStart,
  showcaseOptions,
  club,
  savedState,
  onSaveState,
  onComplete,
  onExit,
}: LevelScreenProps) {
  const [state, setState] = useState<TransfersState>(() => {
    const restored = reviveTransfersState(savedState);
    if (restored) return restored;
    return createTransfersState({
      mode,
      seed: showcaseOptions?.seed ?? randomSeed(),
      fastStart,
      showcaseOptions,
      club,
    });
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const saveStateRef = useRef(onSaveState);
  saveStateRef.current = onSaveState;
  useEffect(() => {
    saveStateRef.current(state);
  }, [state]);

  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const completedRef = useRef(false);
  function finishLevel() {
    if (completedRef.current) return;
    completedRef.current = true;
    completeRef.current({
      evidence: state.evidence,
      summary: transferSummaryLines(state),
      clubUpdate: buildTransfersClubUpdate(state),
      clubPatch: buildTransfersClubPatch(state),
    });
  }
  useEffect(() => {
    if (state.phase !== 'summary' || completedRef.current) return;
    finishLevel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function apply(result: TransferActionResult) {
    if (!result.ok) {
      setNotice(result.reason ?? '这个操作现在不可用。');
      return;
    }
    setNotice(null);
    setState(result.state);
  }

  const moduleCount = TRANSFER_MODULE_IDS.filter((id) => state.modules[id]).length;
  const clubUpdate = buildTransfersClubUpdate(state);
  const sideContent = (
    <>
      <Panel
        title="俱乐部状态"
        subtitle={mode === 'showcase' ? '演示模式：使用默认预算，不写正式进度' : '跨关资源，失败会真实减少'}
        actions={<Chip tone={reworkCount(state) > 0 ? 'amber' : 'neutral'}>返工 {reworkCount(state)} 次</Chip>}
      >
        <RuleList
          items={[
            { label: '转会预算（起始）', value: formatFee(state.startTransferBudget) },
            { label: '当前可用预算', value: formatFee(budgetLimit(state)) },
            { label: '周薪空间（起始）', value: formatWage(state.startWageBudget) },
            { label: '俱乐部历史返工', value: `${state.clubFailures} 次` },
            { label: '本关已承担返工成本', value: formatFee(reworkCostPaid(state)) },
          ]}
        />
        <p className="transfers-muted">
          每次验证未达成后重新配置：俱乐部承担 {formatFee(REWORK_COST)} 返工成本（谈判/经纪），转会预算将受影响（最低 0）。
        </p>
      </Panel>
      {mode === 'showcase' && (
        <Panel title="演示模式" tone="amber">
          <p className="transfers-muted">
            固定种子 {showcaseOptions?.seed ?? '—'}；{state.fastPlay ? `短局参数：窗口 ${roundLimit(state)} 轮，签下 ${requiredSignings(state)} 人即可结算。` : '完整流程。'}
          </p>
          {state.transferSkipped && <p className="transfers-muted">本局已标注「演示跳过迁移题」，不计入 transferred。</p>}
        </Panel>
      )}
      <Panel title="本关规则" subtitle="所有数值都从这里来">
        <RuleList items={TRANSFER_RULE_LINES.map((line) => ({ label: line.label, value: line.value }))} />
      </Panel>
      <Panel title="模块状态" actions={<Chip>{moduleCount} / 4</Chip>}>
        <ul className="transfers-module-state">
          {TRANSFER_MODULE_POOL.map((module) => (
            <li key={module.id}>
              <Chip tone={state.modules[module.id] ? 'green' : 'neutral'}>
                {state.modules[module.id] ? '已安装' : '未安装'}
              </Chip>
              <span>{module.name}</span>
            </li>
          ))}
        </ul>
        <p className="transfers-muted">模块只显示实际效果与副作用；装什么、怎么组合由你判断。</p>
      </Panel>
      <Panel title="操作记录" actions={<Chip>{state.eventLog.length} 条</Chip>}>
        <EventLogList entries={state.eventLog} maxHeight={260} />
      </Panel>
    </>
  );

  return (
    <LevelWorkbench level={level} phase={state.phase} evidence={state.evidence} sideContent={sideContent}>
      {notice && (
        <Callout tone="red" title="这次操作没有生效" icon="⚠">
          {notice}
        </Callout>
      )}

      {state.phase === 'commission' && (
        <Panel title="委托：让报价重新有代价" subtitle="客户 顾航 · 体育总监">
          <p>
            顾航的俱乐部在旧版转会窗里可以随便签人：看到身价就点，预算和工资空间永远不会报警，
            窗口关上才发现一个人都没签成。这一轮预算来自俱乐部此前的真实经营结果，失败还会继续扣钱。
            模块池只写效果与副作用，要装哪些由你判断。
          </p>
          <ul className="transfers-objective-list">
            <li>确认转会预算与周薪空间是两本账，签约同时占用两者。</li>
            <li>在 3 轮窗口里用报价、等待与竞争兴趣做取舍。</li>
            <li>至少签下 2 人，用真实出价记录解释签下或错过；装错模块会真的变差。</li>
          </ul>
          <ArrowFlow from="报价没有成本" to="每一次报价都在权衡「现在锁定」还是「再等一轮」" />
          <div className="transfers-actions">
            <Button size="lg" onClick={() => apply(startFaultPlay(state))}>
              开始故障试玩
            </Button>
            <span className="transfers-muted">故障版里可以先随便签人，亲身感受「没有代价」。</span>
          </div>
        </Panel>
      )}

      {state.phase === 'faultPlay' && (
        <Panel title="故障试玩 · 旧版转会窗" subtitle="没有预算 / 工资空间 / 竞争对手">
          <Callout tone="amber" title="故障版说明" icon="⚠">
            {TRANSFER_FAULT_NOTE}
          </Callout>
          <ul className="transfers-fault-grid">
            {state.players.map((player) => {
              const signed = state.faultSigned.includes(player.id);
              return (
                <li key={player.id} className={`transfers-fault-card${signed ? ' is-signed' : ''}`}>
                  <p className="transfers-player-name">{player.name}</p>
                  <p className="transfers-player-pos">{player.position}</p>
                  <p className="transfers-fault-price">身价 {formatFee(player.valuation)}</p>
                  {signed ? (
                    <Chip tone="green" icon="✓">已签下</Chip>
                  ) : (
                    <Button size="sm" onClick={() => apply(directSign(state, player.id))}>
                      直接签下
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="transfers-muted">故障版已签下 {state.faultSigned.length} / 3 人：没有任何预算或工资被扣除。</p>
          <Button
            onClick={() => apply(finishFaultPlay(state))}
            disabled={state.faultSigned.length === 0}
            aria-label="结束故障试玩，进入诊断"
          >
            结束故障试玩，进入诊断
          </Button>
          {state.faultSigned.length === 0 && <p className="transfers-disabled-hint">至少先点一次「直接签下」，再结束试玩。</p>}
        </Panel>
      )}

      {state.phase === 'diagnose' && (
        <Panel title="诊断 · 为什么报价没有意义？" subtitle="答错可以重试，不扣任何资源">
          <Callout tone="neutral" title="故障版记录">
            你在旧版里直接签下了 {state.faultSigned.length} 人，期间没有花掉一分预算，也没有任何竞争对手出价。
          </Callout>
          <QuizCard
            question="旧版转会窗里，为什么「签谁」不构成选择？"
            hint="想一想：一次报价应该让你失去什么，或者错过什么？"
            options={DIAGNOSE_OPTIONS}
            correctIds={[DIAGNOSE_CORRECT_ID]}
            explanations={DIAGNOSE_EXPLANATIONS}
            wrongHint="对照故障版：点一下按钮之后，有任何数字发生变化吗？"
            successText="对。修复版会把预算、工资空间与竞争风险一起加回报价，让每次点击都产生代价。"
            onResolved={() => apply(resolveDiagnosis(state))}
          />
        </Panel>
      )}

      {state.phase === 'repair' && (
        <Panel
          title="维修 · 从模块池里挑规则"
          subtitle={`第 ${state.verifyAttempt} 次验证前的配置：可以自由安装 / 卸载，每个模块都写着真实效果与副作用`}
        >
          <Callout tone="neutral" title="怎么选模块">
            4 张卡都没有对错标签，只有真实效果与副作用。有些卡会让预算变少、兴趣变高或让这次验证失效；
            自己判断要装哪些、要承担什么代价。
          </Callout>
          <div className="transfers-module-grid">
            {TRANSFER_MODULE_IDS.map((id) => {
              const info = moduleInfo(level, id);
              if (!info) return null;
              const installed = state.modules[id];
              return (
                <ModuleCard
                  key={id}
                  name={info.name}
                  englishName={info.englishName}
                  summary={info.description}
                  sideEffect={info.sideEffect}
                  installed={installed}
                  onToggle={() => apply(setModule(state, id, !installed))}
                  badge={
                    <span className="transfers-module-badge">
                      {installed ? '已启用：实际效果见上方说明' : '未启用：点击安装后按上方说明生效'}
                    </span>
                  }
                />
              );
            })}
          </div>
          {!verificationValid(state) && (
            <Callout tone="amber" title="验证配置还不完整" icon="⚠">
              也可以直接开始验证，但本次结果会被判定为「验证无效」，归档会被阻止；
              到时候可以回到维修台重新配置，并承担返工成本。
            </Callout>
          )}
          <div className="transfers-actions">
            <Button onClick={() => apply(startWindow(state))}>开始第 {state.verifyAttempt} 次验证（{moduleCount} 个模块）</Button>
            <span className="transfers-muted">窗口开始后模块锁定；失败可以回到维修台重新配置（每次返工 €1M）。</span>
          </div>
        </Panel>
      )}

      {state.phase === 'verify' && (
        <>
          <Panel
            title={state.windowClosed ? '转会窗口已关闭 · 结算' : `转会窗口 · 第 ${state.round} / ${roundLimit(state)} 轮`}
            subtitle={`第 ${state.verifyAttempt} 次验证 · 每轮只能对 1 名目标报价或等待 1 轮；目标：签下至少 ${requiredSignings(state)} 人`}
            actions={
              <Chip tone={state.windowClosed ? 'neutral' : 'green'} icon={state.windowClosed ? '⏹' : '⏳'}>
                {state.windowClosed ? '窗口已关闭' : `剩余 ${Math.max(0, roundLimit(state) - state.round + 1)} 轮`}
              </Chip>
            }
          >
            {!state.windowClosed ? (
              <>
                <div className="transfers-meter-row">
                  <Meter
                    label={state.modules.budget ? '转会预算' : '转会预算（规则未启用，本次不扣预算）'}
                    value={state.modules.budget ? state.budget : 0}
                    max={budgetLimit(state)}
                    tone={state.modules.budget ? (state.budget > 0 ? 'green' : 'amber') : 'amber'}
                    valueLabel={`${formatFee(state.budget)} / ${formatFee(budgetLimit(state))}`}
                  />
                  <Meter
                    label={state.modules.budget ? '周薪空间' : '周薪空间（规则未启用，本次不占工资）'}
                    value={state.modules.budget ? state.wage : 0}
                    max={wageLimit(state)}
                    tone={state.modules.budget ? (state.wage > 0 ? 'green' : 'amber') : 'amber'}
                    valueLabel={`${formatWage(state.wage)} / ${formatWage(wageLimit(state))}`}
                  />
                </div>
                <div className="transfers-stat-row">
                  <StatTile
                    label="已签下"
                    value={`${signedCount(state)} / ${requiredSignings(state)}`}
                    tone={isGoalMet(state) ? 'green' : 'purple'}
                  />
                  <StatTile label="已花费预算" value={formatFee(Math.max(0, budgetBase(state) - state.budget))} hint={`可用 ${formatFee(budgetLimit(state))}`} />
                  <StatTile label="已启用模块" value={`${moduleCount} / 4`} hint="效果与副作用见右侧说明" />
                  <StatTile label="返工成本" value={formatFee(reworkCostPaid(state))} hint={`返工 ${reworkCount(state)} 次`} tone={reworkCount(state) > 0 ? 'amber' : 'neutral'} />
                </div>
                {!verificationValid(state) && (
                  <Callout tone="amber" title="本次验证无效" icon="⚠">
                    验证配置不完整。你仍然可以继续体验报价与竞争，但结束时不能归档，只能回到维修台重新配置。
                  </Callout>
                )}
                <ul className="transfers-player-grid">
                  {state.players.map((player) => (
                    <NegotiationCard key={player.id} state={state} playerId={player.id} onAction={apply} />
                  ))}
                </ul>
                <div className="transfers-actions">
                  <Button variant="secondary" onClick={() => setConfirmClose(true)}>
                    提前关闭窗口并结算
                  </Button>
                  <span className="transfers-muted">
                    也可以继续用完 {roundLimit(state)} 轮；签满 {requiredSignings(state)} 人后同样需要关闭窗口才能结算。
                  </span>
                </div>
              </>
            ) : (
              <>
                <SettlementDetails state={state} />
                <div className="transfers-actions">
                  {canAdvanceToTransfer(state) ? (
                    <Button onClick={() => apply(advanceToTransfer(state))}>进入迁移题</Button>
                  ) : (
                    <Button variant="secondary" onClick={() => apply(reconfigure(state))}>
                      回到维修台重新配置
                    </Button>
                  )}
                </div>
              </>
            )}
          </Panel>
        </>
      )}

      {state.phase === 'transfer' && (
        <Panel title="迁移 · 换一家俱乐部做同样的选择" subtitle="不计分，只看判断">
          <Callout tone="neutral" title="本次真实结果">
            第 {state.verifyAttempt} 次验证签下 {signedCount(state)} 人，花费 {formatFee(Math.max(0, budgetBase(state) - state.budget))}，
            剩余预算 {formatFee(state.budget)}，剩余工资空间 {formatWage(state.wage)}。
          </Callout>
          <QuizCard
            question="另一家俱乐部也有 3 名目标：一名便宜但被三家争抢，一名很贵但没人抢，一名要价一般。经理说「先等两轮，等更便宜再报」。哪一句最准确地描述他会同时面对什么？"
            hint="把预算、工资空间、竞争风险、窗口关闭四件事一起考虑。"
            options={TRANSFER_QUIZ_OPTIONS}
            correctIds={[TRANSFER_QUIZ_CORRECT_ID]}
            explanations={TRANSFER_QUIZ_EXPLANATIONS}
            successText="对。报价从来不只受一个数字约束，等待本身也是一种有代价的选择。"
            onResolved={() => apply(answerTransfer(state, TRANSFER_QUIZ_CORRECT_ID))}
          />
          {mode === 'showcase' && (
            <div className="transfers-actions">
              <Button variant="secondary" onClick={() => apply(skipTransfer(state))}>
                演示跳过迁移题（不计 transferred）
              </Button>
            </div>
          )}
        </Panel>
      )}

      {state.phase === 'summary' && (
        <Panel title="归档 · 这次维修留下了什么" subtitle="三条总结都来自真实状态与日志">
          {state.transferSkipped && (
            <Callout tone="amber" title="演示跳过迁移题" icon="🎬">
              本局在展示模式下跳过了迁移题，evidence.transferred 保持为 false；其他证据仍然来自真实操作。
            </Callout>
          )}
          <SettlementDetails state={state} />
          <section className="transfers-subsection">
            <h3 className="transfers-subtitle">规则变化 / 决策变化 / 代价</h3>
            <ul className="transfers-summary-lines">
              {transferSummaryLines(state).map((line) => (
                <li key={line.slice(0, 12)}>{line}</li>
              ))}
            </ul>
          </section>
          <section className="transfers-subsection">
            <h3 className="transfers-subtitle">俱乐部时间线将记录</h3>
            <p className="transfers-club-headline">{clubUpdate.headline}</p>
            <ul className="transfers-club-details">
              {clubUpdate.details.map((detail) => (
                <li key={detail.slice(0, 16)}>{detail}</li>
              ))}
            </ul>
          </section>
          <div className="transfers-actions">
            <Button
              onClick={() => {
                finishLevel();
                onExit();
              }}
            >
              完成委托并返回修理铺
            </Button>
            <Button variant="secondary" onClick={onExit}>
              返回修理铺
            </Button>
          </div>
        </Panel>
      )}

      <ConfirmDialog
        open={confirmClose}
        title="提前关闭转会窗口？"
        description={
          <p>
            关闭后不能再报价或等待，会立刻结算本次窗口。当前已签下 {signedCount(state)} 人，
            目标是至少 {requiredSignings(state)} 人。关闭后如果不够或验证无效，可以回到维修台重新配置。
          </p>
        }
        confirmLabel="关闭窗口并结算"
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false);
          apply(closeWindow(state));
        }}
      />
    </LevelWorkbench>
  );
}
