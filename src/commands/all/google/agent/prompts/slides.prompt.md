# Google Slides

## Building Slides

Decks are styled explicitly per element from the Design Tokens section — never from the theme. Workflow:

1. Plan the slide sequence: each slide gets a purpose, one layout recipe, and its content. Respect the spacing law — overflow means another slide, not smaller text.
2. `create_presentation`, then `get_presentation_outline`. The fresh deck contains one default slide with theme placeholders: delete it (`deleteObject` on its objectId) and build BLANK slides instead.
3. Compose one slide per batch: `createSlide` with `slideLayoutReference: {predefinedLayout: 'BLANK'}` and YOUR OWN `objectId` (`slide-1`, `slide-2`, …); `createShape` (shapeType TEXT_BOX) with your own objectIds (`slide-1-title`, `slide-1-body`); `insertText` into them; then style EVERY text run — `updateTextStyle` with `textRange: {type: 'ALL'}`, `style: {fontFamily, fontSize: {magnitude, unit: 'PT'}, foregroundColor: {opaqueColor: {rgbColor}}}` and matching `fields` — plus `updateParagraphStyle` for alignment and `createParagraphBullets` (preset BULLET_DISC_CIRCLE_SQUARE) for lists. Section backgrounds via `updatePageProperties` (`pageBackgroundFill.solidFill`).
4. Shape geometry goes in `createShape.elementProperties`: `{pageObjectId, size: {width: {magnitude, unit: 'EMU'}, height: {...}}, transform: {scaleX: 1, scaleY: 1, translateX, translateY, unit: 'EMU'}}`. Font sizes in PT; positions and sizes in EMU (1pt = 12700 EMU). **Shared-edge law:** elements meant to align share the exact same number — columns share translateY and height, stacked blocks share translateX and width, gaps are computed (position + size + gutter), never eyeballed. When you adjust one column, apply the same numbers to its siblings in the same batch.
5. After composing each slide, `inspect_slide_visually`. Fix every reported defect with a follow-up batch, re-inspect, cap two fix rounds per slide, then move on and note residual issues in your report.
6. Once ALL slides are composed, run `inspect_deck_visually` ONCE and fix its cross-slide findings (title drift, palette drift, monotony), re-inspecting only the slides you touched. One fix round — the deck pass is a net, not a loop; note residual nits in your report instead of chasing them, and budget steps so the final report always gets written.
7. Speaker notes: give every content slide 2-4 spoken-style sentences via `insertText` into its `notesObjectId` (from `get_presentation_outline`). Notes carry what the presenter says, not what the slide shows.

Layout recipes (EMU, aligned with Design Tokens). Variety rule: never use the same layout on more than two consecutive slides — bullet monotony reads as laziness; break runs with a big number, quote, or chart slide.

- **Title slide** — title box at translate {609600, 1800000}, size 7924800 x 900000, deckTitle size, heading font, text color, centered; subtitle box at {609600, 2800000}, size 7924800 x 500000, body size, mutedText, centered.
- **Section divider** — surface background; section title at {609600, 2100000}, size 7924800 x 800000, sectionTitle size, left-aligned.
- **Agenda** — content recipe, but each item numbered, one line each, body size with generous line spacing; ≤6 items.
- **Content slide** — title box at {609600, 609600}, size 7924800 x 530000; body box at {609600, 1350000}, size 7924800 x 3180000, body size, bullets.
- **Two-column comparison** — title per content recipe; left column at {609600, 1350000} size 3860000 x 3180000, right column at {4674000, 1350000} size 3860000 x 3180000; column headers bold, accent.
- **Timeline** — title per content recipe; 3-5 milestone text boxes evenly spaced across width at y 2200000, each ~1400000 wide: date caption (mutedText) above a short bold label; a thin accent-filled rectangle (createShape RECTANGLE, height ~25000) spanning the content width at y 2150000 behind them.
- **Quote** — surface background; quote text at {914400, 1700000}, size 7315200 x 1400000, sectionTitle size, italic, centered; attribution below, caption size, mutedText, centered.
- **Big number** — number box at {609600, 1600000}, size 7924800 x 1500000, bigNumber size, accent, centered; caption below at {609600, 3200000}, size 7924800 x 400000, body size, mutedText, centered.
- **Chart slide** — title box per content recipe; a live-linked chart via `createSheetsChart` at translate {609600, 1350000}, size 7924800 x 3180000 (native charts need Sheets tools; load them with load_workspace_tools only when this mission needs a sheet-backed chart).

### Photo-background slides

The strongest-looking decks are often photos with text overlaid. When the mission supplies images (or asks for this style), build title slides, section dividers and quote slides this way:

1. Stage each photo once with `upload_image` — one staged URL can back many slides.
2. Set it as the slide background (`stretchedPictureFill`, see Images).
3. **Scrim before text**: a full-page RECTANGLE (0,0 → 9144000 x 5143500) with `shapeBackgroundFill: {solidFill: {color: {rgbColor: <background role color>}, alpha: 0.4}}` and `outline: {propertyState: 'NOT_RENDERED'}`. Raise alpha to ~0.55 for busy photos, or make the scrim a half-page panel and put all text inside it. Create scrim first, text boxes after — later elements stack on top.
4. Text on photos: near-white (or the theme background color if the scrim is light), one size up from the flat-slide recipe, fewer words. A title slide over a photo carries at most a title and one subtitle line.
5. Verify with `inspect_slide_visually` — if any word fights the photo, thicken the scrim, don't shrink the text.

Use photo backgrounds for the deck's emotional beats (title, dividers, quote, closing); keep dense content slides on flat backgrounds so the photos stay special. Never place body bullets or tables over a photo.

### Designed backgrounds (SVG)

No photos supplied? Author the background art yourself — this is how decks get gradients, glows and geometry the Slides API cannot draw. Write a self-contained SVG (root `width="1920" height="1080"`; no scripts or external URLs — namespace declarations are fine), render it with `render_svg`, and set it exactly like a photo background (`stretchedPictureFill`). A scrim is usually unnecessary — you control the contrast; keep the text zones quiet instead.

Design from the theme colors. Reliable moves:

- one diagonal linear gradient between the background color and a 10-20% lightened or hue-shifted variant
- 2-3 large radial-gradient circles in the accent color at 8-20% opacity, centers pushed toward corners or off-canvas, for soft glows
- one sparse geometric layer at low opacity: a dot grid, thin diagonal lines, or a single large outlined circle cropped by the edge
- keep the title band and text areas nearly flat; put the visual interest in corners and edges

One base background reused on every content slide plus a bolder variation for the title and dividers reads as a designed system, not decoration. `feGaussianBlur` renders well through rsvg/Chromium. If `render_svg` reports no renderer is available, fall back to flat theme backgrounds and note it in your report.

### Diagrams

Prefer a diagram over bullets whenever the mission describes a process, structure, or comparison:

- **Flowchart** — boxes as `createShape` RECTANGLE/ROUND_RECTANGLE (surface fill, body-size text, your own objectIds), connected with `createLine` `{lineCategory: 'BENT'}` then `updateLineProperties` `{objectId, lineProperties: {startConnection: {connectedObjectId, connectionSiteIndex: 3}, endConnection: {connectedObjectId, connectionSiteIndex: 1}, lineFill: {solidFill: {color: {rgbColor: <mutedText>}}}, weight: {magnitude: 2, unit: 'PT'}}, fields: 'startConnection,endConnection,lineFill,weight'}`. Connected lines re-route when boxes move — always connect, never draw floating lines between boxes.
- **Quadrant (2x2)** — two STRAIGHT full-span lines crossing at the content-box center (accent, 1pt); four caption-size axis labels at the ends; items as small text boxes placed in their quadrants.
- **Funnel** — 3-5 centered rectangles of decreasing width (equal ~500000 EMU height, 100000 gap), fills stepping accent → surface, centered labels inside.

## Images in Slides

- Slides: `createImage` `{objectId, url, elementProperties: {pageObjectId, size, transform}}`. Size to the image's aspect ratio — never stretch. A logo belongs small (height ~400000 EMU) in a corner or above the title on the title slide.
- Slide photo background: `updatePageProperties` `{objectId: <slideId>, pageProperties: {pageBackgroundFill: {stretchedPictureFill: {contentUrl: <url>}}}, fields: 'pageBackgroundFill'}` — the photo sits behind every element. Prefer ~16:9 images (e.g. 1920x1080); the fill stretches to the page. See Photo-background slides for the full recipe.

Verify each placed image with inspect_slide_visually after composing its slide.

## Mission patterns

- **Distill** (doc → deck): `read_file` the doc, plan slides around its *argument* — one idea per slide, numbers become big-number or chart slides, never paragraphs pasted onto slides.
- **Expand** (deck → doc): outline + notes become a full written document with real prose transitions.
- **Talk track**: from a deck, write a doc with the spoken script per slide, building on the speaker notes.
- **Style transfer**: when the mission says "make it look like <reference deck>", first `inspect_deck_visually` on the reference with a purpose like "describe the visual system precisely: background/text/accent colors as best-guess hex, heading font character, title placement, spacing rhythm" — then style the new deck with those observed values in place of the Design Token colors (the explicit-styling law still applies; only the values change).
- **Template populate**: `copy_file` the template, `get_presentation_outline` the copy, fill via `replaceAllText` on its placeholders. Do NOT restyle a branded template — its design is the point.

## Native linked charts

A native linked chart requires a source spreadsheet. Call load_workspace_tools with formats: ["sheet"] before creating that source. Name it "<Deck title> — data", write the data and chart there, then embed via createSheetsChart with spreadsheetId, chartId, linkingMode: "LINKED", and the chart-slide geometry. Include both URLs in the report. Ordinary text, numbers, tables, and diagrams require no companion spreadsheet. Never create one merely because a deck contains data.

## Feedback in Slides

Some missions ask for feedback or analysis with no edits ("look at each slide and give feedback"). Walk `get_presentation_outline` for the text, then look with `inspect_slide_visually`/`inspect_deck_visually` passing a `purpose` that states the feedback the mission wants — without a purpose those tools do strict layout QA only, which is too narrow for review missions. Your final report IS the deliverable: per-slide feedback, concrete and prioritized. Touch nothing unless the mission asks for fixes.

For anchored comments, pass both slideObjectId and elementObjectId from the outline. Use a slide-level comment only for whole-slide feedback.

- **Annotation pins (Slides)** put feedback INSIDE the deck content at the exact element: for each issue, place a small numbered badge on the slide — `createShape` ELLIPSE, objectId `annotation-1`, `annotation-2`, …, ~300000 EMU circle at the issue location, accent fill, white bold number ①-style — and start the matching comment with the same number ("① Slide 4, headline box: ..."). Pins are content, so they carry a cleanup contract: their reserved `annotation-` prefix is how a later mission ("clear the annotations", or after addressing feedback) finds and `deleteObject`s them. Use pins when anchored comments are unavailable, or when the mission explicitly wants visual markup drawn on the slides.

- **Speaker notes (Slides)** hold per-slide feedback readable in edit view beneath each slide — good for talk-track advice that isn't defect-shaped.
