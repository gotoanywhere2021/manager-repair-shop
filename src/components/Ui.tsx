import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type Tone = 'neutral' | 'purple' | 'green' | 'amber' | 'red';
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} btn-${size}${fullWidth ? ' btn-full' : ''}${className ? ` ${className}` : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface PanelProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  tone?: Tone;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}

export function Panel({ title, subtitle, tone = 'neutral', actions, children, className = '', id }: PanelProps) {
  return (
    <section id={id} className={`panel panel-${tone}${className ? ` ${className}` : ''}`}>
      {(title || actions) && (
        <header className="panel-head">
          <div className="panel-head-text">
            {title && <h2 className="panel-title">{title}</h2>}
            {subtitle && <p className="panel-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="panel-actions">{actions}</div>}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Chip({ tone = 'neutral', children, icon }: { tone?: Tone; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={`chip chip-${tone}`}>
      {icon && <span className="chip-icon" aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}

export function Callout({
  tone = 'purple',
  title,
  icon,
  children,
}: {
  tone?: Exclude<Tone, 'neutral'> | 'neutral';
  title?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`callout callout-${tone}`} role="note">
      {icon && <span className="callout-icon" aria-hidden="true">{icon}</span>}
      <div className="callout-text">
        {title && <p className="callout-title">{title}</p>}
        <div className="callout-body">{children}</div>
      </div>
    </div>
  );
}

export function StatTile({ label, value, hint, tone = 'neutral' }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className={`stat-tile stat-${tone}`}>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export function RiskMeter({
  label,
  value,
  detail,
}: {
  label: ReactNode;
  /** 0~1 之间。 */
  value: number;
  detail?: ReactNode;
}) {
  const clamped = Math.min(1, Math.max(0, value));
  const percent = Math.round(clamped * 100);
  return (
    <div className="risk-meter">
      <div className="risk-meter-head">
        <span className="risk-meter-label">{label}</span>
        <span className="risk-meter-value">危险概率 {percent}%</span>
      </div>
      <div className="risk-track" role="img" aria-label={`危险概率 ${percent}%`}>
        <div className="risk-fill" style={{ width: `${percent}%` }} />
      </div>
      {detail && <p className="risk-meter-detail">{detail}</p>}
    </div>
  );
}

export function Meter({
  label,
  value,
  max,
  tone = 'purple',
  valueLabel,
}: {
  label?: ReactNode;
  value: number;
  max: number;
  tone?: Tone;
  valueLabel?: ReactNode;
}) {
  const safeMax = Math.max(1, max);
  const percent = Math.min(100, Math.max(0, Math.round((value / safeMax) * 100)));
  return (
    <div className="meter">
      {label && (
        <div className="meter-head">
          <span>{label}</span>
          <span className="meter-value">{valueLabel ?? `${value} / ${max}`}</span>
        </div>
      )}
      <div className="meter-track" role="img" aria-label={typeof label === 'string' ? `${label}：${value} / ${max}` : undefined}>
        <div className={`meter-fill meter-${tone}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className={`toggle-row${disabled ? ' is-disabled' : ''}`}>
      <div className="toggle-text">
        <span className="toggle-label">{label}</span>
        {description && <span className="toggle-description">{description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === 'string' ? label : undefined}
        className={`switch${checked ? ' is-on' : ''}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-knob" aria-hidden="true" />
        <span className="switch-text">{checked ? '已启用' : '已关闭'}</span>
      </button>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = '取消',
  tone = 'primary',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="dialog-title">{title}</h2>
        <div className="dialog-body">{description}</div>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ArrowFlow({ from, to, label = '规则变化 → 决策变化' }: { from: ReactNode; to: ReactNode; label?: string }) {
  return (
    <div className="arrow-flow">
      <span className="arrow-flow-label">{label}</span>
      <span className="arrow-flow-node">{from}</span>
      <span className="arrow-flow-arrow" aria-hidden="true">→</span>
      <span className="arrow-flow-node arrow-flow-result">{to}</span>
    </div>
  );
}

export function EmptyState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <p className="empty-state-title">{title}</p>
      {children && <p className="empty-state-body">{children}</p>}
    </div>
  );
}

export function RuleList({ items }: { items: { label: ReactNode; value: ReactNode; tone?: Tone }[] }) {
  return (
    <dl className="rule-list">
      {items.map((item, index) => (
        <div className="rule-item" key={index}>
          <dt>{item.label}</dt>
          <dd className={item.tone ? `rule-value tone-${item.tone}` : 'rule-value'}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
