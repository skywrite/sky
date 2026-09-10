---
created: 2026-09-10
updated: 2026-09-10
---

# Image edits: selection, geometry and preservation

The command owns image generation for both CLI and web chat. The web host owns
retaining output files and displaying them; it does not select image settings.

Astra at low reasoning effort classifies intent from the brief and references.
Photographic preservation defaults to Sunburst/max and an approximately 8 MP
canvas in the first reference's proportions, bounded by the API's edge/aspect
limits. Explicit sizes, models and quality still win. The 8 MP default uses
OpenAI's experimental larger-resolution support. Creation and creative restyling
keep ordinary selection. Explicit model/quality skip classification only when
there are no references: reference edits still need an intent for preservation.

Localized photo edits have a second Astra call for contours. It receives a
1536px view at high image detail, separate from the selector's cheap 512px view.
Editable polygons are unioned, then protected polygons are subtracted. This
supports unchanged subjects overlapping an edit and protected holes within it.
Contours are approximate model judgments, not a segmentation guarantee. A
supplied PNG alpha mask overrides the planner. Uncertain targets or invalid
masks stop the request; never silently retry an unmasked edit. Truly global
changes can explicitly classify as whole-image edits and report that scope.

## The coordinate and pixel contract

The normalized source is fitted without cropping onto the selected output
canvas. Any aspect-ratio mismatch is padded. This PNG is both the first API
reference and the compositing base. The mask has exactly these dimensions;
transparent alpha means editable, opaque alpha means protected. Additional
references keep their original ordering. When space permits and the source has
different dimensions, the full-resolution original is appended as a detail
reference, with its purpose explained in the rendering prompt.

An API mask only guides generation. The renderer must always composite the
result with that same base and mask before returning image bytes. Opaque mask
pixels copy the base unchanged, including alpha; soft edges blend only inside
the editable footprint. Preservation is exact **at output resolution**, after
source orientation, color normalization and resizing, not at the original
camera resolution. Never promise exact preservation within an editable region.

Generated dimensions must match the canvas. Reject mismatches instead of
resizing generated content into a mask that may no longer align. Return only
composited images and save the mask beside the output for inspection or reuse.
Record resolved dimensions and preservation scope in the notebook artifact.

These rules follow the [mask requirements](https://developers.openai.com/api/docs/guides/image-generation)
and OpenAI's [recommendation to composite unchanged regions](https://developers.openai.com/api/docs/guides/image-prompting).
