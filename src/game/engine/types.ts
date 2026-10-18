/** 关卡与机制的共享类型。规则代码和界面代码都从这里取类型，避免互相依赖实现细节。 */

export type LevelId = 'tactics' | 'scouting' | 'transfers' | 'squad';

export type MechanismId =
  | 'tactics-shapes'
  | 'scout-network'
  | 'transfer-negotiation'
  | 'squad-registration';

export type GameMode = 'normal' | 'showcase';

/** 关卡统一的教学阶段。顺序与 PHASE_ORDER 一致。 */
export type LevelPhase =
  | 'commission'
  | 'faultPlay'
  | 'diagnose'
  | 'repair'
  | 'verify'
  | 'transfer'
  | 'summary';

export const PHASE_ORDER: LevelPhase[] = [
  'commission',
  'faultPlay',
  'diagnose',
  'repair',
  'verify',
  'transfer',
  'summary',
];

export const PHASE_LABELS: Record<LevelPhase, string> = {
  commission: '接单',
  faultPlay: '试玩故障版',
  diagnose: '诊断',
  repair: '维修',
  verify: '验证',
  transfer: '迁移',
  summary: '归档',
};

/** 可安装的规则模块。维修面板读取这个结构。 */
export interface MechanismModule {
  id: string;
  name: string;
  englishName: string;
  description: string;
  sideEffect?: string;
}

export interface LevelDefinition {
  id: LevelId;
  order: number;
  title: string;
  englishTitle: string;
  theme: 'tactics' | 'scouting' | 'transfers' | 'squad';
  clientName: string;
  clientRole: string;
  clientAvatar: string;
  complaint: string;
  shortProblem: string;
  teachingObjectives: string[];
  availableModules: MechanismModule[];
  completionRequirements: string[];
  mechanismId: MechanismId;
  estimatedMinutes: number;
}

/** 三个“维修证据”检查项。不用综合分数，只用是否发生过真实操作。 */
export interface Evidence {
  experiencedFault: boolean;
  operatedMechanic: boolean;
  transferred: boolean;
}

export function createEvidence(): Evidence {
  return { experiencedFault: false, operatedMechanic: false, transferred: false };
}

export function countEvidence(evidence: Evidence): number {
  return Number(evidence.experiencedFault) + Number(evidence.operatedMechanic) + Number(evidence.transferred);
}

/** 可序列化的事件日志条目。对比面板只读取真实日志。 */
export interface EventLogEntry {
  seq: number;
  phase: LevelPhase;
  action: string;
  label: string;
  before: EventState;
  after: EventState;
  delta?: string;
  note?: string;
}

export type EventState = Record<string, number | string>;

export interface QuizOption {
  id: string;
  label: string;
}

/** 展示模式给关卡的参数：固定种子、短局、可跳到指定阶段。 */
export interface ShowcaseOptions {
  seed: number;
  fastPlay: boolean;
  startPhase: LevelPhase;
}

export interface LevelCompletion {
  evidence: Evidence;
  summary: string[];
  /** 真实赛季结果，用于主页俱乐部办公室的时间线与下一份委托。 */
  clubUpdate?: ClubUpdate;
  /** 跨关俱乐部状态增量：预算、战术、签约、返工次数等真实数据。 */
  clubPatch?: ClubPatch;
}

/** 关卡完成后写入俱乐部档案的真实结果，不包含虚构评分。 */
export interface ClubUpdate {
  headline: string;
  details: string[];
  nextBrief?: string;
}

/* ------------------------------------------------------------------ *
 * 跨关俱乐部状态：四关共享的真实资源与产出。
 * 所有字段都来自玩家操作或关卡规则，不包含虚构评分。
 * ------------------------------------------------------------------ */

export interface ClubTactics {
  possessionShape: string;
  outOfPossessionShape: string;
  fullbackDuty: string;
  pivotDuty: string;
}

export interface ClubScoutCandidate {
  id: string;
  name: string;
  position: string;
  region: string;
  knowledge: number;
}

export interface ClubSigning {
  id: string;
  name: string;
  position: string;
  fee: number;
  wage: number;
  homegrown: boolean;
}

export interface ClubTimelineEntry {
  levelId: LevelId;
  headline: string;
  details: string[];
  at: string;
}

export interface ClubSeasonReport {
  headline: string;
  details: string[];
}

export interface ClubState {
  name: string;
  season: string;
  /** 已完成周数（每完成一关 +1）。 */
  week: number;
  /** 剩余转会预算（百万欧）。 */
  transferBudget: number;
  /** 周薪空间（千欧/周）。 */
  wageBudget: number;
  /** 返工次数：失败验证的真实代价，会累计进赛季报告。 */
  failures: number;
  tactics: ClubTactics | null;
  scoutedCandidates: ClubScoutCandidate[];
  signings: ClubSigning[];
  timeline: ClubTimelineEntry[];
  seasonReport: ClubSeasonReport | null;
}

/** 关卡提交给俱乐部的跨关增量；未提供的字段保持不变。 */
export interface ClubPatch {
  tactics?: ClubTactics;
  scoutedCandidates?: ClubScoutCandidate[];
  signings?: ClubSigning[];
  /** 绝对剩余值，由关卡根据失败成本计算后提交。 */
  transferBudget?: number;
  wageBudget?: number;
  /** 本次完成前累计的返工次数（关卡内记录）。 */
  addFailures?: number;
  seasonReport?: ClubSeasonReport;
}

/** 每个关卡组件统一接收的 props。 */
export interface LevelScreenProps {
  level: LevelDefinition;
  mode: GameMode;
  fastStart: boolean;
  showcaseOptions: ShowcaseOptions | null;
  /** 正常模式下的俱乐部跨关状态；展示模式为 undefined。 */
  club?: ClubState;
  /** 上次保存的关卡状态（未知结构，由关卡自己校验）。 */
  savedState: unknown;
  /** 关卡状态变化时调用；App 负责写入 localStorage。 */
  onSaveState: (state: unknown) => void;
  /** 完成全部教学阶段时调用；App 负责解锁图鉴与下一关。 */
  onComplete: (result: LevelCompletion) => void;
  onExit: () => void;
}
