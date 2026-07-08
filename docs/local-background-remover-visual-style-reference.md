# Visual Style Reference: Local Background Remover

## 1. Core Aesthetic

**Private Utility Grid**

Local Background Remover uses a quiet, monochrome, grid-backed interface that makes image cleanup feel private, precise, and dependable while preserving enough warmth for a consumer Mac app.

Key influences and hybrid styles identified:

- **Local-first Mac utility:** restrained neutral palette, rounded panels, soft surfaces, clear “do the thing” controls.
- **Developer tooling:** monospace command blocks, CLI examples, JSON output, copy controls, and proof-oriented technical messaging.
- **E-commerce image workflow:** before/after comparison sliders, transparent PNG checkerboards, product-photo cards, and direct proof imagery.
- **Indie SaaS launch page:** sticky pricing CTA, promo marquee, social proof mosaic, open-source section, and dark conversion footer.
- **Swiss/utility minimalism:** tight typographic hierarchy, strong borders, modular sections, minimal color, and disciplined spacing.

Primary design tension:

- The style balances **soft private workspace** against **high-contrast commercial action**.
- It feels calm and low-risk, but the black CTA system, sticky bars, and promo marquee add urgency.
- It bridges **consumer visual proof** with **developer automation credibility**.

## 2. Color Palette

Total color count: **36 listed color tokens, 34 unique hex values, plus 3 transparency treatments**.

The source design is intentionally neutral-first. Color is used sparingly for status, charts, proof metrics, and the dark CTA/footer moment.

### Light Mode Core Tokens

| Color name | Hex code | Usage context |
| --- | --- | --- |
| Canvas White | `#FAFAFA` | Main page background, app shell, site frame background, radial page wash. |
| Ink Black | `#0A0A0A` | Primary text, primary CTA background, strongest foreground. |
| Pure Card | `#FFFFFF` | Cards, popovers, badges, inputs, image containers. |
| Card Ink | `#171717` | Card foreground, accent text, ring color, section heading fallback. |
| Soft Surface | `#F5F5F5` | Secondary panels, command block background, card footers, subtle section contrast. |
| Secondary Ink | `#262626` | Secondary button text and medium-emphasis labels. |
| Muted Ink | `#525252` | Body copy, descriptions, eyebrow text, captions, helper text. |
| Hairline Border | `#E5E5E5` | Borders, grid lines, dividers, card outlines, table lines. |
| Input Border | `#D4D4D4` | Form field borders and lower-emphasis structural lines. |
| Disabled Gray | `#A3A3A3` | Recommended disabled text/icons and tertiary metadata. |
| Footer Wash | `#F3F3F3` | Footer lower area background. |
| Night CTA | `#0B0C12` | Dark hero/footer conversion block and dark-mode base. |

### Light Mode Semantic Tokens

| Color name | Hex code | Usage context |
| --- | --- | --- |
| Success Green | `#16A34A` | Operational status, positive metrics, success indicators. |
| Success Wash | `#DCFCE7` | Soft success backgrounds and light status panels. |
| Warning Orange | `#EA580C` | Warning states, urgency, promotional metadata. |
| Warning Wash | `#FFEDD5` | Soft warning background. |
| Info Blue | `#2563EB` | Informational metrics, links when color is needed, chart accent. |
| Info Wash | `#DBEAFE` | Soft informational background. |
| Destructive Red | `#DC2626` | Errors, destructive actions, validation failures. |
| Chart Purple | `#7C3AED` | Optional analytics/data visualization accent. |
| Chart Teal | `#14B8A6` | Optional analytics/data visualization accent. |
| Review Yellow | `#FDE047` | Star ratings and review proof chips in dark sections. |

### Dark Mode Core Tokens

| Color name | Hex code | Usage context |
| --- | --- | --- |
| Dark Canvas | `#0B0C12` | Main dark-mode page background; inherited from the live dark CTA/footer. |
| Dark Ink | `#FAFAFA` | Primary text on dark backgrounds. |
| Dark Card | `#12141B` | Cards, sticky CTA cards, popovers, dark surface blocks. |
| Dark Card Raised | `#171A22` | Raised cards, selected tabs, command blocks, media shells. |
| Dark Secondary | `#1F222B` | Secondary surfaces, hover states, subtle panels. |
| Dark Border | `#2A2E38` | Borders and dividers in dark mode. |
| Dark Input | `#3A3F4B` | Inputs, slider tracks, stronger dividers. |
| Dark Muted Ink | `#A1A1AA` | Descriptions, helper copy, captions. |
| Dark Tertiary Ink | `#71717A` | Eyebrows, timestamps, inactive nav. |
| Dark Grid Line | `#FFFFFF0D` | 5% white grid lines over dark canvas. |

### Dark Mode Semantic Tokens

| Color name | Hex code | Usage context |
| --- | --- | --- |
| Success Deep Wash | `#052E16` | Dark success backgrounds. |
| Warning Deep Wash | `#431407` | Dark warning backgrounds. |
| Info Deep Wash | `#172554` | Dark info backgrounds. |
| Destructive Deep Wash | `#450A0A` | Dark destructive backgrounds. |

### Transparency Treatments

| Treatment name | Value | Usage context |
| --- | --- | --- |
| Light Grid Line | `rgb(229 229 229 / 46%)` | 64px global page grid over light canvas. |
| Card Glass | `rgb(255 255 255 / 95%)` | Card/site-frame surfaces that sit over textured backgrounds. |
| Header Blur | `background / 74-88% + backdrop-blur-md` | Sticky header and sticky CTA overlays. |

Mode guidance:

- Keep the **primary CTA black in light mode** and invert it to **white text on dark raised card** or **white button on dark canvas** in dark mode.
- Preserve the grid in both modes, but reduce contrast in dark mode; the texture should be felt, not read.
- Keep semantic colors close to Tailwind 600 hues for clarity, but use deep washes in dark mode to avoid neon panels.
- Use color accents only for status, metrics, review stars, and proof. The brand should remain mostly monochrome.

## 3. Typography System

Headline style:

- **Display family:** `Space Grotesk`, geometric sans, used via `--font-display` and `--font-heading`.
- **Display weights:** 400, 500, 600, 700 are available; the site primarily uses 500 for large headlines and 600 for the wordmark.
- **Hero scale:** `text-4xl` mobile to `text-6xl` desktop, approximately 36px to 60px.
- **Hero leading:** tight `1.06`, with negative tracking for a precise product feel.
- **Section scale:** `text-3xl` mobile to `text-5xl` desktop, approximately 30px to 48px.
- **Section leading:** tight `1.08`, preserving compact visual density.

Body and secondary text treatment:

- **Body family:** `Geist`, modern neo-grotesque sans, used via `--font-sans`.
- **Body size:** 14px to 16px for regular copy; marketing section copy can rise to 20px on desktop.
- **Body color:** `#525252` in light mode, `#A1A1AA` in dark mode.
- **Body line height:** 1.5 to 1.75; section copy uses generous leading around 28px to 32px.
- **Secondary copy:** muted, never decorative; used to reduce risk and explain privacy/offline value.

Hierarchy structure:

- **Level 1:** large `Space Grotesk`, medium weight, tight tracking, direct benefit statement.
- **Level 2:** section title, same display family, slightly smaller but still expressive.
- **Level 3/card title:** `Space Grotesk` or heading token, 16px to 20px, medium weight.
- **Body:** `Geist`, 14px to 16px, muted color, functional explanations.
- **Eyebrows/badges:** 10px to 11px, uppercase, medium weight, wide tracking, pill borders.
- **Code/CLI:** `Geist Mono`, 12px to 13px, used for shell commands, JSON output, file paths, and automation prompts.

Special considerations:

- The brand wordmark uses a lowercase, URL-like string: `local.backgroundrm`; this reinforces technical trust and search memorability.
- The system is English-first; there is no visible bilingual styling requirement in the source.
- CLI, JSON, and command examples are essential brand artifacts, not secondary documentation only.
- Avoid playful type pairings. The design works because `Space Grotesk`, `Geist`, and `Geist Mono` feel related but have clear roles.

## 4. Key Design Elements

### Textures and Treatments

- **Global grid texture:** two 1px linear gradients create a 64px by 64px technical canvas over the page.
- **Radial page wash:** a subtle top-center white radial gradient lightens the upper canvas and prevents the grid from feeling flat.
- **Dot grid proof section:** the quote block uses a 12px radial dot pattern with a transparent overlay, creating a lab/report feeling.
- **Checkerboard transparency pattern:** before/after media uses an 18px checkerboard to communicate PNG transparency and image-processing context.
- **Glass headers:** sticky header and sticky CTA use translucent backgrounds plus blur, preserving context while staying readable.
- **Low-shadow discipline:** the web UI mostly relies on borders and surface contrast; the desktop app adds a soft utility shadow: `0 18px 40px rgba(15, 23, 42, 0.07)`.

### Graphic Elements

- **Brand mark:** a simple square-with-inner-square SVG and cropped corner detail; it suggests cropping, masking, and image bounding boxes.
- **Section dividers:** thin `#E5E5E5` borders create a long-scroll modular rhythm.
- **Comparison sliders:** image cards include before/after labels, center divider, small circular handle, and direct manipulation.
- **Code cards:** command blocks are bordered, softly filled, and paired with copy buttons; they make automation feel tangible.
- **Status chips:** pill badges communicate offline, private, one-time purchase, operational status, and proof categories.
- **Metric cards:** small tilted cards in the quote section show values like `98.7%` and `1300ms`, adding technical believability without turning the site into a dashboard.
- **Promo marquee:** a black sticky top bar with uppercase tracking, repeated launch-sale text, and a code pill creates urgency while staying visually consistent.

### Layout Structure and Grid System

- **Site frame:** centered max-width container around `1080px`, with vertical border rails and `bg-background/95`.
- **Page rhythm:** stacked full-width sections inside the site frame, separated by border-top dividers.
- **Section padding:** `px-5 py-14` on mobile and `md:px-10 md:py-20` on larger screens.
- **Hero order:** proof imagery appears before the main H1, making the product result the first visual claim.
- **Card grids:** 1 column mobile, 2 columns tablet, 3 columns desktop for examples and testimonials.
- **Asymmetric marketing grids:** key explanatory sections use ratios like `1.05fr / 0.95fr` or `0.95fr / 1.05fr` instead of equal halves.
- **Sticky conversion:** top promo, sticky nav, and bottom sticky CTA create persistent buying paths without heavy color.

### Components and Interaction Language

- **Buttons:** 10px radius, 150ms ease-out transitions, active state translates down by 1px, focus ring uses 4px translucent ring.
- **Primary button:** black fill, white text, border-matched; reserved for purchase, pricing, and decisive actions.
- **Outline button:** white/card fill, gray border, black text; used for lower-risk navigation like examples, docs, install.
- **Ghost button:** transparent with muted text, used in navigation.
- **Cards:** 14px radius, 1px border, white or near-white fill, clipped overflow, compact internal spacing.
- **Badges:** full-pill or small rounded rectangles, uppercase 11px, bordered, muted text; used as section labels and proof tags.
- **Tables/tabs/accordions:** shadcn-style primitives with borders, rounded corners, and minimal ornamentation.
- **Inputs:** 40px height, 11px radius, 1px border, white background in light mode; focus is border-first rather than glow-heavy.
- **Toasts:** white glass surface, 14px radius, soft shadow, bottom-right placement.

### Unique Stylistic Choices

- The design places **before/after visual proof before the headline**, which is unusual for SaaS pages but fits an image tool.
- The brand avoids saturated primary colors; trust comes from restraint, transparency, and visible proof.
- The same design language works for both app buyers and CLI users by mixing product images with terminal/code artifacts.
- The dark footer is not a separate brand direction; it is a conversion-stage inversion of the same grid/border system.
- Rounded corners are consistent but not bubbly: 10px buttons, 12px small media, 14px cards, 20px large feature blocks.

## 5. Visual Concept

The design's conceptual bridge is **a private Mac workbench for image cleanup that also speaks fluent developer automation**.

Relationship between elements:

- The **grid background** represents precision, local files, image bounds, and a controlled work surface.
- The **neutral palette** communicates privacy, low friction, and professional utility.
- The **black CTA system** creates decisive commercial moments without introducing a separate brand color.
- The **image comparison sliders** provide immediate proof and make the product value physical.
- The **monospace command blocks** extend the same promise into scripts, coding agents, and repeatable workflows.
- The **badges and proof cards** reduce perceived risk by repeatedly naming privacy, offline work, open source, and one-time pricing.
- The **dark footer/CTA** closes the page with a premium, focused conversion environment while preserving the grid motif.

Ideal use cases:

- Local-first desktop apps, especially Mac productivity tools.
- AI/image-processing tools where privacy and proof matter.
- Developer-plus-consumer products with both GUI and CLI workflows.
- Open-source commercial software with a one-time purchase model.
- Privacy, security, automation, media, and e-commerce utility products.
- Landing pages that need to feel credible without looking enterprise-heavy.

Design rule of thumb:

- Start with **neutral structure**, add **proof through media**, add **trust through badges**, add **action through black/white contrast**, and reserve color for **state and evidence**.
