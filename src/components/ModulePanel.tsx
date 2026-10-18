import type { ReactNode } from 'react';
import { Chip } from './Ui';

export interface ModuleCardProps {
  name: string;
  englishName?: string;
  summary: ReactNode;
  sideEffect?: ReactNode;
  installed: boolean;
  onToggle?: () => void;
  disabled?: boolean;
  disabledHint?: ReactNode;
  badge?: ReactNode;
  children?: ReactNode;
}

/** 可安装的规则模块卡：点击整张卡安装/卸载，不依赖拖拽。 */
export function ModuleCard({
  name,
  englishName,
  summary,
  sideEffect,
  installed,
  onToggle,
  disabled = false,
  disabledHint,
  badge,
  children,
}: ModuleCardProps) {
  const content = (
    <>
      <div className="module-card-head">
        <div>
          <p className="module-name">{name}</p>
          {englishName && <p className="module-english">{englishName}</p>}
        </div>
        {installed ? <Chip tone="green">已安装</Chip> : <Chip tone="neutral">未安装</Chip>}
      </div>
      <p className="module-summary">{summary}</p>
      {sideEffect && (
        <p className="module-side-effect">
          <span aria-hidden="true">⚠</span> 副作用：{sideEffect}
        </p>
      )}
      {badge && <div className="module-badge">{badge}</div>}
      {children}
      {onToggle && !disabled && <span className="module-action">{installed ? '点击卸载模块' : '点击安装模块'}</span>}
      {disabled && disabledHint && <span className="module-disabled">{disabledHint}</span>}
    </>
  );

  if (!onToggle || disabled) {
    return <article className={`module-card${installed ? ' is-installed' : ''}${disabled ? ' is-disabled' : ''}`}>{content}</article>;
  }

  return (
    <article className={`module-card is-clickable${installed ? ' is-installed' : ''}`}>
      <button type="button" className="module-card-button" onClick={onToggle} aria-pressed={installed} aria-label={`${installed ? '卸载' : '安装'}模块：${name}`}>
        {content}
      </button>
    </article>
  );
}

export interface PresetOption<T extends string> {
  id: T;
  name: string;
  description: string;
  detail?: string;
}

export function PresetPicker<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  disabledHint,
}: {
  label: ReactNode;
  options: PresetOption<T>[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  disabledHint?: ReactNode;
}) {
  return (
    <div className="preset-picker">
      <p className="preset-label">{label}</p>
      <div className="preset-options" role="radiogroup" aria-label={typeof label === 'string' ? label : '参数预设'}>
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`preset-option${selected ? ' is-selected' : ''}`}
              onClick={() => onChange(option.id)}
              disabled={disabled}
            >
              <span className="preset-name">{option.name}</span>
              <span className="preset-description">{option.description}</span>
              {option.detail && <span className="preset-detail">{option.detail}</span>}
            </button>
          );
        })}
      </div>
      {disabled && disabledHint && <p className="preset-hint">{disabledHint}</p>}
    </div>
  );
}
