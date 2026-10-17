# Game Forge V2 — Help

Game Forge V2 fuses the **Prompt Gallery** (a curated library of build prompts you can
run and compare) with the **Tool Calling Lab** (an agentic loop that writes real
files). Here the model builds a **complete, multi-file game project** — then you run,
rate, and compare the results.

## Setup

1. Pick a provider/model. Every in-app model build uses the multi-file tool
   workflow. Use the model dropdown; the gear opens provider settings.
2. Connect a **data root** (folder icon). Every build is written to disk under
   `<root>/game-forge-v2/projects/<game>/<runId>/` — nothing is ever overwritten.
   New run folders begin with the local start date and time (`YYYY-MM-DD_HH-mm-ss`),
   keep their unique run ID, and end with a short model name (or the CLI agent
   plus `default` when no model was selected). Existing folders still open normally.
3. Open **Budgets** before a build if you want to change the hard limits for
   turns, agent time, idle time, files, bytes, images, tokens, cost, or native
   validation.

## Library

- Browse curated game prompts, from 1980 arcade classics to modern indies. The
  catalogue is split into stable primary categories, with independent filters
  for collection, target stack, tag, **library** and **kind** (originals only,
  variants only, or both). Search composes with every facet, so "every Three.js
  variant" or "every original that provisions Phaser" is two clicks.
- Categories and collections are registered in `data/categories.json`. New and
  edited prompts store category, subcategory and collections explicitly;
  existing seed and custom prompts receive backwards-compatible inferred values.
- Each card shows the target stack and a **"watch for"** note — the mechanics a lazy
  implementation tends to skip.
- **New prompt** adds your own. Custom prompts and visibility state are kept in
  the connected data root; older browser-only prompts migrate automatically.
- Use the pencil on **any** card to **Save new version**. Editing a curated seed
  adopts it into your library: the curated wording becomes version 1 and your
  change lands on top as version 2, so `data/library.json` in the repository is
  never rewritten and the original is always recoverable from the version list.
  Earlier versions stay in the library document, and every run pins the exact
  version and prompt text it used.
- The bin icon **hides** a prompt; it never deletes one. Every version stays on
  disk, a bar above the grid lists what is hidden, and one click restores it —
  hiding a prompt with variants leaves the variants reachable in the meantime.
- **Import / Export** moves the complete custom library, including versions and
  hidden state, as a portable JSON file. Curated seeds are never modified.
- **Guided prompt wizard** is the default because you do not need to understand
  prompt engineering. Describe the game in plain English, choose who should
  draft it, then review ordinary editable fields before saving.
- Drafter choices include the local **Claude Code**, **Codex**, and
  **Antigravity** CLIs, with a searchable optional CLI-model field. Agent jobs
  use the path-jailed local bridge, a short budget, and append-only
  `<data-root>/game-forge-v2/prompt-drafts/` request/response records.
- **Provider / local model** opens the suite's searchable model selector,
  including LM Studio, Unsloth Studio, Lemonade, any OpenAI-compatible endpoint,
  OpenRouter, and custom model IDs. This drafting choice remains independent from the model used to build
  the game.
- **Full editor** retains the advanced **Draft**, **Improve**, **Review**, and
  **Watch-for** operations plus partial-field application.
- AI-authored versions record the provider, model, operation, timestamp, and
  applied scope. The card receives an AI badge and the same provenance is
  copied into every run's immutable prompt snapshot.
- Clicking outside the prompt dialog deliberately does nothing. Use Cancel or
  the close button, so an accidental backdrop click cannot discard the idea.
- A card that has been built carries a **run count** badge. It shows that prompt's
  own runs; a prompt with variants shows `4+2`, meaning four of its own and two
  more across its lanes — variants build into their own folders, so the two
  numbers are never added together. Click the badge to open that game in **Runs**.
  Lane rows in the variant strip carry their own counts.
- Hit **Build** to load a game into the Build view.

### Project libraries

The prompt editor and guided wizard can choose one engine/renderer, one
physics library and one audio library. Available foundations include p5,
Phaser, PixiJS, Three.js, Babylon.js, PlayCanvas, KAPLAY, Kontra and melonJS,
with Matter.js, Planck or Rapier physics and Tone.js or Howler audio. Choose
**None / Vanilla Canvas** when a dependency would add more weight than value.

Selections are version-pinned and portable. Before a build starts, Game Forge
copies the verified files into that run's own `lib/` folder; it never gives a
generated game a `shared/lib` or CDN dependency. File sizes and SHA-256 hashes
are checked before and after generation, and the model is not allowed to
rewrite Forge-owned runtime files. A conflict stops preparation with a clear
failure. The selected versions and integrity evidence are preserved in the
prompt snapshot, run metadata and trace.

The **Brief & libraries** button on the Build screen keeps the technical choice
and the written brief together. You can edit the title, prompt and watch-for
notes directly. **Adapt brief uses the backend and model selected on the Build
screen**: Claude Code, Codex or Antigravity use their CLI model (including CLI
default), while In-app model uses the provider model selected in the toolbar.
After changing libraries, **Adapt brief** offers two AI modes:
**Preserve concept** integrates the runtime without changing the presentation,
while **Transform concept** may make a larger change such as turning a
sprite-based game into a Three.js 3D scene. An optional intent box makes that
choice explicit.

Review the field-level before/after diff, then choose **Use for this run**,
**Save as variant**, or—for a custom prompt—**Save new version**. Variants are
append-only child prompts containing a complete resolved snapshot plus parent,
library-change and model provenance. Curated seeds remain immutable. Revisions
inherit their source brief and libraries so a repair or fork cannot silently
switch its runtime.

Classic-script and ES-module profiles are both supported. The in-app preview
handles acyclic static relative module imports; workers, runtime fetches,
`import.meta` assets and cyclic module graphs require serving the exported
project locally.

## VR games for Quest 3

Choose **VR · Quest 3** in the Library category bar, or **Quest 3 Browser VR**
in the Collection filter. The collection adds 16 build briefs: archery,
underwater submersible exploration, a Beat Saber-inspired rhythm game, an
Elite-inspired space cockpit, lunar landing, car racing, flight simulation,
tabletop city building, and eight more games to discover.
The VR category also includes the existing Half-Life: Alyx brief.

These are prompts for generating games. Each selects the portable Three.js
runtime and asks for immersive WebXR, Quest Touch controller input, menus you
can use inside the headset, comfort settings, and a keyboard/mouse desktop
mode. Build a brief as usual, then playtest the generated result; inclusion in
this list does not certify a model's output on a headset.

Open the generated game's **index.html** on Quest Browser from a trusted
**HTTPS** address, then press **Enter VR** and accept the browser's request.
An ordinary `http://192.168.…` LAN address is not a secure context for immersive
VR. Export the project and serve the complete folder, including `lib/`, to
keep it portable. No native Quest application or PC VR streaming is required
by these briefs.

Desktop Preview is useful for checking the basic game loop. For a headset
test, prefer the game in its own tab; if using **Open in new tab** from Preview,
keep Forge open while its temporary preview URLs are in use. If Enter VR is
unavailable, check HTTPS, headset/browser support and permissions. Test both
controllers, in-world pause/restart, seated height and exiting/re-entering VR.

The rhythm game uses original synthesised music and artwork; it is inspired
by Beat Saber's mechanics, not the commercial game or its song catalogue.
The cockpit game similarly uses its own world and assets.

## Library variants and lanes

One prompt, built several times against different provisioned libraries, so the effect of
the library on the resulting game is visible rather than guessed at.

- A **lane** is a named library set — *Vanilla Canvas*, *Phaser*, *Three.js 3D*,
  *Phaser + Howler*. Thirteen ship in `data/lanes.json`; your own live beside the prompt
  library in the data root and are hidden rather than deleted. A lane is validated by the
  same rules as any library choice, so it can never name two engines.
- **Vanilla Canvas is a lane like any other**, not "the original". A baseline you cannot
  place in the grid is a baseline you cannot compare against.
- **Create variants** in the Library derives one prompt per (game × lane). Pick the games
  from the current filter, pick the lanes, pick how the text is produced, and the preview
  tells you the grid size and how many model calls it will cost before you spend anything.

Three ways to produce the variant's text, and they answer different questions:

| Mode | What happens | Cost |
| --- | --- | --- |
| **Held constant** | The prompt text is copied **byte for byte**; only the provisioned library changes. The library's own constraints still reach the build, because they are injected into the build task rather than the prompt. | Free — no model is called |
| **Adapted · preserve** | The brief is rewritten to use the library while keeping the concept, genre and presentation intent. | One model call per cell |
| **Adapted · transform** | The brief may change presentation substantially — a sprite game can become a 3D scene. Needed for a 2D-worded brief on a 3D lane. | One model call per cell |

**Held constant is the controlled comparison** — the one mode where the library really is
the only thing that changed. The adapted modes trade that comparability for a brief the
library can be good at. Leave Mode on *Each lane's default* and 2D lanes preserve while 3D
lanes transform.

Variants are ordinary prompts, so they build from the Build screen and through Batch with
no special handling, and each lane gets its own runs folder. In the Library they collapse
under their parent behind a **⑂ N lanes** chip, so the grid keeps its 127 cards; the
**Lane** filter flattens to a single lane across every game ("show me everything built on
Phaser"), and **Variants as cards** restores a flat list.

Re-running a sweep over cells that already exist **adds a new prompt version** rather than
a second prompt — the earlier text stays readable, and ids are deterministic
(`variant-<game>--<lane>`), so a sweep can never duplicate a cell. Every sweep leaves an
append-only record in `<data-root>/game-forge-v2/library/variant-sweeps/`, and every
adapted cell also leaves its request and response in `brief-reconciliations/`.

## Matrix

The **Matrix** tab is the payoff: games down the side, lanes across the top, each cell
showing that pair's best run — its screenshot, status, and one metric you choose (rubric,
files, turns, time or cost). An empty cell offers **Build**; a row opens up to six lanes
side by side with live previews. Runs made before variants existed sit in a **Base prompt**
column and are never attributed to a lane.

Read it carefully, because it will otherwise imply more rigour than it has:

- **One run per cell proves nothing.** Nondeterminism between two runs of the same cell is
  routinely larger than the difference between two lanes. Cells show their run count and a
  single-run cell is labelled **provisional**.
- **Only held-constant cells are a controlled comparison.** An adapted variant differs from
  its parent in prompt text *as well as* library.
- **Fewer turns is not better.** Phaser supplies scenes, input and physics, so it finishes
  in fewer turns than Kontra by construction. That measures the library's scope, not the
  model's competence.
- **The rubric is LLM-judged** — a consistent reader, not an objective one, and it has no
  way to feel whether a game is fun.

The Matrix is an instrument for noticing differences worth looking at by hand. It is not a
benchmark table and is deliberately not styled as one.

## Batch builds

Open **Batch** to run selected games sequentially with the current in-app model or a local Claude Code, Codex or Antigravity CLI. A CLI batch can optionally name a CLI model; leave it empty to use that CLI’s default. Every game remains an independent append-only run with its own trace, budgets and validation evidence. **Skip existing** matches the complete executor identity. CLI batches require the Hub’s `serve.py` agent bridge.

## Build

- Every in-app build is a real **multi-file tool build**. The model writes the
  entry point, separate source/style files, `README.md`, and
  `forge-project.json`. **Hard stop** ends the current run immediately: the
  in-flight model request is aborted at the socket rather than waited out, and
  everything already written to the project is kept.
- **Pause / Resume.** Next to Hard stop, **Pause** parks the run *without losing
  anything*, and **Resume** carries on from exactly where it stopped. It is the
  button for "I want to read the trace before it writes another file", or "stop
  spending tokens for ten minutes", when a hard stop would be too final.
  - For an **in-app model build** the pause is cooperative, like the Prompt
    Gallery's batch runner: the call or tool already in flight is allowed to
    finish, and the build then parks at the next safe boundary — between two
    tool calls, or before the next model turn. The banner says *Pausing…* while
    it is still finishing, and *Paused* (with the tool or turn it is about to
    run next) once nothing is running at all. No new model call is made until
    you press Resume.
  - For an **external CLI agent** the bridge suspends the agent's whole process
    tree with a job-control signal. The agent keeps its context, its files, and
    its place in the task — it is frozen mid-instruction, not stopped — and
    continues on Resume. This needs a `serve.py` new enough to advertise it; if
    the bridge is older, no Pause button is offered rather than one that cannot
    work. A caveat: a request the agent had in flight to its model provider can
    be dropped by that provider while the process is stopped, and the CLI then
    retries or errors on resume, exactly as it would after any network stall.
  - Paused time is not charged to the run: the trace's elapsed figure excludes
    it (`pausedMs` records how long it was parked), and a suspended agent's idle
    and total-time budgets are held while it sleeps. Every other budget still
    applies. Pause is per run — a second build started while this one is parked
    keeps generating — and a **Hard stop** on a paused run always works: the
    process is continued first, then stopped. Starting another build while one
    is parked releases the parked one first, since the Pause button follows the
    run on screen and a frozen run with no button left is worse than a resumed
    one.
- Fresh builds deliberately offer only writing/editing/completion tools. Because
  the directory starts empty, withholding `read_file` and `list_files` prevents
  small local models from wasting turns inspecting files they just created.
  Revisions receive both read tools because they must inspect the copied parent.
- `write_file` is create-only during a build. An existing path is preserved and
  the model is directed to use a targeted `edit_file` call, preventing overwrite
  loops from repeatedly destroying otherwise-good files.
- Older tool turns are compacted into status summaries without modifying the
  original tool arguments. The newest turn remains verbatim. This avoids both
  context overflow and the local-model failure where a placeholder such as
  “1.2 KB written” gets copied into the next source file.
- If a model emits prose instead of a tool call, Game Forge gives it two bounded
  retries with the exact missing project evidence. A premature `report_done` is
  rejected until the manifest, entry point, README, and at least one separate
  source/style file exist. Conversely, a complete project can finish even when
  the model forgets the final `report_done` call.
- Tool-capable local requests require a tool choice at the API layer. Fresh
  builds also finish as soon as the host verifies every declared manifest asset
  and the required multi-file evidence, avoiding a wasteful final model turn.
- Common local-model argument aliases such as `file_path` are accepted, fenced
  JSON and trailing commas are repaired conservatively, and an omitted
  `list_files.path` means the project root. Failed calls receive a focused retry
  instruction instead of encouraging a complete rewrite.
- The active domain adapter grants only the capabilities needed for this build.
  Every tool call records its permission, timeout, outcome, duration, and a
  bounded argument summary in `capability-audit.json`.
- **Loop detection.** Smaller local models often get stuck re-writing the same files
  instead of finishing. The build watches for this: a turn that only re-writes files
  with identical content (or churns one file endlessly) counts as "no progress". After
  a couple of unproductive turns the model gets one nudge to finish or make a real
  change; if it keeps spinning the build stops early and says so — rather than burning
  the whole turn budget. The **turn cap** is now just a safety net, not the main limit.
  Unproductive turns are badged **no progress** in the trace, and the telemetry row
  shows how many **redundant** rewrites happened.
- **Watching a CLI agent work.** Claude Code and Grok stream their partial output, so
  the agent panel shows a live row of the text, reasoning or file contents being
  written right now, growing token by token. It is replaced by the ordinary trace row
  the moment the block completes, and it is never written to `trace.jsonl`. When the
  agent is thinking rather than writing, the row shows the thinking-token count
  instead — extended thinking usually arrives redacted, so the count is the only
  progress there is, and a five-minute think looks like work rather than a hang.
  Codex and Antigravity report per-item, so they have no live row.
- **Heal a failed run.** When validation fails (or passes with warnings) and the run
  actually wrote files, the status row grows a **Heal** button. One click copies the
  project into a brand-new run and hands the backend the failures the validator recorded,
  so it repairs rather than rebuilds. **The failed run is never modified** — its files,
  trace and evidence stay exactly as they were, so a heal that makes things worse costs
  you nothing. Heal again on the result to chain attempts. The Runs view's **Fix preview**
  does the same thing when you want to add your own guidance first.
- **Reading the trace.** Each turn is a collapsible row. Expand it to see the model's
  text plus, for every tool call, the full **Arguments** it sent and the **Result**
  (or error) it got back — with `OK` / `FAILED` badges. If a local model emits
  malformed argument JSON, the raw text it produced is shown instead of a silent
  empty call, so you can see exactly why the call failed. A row stays visible while
  the model call is in flight (`calling model…`), so a mid-turn API error (e.g. a
  context-overflow 400) doesn't vanish.
- **Wire inspector** (below the trace) shows the raw request/response JSON for any
  turn — the exact **Messages** sent, the **Request**, the raw **Response**, or the
  whole trace to **Export**. Copy or download any of them. This is the fastest way to
  work out why a model isn't calling tools the way you expect. The full trace is also
  saved to `trace.json` in each run folder for later review.
- **The live preview costs something.** A generated game runs in the same browser
  process as Game Forge, so a half-written game with a runaway loop can make the
  whole page unresponsive. Two things keep that in check: the preview only
  reboots when the files on disk have actually changed (an agent writing 16 files
  used to restart the game 16 times; it now restarts once or twice), and the
  preview bar has a **Pause** button during a build. Pause keeps whatever is on
  screen and stops re-running the game — use it the moment the page feels
  sluggish mid-build. Validation still runs the finished game in its own
  short-lived frame regardless.
- When it finishes, the **preview** boots the project in a sandboxed iframe — a small
  in-browser file server rewrites the entry `index.html`'s relative links to the
  built files. Rate the build with the stars.
- **AI assets** (checkbox, in-app model only): when on, the build model gets a
  `generate_image` tool that renders real sprites / backgrounds / tiles via Wan2GP and
  saves them into the project as image files it references by relative path. Sprites
  are generated on a magenta field and the tool keys that out to a transparent PNG.
  Each image takes several seconds (progress shows in the trace), so the model is told
  to make only a few key assets. Needs a Wan2GP node configured in media settings.
- **Ask Coach** opens the AI mentor (Ask / Quiz / Explain) seeded with the task and
  a compact project manifest, validation report, runtime errors, recent trace,
  key source files, and the saved screenshot evidence. Validator and tool-call
  failures have **Explain** buttons that open the grounded coach directly.

### Trust status

Finishing generation does not automatically mean a project works. Every run
moves through **Created → Generating → Stopped → Validating**, then receives one
of three evidence-based results:

- **Passed** — required files, local references, and runtime diagnostics passed.
- **Passed with warnings** — the project may work, but has portability,
  preview-runtime, screenshot, early-stop, or native-verification warnings.
- **Failed validation** — required files are missing, local references are
  broken, the runtime raised errors, or a native build command failed.

Web validation captures console errors, uncaught exceptions, rejected promises,
resource-load failures, render dimensions, and `preview.png`. Native projects
use the local bridge to run a restricted stack-specific build check. The full
report is saved as `validation.json`.

Build limits are hard stops rather than suggestions. The remaining budget is
shown in the trust panel, and the final budget decision is recorded in
`forge.json`. External-agent limits continue to run in the bridge if the tab is
closed.

**No timeout** (build bar, or `0` in either time field of the Budgets dialog)
removes the two *time* budgets — the idle timeout and the agent time cap — for
builds where no wall-clock number is honest. A local model can spend many
minutes on prompt processing before its first token, and killing the turn at
that point throws away work that was progressing normally. With it ticked, the
turn ends when the model finishes or when you press **Hard stop**, and nothing
else. Every other budget — turns, files, bytes, images, tokens, cost — still
applies unchanged, so a runaway build is still bounded.

The setting reaches all the way down: the build loop arms no idle timer, it
tells the provider adapter to disable its own stream watchdog (which would
otherwise cut in at ten minutes regardless), and the `serve.py` bridge skips
both time checks for external CLI agents. Un-ticking restores the shipped
defaults (180s idle, 900s agent time).

For CLI-agent builds the bridge is a separate long-lived process, so the page
can easily be newer than the `serve.py` answering it. An older bridge clamps an
unlimited budget *up* to its ten-second floor — "no timeout" would become the
tightest limit in the system. Game Forge therefore asks the bridge what it
supports first: if it cannot do unlimited budgets, the run is sent that bridge's
maximum instead (2h agent time, 30min idle) and says so in the status row.
Restart the hub with `serve.py` to lift the limit entirely.

## Improve a finished build

Click **Improve** beside the rating stars under a finished preview, including a
successful build. Enter your own changes, or click **Suggest improvements** to
ask the toolbar's selected model or CLI agent for ideas based on the saved spec,
current code excerpts, and available validation results. Suggestions stream as
they arrive; **Stop suggestions** cancels the request.

Completed suggestions are appended to your own instructions. Edit, remove, or
add items in **Spec additions** before clicking **Fork & improve**. This creates
a new run, copies the entire project, and applies the changes to that copy with
the normal build budgets, progress, cancellation, and validation. The parent
run keeps its files, trace, validation, and rating.

The original spec remains in force. Accepted changes are saved as ordered spec
additions, alongside the original brief and parent-run link, and carry forward
when you improve the child again. AI suggestions become requirements only when
you apply the edited instructions. You can also select a saved run in **Runs**,
choose **Improve**, prepare the changes, and then press **Improve copy** in Build.

## Runs

- Every build is saved. Pick a game, then select **up to two runs** to preview side
  by side — the same game built by different models, or re-runs of one model.
- Ratings persist per run.
- Select one run to use the project-workbench actions:
  - **Fork** creates an exact new copy without spending a model call.
  - **Improve** copies the project and prepares a focused model/agent revision.
  - **Fix preview** attaches the saved validation and runtime failures to a
    repair task.
  - **Continue** adds the latest durable trace to the continuation task.
  - **Open in agent** prepares the copied project for the external coding-agent
    backend.
- Select two runs to **Diff** their full file trees or **Merge ideas** into a
  new attempt. The first selected run is the editable base; the second is
  attached as source/design context.
- **Files / ZIP** opens the project browser. Inspect text files, download the
  complete portable project with vendored `fflate`, or send all portable text
  files to Code Morph Lab V3 as an editable local snapshot.
- **Bundle / Port** creates an immutable `.gameforge.zip` contract. A source
  bundle contains the complete project, creative brief, structured game
  inventory, validation/evaluation evidence, screenshot, provenance,
  acceptance criteria and a per-file integrity inventory.
- **Promote to Studio** deliberately ends exploration for the selected run and
  starts a new production lineage. It creates a fresh refinement project every
  time, copies the run byte-for-byte as an immutable baseline, preserves its
  validation and screenshot evidence, calculates a baseline SHA-256 inventory,
  and opens the Refinement Intake audit in a new tab. Promotion never changes or
  re-runs the source. Failed runs remain failed and show a warning, but can still
  be promoted when you want a later Studio revision to attempt a repair.
- A **Port handoff bundle** adds a reusable target request for Godot, Unity,
  Unreal Engine, Android native or a desktop wrapper, plus target-agent
  instructions and a conversion-report template. Game Forge does not claim to
  translate or compile the game in-browser: a strong agent must work inside the
  selected target environment, build and run the new project, and return honest
  mechanic-parity evidence and known gaps.
- Every bundle export is append-only under
  `<run>/exports/<exportId>/game.gameforge.zip` and is downloaded for transfer.
  Source runs and earlier exports are never overwritten.
- **Evaluate** keeps the quick star rating and adds optional 0–5 scores for
  completeness, playability, visuals, structure, performance, originality,
  and reliability, plus review notes.
- Every iteration creates a unique run folder. Its `forge.json` records
  `parentRunId`, `sourceRunIds`, `sourcePromptVersion`, `iterationKind`, and
  `requestedChange`; source projects are never overwritten.
- Run rows show their final validation status. Each run folder preserves
  `forge.json`, a compact `trace.json`, the append-as-it-happens `trace.jsonl`,
  `validation.json`, `capability-audit.json`, and (for successful browser
  capture) `preview.png`.
- If an external agent survives a reload, Game Forge V2 restores the saved
  activity and reattaches after the last persisted event.

## Project manifests and preview adapters

New builds are instructed to write `forge-project.json`, declaring the project
kind, entrypoint, runtime adapter, assets, and controls. Validation checks the
declared entry and assets. Older projects remain readable: Game Forge infers an
adapter and reports the missing manifest as a warning.

The preview surface now routes through explicit adapters for static web,
module-web, workers, WebAssembly, native/archive, and document/data projects.
Static web is fully assembled with blob rewriting. Module, worker, and WASM
adapters surface their remaining runtime constraints instead of silently
pretending every project follows the static-web contract.

## Record video

Use **Record** in the toolbar to capture a game preview, build trace, Runs review
or any other Forge screen. Chrome lets you choose the current tab, another
window or a display and can include supported tab/system audio. The floating
controls provide pause, resume and stop before opening a video preview.

Choose **MP4 · H.264** for the default upload-friendly output, or WebM when you
prefer it. Browsers without native MP4 encoding fall back to WebM automatically.

Download works without a Data Root. With one connected, recordings save
append-only under `<root>/game-forge-v2/recordings/<recording-id>/`, with the
current game, run, build lifecycle, backend and model recorded as provenance.

## Notes & limits

- The previewer targets the **web stack** (HTML/Canvas/WebGL). It rewrites plain
  `<script src>`, `<link>`, `<img>` and CSS `url()` references. ES-module `import`
  specifiers, worker URLs, and runtime `fetch()` of project files are validated
  but are not yet rewritten; their adapters show a runtime warning.
- Prompts pinned to non-web stacks (e.g. Doom in C, Elite in Rust) are checked
  through the local bridge with a restricted stack-specific build command.
  Without the bridge they are retained with a verification warning.
- Models must generate art procedurally unless **AI assets** is enabled — there
  are no external image/audio assets.
