import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { QuizOption } from '../game/engine/types';
import { Button } from './Ui';

export interface QuizCardProps {
  question: ReactNode;
  hint?: ReactNode;
  options: QuizOption[];
  correctIds: string[];
  /** 每个选项的具体解释；答错时显示所选选项的解释，答对时显示正确选项的解释。 */
  explanations?: Record<string, ReactNode>;
  wrongHint?: ReactNode;
  successText?: ReactNode;
  multiSelect?: boolean;
  submitLabel?: string;
  onResolved?: () => void;
  initiallyResolved?: boolean;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * 诊断 / 迁移通用题卡：可以选择多个选项、提交、查看具体解释、立即重试。
 * 答错不扣任何资源，也不终止关卡。
 */
export function QuizCard({
  question,
  hint,
  options,
  correctIds,
  explanations = {},
  wrongHint,
  successText,
  multiSelect = false,
  submitLabel = '提交判断',
  onResolved,
  initiallyResolved = false,
}: QuizCardProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [attempts, setAttempts] = useState(0);
  const [resolved, setResolved] = useState(initiallyResolved);
  const [feedback, setFeedback] = useState<{ correct: boolean; checkedIds: string[] } | null>(null);
  const resolvedNotified = useRef(initiallyResolved);

  function toggleOption(id: string) {
    if (resolved) return;
    setFeedback(null);
    setSelected((current) => {
      if (multiSelect) {
        return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      }
      return [id];
    });
  }

  function submit() {
    if (resolved || selected.length === 0) return;
    const correct = sameSet(selected, correctIds);
    setAttempts((value) => value + 1);
    setFeedback({ correct, checkedIds: selected });
    if (correct) {
      setResolved(true);
      if (!resolvedNotified.current) {
        resolvedNotified.current = true;
        onResolved?.();
      }
    }
  }

  function retry() {
    setSelected([]);
    setFeedback(null);
  }

  const checkedIds = feedback?.checkedIds ?? [];

  return (
    <div className={`quiz-card${resolved ? ' is-resolved' : ''}`}>
      <p className="quiz-question">{question}</p>
      {hint && <p className="quiz-hint">{hint}</p>}
      <ul className="quiz-options" role={multiSelect ? 'group' : 'radiogroup'} aria-label="备选答案">
        {options.map((option) => {
          const isSelected = selected.includes(option.id);
          const isChecked = checkedIds.includes(option.id);
          const isCorrectOption = correctIds.includes(option.id);
          let stateClass = '';
          if (resolved && isCorrectOption) stateClass = ' is-correct';
          else if (feedback && isChecked && !isCorrectOption) stateClass = ' is-wrong';
          else if (isSelected) stateClass = ' is-selected';
          return (
            <li key={option.id}>
              <button
                type="button"
                role={multiSelect ? 'checkbox' : 'radio'}
                aria-checked={isSelected}
                className={`quiz-option${stateClass}`}
                onClick={() => toggleOption(option.id)}
                disabled={resolved}
              >
                <span className="quiz-option-mark" aria-hidden="true">
                  {isSelected ? (multiSelect ? '✓' : '●') : multiSelect ? '□' : '○'}
                </span>
                <span className="quiz-option-label">{option.label}</span>
                {resolved && isCorrectOption && <span className="quiz-option-flag">正确</span>}
                {feedback && isChecked && !isCorrectOption && <span className="quiz-option-flag">需要再看一遍</span>}
              </button>
              {feedback && isChecked && explanations[option.id] && (
                <p className="quiz-explanation">{explanations[option.id]}</p>
              )}
              {resolved && isCorrectOption && explanations[option.id] && (
                <p className="quiz-explanation is-ok">{explanations[option.id]}</p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="quiz-feedback" aria-live="polite">
        {feedback?.correct && (
          <div className="quiz-success">
            <p className="quiz-success-title">✓ 判断正确</p>
            {successText && <div className="quiz-success-body">{successText}</div>}
          </div>
        )}
        {feedback && !feedback.correct && (
          <div className="quiz-retry">
            <p className="quiz-retry-title">还没对上。看看上面的解释，再试一次。</p>
            {wrongHint && <p className="quiz-retry-hint">{wrongHint}</p>}
            <Button variant="secondary" size="sm" onClick={retry}>
              再试一次
            </Button>
          </div>
        )}
      </div>
      {!resolved && (
        <div className="quiz-actions">
          <Button onClick={submit} disabled={selected.length === 0}>
            {feedback && !feedback.correct ? '再次提交' : submitLabel}
          </Button>
          {attempts > 0 && <span className="quiz-attempts">已尝试 {attempts} 次 · 不扣分，可继续</span>}
        </div>
      )}
    </div>
  );
}
