'use client';

import type { InteractiveOption } from '@/stores/chat-types';
import { CafeIcon } from './CafeIcons';

/** Render option icon: prefer SVG icon over emoji */
export function OptionIcon({ opt, className = 'w-5 h-5' }: { opt: InteractiveOption; className?: string }) {
  if (opt.icon) return <CafeIcon name={opt.icon} className={`${className} text-conn-amber-text shrink-0`} />;
  if (opt.emoji) return <span className="text-base shrink-0 leading-none">{opt.emoji}</span>;
  return null;
}
