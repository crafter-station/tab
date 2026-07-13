import { DownloadSimple } from "@phosphor-icons/react";
import { PLATFORM_COLORS, TabMark, buttonVariants, cn } from "@tab/ui";
import { PageKicker } from "./shared.tsx";

const brandColors = [
  {
    name: "Tab Orange",
    token: "--primary",
    value: PLATFORM_COLORS.theme.light.primary,
    role: "Recognition accent and primary product actions",
  },
  {
    name: "Ink",
    token: "--foreground",
    value: PLATFORM_COLORS.theme.light.foreground,
    role: "Primary mark and wordmark on light surfaces",
  },
  {
    name: "Canvas",
    token: "--background",
    value: PLATFORM_COLORS.theme.light.background,
    role: "Warm-light brand field",
  },
  {
    name: "Night",
    token: ".dark --background",
    value: PLATFORM_COLORS.theme.dark.background,
    role: "Dark brand field",
  },
  {
    name: "Warm White",
    token: "--primary-foreground",
    value: PLATFORM_COLORS.theme.light.primaryForeground,
    role: "Inverse mark and wordmark",
  },
] as const;

const assetGroups = [
  {
    name: "Standalone mark",
    detail: "24 x 24 source viewBox",
    description: "Use when space is compact or the Tab name already appears nearby.",
    downloads: [
      { label: "SVG", detail: "Vector · adaptable", href: "/brand/tab-mark.svg", filename: "tab-mark.svg", surface: "light", transparent: true },
      { label: "PNG", detail: "1024 x 1024 · transparent", href: "/brand/tab-mark.png", filename: "tab-mark-1024.png", surface: "light", transparent: true },
      { label: "WebP", detail: "1024 x 1024 · transparent", href: "/brand/tab-mark.webp", filename: "tab-mark-1024.webp", surface: "light", transparent: true },
      { label: "JPG", detail: "1024 x 1024 · Canvas", href: "/brand/tab-mark-light.jpg", filename: "tab-mark-light-1024.jpg", surface: "light", transparent: false },
      { label: "Dark SVG", detail: "Vector · inverse", href: "/brand/tab-mark-dark.svg", filename: "tab-mark-dark.svg", surface: "dark", transparent: true },
      { label: "Dark PNG", detail: "1024 x 1024 · transparent", href: "/brand/tab-mark-dark.png", filename: "tab-mark-dark-1024.png", surface: "dark", transparent: true },
      { label: "Dark WebP", detail: "1024 x 1024 · transparent", href: "/brand/tab-mark-dark.webp", filename: "tab-mark-dark-1024.webp", surface: "dark", transparent: true },
      { label: "Dark JPG", detail: "1024 x 1024 · Night", href: "/brand/tab-mark-dark.jpg", filename: "tab-mark-dark-1024.jpg", surface: "dark", transparent: false },
    ],
  },
  {
    name: "Tab lockup",
    detail: "64 x 24 source viewBox",
    description: "Use for brand introductions, press material, and surfaces where the name should be explicit.",
    downloads: [
      { label: "SVG", detail: "Vector · outlined type", href: "/brand/tab-lockup.svg", filename: "tab-lockup.svg", surface: "light", transparent: true },
      { label: "PNG", detail: "1600 x 600 · transparent", href: "/brand/tab-lockup.png", filename: "tab-lockup-1600.png", surface: "light", transparent: true },
      { label: "WebP", detail: "1600 x 600 · transparent", href: "/brand/tab-lockup.webp", filename: "tab-lockup-1600.webp", surface: "light", transparent: true },
      { label: "JPG", detail: "1600 x 600 · Canvas", href: "/brand/tab-lockup-light.jpg", filename: "tab-lockup-light-1600.jpg", surface: "light", transparent: false },
      { label: "Dark SVG", detail: "Vector · inverse", href: "/brand/tab-lockup-dark.svg", filename: "tab-lockup-dark.svg", surface: "dark", transparent: true },
      { label: "Dark PNG", detail: "1600 x 600 · transparent", href: "/brand/tab-lockup-dark.png", filename: "tab-lockup-dark-1600.png", surface: "dark", transparent: true },
      { label: "Dark WebP", detail: "1600 x 600 · transparent", href: "/brand/tab-lockup-dark.webp", filename: "tab-lockup-dark-1600.webp", surface: "dark", transparent: true },
      { label: "Dark JPG", detail: "1600 x 600 · Night", href: "/brand/tab-lockup-dark.jpg", filename: "tab-lockup-dark-1600.jpg", surface: "dark", transparent: false },
    ],
  },
] as const;

function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-[0.55em]" aria-label="Tab">
      <TabMark className={compact ? "size-8" : "size-12 sm:size-14"} />
      <span className={compact
        ? "font-[var(--font-display)] text-2xl font-bold tracking-[-0.025em]"
        : "font-[var(--font-display)] text-4xl font-bold tracking-[-0.035em] sm:text-5xl"}
      >
        Tab
      </span>
    </div>
  );
}

function BrandSpecimen({ mode }: { mode: "light" | "dark" }) {
  const label = mode === "light" ? "Light field" : "Dark field";
  return (
    <article
      className={cn(
        "grid min-h-80 content-between gap-12 border border-border bg-background p-6 text-foreground sm:min-h-96 sm:p-9",
        mode === "light" ? "pug-theme-light" : "pug-theme-dark",
      )}
      data-brand-specimen={mode}
    >
      <div className="flex items-center justify-between gap-4 font-[var(--font-code)] text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <span>{label}</span>
        <span>{mode === "light" ? "Ink / Orange" : "Warm White / Orange"}</span>
      </div>
      <div className="grid justify-items-start gap-12 sm:grid-cols-2 sm:items-end sm:gap-8">
        <div className="grid gap-4">
          <TabMark className="size-28 text-foreground sm:size-32" />
          <span className="font-[var(--font-code)] text-[0.6875rem] uppercase tracking-[0.08em] text-muted-foreground">Mark</span>
        </div>
        <div className="grid gap-5">
          <BrandLockup />
          <div className="flex items-center gap-3">
            <TabMark className="size-8 text-primary" />
            <span className="font-[var(--font-code)] text-[0.6875rem] uppercase tracking-[0.08em] text-muted-foreground">Accent</span>
          </div>
        </div>
      </div>
    </article>
  );
}

export function BrandPage() {
  return (
    <>
      <header className="grid gap-6 border-b border-border pb-12 pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:pb-16 sm:pt-10">
        <div className="grid gap-5">
          <PageKicker>Brand assets</PageKicker>
          <h1 className="max-w-[13ch] text-balance font-[var(--font-display)] text-[clamp(3rem,7vw,6rem)] font-bold leading-[0.92] tracking-[-0.04em]">
            A small, deliberate continuation.
          </h1>
          <p className="max-w-[44rem] text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">
            The Tab mark is a single line continuing across the deliberate seam between a Suggestion and Acceptance.
          </p>
        </div>
        <a className={buttonVariants({ size: "lg" })} download="tab-brand-assets.zip" href="/brand/tab-brand-assets.zip">
          Download all
          <DownloadSimple data-icon="inline-end" aria-hidden="true" />
        </a>
      </header>

      <section className="py-16 sm:py-24" aria-labelledby="master-mark-title">
        <div className="mb-8 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,0.55fr)] sm:items-end">
          <div>
            <PageKicker>Master mark</PageKicker>
            <h2 id="master-mark-title" className="mt-4 max-w-[14ch] text-balance font-[var(--font-display)] text-4xl font-bold tracking-[-0.025em] sm:text-5xl">
              One form. One fitted seam.
            </h2>
          </div>
          <p className="text-pretty leading-relaxed text-muted-foreground">
            Use the mark in one color. Preserve the seam, keep the outer terminals square, and let the surrounding field provide contrast.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)] md:gap-0">
          <BrandSpecimen mode="light" />
          <div className="h-6 md:h-auto" aria-hidden="true" />
          <BrandSpecimen mode="dark" />
        </div>
      </section>

      <section id="downloads" className="scroll-mt-24 border-y border-border py-14 sm:py-20" aria-labelledby="downloads-title">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(16rem,0.55fr)] sm:items-end">
          <div>
            <PageKicker>Downloads</PageKicker>
            <h2 id="downloads-title" className="mt-4 font-[var(--font-display)] text-4xl font-bold tracking-[-0.025em]">Production assets</h2>
          </div>
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
            Standard SVG adapts with <code className="font-[var(--font-code)] text-foreground">currentColor</code>. PNG, WebP, and inverse dark files are transparent. JPG includes its light or dark background.
          </p>
        </div>
        <div className="mt-10 grid gap-12">
          {assetGroups.map((asset) => (
            <article className="border-t border-border pt-7" key={asset.name}>
              <div className="grid gap-3 sm:grid-cols-[minmax(12rem,0.6fr)_minmax(0,1fr)] sm:items-start sm:gap-8">
                <div>
                  <h3 className="text-lg font-bold">{asset.name}</h3>
                  <p className="mt-1 font-[var(--font-code)] text-[0.6875rem] uppercase tracking-[0.06em] text-muted-foreground">{asset.detail}</p>
                </div>
                <p className="max-w-[38rem] text-sm leading-relaxed text-muted-foreground">{asset.description}</p>
              </div>
              <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {asset.downloads.map((download) => (
                  <div className="brand-asset-card group grid gap-3" data-brand-download-preview={download.label} key={download.href}>
                    <div className={cn(
                      "relative aspect-[4/3] overflow-hidden border border-border bg-background",
                      download.surface === "light" ? "pug-theme-light" : "pug-theme-dark",
                      download.transparent && "brand-transparency-grid",
                    )}>
                      <img
                        alt={`${asset.name} ${download.label} preview`}
                        className={cn("size-full object-contain", download.transparent && "p-7")}
                        loading="lazy"
                        src={download.href}
                      />
                      <a
                        className={cn(
                          buttonVariants({ size: "sm" }),
                          "brand-asset-action absolute bottom-3 right-3 transition-[opacity,transform] duration-150 ease-[var(--tab-ease-out)]",
                        )}
                        download={download.filename}
                        href={download.href}
                      >
                        Download
                        <DownloadSimple data-icon="inline-end" aria-hidden="true" />
                      </a>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="text-sm font-bold">{download.label}</h4>
                      <p className="text-right font-[var(--font-code)] text-[0.625rem] uppercase leading-relaxed text-muted-foreground">{download.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="py-16 sm:py-24" aria-labelledby="colors-title">
        <PageKicker>Color</PageKicker>
        <h2 id="colors-title" className="mt-4 font-[var(--font-display)] text-4xl font-bold tracking-[-0.025em]">Brand colors</h2>
        <p className="mt-4 max-w-[42rem] text-pretty leading-relaxed text-muted-foreground">
          The identity is monochrome first. Orange is an accent, not a requirement for recognition.
        </p>
        <div className="mt-10 border-b border-border">
          {brandColors.map((color) => (
            <article className="grid gap-4 border-t border-border py-5 sm:grid-cols-[minmax(8rem,0.4fr)_minmax(0,1fr)] sm:items-center sm:gap-8" key={color.name}>
              <div className="h-16 border border-border" style={{ backgroundColor: color.value }} aria-hidden="true" />
              <div className="grid gap-2 sm:grid-cols-[minmax(8rem,0.7fr)_minmax(10rem,0.9fr)_minmax(0,1.5fr)] sm:items-baseline sm:gap-6">
                <h3 className="font-bold">{color.name}</h3>
                <div className="font-[var(--font-code)] text-xs text-muted-foreground">
                  <p>{color.token}</p>
                  <p className="mt-1 text-foreground">{color.value}</p>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{color.role}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-border py-14 sm:py-20" aria-labelledby="type-title">
        <PageKicker>Typography</PageKicker>
        <div className="mt-4 grid gap-10 lg:grid-cols-[minmax(0,0.65fr)_minmax(0,1.35fr)] lg:items-start">
          <div>
            <h2 id="type-title" className="font-[var(--font-display)] text-4xl font-bold tracking-[-0.025em]">A precise name, not a drawn wordmark.</h2>
            <p className="mt-4 text-pretty leading-relaxed text-muted-foreground">
              The lockup uses title case <strong className="text-foreground">Tab</strong> in Space Grotesk Bold. Its capital T balances the horizontal mark; the rounded counters keep the signature calm.
            </p>
          </div>
          <div className="border-b border-border">
            <div className="grid gap-3 border-t border-border py-6 sm:grid-cols-[8rem_1fr] sm:items-baseline">
              <p className="font-[var(--font-code)] text-xs uppercase text-muted-foreground">Display</p>
              <p className="font-[var(--font-display)] text-5xl font-bold tracking-[-0.035em] sm:text-6xl">Tab</p>
            </div>
            <div className="grid gap-3 border-t border-border py-6 sm:grid-cols-[8rem_1fr] sm:items-baseline">
              <p className="font-[var(--font-code)] text-xs uppercase text-muted-foreground">Body</p>
              <p className="text-xl font-medium">Writing should keep up with thinking.</p>
            </div>
            <div className="grid gap-3 border-t border-border py-6 sm:grid-cols-[8rem_1fr] sm:items-baseline">
              <p className="font-[var(--font-code)] text-xs uppercase text-muted-foreground">Shortcut</p>
              <p className="font-[var(--font-code)] text-xl font-semibold">Option+Tab</p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-24" aria-labelledby="usage-title">
        <PageKicker>Usage</PageKicker>
        <h2 id="usage-title" className="mt-4 font-[var(--font-display)] text-4xl font-bold tracking-[-0.025em]">Keep the relationship intact.</h2>
        <div className="mt-10 grid gap-10 border-y border-border py-8 md:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] md:gap-12">
          <div>
            <h3 className="text-lg font-bold">Use</h3>
            <ul className="mt-5 grid gap-3 text-sm leading-relaxed text-muted-foreground">
              <li>Use one color with clear contrast.</li>
              <li>Keep the seam open and the horizontal edges aligned.</li>
              <li>Use at least 16px for the mark and 32px within interface lockups.</li>
              <li>Leave clear space equal to one quarter of the mark height.</li>
            </ul>
          </div>
          <div className="hidden bg-border md:block" aria-hidden="true" />
          <div>
            <h3 className="text-lg font-bold">Avoid</h3>
            <ul className="mt-5 grid gap-3 text-sm leading-relaxed text-muted-foreground">
              <li>Do not close, widen, or decorate the seam.</li>
              <li>Do not add an enclosing tile, outline, gradient, glow, or shadow.</li>
              <li>Do not rotate, stretch, or rearrange the two forms.</li>
              <li>Do not combine the mark with AI, cloud, or security symbols.</li>
            </ul>
          </div>
        </div>
        <div className="mt-10 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <BrandLockup compact />
          <p className="text-sm text-muted-foreground">Questions about brand use: <a className="font-semibold text-foreground underline decoration-border underline-offset-4" href="mailto:tab@cueva.io">tab@cueva.io</a></p>
        </div>
      </section>
    </>
  );
}
