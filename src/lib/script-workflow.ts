import type {ContentScript, ScriptReview} from './content-scripts';

type ScriptState = {
  script?: ContentScript;
  review?: ScriptReview;
  sourceStale?: boolean;
  contextStale?: boolean;
};

/** UI progression only. Server approval/dispatch rechecks all bindings independently. */
export function scriptWorkflow(state: ScriptState | null, text: string, busy = false) {
  const script = state?.script;
  const dirty = text !== (script?.text || '');
  const saved = !!script && !dirty && !busy && !state?.sourceStale && !state?.contextStale;
  const review = state?.review;
  const currentReview = saved && review?.state === 'complete' && review.score &&
    review.scriptRevision === script.revision && review.sourceRevision === script.sourceRevision &&
    !!script.reviewContextRevision && review.reviewContextRevision === script.reviewContextRevision ? review : undefined;
  return {dirty, saved, currentReview};
}
