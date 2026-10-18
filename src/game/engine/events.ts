import type { EventLogEntry, EventState, LevelPhase } from './types';

export interface EventInput {
  phase: LevelPhase;
  action: string;
  label: string;
  before: EventState;
  after: EventState;
  delta?: string;
  note?: string;
}

/** 追加一条事件，序号由日志长度决定，保证递增且可序列化。 */
export function recordEvent(log: EventLogEntry[], input: EventInput): EventLogEntry[] {
  const entry: EventLogEntry = { ...input, seq: log.length + 1 };
  return [...log, entry];
}

export function lastEvent(log: EventLogEntry[]): EventLogEntry | null {
  return log.length > 0 ? log[log.length - 1] : null;
}

export function countActions(log: EventLogEntry[], action: string): number {
  return log.reduce((total, entry) => (entry.action === action ? total + 1 : total), 0);
}

/** 对比面板只读日志：把两类记录并排展示，不做任何“假统计”。 */
export interface ComparisonRow {
  label: string;
  fault: string;
  fixed: string;
}

export function buildComparisonRows(rows: ComparisonRow[]): ComparisonRow[] {
  return rows.map((row) => ({ ...row }));
}
