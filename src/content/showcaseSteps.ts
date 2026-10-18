import type { LevelId, LevelPhase, ShowcaseOptions } from '../game/engine/types';
import type { DemoProgress } from '../game/progressOps';

/**
 * 展示模式的 8 步演示流程。
 *
 * 只放静态步骤数据与跳转参数，不依赖正式通关进度：
 * 每一步都可以直接从演示页跳过去，所有关卡参数使用固定种子与短局设置，
 * 与正常模式的参数（随机种子、完整阶段）明确区分。
 */
export const SHOWCASE_SEED = 20251018;

export type ShowcaseStepKind = 'intro' | 'level' | 'codex';

export interface ShowcaseTarget {
  levelId: LevelId;
  startPhase: LevelPhase;
  /** 按钮上的动作说明，例如“试玩故障版”。 */
  actionLabel: string;
}

export interface ShowcaseStep {
  /** 记入 demo.completedSteps 的稳定 id。 */
  id: string;
  order: number;
  kind: ShowcaseStepKind;
  title: string;
  description: string;
  /** 演示者/观众在这一步应该注意什么。 */
  cue: string;
  /** 需要跳转的关卡；第 1、8 步为空。第 6 步有两个示例入口。 */
  targets: ShowcaseTarget[];
  /** demo.lastCompleted 命中这些关卡时，本步由演示记录自动视为完成。 */
  autoLevels?: LevelId[];
  /** 这一跳会跳过迁移题，界面上要标注“演示跳过迁移题”。 */
  skipTransfer: boolean;
}

export const SHOWCASE_STEPS: ShowcaseStep[] = [
  {
    id: 'intro',
    order: 1,
    kind: 'intro',
    title: '一句话介绍产品',
    description: '把不好玩的足球经理，修成有选择的足球经理。',
    cue: '演示者口述：先试玩一个坏掉的俱乐部系统，再亲手装上真实规则，最后用比赛、报告与名单记录看见“选择”是怎么被改出来的。',
    targets: [],
    skipTransfer: false,
  },
  {
    id: 'tactics-fault',
    order: 2,
    kind: 'level',
    title: '直接试玩战术板故障版',
    description: '让观众亲手感受问题：只有一套阵型，控球和丢球后站位一模一样，边路反复被打穿。',
    cue: '关注点：故障版没有“有球/无球”之分，换谁上场都执行同一套站位，调整只是换名字。',
    targets: [{ levelId: 'tactics', startPhase: 'faultPlay', actionLabel: '试玩故障版' }],
    skipTransfer: false,
  },
  {
    id: 'tactics-repair',
    order: 3,
    kind: 'level',
    title: '安装双形态战术',
    description: '给球队装上“有球形态 + 无球形态”两套站位与职责，再设置转换规则。',
    cue: '关注点：同一条边路，控球时要求套边，丢球后要求回收；规则变化直接改变了球员的任务。',
    targets: [{ levelId: 'tactics', startPhase: 'repair', actionLabel: '安装双形态' }],
    skipTransfer: false,
  },
  {
    id: 'tactics-run',
    order: 4,
    kind: 'level',
    title: '进行一次短比赛验证',
    description: '用固定种子跑一段短局比赛（正常 3 个阶段，演示 2 个），观察同一批球员在两种形态下的表现。',
    cue: '关注点：有球阶段机会是否变多，无球阶段边路是否还被反复打穿。',
    targets: [{ levelId: 'tactics', startPhase: 'verify', actionLabel: '短比赛' }],
    skipTransfer: true,
  },
  {
    id: 'tactics-compare',
    order: 5,
    kind: 'level',
    title: '对比修改前后的决策',
    description: '回到验证阶段，对照故障版与修复版：同样的对手，你为什么开始考虑“丢球后怎么站”。',
    cue: '关注点：双形态不是换个阵型名字，而是让同一名球员在两种阶段承担不同职责。',
    targets: [{ levelId: 'tactics', startPhase: 'verify', actionLabel: '查看决策差异' }],
    autoLevels: ['tactics'],
    skipTransfer: true,
  },
  {
    id: 'other-systems',
    order: 6,
    kind: 'level',
    title: '快速打开球探网络与转会窗示例',
    description: '分别看两个系统：一个是“有限球探与知识度”，一个是“预算、报价与等待”。',
    cue: '关注点：球探让你为信息付费，转会窗让你为等待和竞争付费。',
    targets: [
      { levelId: 'scouting', startPhase: 'verify', actionLabel: '球探网络示例' },
      { levelId: 'transfers', startPhase: 'verify', actionLabel: '转会窗示例' },
    ],
    autoLevels: ['scouting', 'transfers'],
    skipTransfer: true,
  },
  {
    id: 'squad-final',
    order: 7,
    kind: 'level',
    title: '进入毕业关：赛季名单',
    description: '在赛季名单里，战术、球探、转会与注册同时作用，看它们如何互相牵制。',
    cue: '关注点：这次要同时判断怎么踢、该信谁、花多少钱，以及名单能不能注册。',
    targets: [{ levelId: 'squad', startPhase: 'verify', actionLabel: '毕业关示例' }],
    autoLevels: ['squad'],
    skipTransfer: true,
  },
  {
    id: 'codex',
    order: 8,
    kind: 'codex',
    title: '打开已解锁的经理图鉴',
    description: '演示模式下四张图鉴全部开放，可以逐条对照刚才的体验收尾。',
    cue: '收尾点：定义、本关体验、决策结构、适用情况、常见误用与可能的副作用都写在同一张卡上。',
    targets: [],
    skipTransfer: false,
  },
];

/** 演示页显示的步骤总数；从数组长度推导，增删步骤时界面文案会自动跟随。 */
export const SHOWCASE_TOTAL_STEPS = SHOWCASE_STEPS.length;

/** 把步骤目标转换成关卡使用的展示参数：固定种子 + 短局 + 指定起始阶段。 */
export function showcaseOptionsFor(target: ShowcaseTarget): ShowcaseOptions {
  return {
    seed: SHOWCASE_SEED,
    fastPlay: true,
    startPhase: target.startPhase,
  };
}

/** 判断某一步是否已完成：手动标记或对应关卡返回了演示完成记录。 */
export function isShowcaseStepDone(step: ShowcaseStep, demo: DemoProgress): boolean {
  if (demo.completedSteps.includes(step.id)) return true;
  if (!step.autoLevels) return false;
  return step.autoLevels.some((levelId) => demo.completedLevels.includes(levelId));
}
