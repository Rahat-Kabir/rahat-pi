import { createHash } from 'node:crypto';
import type { Action, SendPayload } from '../harness/state.js';

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const payloadRecord = value as Record<string, unknown>;
    return `{${Object.keys(payloadRecord).sort().map(propertyName =>
      `${JSON.stringify(propertyName)}:${canonicalJson(payloadRecord[propertyName])}`
    ).join(',')}}`;
  }
  throw new Error('Payload must be finite JSON');
}
export function payloadHash(payload: SendPayload): string {
  return createHash('sha256').update(canonicalJson({ kind: 'send_message', payload })).digest('hex');
}
export function validatePayload(payload: SendPayload) {
  if (typeof payload.recipient !== 'string' || !payload.recipient.trim() || typeof payload.body !== 'string' || !payload.body.trim()) {
    throw new Error('Recipient and body are required');
  }
  if (Object.keys(payload).sort().join(',') !== 'body,recipient') {
    throw new Error('Unexpected send payload fields');
  }
}
export function proposeAction(actionId: string, payload: SendPayload, now: number): Action {
  validatePayload(payload);
  return {
    id: actionId,
    kind: 'send_message',
    payload: { ...payload },
    payloadHash: payloadHash(payload),
    status: 'proposed',
    expiresAt: now + 86400000,
    approvedHash: null,
    approvedAt: null,
    approvedBy: null,
    providerReceipt: null,
    error: null,
  };
}
export function approveAction(action: Action, now: number, approvedBy: string) {
  if (action.status === 'approved' && action.approvedHash === payloadHash(action.payload) && now < action.expiresAt) {
    return;
  }
  if (action.status !== 'proposed') {
    throw new Error('Only a proposed action can be approved');
  }
  if (now >= action.expiresAt) {
    throw new Error('Proposal expired; create a fresh proposal');
  }
  validatePayload(action.payload);
  if (payloadHash(action.payload) !== action.payloadHash) {
    throw new Error('Payload changed; edit and approve again');
  }
  action.status = 'approved';
  action.approvedHash = action.payloadHash;
  action.approvedAt = now;
  action.approvedBy = approvedBy;
}
export function editAction(action: Action, payload: SendPayload, now: number) {
  if (!['proposed', 'approved'].includes(action.status)) {
    throw new Error('Action cannot be edited after execution or rejection');
  }
  Object.assign(action, proposeAction(action.id, payload, now));
}
export function canExecute(action: Action, now: number): boolean {
  return action.status === 'approved'
    && now < action.expiresAt
    && action.approvedHash === action.payloadHash
    && payloadHash(action.payload) === action.payloadHash;
}
