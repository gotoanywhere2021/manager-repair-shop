import type { ReactNode } from 'react';
import type { EventLogEntry } from '../game/engine/types';

export function EventLogList({
  entries,
  emptyText = '还没有操作记录。',
  maxHeight,
}: {
  entries: EventLogEntry[];
  emptyText?: ReactNode;
  maxHeight?: number;
}) {
  if (entries.length === 0) {
    return <p className="event-log-empty">{emptyText}</p>;
  }
  const ordered = [...entries].reverse();
  return (
    <div className="event-log" style={maxHeight ? { maxHeight } : undefined}>
      <p className="event-log-caption">共 {entries.length} 条真实操作记录，最近的在最上面。</p>
      <ol className="event-log-list">
        {ordered.map((entry) => (
          <li key={entry.seq} className="event-log-item">
            <div className="event-log-line">
              <span className="event-log-seq">#{entry.seq}</span>
              <span className="event-log-label">{entry.label}</span>
              {entry.delta && <span className="event-log-delta">{entry.delta}</span>}
            </div>
            {entry.note && <p className="event-log-note">{entry.note}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function ComparisonTable({
  head,
  rows,
  emptyText = '还没有可对比的数据。',
}: {
  head: string[];
  rows: ReactNode[][];
  emptyText?: ReactNode;
}) {
  if (rows.length === 0) {
    return <p className="comparison-empty">{emptyText}</p>;
  }
  return (
    <div className="comparison-wrap">
      <table className="comparison-table">
        <thead>
          <tr>
            {head.map((cell, index) => (
              <th key={index} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
