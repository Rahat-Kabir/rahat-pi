export const toolPolicy = {
  memory_write: 'local', memory_search: 'read', memory_forget: 'local',
  routine_create: 'local', routine_list: 'read', routine_pause: 'local', routine_delete: 'local',
  subagent_run: 'delegate',
  workspace_list: 'read',
  workspace_read: 'read',
  workspace_write: 'local',
  workspace_shell: 'local',
  web_fetch: 'read',
  calendar_list_events: 'read', propose_send_message: 'proposal',
} as const;
export const childToolNames = ['memory_search', 'calendar_list_events', 'web_fetch'] as const;

export function assertAllowedTool(toolName: string, isChild = false): void {
  if (isChild && !childToolNames.some(childToolName => childToolName === toolName)) {
    throw new Error(`Child tool denied: ${toolName}`);
  }
  if (!Object.hasOwn(toolPolicy, toolName)) {
    throw new Error(`Tool denied: ${toolName}`);
  }
}
