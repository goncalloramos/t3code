import type { WorkspaceAttentionItem, WorkspaceAttentionKind, WorkspaceThread } from "./model.ts";

const ATTENTION_PRIORITY: Readonly<Record<WorkspaceAttentionKind, number>> = {
  approval: 0,
  "user-input": 1,
  failed: 2,
  "plan-ready": 3,
  running: 4,
  completed: 5,
};

function attentionId(thread: WorkspaceThread, kind: WorkspaceAttentionKind): string {
  return JSON.stringify([thread.environmentId, thread.id, kind]);
}

function item(thread: WorkspaceThread, kind: WorkspaceAttentionKind): WorkspaceAttentionItem {
  return {
    id: attentionId(thread, kind),
    kind,
    environmentId: thread.environmentId,
    projectId: thread.projectId,
    threadId: thread.id,
    title: thread.title,
    occurredAt: thread.updatedAt,
    priority: ATTENTION_PRIORITY[kind],
  };
}

export function projectWorkspaceAttention(
  threads: ReadonlyArray<WorkspaceThread>,
): ReadonlyArray<WorkspaceAttentionItem> {
  const attention: WorkspaceAttentionItem[] = [];
  for (const thread of threads) {
    if (thread.hasPendingApprovals) {
      attention.push(item(thread, "approval"));
      continue;
    }
    if (thread.hasPendingUserInput) {
      attention.push(item(thread, "user-input"));
      continue;
    }
    if (thread.hasActionableProposedPlan) {
      attention.push(item(thread, "plan-ready"));
      continue;
    }
    switch (thread.agentState) {
      case "failed":
        attention.push(item(thread, "failed"));
        break;
      case "active":
        attention.push(item(thread, "running"));
        break;
      case "completed":
        attention.push(item(thread, "completed"));
        break;
      case "idle":
      case "waiting":
        break;
    }
  }
  return attention.sort(
    (left, right) =>
      left.priority - right.priority || right.occurredAt.localeCompare(left.occurredAt),
  );
}
