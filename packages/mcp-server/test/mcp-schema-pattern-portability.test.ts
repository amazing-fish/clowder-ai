import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { CANONICAL_TOOL_REGISTRY } from '../src/canonical-server-tools.js';
import { normalizeMcpInputSchema } from '../src/tool-governance-snapshot.js';

/** JSON Schema carries no RegExp flags; keep emitted patterns in a portable subset. */
function assertPortablePattern(pattern: string): void {
  // Unicode parsing also rejects legacy identity escapes and malformed quantifiers.
  assert.doesNotThrow(() => new RegExp(pattern, 'u'), `Invalid pattern: ${pattern}`);
  assert.doesNotMatch(pattern, /\(\?<|\\[pP]\{|\\u\{/, `Non-portable regex extension: ${pattern}`);
  let inClass = false;
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '\\') {
      index++;
    } else if (char === '[') {
      // JS treats this as a literal; engines with nested sets require an escape.
      assert.equal(inClass, false, `Unescaped [ inside a character class: ${pattern}`);
      inClass = true;
    } else if (char === ']') {
      inClass = false;
    }
  }
}

function checkPatterns(value: unknown, path: string, failures: string[]): number {
  if (!value || typeof value !== 'object') return 0;
  let count = 0;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}/${key}`;
    if (key === 'pattern' && typeof child === 'string') {
      count++;
      try {
        assertPortablePattern(child);
      } catch (error) {
        failures.push(`${childPath}: ${(error as Error).message}`);
      }
    } else {
      count += checkPatterns(child, childPath, failures);
    }
  }
  return count;
}

describe('MCP JSON Schema pattern portability', () => {
  it('rejects nested character classes and extensions whose flags are lost', () => {
    assert.throws(() => assertPortablePattern('^[^\\s{}[\\]"\']+$'), /Unescaped \[/);
    assert.throws(() => assertPortablePattern('(?<=prefix)id'), /Non-portable/);
    assert.throws(() => assertPortablePattern('^\\p{Letter}+$'), /Non-portable/);
    assert.doesNotThrow(() => assertPortablePattern('^[^\\s{}\\[\\]"\']+$'));
  });

  it('checks every emitted canonical tool pattern, including nested branches and property names', () => {
    const failures: string[] = [];
    let count = 0;
    for (const tool of CANONICAL_TOOL_REGISTRY) {
      count += checkPatterns(normalizeMcpInputSchema(tool.inputSchema), tool.name, failures);
    }
    assert.ok(count > 0, 'The canonical registry must expose patterns to validate');
    assert.deepEqual(failures, [], failures.join('\n'));
  });

  it('keeps the committed surface snapshot patterns portable too', () => {
    const snapshot = JSON.parse(
      readFileSync(new URL('../governance/mcp-surface-baseline.json', import.meta.url), 'utf8'),
    ) as { tools: Array<{ name: string; inputSchema: unknown }> };
    const failures: string[] = [];
    let count = 0;
    for (const tool of snapshot.tools) count += checkPatterns(tool.inputSchema, tool.name, failures);
    assert.ok(count > 0);
    assert.deepEqual(failures, [], failures.join('\n'));
  });
});
