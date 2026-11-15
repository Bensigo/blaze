import { ArrowRight, ArrowUpRight, Github } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import "./launch-landing.css";

const reports = [
  {
    title: "See which links lead to play",
    description: "Compare visits and round starts by traffic source. Tag your launch links to measure each campaign.",
    label: "Open Acquisition",
    href: "/demo?view=acquisition",
  },
  {
    title: "Find where players stop",
    description: "Follow visits, first actions, round starts, and completions. Change the date range to see how the funnel shifts.",
    label: "Open Engagement",
    href: "/demo?view=analytics",
  },
  {
    title: "Follow a session event by event",
    description: "Open a session to see the order of events and the last action Blaze recorded.",
    label: "Open Sessions",
    href: "/demo?view=sessions",
  },
];

function Wordmark() {
  return (
    <Link href="/" className="launch-logo" aria-label="Blaze home">
      <Image src="/icon.svg" width={32} height={32} alt="" unoptimized />
      <span>blaze</span>
    </Link>
  );
}

export default function Landing() {
  return (
    <div className="launch-site">
      <header className="launch-header">
        <div className="launch-width launch-header-inner">
          <Wordmark />
          <nav aria-label="Main navigation">
            <Link href="/demo" className="launch-nav-demo">Demo</Link>
            <Link href="/developers">SDK docs</Link>
            <Link href="/app" className="launch-sign-in">Sign in <ArrowUpRight size={14} aria-hidden="true" /></Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="launch-hero" aria-labelledby="launch-title">
          <div className="launch-width launch-copy">
            <p className="launch-kicker">Analytics for browser games</p>
            <h1 id="launch-title">See what happens after players hit <em>Play.</em></h1>
            <p className="launch-lede">Blaze tracks where players come from, which rounds they finish, and whether they come back.</p>
            <div className="launch-actions">
              <Link href="/demo?view=analytics" className="launch-button">Try the dashboard <ArrowRight size={17} aria-hidden="true" /></Link>
              <Link href="/app" className="launch-button launch-button-quiet">Connect a game</Link>
            </div>
          </div>
          <figure className="launch-width launch-showcase">
            <figcaption className="launch-showcase-caption">
              <span>Blaze workspace <span className="launch-caption-separator">/</span> Engagement</span>
              <span>Sample data</span>
            </figcaption>
            <Link href="/demo?view=analytics" className="launch-product-shot" aria-label="Open the example Engagement dashboard">
              <picture>
                <source media="(max-width: 600px)" srcSet="/landing/engagement-mobile.webp" />
                <Image src="/landing/engagement-desktop.webp" alt="The Blaze Engagement dashboard showing visits, round starts, completions, and the first-session funnel." width={1320} height={780} unoptimized loading="eager" fetchPriority="high" />
              </picture>
              <span className="launch-shot-open"><ArrowUpRight size={18} aria-hidden="true" /></span>
            </Link>
          </figure>
        </section>

        <section className="launch-width launch-reports" aria-labelledby="launch-reports-title">
          <div className="launch-reports-intro">
            <h2 id="launch-reports-title">Explore the reports.</h2>
            <p>Each report opens in a read-only workspace with an example game and sample events.</p>
          </div>
          <div className="launch-report-links">
            {reports.map((report) => (
              <article key={report.href}>
                <h3>{report.title}</h3>
                <p>{report.description}</p>
                <Link href={report.href}>{report.label} <ArrowUpRight size={15} aria-hidden="true" /></Link>
              </article>
            ))}
          </div>
        </section>

        <section className="launch-setup">
          <div className="launch-width launch-setup-inner">
            <div>
              <h2>Connect your own game.</h2>
              <p>Add the game URL, install the Blaze SDK, and play through a round to check that events arrive. In your workspace you can also save similar games and compare public likes and chart positions you record.</p>
            </div>
            <div className="launch-actions">
              <Link href="/app" className="launch-button">Connect a game <ArrowRight size={17} aria-hidden="true" /></Link>
              <a href="/docs/sdk/quickstart.md" className="launch-button launch-button-quiet">Read the SDK quickstart</a>
            </div>
          </div>
        </section>
      </main>

      <footer className="launch-width launch-footer">
        <Wordmark />
        <a href="https://github.com/Bensigo/blaze"><Github size={16} aria-hidden="true" /> Open source · MIT license</a>
      </footer>
    </div>
  );
}
