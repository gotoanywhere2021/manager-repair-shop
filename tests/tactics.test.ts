import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getLevel } from '../src/game/levels';
import type { LevelScreenProps } from '../src/game/engine/types';
import { createRng } from '../src/game/engine/rng';
import {
  DEFAULT_TACTICS_CONFIG,
  DIAGNOSE_CORRECT_ID,
  FAULT_METRICS,
  FULLBACK_DUTY_OPTIONS,
  LONG_BALL_CHANCE_PENALTY,
  LONG_BALL_DELTAS,
  MAN_MARKING_CHANCE_BONUS,
  MAN_MARKING_DELTAS,
  OUT_SHAPE_OPTIONS,
  PIVOT_DUTY_OPTIONS,
  POSSESSION_SHAPE_OPTIONS,
  TACTICS_MODULES,
  TACTICS_TARGETS,
  TRANSFER_OPTIONS,
  addMetrics,
  archiveBlockReason,
  archiveBlocker,
  buildArchiveSummary,
  buildClubUpdate,
  buildCompletionResult,
  buildTacticsComparison,
  canComplete,
  chooseFaultInstruction,
  chooseVerifyInstruction,
  completeArchive,
  createInitialTacticsState,
  dutyMetrics,
  evaluateTacticsVerification,
  faultTotals,
  installTacticsModule,
  loadoutModuleNames,
  openDiagnose,
  openSummary,
  openTransfer,
  requiredStages,
  resolveDiagnose,
  resolveTransfer,
  retryVerification,
  reviveTacticsState,
  shapeMetrics,
  simulateFaultStage,
  simulateFaultStages,
  simulateVerifyStage,
  skipTransferInShowcase,
  startFaultPlay,
  startRepair,
  startVerify,
  toggleTacticsModule,
  uninstallTacticsModule,
  verificationChanceModifiers,
  verificationMetrics,
  verifyTotals,
} from '../src/game/levels/tactics/logic';
import type { TacticsInitOptions, TacticsState } from '../src/game/levels/tactics/logic';
import { TacticsLevel } from '../src/game/levels/tactics/TacticsLevel';

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

function reachRepair(seed = 42): TacticsState {
  let next = playFault(newNormalState(seed));
  next = openDiagnose(next);
  next = resolveDiagnose(next);
  return startRepair(next);
}

function installCorrectModules(state: TacticsState): TacticsState {
  let next = installTacticsModule(state, 'dual-shape');
  next = installTacticsModule(next, 'role-duties');
  return next;
}

function installWrongModules(state: TacticsState): TacticsState {
  let next = installTacticsModule(state, 'man-marking');
  next = installTacticsModule(next, 'long-ball');
  return next;
}

function reachVerify(seed = 42): TacticsState {
  return startVerify(installCorrectModules(reachRepair(seed)));
}

function playVerify(state: TacticsState, instruction: 'press-strong' | 'cover-wing' | 'shrink-center' = 'cover-wing'): TacticsState {
  let next = state;
  const stages = requiredStages(next);
  for (let index = 0; index < stages; index += 1) {
    next = chooseVerifyInstruction(next, instruction);
  }
  return next;
}

function reachFinishedVerify(seed = 42): TacticsState {
  return playVerify(reachVerify(seed));
}

function reachSummary(seed = 42): TacticsState {
  let next = reachFinishedVerify(seed);
  next = openTransfer(next);
  next = resolveTransfer(next);
  return openSummary(next);
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

describe('战术板 v2：模块池与错误模块的数值影响', () => {
  it('4 个模块分属两个槽位，正确/错误模块标签真实', () => {
    expect(TACTICS_MODULES).toHaveLength(4);
    expect(TACTICS_MODULES.filter((module) => module.slot === 'shape')).toHaveLength(2);
    expect(TACTICS_MODULES.filter((module) => module.slot === 'attack')).toHaveLength(2);
    expect(TACTICS_MODULES.find((module) => module.id === 'dual-shape')?.correct).toBe(true);
    expect(TACTICS_MODULES.find((module) => module.id === 'man-marking')?.correct).toBe(false);
    expect(TACTICS_MODULES.find((module) => module.id === 'long-ball')?.sideEffect).toContain('机会');
  });

  it('正确模块把边路/中路保护拉高；错误模块真实变差', () => {
    const base = reachRepair();
    expect(verificationMetrics(base)).toEqual(FAULT_METRICS);

    const correct = verificationMetrics(installCorrectModules(base));
    expect(correct.progression).toBeGreaterThan(FAULT_METRICS.progression);
    expect(correct.wingProtection).toBeGreaterThan(FAULT_METRICS.wingProtection);
    expect(correct.centralProtection).toBeGreaterThan(FAULT_METRICS.centralProtection);
    expect(correct.stamina).toBeGreaterThan(FAULT_METRICS.stamina);

    const manMarking = verificationMetrics(installTacticsModule(base, 'man-marking'));
    expect(manMarking.wingProtection).toBeLessThan(FAULT_METRICS.wingProtection);
    expect(manMarking.stamina).toBeGreaterThan(correct.stamina);
    expect(manMarking).toEqual(addMetrics(FAULT_METRICS, MAN_MARKING_DELTAS));

    const longBall = verificationMetrics(installTacticsModule(base, 'long-ball'));
    expect(longBall.progression).toBeLessThan(FAULT_METRICS.progression);
    expect(longBall.stamina).toBeLessThan(FAULT_METRICS.stamina);
    expect(longBall).toEqual(addMetrics(FAULT_METRICS, LONG_BALL_DELTAS));

    const modifiers = verificationChanceModifiers(installWrongModules(base));
    expect(modifiers.bonus).toBe(MAN_MARKING_CHANCE_BONUS);
    expect(modifiers.penalty).toBe(LONG_BALL_CHANCE_PENALTY);
  });

  it('两个槽位的模块互斥替换，且可以自由卸载', () => {
    let state = reachRepair();
    state = installTacticsModule(state, 'dual-shape');
    expect(state.loadout.shape).toBe('dual-shape');
    state = installTacticsModule(state, 'man-marking');
    expect(state.loadout.shape).toBe('man-marking');
    expect(loadoutModuleNames(state.loadout)).toContain('全场人盯人');
    state = toggleTacticsModule(state, 'man-marking');
    expect(state.loadout.shape).toBeNull();
    state = installTacticsModule(state, 'long-ball');
    expect(uninstallTacticsModule(state, 'long-ball').loadout.attack).toBeNull();
  });

  it('阵型与职责本身的取舍仍然成立', () => {
    const aggressive = verificationMetrics({
      config: { ...DEFAULT_TACTICS_CONFIG, possessionShape: '3-2-5' },
      loadout: { shape: 'dual-shape', attack: 'role-duties' },
    });
    const stable = verificationMetrics({
      config: { ...DEFAULT_TACTICS_CONFIG, possessionShape: '4-2-3-1' },
      loadout: { shape: 'dual-shape', attack: 'role-duties' },
    });
    expect(aggressive.progression).toBeGreaterThan(stable.progression);
    expect(aggressive.wingProtection).toBeLessThan(stable.wingProtection);
    expect(aggressive.stamina).toBeGreaterThan(stable.stamina);
    expect(shapeMetrics('4-3-3', '4-4-2-mid').wingProtection).toBeGreaterThan(FAULT_METRICS.wingProtection);
    expect(dutyMetrics('overlap', 'double').centralProtection).toBeGreaterThan(0);
    expect(POSSESSION_SHAPE_OPTIONS).toHaveLength(3);
    expect(OUT_SHAPE_OPTIONS).toHaveLength(3);
    expect(FULLBACK_DUTY_OPTIONS).toHaveLength(2);
    expect(PIVOT_DUTY_OPTIONS).toHaveLength(2);
  });
});

describe('战术板 v2：验证计算、目标与失败重试', () => {
  it('故障版三指令不改变边路结构，结果确定', () => {
    const wingChances = [simulateFaultStage('press', 1), simulateFaultStage('balance', 1), simulateFaultStage('drop', 1)].map(
      (result) => result.opponentWingChances,
    );
    expect(new Set(wingChances).size).toBe(1);
    expect(wingChances[0]).toBe(4);
    expect(simulateFaultStage('press', 2)).toEqual(simulateFaultStage('press', 2));
    expect(simulateFaultStages(3)).toHaveLength(3);
  });

  it('验证阶段由指标、指令和种子共同决定，并写入日志', () => {
    const rng = createRng(99);
    const simulation = simulateVerifyStage(
      { metrics: verificationMetrics(installCorrectModules(reachRepair())), chanceBonus: 0, chancePenalty: 0 },
      'cover-wing',
      1,
      rng,
    );
    expect(simulation.result.stage).toBe(1);
    expect(['right', 'center', 'left']).toContain(simulation.result.attackSide);
    expect(simulation.rng.calls).toBeGreaterThan(rng.calls);

    const state = reachFinishedVerify();
    expect(state.verify.done).toBe(true);
    expect(state.verify.results).toHaveLength(3);
    expect(state.eventLog.filter((entry) => entry.action.startsWith('verify-stage-'))).toHaveLength(3);
    expect(evaluateTacticsVerification(state).passed).toBe(true);
  });

  it('正确模块 + 保护边路能达成全部目标，并生成真实对比', () => {
    const state = reachFinishedVerify();
    const verification = evaluateTacticsVerification(state);
    expect(verification.passed).toBe(true);
    expect(verification.failed).toHaveLength(0);
    expect(verification.totals.chancesFor).toBeGreaterThanOrEqual(
      requiredStages(state) * TACTICS_TARGETS.chancesPerStage,
    );
    expect(verification.totals.goalsAgainst).toBeLessThanOrEqual(TACTICS_TARGETS.goalsAgainstMax);
    expect(verification.totals.wingGoalsAgainst).toBeLessThanOrEqual(TACTICS_TARGETS.wingGoalsAgainstMax);
    expect(verification.metrics.stamina).toBeLessThanOrEqual(TACTICS_TARGETS.staminaMax);

    const rows = buildTacticsComparison(state);
    expect(rows.find((row) => row.label === '失球')?.fixed).toBe(`${verification.totals.goalsAgainst} 个`);
    expect(rows.find((row) => row.label === '边路丢球')?.fault).toBe(
      `${faultTotals(state.fault.played).wingGoalsAgainst} 个`,
    );
  });

  it('装错模块会真实变差且无法完成验证目标', () => {
    let state = installWrongModules(reachRepair());
    state = startVerify(state);
    state = playVerify(state, 'cover-wing');
    const verification = evaluateTacticsVerification(state);
    expect(verification.passed).toBe(false);
    expect(verification.failed.map((target) => target.id)).toContain('modules');
    expect(verification.metrics.wingProtection).toBeLessThan(FAULT_METRICS.wingProtection);
    expect(verification.totals.wingGoalsAgainst).toBeGreaterThan(0);
    expect(openTransfer(state)).toBe(state);
    expect(retryVerification(state)).not.toBe(state);
  });

  it('不装模块直接验证也会失败；验证前不阻止进入验证', () => {
    let state = reachRepair();
    state = startVerify(state);
    expect(state.phase).toBe('verify');
    state = playVerify(state);
    const verification = evaluateTacticsVerification(state);
    expect(verification.passed).toBe(false);
    expect(verification.targets[0].id).toBe('modules');
    expect(verification.targets[0].met).toBe(false);
    expect(openTransfer(state)).toBe(state);
  });

  it('失败重试清空本轮成绩、保留故障证据，重新配置后可完成', () => {
    let state = installWrongModules(reachRepair());
    state = startVerify(state);
    state = playVerify(state);
    expect(state.evidence.experiencedFault).toBe(true);
    expect(state.evidence.operatedMechanic).toBe(false);
    expect(canComplete(state)).toBe(false);

    state = retryVerification(state);
    expect(state.phase).toBe('repair');
    expect(state.verify.results).toHaveLength(0);
    expect(state.verify.done).toBe(false);
    expect(state.verify.attempts).toBe(1);
    expect(state.evidence.experiencedFault).toBe(true);
    expect(state.evidence.operatedMechanic).toBe(false);
    expect(state.loadout.shape).toBe('man-marking');
    expect(state.loadout.attack).toBe('long-ball');

    // 卸载错误模块、安装正确模块后重新验证。
    state = toggleTacticsModule(state, 'man-marking');
    state = toggleTacticsModule(state, 'long-ball');
    state = installCorrectModules(state);
    state = startVerify(state);
    state = playVerify(state);
    const verification = evaluateTacticsVerification(state);
    expect(verification.passed).toBe(true);
    expect(state.evidence.operatedMechanic).toBe(true);
    expect(state.verify.results).toHaveLength(requiredStages(state));
    state = openTransfer(state);
    state = resolveTransfer(state);
    state = openSummary(state);
    expect(canComplete(state)).toBe(true);
  });

  it('验证目标未达成时归档被逻辑阻止并给出原因', () => {
    let state = installWrongModules(reachRepair());
    state = startVerify(state);
    state = playVerify(state);
    expect(archiveBlocker(state)).toBe('not-summary');
    expect(archiveBlockReason(state)).toContain('还没有');
    // 模拟一个已经进入归档页但成绩未达标的损坏状态：逻辑仍然拒绝结算。
    const forged: TacticsState = { ...state, phase: 'summary' };
    expect(archiveBlocker(forged)).toBe('verify-unmet');
    expect(archiveBlockReason(forged)).toContain('验证目标未达成');
    expect(canComplete(forged)).toBe(false);
    expect(completeArchive(forged)).toBe(forged);
  });

  it('同种子、同动作序列一致；序列化恢复后继续一致', () => {
    const run = (seed: number): TacticsState => playVerify(startVerify(installCorrectModules(reachRepair(seed))));
    const first = run(20251018);
    const second = run(20251018);
    expect(first.verify.results).toEqual(second.verify.results);
    expect(first.rng).toEqual(second.rng);

    const restored = reviveTacticsState(JSON.parse(JSON.stringify(first)) as unknown, NORMAL);
    expect(restored).not.toBeNull();
    expect(restored?.verify.results).toEqual(first.verify.results);

    const different = run(777);
    expect(different.rng.state).not.toBe(first.rng.state);
  });
});

describe('战术板 v2：证据、归档与俱乐部时间线', () => {
  it('证据只在真实操作成功时点亮', () => {
    let state = newNormalState();
    expect(state.evidence).toEqual({ experiencedFault: false, operatedMechanic: false, transferred: false });
    state = playFault(state);
    expect(state.evidence.experiencedFault).toBe(true);

    state = openDiagnose(state);
    state = resolveDiagnose(state);
    state = startRepair(state);
    state = installCorrectModules(state);
    state = startVerify(state);
    expect(state.evidence.operatedMechanic).toBe(false);
    state = playVerify(state);
    expect(state.evidence.operatedMechanic).toBe(true);
    state = openTransfer(state);
    expect(state.evidence.transferred).toBe(false);
    state = resolveTransfer(state);
    expect(state.evidence.transferred).toBe(true);
  });

  it('canComplete 只在目标全部达成后成立，归档只结算一次', () => {
    let state = reachFinishedVerify();
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

  it('clubUpdate 字段来自真实比赛数据，而不是编造评分', () => {
    const state = reachSummary();
    const clubUpdate = buildClubUpdate(state);
    const fault = faultTotals(state.fault.played);
    const fixed = verifyTotals(state.verify.results);
    expect(clubUpdate.headline).toContain(`${fault.wingGoalsAgainst}`);
    expect(clubUpdate.headline).toContain(`${fixed.wingGoalsAgainst}`);
    expect(clubUpdate.details.length).toBeGreaterThanOrEqual(2);
    expect(clubUpdate.details.length).toBeLessThanOrEqual(4);
    expect(clubUpdate.details.join(' ')).toContain(`${fixed.chancesFor}`);
    expect(clubUpdate.details.join(' ')).toContain(`${verificationMetrics(state).stamina}`);
    expect(clubUpdate.nextBrief).toContain('球探');

    const result = buildCompletionResult(state);
    expect(result.clubUpdate).toEqual(clubUpdate);
    expect(result.summary).toEqual(buildArchiveSummary(state));
    expect(result.summary).toHaveLength(3);
  });

  it('迁移题正确答案是三个组成部分', () => {
    expect(DIAGNOSE_CORRECT_ID).toBe('dual-shape-needed');
    expect(TRANSFER_OPTIONS.filter((option) => ['possession-shape', 'out-shape', 'role-duties'].includes(option.id))).toHaveLength(3);
  });
});

describe('战术板 v2：展示模式与存档校验', () => {
  it('startPhase=repair 预填诊断但不伪造证据；startPhase=verify 预装正确模块', () => {
    const repair = createInitialTacticsState(showcase('repair'), 20251018);
    expect(repair.phase).toBe('repair');
    expect(repair.diagnose.resolved).toBe(true);
    expect(repair.loadout).toEqual({ shape: null, attack: null });
    expect(repair.evidence.experiencedFault).toBe(false);

    let verify = createInitialTacticsState(showcase('verify'), 20251018);
    expect(verify.phase).toBe('verify');
    expect(verify.loadout).toEqual({ shape: 'dual-shape', attack: 'role-duties' });
    expect(requiredStages(verify)).toBe(2);
    verify = playVerify(verify);
    expect(evaluateTacticsVerification(verify).passed).toBe(true);
    verify = openTransfer(verify);
    verify = skipTransferInShowcase(verify);
    expect(verify.phase).toBe('summary');
    expect(verify.transfer.skipped).toBe(true);
    expect(verify.evidence.transferred).toBe(false);
    expect(canComplete(verify)).toBe(true);
  });

  it('正常模式下不能跳过迁移题', () => {
    let state = reachFinishedVerify();
    state = openTransfer(state);
    expect(skipTransferInShowcase(state)).toBe(state);
  });

  it('合法 v2 存档可以恢复，v1/损坏存档安全回退', () => {
    const state = reachFinishedVerify();
    const restored = reviveTacticsState(JSON.parse(JSON.stringify(state)) as unknown, NORMAL);
    expect(restored).not.toBeNull();
    expect(restored?.phase).toBe('verify');
    expect(restored?.loadout).toEqual(state.loadout);
    expect(restored?.verify.results).toEqual(state.verify.results);

    const base = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    expect(reviveTacticsState(null, NORMAL)).toBeNull();
    expect(reviveTacticsState({ ...base, version: 1 }, NORMAL)).toBeNull();
    expect(reviveTacticsState({ ...base, phase: '不存在' }, NORMAL)).toBeNull();
    expect(reviveTacticsState({ ...base, loadout: { shape: 'man-marking', attack: 'wrong' } }, NORMAL)).toBeNull();
    expect(reviveTacticsState({ ...base, evidence: { experiencedFault: true } }, NORMAL)).toBeNull();
    expect(reviveTacticsState(base, showcase('verify'))).toBeNull();
  });
});

describe('战术板 v2：UI 冒烟测试', () => {
  it('正确模块：从故障试玩走到归档，onComplete 只触发一次且带 clubUpdate', () => {
    const onComplete = vi.fn();
    const props = makeProps({
      mode: 'showcase',
      fastStart: false,
      showcaseOptions: { seed: 20251018, fastPlay: true, startPhase: 'faultPlay' },
      onComplete,
    });
    render(createElement(TacticsLevel, props));

    expect(screen.getByText(/故障试玩：固定一套 4-4-2/)).toBeTruthy();
    for (let index = 0; index < 2; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: /压上/ }));
    }
    fireEvent.click(screen.getByRole('button', { name: '带着问题去诊断' }));
    fireEvent.click(screen.getByRole('radio', { name: /控球和无球需要两套不同的站位与职责/ }));
    fireEvent.click(screen.getByRole('button', { name: '提交判断' }));
    fireEvent.click(screen.getByRole('button', { name: '开始维修' }));

    // 维修台：安装两个正确模块（ModuleCard 的 aria-label）。
    fireEvent.click(screen.getByRole('button', { name: '安装模块：双形态战术' }));
    fireEvent.click(screen.getByRole('button', { name: '安装模块：职责分工' }));
    fireEvent.click(screen.getByRole('button', { name: '开始验证' }));

    for (let index = 0; index < 2; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: /保护边路/ }));
    }
    expect(screen.getByText(/验证目标（5 \/ 5 达成）/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '完成验证，去迁移' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /有球形态：控球时/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /无球形态：丢球后/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /职责分工：同一位置/ }));
    fireEvent.click(screen.getByRole('button', { name: '提交判断' }));
    fireEvent.click(screen.getByRole('button', { name: '进入归档' }));

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
    const props = makeProps({
      mode: 'showcase',
      fastStart: false,
      showcaseOptions: { seed: 20251018, fastPlay: true, startPhase: 'faultPlay' },
      onComplete,
    });
    render(createElement(TacticsLevel, props));

    for (let index = 0; index < 2; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: /压上/ }));
    }
    fireEvent.click(screen.getByRole('button', { name: '带着问题去诊断' }));
    fireEvent.click(screen.getByRole('radio', { name: /两套不同的站位与职责/ }));
    fireEvent.click(screen.getByRole('button', { name: '提交判断' }));
    fireEvent.click(screen.getByRole('button', { name: '开始维修' }));

    // 先装两个错误模块。
    fireEvent.click(screen.getByRole('button', { name: '安装模块：全场人盯人 · 错误模块' }));
    fireEvent.click(screen.getByRole('button', { name: '安装模块：长传冲吊 · 错误模块' }));
    fireEvent.click(screen.getByRole('button', { name: '开始验证' }));
    for (let index = 0; index < 2; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: /保护边路/ }));
    }
    expect(screen.getByText(/验证未达成/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '完成验证，去迁移' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '回到维修台重新配置' }));

    // 重新配置：卸载错误模块，安装正确模块，重新验证。
    fireEvent.click(screen.getByRole('button', { name: '卸载模块：全场人盯人 · 错误模块' }));
    fireEvent.click(screen.getByRole('button', { name: '卸载模块：长传冲吊 · 错误模块' }));
    fireEvent.click(screen.getByRole('button', { name: '安装模块：双形态战术' }));
    fireEvent.click(screen.getByRole('button', { name: '安装模块：职责分工' }));
    fireEvent.click(screen.getByRole('button', { name: /重新验证/ }));
    for (let index = 0; index < 2; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: /保护边路/ }));
    }
    expect(screen.getByText(/验证目标（5 \/ 5 达成）/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '完成验证，去迁移' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /有球形态：控球时/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /无球形态：丢球后/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /职责分工：同一位置/ }));
    fireEvent.click(screen.getByRole('button', { name: '提交判断' }));
    fireEvent.click(screen.getByRole('button', { name: '进入归档' }));
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
    render(createElement(TacticsLevel, props));

    for (let index = 0; index < 2; index += 1) {
      fireEvent.click(screen.getByRole('button', { name: /保护边路/ }));
    }
    fireEvent.click(screen.getByRole('button', { name: '完成验证，去迁移' }));
    fireEvent.click(screen.getByRole('button', { name: '演示跳过迁移题' }));
    fireEvent.click(screen.getByRole('button', { name: /完成归档，返回修理铺/ }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    const result = onComplete.mock.calls[0][0] as { evidence: { transferred: boolean }; clubUpdate?: { headline: string } };
    expect(result.evidence.transferred).toBe(false);
    expect(result.clubUpdate?.headline).toBeTruthy();
  });

  it('可视化：职责画在阵型图上，指标旁有相对故障版增减与解释', () => {
    const props = makeProps({
      mode: 'showcase',
      fastStart: false,
      showcaseOptions: { seed: 20251018, fastPlay: true, startPhase: 'repair' },
    });
    render(createElement(TacticsLevel, props));

    fireEvent.click(screen.getByRole('button', { name: '安装模块：双形态战术' }));
    fireEvent.click(screen.getByRole('button', { name: '安装模块：职责分工' }));
    // 指标卡：每个指标都有相对故障版增减与一句解释。
    expect(screen.getAllByText(/相对故障版/).length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText(/边路保护/).length).toBeGreaterThan(0);
    // 默认职责：套边 + 双后腰，阵型图上应有箭头与后腰 ×2。
    expect(screen.getAllByText(/套边/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/后腰 ×2/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('radio', { name: /^内收/ }));
    expect(screen.getAllByText(/内收/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('radio', { name: /^单后腰/ }));
    expect(screen.getAllByText(/后腰 ×1/).length).toBeGreaterThan(0);
  });
});
