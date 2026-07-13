# Tab Brand Foundation

> Status: Brand foundation and current logo specification. This is not a complete identity manual.

## Purpose

This document translates Tab's product truth into direction for an abstract, minimal logo. It defines what the mark should communicate, which visual ideas are worth exploring, and how concepts will be judged.

`CONTEXT.md` remains the source of truth for product language. `docs/PRD.md` defines product behavior and trust boundaries. `docs/design-system.md` and the shared `@tab/ui` tokens define the interface system. This brief should remain consistent with those documents rather than replacing them.

The canonical mark is [`packages/ui/src/assets/brand/tab-mark.svg`](../packages/ui/src/assets/brand/tab-mark.svg). The outlined title-case lockup is [`packages/ui/src/assets/brand/tab-lockup.svg`](../packages/ui/src/assets/brand/tab-lockup.svg). They replace the provisional `T` in an orange rounded square.

## Brand Essence

> **A small, deliberate continuation.**

Tab helps writing keep pace with thought by offering the next few words where a person is already typing. The help is immediate but restrained. It waits to be accepted. It should feel less like handing work to an assistant and more like thought continuing without friction.

The emotional outcome is **momentum without surrendering control**.

## Product Truth

Tab is a macOS-native autocomplete utility. It observes recent text-bearing Typing Context, offers one short Suggestion, and inserts that Suggestion into the Active Application only after deliberate Acceptance.

Automatic Suggestions use local inference by default. Deep Complete is a separate, explicit cloud-backed action for harder writing moments. Personal Memory can improve relevance while remaining visible and controllable.

The initial audience is Mac-based developers and technical founders who write across tools such as Slack, email, Linear, GitHub, terminals, and AI coding tools. They value speed and technical capability, but they are especially sensitive to interruption, vague privacy claims, and software that overreaches.

### Tab Is

- A quiet extension of typing.
- A short, relevant next step.
- Local-first and consent-led.
- Present across supported Mac writing surfaces.
- Precise enough for technical work and calm enough for everyday writing.

### Tab Is Not

- A chatbot or prompt destination.
- An autonomous author.
- A browser extension or browser autocomplete product.
- A raw keystroke log or hidden profile.
- A magical AI personality.
- A guarantee of compatibility with every application or Mac.

## Brand Promise

**Tab keeps writing moving with private-by-default Suggestions and more capability when the user explicitly asks for it.**

The four requested ideas do not need four separate symbols. They form a hierarchy:

| Idea | Role in the brand | What it means | Useful visual translation |
| --- | --- | --- | --- |
| **Continuation** | Primary | A short next step that extends an existing thought | Extension, transition, interval, junction, resolved gap |
| **Private** | Behavioral | Local-first processing, bounded context, visibility, and deliberate Acceptance | Agency, boundary, containment, chosen opening |
| **Smart** | Qualitative | Relevant help that fits context and remains subordinate to the writer | Alignment, fit, precise relationship, quiet resolution |
| **Fast** | Experiential | Less friction and less interruption in the writing rhythm | Economy, directness, forward bias, compact movement |

The mark should communicate continuation first. Privacy, intelligence, and speed should determine how that continuation feels.

## Personality

Tab is **quiet, precise, capable, respectful, and developer-fluent**.

| Aim for | Avoid |
| --- | --- |
| Fast | Frantic |
| Smart | Magical |
| Private | Defensive |
| Helpful | Autonomous |
| Native | Imitative of Apple |
| Technical | Cold or cryptic |
| Abstract | Arbitrary |
| Confident | Loud |

The voice and visual identity should state what Tab does plainly. Confidence comes from specificity and restraint, not superlatives.

## Logo Objective

The logo should make the next step feel **immediate, controlled, and effortless**.

A successful mark will suggest that one thing can continue into another without breaking the user's flow. It should feel complete as a small symbol while retaining a purposeful interval, opening, or transition.

Recognition priorities are:

1. Continuation.
2. Control.
3. Quiet intelligence.
4. Speed.

A literal `T` is not required. A latent or emergent `T` is valuable only if it strengthens the product idea. The symbol is the first design problem; typography and a `Tab` wordmark lockup should follow after the symbol is resolved.

## Selected Mark

The Tab mark is one horizontal form split by a deliberate forward-leaning seam. The outer silhouette remains continuous while the fitted gap separates what is already written from what Tab offers next.

- The shared outer line represents writing already in motion.
- The gap represents the moment between a Suggestion and deliberate Acceptance.
- The fitted seam suggests intelligence through precise fit rather than AI symbolism.
- The horizontal movement feels fast without using an arrow, bolt, or speed line.
- The independent silhouette avoids relying on a letter, container, gradient, or background color.

The mark is implemented as two four-point paths in a `24x24` viewBox. It occupies 22 horizontal units, works as `currentColor`, and retains a visible seam at 16px. Square outer terminals keep the shape precise without introducing decorative corners.

The canonical lockup uses title case `Tab` in Space Grotesk Bold. The capital `T` balances the mark's horizontal mass more cleanly than the lowercase `t`, while the rounded counters in `a` and `b` keep the signature from feeling severe. The mark and wordmark share an optical center, and the clear interval between them is approximately half the wordmark cap height.

## Visual Principles

### One Clear Gesture

Build the mark from one memorable relationship, not several clever details. It should be describable in a short phrase and recognizable by silhouette.

### Continuation Through Relationship

Explore extension, transition, a deliberate gap, a junction, or a bounded opening. The strongest idea is likely to live between forms rather than in a literal object.

### Privacy Through Agency

Privacy should feel like the user controls a boundary. It should not look fortified, fearful, or secretive. Tab observes enough context to help, then waits for Acceptance; the visual idea should preserve that sense of permission.

### Intelligence Through Fit

Intelligence should appear as precision: forms that align, complete, or resolve one another in an unexpectedly simple way. Avoid visual shorthand for artificial intelligence.

### Speed Through Economy

Speed should come from a compact, direct form with forward bias. It should not depend on motion effects or symbols associated with force. Tab removes friction; it does not race the user.

### Monochrome Before Accent

Design and judge the mark in one color first. The existing burnt orange, `#c83f00`, may become a recognition accent, but color must never be the feature that makes the mark understandable.

The mark should work as `currentColor`, near-black on the warm-light canvas, warm-white on the dark canvas, and in the product accent. Do not introduce a new logo palette during concept exploration.

## Concept Territories

These territories are prompts for sketching, not predetermined solutions.

### 1. The Continuation Gap

One form resolves or extends another across a deliberate interval. The negative space represents the brief moment between what the person typed and what Tab offers next.

This is the primary territory because it holds the product interaction in one idea: context, Suggestion, and deliberate Acceptance.

Watch for marks that become a generic chain link, pause icon, or right-pointing arrow.

### 2. The Guided Advance

A compact form changes state or advances along a precise path. The movement should feel guided and frictionless rather than fast for its own sake.

This territory can express rhythm and immediacy while keeping the mark calm.

Watch for play buttons, paper planes, chevrons, and logistics or delivery branding.

### 3. The Local Boundary

A continuation begins within a contained space and opens at one chosen point. The enclosure suggests local-first operation; the opening suggests explicit capability and user control.

This territory can support the privacy story without turning the mark into a security badge.

Watch for locks, shields, boxes, browser tabs, and cloud-upload symbols.

Start exploration with **The Continuation Gap**. Borrow from the other territories only when doing so makes the core relationship clearer, not more complex.

## Avoid

- Browser tabs, browser chrome, and stacked web pages.
- A literal keyboard key as the entire idea.
- Generic AI sparkles, brains, neural nodes, circuit traces, chat bubbles, magic wands, and robots.
- Locks, shields, eyes, fingerprints, keyholes, and surveillance motifs.
- Lightning bolts, arrows, wings, and speed streaks used as shorthand for performance.
- Clouds as the dominant symbol. Local inference is the center of gravity.
- Apple silhouettes or imitations of macOS system icons.
- A generic standalone `T` without a second, product-specific idea.
- Gradients, glow, glass, shadows, fake depth, and ornamental details.
- Fine lines or internal details that disappear at menu-bar and favicon sizes.

## Construction Principles

- Prefer a strong filled silhouette and intentional negative space.
- Use few geometric decisions and make each one visible at small sizes.
- Favor optical balance over mathematical novelty.
- Keep corners and transitions precise without making the mark feel sharp or aggressive.
- Avoid relying on a surrounding rounded square; the symbol should work by itself and inside an app-icon container.
- If strokes are used during exploration, expand them to filled paths before production.
- Do not use embedded raster images, text elements, filters, masks that rasterize, or unnecessary SVG metadata.

## Required Contexts

The primary mark must remain recognizable in every context below.

| Context | Working size | Requirement |
| --- | ---: | --- |
| macOS menu bar | 16px | Clear single-color template silhouette |
| Browser favicon | 16px and 32px | Distinct without an enclosing color tile |
| Web and desktop lockup | 32px | Balanced beside the short `Tab` wordmark |
| Compact product UI | 16px to 24px | Legible among other application icons |
| Social avatar | 400px | Ownable at a glance without added detail |
| macOS app icon | 16px to 1024px | Works inside a separate square icon composition |
| Light and dark surfaces | Any | Equivalent contrast and visual weight |

The canonical asset should be true SVG geometry with a clean `viewBox`. It should support a monochrome `currentColor` version, an inverse version, and an accent application derived from the same geometry.

## Evaluation Scorecard

Score each concept from 1 to 5. A concept must pass all three gates before subjective comparison.

### Gates

- Recognizable at 16px in one color.
- Free of every motif in the Avoid list.
- Not mistaken for a browser tab, keyboard key, or generic security product.

### Scored Criteria

| Criterion | Review question |
| --- | --- |
| Continuation | Does it suggest a next step before it suggests security or AI? |
| Quiet precision | Does it feel calm, exact, and intentional? |
| User control | Does it imply agency or a deliberate boundary without literal security imagery? |
| Effortless speed | Does it feel direct and quick without aggression or instability? |
| Distinctiveness | Could it be recognized among generic productivity and AI marks? |
| Product fit | Does the idea become stronger after learning how Tab works? |
| Small-size clarity | Does the silhouette survive at 16px and 32px? |
| Theme flexibility | Does it carry equal weight on light and dark surfaces? |
| Wordmark compatibility | Can it sit naturally beside the short name `Tab`? |
| Independence | Does it make sense without animation or a verbal explanation? |

Prefer the concept with the clearest product-specific relationship, not the concept with the most embedded meanings.

## Claim Guardrails

Logo exploration will often produce words and rationales that later influence marketing. Keep those rationales accurate:

- Say **local by default**, not that everything always stays on the Mac.
- Say **across supported Mac applications or writing surfaces**, not that every application is guaranteed to work.
- Describe Deep Complete as an **explicit cloud-backed action**, never an automatic fallback.
- Describe the output as a **Suggestion**, not a prediction.
- Describe insertion as deliberate **Acceptance**, not autonomous writing.
- Describe speed as reduced friction and responsive rhythm, not as an unqualified latency promise.
- Describe privacy through bounded context, local processing, visibility, and control, not through absolutes.

## Asset System

The public [`/brand`](../apps/web/src/components/pages/brand.tsx) surface presents the current mark, title-case lockup, light and dark applications, palette, typography, usage guidance, and SVG, PNG, WebP, and JPG downloads.

Future application work may derive the favicon, macOS menu-bar template, app icon, and social templates from the same geometry. Those formats should not change the seam, proportions, or wordmark relationship defined here.

## References

- [`CONTEXT.md`](../CONTEXT.md)
- [`docs/PRD.md`](./PRD.md)
- [`docs/product-strategy.md`](./product-strategy.md)
- [`docs/design-system.md`](./design-system.md)
- [`packages/ui/src/styles/globals.css`](../packages/ui/src/styles/globals.css)
- [`packages/ui/src/components/app/patterns.tsx`](../packages/ui/src/components/app/patterns.tsx)
