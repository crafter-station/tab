import type { ReactNode } from "react";
import { ArrowRight, ArrowUpRight, EnvelopeSimple, GithubLogo, ShieldCheck } from "@phosphor-icons/react";
import { buttonVariants } from "@tab/ui";
import { PageKicker } from "./shared.tsx";

const lastUpdated = "July 13, 2026";

function PageIntro({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="grid gap-5 border-b border-border pb-12 pt-4 sm:pb-16 sm:pt-10">
      <PageKicker>{eyebrow}</PageKicker>
      <h1 className="max-w-[13ch] text-balance font-[var(--font-display)] text-[clamp(3rem,7vw,6rem)] font-bold leading-[0.92] tracking-[-0.035em]">{title}</h1>
      <p className="max-w-[44rem] text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">{description}</p>
    </header>
  );
}

function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-border py-8 sm:grid-cols-[minmax(9rem,0.4fr)_minmax(0,1fr)] sm:gap-10 sm:py-10">
      <h2 className="text-lg font-bold">{title}</h2>
      <div className="grid max-w-[46rem] gap-4 text-pretty leading-relaxed text-muted-foreground [&_a]:font-semibold [&_a]:text-foreground [&_a]:underline [&_a]:decoration-border [&_a]:underline-offset-4 [&_strong]:text-foreground">{children}</div>
    </section>
  );
}

export function AboutPage() {
  return (
    <>
      <PageIntro eyebrow="About Tab" title="Writing should keep up with thinking." description="Tab is a native Mac app built around a simple idea: autocomplete belongs in the places where work already happens, not in another prompt box." />
      <section className="grid gap-12 py-16 sm:py-24 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-20">
        <div>
          <PageKicker>Why we built it</PageKicker>
          <h2 className="mt-4 max-w-[13ch] text-balance font-[var(--font-display)] text-4xl font-bold leading-tight tracking-[-0.015em]">The best writing tool is the one that does not pull you away from the sentence.</h2>
        </div>
        <div className="grid gap-6 text-pretty text-lg leading-relaxed text-muted-foreground">
          <p>Writing assistants often ask you to stop, switch context, explain the task, and carry the answer back. Tab works at the smaller, more frequent moment: when you know what comes next and want to get it onto the page faster.</p>
          <p>That is why Tab runs as a native desktop app, keeps the active application in focus, and makes every Acceptance deliberate. The product should feel less like a destination and more like a quiet extension of typing.</p>
        </div>
      </section>
      <section className="border-y border-border py-16 sm:py-20">
        <PageKicker>Product principles</PageKicker>
        <div className="mt-10 grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-border bg-border md:grid-cols-3">
          {[
            { title: "Stay in context", copy: "The active Mac app remains the place where writing happens." },
            { title: "Keep consent visible", copy: "A suggestion is a preview until the person writing chooses to add it." },
            { title: "Make memory controllable", copy: "Personal facts should be visible and removable, never hidden in a profile." },
          ].map((principle) => (
            <article className="min-h-64 bg-card p-7" key={principle.title}>
              <ShieldCheck aria-hidden="true" />
              <h3 className="mt-20 text-xl font-bold">{principle.title}</h3>
              <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">{principle.copy}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="grid gap-7 py-16 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:py-24">
        <div>
          <PageKicker>Built in the open</PageKicker>
          <h2 className="mt-4 max-w-[16ch] text-balance font-[var(--font-display)] text-4xl font-bold tracking-[-0.015em]">Follow the work or try Tab on your Mac.</h2>
        </div>
        <div className="flex flex-wrap gap-3">
          <a className={buttonVariants({ variant: "secondary", size: "lg" })} href="https://github.com/crafter-station/tab" target="_blank" rel="noreferrer">View GitHub <ArrowUpRight data-icon="inline-end" aria-hidden="true" /></a>
          <a className={buttonVariants({ size: "lg" })} href="/download">Download Tab <ArrowRight data-icon="inline-end" aria-hidden="true" /></a>
        </div>
      </section>
    </>
  );
}

export function ContactPage() {
  return (
    <>
      <PageIntro eyebrow="Contact" title="Talk to a person." description="Questions about setup, privacy, billing, or the product are welcome. Choose the channel that fits the conversation." />
      <section className="grid gap-4 py-12 sm:py-20 md:grid-cols-2">
        <a className="group flex min-h-64 flex-col justify-between rounded-[var(--radius-card)] border border-border bg-card p-6 no-underline transition-[border-color,transform] duration-150 ease-[var(--tab-ease-out)] active:scale-[0.99] sm:p-8" href="mailto:tab@cueva.io">
          <div className="flex items-center justify-between"><EnvelopeSimple aria-hidden="true" /><ArrowUpRight className="text-muted-foreground" aria-hidden="true" /></div>
          <div><p className="text-sm font-semibold text-muted-foreground">Email</p><h2 className="mt-2 text-2xl font-bold">tab@cueva.io</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Best for account, billing, privacy, and general product questions.</p></div>
        </a>
        <a className="group flex min-h-64 flex-col justify-between rounded-[var(--radius-card)] border border-border bg-card p-6 no-underline transition-[border-color,transform] duration-150 ease-[var(--tab-ease-out)] active:scale-[0.99] sm:p-8" href="https://github.com/crafter-station/tab/issues" target="_blank" rel="noreferrer">
          <div className="flex items-center justify-between"><GithubLogo aria-hidden="true" /><ArrowUpRight className="text-muted-foreground" aria-hidden="true" /></div>
          <div><p className="text-sm font-semibold text-muted-foreground">GitHub</p><h2 className="mt-2 text-2xl font-bold">Report an issue</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Best for reproducible bugs and technical product feedback.</p></div>
        </a>
      </section>
      <section className="grid gap-8 border-y border-border py-10 sm:grid-cols-3">
        <div><p className="text-sm font-bold">Include the basics</p><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Your macOS version, the active app, and what you expected to happen help us investigate faster.</p></div>
        <div><p className="text-sm font-bold">Protect private writing</p><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Do not send passwords, payment details, confidential text, or other sensitive typing context.</p></div>
        <div><p className="text-sm font-bold">Account help</p><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Email from the address on your Tab account so we can identify the right account safely.</p></div>
      </section>
    </>
  );
}

export function PrivacyPage() {
  return (
    <>
      <PageIntro eyebrow={`Privacy policy · Updated ${lastUpdated}`} title="Clear data boundaries." description="This policy explains how Tab keeps Automatic Suggestions local and processes explicit Deep Complete requests, Personal Memory, account access, and billing." />
      <div className="py-8 sm:py-12">
        <LegalSection title="Overview">
          <p>Tab is a native autocomplete app for macOS. Automatic Suggestions use local inference on your Mac. Tab sends bounded, redacted Typing Context to the cloud for Deep Complete only after you explicitly invoke it.</p>
          <p><strong>Tab does not store raw key-event logs, screenshots, clipboard contents, full document contents, browser URLs, window titles, or accepted Suggestion text as product analytics by default.</strong></p>
        </LegalSection>
        <LegalSection title="Information we collect">
          <p><strong>Account information:</strong> your name, email address, email-verification state, and authentication records.</p>
          <p><strong>Device information:</strong> identifiers and basic client metadata needed to connect and manage your Macs.</p>
          <p><strong>Typing Context:</strong> a limited, temporary span of recent text-bearing input and active-application information used to generate a Suggestion. Automatic Suggestions process this context on your Mac. Deep Complete sends bounded, redacted context to the cloud only after your explicit action. Navigation, shortcuts, and other non-text actions are excluded.</p>
          <p><strong>Pasted text:</strong> text you paste may inform an immediate Suggestion after local redaction, but Tab does not read your clipboard and pasted text does not create Personal Memory by default.</p>
          <p><strong>Personal Memory:</strong> facts you create or that Tab learns from eligible user-authored writing to personalize future Suggestions. Personal Memory is stored with your account and remains visible and controllable from your dashboard.</p>
          <p><strong>Usage and billing:</strong> plan, trial and subscription status, daily Accepted Word counts, monthly Deep Complete counts, and transaction references needed to enforce allowances and manage paid access.</p>
          <p><strong>Operational data:</strong> limited metadata needed for security, reliability, diagnostics, and product quality, such as event outcome, counts, app category, latency, plan, and model version. This telemetry excludes raw Typing Context, Suggestion text, Personal Memory contents, clipboard contents, URLs, document names, window titles, and contact identities.</p>
        </LegalSection>
        <LegalSection title="How we use information">
          <p>We use this information to authenticate accounts, connect authorized devices, generate and personalize Suggestions, enforce daily and monthly allowances, process plan changes, provide support, prevent abuse, and maintain the service.</p>
          <p>We do not sell personal information or use private writing to serve advertising.</p>
        </LegalSection>
        <LegalSection title="Service providers">
          <p>Tab relies on service providers for infrastructure, authentication support, transactional email, and billing. Those providers process information only as needed to perform their services for Tab and under their own applicable terms and privacy commitments.</p>
          <p>Payment details are handled by the billing provider. Tab receives subscription and transaction status rather than full card details.</p>
        </LegalSection>
        <LegalSection title="Retention and control">
          <p>We retain account and service data while your account is active and as needed to provide the service, meet legal obligations, resolve disputes, and protect the service.</p>
          <p>Recent Typing Context and Memory Extraction Windows are bounded and temporary. Tab does not retain them as a raw typing log by default. Personal Memory remains until you delete it or your account, subject to legal and operational retention requirements.</p>
          <p>You can view, edit, export, and delete existing Personal Memory even after a trial ends, downgrade, or cancellation. You can also revoke connected devices from your dashboard. To request account deletion or a copy of your information, email <a href="mailto:tab@cueva.io">tab@cueva.io</a>.</p>
        </LegalSection>
        <LegalSection title="Security">
          <p>We use technical and organizational safeguards intended to protect information. No internet service can guarantee absolute security, so please report suspected security issues privately by email rather than in a public issue.</p>
        </LegalSection>
        <LegalSection title="Your choices">
          <p>You may stop Typing Context processing by pausing, quitting, or disabling Tab; revoke macOS permissions in System Settings; manage Personal Memory; revoke devices; change plans; cancel through the billing portal; or request account deletion.</p>
        </LegalSection>
        <LegalSection title="Changes and contact">
          <p>We may update this policy as Tab changes. The updated date above identifies the current version. Material changes will be communicated through the service or by email when appropriate.</p>
          <p>Questions or privacy requests can be sent to <a href="mailto:tab@cueva.io">tab@cueva.io</a>. The <a href="/terms">Terms of Service</a> govern your use of Tab, and current plan details are on the <a href="/pricing">pricing page</a>.</p>
        </LegalSection>
      </div>
    </>
  );
}

export function TermsPage() {
  return (
    <>
      <PageIntro eyebrow={`Terms of service · Updated ${lastUpdated}`} title="Terms for using Tab." description="These terms govern access to the Tab website, native macOS app, account dashboard, and Free and Pro plans." />
      <div className="py-8 sm:py-12">
        <LegalSection title="Agreement">
          <p>By creating an account, downloading Tab, or using the service, you agree to these terms and the <a href="/privacy">Privacy Policy</a>. If you do not agree, do not use the service.</p>
          <p>You must be able to form a binding contract where you live. If you use Tab for an organization, you represent that you have authority to accept these terms for that organization.</p>
        </LegalSection>
        <LegalSection title="The service">
          <p>Tab provides Automatic Suggestions through local inference and provides Deep Complete through an explicit cloud-backed action in supported macOS text fields. Local inference does not silently fall back to Deep Complete.</p>
          <p>Suggestions may be incomplete, inaccurate, or unsuitable for a particular context. You are responsible for reviewing text before accepting, sending, publishing, or relying on it.</p>
          <p>Compatibility may vary by macOS version, application, editor, hardware, and permissions. We may improve, change, suspend, or discontinue parts of the service.</p>
        </LegalSection>
        <LegalSection title="Accounts">
          <p>Provide accurate account information, keep credentials secure, and promptly tell us about suspected unauthorized access. You are responsible for activity on your account and connected devices.</p>
          <p>One person or organization may not use the service to bypass plan limits, probe other accounts, or interfere with service operation.</p>
        </LegalSection>
        <LegalSection title="Plans and payment">
          <p>Every new account receives one 30-day Pro trial without a payment card. The trial does not restart when you reinstall Tab or connect another Mac. When the trial ends, the account moves to Free unless you complete checkout for Pro.</p>
          <p>Plan prices, daily Local Accepted Word allowances, monthly Deep Complete allowances, device limits, and included features are shown on the <a href="/pricing">pricing page</a>. Local usage counts only words deliberately inserted through Acceptance. Deep Complete usage counts when an explicit request returns a Suggestion. Retries, empty responses, failures, and ignored Local Suggestions do not count.</p>
          <p>Tab does not charge automatic usage overages. Reaching one allowance does not disable unrelated product capabilities. Allowances become available again at their applicable daily or monthly reset.</p>
          <p>Pro renews monthly or annually, according to the interval selected at checkout, until canceled through the <a href="/billing/portal">billing portal</a>. Canceling stops future renewal; paid benefits remain active through the end of the current paid period, then the account moves to Free.</p>
          <p>Fees are charged in the displayed currency and may include applicable taxes. Except where required by law, charges for a billing period that has begun are non-refundable. Changing a billing interval may affect charges for the current or next billing period as shown during checkout or in the billing portal.</p>
          <p>Trial expiration, downgrade, or cancellation does not remove your ability to view, edit, export, or delete existing Personal Memory. Data processing is described in the <a href="/privacy">Privacy Policy</a>.</p>
        </LegalSection>
        <LegalSection title="Acceptable use">
          <p>Do not use Tab to break the law, violate another person's rights, distribute malware, gain unauthorized access, harass others, generate abusive automated traffic, reverse engineer protected service components, or evade technical and billing limits.</p>
          <p>You retain responsibility for the text you write and accept. Do not submit content you lack the right to process.</p>
        </LegalSection>
        <LegalSection title="Ownership">
          <p>You retain rights in your writing and information you provide. These terms give Tab the limited permission needed to process that information to operate and improve the service.</p>
          <p>Tab's software, branding, website, and service materials remain owned by their respective owners and are protected by applicable intellectual-property laws. Open-source components remain subject to their own licenses.</p>
        </LegalSection>
        <LegalSection title="Termination">
          <p>You may stop using Tab at any time. We may suspend or terminate access when reasonably necessary to protect the service, comply with law, address non-payment, or respond to a material violation of these terms.</p>
          <p>Terms that by their nature should continue after termination, including ownership, disclaimers, liability limits, and dispute provisions, will continue.</p>
        </LegalSection>
        <LegalSection title="Disclaimers">
          <p>To the extent permitted by law, Tab is provided “as is” and “as available” without warranties of uninterrupted operation, error-free Suggestions, compatibility with every application, or fitness for a particular purpose.</p>
          <p>Nothing in these terms excludes warranties or rights that cannot legally be excluded.</p>
        </LegalSection>
        <LegalSection title="Liability">
          <p>To the extent permitted by law, Tab and its contributors will not be liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits, data, goodwill, or business opportunities arising from use of the service.</p>
          <p>Where liability cannot be excluded, aggregate liability will be limited to the amount you paid for Tab during the three months before the event giving rise to the claim, or USD $25 if you used only a free plan.</p>
        </LegalSection>
        <LegalSection title="Changes and contact">
          <p>We may update these terms as the service changes. Continued use after an updated version takes effect means you accept the revised terms. If a change materially affects your rights, we will provide reasonable notice when appropriate.</p>
          <p>Questions about these terms can be sent to <a href="mailto:tab@cueva.io">tab@cueva.io</a>.</p>
        </LegalSection>
      </div>
    </>
  );
}
