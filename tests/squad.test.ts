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
  SQUAD_MODULE_IDS,
  SQUAD_STATE_VERSION,
  WAGE_SPACE,
  WRONG_MODULE_INFO,
  YOUTH_MIN,
  abilityReport,
  advanceToReflection,
  answerCounterfactual,
  assignScout,
  budgetBase,
  budgetCap,
  buildCounterfactual,
  buildMatchReport,
  buildSquadClubPatch,
  buildSquadClubUpdate,
  buildSquadSeasonReport,
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
  requiredSignings,
  reviveSquadState,
  reworkCostPaid,
  reworkCount,
  rosterGroups,
  scoutAssignmentsTotal,
  setMatchDecision,
  setOutOfPossessionShape,
  setPossessionShape,
  setSquadModule,
  signCandidate,
  skipReflection,
  skipTactics,
  squadArchiveProblems,
  squadSummaryLines,
  squadTotal,
  startFlow,
  startMicroTeaching,
  strictRegistration,
  wageCap,
} from '../src/game/levels/squad/logic';
import type { RegionId, SquadActionResult, SquadModuleId, SquadState } from '../src/game/levels/squad/logic';
import type { ClubSigning, ClubState } from '../src/game/engine/types';

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
    expect(restarted.modules).toEqual({
      tactics: true,
      scouting: true,
      transfers: true,
      registration: true,
      ignoreRegistration: false,
      agent: false,
    });
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
    expect(reviveSquadState({ ...clone(state), version: 1 })).toBeNull();
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
    expect(screen.getAllByText(/当前名单可通过/).length).toBeGreaterThan(0);
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
    const payload = onComplete.mock.calls[0]?.[0] as {
      clubUpdate?: { headline: string; details: string[] };
    };
    expect(payload.clubUpdate?.headline).toContain('25/25');
    expect(payload.clubUpdate?.details).toHaveLength(4);
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
    expect(screen.getByText('维修 · 从模块池里拼出可注册的名单')).toBeTruthy();
    expect(screen.getByRole('button', { name: '安装模块：无视注册规则' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '安装模块：全权交给经纪人' })).toBeTruthy();
    // 模块卡不再出现「正确 / 错误 / 推荐」这类答案提示。
    expect(screen.queryByText(/错误模块|正确模块|推荐组合/)).toBeNull();
  });

  it('错误模块导致目标未达成时，归档被阻止并可回到维修台重新配置', () => {
    const saved = ignoredSummary(2024);
    render(
      createElement(SquadLevel, {
        level: getLevel('squad'),
        mode: 'normal',
        fastStart: false,
        showcaseOptions: null,
        savedState: saved,
        onSaveState: vi.fn(),
        onComplete: vi.fn(),
        onExit: vi.fn(),
      }),
    );
    expect(screen.getByText('还有目标没有达成')).toBeTruthy();
    expect(screen.getAllByText(/无视注册规则/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/俱乐部承担 €1M 返工成本（紧急处理）/).length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: '完成委托并返回修理铺' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '回到维修台重新配置' }));
    fireEvent.click(screen.getByRole('button', { name: '回到维修台' }));
    expect(screen.getByText('维修 · 从模块池里拼出可注册的名单')).toBeTruthy();
    expect(screen.getByRole('button', { name: '卸载模块：无视注册规则' })).toBeTruthy();
  });
});

/* ==========================================================================
   v2：模块池、错误模块、失败重试、实时校验与动态反事实
   ========================================================================== */

/** 在 readySquadState 基础上替换模块配置，并走完 1 轮球探考察。 */
function scoutedWith(patch: Partial<Record<SquadModuleId, boolean>>, seed = 7): SquadState {
  let state = clone(readySquadState(seed));
  state = { ...state, modules: { ...state.modules, ...patch } };
  state = unwrap(assignScout(state, 'east'));
  state = unwrap(assignScout(state, 'plateau'));
  return unwrap(confirmScout(state));
}

/** 用「无视注册规则」跳过检查，走到归档（目标三必然未达成）。 */
function ignoredSummary(seed = 7): SquadState {
  let state = scoutedWith({ ignoreRegistration: true }, seed);
  state = signAll(state, VALID_SIGNINGS);
  state = unwrap(finishSigning(state));
  state = playTactics(state);
  state = unwrap(checkRegistration(state));
  state = unwrap(advanceToReflection(state));
  return unwrap(confirmReflection(state, REFLECTION_OPTIONS[0].id));
}

describe('赛季名单 v2 · 模块池与错误模块', () => {
  it('模块池包含 4 个正确系统 + 2 个错误模块，错误模块有真实副作用说明', () => {
    expect(SQUAD_STATE_VERSION).toBe(3);
    expect(SQUAD_MODULE_IDS).toHaveLength(6);
    expect(SQUAD_MODULE_IDS).toEqual([
      'tactics',
      'scouting',
      'transfers',
      'registration',
      'ignoreRegistration',
      'agent',
    ]);
    expect(WRONG_MODULE_INFO.ignoreRegistration.name).toBe('无视注册规则');
    expect(WRONG_MODULE_INFO.ignoreRegistration.sideEffect).toContain('目标三');
    expect(WRONG_MODULE_INFO.agent.name).toBe('全权交给经纪人');
    expect(WRONG_MODULE_INFO.agent.sideEffect).toContain('10%');
  });

  it('「无视注册规则」跳过检查，但目标三永远无法达成、归档被阻止', () => {
    let state = scoutedWith({ ignoreRegistration: true });
    state = signAll(state, VALID_SIGNINGS);
    state = unwrap(finishSigning(state));
    state = playTactics(state);
    state = unwrap(checkRegistration(state));
    expect(state.registration?.skippedByIgnore).toBe(true);
    expect(state.registration?.enabled).toBe(false);
    expect(state.registration?.passed).toBe(true);
    expect(state.evidence.operatedMechanic).toBe(false);
    expect(evaluateGoals(state).find((goal) => goal.id === 'registration')?.achieved).toBe(false);
    expect(isSquadComplete(state)).toBe(false);
    // 跳过检查仍然可以进入结算看到后果，但归档被阻止。
    expect(advanceToReflection(state).ok).toBe(true);
    const summary = unwrap(confirmReflection(unwrap(advanceToReflection(state)), REFLECTION_OPTIONS[0].id));
    expect(squadArchiveProblems(summary).join('')).toContain('目标三');
  });

  it('「全权交给经纪人」把预算/工资上限各砍 10%，签约绕过检查但注册失败', () => {
    const plain = scoutedWith({});
    expect(budgetCap(plain)).toBe(4200);
    expect(wageCap(plain)).toBe(WAGE_SPACE);

    const agent = scoutedWith({ agent: true });
    expect(budgetCap(agent)).toBe(3780);
    expect(wageCap(agent)).toBe(288);

    const expensive = ['shenzhou', 'adili', 'gaoqiao', 'zhouyuan'];
    let plainState = plain;
    let rejected = false;
    for (const id of expensive) {
      const attempt = signCandidate(plainState, id);
      if (attempt.ok) plainState = attempt.state;
      else rejected = true;
    }
    expect(rejected).toBe(true);

    let agentState = agent;
    for (const id of expensive) agentState = unwrap(signCandidate(agentState, id));
    expect(agentState.signings).toHaveLength(4);
    expect(evaluateRegistration(agentState).budgetUsed).toBeGreaterThan(budgetCap(agentState));
    agentState = unwrap(finishSigning(agentState));
    agentState = playTactics(agentState);
    agentState = unwrap(checkRegistration(agentState));
    expect(agentState.registration?.passed).toBe(false);
    expect(agentState.registration?.items.find((item) => item.id === 'wage')?.passed).toBe(false);
    expect(agentState.evidence.operatedMechanic).toBe(false);
  });

  it('装错模块 → 未达成 → 回到维修台重新配置 → 换模块后可以完成', () => {
    let state = ignoredSummary(31);
    expect(state.phase).toBe('summary');
    expect(isSquadComplete(state)).toBe(false);

    state = unwrap(restartRun(state));
    expect(state.phase).toBe('repair');
    expect(state.signings).toEqual([]);
    expect(state.registration).toBeNull();
    expect(state.modules.ignoreRegistration).toBe(true);
    expect(state.microTaught).toBe(true);
    expect(state.microChecks).toEqual({ a: true, b: true });
    expect(state.evidence.experiencedFault).toBe(true);
    expect(state.evidence.operatedMechanic).toBe(false);
    expect(state.evidence.transferred).toBe(false);
    // 本轮验证成绩被清空：verify 阶段的旧操作记录不再出现。
    expect(state.eventLog.every((entry) => entry.phase !== 'verify')).toBe(true);

    state = unwrap(setSquadModule(state, 'ignoreRegistration', false));
    state = unwrap(startFlow(state));
    state = unwrap(assignScout(state, 'east'));
    state = unwrap(assignScout(state, 'plateau'));
    state = unwrap(confirmScout(state));
    state = signAll(state, VALID_SIGNINGS);
    state = unwrap(finishSigning(state));
    state = playTactics(state);
    state = unwrap(checkRegistration(state));
    expect(state.registration?.passed).toBe(true);
    expect(state.evidence.operatedMechanic).toBe(true);
    expect(isSquadComplete(state)).toBe(true);
    expect(squadArchiveProblems(state)).toEqual([]);
    state = unwrap(advanceToReflection(state));
    const question = buildCounterfactual(state);
    state = unwrap(answerCounterfactual(state, question.correctId));
    expect(state.counterfactualCorrect).toBe(true);
  });

  it('注册未通过时无法归档，先回到维修台清空本轮验证成绩', () => {
    let state = scoutedWith({});
    state = signAll(state, ['gaoqiao', 'zhouyuan', 'luoke', 'limu']);
    state = unwrap(finishSigning(state));
    state = playTactics(state);
    state = unwrap(checkRegistration(state));
    expect(state.registration?.passed).toBe(false);
    expect(advanceToReflection(state).ok).toBe(false);
    const restarted = unwrap(restartRun(state));
    expect(restarted.phase).toBe('repair');
    expect(restarted.signings).toEqual([]);
    expect(restarted.eventLog.every((entry) => entry.phase !== 'verify')).toBe(true);
    expect(restarted.microTaught).toBe(true);
  });
});

describe('赛季名单 v2 · 实时校验与名单槽位', () => {
  it('槽位按位置分组，现有阵容后卫缺口 1，签下后卫后实时补上', () => {
    const base = readySquadState(3);
    const groups = rosterGroups(base);
    expect(groups.map((group) => `${group.position}:${group.count}`)).toEqual(['GK:2', 'DF:5', 'MF:7', 'FW:7']);
    const df = groups.find((group) => group.position === 'DF');
    expect(df?.gapToMin).toBe(1);
    expect(df?.passed).toBe(false);
    expect(df?.players).toHaveLength(5);
    expect(df?.players.filter((player) => player.youth)).toHaveLength(2);

    let state = scoutedWith({}, 3);
    state = unwrap(signCandidate(state, 'adili'));
    const after = rosterGroups(state).find((group) => group.position === 'DF');
    expect(after?.count).toBe(6);
    expect(after?.gapToMin).toBe(0);
    expect(after?.passed).toBe(true);
    expect(after?.players.find((player) => player.id === 'adili')?.signed).toBe(true);
  });

  it('实时注册校验随签约更新：补上青训与后卫后立即通过', () => {
    let state = scoutedWith({});
    const before = evaluateRegistration(state);
    expect(before.passed).toBe(false);
    expect(before.items.find((item) => item.id === 'youth')?.passed).toBe(false);

    state = unwrap(signCandidate(state, 'adili'));
    const after = evaluateRegistration(state);
    expect(after.youth).toBe(YOUTH_MIN);
    expect(after.counts.DF).toBe(6);
    expect(after.passed).toBe(true);
    expect(after.items.every((item) => item.passed || item.skipped)).toBe(true);
  });
});

describe('赛季名单 v2 · 动态反事实题', () => {
  it('名单按真实规则通过时，用 25 人满员的反事实继续提问', () => {
    const state = reachRegistration();
    const question = buildCounterfactual(state);
    expect(question.question).toContain('25/25');
    expect(question.correctId).toBe(COUNTERFACTUAL_CORRECT_ID);
    const wrong = answerCounterfactual({ ...state, phase: 'transfer' }, 'separate');
    expect(wrong.ok).toBe(false);
    expect(wrong.correct).toBe(false);
  });

  it('「无视注册规则」+ 非青训 4 签：按真实青训缺口生成问题', () => {
    let state = scoutedWith({ ignoreRegistration: true }, 41);
    state = signAll(state, ['gaoqiao', 'zhouyuan', 'luoke', 'limu']);
    state = unwrap(finishSigning(state));
    state = playTactics(state);
    state = unwrap(checkRegistration(state));
    state = unwrap(advanceToReflection(state));
    const question = buildCounterfactual(state);
    expect(question.question).toContain('青训只有 7');
    expect(question.correctId).toBe('move-out');
    expect(unwrap(answerCounterfactual(state, 'move-out')).counterfactualCorrect).toBe(true);
  });

  it('「无视注册规则」+「经纪人」导致真实工资缺口：动态问工资要腾多少', () => {
    let state = scoutedWith({ ignoreRegistration: true, agent: true }, 42);
    state = signAll(state, ['shenzhou', 'adili', 'gaoqiao', 'zhouyuan']);
    state = unwrap(finishSigning(state));
    state = playTactics(state);
    state = unwrap(checkRegistration(state));
    state = unwrap(advanceToReflection(state));
    const question = buildCounterfactual(state);
    expect(question.question).toContain('周薪');
    expect(question.question).toContain('288');
    expect(question.correctId).toBe('clear-over');
    expect(unwrap(answerCounterfactual(state, 'clear-over')).counterfactualCorrect).toBe(true);
  });

  it('真实位置覆盖缺口：动态问补哪个位置', () => {
    let state = scoutedWith({ ignoreRegistration: true }, 43);
    state = signAll(state, ['gaoqiao', 'shenzhou', 'luoke', 'limu']);
    state = unwrap(finishSigning(state));
    state = playTactics(state);
    state = unwrap(checkRegistration(state));
    state = unwrap(advanceToReflection(state));
    const question = buildCounterfactual(state);
    expect(question.question).toContain('后卫');
    expect(question.correctId).toBe('add-position');
  });

  it('展示短局名单未满 25 人：动态问再签 1 名非青训会怎样', () => {
    let state = readySquadState(44, true);
    state = unwrap(assignScout(state, 'east'));
    state = unwrap(assignScout(state, 'plateau'));
    state = unwrap(confirmScout(state));
    state = signAll(state, ['adili', 'zhouyuan']);
    state = unwrap(finishSigning(state));
    state = playTactics(state);
    state = unwrap(checkRegistration(state));
    expect(state.registration?.passed).toBe(true);
    state = unwrap(advanceToReflection(state));
    const question = buildCounterfactual(state);
    expect(question.question).toContain('再签 1 名非青训');
    expect(question.correctId).toBe('still-pass');
    expect(unwrap(answerCounterfactual(state, 'still-pass')).counterfactualCorrect).toBe(true);
  });
});

describe('赛季名单 v2 · 俱乐部时间线', () => {
  it('clubUpdate 只写真实名单、注册检查、位置覆盖、工资与预算数据', () => {
    const summary = reachSummary();
    const registration = summary.registration;
    expect(registration).not.toBeNull();
    const club = buildSquadClubUpdate(summary);
    expect(club.headline).toContain('25/25');
    expect(club.headline).toContain('8/8');
    expect(club.headline).toContain('313');
    expect(club.details).toHaveLength(4);
    expect(club.details[0]).toContain('注册检查：通过');
    expect(club.details[1]).toContain('门将 2/2');
    expect(club.details[1]).toContain('后卫 7/6');
    expect(club.details[2]).toContain('返工 0 次');
    expect(club.details[2]).toContain('阿迪力');
    expect(club.details[2]).toContain('剩余 €5.5M');
    expect(club.details[3]).toContain('球探网络已启用');
    expect(club.nextBrief).toBeTruthy();
  });

  it('strictRegistration 不受「无视注册规则」影响，用于显示真实缺口', () => {
    let state = scoutedWith({ ignoreRegistration: true }, 45);
    state = signAll(state, ['gaoqiao', 'zhouyuan', 'luoke', 'limu']);
    const strict = strictRegistration(state);
    expect(strict.enabled).toBe(true);
    expect(strict.passed).toBe(false);
    expect(strict.items.find((item) => item.id === 'youth')?.passed).toBe(false);
  });
});

/* ==========================================================================
   v4：跨关俱乐部状态、预算读取、返工成本与赛季报告
   ========================================================================== */

function makeClub(patch: Partial<ClubState> = {}): ClubState {
  return {
    name: '北港联',
    season: '2026/27',
    week: 2,
    transferBudget: 30,
    wageBudget: 150,
    failures: 2,
    tactics: null,
    scoutedCandidates: [],
    signings: [],
    timeline: [],
    seasonReport: null,
    ...patch,
  };
}

const CLUB_SIGNINGS: ClubSigning[] = [
  { id: 'jiang-ye', name: '江野', position: '边锋', fee: 19.8, wage: 160, homegrown: true },
  { id: 'mula-ti', name: '木拉提', position: '中卫', fee: 16, wage: 120, homegrown: false },
];

/** 用 club 直接进入名单流程第一步（模块全开、已通过微教学）。 */
function scoutedWithClub(club: ClubState, seed = 7, fastPlay = false): SquadState {
  let state = createSquadState({
    mode: 'normal',
    seed,
    fastStart: false,
    showcaseOptions: { seed, fastPlay, startPhase: 'verify' },
    club,
  });
  state = unwrap(assignScout(state, 'east'));
  state = unwrap(assignScout(state, 'plateau'));
  return unwrap(confirmScout(state));
}

describe('赛季名单 v4 · 跨关俱乐部状态', () => {
  it('读取 club 的预算、工资、返工、战术与已签约球员', () => {
    const club = makeClub({
      transferBudget: 30,
      wageBudget: 150,
      failures: 2,
      signings: CLUB_SIGNINGS,
      tactics: {
        possessionShape: '4-3-3',
        outOfPossessionShape: '4-4-2-mid',
        fullbackDuty: 'overlap',
        pivotDuty: 'single',
      },
    });
    const state = createSquadState({
      mode: 'normal',
      seed: 7,
      fastStart: false,
      showcaseOptions: null,
      club,
    });
    expect(state.inheritedSignings).toHaveLength(2);
    expect(state.startTransferBudget).toBe(3000);
    expect(state.startWageRoom).toBe(150);
    expect(state.clubConnected).toBe(true);
    expect(state.clubFailures).toBe(2);
    expect(budgetCap(state)).toBe(3000);
    expect(wageCap(state)).toBe(240 + 150);
    // 战术阶段预填上一关的双形态，但比赛决策仍需自己选。
    expect(state.tactics.possessionId).toBe('433-attack');
    expect(state.tactics.outId).toBe('442-block');
    expect(state.tactics.decisionId).toBeNull();
    expect(state.tactics.confirmed).toBe(false);
    // 已签约球员计入名单与注册校验。
    expect(squadTotal(state)).toBe(23);
    const registration = evaluateRegistration(state);
    expect(registration.total).toBe(23);
    expect(registration.youth).toBe(8);
    expect(registration.counts).toEqual({ GK: 2, DF: 6, MF: 7, FW: 8 });
    expect(registration.passed).toBe(true);
    expect(requiredSignings(state)).toBe(2);
    const fw = rosterGroups(state).find((group) => group.position === 'FW');
    expect(fw?.players.find((player) => player.name === '江野')?.inherited).toBe(true);
  });

  it('过滤与本关 21 人或候选重复的俱乐部签约', () => {
    const club = makeClub({
      signings: [
        ...CLUB_SIGNINGS,
        { id: 'adili', name: '阿迪力', position: '后卫', fee: 12, wage: 24, homegrown: true },
        { id: 'base-gk-1', name: '韩铮', position: '门将', fee: 5, wage: 10, homegrown: true },
      ],
    });
    const state = createSquadState({ mode: 'normal', seed: 1, fastStart: false, showcaseOptions: null, club });
    expect(state.inheritedSignings.map((signing) => signing.id)).toEqual(['jiang-ye', 'mula-ti']);
  });

  it('转会窗引援占掉名单名额，本关只需补足剩余名额', () => {
    const club = makeClub({ signings: CLUB_SIGNINGS, transferBudget: 30, wageBudget: 150 });
    let state = scoutedWithClub(club);
    expect(requiredSignings(state)).toBe(2);
    state = signAll(state, ['adili', 'zhouyuan']);
    expect(state.signings).toHaveLength(2);
    state = unwrap(finishSigning(state));
    state = playTactics(state);
    state = unwrap(checkRegistration(state));
    expect(state.registration?.total).toBe(25);
    expect(state.registration?.passed).toBe(true);
    expect(state.evidence.operatedMechanic).toBe(true);
    expect(isSquadComplete(state)).toBe(true);
  });

  it('没有 club 时使用默认预算与 4 人签约要求（展示/旧流程兼容）', () => {
    const state = createSquadState({
      mode: 'showcase',
      seed: 20251018,
      fastStart: false,
      showcaseOptions: { seed: 20251018, fastPlay: true, startPhase: 'verify' },
    });
    expect(state.clubConnected).toBe(false);
    expect(state.inheritedSignings).toHaveLength(0);
    expect(state.startTransferBudget).toBe(4200);
    expect(state.startWageRoom).toBe(320);
    expect(requiredSignings(state)).toBe(2);
    expect(budgetCap(state)).toBe(4200);
    expect(wageCap(state)).toBe(320);
  });
});

describe('赛季名单 v4 · 返工成本', () => {
  it('每次回到维修台扣 €1M 紧急处理成本，最低 0', () => {
    const club = makeClub({ transferBudget: 30, wageBudget: 150, signings: CLUB_SIGNINGS });
    let state = scoutedWithClub(club);
    expect(budgetCap(state)).toBe(3000);
    state = unwrap(restartRun(state));
    expect(reworkCount(state)).toBe(1);
    expect(reworkCostPaid(state)).toBe(100);
    expect(budgetCap(state)).toBe(2900);

    const poor = makeClub({ transferBudget: 0.5, wageBudget: 100 });
    let low = scoutedWithClub(poor, 9);
    expect(budgetCap(low)).toBe(50);
    low = unwrap(restartRun(low));
    expect(budgetCap(low)).toBe(0);
    expect(budgetBase(low)).toBe(0);
    const patch = buildSquadClubPatch(low);
    expect(patch.transferBudget).toBe(0);
    expect(patch.addFailures).toBe(1);
  });

  it('clubPatch 提交最终名单签约（含转会窗引援）、绝对预算、返工与赛季报告', () => {
    const club = makeClub({ transferBudget: 30, wageBudget: 150, signings: CLUB_SIGNINGS });
    let state = scoutedWithClub(club);
    state = signAll(state, ['adili', 'zhouyuan']);
    state = unwrap(finishSigning(state));
    state = playTactics(state);
    state = unwrap(checkRegistration(state));
    const patch = buildSquadClubPatch(state);
    expect(patch.signings).toHaveLength(4);
    expect(patch.signings?.map((signing) => signing.name)).toEqual(['江野', '木拉提', '阿迪力', '周原']);
    expect(patch.transferBudget).toBe(Math.round(((3000 - 1200 - 950) / 100) * 10) / 10);
    expect(patch.wageBudget).toBe(150 - 24 - 16);
    expect(patch.addFailures).toBe(0);
    const report = buildSquadSeasonReport(state);
    expect(report.headline).toContain('25/25');
    expect(report.headline).toContain('9/8');
    expect(report.details).toHaveLength(4);
    expect(report.details.join('')).toContain('江野');
    expect(report.details.join('')).toContain('阿迪力');
    expect(patch.seasonReport?.headline).toBe(report.headline);
  });

  it('clubUpdate 写入返工、跨关引援与预算变化', () => {
    const club = makeClub({ transferBudget: 30, wageBudget: 150, failures: 3, signings: CLUB_SIGNINGS });
    let state = scoutedWithClub(club);
    state = unwrap(restartRun(state));
    expect(state.restarts).toBe(1);
    const update = buildSquadClubUpdate(state);
    expect(update.details.join('')).toContain('跨关引援');
    expect(update.details.join('')).toContain('返工 1 次');
    expect(update.details.join('')).toContain('江野');
    expect(update.details.join('')).toContain('€1M');
  });
});

describe('赛季名单 v4 · UI 跨关与无答案提示', () => {
  it('页面显示俱乐部历史返工、转会窗引援与 €1M 成本提示', () => {
    const club = makeClub({
      signings: CLUB_SIGNINGS,
      transferBudget: 30,
      wageBudget: 150,
      failures: 2,
      tactics: {
        possessionShape: '4-3-3',
        outOfPossessionShape: '4-4-2-mid',
        fullbackDuty: 'overlap',
        pivotDuty: 'single',
      },
    });
    const state = scoutedWithClub(club);
    render(
      createElement(SquadLevel, {
        level: getLevel('squad'),
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
    expect(screen.getAllByText('江野').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/€1M/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/错误模块|正确模块|推荐组合/)).toBeNull();
  });

  it('completes 时 onComplete 带 clubPatch、clubUpdate 与 seasonReport', () => {
    const club = makeClub({ signings: CLUB_SIGNINGS, transferBudget: 30, wageBudget: 150 });
    const onComplete = vi.fn();
    let saved = scoutedWithClub(club, 2024);
    saved = signAll(saved, ['adili', 'zhouyuan']);
    saved = unwrap(finishSigning(saved));
    saved = playTactics(saved);
    saved = unwrap(checkRegistration(saved));
    saved = unwrap(advanceToReflection(saved));
    render(
      createElement(SquadLevel, {
        level: getLevel('squad'),
        mode: 'normal',
        fastStart: false,
        showcaseOptions: null,
        club,
        savedState: saved,
        onSaveState: vi.fn(),
        onComplete,
        onExit: vi.fn(),
      }),
    );
    fireEvent.click(screen.getByRole('radio', { name: /因为每签一个人都在同时占用/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认这条解释并归档' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    const payload = onComplete.mock.calls[0]?.[0] as {
      clubPatch?: { signings: unknown[]; transferBudget: number; addFailures: number; seasonReport?: unknown };
    };
    expect(payload.clubPatch?.signings).toHaveLength(4);
    expect(payload.clubPatch?.addFailures).toBe(0);
    expect(payload.clubPatch?.seasonReport).toBeTruthy();
  });
});
