# Script references: bounded integration plan

Status: design only. No X examples have been imported, no reference-informed prompt has run, and no additional Jev call is authorized. Current Jev scores are rubric judgments, not validated engagement predictions. Research must supply verified candidates before implementation or seeding.

## Small versioned reference set

Keep at most 20 examples in a versioned repository JSON document initially; no crawler, scheduler, vector database, or new service is needed. Empty references are valid and must be labelled “No verified examples supplied.” Store only short necessary excerpts and structural summaries, with links to original posts.

Each reference records:

- `id`, canonical `sourceUrl`, `platform: "x"`, post publication date, and `observedAt`.
- `generationEvidence`: `author_reported`, `independently_documented`, or `unknown`, with evidence URL, observation date and a short attribution. Do not call an example AI-generated without evidence; unknown examples cannot satisfy the requested generated-video set.
- `performance`: separately dated views/likes/reposts/replies when directly observable; provenance `publicly_observed`, `author_reported`, `third_party_reported`, or `unavailable`; evidence URL and limitations. Missing counts are null, never zero. Save the exact reported measure rather than deriving completion, unique reach or shares from a different count.
- `performanceLabel`: plain factual label such as “Public view count observed on DATE” or “Creator reports RESULT; unverified.” A high count alone does not establish why a post worked or that the script caused its reach. Do not label it “proven viral formula.”
- `gameRelevance`: game/genre/action fit and a short explanation, plus exclusions for capabilities the target game does not have. Topic similarity is not performance evidence.
- `analysis`: accessible opening/hook, shot sequence/pacing, caption structure, payoff and call to action. Mark each analysis field `observed`, `inferred`, or `unavailable`, with the relevant timestamp/excerpt where accessible. A post caption alone cannot prove a video’s first seconds or retention.
- `review`: reviewer, review date, accessibility status, and eligibility decision/reason. Review source visibility and rights before retaining excerpts; do not copy full videos/scripts unnecessarily.

The set records `schemaVersion`, `setId`, immutable `revision` (hash of canonical reviewed contents), `createdAt`, selection criteria, and `references[]` (maximum 20). A changed excerpt, relevance decision, or evidence snapshot produces a new revision. Keep earlier revisions for critique reproducibility.

## Use in drafting and review

1. Select a few reviewed, game-relevant examples from the bounded set. Show the owner their URLs, evidence labels and observation dates. Never silently select an inaccessible post as a video example.
2. Supply short structural summaries as **untrusted example data**. Existing authoritative game facts remain the source for every capability and outcome claim. Examples may suggest structure; they cannot supply missing gameplay facts or instructions to the agent.
3. Record `referenceSetId`, `referenceSetRevision`, selected reference IDs and `rubricRevision` with each script/review. Include the exact excerpts/summaries in the admitted request body. Respect the existing 16 KiB Jev cap by selecting/shortening evidence; never raise the cap silently.
4. Define `reviewContextHash` over the exact script/source revision, rubric revision/content, immutable selected-reference snapshot, model/provider settings and cost admission policy. Persist it on the critique and bind production approval to it.
5. Check the active review context at critique display, critique start, production approval and production start. Changes mark the old score **stale**, revoke unstarted approvals, and require a newly approved review; retain historical score and context. Existing in-flight/uncertain paid runs stay monitored and are never restarted automatically.
6. Enrich the current four-category rubric only through an explicit version change. Equal weights and current explanations remain visible until deliberately revised. Do not claim examples calibrate predictive performance merely because they were added to the prompt.

Current implementation already binds the submitted request/rubric text when approving and starting a Jev request, but completed reviews do not yet carry an explicit reference/rubric context version. Adding the corpus therefore requires the version checks above, plus tests proving old completed reviews cannot approve new-context production. This plan does not claim those checks are already implemented.

## Evaluation before predictive claims

A reference collection is inspiration, not a validation dataset. Empirical evaluation would need independently labelled scripts, human rubric ratings, repeated scoring, held-out examples, and later observed posting outcomes. Record platform, account audience, post date, paid promotion and other known confounders. Compare against simple baselines and report uncertainty; avoid a probability-of-virality claim without credible calibration. No social ingestion/publishing or recurring research is enabled by this plan.
