/**
 * 关卡一《战术板》的纯规则代码。
 *
 * 这里只有状态机、数值与事件日志，不依赖 React / DOM；随机只用 engine/rng.ts。
 * 设计目标：让玩家在故障版发现「只有一套站位」的结构问题，再用双形态与职责把它修好。
 */
import { recordEvent } from '../../engine/events';
import type { RngState } from '../../engine/rng';
import { createRng, isRngState, nextInt, nextUnit, normalizeSeed, reviveRng } from '../../engine/rng';
import type { EventLogEntry, EventState, Evidence, GameMode, LevelPhase, ShowcaseOptions } from '../../engine/types';
import { PHASE_ORDER, createEvidence } from '../../engine/types';

/* ==========================================================================
   基础类型
   ========================================================================== */

export type PossessionShapeId = '4-3-3' | '3-2-5' | '4-2-3-1';
export type OutShapeId = '4-4-2-mid' | '4-1-4-1' | '5-3-2-low';
export type FullbackDutyId = 'overlap' | 'invert';
export type PivotDutyId = 'single' | 'double';
export type FaultInstructionId = 'press' | 'balance' | 'drop';
export type VerifyInstructionId = 'press-strong' | 'cover-wing' | 'shrink-center';
export type AttackSide = 'right' | 'center' | 'left';
export type RepairStep = 'shape' | 'duty' | 'done';

export interface TacticsMetrics {
  /** 控球推进：把球送过中场并制造机会的能力。 */
  progression: number;
  /** 边路保护：丢球后对边路空当的保护。 */
  wingProtection: number;
  /** 中路保护：丢球后对禁区正面与肋部的保护。 */
  centralProtection: number;
  /** 体能消耗：两套形态切换与职责要求的代价。 */
  stamina: number;
}

export interface TacticsConfig {
  possessionShape: PossessionShapeId;
  outOfPossessionShape: OutShapeId;
  fullbackDuty: FullbackDutyId;
  pivotDuty: PivotDutyId;
}

export interface TacticsState {
  version: 1;
  phase: LevelPhase;
  mode: GameMode;
  fastPlay: boolean;
  seed: number;
  rng: RngState;
  config: TacticsConfig;
  installed: { dualShape: boolean; roleDuties: boolean };
  repairStep: RepairStep;
  fault: { played: FaultStageResult[]; done: boolean; demoPreloaded: boolean };
  diagnose: { resolved: boolean };
  verify: { results: VerifyStageResult[]; done: boolean };
  transfer: { resolved: boolean; skipped: boolean };
  evidence: Evidence;
  eventLog: EventLogEntry[];
  completed: boolean;
}

export interface TacticsInitOptions {
  mode: GameMode;
  fastStart: boolean;
  showcaseOptions: ShowcaseOptions | null;
}

/* ==========================================================================
   阵型与职责：玩家真正在维修面板里改的东西
   ========================================================================== */

export interface ShapeOption<T extends string> {
  id: T;
  name: string;
  description: string;
  metrics: TacticsMetrics;
}

export const POSSESSION_SHAPE_OPTIONS: ShapeOption<PossessionShapeId>[] = [
  {
    id: '4-3-3',
    name: '4-3-3',
    description: '三前锋拉开宽度，边后卫可以套上；中场三人覆盖二点。',
    metrics: { progression: 78, wingProtection: 56, centralProtection: 52, stamina: 55 },
  },
  {
    id: '3-2-5',
    name: '3-2-5',
    description: '五人压在前场，中路人数最多；身后空间与体能压力也最大。',
    metrics: { progression: 92, wingProtection: 42, centralProtection: 44, stamina: 78 },
  },
  {
    id: '4-2-3-1',
    name: '4-2-3-1',
    description: '前场四人保持层次，推进稳但不够锋利；丢球时站位更容易落回。',
    metrics: { progression: 70, wingProtection: 66, centralProtection: 64, stamina: 52 },
  },
];

export const OUT_SHAPE_OPTIONS: ShapeOption<OutShapeId>[] = [
  {
    id: '4-4-2-mid',
    name: '4-4-2 中位块',
    description: '两条四人线保持在中场附近，边路有人但禁区正面仍有空间。',
    metrics: { progression: 48, wingProtection: 70, centralProtection: 66, stamina: 56 },
  },
  {
    id: '4-1-4-1',
    name: '4-1-4-1',
    description: '单后腰保护禁区正面，两条线之间更紧凑；边路交给边前卫回追。',
    metrics: { progression: 52, wingProtection: 66, centralProtection: 76, stamina: 64 },
  },
  {
    id: '5-3-2-low',
    name: '5-3-2 低位块',
    description: '五后卫落进禁区，牺牲推进换边路与中路的双重保护。',
    metrics: { progression: 36, wingProtection: 80, centralProtection: 86, stamina: 44 },
  },
];

export const FULLBACK_DUTY_OPTIONS: ShapeOption<FullbackDutyId>[] = [
  {
    id: 'overlap',
    name: '套边',
    description: '进攻时压上提供宽度，丢球后要跑更长的距离回追。',
    metrics: { progression: 10, wingProtection: 8, centralProtection: -4, stamina: 12 },
  },
  {
    id: 'invert',
    name: '内收',
    description: '进攻时进入中场形成人数优势，边路宽度交给边锋。',
    metrics: { progression: 2, wingProtection: -4, centralProtection: 10, stamina: 4 },
  },
];

export const PIVOT_DUTY_OPTIONS: ShapeOption<PivotDutyId>[] = [
  {
    id: 'single',
    name: '单后腰',
    description: '一个人扫荡禁区前沿，多一个前场接应点，但身后空当更明显。',
    metrics: { progression: 8, wingProtection: -2, centralProtection: -8, stamina: 6 },
  },
  {
    id: 'double',
    name: '双后腰',
    description: '两人轮流保护中路与边路内线，推进人数减少。',
    metrics: { progression: -4, wingProtection: 4, centralProtection: 14, stamina: 2 },
  },
];

/** 故障版只有一套 4-4-2：控球和丢球共用同一套站位。 */
export const FAULT_METRICS: TacticsMetrics = {
  progression: 48,
  wingProtection: 38,
  centralProtection: 55,
  stamina: 58,
};

export const DEFAULT_TACTICS_CONFIG: TacticsConfig = {
  possessionShape: '4-3-3',
  outOfPossessionShape: '4-4-2-mid',
  fullbackDuty: 'overlap',
  pivotDuty: 'double',
};

export function clampMetric(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function findShape<T extends string>(options: ShapeOption<T>[], id: T): ShapeOption<T> {
  const found = options.find((item) => item.id === id);
  if (!found) throw new Error(`未知阵型或职责：${id}`);
  return found;
}

/** 只看两套站位本身（还没有职责分工）的指标。 */
export function shapeMetrics(possession: PossessionShapeId, out: OutShapeId): TacticsMetrics {
  const pos = findShape(POSSESSION_SHAPE_OPTIONS, possession).metrics;
  const outMetrics = findShape(OUT_SHAPE_OPTIONS, out).metrics;
  return {
    progression: clampMetric(pos.progression * 0.6 + outMetrics.progression * 0.4),
    wingProtection: clampMetric(pos.wingProtection * 0.35 + outMetrics.wingProtection * 0.65),
    centralProtection: clampMetric(pos.centralProtection * 0.35 + outMetrics.centralProtection * 0.65),
    stamina: clampMetric((pos.stamina + outMetrics.stamina) / 2),
  };
}

/** 职责分工带来的加减值。 */
export function dutyMetrics(fullback: FullbackDutyId, pivot: PivotDutyId): TacticsMetrics {
  const fb = findShape(FULLBACK_DUTY_OPTIONS, fullback).metrics;
  const pv = findShape(PIVOT_DUTY_OPTIONS, pivot).metrics;
  return {
    progression: fb.progression + pv.progression,
    wingProtection: fb.wingProtection + pv.wingProtection,
    centralProtection: fb.centralProtection + pv.centralProtection,
    stamina: fb.stamina + pv.stamina,
  };
}

/** 双形态 + 职责分工后的完整指标；四个维度都在 0~100。 */
export function tacticsMetrics(config: TacticsConfig): TacticsMetrics {
  const shape = shapeMetrics(config.possessionShape, config.outOfPossessionShape);
  const duty = dutyMetrics(config.fullbackDuty, config.pivotDuty);
  return {
    progression: clampMetric(shape.progression + duty.progression),
    wingProtection: clampMetric(shape.wingProtection + duty.wingProtection),
    centralProtection: clampMetric(shape.centralProtection + duty.centralProtection),
    stamina: clampMetric(shape.stamina + duty.stamina),
  };
}

export function metricDelta(after: TacticsMetrics, before: TacticsMetrics): TacticsMetrics {
  return {
    progression: after.progression - before.progression,
    wingProtection: after.wingProtection - before.wingProtection,
    centralProtection: after.centralProtection - before.centralProtection,
    stamina: after.stamina - before.stamina,
  };
}

export function formatMetricDelta(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

/* ==========================================================================
   故障版：只有一套 4-4-2
   ========================================================================== */

export interface FaultInstructionOption {
  id: FaultInstructionId;
  name: string;
  hint: string;
}

export const FAULT_INSTRUCTIONS: FaultInstructionOption[] = [
  { id: 'press', name: '压上', hint: '把整条防线前压，想抢回主动。' },
  { id: 'balance', name: '平衡', hint: '保持原来的站位，等对手先犯错。' },
  { id: 'drop', name: '回收', hint: '整条防线退深，先别再丢球。' },
];

export interface FaultStageResult {
  stage: number;
  instruction: FaultInstructionId;
  ourChances: number;
  opponentChances: number;
  opponentWingChances: number;
  goalsAgainst: number;
  wingGoalsAgainst: number;
  note: string;
}

const FAULT_STAGE_TABLE: Record<FaultInstructionId, Omit<FaultStageResult, 'stage' | 'instruction' | 'note'>> = {
  press: { ourChances: 2, opponentChances: 5, opponentWingChances: 4, goalsAgainst: 2, wingGoalsAgainst: 2 },
  balance: { ourChances: 1, opponentChances: 4, opponentWingChances: 4, goalsAgainst: 1, wingGoalsAgainst: 1 },
  drop: { ourChances: 1, opponentChances: 4, opponentWingChances: 4, goalsAgainst: 1, wingGoalsAgainst: 1 },
};

const FAULT_NOTES: Record<FaultInstructionId, string> = {
  press: '压上以后身后空间更大；但边路的空当来自同一套 4-4-2 的站位，不会因为喊话消失。',
  balance: '保持原位只是让损失变得平均；边路仍然由同一名边后卫负责整条边线。',
  drop: '回收把整条防线压低，禁区里人多了一点，但边路还是同一批人、同一个站位。',
};

export function isFaultInstruction(value: unknown): value is FaultInstructionId {
  return value === 'press' || value === 'balance' || value === 'drop';
}

export function faultInstructionName(id: FaultInstructionId): string {
  return FAULT_INSTRUCTIONS.find((item) => item.id === id)?.name ?? id;
}

/** 故障版结果完全确定：三个临场指令都改不了站位结构。 */
export function simulateFaultStage(instruction: FaultInstructionId, stage: number): FaultStageResult {
  const row = FAULT_STAGE_TABLE[instruction];
  return { stage, instruction, note: FAULT_NOTES[instruction], ...row };
}

export function simulateFaultStages(stageCount: number): FaultStageResult[] {
  const pattern: FaultInstructionId[] = ['balance', 'drop', 'press', 'balance'];
  const results: FaultStageResult[] = [];
  for (let index = 0; index < stageCount; index += 1) {
    results.push(simulateFaultStage(pattern[index % pattern.length], index + 1));
  }
  return results;
}

/* ==========================================================================
   修复版：对手固定倾向 + 两套形态 + 职责分工 + 阶段指令 + 少量随机波动
   ========================================================================== */

export interface VerifyInstructionOption {
  id: VerifyInstructionId;
  name: string;
  hint: string;
}

export const VERIFY_INSTRUCTIONS: VerifyInstructionOption[] = [
  { id: 'press-strong', name: '压上强侧', hint: '把防守重心压向对手的强侧，主动抢回球权。' },
  { id: 'cover-wing', name: '保护边路', hint: '边锋回收、边后卫不再盲目前压，先守住边路。' },
  { id: 'shrink-center', name: '收缩中路', hint: '放弃边路一点空间，把禁区正面堵死。' },
];

/** 对手固定倾向：右路 60%、中路 20%、左路 20%（写在界面上，玩家可以据此做选择）。 */
export const OPPONENT_TENDENCY: { side: AttackSide; label: string; chance: number }[] = [
  { side: 'right', label: '右路', chance: 60 },
  { side: 'center', label: '中路', chance: 20 },
  { side: 'left', label: '左路', chance: 20 },
];

export interface VerifyStageResult {
  stage: number;
  instruction: VerifyInstructionId;
  attackSide: AttackSide;
  chancesFor: number;
  goalsFor: number;
  chancesAgainst: number;
  goalsAgainst: number;
  wingGoalsAgainst: number;
  protection: number;
  note: string;
}

export function isVerifyInstruction(value: unknown): value is VerifyInstructionId {
  return value === 'press-strong' || value === 'cover-wing' || value === 'shrink-center';
}

export function verifyInstructionName(id: VerifyInstructionId): string {
  return VERIFY_INSTRUCTIONS.find((item) => item.id === id)?.name ?? id;
}

export function attackSideName(side: AttackSide): string {
  if (side === 'right') return '右路';
  if (side === 'left') return '左路';
  return '中路';
}

function instructionProtection(instruction: VerifyInstructionId, side: AttackSide): number {
  if (instruction === 'press-strong') return 8;
  if (instruction === 'cover-wing') return side === 'center' ? -4 : 16;
  return side === 'center' ? 16 : -8;
}

function instructionAttack(instruction: VerifyInstructionId): number {
  if (instruction === 'press-strong') return 10;
  if (instruction === 'cover-wing') return -6;
  return -2;
}

function clampProtection(value: number): number {
  return Math.min(95, Math.max(5, Math.round(value)));
}

/** 只读的防线估计：界面用它解释「这一侧保护得怎么样」，不做隐藏的概率修正。 */
export function sideProtection(config: TacticsConfig, side: AttackSide, instruction: VerifyInstructionId): number {
  const metrics = tacticsMetrics(config);
  const base = side === 'center' ? metrics.centralProtection : metrics.wingProtection;
  return clampProtection(base + instructionProtection(instruction, side));
}

export interface VerifySimulation {
  result: VerifyStageResult;
  rng: RngState;
}

/**
 * 计算一个比赛阶段。
 * 每次抽取 4 个随机数：进攻方向、波动、是否失球、是否进球；结果只由当前配置、指令和随机数决定。
 */
export function simulateVerifyStage(
  config: TacticsConfig,
  instruction: VerifyInstructionId,
  stage: number,
  rng: RngState,
): VerifySimulation {
  const sideDraw = nextInt(rng, 100);
  const side: AttackSide = sideDraw.value < 60 ? 'right' : sideDraw.value < 80 ? 'center' : 'left';
  const varianceDraw = nextUnit(sideDraw.rng);
  const variance = Math.round((varianceDraw.value - 0.5) * 16);
  const metrics = tacticsMetrics(config);
  const isWing = side !== 'center';
  const protection = sideProtection(config, side, instruction);

  const danger = Math.min(0.5, Math.max(0.03, 0.03 + ((100 - protection) / 100) * 0.42));
  const concedeDraw = nextUnit(varianceDraw.rng);
  const goalsAgainst = concedeDraw.value < danger * danger ? 2 : concedeDraw.value < danger ? 1 : 0;

  const attackPower = Math.max(20, metrics.progression + instructionAttack(instruction));
  const chancesFor = Math.min(4, Math.max(1, Math.round((attackPower + variance * 0.4) / 28)));
  const finishDraw = nextUnit(concedeDraw.rng);
  const finishRate = Math.min(0.4, Math.max(0.06, attackPower / 260));
  const goalsFor = finishDraw.value < finishRate ? 1 : 0;

  const chancesAgainst = isWing ? 3 : 2;
  const note = isWing
    ? `对手第 ${stage} 阶段从${attackSideName(side)}进攻；这一侧的保护数值是 ${protection}。`
    : `对手第 ${stage} 阶段改从中路进攻；这一侧的保护数值是 ${protection}。`;

  return {
    result: {
      stage,
      instruction,
      attackSide: side,
      chancesFor,
      goalsFor,
      chancesAgainst,
      goalsAgainst,
      wingGoalsAgainst: isWing ? goalsAgainst : 0,
      protection,
      note,
    },
    rng: finishDraw.rng,
  };
}

export function simulateVerifyStages(
  config: TacticsConfig,
  instruction: VerifyInstructionId,
  stageCount: number,
  rng: RngState,
): { results: VerifyStageResult[]; rng: RngState } {
  const results: VerifyStageResult[] = [];
  let currentRng = rng;
  for (let index = 0; index < stageCount; index += 1) {
    const simulation = simulateVerifyStage(config, instruction, index + 1, currentRng);
    results.push(simulation.result);
    currentRng = simulation.rng;
  }
  return { results, rng: currentRng };
}

/* ==========================================================================
   对比与结算
   ========================================================================== */

export interface MatchTotals {
  chancesFor: number;
  goalsFor: number;
  chancesAgainst: number;
  goalsAgainst: number;
  wingGoalsAgainst: number;
}

function emptyTotals(): MatchTotals {
  return { chancesFor: 0, goalsFor: 0, chancesAgainst: 0, goalsAgainst: 0, wingGoalsAgainst: 0 };
}

export function faultTotals(results: FaultStageResult[]): MatchTotals {
  return results.reduce<MatchTotals>((totals, result) => {
    totals.chancesFor += result.ourChances;
    totals.goalsFor += 0;
    totals.chancesAgainst += result.opponentChances;
    totals.goalsAgainst += result.goalsAgainst;
    totals.wingGoalsAgainst += result.wingGoalsAgainst;
    return totals;
  }, emptyTotals());
}

export function verifyTotals(results: VerifyStageResult[]): MatchTotals {
  return results.reduce<MatchTotals>((totals, result) => {
    totals.chancesFor += result.chancesFor;
    totals.goalsFor += result.goalsFor;
    totals.chancesAgainst += result.chancesAgainst;
    totals.goalsAgainst += result.goalsAgainst;
    totals.wingGoalsAgainst += result.wingGoalsAgainst;
    return totals;
  }, emptyTotals());
}

export interface TacticsComparisonRow {
  label: string;
  fault: string;
  fixed: string;
}

export function buildTacticsComparison(state: TacticsState): TacticsComparisonRow[] {
  const fault = faultTotals(state.fault.played);
  const fixed = verifyTotals(state.verify.results);
  return [
    { label: '创造机会', fault: `${fault.chancesFor} 次`, fixed: `${fixed.chancesFor} 次` },
    { label: '进球', fault: `${fault.goalsFor} 个`, fixed: `${fixed.goalsFor} 个` },
    { label: '被创造机会', fault: `${fault.chancesAgainst} 次`, fixed: `${fixed.chancesAgainst} 次` },
    { label: '失球', fault: `${fault.goalsAgainst} 个`, fixed: `${fixed.goalsAgainst} 个` },
    { label: '边路丢球', fault: `${fault.wingGoalsAgainst} 个`, fixed: `${fixed.wingGoalsAgainst} 个` },
  ];
}

/* ==========================================================================
   诊断与迁移题目数据
   ========================================================================== */

export interface QuizOptionData {
  id: string;
  label: string;
  explanation: string;
}

export const DIAGNOSE_CORRECT_ID = 'dual-shape-needed';

export const DIAGNOSE_OPTIONS: QuizOptionData[] = [
  {
    id: DIAGNOSE_CORRECT_ID,
    label: '控球和无球需要两套不同的站位与职责。',
    explanation: '同一名边后卫在控球时要套边提供宽度，丢球后又要保护边路，两个任务落在同一个位置上，必然互相打架。',
  },
  {
    id: 'run-harder',
    label: '球员跑动不够积极，应该要求全队多跑。',
    explanation: '多跑能改变强度，却改变不了站位结构：只有一套 4-4-2，边后卫仍然一个人负责整条边线。',
  },
  {
    id: 'better-fullback',
    label: '对手边路球员太强，换一个更强的边后卫就行。',
    explanation: '换人只是换执行者。只要仍然只有一套站位，新边后卫也会同时被要求套边和回收。',
  },
];

export const TRANSFER_CORRECT_IDS = ['possession-shape', 'out-shape', 'role-duties'];

export const TRANSFER_OPTIONS: QuizOptionData[] = [
  {
    id: 'possession-shape',
    label: '有球形态：控球时球员站在哪里、谁负责拉开宽度。',
    explanation: '有球形态决定推进与创造机会的结构。',
  },
  {
    id: 'out-shape',
    label: '无球形态：丢球后球员退到哪里、谁负责保护边路与中路。',
    explanation: '无球形态决定丢球后的保护结构，和有球形态不是同一套站位。',
  },
  {
    id: 'role-duties',
    label: '职责分工：同一位置在两种阶段承担不同任务，例如边后卫套边或内收。',
    explanation: '职责分工把两套形态落到具体球员的任务上。',
  },
  {
    id: 'star-rating',
    label: '球员总评：总评越高，两种阶段自然都会踢得更好。',
    explanation: '总评是能力，不是结构。它不能告诉球员控球时和丢球后分别站在哪里。',
  },
  {
    id: 'home-atmosphere',
    label: '主场气氛：主场球迷越多，边路就越不容易被打穿。',
    explanation: '气氛能影响强度，但不会自动补上边路的站位空当。',
  },
  {
    id: 'substitution-count',
    label: '换人名额：换人次数越多，越不需要设置两套形态。',
    explanation: '换人只能换执行者，解决不了同一套站位让球员同时承担冲突任务的问题。',
  },
];

/* ==========================================================================
   状态机：所有合法操作都返回新状态并写事件日志；非法操作原样返回
   ========================================================================== */

function isPhase(value: unknown): value is LevelPhase {
  return typeof value === 'string' && (PHASE_ORDER as string[]).includes(value);
}

export function requiredStages(state: TacticsState): number {
  return state.fastPlay ? 2 : 3;
}

export function faultStageCount(state: TacticsState): number {
  return state.fault.played.length;
}

export function verifyStageCount(state: TacticsState): number {
  return state.verify.results.length;
}

function withEvent(
  state: TacticsState,
  phase: LevelPhase,
  input: { action: string; label: string; before: EventState; after: EventState; delta?: string; note?: string },
): TacticsState {
  return {
    ...state,
    eventLog: recordEvent(state.eventLog, { phase, ...input }),
  };
}

function phaseEventState(state: TacticsState): EventState {
  return { phase: state.phase, stage: state.fault.played.length + state.verify.results.length };
}

export function startFaultPlay(state: TacticsState): TacticsState {
  if (state.phase !== 'commission') return state;
  const next: TacticsState = { ...state, phase: 'faultPlay' };
  return withEvent(next, 'faultPlay', {
    action: 'start-fault-play',
    label: '开始故障试玩：固定一套 4-4-2',
    before: phaseEventState(state),
    after: { phase: 'faultPlay', stage: 0 },
    note: '故障版没有有球/无球之分，三个临场指令只会改变强度，不会改变站位结构。',
  });
}

export function chooseFaultInstruction(state: TacticsState, instruction: FaultInstructionId): TacticsState {
  if (state.phase !== 'faultPlay' || state.fault.done || !isFaultInstruction(instruction)) return state;
  const stages = requiredStages(state);
  const stage = state.fault.played.length + 1;
  if (stage > stages) return state;
  const result = simulateFaultStage(instruction, stage);
  const played = [...state.fault.played, result];
  const done = played.length >= stages;
  const next: TacticsState = {
    ...state,
    fault: { ...state.fault, played, done },
    evidence: done ? { ...state.evidence, experiencedFault: true } : state.evidence,
  };
  return withEvent(next, 'faultPlay', {
    action: 'fault-stage',
    label: `故障版第 ${stage} 阶段：${faultInstructionName(instruction)}`,
    before: { stage: stage - 1, wingChances: stage > 1 ? state.fault.played[stage - 2].opponentWingChances : 0 },
    after: { stage, wingChances: result.opponentWingChances },
    delta: `失球 +${result.goalsAgainst} · 边路被攻入 ${result.opponentWingChances} 次`,
    note: result.note,
  });
}

export function openDiagnose(state: TacticsState): TacticsState {
  if (state.phase !== 'faultPlay' || !state.fault.done) return state;
  const next: TacticsState = { ...state, phase: 'diagnose' };
  return withEvent(next, 'diagnose', {
    action: 'open-diagnose',
    label: '带着比赛记录去诊断',
    before: { phase: 'faultPlay', stages: state.fault.played.length },
    after: { phase: 'diagnose' },
    note: '三个阶段的边路机会都没有下降：问题不在指令，在只有一套站位。',
  });
}

export function resolveDiagnose(state: TacticsState): TacticsState {
  if (state.phase !== 'diagnose' || state.diagnose.resolved) return state;
  const next: TacticsState = { ...state, diagnose: { resolved: true } };
  return withEvent(next, 'diagnose', {
    action: 'diagnose-correct',
    label: '诊断正确：控球和无球需要两套不同的站位与职责',
    before: { resolved: 'false' },
    after: { resolved: 'true' },
    note: '下一步去维修面板，把两套形态与职责真正装上。',
  });
}

export function startRepair(state: TacticsState): TacticsState {
  if (state.phase !== 'diagnose' || !state.diagnose.resolved) return state;
  const repairStep: RepairStep = state.installed.roleDuties ? 'done' : state.installed.dualShape ? 'duty' : 'shape';
  const next: TacticsState = { ...state, phase: 'repair', repairStep };
  return withEvent(next, 'repair', {
    action: 'start-repair',
    label: '开始维修：安装双形态战术与职责分工',
    before: { phase: 'diagnose' },
    after: { phase: 'repair', step: repairStep },
    note: '先选两套阵型，再给同一批球员设置两种阶段的职责。',
  });
}

export function selectPossessionShape(state: TacticsState, shape: PossessionShapeId): TacticsState {
  if (state.phase !== 'repair' || state.repairStep !== 'shape' || state.installed.dualShape) return state;
  if (!POSSESSION_SHAPE_OPTIONS.some((item) => item.id === shape)) return state;
  if (state.config.possessionShape === shape) return state;
  const before = tacticsMetrics(state.config);
  const next: TacticsState = { ...state, config: { ...state.config, possessionShape: shape } };
  const after = shapeMetrics(shape, state.config.outOfPossessionShape);
  return withEvent(next, 'repair', {
    action: 'select-possession-shape',
    label: `选择有球形态：${shape}`,
    before: { progression: before.progression, wingProtection: before.wingProtection },
    after: { progression: after.progression, wingProtection: after.wingProtection },
    note: '有球形态负责推进与创造，改它先改变的是控球阶段的结构。',
  });
}

export function selectOutShape(state: TacticsState, shape: OutShapeId): TacticsState {
  if (state.phase !== 'repair' || state.repairStep !== 'shape' || state.installed.dualShape) return state;
  if (!OUT_SHAPE_OPTIONS.some((item) => item.id === shape)) return state;
  if (state.config.outOfPossessionShape === shape) return state;
  const before = shapeMetrics(state.config.possessionShape, state.config.outOfPossessionShape);
  const next: TacticsState = { ...state, config: { ...state.config, outOfPossessionShape: shape } };
  const after = shapeMetrics(state.config.possessionShape, shape);
  return withEvent(next, 'repair', {
    action: 'select-out-shape',
    label: `选择无球形态：${OUT_SHAPE_OPTIONS.find((item) => item.id === shape)?.name ?? shape}`,
    before: { wingProtection: before.wingProtection, centralProtection: before.centralProtection },
    after: { wingProtection: after.wingProtection, centralProtection: after.centralProtection },
    note: '无球形态负责丢球后的保护，改它改变的是丢球阶段的站位。',
  });
}

export function installDualShape(state: TacticsState): TacticsState {
  if (state.phase !== 'repair' || state.repairStep !== 'shape' || state.installed.dualShape) return state;
  const next: TacticsState = {
    ...state,
    installed: { ...state.installed, dualShape: true },
    repairStep: 'duty',
  };
  return withEvent(next, 'repair', {
    action: 'install-dual-shape',
    label: '安装双形态战术：有球形态与无球形态各一套',
    before: { dualShape: 'false' },
    after: { dualShape: 'true', possession: state.config.possessionShape, out: state.config.outOfPossessionShape },
    note: '同一批球员在控球与丢球后执行两套不同站位；下一步设置职责。',
  });
}

export function selectFullbackDuty(state: TacticsState, duty: FullbackDutyId): TacticsState {
  if (state.phase !== 'repair' || state.repairStep !== 'duty' || state.installed.roleDuties) return state;
  if (!FULLBACK_DUTY_OPTIONS.some((item) => item.id === duty)) return state;
  if (state.config.fullbackDuty === duty) return state;
  const before = tacticsMetrics(state.config);
  const next: TacticsState = { ...state, config: { ...state.config, fullbackDuty: duty } };
  const after = tacticsMetrics(next.config);
  return withEvent(next, 'repair', {
    action: 'select-fullback-duty',
    label: `选择边后卫职责：${FULLBACK_DUTY_OPTIONS.find((item) => item.id === duty)?.name ?? duty}`,
    before: { progression: before.progression, wingProtection: before.wingProtection },
    after: { progression: after.progression, wingProtection: after.wingProtection },
    note: '职责越激进，控球收益越高，丢球后的回防距离也越长。',
  });
}

export function selectPivotDuty(state: TacticsState, duty: PivotDutyId): TacticsState {
  if (state.phase !== 'repair' || state.repairStep !== 'duty' || state.installed.roleDuties) return state;
  if (!PIVOT_DUTY_OPTIONS.some((item) => item.id === duty)) return state;
  if (state.config.pivotDuty === duty) return state;
  const before = tacticsMetrics(state.config);
  const next: TacticsState = { ...state, config: { ...state.config, pivotDuty: duty } };
  const after = tacticsMetrics(next.config);
  return withEvent(next, 'repair', {
    action: 'select-pivot-duty',
    label: `选择后腰职责：${PIVOT_DUTY_OPTIONS.find((item) => item.id === duty)?.name ?? duty}`,
    before: { centralProtection: before.centralProtection, stamina: before.stamina },
    after: { centralProtection: after.centralProtection, stamina: after.stamina },
    note: '双后腰保护更稳，但会少一个前场接应点。',
  });
}

export function installRoleDuties(state: TacticsState): TacticsState {
  if (state.phase !== 'repair' || state.repairStep !== 'duty' || state.installed.roleDuties) return state;
  const next: TacticsState = {
    ...state,
    installed: { ...state.installed, roleDuties: true },
    repairStep: 'done',
  };
  return withEvent(next, 'repair', {
    action: 'install-role-duties',
    label: '安装职责分工：边后卫与后腰在两种阶段承担不同任务',
    before: { roleDuties: 'false' },
    after: {
      roleDuties: 'true',
      fullback: FULLBACK_DUTY_OPTIONS.find((item) => item.id === state.config.fullbackDuty)?.name ?? state.config.fullbackDuty,
      pivot: PIVOT_DUTY_OPTIONS.find((item) => item.id === state.config.pivotDuty)?.name ?? state.config.pivotDuty,
    },
    note: '同一名球员在控球时做一件事、丢球后做另一件事；代价是体能与训练成本。',
  });
}

export function startVerify(state: TacticsState): TacticsState {
  if (state.phase !== 'repair' || state.repairStep !== 'done') return state;
  if (!state.installed.dualShape || !state.installed.roleDuties) return state;
  const next: TacticsState = { ...state, phase: 'verify' };
  return withEvent(next, 'verify', {
    action: 'start-verify',
    label: `开始验证：${requiredStages(state)} 个比赛阶段`,
    before: { phase: 'repair' },
    after: { phase: 'verify', stages: requiredStages(state) },
    note: '对手固定倾向：右路 60%、中路 20%、左路 20%；每个阶段选一条指令。',
  });
}

export function chooseVerifyInstruction(state: TacticsState, instruction: VerifyInstructionId): TacticsState {
  if (state.phase !== 'verify' || state.verify.done || !isVerifyInstruction(instruction)) return state;
  if (!state.installed.dualShape || !state.installed.roleDuties) return state;
  const stages = requiredStages(state);
  const stage = state.verify.results.length + 1;
  if (stage > stages) return state;
  const simulation = simulateVerifyStage(state.config, instruction, stage, state.rng);
  const results = [...state.verify.results, simulation.result];
  const done = results.length >= stages;
  const next: TacticsState = {
    ...state,
    rng: simulation.rng,
    verify: { results, done },
    evidence: done ? { ...state.evidence, operatedMechanic: true } : state.evidence,
  };
  return withEvent(next, 'verify', {
    action: `verify-stage-${stage}`,
    label: `验证第 ${stage} 阶段：${verifyInstructionName(instruction)}`,
    before: { stage: stage - 1, goalsAgainst: state.verify.results.reduce((sum, item) => sum + item.goalsAgainst, 0) },
    after: {
      stage,
      attackSide: attackSideName(simulation.result.attackSide),
      chancesFor: simulation.result.chancesFor,
      goalsAgainst: simulation.result.goalsAgainst,
    },
    delta: `机会 +${simulation.result.chancesFor} · 失球 +${simulation.result.goalsAgainst}`,
    note: simulation.result.note,
  });
}

export function openTransfer(state: TacticsState): TacticsState {
  if (state.phase !== 'verify' || !state.verify.done) return state;
  const next: TacticsState = { ...state, phase: 'transfer' };
  return withEvent(next, 'transfer', {
    action: 'open-transfer',
    label: '完成验证，去迁移题',
    before: { phase: 'verify' },
    after: { phase: 'transfer' },
    note: '用同一套结构去判断另一支球队的处境。',
  });
}

export function resolveTransfer(state: TacticsState): TacticsState {
  if (state.phase !== 'transfer' || state.transfer.resolved) return state;
  const next: TacticsState = {
    ...state,
    transfer: { ...state.transfer, resolved: true },
    evidence: { ...state.evidence, transferred: true },
  };
  return withEvent(next, 'transfer', {
    action: 'transfer-correct',
    label: '迁移正确：识别出有球形态、无球形态与职责分工',
    before: { resolved: 'false' },
    after: { resolved: 'true' },
    note: '把三样东西一起换到新情境，机制才完整。',
  });
}

/** 展示模式才允许跳过迁移题；跳过后 evidence.transferred 保持 false。 */
export function skipTransferInShowcase(state: TacticsState): TacticsState {
  if (state.mode !== 'showcase' || state.phase !== 'transfer' || state.transfer.resolved) return state;
  const next: TacticsState = {
    ...state,
    phase: 'summary',
    transfer: { resolved: false, skipped: true },
  };
  return withEvent(next, 'summary', {
    action: 'demo-skip-transfer',
    label: '演示跳过迁移题',
    before: { phase: 'transfer', transferred: String(state.evidence.transferred) },
    after: { phase: 'summary', transferred: 'false' },
    note: '展示模式允许跳过；本次不计「迁移」证据，仍可完成演示。',
  });
}

export function openSummary(state: TacticsState): TacticsState {
  if (state.phase !== 'transfer' || !state.transfer.resolved) return state;
  const next: TacticsState = { ...state, phase: 'summary' };
  return withEvent(next, 'summary', {
    action: 'open-summary',
    label: '进入归档',
    before: { phase: 'transfer' },
    after: { phase: 'summary' },
    note: '归档只展示真实做过的操作与真实比赛记录。',
  });
}

export function canComplete(state: TacticsState): boolean {
  if (state.phase !== 'summary' || state.completed) return false;
  if (!state.verify.done) return false;
  if (!state.installed.dualShape || !state.installed.roleDuties) return false;
  if (state.mode === 'showcase') return true;
  return state.fault.done && state.diagnose.resolved && state.transfer.resolved;
}

export function completeArchive(state: TacticsState): TacticsState {
  if (!canComplete(state)) return state;
  const next: TacticsState = { ...state, completed: true };
  return withEvent(next, 'summary', {
    action: 'archive',
    label: '完成归档：双形态战术与职责分工',
    before: { completed: 'false' },
    after: { completed: 'true', evidence: String(countRealEvidence(state.evidence)) },
    note: '完成记录只包含真实操作；没有最低胜场或净胜球要求。',
  });
}

export function countRealEvidence(evidence: Evidence): number {
  return Number(evidence.experiencedFault) + Number(evidence.operatedMechanic) + Number(evidence.transferred);
}

/** 归档页三条总结：改了哪条规则 / 改变了什么选择 / 产生什么代价。 */
export function buildArchiveSummary(state: TacticsState): string[] {
  const config = state.config;
  const possession = POSSESSION_SHAPE_OPTIONS.find((item) => item.id === config.possessionShape)?.name ?? config.possessionShape;
  const out = OUT_SHAPE_OPTIONS.find((item) => item.id === config.outOfPossessionShape)?.name ?? config.outOfPossessionShape;
  const fullback = FULLBACK_DUTY_OPTIONS.find((item) => item.id === config.fullbackDuty)?.name ?? config.fullbackDuty;
  const pivot = PIVOT_DUTY_OPTIONS.find((item) => item.id === config.pivotDuty)?.name ?? config.pivotDuty;
  const metrics = tacticsMetrics(config);
  return [
    `改了哪条规则：把「一套 4-4-2 打满全场」改成「有球形态 ${possession} + 无球形态 ${out}」两套站位，并给边后卫与后腰设置职责。`,
    `改变了什么选择：控球时用 ${possession} 推进；丢球后落到 ${out}；边后卫${fullback}、后腰${pivot}，同一名球员在两种阶段做不同的任务。`,
    `产生了什么代价：体能消耗上升到 ${metrics.stamina}，职责切换需要训练；压上强侧能抢回主动，但会暂时放大身后的空间。`,
  ];
}

export function buildCompletionResult(state: TacticsState): { evidence: Evidence; summary: string[] } {
  return { evidence: { ...state.evidence }, summary: buildArchiveSummary(state) };
}

/* ==========================================================================
   初始化、展示模式预填与坏档校验
   ========================================================================== */

function requestedPhase(options: TacticsInitOptions): LevelPhase {
  if (options.mode === 'showcase' && options.showcaseOptions) {
    const phase = options.showcaseOptions.startPhase;
    if (phase === 'commission' || phase === 'faultPlay' || phase === 'diagnose' || phase === 'repair' || phase === 'verify') {
      return phase;
    }
    return 'verify';
  }
  return options.fastStart ? 'faultPlay' : 'commission';
}

function createBaseState(options: TacticsInitOptions, seed: number, phase: LevelPhase): TacticsState {
  const fastPlay = options.mode === 'showcase' && options.showcaseOptions?.fastPlay === true;
  const normalizedSeed = normalizeSeed(seed);
  return {
    version: 1,
    phase,
    mode: options.mode,
    fastPlay,
    seed: normalizedSeed,
    rng: createRng(normalizedSeed),
    config: { ...DEFAULT_TACTICS_CONFIG },
    installed: { dualShape: false, roleDuties: false },
    repairStep: 'shape',
    fault: { played: [], done: false, demoPreloaded: false },
    diagnose: { resolved: false },
    verify: { results: [], done: false },
    transfer: { resolved: false, skipped: false },
    evidence: createEvidence(),
    eventLog: [],
    completed: false,
  };
}

/**
 * 创建初始状态。展示模式按 startPhase 预填前置步骤：
 * repair = 已诊断完成，verify = 两个模块已安装、可以直接试玩。
 * 预填的故障记录来自同一套规则基线，但不会把「体验故障」证据写成已完成。
 */
export function createInitialTacticsState(options: TacticsInitOptions, seed: number): TacticsState {
  const phase = requestedPhase(options);
  const state = createBaseState(options, seed, phase);
  const stages = state.fastPlay ? 2 : 3;
  const baseline = simulateFaultStages(stages);

  if (phase === 'commission' || phase === 'faultPlay') return state;

  if (phase === 'diagnose') {
    return { ...state, fault: { played: baseline, done: true, demoPreloaded: true } };
  }

  if (phase === 'repair') {
    return {
      ...state,
      fault: { played: baseline, done: true, demoPreloaded: true },
      diagnose: { resolved: true },
      repairStep: 'shape',
    };
  }

  // verify（以及无法识别的阶段回退）：模块已安装，比赛记录仍为规则基线。
  return {
    ...state,
    phase: 'verify',
    fault: { played: baseline, done: true, demoPreloaded: true },
    diagnose: { resolved: true },
    installed: { dualShape: true, roleDuties: true },
    repairStep: 'done',
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isEventState(value: unknown): value is EventState {
  if (!isObject(value)) return false;
  return Object.values(value).every((item) => typeof item === 'string' || isFiniteNumber(item));
}

function isValidEventLog(value: unknown): value is EventLogEntry[] {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => {
    if (!isObject(entry)) return false;
    return (
      isFiniteNumber(entry.seq) &&
      isPhase(entry.phase) &&
      typeof entry.action === 'string' &&
      typeof entry.label === 'string' &&
      isEventState(entry.before) &&
      isEventState(entry.after) &&
      (entry.delta === undefined || typeof entry.delta === 'string') &&
      (entry.note === undefined || typeof entry.note === 'string')
    );
  });
}

function isConfig(value: unknown): value is TacticsConfig {
  if (!isObject(value)) return false;
  return (
    POSSESSION_SHAPE_OPTIONS.some((item) => item.id === value.possessionShape) &&
    OUT_SHAPE_OPTIONS.some((item) => item.id === value.outOfPossessionShape) &&
    FULLBACK_DUTY_OPTIONS.some((item) => item.id === value.fullbackDuty) &&
    PIVOT_DUTY_OPTIONS.some((item) => item.id === value.pivotDuty)
  );
}

function isFaultStageResult(value: unknown): value is FaultStageResult {
  if (!isObject(value)) return false;
  return (
    isFiniteNumber(value.stage) &&
    value.stage >= 1 &&
    isFaultInstruction(value.instruction) &&
    isFiniteNumber(value.ourChances) &&
    isFiniteNumber(value.opponentChances) &&
    isFiniteNumber(value.opponentWingChances) &&
    isFiniteNumber(value.goalsAgainst) &&
    isFiniteNumber(value.wingGoalsAgainst) &&
    typeof value.note === 'string'
  );
}

function isVerifyStageResult(value: unknown): value is VerifyStageResult {
  if (!isObject(value)) return false;
  const side = value.attackSide;
  return (
    isFiniteNumber(value.stage) &&
    value.stage >= 1 &&
    isVerifyInstruction(value.instruction) &&
    (side === 'right' || side === 'center' || side === 'left') &&
    isFiniteNumber(value.chancesFor) &&
    isFiniteNumber(value.goalsFor) &&
    isFiniteNumber(value.chancesAgainst) &&
    isFiniteNumber(value.goalsAgainst) &&
    isFiniteNumber(value.wingGoalsAgainst) &&
    isFiniteNumber(value.protection) &&
    typeof value.note === 'string'
  );
}

function isEvidenceShape(value: unknown): value is Evidence {
  if (!isObject(value)) return false;
  return isBoolean(value.experiencedFault) && isBoolean(value.operatedMechanic) && isBoolean(value.transferred);
}

/**
 * 校验并恢复存档。任何结构不合法都返回 null，由调用方从新状态开始；
 * 存档里的 mode / fastPlay 必须与当前上下文一致，避免两个模式共用一份状态。
 */
export function reviveTacticsState(raw: unknown, options: TacticsInitOptions): TacticsState | null {
  if (!isObject(raw)) return null;
  if (raw.version !== 1) return null;
  if (!isPhase(raw.phase)) return null;
  const mode = raw.mode;
  if (mode !== 'normal' && mode !== 'showcase') return null;
  if (mode !== options.mode) return null;
  if (!isBoolean(raw.fastPlay)) return null;
  const expectedFastPlay = options.mode === 'showcase' && options.showcaseOptions?.fastPlay === true;
  if (raw.fastPlay !== expectedFastPlay) return null;
  if (!isFiniteNumber(raw.seed) || !isRngState(raw.rng)) return null;
  if (!isConfig(raw.config)) return null;
  const installed = raw.installed;
  if (!isObject(installed) || !isBoolean(installed.dualShape) || !isBoolean(installed.roleDuties)) return null;
  const repairStep = raw.repairStep;
  if (repairStep !== 'shape' && repairStep !== 'duty' && repairStep !== 'done') return null;
  const fault = raw.fault;
  if (!isObject(fault) || !Array.isArray(fault.played) || !fault.played.every(isFaultStageResult)) return null;
  if (!isBoolean(fault.done) || !isBoolean(fault.demoPreloaded)) return null;
  const diagnose = raw.diagnose;
  if (!isObject(diagnose) || !isBoolean(diagnose.resolved)) return null;
  const verify = raw.verify;
  if (!isObject(verify) || !Array.isArray(verify.results) || !verify.results.every(isVerifyStageResult)) return null;
  if (!isBoolean(verify.done)) return null;
  const transfer = raw.transfer;
  if (!isObject(transfer) || !isBoolean(transfer.resolved) || !isBoolean(transfer.skipped)) return null;
  if (!isEvidenceShape(raw.evidence)) return null;
  if (!isValidEventLog(raw.eventLog)) return null;
  if (!isBoolean(raw.completed)) return null;
  // 交叉校验：阶段不能早于已完成的前置步骤，避免读档绕过验证。
  if (verify.results.length > 0 && (!installed.dualShape || !installed.roleDuties)) return null;
  if (fault.played.length > (raw.fastPlay ? 2 : 3)) return null;
  if (verify.results.length > (raw.fastPlay ? 2 : 3)) return null;
  if (installed.roleDuties && repairStep !== 'done') return null;
  if (!installed.roleDuties && installed.dualShape && repairStep !== 'duty') return null;
  if (!installed.dualShape && repairStep !== 'shape') return null;
  if (
    (raw.phase === 'verify' || raw.phase === 'transfer' || raw.phase === 'summary') &&
    (!installed.dualShape || !installed.roleDuties || !verify.done)
  ) {
    return null;
  }

  const rng = reviveRng(raw.rng);
  const eventLog = [...(raw.eventLog as EventLogEntry[])];
  return {
    version: 1,
    phase: raw.phase,
    mode,
    fastPlay: raw.fastPlay,
    seed: normalizeSeed(raw.seed),
    rng,
    config: { ...(raw.config as TacticsConfig) },
    installed: { dualShape: installed.dualShape, roleDuties: installed.roleDuties },
    repairStep,
    fault: {
      played: [...(fault.played as FaultStageResult[])],
      done: fault.done,
      demoPreloaded: fault.demoPreloaded,
    },
    diagnose: { resolved: diagnose.resolved },
    verify: { results: [...(verify.results as VerifyStageResult[])], done: verify.done },
    transfer: { resolved: transfer.resolved, skipped: transfer.skipped },
    evidence: {
      experiencedFault: (raw.evidence as Evidence).experiencedFault,
      operatedMechanic: (raw.evidence as Evidence).operatedMechanic,
      transferred: (raw.evidence as Evidence).transferred,
    },
    eventLog,
    completed: raw.completed,
  };
}

/** 仅供界面展示：某一阵型/职责的指标摘要文字。 */
export function metricsSummary(metrics: TacticsMetrics): string {
  return `推进 ${metrics.progression} · 边路保护 ${metrics.wingProtection} · 中路保护 ${metrics.centralProtection} · 体能 ${metrics.stamina}`;
}
