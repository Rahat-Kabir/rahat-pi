import { describe, expect, it } from 'vitest';
import { describeRunningTool, describeToolCall } from './toolCalls';

describe('tool call lines', () => {
  it('describes known tools in plain language', () => {
    expect(describeToolCall('memory_write', { content: 'Prefers tea', source: 'owner' }).summary).toBe('Remembered "Prefers tea"');
    expect(describeToolCall('propose_send_message', { recipient: 'fixture:owner', body: 'Hi' }).summary)
      .toBe('Drafted a message to fixture:owner (waits for your approval)');
    expect(describeToolCall('web_fetch', { url: 'https://example.com/a/page?q=1' }).summary).toBe('Read a web page (example.com)');
    expect(describeToolCall('subagent_run', { task: 'Long task text', title: 'Compare prices' }).summary).toBe('Asked a helper: "Compare prices"');
    expect(describeToolCall('workspace_list', {}).summary).toBe('Listed workspace files');
  });

  it('shortens long or multi-line arguments to one line and keeps the full arguments as details', () => {
    const command = 'echo start\n' + 'x'.repeat(200);
    const line = describeToolCall('workspace_shell', { command });
    expect(line.summary).not.toContain('\n');
    expect(line.summary.length).toBeLessThan(100);
    expect(line.summary.endsWith('…"')).toBe(true);
    expect(JSON.parse(line.details)).toEqual({ command });
  });

  it('falls back safely for unknown tools and odd arguments', () => {
    expect(describeToolCall('new_tool', { anything: 1 })).toMatchObject({ icon: '⚙️', summary: 'Used new_tool' });
    expect(describeToolCall('web_fetch', { url: 'not a url' }).summary).toBe('Read a web page (not a url)');
    expect(describeToolCall('memory_search', null).summary).toBe('Searched memory for ""');
    expect(describeToolCall('memory_write', { content: '<img src=x onerror=alert(1)>' }).summary).toBe('Remembered "<img src=x onerror=alert(1)>"');
  });

  it('describes running tools without arguments', () => {
    expect(describeRunningTool('memory_search')).toBe('🔍 Searching memory…');
    expect(describeRunningTool('new_tool')).toBe('⚙️ Using new_tool…');
  });
});
