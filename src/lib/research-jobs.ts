import { HttpError } from "./http-error";
import { withActiveGameWork } from "./active-game-work";
import { get, list, put, query, id } from "./db";
import { analytics } from "./analytics";
import { loadAgentHistory } from "./agent-history";
import { interpretResearch } from "./agent";
import { aiModel } from "./ai-provider";
import { readAISettings, resolveAISecret } from "./ai-settings";
import { secretFor } from "./credentials";
import { runResearch } from "./integrations";
import { hash } from "./security";
import { upsertResearchFinding } from "./finding-decisions";
import type {
  Game,
  Finding,
  ResearchRun,
  Recording,
  ProviderSecret,
} from "./types";
export async function researchJob(
  workspace: string,
  game: Game,
  dayKey = new Date().toISOString().slice(0, 10),
  options: { allowAI?: boolean } = {},
) {
  const runId = id("run");
  const claimed = await query(
    `INSERT INTO daily_runs(workspace_id,game_id,day,run_id,lease_until) VALUES($1,$2,$3,$4,now()+interval '10 minutes') ON CONFLICT(workspace_id,game_id,day) DO UPDATE SET run_id=excluded.run_id,lease_until=excluded.lease_until WHERE daily_runs.lease_until<now() RETURNING run_id`,
    [workspace, game.id, dayKey, runId],
  );
  if (!claimed.length) {
    const lease = (
      await query<{ run_id: string; lease_until: Date }>(
        "SELECT run_id,lease_until FROM daily_runs WHERE workspace_id=$1 AND game_id=$2 AND day=$3",
        [workspace, game.id, dayKey],
      )
    )[0];
    const existing = lease
      ? await get<ResearchRun>(workspace, "run", lease.run_id)
      : undefined;
    return {
      skipped: true,
      pending: !existing || ["running", "failed"].includes(existing.status),
      retryAt: lease?.lease_until,
    };
  }
  const run: ResearchRun = {
    id: runId,
    gameId: game.id,
    status: "running",
    startedAt: new Date().toISOString(),
    findings: [],
    coverage: [],
    ai: { phase: "configuration", status: options.allowAI ? "preparing" : "not_requested", dispatches: 0, responses: 0, ...(options.allowAI ? {startedAt:new Date().toISOString()} : {}) },
  };
  await put(workspace, "run", run);
  try {
    const previous = await get<{
      id: string;
      url: string;
      observedAt: string;
      words: number;
    }>(workspace, "seo_baseline", game.id);
    // Each independent integration may fail without discarding baseline research.
    const connections: Record<string, ProviderSecret> = {};
    for (const provider of ["reddit", "brave", "search_console"]) {
      const secret = await secretFor(workspace, provider).catch(() => undefined);
      if (secret) connections[provider] = secret;
    }
    const result = await runResearch({
      game,
      analytics: await analytics(workspace, game.id, 30),
      connections,
      previous,
    });
    if (
      result.pageBaseline &&
      (!previous ||
        Date.now() - new Date(previous.observedAt).getTime() >= 7 * 86400000)
    )
      await put(workspace, "seo_baseline", {
        id: game.id,
        ...result.pageBaseline,
      });
    for (const draft of result.findings) {
      const fid = `finding_${hash(`${game.id}:${draft.title}:${JSON.stringify(draft.evidence)}`).slice(0, 24)}`;
      const existing = await get<Finding>(workspace, "finding", fid);
      await upsertResearchFinding(workspace, {
        ...draft,
        id: fid,
        status: existing?.status || ("open" as const),
        createdAt: existing?.createdAt || new Date().toISOString(),
      });
      run.findings.push(fid);
    }
    const recordings = (await list<Recording>(workspace, "recording")).filter(
      (r) => r.gameId === game.id,
    );
    for (const r of recordings.slice(0, 10)) {
      const notes =
        r.status === "failed"
          ? [
              {
                at: 0,
                text: r.error || "The recording run failed.",
                type: "error" as const,
              },
            ]
          : r.observations?.filter(
              (o) => o.type === "error" || o.type === "hypothesis",
            ) || [];
      for (const note of notes) {
        const fid = `finding_${hash(`recording:${r.id}:${note.at}:${note.text}`).slice(0, 24)}`;
        if (!(await get(workspace, "finding", fid)))
          await put(workspace, "finding", {
            id: fid,
            gameId: game.id,
            title:
              note.type === "hypothesis"
                ? "Investigate the recorded playthrough"
                : "Recording run needs attention",
            detail: note.text,
            type: note.type === "hypothesis" ? "hypothesis" : "observation",
            priority: "medium",
            evidence: [{ label: r.title, recordingId: r.id, at: note.at }],
            status: "open",
            createdAt: new Date().toISOString(),
          });
        run.findings.push(fid);
      }
    }
    try {
      if (!options.allowAI) {
        result.coverage.push({source:"AI research agent",status:"not_requested",detail:"No AI request was authorized for this review. Saving a key does not start inference. Run a bounded AI review explicitly."});
      } else {
      const configured = await readAISettings(workspace);
      if (!configured) {
        run.ai = {...run.ai!,status:"failed",errorCode:"not_configured"};
        result.coverage.push({
          source: "AI research agent",
          status: "disconnected",
          detail:
            "Choose an AI provider and model in Account settings to enable AI interpretation.",
        });
      } else {
        const secret = await resolveAISecret(workspace);
        run.ai = {...run.ai!,provider:configured.provider,model:configured.model,phase:"history"};
        await put(workspace,"run",run);
        const history = await loadAgentHistory(workspace, game.id);
        run.ai.phase="inference";
        await put(workspace,"run",run);
        const suggestions = await interpretResearch({
          model: aiModel(secret,async event=>{
            if(event.phase==='dispatched') {
              if(run.ai!.dispatches>=4) {run.ai!.status='failed';run.ai!.errorCode='request_limit';await put(workspace,'run',run);throw new Error('Review request limit reached.');}
              run.ai!.dispatches++;run.ai!.lastAttemptAt=event.at;run.ai!.status='running';
            } else if(event.phase==='responded') run.ai!.responses++;
            else {run.ai!.errorCode=event.errorCode||'request_failed';run.ai!.httpStatus=event.httpStatus;}
            await put(workspace,'run',run);
          }),
          gameId: game.id,
          findings: result.findings,
          history,
        });
        run.ai.phase='validation';
        await put(workspace,"run",run);
        for (const suggestion of suggestions) {
          // Evidence and type define the durable issue, so wording changes do not reopen it.
          const fid = `finding_${hash(`ai:${game.id}:${suggestion.aiTopic}:${suggestion.type}:${JSON.stringify([...suggestion.evidence].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))}`).slice(0, 24)}`;
          const existing = await get<Finding>(workspace, "finding", fid);
          if (!existing || existing.status === "open")
            await upsertResearchFinding(workspace, {
              ...suggestion,
              id: fid,
              status: existing?.status || "open",
              createdAt: existing?.createdAt || new Date().toISOString(),
            }, {openOnly:true});
          run.findings.push(fid);
        }
        result.coverage.push({
          source: "AI research agent",
          status: "complete",
          detail: `The selected AI provider interpreted same-game research and 90-day human history; ${suggestions.length} supported proposals. Suggestions require human review.`,
        });
        run.ai={...run.ai,phase:'complete',status:'succeeded',succeededAt:new Date().toISOString()};
      }
      }
    } catch {
      run.ai={...run.ai!,status:'failed',errorCode:run.ai?.errorCode||(run.ai?.phase==='history'?'history_unavailable':run.ai?.responses?'invalid_result':run.ai?.dispatches?'request_failed':'configuration_unavailable')};
      result.coverage.push({
        source: "AI research agent",
        status: "failed",
        detail:
          `AI review did not complete (${run.ai.errorCode}). Deterministic observations remain available; see execution status for the next step.`,
      });
    }
    run.coverage = result.coverage;
    run.status = result.coverage.some((c) => c.status !== "complete")
      ? "partial"
      : "complete";
    run.finishedAt = new Date().toISOString();
    await put(workspace, "run", run);
    await query(
      `UPDATE daily_runs SET lease_until=now()+interval '100 years' WHERE workspace_id=$1 AND game_id=$2 AND day=$3`,
      [workspace, game.id, dayKey],
    );
    return run;
  } catch {
    run.status = "failed";
    run.error =
      "Research failed. Check provider access and public page availability.";
    run.finishedAt = new Date().toISOString();
    await put(workspace, "run", run);
    return run;
  }
}
export async function queueDailyResearch() {
  const rows = await query<{ workspace_id: string; body: Game }>(
    `SELECT workspace_id,body FROM records WHERE kind='game' AND (body->>'dailyEnabled')::boolean=true`,
  );
  const day = new Date().toISOString().slice(0, 10);
  for (const row of rows) {
    try { await withActiveGameWork(row.workspace_id, row.body.id, sql => sql(
      `INSERT INTO jobs(id,workspace_id,kind,state,body) VALUES($1,$2,'research','queued',$3::jsonb) ON CONFLICT DO NOTHING`,
      [
        `research:${day}:${row.body.id}`,
        row.workspace_id,
        JSON.stringify({ gameId: row.body.id, day }),
      ],
    )); } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 404) throw error;
      // A concurrent archive removed this parent; continue other games.
    }
  }
  return rows.length;
}
export async function drainResearch(limit = 1) {
  const results = [];
  for (let i = 0; i < limit; i++) {
    const row = (
      await query<{
        id: string;
        workspace_id: string;
        body: { gameId: string; day: string };
      }>(
        `UPDATE jobs SET state='claimed',lease_until=now()+interval '10 minutes',updated_at=now() WHERE id=(SELECT id FROM jobs WHERE kind='research' AND available_at<=now() AND (state='queued' OR(state='claimed' AND lease_until<now())) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,workspace_id,body`,
      )
    )[0];
    if (!row) break;
    const game = await get<Game>(row.workspace_id, "game", row.body.gameId);
    const result = game?.dailyEnabled
      ? await researchJob(row.workspace_id, game, row.body.day)
      : undefined;
    if (result) results.push(result);
    if (result && "pending" in result && result.pending) {
      await query(
        `UPDATE jobs SET state='queued',available_at=$2::timestamptz+interval '1 second',updated_at=now() WHERE id=$1`,
        [row.id, result.retryAt || new Date(Date.now() + 600000).toISOString()],
      );
    } else
      await query(
        `UPDATE jobs SET state='complete',updated_at=now() WHERE id=$1`,
        [row.id],
      );
  }
  return results;
}
