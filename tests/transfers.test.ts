import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getLevel } from '../src/game/levels';
import { TransfersLevel } from '../src/game/levels/transfers/TransfersLevel';
import {
  GALAXY_BUDGET_RATIO,
  GALAXY_INTEREST_PENALTY,
  INFINITE_WAIT_EXTRA_INTEREST,
  INFINITE_WAIT_PRICE_CUT,
  REWORK_COST,
  RIVAL_WAIT,
  SCOUT_TARGET_ECONOMICS,
  TRANSFER_BUDGET,
  TRANSFER_MODULE_POOL,
  TRANSFER_QUIZ_CORRECT_ID,
  TRANSFER_ROUNDS,
  TRANSFER_WAGE_SPACE,
  advanceToTransfer,
  answerTransfer,
  archiveProblems,
  budgetBase,
  budgetLimit,
  buildTransfersClubPatch,
  buildTransfersClubUpdate,
  canAdvanceToTransfer,
  canOffer,
  closeWindow,
  createTransfersState,
  directSign,
  finishFaultPlay,
  isGoalMet,
  makeOffer,
  previewOffer,
  previewWait,
  readyWindowState,
  reconfigure,
  reopenWindow,
  requiredSignings,
  resolveDiagnosis,
  reviveTransfersState,
  reworkCostPaid,
  reworkCount,
  roundLimit,
  scoutTargetRivalInterest,
  setModule,
  signedCount,
  signedPlayers,
  skipTransfer,
  startFaultPlay,
  startWindow,
  tierName,
  verificationValid,
  waitTarget,
} from '../src/game/levels/transfers/logic';
import type { TransferModuleId, TransfersState } from '../src/game/levels/transfers/logic';
import type { ClubScoutCandidate, ClubState } from '../src/game/engine/types';

/** 构造一个跨关俱乐部状态；只填测试需要的字段。 */
function makeClub(patch: Partial<ClubState> = {}): ClubState {
  return {
    name: '北港联',
    season: '2026/27',
    week: 1,
    transferBudget: 45,
    wageBudget: 350,
    failures: 0,
    tactics: null,
    scoutedCandidates: [],
    signings: [],
    timeline: [],
    seasonReport: null,
    ...patch,
  };
}

afterEach(cleanup);

function unwrap(result: { ok: boolean; state: TransfersState; reason?: string }): TransfersState {
  if (!result.ok) throw new Error(result.reason ?? '操作失败');
  return result.state;
}

function playerOf(state: TransfersState, id: string) {
  const player = state.players.find((item) => item.id === id);
  if (!player) throw new Error(`找不到 ${id}`);
  return player;
}

function withPlayer(state: TransfersState, id: string, patch: Partial<TransfersState['players'][number]>): TransfersState {
  return { ...state, players: state.players.map((player) => (player.id === id ? { ...player, ...patch } : player)) };
}

/** 从故障试玩、诊断一路走到维修阶段，并按给定配置安装模块。 */
function reachRepair(
  seed: number,
  modules: Partial<Record<TransferModuleId, boolean>> = {},
  club?: ClubState,
): TransfersState {
  let state = createTransfersState({ mode: 'normal', seed, fastStart: true, showcaseOptions: null, club });
  state = unwrap(directSign(state, 'jiang-ye'));
  state = unwrap(finishFaultPlay(state));
  state = unwrap(resolveDiagnosis(state));
  (Object.keys(modules) as TransferModuleId[]).forEach((id) => {
    state = unwrap(setModule(state, id, modules[id] ?? false));
  });
  return state;
}

/** 从故障试玩一路走到正确模块的转会窗口第 1 轮。 */
function reachWindow(seed = 7): TransfersState {
  return unwrap(startWindow(reachRepair(seed, { budget: true, negotiation: true })));
}

describe('转会窗 · 初始状态与种子', () => {
  it('初始为接单阶段，预算、工资、球员都来自常量', () => {
    const state = createTransfersState({ mode: 'normal', seed: 123, fastStart: false, showcaseOptions: null });
    expect(state.version).toBe(4);
    expect(state.phase).toBe('commission');
    expect(state.budget).toBe(TRANSFER_BUDGET);
    expect(state.wage).toBe(TRANSFER_WAGE_SPACE);
    expect(state.startTransferBudget).toBe(TRANSFER_BUDGET);
    expect(state.startWageBudget).toBe(TRANSFER_WAGE_SPACE);
    expect(state.clubFailures).toBe(0);
    expect(state.verifyAttempt).toBe(1);
    expect(state.players).toHaveLength(3);
    expect(state.round).toBe(1);
    expect(state.windowStarted).toBe(false);
    expect(state.evidence).toEqual({ experiencedFault: false, operatedMechanic: false, transferred: false });
  });

  it('相同种子得到相同的球员兴趣与随机状态', () => {
    const a = createTransfersState({ mode: 'normal', seed: 2024, fastStart: false, showcaseOptions: null });
    const b = createTransfersState({ mode: 'normal', seed: 2024, fastStart: false, showcaseOptions: null });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('fastStart 直接从故障试玩开始', () => {
    const state = createTransfersState({ mode: 'normal', seed: 5, fastStart: true, showcaseOptions: null });
    expect(state.phase).toBe('faultPlay');
  });

  it('展示模式下 startPhase 决定起点，fastPlay 缩短窗口', () => {
    const verify = createTransfersState({
      mode: 'showcase',
      seed: 20251018,
      fastStart: false,
      showcaseOptions: { seed: 20251018, fastPlay: true, startPhase: 'verify' },
    });
    expect(verify.phase).toBe('verify');
    expect(verify.modules).toEqual({ budget: true, negotiation: true, galaxy: false, infiniteWait: false });
    expect(verify.windowStarted).toBe(true);
    expect(roundLimit(verify)).toBe(2);
    expect(requiredSignings(verify)).toBe(1);

    const repair = createTransfersState({
      mode: 'showcase',
      seed: 1,
      fastStart: false,
      showcaseOptions: { seed: 1, fastPlay: true, startPhase: 'repair' },
    });
    expect(repair.phase).toBe('repair');
    expect(repair.modules).toEqual({ budget: false, negotiation: false, galaxy: false, infiniteWait: false });
  });
});

describe('转会窗 · 预算与工资双约束', () => {
  it('预算和工资同时扣减，签约失败不扣资源', () => {
    const state = reachWindow();
    const signed = unwrap(makeOffer(state, 'jiang-ye', 'low'));
    expect(playerOf(signed, 'jiang-ye').status).toBe('signed');
    expect(signed.budget).toBe(TRANSFER_BUDGET - (1980 + 80));
    expect(signed.wage).toBe(TRANSFER_WAGE_SPACE - 160);
    expect(signed.evidence.operatedMechanic).toBe(false);
  });

  it('转会预算不足时报价被拒绝', () => {
    let state = reachWindow();
    state = unwrap(makeOffer(state, 'jiang-ye', 'normal'));
    state = unwrap(makeOffer(state, 'mula-ti', 'normal'));
    expect(state.budget).toBe(TRANSFER_BUDGET - 2280 - 1650);
    const check = canOffer(state, 'chen-yan', 'low');
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('预算不足');
    const attempt = makeOffer(state, 'chen-yan', 'low');
    expect(attempt.ok).toBe(false);
    expect(attempt.state).toBe(state);
  });

  it('工资空间不足时报价被拒绝', () => {
    const state = { ...reachWindow(), wage: 10 };
    const check = canOffer(state, 'jiang-ye', 'low');
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('工资空间不足');
  });

  it('预算恰好等于费用时仍可签约', () => {
    const state = { ...reachWindow(), budget: 1980 + 80 };
    const signed = unwrap(makeOffer(state, 'jiang-ye', 'low'));
    expect(signed.budget).toBe(0);
    expect(playerOf(signed, 'jiang-ye').status).toBe('signed');
  });
});

describe('转会窗 · 三档报价与决策预览', () => {
  it('低价报价按九折成交并推高竞争对手兴趣', () => {
    const state = reachWindow();
    const before = playerOf(state, 'jiang-ye');
    const signed = unwrap(makeOffer(state, 'jiang-ye', 'low'));
    expect(signed.budget).toBe(TRANSFER_BUDGET - (Math.round(before.askingPrice * 0.9) + before.agentFee));
    expect(signed.wage).toBe(TRANSFER_WAGE_SPACE - before.wage);
  });

  it('正常报价按当前要价成交，高价报价多付 10% 但保证成交', () => {
    const normalState = reachWindow();
    const normalBefore = playerOf(normalState, 'jiang-ye');
    const normal = unwrap(makeOffer(normalState, 'jiang-ye', 'normal'));
    expect(normal.budget).toBe(TRANSFER_BUDGET - (normalBefore.askingPrice + normalBefore.agentFee));

    const highState = withPlayer(reachWindow(), 'jiang-ye', { rivalInterest: 95 });
    const highBefore = playerOf(highState, 'jiang-ye');
    const high = unwrap(makeOffer(highState, 'jiang-ye', 'high'));
    expect(high.budget).toBe(TRANSFER_BUDGET - (Math.round(highBefore.askingPrice * 1.1) + highBefore.agentFee));
    expect(playerOf(high, 'jiang-ye').status).toBe('signed');
  });

  it('报价前显示预计结果、成交条件、失败后的兴趣变化与签约后资源', () => {
    const state = reachWindow();
    const low = previewOffer(state, 'jiang-ye', 'low');
    expect(low).not.toBeNull();
    expect(low?.expectedSuccess).toBe(true);
    expect(low?.condition).toContain('兴趣 < 50');
    expect(low?.budgetAfter).toBe(TRANSFER_BUDGET - (1980 + 80));
    expect(low?.wageAfter).toBe(TRANSFER_WAGE_SPACE - 160);

    const riskyState = withPlayer(state, 'jiang-ye', { rivalInterest: 60 });
    const risky = previewOffer(riskyState, 'jiang-ye', 'low');
    expect(risky?.expectedSuccess).toBe(false);
    expect(risky?.interestOnFail).toBe(90);
    expect(risky?.expectedText).toContain('预计会被拒绝');
    expect(risky?.expectedText).toContain('失败后兴趣');

    const high = previewOffer(state, 'jiang-ye', 'high');
    expect(high?.expectedSuccess).toBe(true);
    expect(high?.fee).toBe(2420);
    expect(high?.condition).toContain('保证成交');
  });

  it('正常报价在兴趣 ≥ 80 时失败，目标随后被截胡', () => {
    const state = withPlayer(reachWindow(), 'jiang-ye', { rivalInterest: 80 });
    const result = makeOffer(state, 'jiang-ye', 'normal');
    expect(result.ok).toBe(true);
    expect(playerOf(result.state, 'jiang-ye').status).toBe('lost');
    expect(signedCount(result.state)).toBe(0);
  });

  it('低价报价在兴趣 ≥ 50 时失败', () => {
    const state = withPlayer(reachWindow(), 'jiang-ye', { rivalInterest: 60 });
    const result = makeOffer(state, 'jiang-ye', 'low');
    expect(result.ok).toBe(true);
    expect(playerOf(result.state, 'jiang-ye').status).toBe('lost');
  });
});

describe('转会窗 · 等待与竞争兴趣', () => {
  it('等待让要价下降 10%，兴趣 +20，轮末再 +10', () => {
    const state = reachWindow();
    const before = playerOf(state, 'jiang-ye');
    const otherBefore = playerOf(state, 'mula-ti');
    const next = unwrap(waitTarget(state, 'jiang-ye'));
    const after = playerOf(next, 'jiang-ye');
    const otherAfter = playerOf(next, 'mula-ti');
    expect(after.askingPrice).toBe(Math.round(before.askingPrice * 0.9));
    expect(after.rivalInterest).toBe(before.rivalInterest + 20 + 10);
    expect(otherAfter.rivalInterest).toBe(otherBefore.rivalInterest + 10);
    expect(next.round).toBe(2);
    expect(previewWait(state).text).toContain('要价 -10%');
  });

  it('最后一轮等待不会再压低要价', () => {
    const state = { ...reachWindow(), round: TRANSFER_ROUNDS };
    const before = playerOf(state, 'jiang-ye');
    const next = unwrap(waitTarget(state, 'jiang-ye'));
    expect(playerOf(next, 'jiang-ye').askingPrice).toBe(before.askingPrice);
    expect(next.windowClosed).toBe(true);
  });

  it('兴趣达到 100 时被截胡，目标永久失去', () => {
    const state = withPlayer(reachWindow(), 'jiang-ye', { rivalInterest: 75 });
    const next = unwrap(waitTarget(state, 'jiang-ye'));
    expect(playerOf(next, 'jiang-ye').status).toBe('lost');
    expect(playerOf(next, 'jiang-ye').rivalInterest).toBe(100);
    const attempt = makeOffer(next, 'jiang-ye', 'high');
    expect(attempt.ok).toBe(false);
    expect(attempt.reason).toContain('截胡');
  });
});

describe('转会窗 · 错误模块真实改变结果', () => {
  it('「清空预算砸巨星」把预算砍到 30% 并让所有目标兴趣 +30', () => {
    const base = unwrap(startWindow(reachRepair(21, { budget: true, negotiation: true })));
    const galaxy = unwrap(startWindow(reachRepair(21, { budget: true, negotiation: true, galaxy: true })));
    expect(budgetLimit(galaxy)).toBe(Math.floor(TRANSFER_BUDGET * GALAXY_BUDGET_RATIO));
    expect(galaxy.budget).toBe(1350);
    galaxy.players.forEach((player, index) => {
      expect(player.rivalInterest).toBe(Math.min(100, (base.players[index]?.rivalInterest ?? 0) + GALAXY_INTEREST_PENALTY));
    });
    // 最多只能签下 1 人：高价签下门将后预算只剩下 100 万欧。
    let state = unwrap(makeOffer(galaxy, 'chen-yan', 'high'));
    expect(state.budget).toBe(100);
    expect(makeOffer(state, 'mula-ti', 'normal').ok).toBe(false);
    state = unwrap(closeWindow(state));
    expect(isGoalMet(state)).toBe(false);
    expect(canAdvanceToTransfer(state)).toBe(false);
    expect(archiveProblems(state).join('')).toContain('签约人数不足');
    expect(advanceToTransfer(state).ok).toBe(false);
  });

  it('「无限等待」压价 20% 但每次等待兴趣 +45，第二个等待就可能被截胡', () => {
    const state = unwrap(startWindow(reachRepair(21, { budget: true, negotiation: true, infiniteWait: true })));
    expect(previewWait(state).interestGain).toBe(RIVAL_WAIT + INFINITE_WAIT_EXTRA_INTEREST);
    expect(previewWait(state).priceCutRatio).toBe(INFINITE_WAIT_PRICE_CUT);
    const before = playerOf(state, 'jiang-ye');
    const once = unwrap(waitTarget(state, 'jiang-ye'));
    expect(playerOf(once, 'jiang-ye').askingPrice).toBe(Math.round(before.askingPrice * (1 - INFINITE_WAIT_PRICE_CUT)));
    expect(playerOf(once, 'jiang-ye').rivalInterest).toBe(
      before.rivalInterest + RIVAL_WAIT + INFINITE_WAIT_EXTRA_INTEREST + 10,
    );
    const twice = unwrap(waitTarget(once, 'jiang-ye'));
    expect(playerOf(twice, 'jiang-ye').status).toBe('lost');
  });

  it('缺少正确模块也能开始验证，但结果无效、归档被逻辑阻止', () => {
    const started = unwrap(startWindow(reachRepair(21, { negotiation: true })));
    // 没有预算模块：签约不扣预算、不检查预算与工资。
    const signed = unwrap(makeOffer(started, 'jiang-ye', 'low'));
    expect(signed.budget).toBe(TRANSFER_BUDGET);
    expect(signed.wage).toBe(TRANSFER_WAGE_SPACE);
    const closed = unwrap(closeWindow(signed));
    expect(archiveProblems(closed).some((problem) => problem.includes('验证配置不完整'))).toBe(true);
    expect(canAdvanceToTransfer(closed)).toBe(false);
    expect(advanceToTransfer(closed).ok).toBe(false);

    const noNegotiation = unwrap(startWindow(reachRepair(21, { budget: true })));
    expect(verificationValid(noNegotiation)).toBe(false);
    const forced = withPlayer(noNegotiation, 'jiang-ye', { rivalInterest: 95 });
    const signedAnyway = unwrap(makeOffer(forced, 'jiang-ye', 'normal'));
    expect(playerOf(signedAnyway, 'jiang-ye').status).toBe('signed');
    expect(playerOf(signedAnyway, 'jiang-ye').rivalInterest).toBe(95);
    const closed2 = unwrap(closeWindow(signedAnyway));
    expect(archiveProblems(closed2).some((problem) => problem.includes('验证配置不完整'))).toBe(true);
  });

  it('装错模块 → 未达成 → 回到维修台重新配置 → 换模块后可以完成', () => {
    let state = unwrap(startWindow(reachRepair(21, { budget: true, negotiation: true, galaxy: true })));
    state = unwrap(makeOffer(state, 'chen-yan', 'high'));
    state = unwrap(closeWindow(state));
    expect(canAdvanceToTransfer(state)).toBe(false);
    expect(archiveProblems(state).join('')).toContain('签约人数不足');

    state = unwrap(reconfigure(state));
    expect(state.phase).toBe('repair');
    expect(state.verifyAttempt).toBe(2);
    expect(state.windowStarted).toBe(false);
    // 返工成本 €1M：预算基数 4500 → 4400，再套用「砸巨星」的 30%。
    expect(state.budget).toBe(1320);
    expect(state.startTransferBudget).toBe(TRANSFER_BUDGET);
    expect(signedCount(state)).toBe(0);
    expect(state.evidence.experiencedFault).toBe(true);
    expect(state.evidence.operatedMechanic).toBe(false);
    expect(state.eventLog.every((entry) => entry.phase !== 'verify')).toBe(true);
    expect(state.modules.galaxy).toBe(true);

    // 卸载错误模块，重新开始第二次验证。
    state = unwrap(setModule(state, 'galaxy', false));
    state = unwrap(startWindow(state));
    expect(state.budget).toBe(TRANSFER_BUDGET - REWORK_COST);
    expect(state.verifyAttempt).toBe(2);
    state = unwrap(makeOffer(state, 'jiang-ye', 'low'));
    state = unwrap(makeOffer(state, 'mula-ti', 'normal'));
    state = unwrap(closeWindow(state));
    expect(canAdvanceToTransfer(state)).toBe(true);
    expect(state.evidence.operatedMechanic).toBe(true);
    state = unwrap(advanceToTransfer(state));
    state = unwrap(answerTransfer(state, TRANSFER_QUIZ_CORRECT_ID));
    expect(state.phase).toBe('summary');
    expect(state.evidence).toEqual({ experiencedFault: true, operatedMechanic: true, transferred: true });
  });
});

describe('转会窗 · 窗口结束与重开', () => {
  it('3 轮动作后窗口自动关闭，之后不能继续操作', () => {
    let state = reachWindow();
    state = unwrap(waitTarget(state, 'jiang-ye'));
    state = unwrap(waitTarget(state, 'mula-ti'));
    state = unwrap(waitTarget(state, 'chen-yan'));
    expect(state.windowClosed).toBe(true);
    expect(state.round).toBe(TRANSFER_ROUNDS + 1);
    expect(state.evidence.operatedMechanic).toBe(true);
    const attempt = makeOffer(state, 'jiang-ye', 'high');
    expect(attempt.ok).toBe(false);
    expect(attempt.reason).toContain('关闭');
  });

  it('手动提前关闭窗口结算，可重开窗口（保留模块）', () => {
    const state = reachWindow();
    const closed = unwrap(closeWindow(state));
    expect(closed.windowClosed).toBe(true);
    expect(closed.evidence.operatedMechanic).toBe(false);
    const reopened = unwrap(reopenWindow(closed));
    expect(reopened.windowClosed).toBe(false);
    expect(reopened.round).toBe(1);
    expect(reopened.budget).toBe(TRANSFER_BUDGET);
    expect(reopened.wage).toBe(TRANSFER_WAGE_SPACE);
    expect(reopened.players.every((player) => player.status === 'available')).toBe(true);
  });
});

describe('转会窗 · 完成判定与迁移题', () => {
  it('签下 2 人即达成目标，之后进入迁移题并补全证据', () => {
    let state = reachWindow();
    state = unwrap(makeOffer(state, 'jiang-ye', 'low'));
    state = unwrap(makeOffer(state, 'mula-ti', 'normal'));
    expect(isGoalMet(state)).toBe(true);
    expect(signedCount(state)).toBe(2);
    expect(signedPlayers(state)).toHaveLength(2);
    state = unwrap(closeWindow(state));
    expect(state.evidence.operatedMechanic).toBe(true);
    const wrong = answerTransfer(state, 'budget-only');
    expect(wrong.ok).toBe(false);
    expect(wrong.correct).toBe(false);
    const advanced = unwrap(advanceToTransfer(state));
    expect(advanced.phase).toBe('transfer');
    const done = unwrap(answerTransfer(advanced, TRANSFER_QUIZ_CORRECT_ID));
    expect(done.phase).toBe('summary');
    expect(done.evidence.transferred).toBe(true);
  });

  it('只签 1 人时不算完成，不能进入迁移题，但可以重开窗口', () => {
    let state = reachWindow();
    state = unwrap(makeOffer(state, 'jiang-ye', 'low'));
    state = unwrap(closeWindow(state));
    expect(isGoalMet(state)).toBe(false);
    const attempt = advanceToTransfer(state);
    expect(attempt.ok).toBe(false);
    expect(attempt.reason).toContain('签约人数不足');
    expect(reopenWindow(state).ok).toBe(true);
  });

  it('展示模式可以跳过迁移题，但 evidence.transferred 保持 false', () => {
    let state = createTransfersState({
      mode: 'showcase',
      seed: 20251018,
      fastStart: false,
      showcaseOptions: { seed: 20251018, fastPlay: true, startPhase: 'verify' },
    });
    state = unwrap(makeOffer(state, 'chen-yan', 'low'));
    state = unwrap(closeWindow(state));
    state = unwrap(advanceToTransfer(state));
    const skipped = unwrap(skipTransfer(state));
    expect(skipped.phase).toBe('summary');
    expect(skipped.transferSkipped).toBe(true);
    expect(skipped.evidence.transferred).toBe(false);
  });
});

describe('转会窗 · 非法操作保护', () => {
  it('接单阶段不能报价、签人、装模块或开窗口', () => {
    const state = createTransfersState({ mode: 'normal', seed: 3, fastStart: false, showcaseOptions: null });
    expect(makeOffer(state, 'jiang-ye', 'low').ok).toBe(false);
    expect(directSign(state, 'jiang-ye').ok).toBe(false);
    expect(setModule(state, 'budget', true).ok).toBe(false);
    expect(startWindow(state).ok).toBe(false);
    expect(finishFaultPlay(state).ok).toBe(false);
    expect(startFaultPlay(state).ok).toBe(true);
  });

  it('故障试玩里不能重复签下同一名球员，也不能直接结束', () => {
    const state = createTransfersState({ mode: 'normal', seed: 3, fastStart: true, showcaseOptions: null });
    const first = unwrap(directSign(state, 'jiang-ye'));
    const duplicate = directSign(first, 'jiang-ye');
    expect(duplicate.ok).toBe(false);
    expect(duplicate.reason).toContain('已经签下');
    expect(finishFaultPlay(createTransfersState({ mode: 'normal', seed: 3, fastStart: true, showcaseOptions: null })).ok).toBe(
      false,
    );
  });

  it('窗口开始后模块锁定；未结束窗口不能回维修台或归档', () => {
    let state = reachRepair(3, { budget: true });
    const window = unwrap(startWindow(state));
    const locked = setModule(window, 'budget', false);
    expect(locked.ok).toBe(false);
    expect(reconfigure(window).ok).toBe(false);
    state = unwrap(setModule(state, 'negotiation', true));
    expect(state.phase).toBe('repair');
  });

  it('窗口内重复报价、未知目标、关闭后继续操作都被拒绝', () => {
    let state = reachWindow();
    expect(makeOffer(state, 'nobody', 'low').ok).toBe(false);
    state = unwrap(makeOffer(state, 'jiang-ye', 'low'));
    expect(makeOffer(state, 'jiang-ye', 'high').ok).toBe(false);
    const closed = unwrap(closeWindow(state));
    expect(waitTarget(closed, 'mula-ti').ok).toBe(false);
    expect(skipTransfer(closed).ok).toBe(false);
    expect(closeWindow(closed).ok).toBe(false);
  });

  it('正常模式不能跳过迁移题，窗口未关闭也不能进入迁移题', () => {
    const state = reachWindow();
    expect(advanceToTransfer(state).ok).toBe(false);
    expect(skipTransfer({ ...state, phase: 'transfer' }).ok).toBe(false);
  });
});

describe('转会窗 · 同种子与存档恢复', () => {
  function scenario(seed: number): TransfersState {
    let state = reachWindow(seed);
    state = unwrap(makeOffer(state, 'jiang-ye', 'low'));
    state = unwrap(makeOffer(state, 'mula-ti', 'normal'));
    state = unwrap(waitTarget(state, 'chen-yan'));
    return state;
  }

  it('同种子、同动作序列得到相同结果', () => {
    expect(JSON.stringify(scenario(42))).toBe(JSON.stringify(scenario(42)));
  });

  it('序列化再恢复后状态与随机状态一致', () => {
    const state = scenario(77);
    const revived = reviveTransfersState(JSON.parse(JSON.stringify(state)));
    expect(revived).not.toBeNull();
    expect(revived).toEqual(state);
  });

  it('恢复后继续操作得到相同结果', () => {
    let state = reachWindow(88);
    state = unwrap(makeOffer(state, 'jiang-ye', 'low'));
    const revived = reviveTransfersState(JSON.parse(JSON.stringify(state))) as TransfersState;
    const a = unwrap(makeOffer(state, 'mula-ti', 'normal'));
    const b = unwrap(makeOffer(revived, 'mula-ti', 'normal'));
    expect(a).toEqual(b);
  });

  it('损坏存档返回 null', () => {
    const state = reachWindow(9);
    expect(reviveTransfersState(null)).toBeNull();
    expect(reviveTransfersState(undefined)).toBeNull();
    expect(reviveTransfersState(42)).toBeNull();
    expect(reviveTransfersState({})).toBeNull();
    expect(reviveTransfersState({ ...state, version: 1 })).toBeNull();
    expect(reviveTransfersState({ ...state, players: [] })).toBeNull();
    expect(reviveTransfersState({ ...state, budget: -1 })).toBeNull();
    expect(reviveTransfersState({ ...state, evidence: {} })).toBeNull();
    expect(reviveTransfersState({ ...state, eventLog: [{ bad: true }] })).toBeNull();
    expect(reviveTransfersState({ ...state, modules: { budget: true } })).toBeNull();
  });
});

describe('转会窗 · 证据标记与俱乐部时间线', () => {
  it('故障试玩完成 → experiencedFault；有效窗口关闭 → operatedMechanic；迁移题正确 → transferred', () => {
    let state = createTransfersState({ mode: 'normal', seed: 11, fastStart: true, showcaseOptions: null });
    state = unwrap(directSign(state, 'jiang-ye'));
    state = unwrap(finishFaultPlay(state));
    expect(state.evidence.experiencedFault).toBe(true);
    expect(state.evidence.operatedMechanic).toBe(false);
    state = unwrap(resolveDiagnosis(state));
    state = unwrap(setModule(state, 'budget', true));
    state = unwrap(setModule(state, 'negotiation', true));
    state = unwrap(startWindow(state));
    state = unwrap(makeOffer(state, 'jiang-ye', 'low'));
    state = unwrap(makeOffer(state, 'mula-ti', 'normal'));
    state = unwrap(closeWindow(state));
    expect(state.evidence.operatedMechanic).toBe(true);
    expect(state.evidence.transferred).toBe(false);
    state = unwrap(advanceToTransfer(state));
    state = unwrap(answerTransfer(state, TRANSFER_QUIZ_CORRECT_ID));
    expect(state.evidence.transferred).toBe(true);
  });

  it('clubUpdate 只写真实签约、花费、工资与错过原因', () => {
    let state = reachWindow();
    state = unwrap(makeOffer(state, 'jiang-ye', 'low'));
    state = unwrap(makeOffer(state, 'mula-ti', 'normal'));
    state = unwrap(closeWindow(state));
    const club = buildTransfersClubUpdate(state);
    const spent = Math.max(0, budgetLimit(state) - state.budget);
    expect(club.headline).toContain('签下 2/3');
    expect(club.headline).toContain('€');
    expect(club.headline).toContain('花费');
    expect(club.details).toHaveLength(5);
    expect(club.details.join('')).toContain(`${Math.max(0, TRANSFER_WAGE_SPACE - state.wage)}k/周`);
    expect(club.details.join('')).toContain('陈砚');
    expect(club.details.join('')).toContain('预算与工资空间');
    expect(club.details[1]).toContain('€');
    expect(club.details.join('')).toContain(`${Math.round((spent / 100) * 10) / 10}`);
    expect(club.nextBrief).toBeTruthy();
  });

  it('模块池包含两个正确模块与两个错误模块，错误模块有真实副作用说明', () => {
    expect(TRANSFER_MODULE_POOL).toHaveLength(4);
    expect(TRANSFER_MODULE_POOL.filter((module) => module.kind === 'correct').map((module) => module.id)).toEqual([
      'budget',
      'negotiation',
    ]);
    expect(TRANSFER_MODULE_POOL.filter((module) => module.kind === 'risky').map((module) => module.id)).toEqual([
      'galaxy',
      'infiniteWait',
    ]);
    TRANSFER_MODULE_POOL
      .filter((module) => module.kind === 'risky')
      .forEach((module) => expect(module.sideEffect.length).toBeGreaterThan(10));
    expect(tierName('low')).toBe('低价报价');
  });
});

describe('转会窗 · UI 冒烟测试', () => {
  it('从窗口签到结算再到归档，onComplete 只触发一次并带 clubUpdate', () => {
    const saved = readyWindowState(2024);
    const onSaveState = vi.fn();
    const onComplete = vi.fn();
    const onExit = vi.fn();
    render(
      createElement(TransfersLevel, {
        level: getLevel('transfers'),
        mode: 'normal',
        fastStart: false,
        showcaseOptions: null,
        savedState: saved,
        onSaveState,
        onComplete,
        onExit,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /低价报价：江野/ }));
    fireEvent.click(screen.getByRole('button', { name: /正常报价：木拉提/ }));
    fireEvent.click(screen.getByRole('button', { name: '提前关闭窗口并结算' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭窗口并结算' }));
    fireEvent.click(screen.getByRole('button', { name: '进入迁移题' }));
    fireEvent.click(screen.getByRole('radio', { name: /预算和工资空间决定/ }));
    fireEvent.click(screen.getByRole('button', { name: '提交判断' }));
    expect(screen.getByText('归档 · 这次维修留下了什么')).toBeTruthy();
    expect(onComplete).toHaveBeenCalledTimes(1);
    const payload = onComplete.mock.calls[0]?.[0] as {
      clubUpdate?: { headline: string; details: string[] };
      clubPatch?: { signings: unknown[]; transferBudget: number; wageBudget: number; addFailures: number };
    };
    expect(payload.clubUpdate?.headline).toContain('签下 2/3');
    expect(payload.clubUpdate?.details).toHaveLength(5);
    expect(payload.clubPatch?.signings).toHaveLength(2);
    expect(payload.clubPatch?.transferBudget).toBeGreaterThanOrEqual(0);
    expect(payload.clubPatch?.addFailures).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: '完成委托并返回修理铺' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('fastStart 从故障试玩开始，诊断答对后进入维修，模块池显示 4 张卡', () => {
    render(
      createElement(TransfersLevel, {
        level: getLevel('transfers'),
        mode: 'normal',
        fastStart: true,
        showcaseOptions: null,
        savedState: undefined,
        onSaveState: vi.fn(),
        onComplete: vi.fn(),
        onExit: vi.fn(),
      }),
    );
    expect(screen.getByText('故障试玩 · 旧版转会窗')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '直接签下' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '结束故障试玩，进入诊断' }));
    fireEvent.click(screen.getByRole('radio', { name: /签约缺少预算/ }));
    fireEvent.click(screen.getByRole('button', { name: '提交判断' }));
    expect(screen.getByText('维修 · 从模块池里挑规则')).toBeTruthy();
    expect(screen.getByRole('button', { name: '安装模块：清空预算砸巨星' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '安装模块：无限等待' })).toBeTruthy();
    // 模块 card 里不再出现「正确 / 错误 / 推荐」这类答案提示。
    expect(screen.queryByText(/错误模块|正确模块|推荐组合/)).toBeNull();
  });

  it('错误模块导致未达成时显示具体原因，并可点击回到维修台重新配置', () => {
    let state = unwrap(startWindow(reachRepair(33, { budget: true, negotiation: true, galaxy: true })));
    state = unwrap(makeOffer(state, 'chen-yan', 'high'));
    state = unwrap(closeWindow(state));
    render(
      createElement(TransfersLevel, {
        level: getLevel('transfers'),
        mode: 'normal',
        fastStart: false,
        showcaseOptions: null,
        savedState: state,
        onSaveState: vi.fn(),
        onComplete: vi.fn(),
        onExit: vi.fn(),
      }),
    );
    expect(screen.getByText('还不能归档')).toBeTruthy();
    expect(screen.getByText(/签约人数不足/)).toBeTruthy();
    expect(screen.getAllByText(/俱乐部承担 €1M 返工成本（谈判\/经纪），转会预算将受影响/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '进入迁移题' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '回到维修台重新配置' }));
    expect(screen.getByText('维修 · 从模块池里挑规则')).toBeTruthy();
    expect(screen.getByRole('button', { name: '卸载模块：清空预算砸巨星' })).toBeTruthy();
  });
});

/* ==========================================================================
   v4：跨关俱乐部预算、返工成本与跨关提交
   ========================================================================== */

describe('转会窗 v4 · 跨关俱乐部预算', () => {
  it('从 club 读取起始转会预算、周薪空间与历史返工次数', () => {
    const club = makeClub({ transferBudget: 30, wageBudget: 200, failures: 2 });
    const state = reachRepair(7, { budget: true, negotiation: true }, club);
    expect(state.startTransferBudget).toBe(3000);
    expect(state.startWageBudget).toBe(200);
    expect(state.clubFailures).toBe(2);
    const window = unwrap(startWindow(state));
    expect(window.budget).toBe(3000);
    expect(window.wage).toBe(200);
    expect(budgetLimit(window)).toBe(3000);
    expect(budgetBase(window)).toBe(3000);
  });

  it('每次重新配置扣 €1M 返工成本，最低为 0', () => {
    const club = makeClub({ transferBudget: 30, wageBudget: 200 });
    let state = unwrap(startWindow(reachRepair(7, { budget: true, negotiation: true }, club)));
    expect(state.budget).toBe(3000);
    state = unwrap(makeOffer(state, 'chen-yan', 'high'));
    state = unwrap(closeWindow(state));
    state = unwrap(reconfigure(state));
    expect(reworkCount(state)).toBe(1);
    expect(state.budget).toBe(2900);
    state = unwrap(startWindow(state));
    expect(state.budget).toBe(2900);
    state = unwrap(closeWindow(state));
    state = unwrap(reconfigure(state));
    expect(reworkCount(state)).toBe(2);
    expect(state.budget).toBe(2800);
    expect(reworkCostPaid(state)).toBe(2 * REWORK_COST);
    const poor = makeClub({ transferBudget: 0.5, wageBudget: 100 });
    let low = unwrap(startWindow(reachRepair(9, { budget: true, negotiation: true }, poor)));
    expect(low.budget).toBe(50);
    low = unwrap(closeWindow(low));
    low = unwrap(reconfigure(low));
    expect(low.budget).toBe(0);
    low = unwrap(startWindow(low));
    expect(low.budget).toBe(0);
    const patch = buildTransfersClubPatch(low);
    expect(patch.transferBudget).toBe(0);
    expect(patch.addFailures).toBe(1);
  });

  it('clubPatch 提交真实签约、绝对剩余预算与返工次数', () => {
    const club = makeClub({ transferBudget: 45, wageBudget: 350 });
    let state = unwrap(startWindow(reachRepair(7, { budget: true, negotiation: true }, club)));
    state = unwrap(makeOffer(state, 'jiang-ye', 'low'));
    state = unwrap(makeOffer(state, 'mula-ti', 'normal'));
    state = unwrap(closeWindow(state));
    const patch = buildTransfersClubPatch(state);
    expect(patch.signings).toHaveLength(2);
    expect(patch.signings?.[0]).toMatchObject({
      id: 'jiang-ye',
      name: '江野',
      position: '边锋',
      fee: 19.8,
      wage: 160,
      homegrown: true,
    });
    expect(patch.signings?.[1]?.homegrown).toBe(false);
    expect(patch.transferBudget).toBe(Math.round((state.budget / 100) * 10) / 10);
    expect(patch.wageBudget).toBe(state.wage);
    expect(patch.addFailures).toBe(0);
  });

  it('失败与跨关信息写进 clubUpdate', () => {
    const club = makeClub({ transferBudget: 30, wageBudget: 250, failures: 1 });
    let state = unwrap(startWindow(reachRepair(7, { budget: true, negotiation: true }, club)));
    state = unwrap(closeWindow(state));
    state = unwrap(reconfigure(state));
    state = unwrap(startWindow(state));
    state = unwrap(makeOffer(state, 'chen-yan', 'low'));
    state = unwrap(makeOffer(state, 'mula-ti', 'low'));
    state = unwrap(closeWindow(state));
    const update = buildTransfersClubUpdate(state);
    expect(update.details.join('')).toContain('返工 1 次');
    expect(update.details.join('')).toContain('返工成本 €1M');
    expect(update.details.join('')).toContain('跨关引援');
    expect(update.details.join('')).toContain('陈砚');
  });

  it('展示模式没有 club 时使用默认预算', () => {
    const state = createTransfersState({
      mode: 'showcase',
      seed: 20251018,
      fastStart: false,
      showcaseOptions: { seed: 20251018, fastPlay: true, startPhase: 'verify' },
    });
    expect(state.startTransferBudget).toBe(TRANSFER_BUDGET);
    expect(state.startWageBudget).toBe(TRANSFER_WAGE_SPACE);
    expect(state.clubFailures).toBe(0);
    const patch = buildTransfersClubPatch(state);
    expect(patch.addFailures).toBe(0);
  });
});

/* ==========================================================================
   v5：球探室候选接入转会窗
   ========================================================================== */

const SCOUT_TARGETS: ClubScoutCandidate[] = [
  { id: 'lin-tuo', name: '林拓', position: '中后卫', region: 'local', knowledge: 90 },
  { id: 'luka-payne', name: '卢卡·佩恩', position: '左边锋', region: 'local', knowledge: 70 },
  { id: 'kai-ferro', name: '凯·费罗', position: '后腰', region: 'southern-europe', knowledge: 40 },
];

describe('转会窗 v5 · 球探室额外目标', () => {
  it('开始窗口时最多加入 2 名球探目标，并显示知识度与确定性费用', () => {
    const club = makeClub({ scoutedCandidates: SCOUT_TARGETS });
    const repair = reachRepair(7, { budget: true, negotiation: true }, club);
    expect(repair.players).toHaveLength(3);
    const window = unwrap(startWindow(repair));
    expect(window.players).toHaveLength(5);
    const extras = window.players.filter((player) => player.source === 'scout');
    expect(extras.map((player) => player.name)).toEqual(['林拓', '卢卡·佩恩']);
    expect(extras[0]).toMatchObject({
      id: 'scout-lin-tuo',
      position: '中后卫',
      valuation: SCOUT_TARGET_ECONOMICS.DF.fee,
      wage: SCOUT_TARGET_ECONOMICS.DF.wage,
      agentFee: SCOUT_TARGET_ECONOMICS.DF.agentFee,
      homegrown: true,
      knowledge: 90,
      source: 'scout',
    });
    expect(extras[1]).toMatchObject({
      id: 'scout-luka-payne',
      position: '左边锋',
      valuation: SCOUT_TARGET_ECONOMICS.FW.fee,
      wage: SCOUT_TARGET_ECONOMICS.FW.wage,
      homegrown: true,
      knowledge: 70,
    });
    expect(extras[0].scoutRegionLabel).toContain('本地球探');
    expect(window.players.some((player) => player.name === '凯·费罗')).toBe(false);
  });

  it('知识度越高，初始竞争兴趣越低', () => {
    const high = scoutTargetRivalInterest(95);
    const mid = scoutTargetRivalInterest(70);
    const low = scoutTargetRivalInterest(30);
    expect(high).toBeLessThan(mid);
    expect(mid).toBeLessThan(low);
    const club = makeClub({ scoutedCandidates: [SCOUT_TARGETS[0], SCOUT_TARGETS[2]] });
    const window = unwrap(startWindow(reachRepair(7, { budget: true, negotiation: true }, club)));
    const highPlayer = window.players.find((player) => player.name === '林拓');
    const lowPlayer = window.players.find((player) => player.name === '凯·费罗');
    expect(highPlayer?.rivalInterest).toBe(scoutTargetRivalInterest(90));
    expect(lowPlayer?.rivalInterest).toBe(scoutTargetRivalInterest(40));
  });

  it('没有 club 或球探候选为空时保持 3 名目标', () => {
    const noClub = unwrap(startWindow(reachRepair(7, { budget: true, negotiation: true })));
    expect(noClub.players).toHaveLength(3);
    const emptyClub = unwrap(
      startWindow(reachRepair(7, { budget: true, negotiation: true }, makeClub({ scoutedCandidates: [] }))),
    );
    expect(emptyClub.players).toHaveLength(3);
  });

  it('球探目标可以签约、计入至少 2 人并进入 clubPatch.signings', () => {
    const club = makeClub({ scoutedCandidates: SCOUT_TARGETS });
    let state = unwrap(startWindow(reachRepair(7, { budget: true, negotiation: true }, club)));
    state = unwrap(makeOffer(state, 'scout-lin-tuo', 'low'));
    expect(playerOf(state, 'scout-lin-tuo').status).toBe('signed');
    state = unwrap(makeOffer(state, 'mula-ti', 'normal'));
    expect(isGoalMet(state)).toBe(true);
    state = unwrap(closeWindow(state));
    const patch = buildTransfersClubPatch(state);
    expect(patch.signings).toHaveLength(2);
    const scoutSigning = patch.signings?.find((signing) => signing.id === 'scout-lin-tuo');
    expect(scoutSigning).toMatchObject({
      id: 'scout-lin-tuo',
      name: '林拓',
      position: '中后卫',
      fee: 14.4,
      wage: 120,
      homegrown: true,
    });
    expect(buildTransfersClubUpdate(state).details.join('')).toContain('球探室带来的目标：林拓');
  });

  it('球探目标进入存档恢复；损坏的球探候选会被拒绝', () => {
    const club = makeClub({ scoutedCandidates: SCOUT_TARGETS });
    const window = unwrap(startWindow(reachRepair(7, { budget: true, negotiation: true }, club)));
    const revived = reviveTransfersState(JSON.parse(JSON.stringify(window)));
    expect(revived).toEqual(window);
    expect(reviveTransfersState({ ...JSON.parse(JSON.stringify(window)), scoutTargets: 'nope' })).toBeNull();
    const badPlayers = JSON.parse(JSON.stringify(window));
    badPlayers.players = badPlayers.players.slice(0, 4);
    expect(reviveTransfersState(badPlayers)).toBeNull();
  });

  it('窗口内显示球探知识度，并可以点按钮签下球探目标', () => {
    const club = makeClub({ scoutedCandidates: SCOUT_TARGETS });
    const window = unwrap(startWindow(reachRepair(7, { budget: true, negotiation: true }, club)));
    render(
      createElement(TransfersLevel, {
        level: getLevel('transfers'),
        mode: 'normal',
        fastStart: false,
        showcaseOptions: null,
        club,
        savedState: window,
        onSaveState: vi.fn(),
        onComplete: vi.fn(),
        onExit: vi.fn(),
      }),
    );
    expect(screen.getAllByText(/知识度 90%/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('球探室报告').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /正常报价：林拓/ }));
    expect(screen.getByText('已签约')).toBeTruthy();
  });
});

describe('转会窗 v4 · UI 跨关面板', () => {
  it('俱乐部面板显示历史返工与 €1M 成本提示', () => {
    const club = makeClub({ transferBudget: 30, wageBudget: 200, failures: 3 });
    const state = unwrap(startWindow(reachRepair(7, { budget: true, negotiation: true }, club)));
    render(
      createElement(TransfersLevel, {
        level: getLevel('transfers'),
        mode: 'normal',
        fastStart: false,
        showcaseOptions: null,
        club,
        savedState: state,
        onSaveState: vi.fn(),
        onComplete: vi.fn(),
        onExit: vi.fn(),
      }),
    );
    expect(screen.getByText('俱乐部状态')).toBeTruthy();
    expect(screen.getByText('俱乐部历史返工')).toBeTruthy();
    expect(screen.getAllByText(/€1M/).length).toBeGreaterThan(0);
  });
});
