import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, checkSignedIn, decideAction, describeError, sendMessage, signIn } from './client';

function respondWith(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API client', () => {
  it('sends the JSON body and leaves the sign-in to the browser cookie', async () => {
    const fetchMock = respondWith(202, { submissionId: 7 });
    const result = await sendMessage({ message: 'hello', whenBusy: 'followUp', requestId: 'request-1' });
    expect(result).toEqual({ submissionId: 7 });
    expect(fetchMock).toHaveBeenCalledWith('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello', whenBusy: 'followUp', requestId: 'request-1' }),
    });
  });

  it('signs in with the token once and checks the session after', async () => {
    const fetchMock = respondWith(200, { signedIn: true });
    expect(await signIn({ token: 'secret-token' })).toEqual({ signedIn: true });
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/session');
    expect(JSON.parse(init.body as string)).toEqual({ token: 'secret-token' });

    respondWith(200, { signedIn: true });
    expect(await checkSignedIn()).toBe(true);
    respondWith(401, { error: 'Sign in required' });
    expect(await checkSignedIn()).toBe(false);
    respondWith(500, { error: 'Broken' });
    await expect(checkSignedIn()).rejects.toBeInstanceOf(ApiRequestError);
  });

  it('sends the exact hash the owner saw with a decision', async () => {
    const fetchMock = respondWith(200, { id: 'action-1', status: 'approved' });
    await decideAction({ decision: 'approve', id: 'action-1', payloadHash: 'hash-1' });
    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/actions');
    expect(JSON.parse(init.body as string)).toEqual({ decision: 'approve', id: 'action-1', payloadHash: 'hash-1' });
  });

  it('turns brain errors into readable messages', async () => {
    respondWith(409, { error: 'Payload changed after it was shown' });
    const conflict = await decideAction({ decision: 'approve', id: 'a', payloadHash: 'h' }).catch(error => error);
    expect(conflict).toBeInstanceOf(ApiRequestError);
    expect(describeError(conflict)).toBe('The brain refused this: Payload changed after it was shown');

    respondWith(401, { error: 'Sign in required' });
    const signedOut = await sendMessage({ message: 'hi' }).catch(error => error);
    expect(describeError(signedOut)).toContain('signed out');
  });

  it('reports a failure even when the body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Bad gateway', { status: 502 })));
    const failure = await sendMessage({ message: 'hi' }).catch(error => error);
    expect(describeError(failure)).toBe('Request failed (502)');
  });
});
