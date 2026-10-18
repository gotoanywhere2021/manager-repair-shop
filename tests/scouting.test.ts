import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getLevel } from '../src/game/levels';
import type { ClubState, LevelScreenProps } from '../src/game/engine/types';
import {
  DEFAULT_TRANSFER_BUDGET,
  DIAGNOSE_CORRECT_ID,
  HIGHLIGHTS_HALF_WIDTH,
  KNOWLEDGE_MAX,
  REGIONS,
  RETRY_COST_MILLIONS,
  SCOUTING_MODULES,
  SCOUTING_TARGETS,
  SCOUTS_PER_ROUND,
  SCOUT_CANDIDATES,
  SCOUT_NETWORK_FEE_MILLIONS,
  TRANSFER_OPTIONS,
  WIDE_NET_GAIN,
  WIDE_NET_SCOUTS,
  archiveBlockReason,
  archiveBlocker,
  assignScout,
  budgetAfterRetries,
  buildArchiveSummary,
  buildCandidateReports,
  buildClubPatch,
  buildClubUpdate,
  buildCompletionResult,
  canComplete,
  candidateReport,
  candidateReportWithModules,
  completeArchive,
  createInitialScoutingState,
  dispatchRuleSummary,
  endRound,
  evaluateScoutingVerification,
  finishFaultPlay,
  gainKnowledge,
  inspectCandidate,
  installKnowledgeReports,
  installLimitedScouts,
  installScoutingModule,
  isVerificationDone,
  loadoutModuleNames,
  moduleKnowledgeGain,
  moduleScoutsPerRound,
  openSummary,
  openTransfer,
  pickFaultCandidate,
  precisionLabel,
  precisionRank,
  remainingBudget,
  reportPrecision,
  reportRange,
  resolveDiagnose,
  resolveTransfer,
  retryVerification,
  reviveScoutingState,
  scoutedCandidatesPatch,
  scoutsAvailable,
  selectCandidate,
  skipTransferInShowcase,
  startFaultPlay,
  startRepair,
  startVerify,
  toggleScoutingModule,
  trueOverall,
  uninstallScoutingModule,
} from '../src/game/levels/scouting/logic';
import type { RegionId, ScoutingInitOptions, ScoutingState } from '../src/game/levels/scouting/logic';
import { ScoutingLevel } from '../src/game/levels/scouting/ScoutingLevel';

const NORMAL: ScoutingInitOptions = { mode: 'normal', fastStart: false, showcaseOptions: null };

const CLUB: ClubState = {
  name: '北港联',
  season: '2026/27',
  week: 0,
  transferBudget: DEFAULT_TRANSFER_BUDGET,
  wageBudget: 350,
  failures: 0,
  tactics: null,
  scoutedCandidates: [],
  signings: [],
  timeline: [],
  seasonReport: null,
};

function showcase(startPhase: 'faultPlay' | 'repair' | 'verify', fastPlay = true): ScoutingInitOptions {
  return { mode: 'showcase', fastStart: false, showcaseOptions: { seed: 20251018, fastPlay, startPhase } };
}

function newState(seed = 42): ScoutingState {
  return createInitialScoutingState(NORMAL, seed);
}

function reachRepair(seed = 42): ScoutingState {
  let state = startFaultPlay(newState(seed));
  state = inspectCandidate(state, 'lin-tuo');
  state = pickFaultCandidate(state, 'lin-tuo');
  state = finishFaultPlay(state);
  state = resolveDiagnose(state);
  return startRepair(state);
}

function installCorrect(state: ScoutingState): ScoutingState {
  let next = installLimitedScouts(state);
  next = installKnowledgeReports(next);
  return next;
}

function reachVerify(seed = 42): ScoutingState {
  return startVerify(installCorrect(reachRepair(seed)));
}

function finishRound(state: ScoutingState, regions: RegionId[]): ScoutingState {
  let next = state;
  for (const region of regions) {
    next = assignScout(next, region);
  }
  return endRound(next);
}

function reachSelection(seed = 42): ScoutingState {
  let state = reachVerify(seed);
  state = finishRound(state, ['local', 'southern-europe']);
  state = finishRound(state, ['northern-europe', 'south-america']);
  return state;
}

/** 错误模块「广撒网考察」的验证失败状态，用于失败/重试测试。 */
function wideNetFailedState(): ScoutingState {
  let state = installScoutingModule(reachRepair(), 'wide-net');
  state = startVerify(state);
  state = finishRound(state, ['local', 'southern-europe', 'northern-europe']);
  state = finishRound(state, ['local', 'southern-europe', 'northern-europe']);
  return selectCandidate(state, 'lin-tuo');
}

function reachPassed(seed = 42): ScoutingState {
  return selectCandidate(reachSelection(seed), 'lin-tuo');
}

function makeProps(overrides: Partial<LevelScreenProps> = {}): LevelScreenProps {
  return {
    level: getLevel('scouting'),
    mode: 'normal',
    fastStart: true,
    showcaseOptions: null,
    club: CLUB,
    savedState: undefined,
    onSaveState: vi.fn(),
    onComplete: vi.fn(),
    onExit: vi.fn(),
    ...overrides,
  };
}

function clickSelectableCandidate(regionLabel: string) {
  const buttons = screen.getAllByRole('button', { name: '加入候选名单' });
  const match = buttons.find((button) => button.closest('article')?.textContent?.includes(regionLabel));
  expect(match).toBeTruthy();
  fireEvent.click(match as HTMLElement);
}

function clickFaultFlow() {
  fireEvent.click(screen.getAllByRole('button', { name: '考察（瞬间全知）' })[0]);
  const pickButtons = screen.getAllByRole('button', { name: '加入候选名单' }) as HTMLButtonElement[];
  fireEvent.click(pickButtons.find((button) => !button.disabled) as HTMLButtonElement);
  fireEvent.click(screen.getByRole('button', { name: '结束故障试玩，去诊断' }));
}

function clickDiagnoseFlow() {
  fireEvent.click(screen.getByRole('radio', { name: /球探数量有限，信息应该逐步变清楚/ }));
  fireEvent.click(screen.getByRole('button', { name: '提交判断' }));
  fireEvent.click(screen.getByRole('button', { name: '开始维修' }));
}

function clickTransferFlow() {
  fireEvent.click(screen.getByRole('radio', { name: /派有限球探分区域考察/ }));
  fireEvent.click(screen.getByRole('button', { name: '提交判断' }));
  fireEvent.click(screen.getByRole('button', { name: '进入归档' }));
}

afterEach(() => {
  cleanup();
});

describe('球探室 v2：模块池与规则数值', () => {
  it('4 个模块分属派遣/报告两个槽位，正确与错误标记真实', () => {
    expect(SCOUTING_MODULES).toHaveLength(4);
    expect(SCOUTING_MODULES.filter((module) => module.slot === 'dispatch')).toHaveLength(2);
    expect(SCOUTING_MODULES.filter((module) => module.slot === 'report')).toHaveLength(2);
    expect(SCOUTING_MODULES.find((module) => module.id === 'limited-scouts')?.correct).toBe(true);
    expect(SCOUTING_MODULES.find((module) => module.id === 'wide-net')?.correct).toBe(false);
    expect(SCOUTING_MODULES.find((module) => module.id === 'highlights')?.sideEffect).toContain('±25');
  });

  it('模块决定每轮球探数与知识度收益', () => {
    const base = reachRepair();
    expect(moduleScoutsPerRound(base)).toBe(1);
    expect(moduleKnowledgeGain(base)).toBe(0);

    const limited = installLimitedScouts(base);
    expect(moduleScoutsPerRound(limited)).toBe(SCOUTS_PER_ROUND);
    expect(moduleKnowledgeGain(limited)).toBe(35);

    const wide = installScoutingModule(base, 'wide-net');
    expect(moduleScoutsPerRound(wide)).toBe(WIDE_NET_SCOUTS);
    expect(moduleKnowledgeGain(wide)).toBe(WIDE_NET_GAIN);

    const highlights = installScoutingModule(limited, 'highlights');
    expect(moduleKnowledgeGain(highlights)).toBe(Math.floor(35 / 2));
    expect(moduleKnowledgeGain(installScoutingModule(wide, 'highlights'))).toBe(Math.floor(WIDE_NET_GAIN / 2));
    expect(loadoutModuleNames(installCorrect(base).loadout)).toEqual(['有限球探', '知识度报告']);
  });

  it('同槽位模块互斥替换，也可以自由卸载', () => {
    let state = reachRepair();
    state = installScoutingModule(state, 'limited-scouts');
    state = installScoutingModule(state, 'wide-net');
    expect(state.loadout.dispatch).toBe('wide-net');
    state = toggleScoutingModule(state, 'wide-net');
    expect(state.loadout.dispatch).toBeNull();
    state = installScoutingModule(state, 'knowledge-reports');
    expect(uninstallScoutingModule(state, 'knowledge-reports').loadout.report).toBeNull();
    expect(installKnowledgeReports(installLimitedScouts(state)).loadout.report).toBe('knowledge-reports');
  });
});

describe('球探室 v2：派遣、轮末与非法操作', () => {
  it('派遣消耗球探、同一区域不能派两人、人数用完必须结束本轮', () => {
    let state = reachVerify();
    expect(scoutsAvailable(state)).toBe(SCOUTS_PER_ROUND);
    state = assignScout(state, 'local');
    expect(scoutsAvailable(state)).toBe(1);
    expect(assignScout(state, 'local')).toBe(state);
    state = assignScout(state, 'southern-europe');
    expect(assignScout(state, 'northern-europe')).toBe(state);
    const partial = assignScout(reachVerify(), 'local');
    expect(endRound(partial)).toBe(partial);
  });

  it('轮末收回球探、知识度留在区域里，历史记录真实', () => {
    let state = reachVerify();
    state = finishRound(state, ['local', 'southern-europe']);
    expect(state.round).toBe(1);
    expect(state.dispatches).toEqual([]);
    expect(scoutsAvailable(state)).toBe(SCOUTS_PER_ROUND);
    expect(state.knowledge.local).toBe(35);
    expect(state.knowledge['southern-europe']).toBe(35);
    expect(state.knowledge['northern-europe']).toBe(0);
    expect(state.history).toHaveLength(1);
    expect(state.history[0].knowledgeGain).toBe(35);
  });

  it('广撒网模块每轮 3 名球探、每次知识度只 +20', () => {
    let state = installScoutingModule(reachRepair(), 'wide-net');
    state = startVerify(state);
    expect(moduleScoutsPerRound(state)).toBe(3);
    state = finishRound(state, ['local', 'southern-europe', 'northern-europe']);
    expect(state.knowledge.local).toBe(20);
    expect(state.history[0].knowledgeGain).toBe(20);
    expect(state.round).toBe(1);
  });

  it('非法状态下的派遣被拒绝：阶段不对、区域不存在、重复区域', () => {
    const fresh = newState();
    expect(assignScout(fresh, 'local')).toBe(fresh);
    const verify = reachVerify();
    expect(assignScout(verify, 'not-a-region' as never)).toBe(verify);
    expect(selectCandidate(verify, 'lin-tuo')).toBe(verify);
    const oneRound = finishRound(verify, ['local', 'southern-europe']);
    expect(selectCandidate(oneRound, 'lin-tuo')).toBe(oneRound);
  });

  it('没装模块也能开始派遣，但知识度不会增长', () => {
    let state = startVerify(reachRepair());
    expect(state.phase).toBe('verify');
    expect(moduleScoutsPerRound(state)).toBe(1);
    state = finishRound(state, ['local']);
    expect(state.knowledge.local).toBe(0);
    expect(state.round).toBe(1);
  });
});

describe('球探室 v2：知识度与报告精度', () => {
  it('知识度增长/上限/阈值对应报告精度', () => {
    expect(gainKnowledge(0)).toBe(35);
    expect(gainKnowledge(35)).toBe(70);
    expect(gainKnowledge(90)).toBe(100);
    expect(gainKnowledge(90, WIDE_NET_GAIN)).toBe(100);
    expect(reportPrecision(0)).toBe('unknown');
    expect(reportPrecision(34)).toBe('wide');
    expect(reportPrecision(35)).toBe('narrow');
    expect(reportPrecision(74)).toBe('narrow');
    expect(reportPrecision(75)).toBe('precise');
    expect(precisionLabel('unreliable')).toBe('不可靠');
    expect(precisionRank('narrow')).toBeGreaterThan(precisionRank('wide'));
  });

  it('报告区间随知识度收窄，任何精度都不显示唯一精确值', () => {
    const overall = trueOverall(SCOUT_CANDIDATES[0]);
    const wide = reportRange(overall, 20);
    const narrow = reportRange(overall, 50);
    const precise = reportRange(overall, 80);
    expect(wide).not.toBeNull();
    expect((wide as { high: number }).high - (wide as { low: number }).low).toBeGreaterThan(
      (narrow as { high: number }).high - (narrow as { low: number }).low,
    );
    expect((narrow as { high: number }).high - (narrow as { low: number }).low).toBeGreaterThan(
      (precise as { high: number }).high - (precise as { low: number }).low,
    );
    expect((precise as { high: number }).high).toBeGreaterThan((precise as { low: number }).low);
  });

  it('知识度不足时看不到精确值；错误报告模块让精度真实变差', () => {
    const candidate = SCOUT_CANDIDATES[4];
    const overall = trueOverall(candidate);
    const unknown = candidateReport(candidate, 0);
    expect(unknown.precision).toBe('unknown');
    expect(unknown.range).toBeNull();
    expect(unknown.summary).not.toContain(String(overall));

    const noReport = candidateReportWithModules(candidate, 70, { dispatch: 'limited-scouts', report: null });
    expect(noReport.precision).toBe('wide');
    expect(noReport.range).not.toBeNull();

    const highlights = candidateReportWithModules(candidate, 70, { dispatch: 'limited-scouts', report: 'highlights' });
    expect(highlights.precision).toBe('unreliable');
    expect((highlights.range as { high: number }).high - (highlights.range as { low: number }).low).toBeLessThanOrEqual(
      HIGHLIGHTS_HALF_WIDTH * 2,
    );
    expect(highlights.summary).toContain('±25');

    const correct = candidateReportWithModules(candidate, 35, { dispatch: 'limited-scouts', report: 'knowledge-reports' });
    expect(correct.precision).toBe('narrow');
    expect(buildCandidateReports(reachSelection())).toHaveLength(SCOUT_CANDIDATES.length);
  });
});

describe('球探室 v2：目标、失败重试与证据', () => {
  it('故障版完成 → experiencedFault；正确派遣并选择 → operatedMechanic', () => {
    let state = newState();
    expect(state.evidence.experiencedFault).toBe(false);
    state = startFaultPlay(state);
    state = inspectCandidate(state, 'lin-tuo');
    state = pickFaultCandidate(state, 'lin-tuo');
    state = finishFaultPlay(state);
    expect(state.evidence.experiencedFault).toBe(true);

    state = resolveDiagnose(state);
    state = startRepair(state);
    state = installCorrect(state);
    state = startVerify(state);
    state = finishRound(state, ['local', 'southern-europe']);
    state = finishRound(state, ['northern-europe', 'south-america']);
    expect(state.evidence.operatedMechanic).toBe(false);
    state = selectCandidate(state, 'lin-tuo');
    expect(evaluateScoutingVerification(state).passed).toBe(true);
    expect(state.evidence.operatedMechanic).toBe(true);
    expect(state.evidence.transferred).toBe(false);
    state = openTransfer(state);
    state = resolveTransfer(state);
    expect(state.evidence.transferred).toBe(true);
  });

  it('装错模块 → 目标未达成 → 重试清空成绩、保留故障证据 → 重新配置后可完成', () => {
    let state = installScoutingModule(reachRepair(), 'wide-net');
    state = startVerify(state);
    state = finishRound(state, ['local', 'southern-europe', 'northern-europe']);
    state = finishRound(state, ['local', 'southern-europe', 'northern-europe']);
    state = selectCandidate(state, 'lin-tuo');
    const failed = evaluateScoutingVerification(state);
    expect(failed.passed).toBe(false);
    expect(failed.failed.map((target) => target.id)).toContain('modules');
    expect(failed.failed.map((target) => target.id)).toContain('report');
    expect(openTransfer(state)).toBe(state);

    state = retryVerification(state);
    expect(state.phase).toBe('repair');
    expect(state.round).toBe(0);
    expect(state.knowledge.local).toBe(0);
    expect(state.history).toHaveLength(0);
    expect(state.selectedCandidateId).toBeNull();
    expect(state.attempts).toBe(1);
    expect(state.evidence.experiencedFault).toBe(true);
    expect(state.evidence.operatedMechanic).toBe(false);

    state = toggleScoutingModule(state, 'wide-net');
    state = installCorrect(state);
    state = startVerify(state);
    state = finishRound(state, ['local', 'southern-europe']);
    state = finishRound(state, ['northern-europe', 'south-america']);
    state = selectCandidate(state, 'lin-tuo');
    expect(evaluateScoutingVerification(state).passed).toBe(true);
    expect(canComplete({ ...state, phase: 'summary' })).toBe(false);
    state = openTransfer(state);
    state = resolveTransfer(state);
    state = openSummary(state);
    expect(canComplete(state)).toBe(true);
  });

  it('归档前逻辑阻止未达成的验证并给出原因', () => {
    const failed: ScoutingState = { ...wideNetFailedState(), phase: 'summary' };
    expect(archiveBlocker(failed)).toBe('verify-unmet');
    expect(archiveBlockReason(failed)).toContain('验证目标未达成');
    expect(canComplete(failed)).toBe(false);
    expect(completeArchive(failed)).toBe(failed);
  });

  it('canComplete 只在目标全部达成后成立，归档只结算一次', () => {
    let state = reachPassed();
    expect(canComplete(state)).toBe(false);
    state = openTransfer(state);
    state = resolveTransfer(state);
    expect(canComplete(state)).toBe(false);
    state = openSummary(state);
    expect(canComplete(state)).toBe(true);
    const archived = completeArchive(state);
    expect(archived.completed).toBe(true);
    expect(canComplete(archived)).toBe(false);
    expect(completeArchive(archived)).toBe(archived);
  });
});

describe('球探室 v2：同种子、存档、展示模式与俱乐部时间线', () => {
  it('同种子得到相同的候选顺序与派遣结果；序列化恢复一致', () => {
    const first = reachSelection(777);
    const second = reachSelection(777);
    expect(first.candidateOrder).toEqual(second.candidateOrder);
    expect(first.knowledge).toEqual(second.knowledge);
    expect(first.history).toEqual(second.history);
    expect(first.eventLog).toEqual(second.eventLog);

    const restored = reviveScoutingState(JSON.parse(JSON.stringify(first)) as unknown, NORMAL);
    expect(restored).not.toBeNull();
    expect(restored?.candidateOrder).toEqual(first.candidateOrder);
    expect(restored?.knowledge).toEqual(first.knowledge);
    expect(restored?.round).toBe(first.round);
    expect(restored?.loadout).toEqual(first.loadout);
  });

  it('合法 v3 存档可以恢复，v1/v2/损坏存档安全回退', () => {
    const state = reachSelection();
    const base = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    const restored = reviveScoutingState(base, NORMAL);
    expect(restored).not.toBeNull();
    expect(restored?.budget).toBe(state.budget);
    expect(restored?.failureCount).toBe(state.failureCount);
    expect(reviveScoutingState({ ...base, version: 1 }, NORMAL)).toBeNull();
    expect(reviveScoutingState({ ...base, version: 2 }, NORMAL)).toBeNull();
    expect(reviveScoutingState({ ...base, budget: -1 }, NORMAL)).toBeNull();
    expect(reviveScoutingState({ ...base, knowledge: { local: 999 } }, NORMAL)).toBeNull();
    expect(reviveScoutingState({ ...base, loadout: { dispatch: 'wide-net', report: 'wrong' } }, NORMAL)).toBeNull();
    expect(reviveScoutingState({ ...base, dispatches: ['local', 'local'] }, NORMAL)).toBeNull();
    expect(reviveScoutingState(base, showcase('verify'))).toBeNull();
  });

  it('展示模式 verify 预装正确模块，1 轮即可达成目标并可跳过迁移', () => {
    let state = createInitialScoutingState(showcase('verify'), 20251018);
    expect(state.phase).toBe('verify');
    expect(state.loadout).toEqual({ dispatch: 'limited-scouts', report: 'knowledge-reports' });
    expect(state.rounds).toBe(1);
    expect(dispatchRuleSummary(state)).toContain('2 名球探');
    state = finishRound(state, ['local', 'southern-europe']);
    state = selectCandidate(state, 'lin-tuo');
    expect(evaluateScoutingVerification(state).passed).toBe(true);
    state = openTransfer(state);
    state = skipTransferInShowcase(state);
    expect(state.phase).toBe('summary');
    expect(state.evidence.transferred).toBe(false);
    expect(canComplete(state)).toBe(true);
  });

  it('正常模式下不能跳过迁移题', () => {
    let state = reachPassed();
    state = openTransfer(state);
    expect(skipTransferInShowcase(state)).toBe(state);
  });

  it('clubUpdate 使用真实派遣、知识度与候选报告', () => {
    const state = openSummary(resolveTransfer(openTransfer(reachPassed())));
    const clubUpdate = buildClubUpdate(state);
    expect(clubUpdate.headline).toContain('林拓');
    expect(clubUpdate.details.length).toBeGreaterThanOrEqual(2);
    expect(clubUpdate.details.length).toBeLessThanOrEqual(4);
    expect(clubUpdate.details.join(' ')).toContain(`${state.knowledge.local}`);
    expect(clubUpdate.details.join(' ')).toContain('知识度');
    expect(buildCompletionResult(state).clubUpdate).toEqual(clubUpdate);
    expect(buildArchiveSummary(state)).toHaveLength(3);
    expect(REGIONS).toHaveLength(4);
    expect(DIAGNOSE_CORRECT_ID).toBe('scouts-limited');
    expect(TRANSFER_OPTIONS).toHaveLength(3);
    expect(isVerificationDone(state)).toBe(true);
    expect(SCOUTING_TARGETS.coverageMin).toBe(2);
    expect(KNOWLEDGE_MAX).toBe(100);
    expect(SCOUT_CANDIDATES).toHaveLength(5);
  });
});

describe('球探室 v4：返工成本、预算与 clubPatch', () => {
  function failedWideNet(): ScoutingState {
    return wideNetFailedState();
  }

  it('失败返工每次扣 €0.5M，完成另扣 €1M 维护费，预算最低 0', () => {
    let state = failedWideNet();
    expect(state.budget).toBe(45);
    expect(budgetAfterRetries(state)).toBe(45);
    expect(remainingBudget(state)).toBe(45 - SCOUT_NETWORK_FEE_MILLIONS);
    expect(state.failureCount).toBe(0);

    state = retryVerification(state);
    expect(state.failureCount).toBe(1);
    expect(budgetAfterRetries(state)).toBe(45 - RETRY_COST_MILLIONS);
    expect(remainingBudget(state)).toBe(45 - RETRY_COST_MILLIONS - SCOUT_NETWORK_FEE_MILLIONS);

    state = startVerify(state);
    state = finishRound(state, ['local', 'southern-europe', 'northern-europe']);
    state = finishRound(state, ['local', 'southern-europe', 'northern-europe']);
    state = selectCandidate(state, 'lin-tuo');
    state = retryVerification(state);
    expect(state.failureCount).toBe(2);
    expect(budgetAfterRetries(state)).toBe(44);
    expect(remainingBudget(state)).toBe(43);

    const poor: ScoutingState = { ...failedWideNet(), budget: 0.5 };
    const floorState = retryVerification(poor);
    expect(floorState.failureCount).toBe(1);
    expect(budgetAfterRetries(floorState)).toBe(0);
    expect(remainingBudget(floorState)).toBe(0);
  });

  it('正常模式 clubPatch 提交 3 名真实候选、绝对预算与返工次数', () => {
    let state = failedWideNet();
    state = retryVerification(state);
    state = toggleScoutingModule(state, 'wide-net');
    state = installCorrect(state);
    state = startVerify(state);
    state = finishRound(state, ['local', 'southern-europe']);
    state = finishRound(state, ['northern-europe', 'south-america']);
    state = selectCandidate(state, 'lin-tuo');
    state = openTransfer(state);
    state = resolveTransfer(state);
    state = openSummary(state);

    const result = buildCompletionResult(state);
    expect(result.clubPatch).toBeTruthy();
    const patch = result.clubPatch as NonNullable<typeof result.clubPatch>;
    expect(patch.addFailures).toBe(1);
    expect(patch.transferBudget).toBe(43.5);
    const patchedCandidates = patch.scoutedCandidates ?? [];
    expect(patchedCandidates).toHaveLength(3);
    for (const candidate of patchedCandidates) {
      const source = SCOUT_CANDIDATES.find((item) => item.id === candidate.id);
      expect(source).toBeTruthy();
      expect(candidate.knowledge).toBe(state.knowledge[(source as { region: RegionId }).region]);
    }
    expect(patchedCandidates).toEqual(scoutedCandidatesPatch(state));
    expect(result.clubUpdate.details.join(' ')).toContain('返工 1 次');
    expect(result.clubUpdate.details.join(' ')).toContain('€0.5M');
    expect(result.clubUpdate.details.join(' ')).toContain('€1M 球探网络维护费');
    expect(result.clubUpdate.details.join(' ')).toContain('剩余转会预算 €43.5M');
  });

  it('预算从 props.club 起步；展示模式默认 45M 且不提交 clubPatch', () => {
    const normal = createInitialScoutingState({ ...NORMAL, startingBudget: 20 }, 42);
    expect(normal.budget).toBe(20);
    expect(remainingBudget(normal)).toBe(19);

    let demo = createInitialScoutingState(showcase('verify'), 20251018);
    expect(demo.budget).toBe(DEFAULT_TRANSFER_BUDGET);
    expect(buildClubPatch(demo)).toBeNull();
    demo = finishRound(demo, ['local', 'southern-europe']);
    demo = selectCandidate(demo, 'lin-tuo');
    demo = openTransfer(demo);
    demo = skipTransferInShowcase(demo);
    const result = buildCompletionResult(demo);
    expect(result.clubPatch).toBeUndefined();
    expect(result.clubUpdate).toBeTruthy();
  });
});

describe('球探室 v2：UI 冒烟测试', () => {
  it('维修台不出现推荐/错误模块标签，玩家自己组合模块', () => {
    render(
      createElement(
        ScoutingLevel,
        makeProps({
          mode: 'showcase',
          fastStart: false,
          showcaseOptions: { seed: 20251018, fastPlay: true, startPhase: 'repair' },
        }),
      ),
    );
    expect(screen.queryByText(/推荐/)).toBeNull();
    expect(screen.queryByText(/错误模块/)).toBeNull();
    expect(screen.queryByText(/有副作用/)).toBeNull();
    expect(screen.getAllByText('有限球探').length).toBeGreaterThan(0);
    expect(screen.getAllByText('广撒网考察').length).toBeGreaterThan(0);
  });

  it('正确模块：从故障考察走到归档，onComplete 只触发一次且带 clubUpdate', () => {
    const onComplete = vi.fn();
    const props = makeProps({ onComplete });
    render(createElement(ScoutingLevel, props));

    expect(screen.getByText(/故障试玩：信息全知/)).toBeTruthy();
    clickFaultFlow();
    clickDiagnoseFlow();

    fireEvent.click(screen.getByRole('button', { name: '安装模块：有限球探' }));
    fireEvent.click(screen.getByRole('button', { name: '安装模块：知识度报告' }));
    fireEvent.click(screen.getByRole('button', { name: /开始派遣/ }));

    // 可视化：地图式区域布局、每轮球探数、候选报告区间条。
    expect(screen.getByLabelText('球探区域地图')).toBeTruthy();
    expect(screen.getAllByText(/每轮 2 名球探/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/报告区间/).length).toBeGreaterThan(0);

    // 第 1 轮：本地球市 + 南欧。
    fireEvent.click(screen.getByRole('button', { name: '派球探到本地球市' }));
    fireEvent.click(screen.getByRole('button', { name: '派球探到南欧' }));
    fireEvent.click(screen.getByRole('button', { name: '结束本轮并收回球探' }));
    expect(screen.getAllByText(/知识度 35%/).length).toBeGreaterThan(0);
    // 第 2 轮：北欧 + 南美，四个区域都有报告。
    fireEvent.click(screen.getByRole('button', { name: '派球探到北欧' }));
    fireEvent.click(screen.getByRole('button', { name: '派球探到南美' }));
    fireEvent.click(screen.getByRole('button', { name: '结束本轮并收回球探' }));

    clickSelectableCandidate('本地球市');
    expect(screen.getByText(/验证目标（3 \/ 3 达成）/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '完成验证，去迁移' }));
    clickTransferFlow();

    const archiveButton = screen.getByRole('button', { name: /完成归档，返回修理铺/ });
    fireEvent.click(archiveButton);
    expect(onComplete).toHaveBeenCalledTimes(1);
    const result = onComplete.mock.calls[0][0] as { clubUpdate?: { headline: string; details: string[] } };
    expect(result.clubUpdate).toBeTruthy();
    expect(result.clubUpdate?.details.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(archiveButton);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('装错模块 → 验证未达成 → 回到维修台重新配置 → 可完成', () => {
    const onComplete = vi.fn();
    const props = makeProps({ onComplete });
    render(createElement(ScoutingLevel, props));

    clickFaultFlow();
    clickDiagnoseFlow();

    // 只装有副作用的「广撒网考察」。
    fireEvent.click(screen.getByRole('button', { name: '安装模块：广撒网考察' }));
    fireEvent.click(screen.getByRole('button', { name: /开始派遣/ }));
    fireEvent.click(screen.getByRole('button', { name: '派球探到本地球市' }));
    fireEvent.click(screen.getByRole('button', { name: '派球探到南欧' }));
    fireEvent.click(screen.getByRole('button', { name: '派球探到北欧' }));
    fireEvent.click(screen.getByRole('button', { name: '结束本轮并收回球探' }));
    fireEvent.click(screen.getByRole('button', { name: '派球探到本地球市' }));
    fireEvent.click(screen.getByRole('button', { name: '派球探到南欧' }));
    fireEvent.click(screen.getByRole('button', { name: '派球探到北欧' }));
    fireEvent.click(screen.getByRole('button', { name: '结束本轮并收回球探' }));

    clickSelectableCandidate('本地球市');
    expect(screen.getByText(/验证未达成/)).toBeTruthy();
    expect(screen.getAllByText(/€0.5M/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/转会预算将受影响/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '完成验证，去迁移' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '回到维修台重新配置' }));
    expect(screen.getAllByText(/本关返工 1 次/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/€44.5M/).length).toBeGreaterThan(0);

    // 重新配置：卸载有副作用的模块，安装两个模块，重新派遣。
    fireEvent.click(screen.getByRole('button', { name: '卸载模块：广撒网考察' }));
    fireEvent.click(screen.getByRole('button', { name: '安装模块：有限球探' }));
    fireEvent.click(screen.getByRole('button', { name: '安装模块：知识度报告' }));
    fireEvent.click(screen.getByRole('button', { name: /重新派遣/ }));

    fireEvent.click(screen.getByRole('button', { name: '派球探到本地球市' }));
    fireEvent.click(screen.getByRole('button', { name: '派球探到南欧' }));
    fireEvent.click(screen.getByRole('button', { name: '结束本轮并收回球探' }));
    fireEvent.click(screen.getByRole('button', { name: '派球探到北欧' }));
    fireEvent.click(screen.getByRole('button', { name: '派球探到南美' }));
    fireEvent.click(screen.getByRole('button', { name: '结束本轮并收回球探' }));

    clickSelectableCandidate('本地球市');
    fireEvent.click(screen.getByRole('button', { name: '完成验证，去迁移' }));
    clickTransferFlow();
    fireEvent.click(screen.getByRole('button', { name: /完成归档，返回修理铺/ }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('展示模式从 verify 开始，跳过迁移可完成并带 clubUpdate', () => {
    const onComplete = vi.fn();
    const props = makeProps({
      mode: 'showcase',
      fastStart: false,
      showcaseOptions: { seed: 20251018, fastPlay: true, startPhase: 'verify' },
      onComplete,
    });
    render(createElement(ScoutingLevel, props));

    fireEvent.click(screen.getByRole('button', { name: '派球探到本地球市' }));
    fireEvent.click(screen.getByRole('button', { name: '派球探到南欧' }));
    fireEvent.click(screen.getByRole('button', { name: '结束本轮并收回球探' }));
    clickSelectableCandidate('本地球市');
    fireEvent.click(screen.getByRole('button', { name: '完成验证，去迁移' }));
    fireEvent.click(screen.getByRole('button', { name: '演示跳过迁移题' }));
    fireEvent.click(screen.getByRole('button', { name: /完成归档，返回修理铺/ }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    const result = onComplete.mock.calls[0][0] as {
      evidence: { transferred: boolean };
      clubUpdate?: { headline: string };
      clubPatch?: unknown;
    };
    expect(result.evidence.transferred).toBe(false);
    expect(result.clubUpdate?.headline).toBeTruthy();
    expect(result.clubPatch).toBeUndefined();
  });
});
