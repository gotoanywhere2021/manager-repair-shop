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
}

/** 关卡完成后写入俱乐部档案的真实结果，不包含虚构评分。 */
export interface ClubUpdate {
  headline: string;
  details: string[];
  nextBrief?: string;
}

/** 每个关卡组件统一接收的 props。 */
export interface LevelScreenProps {
  level: LevelDefinition;
  mode: GameMode;
  fastStart: boolean;
  showcaseOptions: ShowcaseOptions | null;
  /** 上次保存的关卡状态（未知结构，由关卡自己校验）。 */
  savedState: unknown;
  /** 关卡状态变化时调用；App 负责写入 localStorage。 */
  onSaveState: (state: unknown) => void;
  /** 完成全部教学阶段时调用；App 负责解锁图鉴与下一关。 */
  onComplete: (result: LevelCompletion) => void;
  onExit: () => void;
}
