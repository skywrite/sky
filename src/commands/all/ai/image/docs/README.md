---
created: 2026-09-10
updated: 2026-09-10
---

# Image edits: selection, geometry and preservation

The command owns image generation for both CLI and web chat. The web host owns
retaining output files and displaying them; it does not select image settings.

Astra at low reasoning effort classifies intent and geometric complexity from
the brief and references. Localized edits preserve untouched content regardless
of medium: photos, illustrations, logos, icons, diagrams and other raster graphics.
Photographic preservation defaults to Sunburst/max and an approximately 8 MP
canvas. Graphic preservation selects quality by requirements and keeps supported
source dimensions; unsupported dimensions use a nearby valid canvas. Explicit
sizes, models and quality still win. The 8 MP photo default uses OpenAI's
experimental larger-resolution support. Creation and whole-image restyling keep
ordinary selection. Explicit model/quality skip classification only when there
are no references: reference edits still need an intent for preservation.

The contour planner first describes the complete replacement and its requirements,
then identifies working space, an initial final footprint and protected holes.
It receives a 1536px view at high image detail, separate from the selector's 512px
view. Simple geometry uses Astra low; new silhouettes, occlusions and precise
graphics use Astra high for planning and review. Protected holes win in both
masks. Newly covered source content is editable: protecting hair unconditionally,
for example, prevents a hat from covering it. Graphic edges can remain hard;
photographic transitions feather inside the editable footprint.
Working regions allow variation in the proposed silhouette; they must not trace
one guessed replacement so tightly that the review cannot recover its edges.

Contours are approximate model judgments, not a segmentation guarantee. A
supplied PNG alpha mask overrides both masks and remains fixed. Uncertain targets
or invalid masks stop the request; never silently retry an unmasked edit. Truly
global changes can classify as whole-image edits and report that scope.

## The coordinate and pixel contract

The normalized source is fitted without cropping onto the selected output
canvas. Any aspect-ratio mismatch is padded. This PNG is both the first API
reference and the compositing base. Both masks have exactly these dimensions;
transparent alpha means editable, opaque alpha means protected. Additional
references keep their original ordering. When space permits and the source has
different dimensions, the full-resolution original is appended as a detail
reference, with its purpose explained in the rendering prompt.

An API mask only guides generation. The broader working mask lets a replacement
grow beyond the original shape. The renderer composites with the narrower final
mask, copying the original wherever changes are unnecessary. The final mask is
intersected with the working mask, including its protected holes. Opaque mask
pixels copy the base unchanged, including alpha; soft edges blend only inside
the editable footprint. Preservation is exact **at output resolution**, after
source orientation, color normalization and resizing, not at the original
camera resolution. Never promise exact preservation within an editable region.
For a transparent editing canvas, automatic background selection resolves to the
API's transparent mode. A text instruction alone can produce painted checkerboard
pixels instead of alpha. Explicit background settings still win.

Generated dimensions must match the canvas. Reject mismatches instead of
resizing generated content into a mask that may no longer align. Return only
composited images as user results.

## Review and retained evidence

Review sees the original, raw generation, final composite and a working-area
overlay in a declared order. It checks the requested change as well as preserved
content and integration, using the source's medium. If a satisfactory raw edit
was clipped, or excess changes can be excluded, it may propose one revised final
footprint. This includes the old extent that must disappear as well as the new
silhouette. The correction is intersected with the original working mask and
protected holes, recomposited from the same raw output, then reviewed again.
The reviewer cannot expand a supplied mask. There is no automatic paid rerender
or unbounded correction loop. Missing features and uncertain reviews are reported
as needing attention; a review outage retains the protected composite without
claiming it passed. Cancellation still stops the operation.

Each output retains a companion evidence directory with the source canvas, raw
generation, working mask, initial and final masks, and review JSON. The JSON
records the prompt actually sent, chosen settings, geometric plan and assessments.
These private runtime files support comparisons with prompt/model/quality/size
held constant; they are not test fixtures or additional chat image results.
The notebook artifact records resolved dimensions, preservation, review status
and evidence paths. The API mask guides generation; deterministic compositing
enforces pixel preservation. Visual review remains a model judgment.

See the [mask requirements](https://developers.openai.com/api/docs/guides/image-generation)
and [image prompting guidance](https://developers.openai.com/api/docs/guides/image-prompting).
