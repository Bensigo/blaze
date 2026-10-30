# Observed X reference library

Implemented locally. No reference-informed Jev request or cloud video run has been executed. Existing paid/daily/watchdog flags remain off.

## Dataset and provenance

`src/data/content-references-v2.json` normalizes the supplied, browser-observed research into24 unique canonical X post records:14 AI-video references (13 creator-disclosed,1 secondary-reported exact model unverified) and10 gameplay-promotion references (AI use unknown). There are12 higher-reach AI posts,2 lower AI comparisons,8 higher-reach gameplay posts and2 lower gameplay comparisons. This is not20 established viral AI originals or a calibrated benchmark.

Primary observed counts, observation dates, publication-date labels, disclosure status, short captions and concise sampled-frame descriptions are retained. Unknown current video plays, unique viewers and measured pacing remain null. Selected historical secondary view snapshots are stored separately and are never presented as current directly observed metrics. The normalized file is a bounded reference dataset, not a lossless transcript/archive of the research conversation. No media assets or full video/audio transcripts were copied.

Runtime validation checks24 unique IDs/URLs, expected lane/provenance/comparison counts, canonical X status links, bounded excerpts, and explicitly unavailable pacing/calibration fields. Source observations were supplied by the parent research; local code/schema review did not independently rewatch or remeasure all24 posts.

## Selection and prompts

At most3 examples enter a request: one higher-reach gameplay reference, one lower-reach gameplay comparison and one cross-genre AI reference. Matching visible gameplay traits are ranked above captions; this avoids treating “run your video store” as a stronger running-game match than an observed running character. Weak genre fit is labelled explicitly. Selection is a transparent heuristic, not a learned recommendation or performance estimator.

Reference captions/sampled visuals are supplied as bounded untrusted data, separate from authoritative target-game facts. Examples suggest structural framing only. No source feature, win, audio, audience, timing or asset may be copied into target-game claims merely because an example contains it. No full-script, measured-pacing or causal-virality claim is inferred. The source-outline draft uses action-to-observed-outcome guidance; daily AI ideas receive the selected example summaries when separately authorized.

Jev retains the four equal-weight rubric dimensions and five typed questions. The entire serialized request still must fit16,384 UTF-8 bytes, with no images/assets, alternate provider, fallback or retries. The documented conservative one-cent admission bound is unchanged ($0.002752512). There is no API total-dollar cutoff. Oversized context fails before dispatch rather than increasing the cap or silently substituting a different cost mode.

## Version and approval behavior

Scripts and critiques store reference-set ID/revision, selected reference IDs, rubric revision and a context hash bound to the game source. Reference revisions hash canonical reviewed content; rubric revisions hash the explicit rubric version and its content. Request approval hashes include the exact submitted state.

Changing references/rubric makes prior scores historical. The legacy79/100 review is explicitly labelled as having used no reference examples. The owner must save the script with current context (no AI charge), then separately approve a new Jev request. No automatic rescore occurs. Historical scores remain visible; unstarted stale Jev grants fail before provider dispatch. Production approval/start rechecks the exact current reviewed context. Already-running or uncertain sessions remain monitored rather than being restarted.

Daily idea authorization hashes include reference/rubric revisions, so an old recurring grant cannot silently authorize a new context. No daily schedule has been activated.

## Dashboard and evaluation limits

The per-game studio shows selected examples, lane filters, source links, dated observed post views, AI-status labels, sampled evidence and plain limitations. Higher reach is not proof that a hook caused it. Captions are not assumed to be spoken openings. Creator/curator concentration and absent retention/conversion data remain visible limitations.

Predictive claims would require independent human ratings, repeatability checks, held-out examples, prospective measured outcomes, confounder tracking and meaningful baselines. Adding examples to a prompt is not that validation.
