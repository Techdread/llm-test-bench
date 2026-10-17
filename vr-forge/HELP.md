# VR Forge — Help

VR Forge asks a model or a local CLI agent to build a **complete, multi-file
WebXR project for the Meta Quest 3** — a game, a simulation, or a tool — and then
does the thing that makes it worth having: it **runs the project in an immersive
session** and measures what happened.

That is the whole point. "It works in VR" is otherwise the least verifiable
claim in this hub: the artefact runs on a device the browser cannot see, in a
session that cannot start without a user gesture, at a frame rate no desktop
reproduces. VR Forge converts the biggest part of that — *did it actually enter
VR and render two eyes?* — from a claim into a measurement, and is explicit
about the part it cannot answer.

## Setup

1. Pick a provider/model, or a CLI agent (Claude Code, Codex, Antigravity) from
   the executor dropdown. The gear opens provider settings.
2. Connect a **data root** (folder icon). Every build is written to disk under
   `<root>/vr-forge/projects/<brief>/<runId>/` — nothing is ever overwritten.
   New run folders begin with the local start date and time (`YYYY-MM-DD_HH-mm-ss`),
   keep their unique run ID, and end with a short model name (or the CLI agent
   plus `default` when no model was selected). Existing folders still open normally.
3. Optional but recommended: run the hub with `python3 serve.py 8084`. That adds
   the CLI-agent bridge **and** the Quest bridge (headset status, one-click open
   on the headset). Without it, everything else still works.
4. For the headset itself there are two routes, and you can use either:
   - **Over Wi-Fi (no cable, no adb).** Start the hub with
     `python3 serve.py 8084 --host 0.0.0.0 --https-port 8443` and open the
     `https://…:8443/` link it prints in Quest Browser. Accept the certificate
     warning once (Advanced → Proceed). You can then use VR Forge *on the
     headset*: build a brief and open the result in VR from the same browser.
   - **adb reverse.** Follow `prompt-gallery/QUEST-VR-ACCESS.md`: developer
     mode, adb over Wi-Fi, and `adb reverse tcp:8084 tcp:8084`. The Quest then
     reaches this hub at `http://localhost:8084/`, which Quest Browser treats as
     a trusted origin — so WebXR works without HTTPS.

   Why two: a browser only offers **Enter VR** on a secure address. `localhost`
   counts and so does HTTPS; plain `http://192.168.x.x` does not, so over that
   address a project opens flat (its desktop fallback) and never enters VR.

## Briefs

The Library holds 31 seed briefs across three kinds — **games**, **simulations**
and **apps** — including one deliberate control cell (*Raw WebXR, No Libraries*)
and one passthrough/mixed-reality brief.

Sixteen of them are **large simulations**, grouped by subcategory: economics
(macroeconomy sandbox, order-book floor), urban planning (planning table,
transit network lab), logistics (single-SKU pallets, mixed-SKU 3D packing,
cylindrical loads, warehouse pick-paths), traffic (junction lab, evacuation and
crowd flow), defence (command sand table, sustainment planner) and the universe
(atlas of scale, N-body cluster, curved spacetime, galaxy formation). Each one
names the actual model it must implement — IDM and MOBIL, social forces,
extreme-point packing, Barnes-Hut, Schwarzschild geodesics — and its acceptance
list is written so a reviewer can check the model, not the graphics.

Your own briefs live beside them in the data root and are versioned; seeds can be
hidden but never lose their history.

A VR brief says more than a sentence of prose, because the checks that follow
have to be checkable:

| Field | What it decides |
|---|---|
| `kind` | game / simulation / app — the taxonomy and the coach's framing |
| `xrMode` | `immersive-vr`, `immersive-ar` (passthrough), or both |
| `interaction` | controllers, hands, locomotion, haptics |
| `xrFeatures` | the WebXR features the session may require or request |
| `comfort` | target fps, vignette on motion, snap turn, seated support |
| `desktopFallback` | **required**: how the project is reviewed without a headset |
| `scene` | what must actually be in the scene |
| `acceptance` | the statements a reviewer checks it against |
| `hubServices` | opt-in runtime access to the hub: `ask`, `image`, `agent` |

`desktopFallback` is required, not optional. A VR project with no review path
outside a headset cannot be looked at, diffed, screenshotted or compared — and
the validator needs it too.

## Hub services — a simulation that can ask

A generated project is served by the hub, and on the Quest it reaches the hub
through the adb reverse. So a brief can opt into three things a static page
cannot do for itself, through the provisioned `lib/hub-bridge.js`:

| Call | What it does | Needs |
|---|---|---|
| `HubBridge.ask({ prompt })` | one model answer — an in-sim economist, an intel summary, a planning review | `OPENROUTER_API_KEY` or `HUB_ASK_BASE_URL` in serve.py's environment, or a local OpenAI-compatible server on `127.0.0.1:1234` |
| `HubBridge.askJson({ prompt })` | the same, parsed — a generated scenario, policy weights, dialogue | as above |
| `HubBridge.image({ prompt })` | a generated texture as a data URL | a reachable Wan2GP node |
| `HubBridge.agent({ prompt })` | a local CLI coding agent for heavier work | the agent bridge (no API key: it uses your CLI login) |

Four rules hold this together, and the validator or the system prompt enforces
each one:

1. **The project never sees a key.** Whatever provider is configured lives in
   the server's environment. `/__ask` resolves it, caps the prompt and token
   count, and rate-limits (20 calls a minute, 500 a run, all tunable).
2. **The simulation must work without any of it.** Hub-backed features are
   enrichment on a scene that already runs: procedural textures when no image
   comes back, built-in scenario data when no model answers, a visible
   "unavailable" line rather than a dead control. `HubBridge.status()` says what
   is actually available; the brief's acceptance list should require the
   degraded path.
3. **Never call from the animation loop.** A model call takes seconds and the
   hub rate-limits — a per-frame call stalls the headset and burns the budget.
   Ask on a deliberate action and show the previous answer meanwhile.
4. **A project that calls the hub is not portable, and says so.** The run is
   marked **hub-bound** with the endpoints it used; exported on its own it keeps
   the simulation and loses those features. A project that calls a hub endpoint
   its brief never asked for **fails** validation.

Turn it on for your own briefs with `hubServices: { ask: 'optional' }` and the
`hub-bridge` library. Nine seed briefs already use it.

Configure the model service before starting the hub, for example:

```bash
OPENROUTER_API_KEY=sk-or-... python3 serve.py 8084
# or any OpenAI-compatible server, local or remote:
HUB_ASK_BASE_URL=http://127.0.0.1:1234/v1 HUB_ASK_MODEL=my-model python3 serve.py 8084
```

`GET /__ask/status` reports what is configured — and never the key.

## The XR contract

Five rules are in the system prompt *and* enforced by the validator, so the app
never fails a build for a requirement it did not state:

1. **The session entry control carries `data-forge-id="enter-xr"`**, and
   `forge-project.json` names it in `xr.entryControl`. Nothing outside the
   project can start an immersive session; without this the build cannot be
   verified at all.
2. **The project renders without a session.** No `navigator.xr`, or an
   unsupported mode, must produce the declared desktop fallback and a visible
   explanation — never an exception, never a blank page.
3. **Everything is project-local.** No CDN, no `https://` reference. The headset
   reaches the project through a loopback tunnel with no internet. The one
   exception is the hub's own same-origin endpoints, and only for a brief that
   asked for hub services (above).
4. **What it requests is what it declared.** The mode and features passed to
   `requestSession` must match the manifest.
5. **An import map maps only to project-local files.**

## Build

The Build view is the trace on the left and three ways to look at one project on
the right.

- **Desktop** — the project's non-XR path in a blob-URL iframe, live as files
  land. This is the fallback, not the product.
- **XR session** — an emulated Quest 3. Start the emulator, press **Enter XR**,
  and the project's own entry control is clicked. Live readouts show frames
  presented, per-frame callback cost and the number of eye views; the controls
  press the emulated trigger, push the thumbstick, recentre the headset, and
  switch the primary input between controllers and hands. This is the same
  harness the validator drives, so what you poke at is what the report measures.
- **On the Quest** — the two ways to put this run on the headset. Nothing is
  copied to the Quest either way: it opens the run straight from the data root.
  - **Over Wi-Fi** shows the run's address on the hub's network address. When
    VR Forge is open in the headset's own browser you get **Open here**, and the
    pane says plainly whether that browser can enter VR on this address. If it
    cannot, **Open in VR (HTTPS)** moves to the hub's HTTPS port (when the hub
    was started with `--https-port`); the note underneath also gives the
    one-time Quest Browser setting that makes the plain address trusted
    (`chrome://flags` → *Insecure origins treated as secure*). On the hub
    machine the same block gives you the address to open on the headset.
  - **adb reverse** is headset status from the bridge, the exact
    `http://localhost:8084/_data/…` URL, **Open on Quest**, and **Restore
    reverse** for when the headset has slept.

  Older runs have the same pane: in **Runs**, pick a brief, select one run and
  press **On the Quest**.

**Pause / Resume** and **Hard stop** work as they do in Game Forge V2: pause
parks an in-app build at a safe boundary, or suspends a CLI agent's process, and
resume carries on from exactly there.

## What a run proves — and what it does not

Validation runs in four lanes.

**A — Structure.** Manifest present and valid, entry exists, every reference
resolves, nothing external, provisioned libraries byte-identical to their pins,
and the `xr` block well-formed with an entry control.

**B — Desktop.** The project boots in a diagnostic frame. Console errors,
uncaught exceptions, rejected promises and failed resource loads are errors. A
project that throws before its fallback appears fails here whatever it would do
in VR.

**C — Emulated XR session.** The project is loaded again with an emulated Quest 3
(Meta's IWER) installed over `navigator.xr` and a probe wrapped around the WebXR
entry points. Then:

| Check | Verdict if it fails |
|---|---|
| An immersive session was granted | error |
| ≥120 frames through `XRSession.requestAnimationFrame` | error |
| The viewer pose had two views, with different transforms | error |
| The project set **one viewport per eye** | error |
| The eye framebuffer is not one flat colour | error |
| Requested mode/features match the manifest | error |
| Controllers, select events, haptics the brief asked for | warning |
| 95th-percentile frame callback within budget | warning |
| The session ended cleanly | warning |

The viewport check is the one that catches the classic bug. The runtime hands
*every* project two views, so a project that renders the scene once and lets both
eyes see it still gets a healthy-looking pose — but it sets a single
full-framebuffer viewport, and that is measurable. (A renderer using
`OVR_multiview` looks the same; say so in the README if that is deliberate.)

The left eye is read back out of the framebuffer and saved as the run's evidence
image — `preview.png` for a VR run is what the headset would have shown, not a
screenshot of a web page.

**D — Device.** Whether the run was opened on the real headset, and when. This is
**provenance, never evidence**: the hub cannot see what happened after Quest
Browser loaded the page.

### Honesty limits

- The emulator is not a Quest. It proves a project **enters an immersive session
  and renders stereo frames**. It proves nothing about device performance,
  thermals, comfort, tracking quality, or how the scale feels.
- Emulated frame *rate* is this browser's rAF rate. Frame *cost* — time inside
  the project's own callback — is measured and meaningful; frame rate is not, and
  is never reported as fps achieved on device.
- Passthrough (`immersive-ar`) renders a synthetic environment. Plane detection
  and hit test return the emulator's synthetic geometry, so a room-planner brief
  is verified as *plumbing that works*, not as *a room that was understood*.
- A run that only passed the emulated lane says **emulator-verified**, not
  *verified on Quest 3*. Put it on the headset before you believe it.

## Project libraries and lanes

Generated projects never load anything from this repository. Selected libraries
are **copied into the project's own `lib/`**, checked against pinned hashes
before and after generation, and included in the export.

- **`three-xr`** — Three.js 0.185.1 (ES modules) with the WebXR add-ons:
  `VRButton`, `ARButton`, `XRButton`, `XRControllerModelFactory`,
  `XRHandModelFactory`, `XRPlanes`, `XREstimatedLight`, plus `GLTFLoader` and the
  geometry/skeleton utilities they need. The briefing hands the model the exact
  import map. **`OrbitControls` and the post-processing stack are not
  installed** — a few lines of your own beat a 404 in the headset.
- **`rapier3d`** — WASM rigid-body physics, for grabbing, throwing and stacking.
- **`tone` / `howler`** — synthesis and sound effects.
- **No library** — raw WebXR against WebGL2. The control cell.

Lanes pin a brief to a library set so the same brief can be built several ways
and compared cell by cell in the **Matrix**.

## Runs, Matrix, Batch

Every attempt is an append-only run: prompt snapshot, trace, manifest, capability
audit, validation report, XR report and eye capture, all on disk. **Runs**
compares them, **Matrix** lays out (brief × lane), and **Batch** runs a model or
a CLI agent across many briefs. Iteration — fork, improve, repair, continue,
merge — always copies into a **new** run; a heal that makes things worse costs
nothing.

## Project manifest

```jsonc
{
  "schemaVersion": 1, "kind": "vr", "entry": "index.html", "runtime": "webxr",
  "xr": {
    "modes": ["immersive-vr"],
    "requiredFeatures": ["local-floor"], "optionalFeatures": ["hand-tracking"],
    "inputs": { "controllers": true, "hands": false, "haptics": true },
    "locomotion": "teleport", "targetFps": 72,
    "entryControl": "[data-forge-id=\"enter-xr\"]"
  },
  "fallback": { "kind": "desktop", "description": "orbit camera + mouse grab" },
  "assets": [], "declaredControls": ["Trigger: grab", "Thumbstick: teleport"]
}
```

`runtime: "webxr"` previews like a module-web project. The runtime name
`quest-native` is reserved for a future APK lane; nothing implements it today.

## Notes & limits

- **The Quest bridge is loopback-only.** It will open a URL on the headset only
  when that URL is served by this very server, under the data root. It runs
  `adb`; if `adb` is missing or the headset is asleep, the pane says so and the
  buttons stay disabled rather than failing silently.
- **A hub without `serve.py` has no bridge at all.** The Quest pane then shows
  the URL to open by hand, and the CLI-agent rows disappear from the executor
  list (as everywhere else in the hub).
- **The emulated session runs in this page's process.** A generated project with
  a runaway loop can make the app sluggish; stop the emulator, or use the desktop
  pane, while a heavy build is still writing files.
- **`immersive-ar` briefs need a Quest 3 to mean anything.** The emulator will run
  them, and the checks about declaration, frames and input still apply, but the
  passthrough imagery is synthetic.
- **Tests.** `node --test vr-forge/tests/*.test.mjs` covers the probe's analysis,
  the manifest contract, the seed catalogue and the bridge client;
  `node tools/vr-xr-lane-check.mjs` drives the real validator, in a real browser,
  against two fixture projects that differ by one line — one renders a viewport
  per eye, the other fills the framebuffer once. The lane is only worth anything
  if it passes the first and fails the second.
