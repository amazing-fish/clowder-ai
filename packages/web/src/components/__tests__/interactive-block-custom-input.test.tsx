/**
 * F096: InteractiveBlock customInput integration test
 *
 * Regression: selecting a customInput option and typing text would lose
 * the text due to React state/closure timing — onCustomText (setState)
 * hadn't re-rendered before onSelect fired, so handleSelect read stale ''.
 *
 * Fix: use useRef to mirror customText, read ref in handleSelect.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { InteractiveBlock } from '@/components/rich/InteractiveBlock';
import type { RichInteractiveBlock } from '@/stores/chat-types';

beforeAll(() => {
  (globalThis as Record<string, unknown>).React = React;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  delete (globalThis as Record<string, unknown>).React;
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

// Mock chatStore
vi.mock('@/stores/chatStore', () => ({
  useChatStore: { getState: () => ({ updateRichBlock: vi.fn() }) },
}));

// Mock api-client
vi.mock('@/utils/api-client', () => ({
  apiFetch: vi.fn().mockResolvedValue({ ok: true }),
}));

// Mock userId
vi.mock('@/utils/userId', () => ({
  getUserId: () => 'test-user',
}));

describe('InteractiveBlock customInput integration', () => {
  let container: HTMLDivElement;
  let root: Root;
  let dispatched: string | null = null;

  const handler = (e: Event) => {
    dispatched = (e as CustomEvent<{ text: string }>).detail.text;
  };

  beforeEach(() => {
    dispatched = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    window.addEventListener('cat-cafe:interactive-send', handler);
  });

  afterEach(() => {
    window.removeEventListener('cat-cafe:interactive-send', handler);
    act(() => root.unmount());
    container.remove();
  });

  it('dispatches custom text when customInput option is selected and submitted', () => {
    const block: RichInteractiveBlock = {
      id: 'test-block',
      kind: 'interactive',
      v: 1,
      interactiveType: 'select',
      title: '测试问题',
      options: [
        { id: 'opt-a', label: '选项 A' },
        { id: 'opt-other', label: '我有其他反馈', customInput: true, customInputPlaceholder: '输入反馈...' },
      ],
    };

    act(() => {
      root.render(React.createElement(InteractiveBlock, { block, messageId: 'msg-1' }));
    });

    // 1. Click the customInput option
    const optionBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('我有其他反馈'),
    );
    expect(optionBtn).toBeTruthy();
    act(() => optionBtn!.click());

    // 2. Type custom text into the input
    const input = container.querySelector('input[placeholder="输入反馈..."]') as HTMLInputElement;
    expect(input).toBeTruthy();
    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      nativeInputValueSetter.call(input, '这里有个 bug 需要修');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // 3. Click submit
    const submitBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('确认选择'));
    expect(submitBtn).toBeTruthy();
    act(() => submitBtn!.click());

    // 4. Verify the dispatched message includes the custom text
    expect(dispatched).toBe('我有其他反馈：这里有个 bug 需要修（测试问题）');
  });

  it('dispatches custom text when submitted via Enter key', () => {
    const block: RichInteractiveBlock = {
      id: 'test-block-2',
      kind: 'interactive',
      v: 1,
      interactiveType: 'select',
      options: [{ id: 'opt-other', label: '其他', customInput: true }],
    };

    act(() => {
      root.render(React.createElement(InteractiveBlock, { block, messageId: 'msg-2' }));
    });

    // 1. Click the customInput option
    const optionBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('其他'));
    act(() => optionBtn!.click());

    // 2. Type and submit via Enter
    const input = container.querySelector('input') as HTMLInputElement;
    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      nativeInputValueSetter.call(input, '用 ref 修闭包');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    // 3. Verify
    expect(dispatched).toBe('其他：用 ref 修闭包');
  });

  it('multi-select: checking a customInput option shows an input and sends its text', () => {
    const block: RichInteractiveBlock = {
      id: 'test-block-ms',
      kind: 'interactive',
      v: 1,
      interactiveType: 'multi-select',
      messageTemplate: '处理这些：{selection}',
      options: [
        { id: 'fix', label: '修报错' },
        { id: 'other', label: '其他想法', customInput: true, customInputPlaceholder: '说说你的想法' },
      ],
    };

    act(() => {
      root.render(React.createElement(InteractiveBlock, { block, messageId: 'msg-ms' }));
    });

    const clickOption = (label: string) => {
      const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes(label));
      act(() => btn!.click());
    };
    const submitBtn = () =>
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('确认选择')) as
        | HTMLButtonElement
        | undefined;

    clickOption('修报错');
    expect(container.querySelector('input')).toBeNull();

    clickOption('其他想法');
    const input = container.querySelector('input[placeholder="说说你的想法"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(submitBtn()?.disabled).toBe(true);

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '给晨晨写能力边界');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(submitBtn()?.disabled).toBe(false);

    act(() => submitBtn()!.click());
    expect(dispatched).toBe('处理这些：修报错, 其他想法：给晨晨写能力边界');
  });

  it('multi-select: unchecking the customInput option hides the input and drops its text', () => {
    const block: RichInteractiveBlock = {
      id: 'test-block-ms-2',
      kind: 'interactive',
      v: 1,
      interactiveType: 'multi-select',
      options: [
        { id: 'a', label: '方案 A' },
        { id: 'other', label: '其他', customInput: true },
      ],
    };

    act(() => {
      root.render(React.createElement(InteractiveBlock, { block, messageId: 'msg-ms-2' }));
    });

    const clickOption = (label: string) => {
      const btn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.startsWith(label));
      act(() => btn!.click());
    };

    clickOption('方案 A');
    clickOption('其他');
    const input = container.querySelector('input') as HTMLInputElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '不该出现');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    clickOption('其他');
    expect(container.querySelector('input')).toBeNull();

    const submit = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('确认选择'));
    act(() => submit!.click());
    expect(dispatched).toBe('我选了：方案 A');
  });

  it('dispatches default message when no custom text is entered (normal option)', () => {
    const block: RichInteractiveBlock = {
      id: 'test-block-3',
      kind: 'interactive',
      v: 1,
      interactiveType: 'select',
      title: '选择',
      options: [
        { id: 'opt-a', label: '方案 A' },
        { id: 'opt-b', label: '方案 B' },
      ],
    };

    act(() => {
      root.render(React.createElement(InteractiveBlock, { block, messageId: 'msg-3' }));
    });

    const optionBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('方案 A'));
    act(() => optionBtn!.click());

    const submitBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('确认选择'));
    act(() => submitBtn!.click());

    expect(dispatched).toBe('我选了：方案 A（选择）');
  });
});
