import { StudyExample } from '@/components/study-example';
import { GizaAccent } from '@/components/giza-accent';
import { en as copy } from '@/locales/en';
import Link from 'next/link';
import { PublicContactLinks } from '@/components/public-contact';

function Wordmark() {
  return <span className="wordmark"><span className="wordmark-git">Git</span><span>Tutor<span className="wordmark-period">.</span></span></span>;
}

export default function HomePage() {
  const money = new Intl.NumberFormat(copy.locale, { style: 'currency', currency: 'EGP', maximumFractionDigits: 0 });
  return (
    <>
      <a className="skip-link" href="#main">{copy.navigation.skip}</a>
      <header className="site-header container" id="top">
        <a className="brand-link" href="#top" aria-label={copy.brand}><Wordmark /></a>
        <nav aria-label={copy.navigation.label}>
          <Link href="/subjects">{copy.navigation.subjects}</Link>
          <a href="#formats">{copy.navigation.formats}</a>
          <a href="#how-it-works">{copy.navigation.how}</a>
          <a href="#questions">{copy.navigation.faq}</a>
          <Link href="/support">Support</Link>
          <Link href="/login">{copy.navigation.account}</Link>
        </nav>
      </header>

      <main id="main">
        <section className="hero container" aria-labelledby="hero-title">
          <div className="hero-copy">
            <h1 id="hero-title">{copy.hero.title.replace(copy.hero.emphasis, '')}<span>{copy.hero.emphasis}</span></h1>
            <p className="hero-lead">{copy.hero.lead}</p>
            <p className="hero-body">{copy.hero.body}</p>
            <div className="hero-actions">
              <a className="button button-primary" href="#subjects">{copy.hero.primary}</a>
              <a className="text-link" href="#how-it-works">{copy.hero.secondary}</a>
            </div>
            <p className="hero-note">{copy.hero.note}</p>
          </div>
          <div className="hero-example">
            <StudyExample copy={copy.example} />
            <p className="example-undertext">{copy.example.title}</p>
          </div>
        </section>

        <section className="subjects-section container section-spacing" id="subjects" aria-labelledby="subjects-title">
          <div className="section-intro">
            <h2 id="subjects-title">{copy.subjects.title}</h2>
            <p>{copy.subjects.lead}</p>
          </div>
          <div className="subject-grid">
            {copy.subjects.items.map((subject) => (
              <article className="subject-item" key={subject.name}>
                <span className="subject-symbol" aria-hidden="true">{subject.symbol}</span>
                <div><h3>{subject.name}</h3><p>{subject.description}</p></div>
              </article>
            ))}
          </div>
          <p><Link className="text-link" href="/offers">{copy.navigation.offers}</Link></p>
        </section>

        <section className="formats-section section-spacing" id="formats" aria-labelledby="formats-title">
          <div className="container formats-layout">
            <div className="formats-intro">
              <h2 id="formats-title">{copy.formats.title}</h2>
              <p>{copy.formats.lead}</p>
              <div className="private-format">
                <h3>{copy.formats.privateTitle}</h3>
                <p>{copy.formats.privateBody}</p>
              </div>
            </div>
            <div className="group-format">
              <h3>{copy.formats.groupTitle}</h3>
              <p>{copy.formats.groupBody}</p>
              <ul className="tuition-list">
                {copy.formats.tiers.map((tier) => (
                  <li key={tier.size}>
                    <div className="group-size"><strong>{tier.size}</strong><span>{copy.formats.students}</span></div>
                    <div className="group-price"><strong data-testid={`tuition-${tier.priceMinor / 100}`}>{money.format(tier.priceMinor / 100)}</strong><span>{copy.formats.perStudent}</span></div>
                  </li>
                ))}
              </ul>
              <p className="pricing-terms">{copy.formats.terms}</p>
            </div>
          </div>
        </section>

        <section className="how-section container section-spacing" id="how-it-works" aria-labelledby="how-title">
          <h2 id="how-title">{copy.how.title}</h2>
          <ol className="journey-list">
            {copy.how.steps.map((step) => (
              <li key={step.title}><h3>{step.title}</h3><p>{step.body}</p></li>
            ))}
          </ol>
        </section>

        <section className="faq-section container section-spacing" id="questions" aria-labelledby="faq-title">
          <div className="section-intro"><h2 id="faq-title">{copy.faq.title}</h2><p>{copy.faq.lead}</p></div>
          <div className="faq-list">
            {copy.faq.items.map((item) => (
              <details key={item.question}>
                <summary>{item.question}<span className="disclosure-mark" aria-hidden="true" /></summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="site-footer container">
        <div className="footer-invitation"><div><h2>{copy.footer.title}</h2><p>{copy.footer.body}</p><Link className="button button-primary" href="/subjects">{copy.navigation.explore}</Link></div><GizaAccent /></div>
        <div className="footer-bottom"><Wordmark /><PublicContactLinks /><Link href="/apply-to-teach">{copy.navigation.teach}</Link><a href="#top">{copy.footer.back}</a></div>
      </footer>
    </>
  );
}
