import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getLevel } from '../src/game/levels';
import { SquadLevel } from '../src/game/levels/squad/SquadLevel';
import {
  COUNTERFACTUAL_CORRECT_ID,
  MICRO_LISTS,
  MODULE_DEGRADE_NOTES,
  POSITION_MIN,
  REFLECTION_OPTIONS,
  REQUIRED_SIGNINGS,
  REQUIRED_SIGNINGS_FAST,
  SQUAD_LIMIT,
  WAGE_SPACE,
  YOUTH_MIN,
  abilityReport,
  advanceToReflection,
  answerCounterfactual,
  assignScout,
  buildMatchReport,
  canSignCandidate,
  checkMicroList,
  checkRegistration,
  confirmReflection,
  confirmScout,
  confirmTactics,
  createSquadState,
  evaluateGoals,
  evaluateRegistration,
  finishMicroTeaching,
  finishSigning,
  goalsAllAchieved,
  inspectMicroList,
  isSquadComplete,
  readySquadState,
  regionKnowledge,
  restartRun,
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
} from '../src/game/levels/squad/logic';
import type { RegionId, SquadActionResult, SquadState } from '../src/game/levels/squad/logic';

afterEach(cleanup);

function unwrap(result: SquadActionResult): SquadState {
  if (!result.ok) throw new Error(result.reason ?? '操作失败');
  return result.state;
}

function clone(state: SquadState): SquadState {
  return JSON.parse(JSON.stringify(state)) as SquadState;
}

/** 从维修完成后的名单流程开始（模块全开、已通过微教学）。 */
function readyScouted(seed = 7, assignments: RegionId[] = ['east', 'plateau']): SquadState {
  let state = readySquadState(seed);
  for (const region of assignments) state = unwrap(assignScout(state, region));
  state = unwrap(confirmScout(state));
  return state;
}

const VALID_SIGNINGS = ['adili', 'gaoqiao', 'zhouyuan', 'limu'];

function signAll(state: SquadState, ids: string[]): SquadState {
  let next = state;
  for (const id of ids) next = unwrap(signCandidate(next, id));
  return next;
}

function playTactics(state: SquadState): SquadState {
  let next = unwrap(setPossessionShape(state, '433-attack'));
  next = unwrap(setOutOfPossessionShape(next, '442-block'));
  next = unwrap(setMatchDecision(next, 'switch-block'));
  return unwrap(confirmTactics(next));
}

/** 走完正常流程，停在注册检查已完成的状态。 */
function reachRegistration(seed = 7, ids = VALID_SIGNINGS): SquadState {
  let state = readyScouted(seed);
  state = signAll(state, ids);
  state = unwrap(finishSigning(state));
  state = playTactics(state);
  return unwrap(checkRegistration(state));
}

function reachSummary(seed = 7): SquadState {
  let state = reachRegistration(seed);
  state = unwrap(advanceToReflection(state));
  state = unwrap(confirmReflection(state, REFLECTION_OPTIONS[0].id));
  return state;
}

describe('赛季名单 · 注册规则常量与微教学', () => {
  it('基础规则与现有阵容：21 人、青训 7、后卫缺口 1', () => {
    expect(SQUAD_LIMIT).toBe(25);
    expect(YOUTH_MIN).toBe(8);
    expect(POSITION_MIN).toEqual({ GK: 2, DF: 6, MF: 6, FW: 4 });
    expect(WAGE_SPACE).toBe(320);
    const base = readySquadState(1);
    const result = evaluateRegistration(base);
    const item = (id: string) => result.items.find((entry) => entry.id === id);
    expect(result.total).toBe(21);
    expect(result.youth).toBe(7);
    expect(result.counts).toEqual({ GK: 2, DF: 5, MF: 7, FW: 7 });
    expect(item('size')?.passed).toBe(true);
    expect(item('youth')?.passed).toBe(false);
    expect(item('df')?.passed).toBe(false);
    expect(item('gk')?.passed).toBe(true);
    expect(item('wage')?.passed).toBe(true);
    expect(result.passed).toBe(false);
  });

  it('微教学两份名单：只堆同位置被退回，规则名单通过', () => {
    const planA = checkMicroList(MICRO_LISTS[0]);
    const planB = checkMicroList(MICRO_LISTS[1]);
    expect(planA.filter((item) => !item.passed).length).toBeGreaterThan(0);
    expect(planA.find((item) => item.id === 'youth')?.passed).toBe(false);
    expect(planA.find((item) => item.id === 'gk')?.passed).toBe(false);
    expect(planA.find((item) => item.id === 'size')?.passed).toBe(true);
    expect(planB.every((item) => item.passed)).toBe(true);
  });

  it('微教学必须先检查两份名单才能完成并留下 experiencedFault', () => {
    let state = createSquadState({ mode: 'normal', seed: 2, fastStart: true, showcaseOptions: null });
    expect(state.phase).toBe('faultPlay');
    expect(finishMicroTeaching(state).ok).toBe(false);
    state = unwrap(inspectMicroList(state, 'a'));
    expect(inspectMicroList(state, 'a').ok).toBe(false);
    expect(finishMicroTeaching(state).ok).toBe(false);
    state = unwrap(inspectMicroList(state, 'b'));
    state = unwrap(finishMicroTeaching(state));
    expect(state.phase).toBe('repair');
    expect(state.evidence.experiencedFault).toBe(true);
    expect(state.microTaught).toBe(true);
  });

  it('startMicroTeaching 从接单进入微教学', () => {
    const state = createSquadState({ mode: 'normal', seed: 3, fastStart: false, showcaseOptions: null });
    expect(state.phase).toBe('commission');
    expect(unwrap(startMicroTeaching(state)).phase).toBe('faultPlay');
  });
});

describe('赛季名单 · 注册检查规则', () => {
  it('签下 4 名合格球员后名单通过全部检查', () => {
    const state = reachRegistration();
    const result = state.registration;
    expect(result).not.toBeNull();
    expect(result?.enabled).toBe(true);
    expect(result?.total).toBe(25);
    expect(result?.youth).toBe(YOUTH_MIN);
    expect(result?.counts).toEqual({ GK: 2, DF: 7, MF: 9, FW: 7 });
    expect(result?.wage).toBe(313);
    expect(result?.passed).toBe(true);
    expect(state.evidence.operatedMechanic).toBe(true);
    expect(state.signings).toHaveLength(REQUIRED_SIGNINGS);
  });

  it('4 名非青训球员会让青训名额检查失败', () => {
    const state = reachRegistration(7, ['gaoqiao', 'zhouyuan', 'luoke', 'limu']);
    expect(state.registration?.passed).toBe(false);
    expect(state.registration?.youth).toBe(7);
    expect(state.registration?.items.find((item) => item.id === 'youth')?.passed).toBe(false);
    expect(advanceToReflection(state).ok).toBe(false);
    expect(state.evidence.operatedMechanic).toBe(false);
  });

  it('每名球员只能占一次名额，签满后不能再签', () => {
    let state = readyScouted();
    state = unwrap(signCandidate(state, 'adili'));
    const duplicate = signCandidate(state, 'adili');
    expect(duplicate.ok).toBe(false);
    expect(duplicate.reason).toContain('已经签下');
    state = signAll(state, ['gaoqiao', 'zhouyuan', 'limu']);
    expect(state.signings).toEqual(['adili', 'gaoqiao', 'zhouyuan', 'limu']);
    const extra = canSignCandidate(state, 'luoke');
    expect(extra.ok).toBe(false);
    expect(extra.reason).toContain('签满');
    const result = evaluateRegistration(state);
    expect(result.total).toBe(25);
    expect(result.items.find((item) => item.id === 'size')?.passed).toBe(true);
  });

  it('预算不足时无法完成 4 次签约', () => {
    let state = readyScouted();
    state = signAll(state, ['shenzhou', 'adili', 'zhouyuan']);
    const rejected = signCandidate(state, 'luoke');
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toContain('转会预算不足');
    expect(signCandidate(state, 'limu').ok).toBe(false);
    expect(canSignCandidate(state, 'gaoqiao').ok).toBe(false);
    state = unwrap(finishSigning(state));
    state = playTactics(state);
    state = unwrap(checkRegistration(state));
    expect(state.registration?.passed).toBe(true);
    expect(state.signings).toHaveLength(3);
    expect(state.evidence.operatedMechanic).toBe(false);
    expect(isSquadComplete(state)).toBe(false);
  });

  it('转会谈判关闭后退化为不限预算与工资，但注册仍检查工资总额', () => {
    const base = readyScouted();
    let state: SquadState = { ...base, modules: { ...base.modules, transfers: false } };
    expect(state.modules.transfers).toBe(false);
    state = signAll(state, ['shenzhou', 'adili', 'gaoqiao', 'zhouyuan']);
    expect(state.signings).toHaveLength(4);
    expect(evaluateRegistration(state).wage).toBe(328);
    expect(evaluateRegistration(state).passed).toBe(false);
    expect(evaluateRegistration(state).items.find((item) => item.id === 'wage')?.passed).toBe(false);
  });
});

describe('赛季名单 · 目标证据', () => {
  it('合格流程让三项目标全部达成', () => {
    const state = reachRegistration();
    const goals = evaluateGoals(state);
    expect(goals).toHaveLength(3);
    expect(goals.every((goal) => goal.achieved)).toBe(true);
    expect(goalsAllAchieved(state)).toBe(true);
    expect(isSquadComplete(state)).toBe(true);
    expect(goals[1].detail).toContain('知识度');
  });

  it('只签 1 人时注册可以通过，但 operatedMechanic 不成立、整关未完成', () => {
    let state = readyScouted();
    state = unwrap(signCandidate(state, 'adili'));
    state = unwrap(finishSigning(state));
    state = playTactics(state);
    state = unwrap(checkRegistration(state));
    expect(state.registration?.passed).toBe(true);
    expect(state.evidence.operatedMechanic).toBe(false);
    expect(isSquadComplete(state)).toBe(false);
    // 仍然允许进入结算查看未达成目标，并可以从结算重开本局
    state = unwrap(advanceToReflection(state));
    expect(state.phase).toBe('transfer');
  });

  it('球探网络关闭后退化为信息全开，目标二无法达成', () => {
    const base = readySquadState(11);
    const state: SquadState = { ...base, modules: { ...base.modules, scouting: false } };
    expect(regionKnowledge(state, 'east')).toBe(100);
    expect(assignScout(state, 'east').ok).toBe(false);
    const report = abilityReport(state, state.candidates[0]);
    expect(report.kind).toBe('exact');
    expect(report.knowledge).toBe(100);
    const transferred = unwrap(confirmScout(state));
    let next = signAll(transferred, VALID_SIGNINGS);
    next = unwrap(finishSigning(next));
    next = playTactics(next);
    next = unwrap(checkRegistration(next));
    expect(evaluateGoals(next).find((goal) => goal.id === 'scouting')?.achieved).toBe(false);
    expect(isSquadComplete(next)).toBe(false);
  });

  it('双形态战术关闭后不能设置两套形态，目标一无法达成', () => {
    const base = readyScouted();
    let state: SquadState = { ...base, modules: { ...base.modules, tactics: false } };
    state = signAll(state, VALID_SIGNINGS);
    state = unwrap(finishSigning(state));
    expect(setPossessionShape(state, '433-attack').ok).toBe(false);
    expect(confirmTactics(state).ok).toBe(false);
    expect(buildMatchReport(state)).toContain('未启用');
    state = unwrap(skipTactics(state));
    state = unwrap(checkRegistration(state));
    expect(evaluateGoals(state).find((goal) => goal.id === 'tactics')?.achieved).toBe(false);
    expect(isSquadComplete(state)).toBe(false);
  });

  it('注册规则关闭后退化放行，但目标三无法达成', () => {
    const base = reachRegistration();
    let state: SquadState = {
      ...base,
      modules: { ...base.modules, registration: false },
      registration: null,
      evidence: { ...base.evidence, operatedMechanic: false },
    };
    state = unwrap(checkRegistration(state));
    expect(state.registration?.enabled).toBe(false);
    expect(state.registration?.passed).toBe(true);
    expect(evaluateGoals(state).find((goal) => goal.id === 'registration')?.achieved).toBe(false);
    expect(state.evidence.operatedMechanic).toBe(false);
    expect(isSquadComplete(state)).toBe(false);
    state = unwrap(advanceToReflection(state));
    expect(state.phase).toBe('transfer');
  });
});

describe('赛季名单 · 反事实题与反思题', () => {
  it('反事实题答错可重试，答对后记录正确', () => {
    let state = reachRegistration();
    state = unwrap(advanceToReflection(state));
    const wrong = answerCounterfactual(state, 'separate');
    expect(wrong.ok).toBe(false);
    expect(wrong.correct).toBe(false);
    const right = unwrap(answerCounterfactual(state, COUNTERFACTUAL_CORRECT_ID));
    expect(right.counterfactualCorrect).toBe(true);
  });

  it('反思题任意解释都可确认，确认后 transferred 为真并归档', () => {
    let state = reachRegistration();
    state = unwrap(advanceToReflection(state));
    for (const option of REFLECTION_OPTIONS) {
      expect(confirmReflection(state, option.id).ok).toBe(true);
    }
    expect(confirmReflection(state, 'nope').ok).toBe(false);
    state = unwrap(confirmReflection(state, REFLECTION_OPTIONS[1].id));
    expect(state.phase).toBe('summary');
    expect(state.reflectionConfirmed).toBe(true);
    expect(state.evidence.transferred).toBe(true);
    expect(squadSummaryLines(state)).toHaveLength(3);
  });

  it('正常模式不能跳过反思，展示模式可以跳过且 transferred 为 false', () => {
    let normal = reachRegistration();
    normal = unwrap(advanceToReflection(normal));
    expect(skipReflection(normal).ok).toBe(false);

    const showcase = createSquadState({
      mode: 'showcase',
      seed: 20251018,
      fastStart: false,
      showcaseOptions: { seed: 20251018, fastPlay: true, startPhase: 'verify' },
    });
    expect(showcase.phase).toBe('verify');
    expect(showcase.fastPlay).toBe(true);
    let state = showcase;
    state = unwrap(assignScout(state, 'east'));
    state = unwrap(assignScout(state, 'plateau'));
    state = unwrap(confirmScout(state));
    state = signAll(state, ['adili', 'zhouyuan']);
    expect(state.signings).toHaveLength(REQUIRED_SIGNINGS_FAST);
    state = unwrap(finishSigning(state));
    state = playTactics(state);
    state = unwrap(checkRegistration(state));
    expect(state.registration?.passed).toBe(true);
    expect(state.registration?.items.find((item) => item.id === 'wage')?.skipped).toBe(true);
    expect(state.evidence.operatedMechanic).toBe(true);
    state = unwrap(advanceToReflection(state));
    state = unwrap(skipReflection(state));
    expect(state.phase).toBe('summary');
    expect(state.skippedReflection).toBe(true);
    expect(state.evidence.transferred).toBe(false);
    expect(isSquadComplete(state)).toBe(true);
  });
});

describe('赛季名单 · 维修、锁定与重开', () => {
  it('维修阶段可以开关模块，开始流程后锁定', () => {
    let state = createSquadState({
      mode: 'showcase',
      seed: 4,
      fastStart: false,
      showcaseOptions: { seed: 4, fastPlay: true, startPhase: 'repair' },
    });
    expect(state.phase).toBe('repair');
    state = unwrap(setSquadModule(state, 'scouting', false));
    expect(state.modules.scouting).toBe(false);
    expect(MODULE_DEGRADE_NOTES.scouting).toContain('知识度');
    state = unwrap(setSquadModule(state, 'scouting', true));
    state = unwrap(startFlow(state));
    expect(state.flowStarted).toBe(true);
    expect(setSquadModule(state, 'tactics', false).ok).toBe(false);
  });

  it('重开本局清空名单流程成绩，但保留模块与微教学', () => {
    const complete = reachRegistration();
    const restarted = unwrap(restartRun(complete));
    expect(restarted.phase).toBe('repair');
    expect(restarted.flowStarted).toBe(false);
    expect(restarted.signings).toEqual([]);
    expect(restarted.registration).toBeNull();
    expect(restarted.step).toBe('scout');
    expect(restarted.scouts.confirmed).toBe(false);
    expect(scoutAssignmentsTotal(restarted)).toBe(0);
    expect(restarted.tactics.confirmed).toBe(false);
    expect(restarted.restarts).toBe(1);
    expect(restarted.microTaught).toBe(true);
    expect(restarted.microChecks).toEqual({ a: true, b: true });
    expect(restarted.modules).toEqual({ tactics: true, scouting: true, transfers: true, registration: true });
    expect(restarted.evidence.experiencedFault).toBe(true);
    expect(restarted.evidence.operatedMechanic).toBe(false);
    expect(restarted.evidence.transferred).toBe(false);
    expect(startFlow(restarted).ok).toBe(true);
  });

  it('结算阶段也能重开本局', () => {
    const summary = reachSummary();
    expect(summary.phase).toBe('summary');
    const restarted = unwrap(restartRun(summary));
    expect(restarted.phase).toBe('repair');
    expect(restarted.restarts).toBe(1);
  });

  it('注册未通过时不能进入结算', () => {
    let state = readyScouted();
    state = signAll(state, ['gaoqiao', 'zhouyuan', 'luoke', 'limu']);
    state = unwrap(finishSigning(state));
    state = playTactics(state);
    state = unwrap(checkRegistration(state));
    expect(state.registration?.passed).toBe(false);
    expect(advanceToReflection(state).ok).toBe(false);
    expect(checkRegistration(state).ok).toBe(false);
  });
});

describe('赛季名单 · 同种子与存档恢复', () => {
  it('相同种子得到相同的候选能力与初始状态', () => {
    const a = createSquadState({ mode: 'normal', seed: 99, fastStart: false, showcaseOptions: null });
    const b = createSquadState({ mode: 'normal', seed: 99, fastStart: false, showcaseOptions: null });
    expect(a.candidates).toEqual(b.candidates);
    expect(a.rng).toEqual(b.rng);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('序列化再恢复后状态一致', () => {
    const state = reachRegistration();
    const revived = reviveSquadState(JSON.parse(JSON.stringify(state)));
    expect(revived).not.toBeNull();
    expect(revived).toEqual(state);
  });

  it('恢复后继续操作与原始状态一致', () => {
    const state = reachRegistration();
    const revived = reviveSquadState(JSON.parse(JSON.stringify(state))) as SquadState;
    const a = unwrap(advanceToReflection(state));
    const b = unwrap(advanceToReflection(revived));
    expect(a).toEqual(b);
    const c = unwrap(confirmReflection(a, REFLECTION_OPTIONS[0].id));
    const d = unwrap(confirmReflection(b, REFLECTION_OPTIONS[0].id));
    expect(c.phase).toBe(d.phase);
    expect(c.evidence).toEqual(d.evidence);
  });

  it('损坏存档返回 null', () => {
    const state = reachRegistration();
    expect(reviveSquadState(null)).toBeNull();
    expect(reviveSquadState({})).toBeNull();
    expect(reviveSquadState({ ...clone(state), version: 2 })).toBeNull();
    expect(reviveSquadState({ ...clone(state), candidates: [] })).toBeNull();
    expect(reviveSquadState({ ...clone(state), modules: {} })).toBeNull();
    expect(reviveSquadState({ ...clone(state), signings: ['nobody'] })).toBeNull();
    expect(reviveSquadState({ ...clone(state), step: 'nope' })).toBeNull();
    expect(reviveSquadState({ ...clone(state), evidence: {} })).toBeNull();
  });
});

describe('赛季名单 · UI 冒烟测试', () => {
  it('从转会阶段一路走到归档，onComplete 只触发一次', () => {
    const saved = readyScouted(2024);
    const onSaveState = vi.fn();
    const onComplete = vi.fn();
    const onExit = vi.fn();
    render(
      createElement(SquadLevel, {
        level: getLevel('squad'),
        mode: 'normal',
        fastStart: false,
        showcaseOptions: null,
        savedState: saved,
        onSaveState,
        onComplete,
        onExit,
      }),
    );

    for (const name of ['阿迪力', '高桥凌', '周原', '李沐']) {
      fireEvent.click(screen.getByRole('button', { name: `签下 ${name}` }));
    }
    fireEvent.click(screen.getByRole('button', { name: '结束签约，进入战术阶段' }));
    fireEvent.click(screen.getByRole('radio', { name: /4-3-3 进攻/ }));
    fireEvent.click(screen.getByRole('radio', { name: /4-4-2 中位块/ }));
    fireEvent.click(screen.getByRole('radio', { name: /回到中位块/ }));
    fireEvent.click(screen.getByRole('button', { name: '提交比赛阶段，进入注册检查' }));
    fireEvent.click(screen.getByRole('button', { name: '运行注册检查' }));
    fireEvent.click(screen.getByRole('button', { name: '进入结算与反思' }));
    fireEvent.click(screen.getByRole('radio', { name: /不能直接通过/ }));
    fireEvent.click(screen.getByRole('button', { name: '提交反事实计算' }));
    fireEvent.click(screen.getByRole('radio', { name: /因为每签一个人都在同时占用/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认这条解释并归档' }));
    expect(screen.getByText('归档 · 赛季名单完成记录')).toBeTruthy();
    expect(onComplete).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '完成委托并返回修理铺' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('fastStart 从注册微教学开始，两份名单都检查后进入维修', () => {
    render(
      createElement(SquadLevel, {
        level: getLevel('squad'),
        mode: 'normal',
        fastStart: true,
        showcaseOptions: null,
        savedState: undefined,
        onSaveState: vi.fn(),
        onComplete: vi.fn(),
        onExit: vi.fn(),
      }),
    );
    expect(screen.getByText('注册微教学 · 两份 25 人名单')).toBeTruthy();
    expect((screen.getByRole('button', { name: '完成微教学，进入维修' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '检查方案 A' }));
    fireEvent.click(screen.getByRole('button', { name: '检查方案 B' }));
    fireEvent.click(screen.getByRole('button', { name: '完成微教学，进入维修' }));
    expect(screen.getByText('维修 · 四个系统一起装进名单')).toBeTruthy();
  });
});
