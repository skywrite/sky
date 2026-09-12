---
created: 2026-09-10
updated: 2026-09-10
---

# Image creation: production methods, geometry and preservation

The command owns image generation for both CLI and web chat. The web host owns
retaining output files and displaying them; it does not select image settings.

Astra at low reasoning effort selects a production method, intent and geometric
complexity from the brief and references. Photographs and textured artwork use
image generation. Precise flat shapes, diagrams and lettering use a structured
drawing scene rendered to SVG and PNG. Mixed designs generate artwork, then add
precise graphic layers. The method is separate from the image model and quality.
An explicit method wins; an explicit image model implies image generation unless
the method is also explicitly chosen. Fidelity intent applies across photos,
illustrations, logos, icons, diagrams and other raster graphics.
Photographic preservation defaults to Sunburst/max and an approximately 8 MP
canvas. Graphic preservation selects quality by requirements and keeps supported
source dimensions; unsupported image-API dimensions use a nearby valid canvas.
Drawing has its own canvas budget (1–8192px edges, at most 16,777,216 pixels), so a
small icon can retain its native grid. Explicit
sizes, models and quality still win. The 8 MP photo default uses OpenAI's
experimental larger-resolution support. Creation and whole-image restyling keep
ordinary selection. Explicit model/quality skip classification only when there
are no references and image generation is selected: reference edits still need
an intent for model and resolution selection.

The default image method sends the full reference images and a concise description
of the requested edit, then returns the full provider result. It performs no
automatic mask planning, focused crop, source compositing or visual-review
regeneration. Fidelity classification still selects Sunburst/max and about 8 MP
for photographic edits; it does not itself enable masks or corrective attempts.
An explicit `--mask auto` or PNG mask opts into the advanced masked workflow.
Explicit `--attempts` enables image review and bounded corrections. Drawing and
mixed methods retain their advanced planning, preservation and review behavior.

This default follows a quality boundary: generated geometry can shift relative
to the source. Compositing through fixed source contours can then splice different
edges, colors or textures and create visible seams. Every protected pixel can be
exact while the overall edit looks worse. Pixel equality alone does not establish
edit quality; masks are an optional control over where the result may change.

## Optional masked editing

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

## The masked coordinate and pixel contract

This contract applies to enabled masked edits, including localized drawing and
mixed workflows. The default image method uses full references and returns the
provider image without this source compositing step.

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

When an enabled masked image edit occupies a sufficiently small part of the canvas,
the renderer crops the working mask with surrounding context. It appends the
full canvas as a context reference. The crop uses an API-valid size without
resampling, and padding is removed when restoring it to the original coordinates.
If the area is too large or there is no spare reference slot, generation uses
the full canvas. Focus does not increase the source's pixel resolution.

After generation, a vision pass traces the observed old and new contours; it
does not blindly reuse the initially guessed silhouette. Transparent objects can
also use their actual alpha support. The footprint remains bounded by the
immutable working mask and protected holes. Low confidence or a refinement
outage falls back to the initial mask. This is contour estimation plus alpha
analysis, not a dedicated semantic segmentation model or a guarantee of perfect
boundaries. A supplied mask remains fixed.

For masked edits, generated dimensions must match the requested canvas or crop.
Reject mismatches instead of resizing generated content into a mask that may no
longer align. Those paths return the composited image; the default unmasked image
path returns the full provider result.

## Precise drawing and mixed designs

The drawing planner emits validated scene data: rectangles, ellipses, lines,
polygons, structured paths, regular stars and editable text. The renderer computes
geometry and rasterizes it with sharp. It never executes model-generated code or
accepts raw SVG, CSS or external resources. Scene and pixel budgets bound work.
Font families are currently generic sans, serif and monospace; typography is
editable but a particular brand font is not promised.

For a localized drawing, exact painted/erased coverage is intersected with the
fully editable working area. The rest copies source RGBA values. SVG uses
complementary source/generated masks so its preview agrees with PNG, including
transparent erasures. A vector edit over a raster reference embeds that reference;
it does not convert the existing artwork into editable vectors.

Mixed planning separates an artwork-only prompt from the precise overlay brief.
The image request must not append the full request's typography instructions;
otherwise it can paint duplicate lettering beneath the SVG. Object footprints
are refined before overlays and combined with their exact coverage. A coherently
repainted surface retains its entire prepared footprint, including negative
space. Tracing only mountains inside a repainted landscape, for example, splices
new sky into old contours and creates artificial seams. Overlay-only
corrections reuse the retained artwork. Changes requiring new artwork start again
from original references, with the same preservation constraints. The SVG retains
the raster base and editable vector layers.

## Review, correction and retained evidence

Image-method review is enabled by explicit attempts or a prepared mask requested
through the optional masked workflow. Drawing and mixed designs are reviewed by
default. When a reviewed edit is masked, review sees the original,
raw generation, final composite and a working-area
overlay in a declared order. It checks the requested change, preservation and
integration using the source's medium. Mixed review additionally sees the actual paid raster before any
compositing or overlays, so an artifact introduced by preservation cannot be
misattributed to the image generator. If a satisfactory raw edit
was clipped, or excess changes can be excluded, it may propose one revised final
footprint. This includes the old extent that must disappear as well as the new
silhouette. The correction is intersected with the original working mask and
protected holes, recomposited from the same raw output, then reviewed again.
The reviewer cannot expand a supplied mask or precise drawing coverage.

When enabled, the outer workflow reviews creations and whole-image edits too.
Explicit attempts sets the image-method limit from one to five; drawing and mixed
default to three for simple requests or five for complex requests. Each candidate
is compared with the retained best against the
original request; scores are diagnostic, and pairwise improvement controls
selection. Corrective prompts include the best candidate's defects plus notes
from the latest rejected attempt. Stop on a passing best result, two consecutive
non-improvements, no actionable feedback, unavailable review, or the time budget
(15 minutes for the command by default). These are paid planning, generation and
review calls; neither count nor elapsed time is a dollar-cost measurement.

Available provider images or safe composites are checkpointed before further model calls. A review or overlay
failure retains available artwork without claiming the complete request passed.
A failed later batch image does not discard earlier outputs. Review caveats,
attempt errors and incomplete batches are returned explicitly. User cancellation
still stops the operation.

Each output retains a companion evidence directory with every candidate, source
canvas, raw generation, working/initial/final masks, focused crop geometry, SVG
scene and review JSON as applicable. Mixed evidence also retains the original
paid raster separately from the composited artwork and final overlay. The JSON
records prompts actually sent, chosen settings, plans, assessments and attempt
selection without embedding binary image arrays.
These private runtime files support comparisons with prompt/model/quality/size
held constant; they are not test fixtures or additional chat image results.
The notebook artifact records resolved dimensions, enabled preservation and review,
and evidence paths. In masked workflows the API mask guides generation and
deterministic compositing enforces pixel preservation. Visual review remains a
model judgment and is absent from default image-method results. Web chat
shows the final PNG and retains SVG as a downloadable attachment.

## Repeatable visual evaluation

`sky ai:image:evaluate --list` lists free, reproducible synthetic cases. Running
cases uses the production workflow and paid model calls, with explicit attempt
and time limits. Cases exercise shaded objects, expanded geometry, exact labels,
transparency, and mixed artwork/graphics. Expected fixture images calibrate only
the objective metrics; the model never receives them.

The report separates pixel preservation, dimensions, alpha and geometric metrics
from model judgments about requested content and visual integration. A numeric
pass is not proof of semantic correctness. The shaded object is a procedural
material test, not a benchmark of photographic identity preservation. Evidence
is saved outside the repository without writing evaluation data to the notebook.

See the [mask requirements](https://developers.openai.com/api/docs/guides/image-generation)
and [image prompting guidance](https://developers.openai.com/api/docs/guides/image-prompting).
