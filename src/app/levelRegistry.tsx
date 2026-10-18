import type { ComponentType } from 'react';
import type { LevelId, LevelScreenProps } from '../game/engine/types';
import { TacticsLevel } from '../game/levels/tactics/TacticsLevel';
import { ScoutingLevel } from '../game/levels/scouting/ScoutingLevel';
import { TransfersLevel } from '../game/levels/transfers/TransfersLevel';
import { SquadLevel } from '../game/levels/squad/SquadLevel';

/** 关卡组件注册表：新增关卡时同时更新这里和 levels.ts。 */
export const LEVEL_COMPONENTS: Record<LevelId, ComponentType<LevelScreenProps>> = {
  tactics: TacticsLevel,
  scouting: ScoutingLevel,
  transfers: TransfersLevel,
  squad: SquadLevel,
};
