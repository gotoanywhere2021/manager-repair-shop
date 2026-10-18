import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getLevel } from '../src/game/levels';
import type { LevelScreenProps } from '../src/game/engine/types';
import type { RngState } from '../src/game/engine/rng';
import {
  DIAGNOSE_CORRECT_ID,
  DEFAULT_TACTICS_CONFIG,
  FAULT_INSTRUCTIONS,
  FAULT_METRICS,
  TRANSFER_OPTIONS,
  buildTacticsComparison,
  canComplete,
  chooseFaultInstruction,
  chooseVerifyInstruction,
  completeArchive,
  createInitialTacticsState,
  faultTotals,
  installDualShape,
  installRoleDuties,
  openDiagnose,
  openSummary,
  openTransfer,
  requiredStages,
  resolveDiagnose,
  resolveTransfer,
  reviveTacticsState,
  simulateFaultStage,
  simulateVerifyStage,
  skipTransferInShowcase,
  startFaultPlay,
  startRepair,
  startVerify,
  tacticsMetrics,
  verifyTotals,
} from '../src/game/levels/tactics/logic';
import type { TacticsConfig, TacticsInitOptions, TacticsState } from '../src/game/levels/tactics/logic';
import { TacticsLevel } from '../src/game/levels/tactics/TacticsLevel';
import { createRng } from '../src/game/engine/rng';

const NORMAL: TacticsInitOptions = { mode: 'normal', fastStart: false, showcaseOptions: null };

function showcase(startPhase: 'faultPlay' | 'diagnose' | 'repair' | 'verify', fastPlay = true): TacticsInitOptions {
  return { mode: 'showcase', fastStart: false, showcaseOptions: { seed: 20251018, fastPlay, startPhase } };
}

function newNormalState(seed = 42): TacticsState {
  return createInitialTacticsState(NORMAL, seed);
}

function playFault(state: TacticsState): TacticsState {
  let next = startFaultPlay(state);
  const stages = requiredStages(next);
  for (let index = 0; index < stages; index += 1) {
    next = chooseFaultInstruction(next, 'press');
  }
  return next;
}

function reachRepair(): TacticsState {
  let next = playFault(newNormalState());
  next = openDiagnose(next);
  next = resolveDiagnose(next);
  return startRepair(next);
}

function reachVerify(): TacticsState {
  let next = reachRepair();
  next = installDualShape(next);
  next = installRoleDuties(next);
  return startVerify(next);
}

function playVerify(state: TacticsState, instruction: 'press-strong' | 'cover-wing' | 'shrink-center' = 'cover-wing'): TacticsState {
  let next = state;
  const stages = requiredStages(next);
  for (let index = 0; index < stages; index += 1) {
    next = chooseVerifyInstruction(next, instruction);
  }
  return next;
}

function makeProps(overrides: Partial<LevelScreenProps> = {}): LevelScreenProps {
  return {
    level: getLevel('tactics'),
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

describe('战术板：双形态指标', () => {
  it('双形态与职责把边路/中路保护拉高，同时增加体能代价', () => {
    const fixed = tacticsMetrics(DEFAULT_TACTICS_CONFIG);
    expect(fixed.progression).toBeGreaterThan(FAULT_METRICS.progression);
    expect(fixed.wingProtection).toBeGreaterThan(FAULT_METRICS.wingProtection);
    expect(fixed.centralProtection).toBeGreaterThan(FAULT_METRICS.centralProtection);
    expect(fixed.stamina).toBeGreaterThan(FAULT_METRICS.stamina);
    expect(fixed.wingProtection - FAULT_METRICS.wingProtection).toBeGreaterThanOrEqual(30);
  });

  it('有球阵型选择有取舍：3-2-5 推进更高但保护更低、体能更高', () => {
    const aggressive: TacticsConfig = { ...DEFAULT_TACTICS_CONFIG, possessionShape: '3-2-5' };
    const stable: TacticsConfig = { ...DEFAULT_TACTICS_CONFIG, possessionShape: '4-2-3-1' };
    const aggressiveMetrics = tacticsMetrics(aggressive);
    const stableMetrics = tacticsMetrics(stable);
    expect(aggressiveMetrics.progression).toBeGreaterThan(stableMetrics.progression);
    expect(aggressiveMetrics.wingProtection).toBeLessThan(stableMetrics.wingProtection);
    expect(aggressiveMetrics.stamina).toBeGreaterThan(stableMetrics.stamina);
  });

  it('职责选择有取舍：套边推进更高，内收中路保护更好', () => {
    const overlap = tacticsMetrics({ ...DEFAULT_TACTICS_CONFIG, fullbackDuty: 'overlap' });
    const invert = tacticsMetrics({ ...DEFAULT_TACTICS_CONFIG, fullbackDuty: 'invert' });
    expect(overlap.progression).toBeGreaterThan(invert.progression);
    expect(invert.centralProtection).toBeGreaterThan(overlap.centralProtection);
  });
});

describe('战术板：故障版与验证阶段', () => {
  it('故障版三个指令都改变不了边路结构，结果完全确定', () => {
    const wingChances = FAULT_INSTRUCTIONS.map((option) => simulateFaultStage(option.id, 1).opponentWingChances);
    expect(new Set(wingChances).size).toBe(1);
    expect(wingChances[0]).toBe(4);
    expect(simulateFaultStage('press', 2)).toEqual(simulateFaultStage('press', 2));
  });

  it('故障版完成三个阶段的记录与证据', () => {
    let state = playFault(newNormalState());
    expect(state.phase).toBe('faultPlay');
    expect(state.fault.played).toHaveLength(3);
    expect(state.fault.done).toBe(true);
    expect(state.evidence.experiencedFault).toBe(true);
    const totals = faultTotals(state.fault.played);
    expect(totals.chancesFor).toBe(6);
    expect(totals.goalsAgainst).toBe(6);
    expect(totals.wingGoalsAgainst).toBe(6);
  });

  it('验证阶段根据形态、职责与阶段指令计算，并写入真实日志', () => {
    const config = DEFAULT_TACTICS_CONFIG;
    const rng = createRng(99);
    const simulation = simulateVerifyStage(config, 'cover-wing', 1, rng);
    expect(simulation.result.stage).toBe(1);
    expect(['right', 'center', 'left']).toContain(simulation.result.attackSide);
    expect(simulation.rng.calls).toBeGreaterThan(rng.calls);

    let state = playVerify(reachVerify());
    expect(state.phase).toBe('verify');
    expect(state.verify.done).toBe(true);
    expect(state.verify.results).toHaveLength(3);
    const stageEvents = state.eventLog.filter((entry) => entry.action.startsWith('verify-stage-'));
    expect(stageEvents).toHaveLength(3);
    // 阶段事件里的数据来自真实计算结果，不是假统计。
    expect(stageEvents[0].after.goalsAgainst).toBe(state.verify.results[0].goalsAgainst);
    expect(stageEvents[0].label).toContain('保护边路');
  });

  it('修复版的整体记录优于故障版，且对比表只读真实状态', () => {
    const state = playVerify(reachVerify());
    const fixed = verifyTotals(state.verify.results);
    const fault = faultTotals(state.fault.played);
    expect(fixed.goalsAgainst).toBeLessThan(fault.goalsAgainst);
    expect(fixed.wingGoalsAgainst).toBeLessThan(fault.wingGoalsAgainst);
    expect(fixed.chancesFor).toBeGreaterThanOrEqual(fault.chancesFor);
    const rows = buildTacticsComparison(state);
    expect(rows.find((row) => row.label === '失球')?.fixed).toBe(`${fixed.goalsAgainst} 个`);
    expect(rows.find((row) => row.label === '边路丢球')?.fault).toBe(`${fault.wingGoalsAgainst} 个`);
  });

  it('同种子、同动作序列得到相同结果；序列化恢复后随机序列继续一致', () => {
    const run = (): TacticsState => {
      let state = createInitialTacticsState(showcase('verify', true), 20251018);
      state = chooseVerifyInstruction(state, 'cover-wing');
      state = chooseVerifyInstruction(state, 'press-strong');
      return state;
    };
    const first = run();
    const second = run();
    expect(first.verify.results).toEqual(second.verify.results);
    expect(first.rng).toEqual(second.rng);

    const restored = reviveTacticsState(
      JSON.parse(JSON.stringify(first)) as unknown,
      showcase('verify', true),
    );
    expect(restored).not.toBeNull();
    expect(restored?.verify.results).toEqual(first.verify.results);
    const continuedA = chooseVerifyInstruction(first, 'shrink-center');
    const continuedB = chooseVerifyInstruction(restored as TacticsState, 'shrink-center');
    expect(continuedA.verify.results).toEqual(continuedB.verify.results);
    expect(continuedA.rng).toEqual(continuedB.rng);

    const otherSeed = run();
    const different = createInitialTacticsState(showcase('verify', true), 777);
    expect((different.rng as RngState).state).not.toBe(otherSeed.rng.state);
  });
});

describe('战术板：前置条件、证据与完成', () => {
  it('未完成前置阶段不能进入或操作验证', () => {
    const fresh = newNormalState();
    expect(startVerify(fresh)).toBe(fresh);
    expect(chooseVerifyInstruction(fresh, 'cover-wing')).toBe(fresh);

    let state = reachRepair();
    state = installDualShape(state);
    expect(state.repairStep).toBe('duty');
    expect(startVerify(state)).toBe(state);
    expect(chooseVerifyInstruction(state, 'cover-wing')).toBe(state);
  });

  it('证据在真实操作发生的时刻才点亮', () => {
    let state = newNormalState();
    expect(state.evidence.experiencedFault).toBe(false);
    expect(state.evidence.operatedMechanic).toBe(false);
    expect(state.evidence.transferred).toBe(false);

    state = startFaultPlay(state);
    state = chooseFaultInstruction(state, 'balance');
    expect(state.evidence.experiencedFault).toBe(false);
    state = chooseFaultInstruction(state, 'drop');
    state = chooseFaultInstruction(state, 'press');
    expect(state.evidence.experiencedFault).toBe(true);

    state = openDiagnose(state);
    state = resolveDiagnose(state);
    state = startRepair(state);
    state = installDualShape(state);
    expect(state.evidence.operatedMechanic).toBe(false);
    state = installRoleDuties(state);
    state = startVerify(state);
    state = chooseVerifyInstruction(state, 'cover-wing');
    expect(state.evidence.operatedMechanic).toBe(false);
    state = chooseVerifyInstruction(state, 'cover-wing');
    state = chooseVerifyInstruction(state, 'cover-wing');
    expect(state.evidence.operatedMechanic).toBe(true);

    state = openTransfer(state);
    expect(state.evidence.transferred).toBe(false);
    state = resolveTransfer(state);
    expect(state.evidence.transferred).toBe(true);
  });

  it('canComplete 只在所有前置真实完成后成立，且归档只结算一次', () => {
    let state = reachVerify();
    expect(canComplete(state)).toBe(false);
    state = playVerify(state);
    expect(canComplete(state)).toBe(false);
    state = openTransfer(state);
    expect(canComplete(state)).toBe(false);
    state = resolveTransfer(state);
    expect(canComplete(state)).toBe(false);
    state = openSummary(state);
    expect(canComplete(state)).toBe(true);
    const archived = completeArchive(state);
    expect(archived.completed).toBe(true);
    expect(canComplete(archived)).toBe(false);
    expect(completeArchive(archived)).toBe(archived);
  });

  it('诊断题正确答案是「两套不同的站位与职责」', () => {
    expect(DIAGNOSE_CORRECT_ID).toBe('dual-shape-needed');
    const correct = TRANSFER_OPTIONS.filter((option) => option.id.startsWith('possession') || option.id === 'out-shape' || option.id === 'role-duties');
    expect(correct).toHaveLength(3);
  });
});

describe('战术板：展示模式与存档校验', () => {
  it('startPhase=repair 预填故障与诊断，但不会伪造「体验故障」证据', () => {
    const state = createInitialTacticsState(showcase('repair', true), 20251018);
    expect(state.phase).toBe('repair');
    expect(state.repairStep).toBe('shape');
    expect(state.installed.dualShape).toBe(false);
    expect(state.diagnose.resolved).toBe(true);
    expect(state.fault.done).toBe(true);
    expect(state.evidence.experiencedFault).toBe(false);
  });

  it('startPhase=verify 预装两个模块，可以用 2 个阶段完成并跳过迁移', () => {
    let state = createInitialTacticsState(showcase('verify', true), 20251018);
    expect(state.phase).toBe('verify');
    expect(state.installed.dualShape).toBe(true);
    expect(state.installed.roleDuties).toBe(true);
    expect(requiredStages(state)).toBe(2);
    state = playVerify(state);
    expect(state.verify.done).toBe(true);
    expect(state.evidence.operatedMechanic).toBe(true);
    state = openTransfer(state);
    state = skipTransferInShowcase(state);
    expect(state.phase).toBe('summary');
    expect(state.transfer.skipped).toBe(true);
    expect(state.evidence.transferred).toBe(false);
    expect(canComplete(state)).toBe(true);
  });

  it('正常模式下不能跳过迁移题', () => {
    let state = playVerify(reachVerify());
    state = openTransfer(state);
    const skipped = skipTransferInShowcase(state);
    expect(skipped).toBe(state);
  });

  it('合法存档可以恢复，损坏存档安全回退为 null', () => {
    const state = reachRepair();
    const restored = reviveTacticsState(JSON.parse(JSON.stringify(state)) as unknown, NORMAL);
    expect(restored).not.toBeNull();
    expect(restored?.phase).toBe('repair');
    expect(restored?.config).toEqual(state.config);
    expect(restored?.fault.played).toEqual(state.fault.played);
    expect(restored?.eventLog.length).toBe(state.eventLog.length);

    const base = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    expect(reviveTacticsState(null, NORMAL)).toBeNull();
    expect(reviveTacticsState({}, NORMAL)).toBeNull();
    expect(reviveTacticsState({ ...base, phase: '不存在的阶段' }, NORMAL)).toBeNull();
    expect(reviveTacticsState({ ...base, evidence: { experiencedFault: true } }, NORMAL)).toBeNull();
    expect(reviveTacticsState({ ...base, config: { ...(base.config as object), possessionShape: '9-9-9' } }, NORMAL)).toBeNull();
    expect(reviveTacticsState({ ...base, eventLog: '不是数组' }, NORMAL)).toBeNull();
    expect(reviveTacticsState(base, showcase('verify', true))).toBeNull();
  });
});

describe('战术板：UI 冒烟测试', () => {
  it('从故障试玩走到归档，onComplete 只触发一次', () => {
    const props = makeProps();
    render(createElement(TacticsLevel, props));

    // 故障试玩：fastStart 直接从 faultPlay 开始，需要 3 个阶段。
    expect(screen.getByText(/故障试玩：固定一套 4-4-2/)).toBeTruthy();
    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: /压上/ }));
    }
    expect(screen.getByText(/边路空当始终存在/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '带着问题去诊断' }));

    // 诊断题：选择正确项并提交。
    fireEvent.click(screen.getByRole('radio', { name: /控球和无球需要两套不同的站位与职责/ }));
    fireEvent.click(screen.getByRole('button', { name: '提交判断' }));
    fireEvent.click(screen.getByRole('button', { name: '开始维修' }));

    // 两次维修：双形态与职责分工。
    fireEvent.click(screen.getByRole('button', { name: '安装双形态战术' }));
    fireEvent.click(screen.getByRole('button', { name: '安装职责分工' }));
    fireEvent.click(screen.getByRole('button', { name: '开始验证' }));

    // 验证：3 个阶段都选「保护边路」。
    for (let index = 0; index < 3; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: /保护边路/ }));
    }
    expect(screen.getByText(/双形态的收益与代价/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '完成验证，去迁移' }));

    // 迁移多选：三个正确组成。
    fireEvent.click(screen.getByRole('checkbox', { name: /有球形态：控球时/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /无球形态：丢球后/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /职责分工：同一位置/ }));
    fireEvent.click(screen.getByRole('button', { name: '提交判断' }));
    fireEvent.click(screen.getByRole('button', { name: '进入归档' }));

    // 归档：onComplete 与 onExit 各一次。
    const archiveButton = screen.getByRole('button', { name: /完成归档，返回修理铺/ });
    fireEvent.click(archiveButton);
    expect(props.onComplete).toHaveBeenCalledTimes(1);
    expect(props.onExit).toHaveBeenCalledTimes(1);
    fireEvent.click(archiveButton);
    expect(props.onComplete).toHaveBeenCalledTimes(1);
    expect(props.onExit).toHaveBeenCalledTimes(1);
  });

  it('展示模式从 verify 开始，可以跳过迁移题完成演示', () => {
    const props = makeProps({
      mode: 'showcase',
      fastStart: false,
      showcaseOptions: { seed: 20251018, fastPlay: true, startPhase: 'verify' },
    });
    render(createElement(TacticsLevel, props));

    for (let index = 0; index < 2; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: /保护边路/ }));
    }
    fireEvent.click(screen.getByRole('button', { name: '完成验证，去迁移' }));
    fireEvent.click(screen.getByRole('button', { name: '演示跳过迁移题' }));
    expect(screen.getAllByText(/本次不计「迁移」证据/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /完成归档，返回修理铺/ }));
    expect(props.onComplete).toHaveBeenCalledTimes(1);
    const result = (props.onComplete as ReturnType<typeof vi.fn>).mock.calls[0][0] as { evidence: { transferred: boolean } };
    expect(result.evidence.transferred).toBe(false);
  });
});
