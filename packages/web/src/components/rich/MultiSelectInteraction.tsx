'use client';

import { useState } from 'react';
import { useIMEGuard } from '@/hooks/useIMEGuard';
import type { InteractiveOption } from '@/stores/chat-types';
import { OptionIcon } from './InteractiveOptionIcon';

/**
 * Multi-select with customInput support: when a checked option has
 * `customInput: true`, a text box appears and its text is reported via
 * `onCustomText`. Submit stays disabled until that text is non-empty.
 */
export function MultiSelectInteraction({
  options,
  disabled,
  selectedIds,
  maxSelect,
  onSelect,
  hideSubmit,
  onCustomText,
}: {
  options: InteractiveOption[];
  disabled: boolean;
  selectedIds: string[];
  maxSelect?: number;
  onSelect: (ids: string[]) => void;
  hideSubmit?: boolean;
  onCustomText?: (text: string) => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set(selectedIds));
  const [customText, setCustomText] = useState('');
  const ime = useIMEGuard();
  const customOpt = options.find((o) => o.customInput && checked.has(o.id));
  const showCustomInput = !disabled && Boolean(customOpt);
  const submitBlocked = showCustomInput && !customText.trim();

  const toggle = (id: string) => {
    if (disabled) return;
    const next = new Set(checked);
    if (next.has(id)) {
      next.delete(id);
    } else if (!maxSelect || next.size < maxSelect) {
      next.add(id);
    }
    // Unchecking the customInput option drops its text so it can't leak into the message
    const stillCustom = options.some((o) => o.customInput && next.has(o.id));
    if (!stillCustom && customText) {
      setCustomText('');
      if (onCustomText) onCustomText('');
    }
    setChecked(next);
    // In group mode, notify parent of every change
    if (hideSubmit) onSelect([...next]);
  };

  const handleSubmit = () => {
    if (checked.size === 0 || submitBlocked) return;
    if (onCustomText) onCustomText(showCustomInput ? customText : '');
    onSelect([...checked]);
  };

  return (
    <div className="space-y-2">
      {options.map((opt) => {
        const isChecked = checked.has(opt.id);
        return (
          <button
            key={opt.id}
            type="button"
            disabled={disabled}
            aria-pressed={isChecked}
            onClick={() => toggle(opt.id)}
            className={`flex items-center gap-2.5 w-full px-4 py-3 rounded-xl border-[1.5px] text-sm transition-all text-left
              ${isChecked ? 'border-conn-amber-ring bg-conn-amber-bg ' : 'border-cafe hover:border-conn-amber-ring'}
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span
              className={`shrink-0 w-5 h-5 rounded-md flex items-center justify-center transition-colors ${
                isChecked ? 'bg-[var(--semantic-warning)]' : 'border-[1.5px] border-cafe'
              }`}
            >
              {isChecked && (
                <svg
                  className="w-3.5 h-3.5 text-[var(--cafe-surface)]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </span>
            <OptionIcon opt={opt} />
            <span className={`font-semibold ${isChecked ? 'text-conn-amber-text' : ''}`}>{opt.label}</span>
          </button>
        );
      })}
      {showCustomInput && (
        <div className="mt-1">
          <input
            type="text"
            aria-label={customOpt?.label}
            value={customText}
            onChange={(e) => {
              setCustomText(e.target.value);
              if (onCustomText) onCustomText(e.target.value);
            }}
            onCompositionStart={ime.onCompositionStart}
            onCompositionEnd={ime.onCompositionEnd}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !ime.isComposing() && !hideSubmit) handleSubmit();
            }}
            placeholder={customOpt?.customInputPlaceholder ?? '输入你的想法...'}
            className="w-full px-4 py-2.5 rounded-xl border-[1.5px] border-conn-amber-ring bg-cafe-surface text-sm focus:outline-none focus:border-conn-amber-ring focus:ring-1 focus:ring-conn-amber-ring/30 placeholder:text-cafe-muted"
          />
        </div>
      )}
      {!disabled && !hideSubmit && checked.size > 0 && (
        <button
          type="button"
          disabled={submitBlocked}
          onClick={handleSubmit}
          className={`mt-2 w-full py-2.5 rounded-full text-sm font-semibold transition-colors flex items-center justify-center gap-1.5
            ${
              submitBlocked
                ? 'bg-cafe-surface-elevated text-cafe-muted cursor-not-allowed'
                : 'bg-[var(--semantic-warning)] text-[var(--cafe-surface)] hover:opacity-90'
            }`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          确认选择 ({checked.size})
        </button>
      )}
    </div>
  );
}
