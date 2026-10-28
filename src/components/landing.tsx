import { ArrowDown, ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";

export default function Landing() {
  return (
    <div className="blaze-landing">
      <header className="blaze-header">
        <Link href="/" className="blaze-wordmark" aria-label="Blaze home">
          <span className="blaze-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>blaze<span className="blaze-period">.</span></span>
        </Link>
        <nav aria-label="Landing navigation">
          <a className="blaze-nav-link" href="#how-it-works">How it works</a>
          <Link className="blaze-signin" href="/app">Sign in <ArrowUpRight size={15} /></Link>
        </nav>
      </header>
      <main>
        <section className="blaze-hero">
          <div className="blaze-hero-inner">
            <div className="blaze-hero-copy">
              <p className="blaze-kicker"><span /> MADE FOR WEB GAMES</p>
              <h1>See where<br />players stop.</h1>
              <p className="blaze-lede">Track rounds, review consented sessions and turn gameplay into content.</p>
              <div className="blaze-hero-actions">
                <Link href="/app" className="blaze-primary">Open workspace <ArrowRight size={17} /></Link>
                <a href="#how-it-works" className="blaze-text-link">See how it works <ArrowDown size={15} /></a>
              </div>
              <p className="blaze-hero-note">For the games you build for the browser.</p>
            </div>
            <figure className="blaze-film">
              <div className="blaze-film-top"><span>GAMEPLAY / STAR CATCH</span><span>CONTROLLED TEST</span></div>
              <video controls muted playsInline preload="metadata" poster="/landing/fixture-screenshot.png" aria-label="Controlled Star Catch fixture gameplay">
                <source src="/landing/fixture-gameplay.webm" type="video/webm" />
                Your browser does not support this video.
              </video>
              <figcaption><span>Controlled test game</span><span>Fixture footage · not a live agent session</span></figcaption>
            </figure>
          </div>
        </section>
        <section className="blaze-process" id="how-it-works">
          <div className="blaze-section-intro">
            <p className="blaze-kicker">FROM PLAY TO WHAT’S NEXT</p>
            <h2>From a game session<br />to a reviewed post.</h2>
            <p>Follow the journey from the first visit to the next thing you share.</p>
          </div>
          <div className="blaze-steps">
            <article><span>01 / MEASURE</span><h3>See where play leads.</h3><p>Track visits, round starts, completions and drop-off across your web games. Keep human activity separate from agent sessions.</p></article>
            <article><span>02 / UNDERSTAND</span><h3>Review the moments.</h3><p>Explore session events and, when a player separately consents, review a private capture of the game canvas.</p></article>
            <article><span>03 / CREATE</span><h3>Turn recordings into drafts.</h3><p>With a connected worker and provider, record agent gameplay, make clips and prepare content informed by your game’s history for approval.</p></article>
          </div>
        </section>
        <section className="blaze-finish">
          <p className="blaze-kicker">YOUR GAMES. YOUR WORKSPACE.</p>
          <h2>Connect your first game.</h2>
          <p>Sign in, connect a game and install the Blaze SDK to get started.</p>
          <Link href="/app" className="blaze-primary">Open workspace <ArrowRight size={17} /></Link>
        </section>
      </main>
      <footer className="blaze-footer"><span>blaze<span className="blaze-period">.</span></span><span>Made for games on the web.</span><Link href="/app">Open workspace <ArrowUpRight size={14} /></Link></footer>
    </div>
  );
}
