import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, decideAction, describeError, sendMessage } from './client';

function respondWith(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API client', () => {
  it('sends the token header and JSON body', async () => {
    const fetchMock = respondWith(202, { submissionId: 7 });
    const result = await sendMessage('secret-token', { message: 'hello', whenBusy: 'followUp', requestId: 'request-1' });
    expect(result).toEqual({ submissionId: 7 });
    expect(fetchMock).toHaveBeenCalledWith('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Rahat-Token': 'secret-token' },
      body: JSON.stringify({ message: 'hello', whenBusy: 'followUp', requestId: 'request-1' }),
    });
  });

  it('sends the exact hash the owner saw with a decision', async () => {
    const fetchMock = respondWith(200, { id: 'action-1', status: 'approved' });
    await decideAction('secret-token', { decision: 'approve', id: 'action-1', payloadHash: 'hash-1' });
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/actions');
    expect(JSON.parse(init.body as string)).toEqual({ decision: 'approve', id: 'action-1', payloadHash: 'hash-1' });
  });

  it('turns brain errors into readable messages', async () => {
    respondWith(409, { error: 'Payload changed after it was shown' });
    const conflict = await decideAction('token', { decision: 'approve', id: 'a', payloadHash: 'h' }).catch(error => error);
    expect(conflict).toBeInstanceOf(ApiRequestError);
    expect(describeError(conflict)).toBe('The brain refused this: Payload changed after it was shown');

    respondWith(403, { error: 'Invalid web token' });
    const forbidden = await sendMessage('old-token', { message: 'hi' }).catch(error => error);
    expect(describeError(forbidden)).toContain('data/web-token');
  });

  it('reports a failure even when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad gateway', { status: 502 })));
    const failure = await sendMessage('token', { message: 'hi' }).catch(error => error);
    expect(describeError(failure)).toBe('Request failed (502)');
  });
});
