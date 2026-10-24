import {
  fauxProvider, fauxAssistantMessage, fauxToolCall, type FauxResponseFactory,
} from '@earendil-works/pi-ai/providers/faux';

// Offline demo and test model; no network or cost. A user message can script tool calls:
//   /tool <name> <json arguments>          one tool call
//   /tools [{"name": ..., "arguments": ...}] several tool calls in one turn
// Anything else gets "Offline reply: <message>"; a tool result is echoed back as the reply.
export function createOfflineFauxProvider() {
  const fauxModelProvider = fauxProvider({
    tokensPerSecond: Infinity,
    models: [{ id: 'faux-1', cost: { input: 3, output: 15, cacheRead: 3, cacheWrite: 3 } }],
  });
  const createFauxResponse: FauxResponseFactory = transcript => {
    // Queue the next response first, so the faux provider never runs out.
    fauxModelProvider.appendResponses([createFauxResponse]);
    const firstMessage = transcript.messages[0];
    if (firstMessage?.role === 'system' && String(firstMessage.content).includes('context summarization assistant')) {
      const summaryContent = transcript.messages[1]?.content;
      const summaryRequest = typeof summaryContent === 'string'
        ? summaryContent
        : summaryContent?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';
      const summarySource = summaryRequest.split('<conversation>')[1]?.split('</conversation>')[0] ?? summaryRequest;
      return fauxAssistantMessage(`## Critical Context\n${summarySource}`);
    }
    const lastMessage = transcript.messages.findLast(message => message.role !== 'system');
    if (lastMessage?.role === 'toolResult') {
      return fauxAssistantMessage(JSON.stringify(lastMessage.content));
    }
    const messageContent = lastMessage?.role === 'user' ? lastMessage.content : '';
    const messageText = typeof messageContent === 'string' ? messageContent : JSON.stringify(messageContent);
    if (messageText.startsWith('/tools ')) {
      const toolCalls = JSON.parse(messageText.slice(7)) as {
        name: string;
        arguments: Parameters<typeof fauxToolCall>[1];
      }[];
      return fauxAssistantMessage(
        toolCalls.map(toolCall => fauxToolCall(toolCall.name, toolCall.arguments)),
        { stopReason: 'toolUse' },
      );
    }
    const toolMatch = /^\/tool (\w+) (\{.*\})$/s.exec(messageText);
    if (toolMatch) {
      return fauxAssistantMessage(fauxToolCall(toolMatch[1], JSON.parse(toolMatch[2])), { stopReason: 'toolUse' });
    }
    return fauxAssistantMessage(`Offline reply: ${messageText}`);
  };
  fauxModelProvider.setResponses([createFauxResponse]);
  return fauxModelProvider;
}
