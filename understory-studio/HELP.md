# Understory Studio — Help

Give it one to three pictures. It gives you back an **editable 3D asset** at five
levels of detail, with procedural materials — and, for characters, a working
skeleton and 87 animations.

The thing that makes the output good is the second half of the loop: after
building, the app renders the result from the **front, side and back** and shows
those renders back to the same model, beside your original reference. The model
sees what it actually built, not what it thought it described, and corrects it.

## Quick start

1. Pick a **provider and model** in the toolbar. Vision-capable models do much
   better — the review step is the point, and it needs a model that can see.
   CLI agents (Claude Code, Codex, Antigravity, Devin, Cursor) work too; the hub
   stages your images as files for them.
2. **Connect a data root** (folder icon) if you want projects saved. Without one
   everything still works, but nothing survives closing the tab.
3. **Studio** tab → give it 1–3 reference pictures, any of three ways:
   - drop them on the reference panel, or click it to browse;
   - **Choose from WAN2GP** (also the WAN2GP button in the toolbar) — picks from
     the images this hub's WAN2GP node has already generated;
   - send one in from another lab: Game Art Studio, Identity Studio, the
     Inpaint/Outpaint Canvas, Style Atlas and Composition Studio all offer
     **Send to Understory Studio** on an image. The sender's prompt is dropped
     into your brief if you have not written one.
4. Choose a **subject** — Object, Character, or Scene — write a short brief, and
   pick how many automatic refinements you'll allow.
5. **Generate & review** — from the brief panel or the toolbar. While a run is
   going, the same button is **Stop**, on every tab.

**Using a model that cannot see.** Tick *Describe the pictures with another
model* (step 01b) and pick a vision-capable model. That model becomes the eyes
for the whole run: it writes a structured description of your reference pictures
— form, parts, proportions, materials, details, and what the pictures do not
show — and it judges every render. The model in the toolbar then never receives
an image at all; it builds from those words and from the review findings, so it
can be a text-only coding model. Both models are named on each saved version and
on every call in the Runs tab.

It costs one extra call at the start of a run, and the description is written
once and reused for every refinement. The catch is honest: the builder can only
be as right as the description, and anything the describer leaves out is
invented. Leave the box unticked and a single vision model does both jobs, which
is still the better result when you have one.

**Renaming.** Every project starts as *Untitled asset*. Rename the open one in
the **Project name** field at the top of the Studio rail (Enter or click away to
save), or any saved one with the pencil beside its name on the Projects tab. The
name is a label only — the project's folder is named by its id, so renaming moves
nothing and cannot break a saved run. It also does not touch the "last worked on"
date the list is sorted by.

**New project** (toolbar, and on the Projects tab) starts over: brief, subject,
references, versions, review and the viewport all go back to empty. Saved
projects are untouched — they are still on the Projects tab. Without a data root
nothing is saved, so there it asks first.

**Record** (toolbar) captures a video of the tab — a turntable, a rig
adjustment, a whole build — and saves it under `recordings/` in your data root,
or downloads it if no root is connected.

## What the model is actually asked for

Not three.js, and not vertices. The model writes a small seeded function that
**returns a JSON description**:

```js
{
  name: "Fox lantern",
  materials: { brass: { color: "#b08d57", roughness: 0.35, texture: "bark" } },
  objects: [
    { name: "Body", parts: [{ type: "box", material: "brass", position: [0,1,0], scale: [1,2,1] }] }
  ]
}
```

Parts come from six types: `box`, `ellipsoid`, `tube` (a tapered curve sweep),
`lathe`, `extrude`, and `mesh` (raw buffers, five levels). A trusted builder in
the app validates the description and constructs the geometry.

This is deliberate. Models are unreliable at hundreds of mutually-consistent
floating-point numbers and reliable at constructive, parametric description —
"a tapered tube through these five points" instead of nine hundred vertices.

**You never run generated code.** It is evaluated in a throwaway worker inside a
sandboxed frame with no network, no DOM and no access to your projects. All it
can do is return data.

## Five levels from one description

The design is written once; Master and LOD 0–3 are derived from it by scaling
tessellation. A part can declare `lastLevel` to retire after a given level.

Placements are **identical across all five** — a lower level omits detail, it
never moves anything. That is what makes the set usable as a real LOD chain.

Box-heavy designs can end up with the same triangle count at every level. That's
honest: this is procedural LOD, not automatic retopology, and the app won't
pretend otherwise.

## The review loop

- The model's issues from a failed review become the next pass's instructions.
- A design that **won't build** is a *repair* round, not a failure. The
  validator's complaint goes back to the model, twice, before giving up — and a
  repair doesn't use up one of your refinements.
- Every completed pass is saved as a version, **including** ones that still need
  work. Selecting an older version and generating branches from it.
- At the refinement limit, outstanding issues stay on screen and the version is
  **not** marked reviewed.

A model approving its own work is its assessment, not proof. Hidden sides are
inferred — the back of your subject is an interpretation, not an observation.

## Characters

Set **Subject → Character** for three output targets:

| Target | What you get |
|---|---|
| **Static sculpt** | Follows the pose in your reference. |
| **T-pose · unrigged** | One neutral bipedal humanoid, connected joints, separated limbs, no scenery or props. Export FBX → upload to Mixamo. |
| **Animated humanoid · Mesh2Motion** | The above, plus a locally fitted skeleton, skin weights and 87 clips. |

For the animated lane the model additionally supplies **18 joint positions** —
and only those. It does not invent skin weights or bone hierarchies; the trusted
path fits the bundled skeleton, runs the Mesh2Motion solver in a cancellable
worker, and validates every weight on the way back.

Joints are checked before anything is fitted: the spine ordered head-above-neck-
above-chest-above-pelvis, hips above knees above ankles, arms actually in a
T-pose with anatomical left at +X, no zero-length bones, and everything inside
the mesh. A failure here is a specific, actionable message back to the model.

Movement review gets **six** images: the neutral three, plus walk, crouch and
arm-bend tests at LOD 1.

**Adjust rig** lets you move the joints by hand and save a new version. Without
a model selected, that version stays explicitly unreviewed — the joints changed,
so the last review no longer describes what's on screen.

Whole hands only. No finger rig, no facial rig, no blending, no clip import.

## Triangle clean-up

Designs overlap parts on purpose: joints pushed into bodies, bulges sunk into
armour, plates resting on torsos. A lot of the triangles that produces can never
be seen. On the saved projects so far that was 15–83% of them. **Triangle
clean-up** (right rail, under Versions) removes them, and more, after
generation.

It is **off** until you switch it on, and it never changes what was generated.
Every level gets a *cleaned copy* beside the original. **Original / Cleaned**
flips the viewport between them, and switching the clean-up off shows exactly
the models the generator produced. The settings are saved on the version.
The visual review always looks at the originals.

Three steps run in a fixed order. Each has its own switch and strength:

| Step | What it does | Strength |
|---|---|---|
| **Weld seams** | Joins duplicate vertices along seams and drops zero-area triangles | *Tight → Loose*: how close two vertices must be to join |
| **Remove hidden triangles** | Drops triangles that lie entirely inside another part | *Careful → Thorough*: how many points per triangle must be buried, and how deep |
| **Simplify** | Merges small triangles where the surface barely changes (meshoptimizer) | *Light → Strong*: how far the surface may drift; lower levels are simplified harder. Tick *Set each level separately* for five sliders |

Weld is always on while Simplify is. Without it, seams tear open.

**Animated characters.** A shoulder buried at rest can show once the arm
lifts, so for an animated character a triangle is only removed if it stays
hidden at rest **and** in every checked pose: 12 wide-range clips at 4 frames
each by default, or all 87 clips (slow). Expect about a minute for a dense
Master; the levels run in parallel and **Cancel** stops it. Clips outside the
checked set are not guaranteed, so play a few before exporting. A character
prepared for **Mixamo** is rigged elsewhere, so its poses can't be checked. Keep
Remove hidden near *Careful*, or leave it off.

The table lists original and cleaned triangle counts for every level. Hover a
row for the breakdown.

## Exporting

| Button | What it produces |
|---|---|
| **Selected .glb** | One level, original textured materials |
| **All levels .zip** | Five GLBs plus a `manifest.json` with triangles, meshes, bounds, rig and clip names |
| **Selected .fbx** | The *same GLB*, converted by your local Blender |
| **Send to Blender** | The selected level added to a Blender you already have open |
| **PNG** | Viewport capture |

With a clean-up applied, **Which levels** picks *Original + cleaned (both)*
(the default), *Original only* or *Cleaned only*. Cleaned files carry a
`-clean` suffix (`knight-master-clean.glb`), so nothing replaces an original.
The ZIP then holds ten GLBs, and its manifest marks each level's `variant` and
records the clean-up settings.

Two rules hold throughout: exports always use the **original materials** even
when the viewport is in clay or wireframe, and always start from the **bind
pose** regardless of playback time.

FBX is not a second exporter — it's a conversion of the GLB you already have, so
the two can't describe different geometry.

### The two Blender buttons need different things

- **Selected .fbx** needs a `blender` binary on your PATH. The app can detect
  that, so the button is disabled with a reason when it's missing.
- **Send to Blender** needs a Blender **already open** with the MCP add-on's
  server started (press <kbd>N</kbd> in the 3D viewport, then its *MCP for
  Blender* tab). Nothing can detect that without connecting to it, so the button
  stays enabled and reports for itself.

Both need the hub running under `serve.py` — a plain static server has no
`/__blender` endpoints.

### Mixamo

Choose **T-pose · unrigged**, export **Selected .fbx**, then use *Upload
Character* at [Mixamo](https://www.mixamo.com/). GLB and the levels ZIP are not
Mixamo upload formats.

The app validates geometry and the single-object structure. It cannot prove
human anatomy, welded topology, good deformation, or that Mixamo will accept the
file.

## Runs

Every generation, repair and review call, with its prompt, its images **in the
order they were sent**, the raw response, timing and status. Failed and
cancelled calls are kept — those are the ones worth reading.

Responses are stored *before* parsing, so a malformed answer, a reasoning-only
reply or a truncated response is still inspectable.

## Projects

Saved under your data root at `understory-studio/projects/<id>/`. A draft is
written **before** generation starts, so an attempt that fails or is stopped is
still in the list afterwards with its failure recorded — a project with zero
completed versions opens normally on purpose.

Up to 30 versions per project. Deleting moves a project aside rather than
erasing it.

## Stopping a run

**Stop generation** aborts the request, which is what actually stops the model:
the provider fetch is cancelled, or the bridge kills the CLI process. There's no
time limit — stopping is how a run is bounded. Saved versions are kept.

## Known limits

- Hidden sides are inferred, not observed.
- Assembled parametric parts are **not watertight** and not fabrication-ready.
- No automatic retopology, and no high-to-low normal baking — the procedural
  normal maps are generated surfaces, not geometry bakes.
- Extreme proportions, intersecting parts and loose decoration can deform badly
  and may need weight painting or cleanup in Blender.
- Movement review samples three poses at LOD 1. Inspect the specific clip and
  level you intend to ship.
- Playback speed affects the preview, not the exported clip's timing.

## Credits

Local rigging and animation by [Mesh2Motion](https://github.com/Mesh2Motion/mesh2motion-app)
— solver MIT © Scott Petrovic, core assets CC0, vendored at
`shared/lib/mesh2motion/1.0.0/`. No account, hosted service or analytics.

Ported from the standalone Understory project. Spec 336.
