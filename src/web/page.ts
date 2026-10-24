import { formatStats } from '../harness/stats.js';
import type { WebState } from './state.js';

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}
function renderContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(block => {
      if (block.type === 'text') {
        return block.text;
      }
      if (block.type === 'toolCall') {
        return `Tool: ${block.name} ${JSON.stringify(block.arguments, null, 2)}`;
      }
      return JSON.stringify(block, null, 2);
    }).join('\n');
  }
  return JSON.stringify(content, null, 2);
}
function renderMessage(message: { role: string; content: unknown }) {
  return `<article><strong>${escapeHtml(message.role)}</strong><pre>${escapeHtml(renderContent(message.content))}</pre></article>`;
}
export function renderState(state: WebState) {
  const transcript = state.entries.flatMap(entry => entry.model.map(renderMessage)).join('');
  const liveMessage = state.live.generation?.message;
  const liveAssistant = liveMessage ? renderMessage(liveMessage) : '';
  const liveTools = (state.live.tools ?? []).map(tool => `<article><strong>Tool: ${escapeHtml(tool.name)} · ${escapeHtml(tool.status)}</strong>
    <pre>${escapeHtml(tool.output ?? '')}</pre></article>`).join('');
  const queuedMessages = state.inbox.items.map(item => `<article><strong>${escapeHtml(item.mode)}</strong>
    <pre>${escapeHtml('content' in item ? renderContent(item.content) : 'Pending write')}</pre></article>`).join('');
  const runStatus = state.live.run ? 'Working…' : 'Idle';
  const runFailure = state.live.compactionFailure?.error ?? liveMessage?.errorMessage;
  const actions = state.actions.map(action => `<article>
    <strong>Action ${escapeHtml(action.id)} · ${escapeHtml(action.status)}</strong>
    <dl><dt>Recipient</dt><dd><pre>${escapeHtml(action.payload.recipient)}</pre></dd>
    <dt>Body</dt><dd><pre>${escapeHtml(action.payload.body)}</pre></dd>
    <dt>payloadHash</dt><dd><code>${escapeHtml(action.payloadHash)}</code></dd>
    <dt>expiresAt</dt><dd>${escapeHtml(new Date(action.expiresAt).toISOString())}</dd></dl>
    <pre>${escapeHtml(JSON.stringify({ receipt: action.providerReceipt, error: action.error }, null, 2))}</pre>
    ${['proposed', 'approved'].includes(action.status) ? `<button data-decision="approve" data-action-id="${escapeHtml(action.id)}" data-hash="${escapeHtml(action.payloadHash)}">Approve exact payload</button>
    <button data-decision="reject" data-action-id="${escapeHtml(action.id)}" data-hash="${escapeHtml(action.payloadHash)}">Reject</button>` : ''}
    </article>`).join('');
  return `<section aria-label="Conversation"><h2>Main conversation</h2>${transcript || '<p>No messages yet.</p>'}
    <h3>Live assistant and tools</h3><p>${runStatus}</p>${liveAssistant}${liveTools}
    ${runFailure ? `<p>${escapeHtml(runFailure)}</p>` : ''}
    <h3>Queued messages</h3>${queuedMessages || '<p>No queued messages.</p>'}</section>
    <aside><section><h2>Stats</h2><pre>${escapeHtml(formatStats(state.stats))}</pre></section><section><h2>Approvals</h2>${actions || '<p>No actions.</p>'}</section>
    <section><h2>Subagents</h2>${state.subagents.map(subagent => `<article><strong>${escapeHtml(subagent.title)} · ${escapeHtml(subagent.status)}</strong>
    <p>Conversation ${escapeHtml(subagent.conversationId)}</p><pre>${escapeHtml(subagent.answer ?? 'Waiting for answer')}</pre></article>`).join('') || '<p>No subagents.</p>'}</section></aside>`;
}
export function renderPage(state: WebState, snapshot = false) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rahat-PI</title><style>
:root { color-scheme: light dark; font: 16px system-ui, sans-serif; }
body { margin: 0 auto; max-width: 1280px; padding: 24px; }
header, form { margin-bottom: 24px; } h1 { margin-bottom: 8px; }
main { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: 24px; }
section, article { min-width: 0; } article { border: 1px solid #8886; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 14px ui-monospace, monospace; }
code, dd { overflow-wrap: anywhere; } dd { margin: 4px 0 12px; } dt { font-weight: bold; }
textarea { display: block; box-sizing: border-box; width: 100%; min-height: 90px; margin: 8px 0; }
button, input, select, textarea { font: inherit; padding: 8px; } button { cursor: pointer; margin: 4px; }
#feedback { white-space: pre-wrap; } @media (max-width: 760px) { main { grid-template-columns: 1fr; } }
</style>${snapshot ? '' : '<script src="/client.js" defer></script>'}</head>
<body><header><h1>Rahat-PI</h1><p>Personal durable agent · local owner interface</p>
<p id="connection" role="status">${snapshot ? 'Static snapshot' : 'Connecting…'}</p></header>
${snapshot ? '' : `<form id="message-form"><label>Web token <input id="token" type="password" autocomplete="off" placeholder="Paste token from data/web-token" required></label>
<label for="message">Message</label><textarea id="message" required maxlength="16000"></textarea>
<label>While busy <select id="when-busy"><option value="followUp">Follow-up after current answer</option><option value="steer">Steer at next boundary</option></select></label>
<button type="submit">Send message</button></form><p id="feedback" role="status"></p>`}
<main id="state">${renderState(state)}</main></body></html>`;
}
