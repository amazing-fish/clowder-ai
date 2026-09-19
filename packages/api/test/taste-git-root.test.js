// @ts-check
import assert from 'node:assert/strict';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ENV_VARS } from '../dist/config/env-registry.js';
import { FileTasteRepository, resolveTasteGitRoot } from '../dist/domains/taste/services/TasteRepository.js';
import { createVignetteWriter, deriveSlug } from '../dist/domains/taste/services/writeVignette.js';

/** @returns {import('@cat-cafe/shared').TasteProposal} */
function makeProposal(overrides = {}) {
  return {
    id: 'proposal_desktop_gitroot',
    userId: 'user-1',
    catId: 'opus',
    threadId: 'thread-1',
    scene: 'desktop Hub approve from a non-git userdata cwd',
    quote: '远端信息必须带可点击跳转链接',
    tags: ['远端链接', 'clickable'],
    dimension: 'system-philosophy',
    privacy: 'public',
    status: 'approving',
    createdAt: 1720000000000,
    ...overrides,
  };
}

describe('F221 Taste git checkout locator', () => {
  /** @type {string} */
  let gitCheckout;
  /** @type {string} */
  let originDir;
  /** @type {string} */
  let userdataCwd;
  /** @type {string | undefined} */
  let previousTasteGitRoot;
  /** @type {string | undefined} */
  let previousLocalOnly;
  /** @type {string | undefined} */
  let previousRuntimeRoot;
  /** @type {string | undefined} */
  let previousWorkspaceRoot;

  beforeEach(() => {
    previousTasteGitRoot = process.env.CAT_CAFE_TASTE_GIT_ROOT;
    previousLocalOnly = process.env.CAT_CAFE_TASTE_LOCAL_ONLY;
    delete process.env.CAT_CAFE_TASTE_LOCAL_ONLY;
    previousRuntimeRoot = process.env.CAT_CAFE_RUNTIME_ROOT;
    previousWorkspaceRoot = process.env.CAT_CAFE_WORKSPACE_ROOT;
    delete process.env.CAT_CAFE_TASTE_GIT_ROOT;
    delete process.env.CAT_CAFE_RUNTIME_ROOT;
    delete process.env.CAT_CAFE_WORKSPACE_ROOT;

    gitCheckout = join(tmpdir(), `taste-git-root-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    userdataCwd = join(tmpdir(), `taste-userdata-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    originDir = `${gitCheckout}.git`;
    mkdirSync(gitCheckout, { recursive: true });
    mkdirSync(userdataCwd, { recursive: true });
    writeFileSync(join(userdataCwd, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    execSync('git init -b main', { cwd: gitCheckout, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: gitCheckout, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: gitCheckout, stdio: 'pipe' });
    mkdirSync(join(gitCheckout, 'docs/taste'), { recursive: true });
    writeFileSync(join(gitCheckout, 'docs/taste/index.md'), '# Taste Index\n\n### 系统哲学\n', 'utf8');
    writeFileSync(join(gitCheckout, 'README.md'), 'init\n');
    execSync('git add . && git commit -m "init"', { cwd: gitCheckout, stdio: 'pipe' });
    execFileSync('git', ['init', '--bare', '--initial-branch=main', originDir], { stdio: 'pipe' });
    execFileSync('git', ['remote', 'add', 'origin', originDir], { cwd: gitCheckout, stdio: 'pipe' });
    execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: gitCheckout, stdio: 'pipe' });
  });

  afterEach(() => {
    if (previousLocalOnly === undefined) delete process.env.CAT_CAFE_TASTE_LOCAL_ONLY;
    else process.env.CAT_CAFE_TASTE_LOCAL_ONLY = previousLocalOnly;
    if (previousTasteGitRoot === undefined) delete process.env.CAT_CAFE_TASTE_GIT_ROOT;
    else process.env.CAT_CAFE_TASTE_GIT_ROOT = previousTasteGitRoot;
    if (previousRuntimeRoot === undefined) delete process.env.CAT_CAFE_RUNTIME_ROOT;
    else process.env.CAT_CAFE_RUNTIME_ROOT = previousRuntimeRoot;
    if (previousWorkspaceRoot === undefined) delete process.env.CAT_CAFE_WORKSPACE_ROOT;
    else process.env.CAT_CAFE_WORKSPACE_ROOT = previousWorkspaceRoot;
    rmSync(gitCheckout, { recursive: true, force: true });
    rmSync(userdataCwd, { recursive: true, force: true });
    rmSync(originDir, { recursive: true, force: true });
  });

  it('registers CAT_CAFE_TASTE_GIT_ROOT without treating runtime/workspace roots as the locator', () => {
    const def = ENV_VARS.find((entry) => entry.name === 'CAT_CAFE_TASTE_GIT_ROOT');
    assert.ok(def);
    assert.equal(def.hubVisible, false);
    assert.equal(def.runtimeEditable, false);
    assert.equal(
      ENV_VARS.some((entry) => entry.name === 'CAT_CAFE_RUNTIME_ROOT'),
      true,
    );
    assert.notEqual(def.name, 'CAT_CAFE_RUNTIME_ROOT');
    assert.notEqual(def.name, 'CAT_CAFE_WORKSPACE_ROOT');
  });

  it('uses CAT_CAFE_TASTE_GIT_ROOT instead of a non-git userdata cwd', () => {
    process.env.CAT_CAFE_TASTE_GIT_ROOT = gitCheckout;
    process.env.CAT_CAFE_RUNTIME_ROOT = userdataCwd;
    process.env.CAT_CAFE_WORKSPACE_ROOT = userdataCwd;

    const root = resolveTasteGitRoot(userdataCwd);
    assert.equal(root, resolve(gitCheckout));

    const repository = new FileTasteRepository(root);
    assert.equal(repository.gitCheckoutRoot(), resolve(gitCheckout));
    assert.match(repository.approvalLockKey(), /cat-cafe-taste-publication$/);
  });

  it('fails lockKey on a non-git userdata cwd when the git root env is absent', () => {
    const repository = new FileTasteRepository(resolveTasteGitRoot(userdataCwd));
    assert.throws(() => repository.approvalLockKey(), /not a git repository/);
  });

  it('publishes a public vignette from the env git root without mutating the userdata cwd', async () => {
    process.env.CAT_CAFE_TASTE_GIT_ROOT = gitCheckout;
    const repository = new FileTasteRepository(resolveTasteGitRoot(userdataCwd));
    const proposal = makeProposal();
    const result = await createVignetteWriter(repository)(proposal);
    const slug = deriveSlug(proposal);

    assert.equal(result.path, `docs/taste/vignettes/${slug}.md`);
    assert.ok(!existsSync(join(userdataCwd, result.path)));
    assert.ok(!existsSync(join(gitCheckout, result.path)), 'primary checkout must not be mutated by publication');
    assert.match(
      execFileSync('git', ['--git-dir', originDir, 'show', `main:${result.path}`], { encoding: 'utf8' }),
      /proposalId: proposal_desktop_gitroot/,
    );
  });
});
