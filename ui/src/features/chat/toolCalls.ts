// Plain-language lines for the agent's tool calls. Arguments come from the model,
// so they are only ever shown as text.

export type ToolCallLine = {
  icon: string;
  summary: string;
  // The raw arguments, for the "details" toggle.
  details: string;
};

type ToolArguments = Record<string, unknown>;
type ToolDescription = {
  icon: string;
  // Shown while the tool runs; the live state carries no arguments.
  running: string;
  done: (toolArguments: ToolArguments) => string;
};

const maximumShownLength = 80;

function shorten(text: string) {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > maximumShownLength ? `${singleLine.slice(0, maximumShownLength - 1)}…` : singleLine;
}
function asText(value: unknown) {
  return shorten(typeof value === 'string' ? value : JSON.stringify(value) ?? '');
}
function quoted(value: unknown) {
  return `"${asText(value)}"`;
}
function hostOf(url: unknown) {
  try {
    return new URL(String(url)).host;
  } catch {
    return asText(url);
  }
}

const toolDescriptions: Record<string, ToolDescription> = {
  memory_write: { icon: '🧠', running: 'Remembering', done: toolArguments => `Remembered ${quoted(toolArguments.content)}` },
  memory_search: { icon: '🔍', running: 'Searching memory', done: toolArguments => `Searched memory for ${quoted(toolArguments.query)}` },
  memory_forget: { icon: '🧹', running: 'Forgetting a memory', done: () => 'Forgot a memory' },
  propose_send_message: {
    icon: '✉️', running: 'Drafting a message',
    done: toolArguments => `Drafted a message to ${asText(toolArguments.recipient)} (waits for your approval)`,
  },
  action_status: { icon: '📋', running: 'Checking message status', done: () => 'Checked message status' },
  calendar_list_events: { icon: '📅', running: 'Checking the calendar', done: () => 'Checked the calendar' },
  routine_create: {
    icon: '⏰', running: 'Creating a routine',
    done: toolArguments => `Created routine ${quoted(toolArguments.name)} at ${asText(toolArguments.time)}`,
  },
  routine_list: { icon: '⏰', running: 'Listing routines', done: () => 'Listed routines' },
  subagent_run: {
    icon: '🤝', running: 'Asking a helper',
    done: toolArguments => `Asked a helper: ${quoted(toolArguments.title ?? toolArguments.task)}`,
  },
  web_fetch: { icon: '🌐', running: 'Reading a web page', done: toolArguments => `Read a web page (${hostOf(toolArguments.url)})` },
  workspace_list: {
    icon: '📁', running: 'Listing files',
    done: toolArguments => toolArguments.path ? `Listed files in ${asText(toolArguments.path)}` : 'Listed workspace files',
  },
  workspace_read: { icon: '📄', running: 'Reading a file', done: toolArguments => `Read ${asText(toolArguments.path)}` },
  workspace_write: { icon: '📝', running: 'Writing a file', done: toolArguments => `Wrote ${asText(toolArguments.path)}` },
  workspace_shell: { icon: '💻', running: 'Running a command', done: toolArguments => `Ran ${quoted(toolArguments.command)}` },
};

function isToolArguments(value: unknown): value is ToolArguments {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function describeToolCall(name: string, toolArguments: unknown): ToolCallLine {
  const description = toolDescriptions[name];
  const knownArguments = isToolArguments(toolArguments) ? toolArguments : {};
  return {
    icon: description?.icon ?? '⚙️',
    summary: description ? description.done(knownArguments) : `Used ${name}`,
    details: JSON.stringify(toolArguments, null, 2) ?? '',
  };
}

export function describeRunningTool(name: string) {
  const description = toolDescriptions[name];
  return description ? `${description.icon} ${description.running}…` : `⚙️ Using ${name}…`;
}
