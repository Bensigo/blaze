"use client";

import type { Analytics, Game } from "@/lib/types";
import InfoHint from "./info-hint";
import styles from "./most-played-games.module.css";

const duration = (seconds: number | null) => seconds === null ? "Not measured" : seconds < 60 ? `${Math.floor(seconds)}s` : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;

export default function MostPlayedGames({ analytics, games }: { analytics?: Analytics; games: Game[] }) {
  const rows = analytics?.mostPlayedGames || [];
  const titles = new Map(games.map(game => [game.id, game.title]));
  return <section className={styles.section} aria-labelledby="most-played-heading">
    <div className={styles.heading}><div><h2 id="most-played-heading">Most played games <InfoHint label="About most played games">Ranked by distinct browser IDs with a round start, then played sessions and round starts. Browser IDs are not people. Synthetic and marked test or fixture sessions are excluded; unmarked tests cannot be identified.</InfoHint></h2><p>Ranked by browsers that started a round</p></div></div>
    {!analytics ? <p className={styles.empty}>Loading game activity…</p> : rows.length === 0 ? <p className={styles.empty}>No recorded round starts for eligible games in this range. Install the SDK and send round_start after consent to measure play.</p> : <div className={styles.scroll}><table><thead><tr><th scope="col">Game</th><th scope="col">Browser IDs</th><th scope="col">Played sessions</th><th scope="col">Round starts</th><th scope="col">Measured active play</th></tr></thead><tbody>{rows.map((row,index)=><tr key={row.gameId}><th scope="row"><span className={styles.rank}>{index + 1}</span>{titles.get(row.gameId) || "Game"}</th><td>{row.browserIds.toLocaleString()}</td><td>{row.playedSessions.toLocaleString()}</td><td>{row.roundStarts.toLocaleString()}</td><td>{duration(row.activeSeconds)}<small>{row.measuredSessions.toLocaleString()} / {row.playedSessions.toLocaleString()} sessions measured</small></td></tr>)}</tbody></table></div>}
  </section>;
}
