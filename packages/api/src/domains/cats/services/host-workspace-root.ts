import { resolve } from 'node:path';
import { validateProjectPath } from '../../../utils/project-path.js';

export type HostWorkspaceRootResolution = { ok: true; projectPath: string } | { ok: false; error: string };

export function resolveDefaultHostWorkspaceRoot(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string | null {
  const workspaceRoot = env.CAT_CAFE_WORKSPACE_ROOT?.trim();
  if (workspaceRoot) return workspaceRoot;

  // Runtime worktree mode must export CAT_CAFE_WORKSPACE_ROOT. Falling back to
  // process.cwd() here would bind system-thread work to cat-cafe-runtime.
  if (env.CAT_CAFE_RUNTIME_ROOT?.trim()) {
    return null;
  }

  return cwd;
}

export async function resolveHostWorkspaceRoot(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): Promise<HostWorkspaceRootResolution> {
  const hostWorkspaceRoot = resolveDefaultHostWorkspaceRoot(env, cwd);
  if (!hostWorkspaceRoot) {
    return {
      ok: false,
      error: 'Host workspace root is not configured; refusing to use runtime cwd',
    };
  }

  const validated = await validateProjectPath(hostWorkspaceRoot);
  if (!validated) {
    return {
      ok: false,
      error: `Host workspace root is invalid: ${resolve(hostWorkspaceRoot)}`,
    };
  }

  return { ok: true, projectPath: validated };
}
