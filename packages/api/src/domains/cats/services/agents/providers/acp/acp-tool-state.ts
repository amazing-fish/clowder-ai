/** ACP final status is shared by result projection and watchdog bookkeeping. */
export function isFinalAcpToolStatus(status: unknown): status is 'completed' | 'failed' {
  return status === 'completed' || status === 'failed';
}

/** Prompt-local wait state; unrelated output must not settle identified work. */
export class AcpToolWaitState {
  private readonly pendingTools = new Set<string>();
  private readonly finalTools = new Set<string>();
  private readonly pendingPermissions = new Set<string>();
  private anonymousTool = false;

  get pending(): boolean {
    return this.anonymousTool || this.pendingTools.size > 0 || this.pendingPermissions.size > 0;
  }

  observe(update: Record<string, unknown>): void {
    const kind = update.sessionUpdate;
    if (kind === 'permission_pending' || kind === 'permission_resolved') {
      const id = update.permissionRequestId;
      if (typeof id === 'string') {
        if (kind === 'permission_pending') this.pendingPermissions.add(id);
        else this.pendingPermissions.delete(id);
      }
      return;
    }
    if (kind === 'agent_message_chunk') {
      // Legacy agents without IDs infer completion from resumed assistant text.
      this.anonymousTool = false;
      return;
    }
    if (kind !== 'tool_call' && kind !== 'tool_call_update') return;
    const id = update.toolCallId;
    const final = isFinalAcpToolStatus(update.status);
    if (typeof id !== 'string' || !id) {
      this.anonymousTool = !final;
      return;
    }
    if (final) {
      this.pendingTools.delete(id);
      this.finalTools.add(id);
    } else if (!this.finalTools.has(id)) {
      this.pendingTools.add(id);
    }
  }
}
