import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getLevel } from '../src/game/levels';
import type { LevelScreenProps } from '../src/game/engine/types';
import {
  DIAGNOSE_CORRECT_ID,
  KNOWLEDGE_MAX,
  REGIONS,
  SCOUTS_PER_ROUND,
  SCOUT_CANDIDATES,
  TRANSFER_OPTIONS,
  assignScout,
  buildCandidateReports,
  canAssignScout,
  canComplete,
  candidateReport,
  completeArchive,
  createInitialScoutingState,
  endRound,
  finishFaultPlay,
  gainKnowledge,
  inspectCandidate,
  installKnowledgeReports,
  installLimitedScouts,
  isSelectingCandidate,
  openSummary,
  openTransfer,
  pickFaultCandidate,
  precisionLabel,
  reportPrecision,
  reportRange,
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
} from '../src/game/levels/scouting/logic';
import type { RegionId, ScoutingInitOptions, ScoutingState } from '../src/game/levels/scouting/logic';
import { ScoutingLevel } from '../src/game/levels/scouting/ScoutingLevel';

const NORMAL: ScoutingInitOptions = { mode: 'normal', fastStart: false, showcaseOptions: null };

function showcase(startPhase: 'faultPlay' | 'repair' | 'verify', fastPlay = true): ScoutingInitOptions {
  return { mode: 'showcase', fastStart: false, showcaseOptions: { seed: 20251018, fastPlay, startPhase } };
}

function newState(seed = 42): ScoutingState {
  return createInitialScoutingState(NORMAL, seed);
}

function reachVerify(seed = 42): ScoutingState {
  let state = startFaultPlay(newState(seed));
  state = inspectCandidate(state, 'lin-tuo');
  state = pickFaultCandidate(state, 'lin-tuo');
  state = finishFaultPlay(state);
  state = resolveDiagnose(state);
  state = startRepair(state);
  state = installLimitedScouts(state);
  state = installKnowledgeReports(state);
  return startVerify(state);
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
  state = finishRound(state, ['local', 'southern-europe']);
  return state;
}

function makeProps(overrides: Partial<LevelScreenProps> = {}): LevelScreenProps {
  return {
    level: getLevel('scouting'),
    mode: 'normal',
    fastStart: true,
    showcaseOptions: null,
    savedState: undefined,
    onSaveState: vi.fn(),
    onComplete: vi.fn(),
    onExit: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('球探室：派遣消耗与区域容量', () => {
  it('派遣消耗球探，同一区域不能派两人，人数用完必须结束本轮', () => {
    let state = reachVerify();
    expect(scoutsAvailable(state)).toBe(SCOUTS_PER_ROUND);
    state = assignScout(state, 'local');
    expect(scoutsAvailable(state)).toBe(1);
    expect(state.dispatches).toEqual(['local']);
    expect(canAssignScout(state, 'local')).toBe(false);
    expect(assignScout(state, 'local')).toBe(state);

    state = assignScout(state, 'southern-europe');
    expect(scoutsAvailable(state)).toBe(0);
    expect(canAssignScout(state, 'northern-europe')).toBe(false);
    expect(assignScout(state, 'northern-europe')).toBe(state);

    const partial = assignScout(reachVerify(), 'local');
    expect(endRound(partial)).toBe(partial);
  });

  it('轮末收回球探并重置派遣，知识度留在区域里', () => {
    let state = reachVerify();
    state = finishRound(state, ['local', 'southern-europe']);
    expect(state.round).toBe(1);
    expect(state.dispatches).toEqual([]);
    expect(scoutsAvailable(state)).toBe(SCOUTS_PER_ROUND);
    expect(state.knowledge.local).toBe(40);
    expect(state.knowledge['southern-europe']).toBe(40);
    expect(state.knowledge['northern-europe']).toBe(0);
    expect(state.history).toHaveLength(1);
    expect(state.history[0].regions).toEqual(['local', 'southern-europe']);

    state = finishRound(state, ['local', 'local']);
    expect(state.round).toBe(1);

    state = finishRound(state, ['local', 'local']);
    expect(state.round).toBe(1);
  });

  it('非法状态下的派遣被拒绝：未装模块、阶段不对、区域不存在', () => {
    const fresh = newState();
    expect(assignScout(fresh, 'local')).toBe(fresh);
    let state = reachVerify();
    state = { ...state, installed: { limitedScouts: false, knowledgeReports: true } };
    expect(canAssignScout(state, 'local')).toBe(false);
    expect(assignScout(state, 'local')).toBe(state);
    const verify = reachVerify();
    expect(assignScout(verify, 'not-a-region' as never)).toBe(verify);
  });
});

describe('球探室：知识度与报告精度', () => {
  it('知识度每次 +40、上限 100', () => {
    expect(gainKnowledge(0)).toBe(40);
    expect(gainKnowledge(40)).toBe(80);
    expect(gainKnowledge(70)).toBe(100);
    expect(gainKnowledge(80)).toBe(100);
    expect(gainKnowledge(100)).toBe(KNOWLEDGE_MAX);
  });

  it('阈值对应报告精度：0 未知、1–34 模糊、35–74 较窄、75+ 接近真实', () => {
    expect(reportPrecision(0)).toBe('unknown');
    expect(reportPrecision(1)).toBe('wide');
    expect(reportPrecision(34)).toBe('wide');
    expect(reportPrecision(35)).toBe('narrow');
    expect(reportPrecision(74)).toBe('narrow');
    expect(reportPrecision(75)).toBe('precise');
    expect(reportPrecision(100)).toBe('precise');
    expect(precisionLabel('unknown')).toBe('未知');
  });

  it('报告区间随知识度收窄，但任何精度都不是唯一精确值', () => {
    const candidate = SCOUT_CANDIDATES[0];
    const overall = trueOverall(candidate);
    const wide = reportRange(overall, 20);
    const narrow = reportRange(overall, 50);
    const precise = reportRange(overall, 80);
    expect(wide).not.toBeNull();
    expect(narrow).not.toBeNull();
    expect(precise).not.toBeNull();
    expect((wide as { high: number }).high - (wide as { low: number }).low).toBeGreaterThan(
      (narrow as { high: number }).high - (narrow as { low: number }).low,
    );
    expect((narrow as { high: number }).high - (narrow as { low: number }).low).toBeGreaterThan(
      (precise as { high: number }).high - (precise as { low: number }).low,
    );
    expect((precise as { high: number }).high).toBeGreaterThan((precise as { low: number }).low);
  });

  it('知识度不足时看不到精确值，报告只给区间或未知', () => {
    const candidate = SCOUT_CANDIDATES[4];
    const overall = trueOverall(candidate);
    const unknown = candidateReport(candidate, 0);
    expect(unknown.precision).toBe('unknown');
    expect(unknown.range).toBeNull();
    expect(unknown.summary).not.toContain(String(overall));
    expect(unknown.summary).toContain('未知');

    const wide = candidateReport(candidate, 20);
    expect(wide.range).not.toBeNull();
    expect((wide.range as { low: number }).low).toBeLessThan(overall);
    expect((wide.range as { high: number }).high).toBeGreaterThan(overall);
    expect((wide.range as { high: number }).high - (wide.range as { low: number }).low).toBeGreaterThan(0);

    const reports = buildCandidateReports(reachSelection());
    expect(reports).toHaveLength(SCOUT_CANDIDATES.length);
  });
});

describe('球探室：阶段、证据与完成', () => {
  it('故障版需要先考察并挑人才能结束，结束后点亮体验证据', () => {
    let state = newState();
    expect(state.evidence.experiencedFault).toBe(false);
    state = startFaultPlay(state);
    expect(finishFaultPlay(state)).toBe(state);
    state = inspectCandidate(state, 'lin-tuo');
    expect(finishFaultPlay(state)).toBe(state);
    state = pickFaultCandidate(state, 'lin-tuo');
    state = finishFaultPlay(state);
    expect(state.phase).toBe('diagnose');
    expect(state.evidence.experiencedFault).toBe(true);
  });

  it('证据在真实操作发生的时刻才点亮：操作机制、迁移', () => {
    let state = reachSelection();
    expect(state.evidence.operatedMechanic).toBe(false);
    expect(selectCandidate(state, 'not-a-candidate')).toBe(state);
    state = selectCandidate(state, 'marco-vera');
    expect(state.evidence.operatedMechanic).toBe(true);
    expect(state.selectedCandidateId).toBe('marco-vera');

    state = openTransfer(state);
    expect(state.evidence.transferred).toBe(false);
    state = resolveTransfer(state);
    expect(state.evidence.transferred).toBe(true);
  });

  it('未完成全部轮次不能选候选，未选候选不能进入迁移', () => {
    const partial = finishRound(reachVerify(), ['local', 'southern-europe']);
    expect(isSelectingCandidate(partial)).toBe(false);
    expect(selectCandidate(partial, 'lin-tuo')).toBe(partial);
    expect(openTransfer(partial)).toBe(partial);

    const selecting = reachSelection();
    expect(isSelectingCandidate(selecting)).toBe(true);
    expect(openTransfer(selecting)).toBe(selecting);
  });

  it('canComplete 只在所有前置完成后成立，归档只结算一次', () => {
    let state = reachSelection();
    expect(canComplete(state)).toBe(false);
    state = selectCandidate(state, 'otto-lind');
    state = openTransfer(state);
    state = resolveTransfer(state);
    state = openSummary(state);
    expect(canComplete(state)).toBe(true);
    const archived = completeArchive(state);
    expect(archived.completed).toBe(true);
    expect(canComplete(archived)).toBe(false);
    expect(completeArchive(archived)).toBe(archived);
  });
});

describe('球探室：同种子、存档与展示模式', () => {
  it('同种子得到相同的候选顺序与随机状态，动作序列结果一致', () => {
    const first = reachSelection(777);
    const second = reachSelection(777);
    expect(first.candidateOrder).toEqual(second.candidateOrder);
    expect(first.rng).toEqual(second.rng);
    expect(first.knowledge).toEqual(second.knowledge);
    expect(first.history).toEqual(second.history);
    expect(first.eventLog).toEqual(second.eventLog);

    const firstInit = newState(777);
    const differentInit = newState(999);
    expect(firstInit.seed).not.toBe(differentInit.seed);
    expect(firstInit.rng).not.toEqual(differentInit.rng);
    expect(differentInit.candidateOrder).toHaveLength(SCOUT_CANDIDATES.length);
  });

  it('合法存档可以恢复，损坏存档安全回退为 null', () => {
    let state = reachVerify();
    state = assignScout(state, 'local');
    const restored = reviveScoutingState(JSON.parse(JSON.stringify(state)) as unknown, NORMAL);
    expect(restored).not.toBeNull();
    expect(restored?.phase).toBe('verify');
    expect(restored?.knowledge).toEqual(state.knowledge);
    expect(restored?.dispatches).toEqual(['local']);
    expect(restored?.candidateOrder).toEqual(state.candidateOrder);
    expect(restored?.eventLog.length).toBe(state.eventLog.length);

    const base = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    expect(reviveScoutingState(null, NORMAL)).toBeNull();
    expect(reviveScoutingState({}, NORMAL)).toBeNull();
    expect(reviveScoutingState({ ...base, knowledge: { local: 999 } }, NORMAL)).toBeNull();
    expect(reviveScoutingState({ ...base, candidateOrder: ['x'] }, NORMAL)).toBeNull();
    expect(reviveScoutingState({ ...base, dispatches: ['local', 'local'] }, NORMAL)).toBeNull();
    expect(reviveScoutingState(base, showcase('verify', true))).toBeNull();
  });

  it('展示模式 startPhase=verify 预装模块，1 轮派遣即可完成并跳过迁移', () => {
    let state = createInitialScoutingState(showcase('verify', true), 20251018);
    expect(state.phase).toBe('verify');
    expect(state.installed.limitedScouts).toBe(true);
    expect(state.installed.knowledgeReports).toBe(true);
    expect(state.rounds).toBe(1);
    state = finishRound(state, ['local', 'northern-europe']);
    expect(state.round).toBe(1);
    state = selectCandidate(state, 'lin-tuo');
    state = openTransfer(state);
    state = skipTransferInShowcase(state);
    expect(state.phase).toBe('summary');
    expect(state.transfer.skipped).toBe(true);
    expect(state.evidence.transferred).toBe(false);
    expect(canComplete(state)).toBe(true);
  });

  it('正常模式下不能跳过迁移题', () => {
    let state = reachSelection();
    state = selectCandidate(state, 'lin-tuo');
    state = openTransfer(state);
    expect(skipTransferInShowcase(state)).toBe(state);
  });

  it('迁移题的正确选项是有限球探网络，诊断题正确答案指向信息成本', () => {
    expect(DIAGNOSE_CORRECT_ID).toBe('scouts-limited');
    const correct = TRANSFER_OPTIONS.find((option) => option.id === 'limited-scouts-network');
    expect(correct).toBeTruthy();
    expect(TRANSFER_OPTIONS).toHaveLength(3);
    expect(REGIONS.length).toBe(4);
  });
});

describe('球探室：UI 冒烟测试', () => {
  it('从故障考察走到归档，onComplete 只触发一次', () => {
    const onComplete = vi.fn();
    const onExit = vi.fn();
    const props = makeProps({ onComplete, onExit });
    render(createElement(ScoutingLevel, props));

    // 故障试玩：点一次考察立刻全知，然后加入候选名单。
    expect(screen.getByText(/故障试玩：信息全知/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '考察（瞬间全知）' })[0]);
    const pickButtons = screen.getAllByRole('button', { name: '加入候选名单' }) as HTMLButtonElement[];
    const enabledPick = pickButtons.find((button) => !button.disabled);
    expect(enabledPick).toBeTruthy();
    fireEvent.click(enabledPick as HTMLButtonElement);
    fireEvent.click(screen.getByRole('button', { name: '结束故障试玩，去诊断' }));

    // 诊断。
    fireEvent.click(screen.getByRole('radio', { name: /球探数量有限，信息应该逐步变清楚/ }));
    fireEvent.click(screen.getByRole('button', { name: '提交判断' }));
    fireEvent.click(screen.getByRole('button', { name: '开始维修' }));

    // 安装两个模块。
    fireEvent.click(screen.getByRole('button', { name: '安装模块：有限球探' }));
    fireEvent.click(screen.getByRole('button', { name: '安装模块：知识度报告' }));
    fireEvent.click(screen.getByRole('button', { name: /开始派遣/ }));

    // 第 1 轮：派两个区域，结束本轮。
    fireEvent.click(screen.getByRole('button', { name: '派球探到本地球市' }));
    fireEvent.click(screen.getByRole('button', { name: '派球探到南欧' }));
    fireEvent.click(screen.getByRole('button', { name: '结束本轮并收回球探' }));

    // 第 2 轮：再派同样两个区域。
    fireEvent.click(screen.getByRole('button', { name: '派球探到本地球市' }));
    fireEvent.click(screen.getByRole('button', { name: '派球探到南欧' }));
    fireEvent.click(screen.getByRole('button', { name: '结束本轮并收回球探' }));

    // 两轮结束，根据报告选一名候选。
    fireEvent.click(screen.getAllByRole('button', { name: '加入候选名单' })[0]);
    expect(screen.getByText(/真实能力（选完才揭晓）|真实能力（选完才揭晓）/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '完成验证，去迁移' }));

    // 迁移单选的正确项。
    fireEvent.click(screen.getByRole('radio', { name: /派有限球探分区域考察/ }));
    fireEvent.click(screen.getByRole('button', { name: '提交判断' }));
    fireEvent.click(screen.getByRole('button', { name: '进入归档' }));

    const archiveButton = screen.getByRole('button', { name: /完成归档，返回修理铺/ });
    fireEvent.click(archiveButton);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
    fireEvent.click(archiveButton);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('展示模式从 verify 开始，可以跳过迁移题完成演示', () => {
    const onComplete = vi.fn();
    const props = makeProps({
      mode: 'showcase',
      fastStart: false,
      showcaseOptions: { seed: 20251018, fastPlay: true, startPhase: 'verify' },
      onComplete,
    });
    render(createElement(ScoutingLevel, props));

    fireEvent.click(screen.getByRole('button', { name: '派球探到本地球市' }));
    fireEvent.click(screen.getByRole('button', { name: '派球探到北欧' }));
    fireEvent.click(screen.getByRole('button', { name: '结束本轮并收回球探' }));
    fireEvent.click(screen.getAllByRole('button', { name: '加入候选名单' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '完成验证，去迁移' }));
    fireEvent.click(screen.getByRole('button', { name: '演示跳过迁移题' }));
    fireEvent.click(screen.getByRole('button', { name: /完成归档，返回修理铺/ }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    const result = onComplete.mock.calls[0][0] as { evidence: { transferred: boolean; experiencedFault: boolean } };
    expect(result.evidence.transferred).toBe(false);
    expect(result.evidence.experiencedFault).toBe(false);
  });
});
