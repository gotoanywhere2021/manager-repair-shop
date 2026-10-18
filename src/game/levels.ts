import type { LevelDefinition, LevelId, MechanismId } from './engine/types';

/**
 * 四个关卡的静态定义：客户、投诉、教学目标、可用模块、完成条件。
 * 题材是足球经理类游戏的真实系统（战术、球探、转会、注册），
 * 但所有俱乐部、人物、数值均为原创简化原型，不代表任何真实游戏或俱乐部的规则。
 */
export const LEVELS: LevelDefinition[] = [
  {
    id: 'tactics',
    order: 1,
    title: '战术板',
    englishTitle: 'The Tactics Board',
    theme: 'tactics',
    clientName: '林锋',
    clientRole: '主教练',
    clientAvatar: '🧑‍🏫',
    complaint: '我只有一套阵型。控球时和丢球以后，球员站在一模一样的位置，边路永远被打穿。',
    shortProblem: '一套阵型同时管控球和丢球，两种任务互相打架。',
    teachingObjectives: [
      '区分“有球形态”和“无球形态”两套站位。',
      '理解同一名球员在两种形态下的不同职责。',
      '用形态、职责和对手打法解释机会与失球。',
    ],
    availableModules: [
      {
        id: 'dual-shape',
        name: '双形态战术',
        englishName: 'In & Out of Possession',
        description: '控球时与无球时各用一套阵型：有球形态负责推进与创造，无球形态负责保护与压迫。',
        sideEffect: '两套形态切换需要训练与角色熟悉度；职责冲突会让球员在两套任务之间犹豫。',
      },
      {
        id: 'role-duties',
        name: '职责分工',
        englishName: 'Role Duties',
        description: '同一位置可以设置不同职责，例如边后卫内收或套边、后腰单人或双人，直接影响推进与保护。',
        sideEffect: '职责越激进，控球收益越高，丢球后的回防距离也越长。',
      },
    ],
    completionRequirements: [
      '完成故障版比赛。',
      '安装双形态战术并设置两套阵型。',
      '完成 3 个比赛阶段的验证。',
      '完成迁移题。',
      '无最低胜场要求。',
    ],
    mechanismId: 'tactics-shapes',
    estimatedMinutes: 4,
  },
  {
    id: 'scouting',
    order: 2,
    title: '球探室',
    englishTitle: 'The Scouting Room',
    theme: 'scouting',
    clientName: '周远',
    clientRole: '首席球探',
    clientAvatar: '🔭',
    complaint: '我点一下就能知道所有球员的全部信息，球探像没有成本的按钮。真实工作里，报告是一轮轮变清楚的。',
    shortProblem: '球探无成本、信息瞬间完整，考察失去意义。',
    teachingObjectives: [
      '理解有限球探的分配。',
      '理解知识度决定报告可信度。',
      '区分“看得见”和“猜得准”。',
    ],
    availableModules: [
      {
        id: 'limited-scouts',
        name: '有限球探',
        englishName: 'Limited Scouts',
        description: '只有 2 名球探，可以派往不同区域；每个区域每轮只能安排一名球探；回合结束收回。',
        sideEffect: '区域越多，单个区域的知识增长越慢；后手区域可能错过窗口。',
      },
      {
        id: 'knowledge-reports',
        name: '知识度报告',
        englishName: 'Knowledge Reports',
        description: '知识度从低到高逐级解锁属性区间：低知识度只给模糊评价，高知识度才接近真实能力。',
        sideEffect: '报告看起来“很难用”是正常的；它保护你免于被虚假的精确数字骗到。',
      },
    ],
    completionRequirements: [
      '完成故障版考察。',
      '完成两轮球探派遣。',
      '根据报告选出 1 名候选进入候选名单。',
      '完成迁移题。',
      '不要求选中“最强”球员。',
    ],
    mechanismId: 'scout-network',
    estimatedMinutes: 4,
  },
  {
    id: 'transfers',
    order: 3,
    title: '转会窗',
    englishTitle: 'The Transfer Window',
    theme: 'transfers',
    clientName: '顾航',
    clientRole: '体育总监',
    clientAvatar: '💼',
    complaint: '看到身价就直接砸钱，预算和工资空间永远失控；窗口关上才发现一个人都没签成。',
    shortProblem: '报价没有代价，预算、工资与竞争风险全部缺席。',
    teachingObjectives: [
      '理解转会预算与工资空间的双重约束。',
      '理解报价、等待与竞争风险。',
      '用真实出价记录解释签下或错过。',
    ],
    availableModules: [
      {
        id: 'budget',
        name: '预算与工资空间',
        englishName: 'Budget & Wages',
        description: '转会预算与周薪空间分别记账，签约同时占用两者；超出任意一项都无法完成注册。',
        sideEffect: '把预算全砸在一名球星上，可能连替补的工资空间都不剩。',
      },
      {
        id: 'negotiation',
        name: '报价与谈判',
        englishName: 'Negotiation',
        description: '报价分档，等待可能压低价格，也可能引来竞争对手；窗口结束前必须完成目标。',
        sideEffect: '一味等待会把“省钱”变成“错过”；过早砸钱则失去议价空间。',
      },
    ],
    completionRequirements: [
      '完成故障版转会尝试。',
      '完成 3 轮转会窗口。',
      '签下至少 2 名球员。',
      '完成迁移题。',
      '不要求花光预算。',
    ],
    mechanismId: 'transfer-negotiation',
    estimatedMinutes: 4,
  },
  {
    id: 'squad',
    order: 4,
    title: '赛季名单',
    englishTitle: 'Registration Day',
    theme: 'squad',
    clientName: '韩森',
    clientRole: '俱乐部经理',
    clientAvatar: '📋',
    complaint:
      '凑了 25 个人，注册却被打回：本土青训不够、位置重叠、工资爆表。我要一个能同时处理战术、球探、转会与注册的系统。',
    shortProblem: '战术、球探、转会与注册各修各的，名单交上去才发现互相打架。',
    teachingObjectives: [
      '组合双形态战术、球探网络与转会谈判。',
      '理解阵容注册的配额与位置覆盖。',
      '用规则与操作证据说明系统是否生效。',
    ],
    availableModules: [
      {
        id: 'tactics-shapes',
        name: '双形态战术',
        englishName: 'In & Out of Possession',
        description: '有球形态与无球形态各一套阵型与职责；直接影响比赛阶段的攻守表现。',
        sideEffect: '关闭后只能用一套站位打全场，边路与转换阶段会暴露问题。',
      },
      {
        id: 'scout-network',
        name: '球探网络',
        englishName: 'Scouting Network',
        description: '有限球探与知识度：只有考察过的候选才会显示可信报告。',
        sideEffect: '关闭后所有候选信息瞬间完整，选择失去信息成本。',
      },
      {
        id: 'transfer-negotiation',
        name: '转会谈判',
        englishName: 'Transfer Negotiation',
        description: '转会预算、工资空间与报价竞争：签约有真实代价与错过风险。',
        sideEffect: '关闭后预算无限、报价必成，名单可以随便凑。',
      },
      {
        id: 'squad-registration',
        name: '阵容注册',
        englishName: 'Squad Registration',
        description: '25 人名单上限、本土青训名额与位置覆盖：名单必须同时满足比赛与注册规则。',
        sideEffect: '只堆球星会挤掉青训名额；只满足配额又可能凑不齐位置。',
      },
    ],
    completionRequirements: [
      '三个客户目标各有规则与操作证据。',
      '完成名单注册检查。',
      '完成反事实题或解释选择。',
      '无最低积分要求。',
    ],
    mechanismId: 'squad-registration',
    estimatedMinutes: 6,
  },
];

export const LEVEL_ORDER: LevelId[] = ['tactics', 'scouting', 'transfers', 'squad'];

/** 系统的中英文名称，图鉴与工作台共用。卡片全文在 src/content/codex.ts。 */
export const MECHANISM_NAMES: Record<MechanismId, { zh: string; en: string }> = {
  'tactics-shapes': { zh: '双形态战术', en: 'In & Out of Possession' },
  'scout-network': { zh: '球探网络', en: 'Scouting Network' },
  'transfer-negotiation': { zh: '转会谈判', en: 'Transfer Negotiation' },
  'squad-registration': { zh: '阵容注册', en: 'Squad Registration' },
};

export function getLevel(levelId: LevelId): LevelDefinition {
  const level = LEVELS.find((item) => item.id === levelId);
  if (!level) throw new Error(`未知关卡：${levelId}`);
  return level;
}

export function isLevelId(value: unknown): value is LevelId {
  return typeof value === 'string' && (LEVEL_ORDER as string[]).includes(value);
}

export function isMechanismId(value: unknown): value is MechanismId {
  return (
    value === 'tactics-shapes' ||
    value === 'scout-network' ||
    value === 'transfer-negotiation' ||
    value === 'squad-registration'
  );
}

/** 正常模式按顺序解锁：第一关始终可用，之后每关需要上一关完成。 */
export function isLevelUnlocked(levelId: LevelId, completedLevels: LevelId[]): boolean {
  const index = LEVEL_ORDER.indexOf(levelId);
  if (index <= 0) return true;
  const previous = LEVEL_ORDER[index - 1];
  return completedLevels.includes(previous);
}

export function firstPlayableLevel(completedLevels: LevelId[]): LevelId {
  const next = LEVEL_ORDER.find((levelId) => !completedLevels.includes(levelId));
  return next ?? 'tactics';
}

export type LevelCardStatus = 'not-started' | 'in-progress' | 'completed';

export function levelCardStatus(
  levelId: LevelId,
  progress: { completedLevels: LevelId[]; currentLevel: LevelId | null; levelStates: Partial<Record<LevelId, unknown>> },
): LevelCardStatus {
  if (progress.completedLevels.includes(levelId)) return 'completed';
  if (progress.currentLevel === levelId || progress.levelStates[levelId] !== undefined) return 'in-progress';
  return 'not-started';
}

export interface LevelProgressSummary {
  completedCount: number;
  totalCount: number;
  nextLevel: LevelId;
  percent: number;
}

export function summarizeProgress(completedLevels: LevelId[]): LevelProgressSummary {
  const completedCount = LEVEL_ORDER.filter((levelId) => completedLevels.includes(levelId)).length;
  return {
    completedCount,
    totalCount: LEVEL_ORDER.length,
    nextLevel: firstPlayableLevel(completedLevels),
    percent: Math.round((completedCount / LEVEL_ORDER.length) * 100),
  };
}
