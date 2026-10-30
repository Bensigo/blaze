import {describe,it,expect} from 'vitest';
import {scriptWorkflow} from '../src/lib/script-workflow';
import type {ContentScript,ScriptReview} from '../src/lib/content-scripts';
const script:ContentScript={id:'script',gameId:'game',ideaId:'idea',text:'Fixture script with a documented payoff.',revision:'s1',sourceRevision:'source1',reviewContextRevision:'context1',updatedAt:'2026-10-30T00:00:00Z',origin:'owner'};
const score={overall:80,hook:{score:20,explanation:'Fixture'},pacing:{score:20,explanation:'Fixture'},clarity:{score:20,explanation:'Fixture'},shareability:{score:20,explanation:'Fixture'},improvements:['Fixture improvement']};
const review:ScriptReview={id:'review',scriptId:script.id,scriptRevision:'s1',sourceRevision:'source1',reviewContextRevision:'context1',scriptText:script.text,gameId:'game',state:'complete',score,maxCostCents:1,costPolicyRevision:'fixture',maxBillableInputTokens:65536,maxCostBoundNanoUsd:2752512,approvedBy:'owner',approvedAt:'2026-10-30T00:00:00Z',expiresAt:'2026-10-30T00:15:00Z',reviewHash:'fixture',connectionId:'fixture',model:'fixture',settingsRevision:'fixture',credentialRevision:'fixture',updatedAt:'2026-10-30T00:00:00Z'};
describe('script to review to video progression',()=>{
 it('requires an authorized saved script before leaving script editing',()=>{
  expect(scriptWorkflow(null,'').saved).toBe(false);
  expect(scriptWorkflow({script},script.text).saved).toBe(true);
  expect(scriptWorkflow({script},script.text+' edit').saved).toBe(false);
  expect(scriptWorkflow({script,sourceStale:true},script.text).saved).toBe(false);
  expect(scriptWorkflow({script,contextStale:true},script.text).saved).toBe(false);
 });
 it('enables video only for a complete score bound to the exact current text, source and review context',()=>{
  expect(scriptWorkflow({script,review},script.text).currentReview).toBe(review);
  for(const state of ['approved','starting','failed','needs_reconciliation'] as const)expect(scriptWorkflow({script,review:{...review,state}},script.text).currentReview).toBeUndefined();
  for(const patch of [{scriptRevision:'s0'},{sourceRevision:'source0'},{reviewContextRevision:'context0'},{score:undefined}])expect(scriptWorkflow({script,review:{...review,...patch}},script.text).currentReview).toBeUndefined();
  expect(scriptWorkflow({script,review},script.text+' edit').currentReview).toBeUndefined();
  expect(scriptWorkflow({script,review},script.text,true).currentReview).toBeUndefined();
 });
 it('never treats a legacy unbound score or stale source as current',()=>{
  expect(scriptWorkflow({script:{...script,reviewContextRevision:undefined},review:{...review,reviewContextRevision:undefined}},script.text).currentReview).toBeUndefined();
  expect(scriptWorkflow({script,review,sourceStale:true},script.text).currentReview).toBeUndefined();
  expect(scriptWorkflow({script,review,contextStale:true},script.text).currentReview).toBeUndefined();
 });
});
