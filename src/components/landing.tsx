import { ArrowDown, ArrowRight, ArrowUpRight, Crosshair, Github, Radar, Route } from "lucide-react";
import Link from "next/link";
import LaunchPreview from "./launch-preview";
import "./launch-landing.css";

const repo = "https://github.com/Bensigo/blaze";

export default function Landing() {
  return (
    <div className="launch-site">
      <header className="launch-header">
        <div className="launch-width launch-header-inner">
          <Link href="/" className="launch-logo" aria-label="Blaze home">
            <svg width="27" height="28" viewBox="0 0 27 28" fill="none" aria-hidden="true">
              <path d="M13 1H20L8 27H1L13 1Z" fill="currentColor" />
              <path d="M21 1H26L14 27H9L21 1Z" fill="currentColor" opacity=".46" />
            </svg>
            blaze<span>.</span>
          </Link>
          <nav aria-label="Main navigation">
            <a className="launch-header-product" href="#product">Product</a>
            <Link className="launch-header-docs" href="/developers">SDK docs</Link>
            <Link className="launch-header-app" href="/app">Sign in <ArrowUpRight size={15} aria-hidden="true" /></Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="launch-hero" aria-labelledby="launch-title">
          <div className="launch-width launch-hero-grid">
            <div className="launch-copy">
              <p className="launch-eyebrow"><span /> WEB GAME ANALYTICS</p>
              <h1 id="launch-title">Where do your<br className="launch-hero-break" /> players <em>stop?</em></h1>
              <p className="launch-lede">See which links bring players in, where they quit, and how often they come back.</p>
              <div className="launch-actions">
                <Link href="/app" className="launch-button">Connect a game <ArrowRight size={17} aria-hidden="true" /></Link>
                <a href="#preview" className="launch-text-link">Explore the demo <ArrowDown size={14} aria-hidden="true" /></a>
              </div>
              <p className="launch-note">Open source · MIT license</p>
            </div>

            <LaunchPreview />
          </div>
        </section>

        <section className="launch-proof" id="product" aria-labelledby="launch-product-title">
          <div className="launch-width launch-proof-inner">
            <div className="launch-proof-heading">
              <p className="launch-eyebrow">01 / THE WORKFLOW</p>
              <h2 id="launch-product-title">Follow the path<br />{" "}from <em>click to play.</em></h2>
            </div>
            <div className="launch-proof-list">
              <article>
                <Route size={21} aria-hidden="true" />
                <div><h3>Find your biggest drop-off</h3><p>Follow visits, round starts and completions to find the step worth investigating first.</p></div>
              </article>
              <article>
                <Crosshair size={21} aria-hidden="true" />
                <div><h3>See which links bring players</h3><p>Give each launch post its own link. Compare the visits and round starts Blaze can attribute to each link.</p></div>
              </article>
              <article>
                <Radar size={21} aria-hidden="true" />
                <div><h3>Keep tabs on similar games</h3><p>Save competitor listings and log public signals such as visible like counts or chart positions. Compare observations over time.</p></div>
              </article>
            </div>
          </div>
        </section>

        <section className="launch-close">
          <div className="launch-width launch-close-inner">
            <div>
              <p className="launch-eyebrow">02 / GET STARTED</p>
              <h2>Put your game on the board.</h2>
              <p className="launch-close-lede">Add your game, install the SDK and check that your first events arrive.</p>
            </div>
            <Link href="/app" className="launch-button">Connect a game <ArrowRight size={17} aria-hidden="true" /></Link>
          </div>
        </section>
      </main>

      <footer className="launch-width launch-footer">
        <Link href="/" className="launch-footer-brand">blaze<span>.</span></Link>
        <span>Analytics for games on the web.</span>
        <div>
          <Link href="/developers">SDK docs</Link>
          <a href={repo}><Github size={15} aria-hidden="true" /> Source code</a>
        </div>
      </footer>
    </div>
  );
}
