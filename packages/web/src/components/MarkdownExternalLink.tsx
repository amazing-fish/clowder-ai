import type { ReactNode } from 'react';

/** Render only usable browser destinations after Markdown URL sanitization. */
export function MarkdownExternalLink({
  href,
  children,
  className,
}: {
  href?: string;
  children: ReactNode;
  className?: string;
}) {
  if (!href?.trim()) {
    return (
      <span aria-disabled="true" title="链接不可用：地址为空或不受支持" className="text-cafe-muted break-all">
        {children}
      </span>
    );
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}
