import type { Harness } from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import { AppDoc } from '../harness/state.js';
import { canExecute } from './actions.js';
import { FakeSender } from './fake-sender.js';
import { crashAt } from '../config.js';

export class Executor {
  constructor(
    private harness: Harness,
    private sender: FakeSender,
    private now: () => number,
    private shouldStop: () => boolean = () => false,
  ) {}
  async recover() {
    await this.harness.commit(async transaction => {
      const state = await transaction.doc(AppDoc);
      for (const action of Object.values(state.actions)) {
        if (action.status === 'executing') {
          action.status = 'unknown';
          action.error = 'Process stopped during dispatch; reconciliation required';
        }
      }
    }, context);
  }
  async reconcile() {
    const state = await this.harness.snapshot(AppDoc, context);
    for (const action of Object.values(state?.actions ?? {})) {
      if (action.status !== 'unknown') {
        continue;
      }
      const receipt = this.sender.lookup(action.id);
      if (receipt) {
        await this.harness.commit(async transaction => {
          const currentAction = (await transaction.doc(AppDoc)).actions[action.id];
          if (currentAction.status === 'unknown') {
            currentAction.status = 'succeeded';
            currentAction.providerReceipt = receipt;
            currentAction.error = null;
          }
        }, context);
      }
      // No receipt cannot prove dispatch failed; resending could duplicate an external write.
    }
  }
  async tick() {
    if (this.shouldStop()) {
      return;
    }
    await this.reconcile();
    const state = await this.harness.snapshot(AppDoc, context);
    for (const candidateAction of Object.values(state?.actions ?? {})) {
      if (this.shouldStop()) {
        return;
      }
      if (candidateAction.status !== 'approved') {
        continue;
      }
      const claimedAction = await this.harness.commit(async transaction => {
        const action = (await transaction.doc(AppDoc)).actions[candidateAction.id];
        if (action.status !== 'approved') {
          return null;
        }
        if (!canExecute(action, this.now())) {
          action.status = 'failed';
          action.error = 'Approval expired or payload hash changed';
          return null;
        }
        action.status = 'executing';
        return { id: action.id, payload: JSON.parse(JSON.stringify(action.payload)) };
      }, context);
      if (!claimedAction) {
        continue;
      }
      // Recovery must retain uncertainty if the process dies before a provider receipt.
      crashAt('action_executing');
      if (this.shouldStop()) {
        await this.harness.commit(async transaction => {
          (await transaction.doc(AppDoc)).actions[claimedAction.id].status = 'approved';
        }, context);
        return;
      }
      // Any exception after entering the provider is ambiguous. Retain uncertainty for reconciliation.
      let receipt: string;
      try {
        receipt = this.sender.send(claimedAction.id, claimedAction.payload);
      } catch (error) {
        await this.harness.commit(async transaction => {
          const action = (await transaction.doc(AppDoc)).actions[claimedAction.id];
          action.status = 'unknown';
          action.error = error instanceof Error ? error.message : String(error);
        }, context);
        continue;
      }
      crashAt('after_dispatch');
      await this.harness.commit(async transaction => {
        const action = (await transaction.doc(AppDoc)).actions[claimedAction.id];
        action.status = 'succeeded';
        action.providerReceipt = receipt;
        action.error = null;
      }, context);
    }
  }
}
