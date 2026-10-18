import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getLevel } from '../src/game/levels';
import { TransfersLevel } from '../src/game/levels/transfers/TransfersLevel';
import {
  TRANSFER_BUDGET,
  TRANSFER_QUIZ_CORRECT_ID,
  TRANSFER_REQUIRED_SIGNINGS,
  TRANSFER_ROUNDS,
  TRANSFER_WAGE_SPACE,
  advanceToTransfer,
  answerTransfer,
  canOffer,
  closeWindow,
  createTransfersState,
  directSign,
  finishFaultPlay,
  isGoalMet,
  makeOffer,
  readyWindowState,
  reopenWindow,
  requiredSignings,
  resolveDiagnosis,
  reviveTransfersState,
  roundLimit,
  setModule,
  signedCount,
  signedPlayers,
  skipTransfer,
  startFaultPlay,
  startWindow,
  waitTarget,
} from '../src/game/levels/transfers/logic';
import type { TransfersState } from '../src/game/levels/transfers/logic';

afterEach(cleanup);

function unwrap(result: { ok: boolean; state: TransfersState; reason?: string }): TransfersState {
  if (!result.ok) throw new Error(result.reason ?? '操作失败');
  return result.state;
}

/** 从故障试玩一路走到转会窗口第 1 轮。 */
function reachWindow(seed = 7): TransfersState {
  let state = createTransfersState({ mode: 'normal', seed, fastStart: true, showcaseOptions: null });
  state = unwrap(directSign(state, 'jiang-ye'));
  state = unwrap(finishFaultPlay(state));
  state = unwrap(resolveDiagnosis(state));
  state = unwrap(setModule(state, 'budget', true));
  state = unwrap(setModule(state, 'negotiation', true));
  state = unwrap(startWindow(state));
  return state;
}

function playerOf(state: TransfersState, id: string) {
  const player = state.players.find((item) => item.id === id);
  if (!player) throw new Error(`找不到 ${id}`);
  return player;
}

function withPlayer(state: TransfersState, id: string, patch: Partial<TransfersState['players'][number]>): TransfersState {
  return { ...state, players: state.players.map((player) => (player.id === id ? { ...player, ...patch } : player)) };
}

describe('转会窗 · 初始状态与种子', () => {
  it('初始为接单阶段，预算、工资、球员都来自常量', () => {
    const state = createTransfersState({ mode: 'normal', seed: 123, fastStart: false, showcaseOptions: null });
    expect(state.phase).toBe('commission');
    expect(state.budget).toBe(TRANSFER_BUDGET);
    expect(state.wage).toBe(TRANSFER_WAGE_SPACE);
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
    expect(verify.modules).toEqual({ budget: true, negotiation: true });
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
    expect(repair.modules).toEqual({ budget: false, negotiation: false });
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

describe('转会窗 · 三档报价', () => {
  it('低价报价按九折成交并推高竞争对手兴趣', () => {
    const state = reachWindow();
    const before = playerOf(state, 'jiang-ye');
    const signed = unwrap(makeOffer(state, 'jiang-ye', 'low'));
    expect(signed.budget).toBe(TRANSFER_BUDGET - (Math.round(before.askingPrice * 0.9) + before.agentFee));
    expect(signed.wage).toBe(TRANSFER_WAGE_SPACE - before.wage);
  });

  it('正常报价按当前要价成交', () => {
    const state = reachWindow();
    const before = playerOf(state, 'jiang-ye');
    const signed = unwrap(makeOffer(state, 'jiang-ye', 'normal'));
    expect(signed.budget).toBe(TRANSFER_BUDGET - (before.askingPrice + before.agentFee));
  });

  it('高价报价多付 10% 但保证成交', () => {
    const state = withPlayer(reachWindow(), 'jiang-ye', { rivalInterest: 95 });
    const before = playerOf(state, 'jiang-ye');
    const signed = unwrap(makeOffer(state, 'jiang-ye', 'high'));
    expect(signed.budget).toBe(TRANSFER_BUDGET - (Math.round(before.askingPrice * 1.1) + before.agentFee));
    expect(playerOf(signed, 'jiang-ye').status).toBe('signed');
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

  it('手动提前关闭窗口结算，可重开窗口', () => {
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
    expect(reopened.eventLog.length).toBeGreaterThan(closed.eventLog.length - 1);
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
    expect(attempt.reason).toContain(`至少签下 ${TRANSFER_REQUIRED_SIGNINGS}`);
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

  it('模块没装齐不能开窗口；窗口开始后模块锁定', () => {
    let state = createTransfersState({ mode: 'normal', seed: 3, fastStart: false, showcaseOptions: null });
    state = unwrap(startFaultPlay(state));
    state = unwrap(directSign(state, 'jiang-ye'));
    state = unwrap(finishFaultPlay(state));
    state = unwrap(resolveDiagnosis(state));
    state = unwrap(setModule(state, 'budget', true));
    const notEnough = startWindow(state);
    expect(notEnough.ok).toBe(false);
    state = unwrap(setModule(state, 'negotiation', true));
    const window = unwrap(startWindow(state));
    const locked = setModule(window, 'budget', false);
    expect(locked.ok).toBe(false);
  });

  it('窗口内重复报价、未知目标、关闭后继续操作都被拒绝', () => {
    let state = reachWindow();
    expect(makeOffer(state, 'nobody', 'low').ok).toBe(false);
    state = unwrap(makeOffer(state, 'jiang-ye', 'low'));
    expect(makeOffer(state, 'jiang-ye', 'high').ok).toBe(false);
    const closed = unwrap(closeWindow(state));
    expect(waitTarget(closed, 'mula-ti').ok).toBe(false);
    expect(skipTransfer(closed).ok).toBe(false);
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
    expect(reviveTransfersState({ ...state, version: 2 })).toBeNull();
    expect(reviveTransfersState({ ...state, players: [] })).toBeNull();
    expect(reviveTransfersState({ ...state, budget: -1 })).toBeNull();
    expect(reviveTransfersState({ ...state, evidence: {} })).toBeNull();
    expect(reviveTransfersState({ ...state, eventLog: [{ bad: true }] })).toBeNull();
  });
});

describe('转会窗 · 证据标记', () => {
  it('故障试玩完成 → experiencedFault；窗口关闭 → operatedMechanic；迁移题正确 → transferred', () => {
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
});

describe('转会窗 · UI 冒烟测试', () => {
  it('从窗口签到结算再到归档，onComplete 只触发一次', () => {
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
    fireEvent.click(screen.getByRole('button', { name: '完成委托并返回修理铺' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('fastStart 从故障试玩开始，诊断答对后进入维修', () => {
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
    expect(screen.getByText('维修 · 安装两个规则模块')).toBeTruthy();
  });
});
