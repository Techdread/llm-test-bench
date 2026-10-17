// Understory Studio — spec 336. Reference picture in; editable, multi-level,
// optionally rigged 3D asset out, reviewed by the model that built it.
//
// A hub port of the standalone Understory project. The modelling core came
// across intact; the provider registry, connection service, thinking-level
// picker and project server it carried were all deleted, because the hub does
// each of them already and does them for every app at once.

import { html, render } from 'htm/preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { Toolbar } from './components/Toolbar.js';
import { BriefPanel } from './components/BriefPanel.js';
import { ViewportPanel } from './components/ViewportPanel.js';
import { ReviewPanel } from './components/ReviewPanel.js';
import { ProjectsView } from './components/ProjectsView.js';
import { RunsView } from './components/RunsView.js';
import { RigDialog } from './components/RigDialog.js';
import { CleanupPanel } from './components/CleanupPanel.js';
import { HelpDialog } from '../shared/components/HelpDialog.js';
import { ImageViewerDialog } from '../shared/components/ImageViewerDialog.js';
import { Wan2gpImageLibraryDialog } from '../shared/components/Wan2gpImageLibraryDialog.js';

import * as modelProviders from '../shared/services/model-providers.js';
import { filterVisionModels } from '../shared/services/model-vision.js';
import { subscribeSuite } from '../shared/services/suite-prefs.js';
import { connectRoot, ensureAppNamespace, getRoot } from '../shared/services/data-root-manager.js';
import { payloadToFile, takeImageHandoff } from '../shared/services/image-handoff.js';

import { MAX_REFERENCES, addReferences } from './services/referenceImage.js';

import { createStudioViewer } from './services/studioViewer.js';
import { runStudioBuild } from './services/buildLoop.js';
import { evaluateDesign } from './services/designSandbox.js';
import { downloadBlob } from './services/assetExport.js';
import { normalizeCleanup } from './services/meshCleanup.js';
import { blenderStatus, convertToFBX, sendToBlender } from './services/blenderBridge.js';
import {
  appendExchange, deleteProject, listProjects, loadProject,
  newProject, readExchanges, renameProject, saveProject,
} from './services/projectStore.js';

const APP_ID = 'understory-studio';

const STORAGE = {
  theme: 'understory-theme',
  lighting: 'understory-lighting',
  eyesProvider: 'understory-studio-eyes-provider',
  eyesModel: 'understory-studio-eyes-model',
};

// The provider/model pair used to live under `understory-*`; the OpenRouter
// island namespaces it under `<APP_ID>-*`. Copy the old choice across once, so
// an existing install opens on the model it was last using.
for (const key of ['provider', 'model']) {
  const previous = localStorage.getItem(`understory-${key}`);
  if (previous && !localStorage.getItem(`${APP_ID}-${key}`)) {
    localStorage.setItem(`${APP_ID}-${key}`, previous);
  }
}

function App() {
  // ── Shell ────────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState(() => localStorage.getItem(STORAGE.theme) || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE.theme, theme);
  }, [theme]);

  const [view, setView] = useState('projects');
  const [showHelp, setShowHelp] = useState(false);
  const [showRig, setShowRig] = useState(false);
  const [showWanLibrary, setShowWanLibrary] = useState(false);
  const [zoomImage, setZoomImage] = useState('');
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  const notify = useCallback(message => {
    setToast(message);
    setTimeout(() => setToast(current => (current === message ? '' : current)), 6000);
  }, []);

  // ── Models ───────────────────────────────────────────────────────────────
  // The OpenRouter island owns the API key, the provider settings dialog, the
  // model list and the persisted selection; the app only needs the pair it
  // settles on. The callback is memoised because the island reports through an
  // effect that depends on it — an inline arrow would re-fire it every render.
  const [providerId, setProviderId] = useState('');
  const [modelId, setModelId] = useState('');
  const onSelectionChange = useCallback(selection => {
    setProviderId(selection.providerId || '');
    setModelId(selection.modelId || '');
  }, []);

  // ── The describing model ─────────────────────────────────────────────────
  // A second, vision-capable model that reads the pictures on behalf of a
  // builder that cannot. Its own list, because the whole point is that it is
  // chosen under a different constraint from the builder's.
  const [visionModels, setVisionModels] = useState([]);
  const [eyesProvider, setEyesProvider] = useState(() => localStorage.getItem(STORAGE.eyesProvider) || '');
  const [eyesModel, setEyesModel] = useState(() => localStorage.getItem(STORAGE.eyesModel) || '');
  // Memoised: `generate` depends on it, and a fresh object each render would
  // rebuild that callback on every keystroke in the brief.
  const eyes = useMemo(
    () => (eyesProvider && eyesModel ? { providerId: eyesProvider, modelId: eyesModel } : null),
    [eyesProvider, eyesModel],
  );

  const loadVisionModels = useCallback(async () => {
    try { setVisionModels(filterVisionModels(await modelProviders.fetchEnabledModels())); }
    catch { setVisionModels([]); }
  }, []);

  useEffect(() => {
    // The first fetch can land before the provider suite has hydrated, so the
    // list is rebuilt whenever the enabled providers actually change.
    let signature = '';
    const handle = () => {
      const list = modelProviders.getProviders();
      if (!Array.isArray(list)) return;
      const next = list.map(entry => `${entry.id}:${entry.enabled !== false ? '1' : '0'}`).sort().join(',');
      if (next === signature) return;
      signature = next;
      loadVisionModels();
    };
    handle();
    return subscribeSuite('providers', handle);
  }, [loadVisionModels]);

  useEffect(() => {
    localStorage.setItem(STORAGE.eyesProvider, eyesProvider);
    localStorage.setItem(STORAGE.eyesModel, eyesModel);
  }, [eyesProvider, eyesModel]);

  const chooseEyes = useCallback((nextProvider, nextModel) => {
    setEyesProvider(nextProvider || '');
    setEyesModel(nextModel || '');
  }, []);

  // ── Data root ────────────────────────────────────────────────────────────
  const [rootName, setRootName] = useState('');
  const [appHandle, setAppHandle] = useState(null);
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  const refreshProjects = useCallback(async () => {
    setProjectsLoading(true);
    try { setProjects(await listProjects()); }
    catch { setProjects([]); }
    finally { setProjectsLoading(false); }
  }, []);

  useEffect(() => {
    (async () => {
      const root = await getRoot().catch(() => null);
      if (root) {
        setRootName(root.name || 'data root');
        setAppHandle(await ensureAppNamespace(APP_ID).catch(() => null));
        refreshProjects();
      }
    })();
  }, [refreshProjects]);

  const pickDirectory = useCallback(async () => {
    const root = await connectRoot();
    if (!root) { notify('No data root connected. Set one in Settings → Data Root.'); return; }
    setRootName(root.name || 'data root');
    setAppHandle(await ensureAppNamespace(APP_ID).catch(() => null));
    refreshProjects();
  }, [notify, refreshProjects]);

  // ── Project state ────────────────────────────────────────────────────────
  const [project, setProject] = useState(() => newProject());
  const [references, setReferences] = useState([]);
  const [brief, setBrief] = useState('');
  const [kind, setKind] = useState('object');
  const [rigging, setRigging] = useState('none');
  const [rounds, setRounds] = useState(2);
  const [versions, setVersions] = useState([]);
  const [selectedVersion, setSelectedVersion] = useState(-1);
  const [exchanges, setExchanges] = useState([]);

  // Every route into the reference list — the picker, a drop, the WAN2GP
  // library, a cross-app handoff — goes through here, so the 1024px normalise
  // and the three-picture cap are enforced once.
  // The ref mirrors the list so an async add reads what is on screen now, not
  // what was there when the callback was created.
  const referencesRef = useRef(references);
  useEffect(() => { referencesRef.current = references; }, [references]);

  const addReferenceFiles = useCallback(async (files) => {
    try {
      const { references: next, added, skipped } = await addReferences(referencesRef.current, files);
      referencesRef.current = next;
      setReferences(next);
      if (skipped) notify(`Up to ${MAX_REFERENCES} reference pictures — ${skipped} not added.`);
      return added;
    } catch (addError) {
      setError(addError.message);
      return 0;
    }
  }, [notify]);

  // A picture sent from another lab ("Send to Understory Studio" in the image
  // viewers of Game Art Studio, Identity Studio, the inpaint canvas and the
  // rest) is claimed once at boot and becomes the first reference.
  useEffect(() => {
    (async () => {
      const payload = await takeImageHandoff(APP_ID).catch(() => null);
      if (!payload) return;
      const file = payloadToFile(payload);
      if (!file) return;
      const added = await addReferenceFiles([file]);
      if (!added) return;
      setView('studio');
      // The sender's prompt is a starting brief, never a replacement for one
      // you have already written.
      if (payload.prompt) setBrief(current => current || payload.prompt);
      setStatus(`Reference received from ${payload.source || 'another lab'}. Pick a model and generate.`);
      notify(`Reference received from ${payload.source || 'another lab'}.`);
    })();
    // Runs once: a handoff is consumed on arrival, and re-running would be a
    // second claim of something already taken.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Viewer ───────────────────────────────────────────────────────────────
  const canvasRef = useRef(null);
  const viewerRef = useRef(null);
  const [hasModel, setHasModel] = useState(false);
  const [detail, setDetail] = useState('master');
  const [surface, setSurface] = useState('textured');
  const [lighting, setLighting] = useState(() => localStorage.getItem(STORAGE.lighting) || 'studio');
  const [objects, setObjects] = useState([]);
  const [focus, setFocus] = useState(-1);
  const [stats, setStats] = useState(null);
  const [animation, setAnimation] = useState({ rigged: false, clips: [], selected: '', playing: false, speed: 1 });
  const [exportContent, setExportContent] = useState('animated');

  // ── Triangle clean-up ────────────────────────────────────────────────────
  // A person's choice after generation, stored per version. The viewer builds
  // cleaned copies beside the originals; `cleanVariant` picks which one the
  // viewport shows, `exportVariant` which ones leave the app (both by default).
  const [cleanVariant, setCleanVariant] = useState('cleaned');
  const [exportVariant, setExportVariant] = useState('both');
  const [cleanupRun, setCleanupRun] = useState({ running: false, progress: null, summary: null, error: '' });
  const cleanupAbortRef = useRef(null);

  // The viewer owns a WebGL context, so it is created once for the page and
  // kept alive across tab switches — the Studio tab's canvas is hidden, never
  // unmounted, precisely so a glance at Runs does not throw away the asset.
  useEffect(() => {
    if (!canvasRef.current || viewerRef.current) return undefined;
    viewerRef.current = createStudioViewer(canvasRef.current, {
      onStats: next => { setStats(next); setDetail(next.detail); },
      onAnimation: setAnimation,
    });
    viewerRef.current.setLighting(lighting);
    return undefined;
  }, [lighting]);

  useEffect(() => () => { viewerRef.current?.dispose(); viewerRef.current = null; }, []);
  useEffect(() => { viewerRef.current?.setVariant(cleanVariant); }, [cleanVariant]);

  /** Forget the clean-up state; the viewer already dropped its cleaned levels
   *  when a new design was loaded. */
  const resetCleanup = useCallback(() => {
    cleanupAbortRef.current?.abort();
    cleanupAbortRef.current = null;
    setCleanupRun({ running: false, progress: null, summary: null, error: '' });
  }, []);

  const applyCleanupSettings = useCallback(async (settings) => {
    cleanupAbortRef.current?.abort();
    cleanupAbortRef.current = null;
    const viewer = viewerRef.current;
    if (!viewer?.hasModel()) return;
    const normalized = normalizeCleanup(settings);
    if (!normalized.enabled) {
      await viewer.applyCleanup(normalized);
      setCleanupRun({ running: false, progress: null, summary: null, error: '' });
      return;
    }
    const controller = new AbortController();
    cleanupAbortRef.current = controller;
    setCleanupRun(run => ({ ...run, running: true, progress: null, error: '' }));
    try {
      const summary = await viewer.applyCleanup(normalized, {
        signal: controller.signal,
        onProgress: progress => setCleanupRun(run => (run.running ? { ...run, progress } : run)),
      });
      if (!controller.signal.aborted) setCleanupRun({ running: false, progress: null, summary, error: '' });
    } catch (cleanupError) {
      // A newer run owns the state if it superseded this one.
      if (cleanupAbortRef.current !== controller) return;
      const cancelled = controller.signal.aborted || cleanupError.name === 'AbortError';
      setCleanupRun({
        running: false, progress: null,
        summary: viewer.getCleanupSummary(),
        error: cancelled ? '' : cleanupError.message,
      });
    } finally {
      if (cleanupAbortRef.current === controller) cleanupAbortRef.current = null;
    }
  }, []);

  const cancelCleanup = useCallback(() => {
    const controller = cleanupAbortRef.current;
    if (!controller) return;
    controller.abort();
    setCleanupRun(run => ({ ...run, running: false, progress: null, summary: viewerRef.current?.getCleanupSummary() || null }));
  }, []);

  // ── Run state ────────────────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Add a reference picture and pick a model to begin.');
  const [views, setViews] = useState([]);
  const [exporting, setExporting] = useState(false);
  const [blender, setBlender] = useState({ bridge: false, convert: false, version: '', reason: '' });
  const abortRef = useRef(null);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState('0:00');

  useEffect(() => { blenderStatus().then(setBlender); }, []);

  useEffect(() => {
    if (!busy) return undefined;
    const timer = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      setElapsed(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(timer);
  }, [busy, startedAt]);

  const review = selectedVersion >= 0 ? versions[selectedVersion]?.review : null;
  const canGenerate = Boolean(references.length && providerId && modelId && !busy);

  // ── Loading a design into the viewport ───────────────────────────────────
  // `designKind` is passed by openProject: it sets `kind` from the loaded
  // project and calls this in the same tick, when the closure still holds the
  // previous project's kind — an animated character then failed to open.
  const showDesign = useCallback(async (code, target, signal, designKind = kind) => {
    const design = await evaluateDesign(code, 73519, signal);
    const info = await viewerRef.current.load(design, { rigging: target, kind: designKind, signal });
    setHasModel(true);
    setObjects(info.objects);
    setFocus(-1);
    return design;
  }, [kind]);

  // ── The run ──────────────────────────────────────────────────────────────
  const persist = useCallback(async (next) => {
    if (!rootName) return next;
    try { return await saveProject(next); }
    catch (saveError) { notify(`Could not save: ${saveError.message}`); return next; }
  }, [rootName, notify]);

  const generate = useCallback(async (target = rigging, branchFromLatest = false) => {
    if (!canGenerate) return;
    setError('');
    setBusy(true);
    setStartedAt(Date.now());
    setView('studio');

    const controller = new AbortController();
    abortRef.current = controller;

    // Branch from the selected version, unless this is a prepare-from-latest,
    // which keeps everything and adds to the end.
    const base = branchFromLatest ? [...versions] : versions.slice(0, selectedVersion + 1);
    let collected = [...base];

    // The draft is written BEFORE the first call, so an attempt that fails or
    // is stopped is still in the project list afterwards.
    let current = { ...project, kind, brief, rigging: target, references, versions: collected };
    current = await persist(current);
    setProject(current);

    try {
      await runStudioBuild({
        backend: { providerId, modelId },
        eyes,
        references, brief, kind, rigging: target, rounds,
        code: versions[selectedVersion]?.code || '',
        viewer: {
          load: (design, options) => {
            resetCleanup();
            return viewerRef.current.load(design, { ...options, kind })
              .then(info => { setHasModel(true); setObjects(info.objects); setFocus(-1); return info; });
          },
          captureViews: movement => viewerRef.current.captureViews(movement),
        },
        signal: controller.signal,
        onStatus: setStatus,
        onViews: setViews,
        onRecord: async entry => {
          setExchanges(list => [...list, entry]);
          if (rootName) await appendExchange(current.id, entry).catch(() => {});
        },
        onVersion: async version => {
          collected = [...collected, version].slice(-30);
          setVersions(collected);
          setSelectedVersion(collected.length - 1);
          current = await persist({ ...current, versions: collected, rigging: target });
          setProject(current);
        },
      });
      refreshProjects();
    } catch (runError) {
      if (runError.name === 'AbortError' || controller.signal.aborted) {
        setStatus('Stopped. Any unfinished draft has not been reviewed; saved versions are kept.');
      } else {
        setError(runError.message);
        setStatus('The run stopped on an error. The failed call is in the Runs tab.');
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [canGenerate, rigging, versions, selectedVersion, project, kind, brief, references,
      rounds, providerId, modelId, eyes, rootName, persist, refreshProjects, resetCleanup]);

  const cancel = useCallback(() => {
    // Aborting closes the connection, which is what actually stops the model:
    // the provider fetch is cancelled, or the bridge kills the CLI process.
    abortRef.current?.abort();
    setStatus('Stopping…');
  }, []);

  // ── Version navigation ───────────────────────────────────────────────────
  const selectVersion = useCallback(async (index) => {
    setSelectedVersion(index);
    const version = versions[index];
    if (!version) return;
    setError('');
    resetCleanup();
    try {
      await showDesign(version.code, version.rigging || 'none');
      setViews(version.views || []);
      setStatus(`Showing version ${index + 1}.`);
      applyCleanupSettings(version.cleanup);
    } catch (loadError) {
      setError(`That version could not be rebuilt: ${loadError.message}`);
    }
  }, [versions, showDesign, resetCleanup, applyCleanupSettings]);

  // ── Projects ─────────────────────────────────────────────────────────────
  const openProject = useCallback(async (id) => {
    setError('');
    try {
      const loaded = await loadProject(id);
      setProject(loaded);
      setReferences(loaded.references || []);
      setBrief(loaded.brief || '');
      setKind(loaded.kind || 'object');
      setRigging(loaded.rigging || 'none');
      setVersions(loaded.versions || []);
      setExchanges(await readExchanges(id).catch(() => []));
      setView('studio');

      const latest = (loaded.versions || []).length - 1;
      setSelectedVersion(latest);
      if (latest >= 0) {
        const version = loaded.versions[latest];
        setStatus('Rebuilding the saved version…');
        resetCleanup();
        await showDesign(version.code, version.rigging || 'none', undefined, loaded.kind || 'object');
        setViews(version.views || []);
        setStatus(`Opened "${loaded.name}" at version ${latest + 1}.`);
        applyCleanupSettings(version.cleanup);
      } else {
        // A project with zero completed versions must still open — that is how
        // a failed first attempt stays recoverable.
        setViews([]);
        setStatus('This project has no completed version. Its failed attempts are in the Runs tab.');
      }
    } catch (openError) {
      setError(openError.message);
    }
  }, [showDesign, resetCleanup, applyCleanupSettings]);

  const startNewProject = useCallback(() => {
    // Versions reach the data root as they are made, so starting over normally
    // costs nothing — the old project is still in the Projects tab. Without a
    // root there is nothing to go back to, which is the one case worth asking
    // about.
    if (!rootName && versions.length
        && !confirm('Start a new project? Nothing is saved without a data root, so this design will be lost.')) {
      return;
    }
    // The viewport is part of "new": leaving the previous asset on screen under
    // an empty brief is the one thing a new project must not look like.
    resetCleanup();
    viewerRef.current?.clear();
    setHasModel(false); setObjects([]); setFocus(-1); setStats(null); setDetail('master');
    setProject(newProject());
    setReferences([]); referencesRef.current = [];
    setBrief(''); setKind('object'); setRigging('none');
    setVersions([]); setSelectedVersion(-1); setExchanges([]); setViews([]);
    setError('');
    setStatus('New project. Add a reference picture and pick a model.');
    setView('studio');
  }, [rootName, versions.length, resetCleanup]);

  // Renaming touches one field of project.json — the directory is the project
  // id, never its name — so it cannot orphan a run log, and a project that has
  // not been saved yet simply carries the new name into its first save.
  const renameCurrent = useCallback(async (name) => {
    const stored = await renameProject(project.id, name).catch(renameError => {
      notify(`Could not rename: ${renameError.message}`);
      return '';
    });
    if (!stored) return;
    setProject(current => ({ ...current, name: stored }));
    refreshProjects();
  }, [project.id, notify, refreshProjects]);

  const renameSaved = useCallback(async (target, name) => {
    const stored = await renameProject(target.id, name).catch(renameError => {
      notify(`Could not rename: ${renameError.message}`);
      return '';
    });
    if (!stored) return;
    // The open project and its card are the same project; keep them in step.
    setProject(current => (current.id === target.id ? { ...current, name: stored } : current));
    refreshProjects();
  }, [notify, refreshProjects]);

  const removeProject = useCallback(async (target) => {
    await deleteProject(target.id).catch(deleteError => notify(deleteError.message));
    notify(`"${target.name}" moved to deleted in the data root.`);
    refreshProjects();
  }, [notify, refreshProjects]);

  // ── Exports ──────────────────────────────────────────────────────────────
  const withExport = useCallback(async (task) => {
    setExporting(true);
    setError('');
    try { await task(); }
    catch (exportError) { setError(exportError.message); }
    finally { setExporting(false); }
  }, []);

  // Without a finished clean-up there is only the original to export.
  const exportVariants = useMemo(() => {
    if (!cleanupRun.summary) return ['original'];
    return exportVariant === 'both' ? ['original', 'cleaned'] : [exportVariant];
  }, [cleanupRun.summary, exportVariant]);

  const exportFiles = useCallback(
    all => viewerRef.current.exportAsset(all, () => {}, undefined, exportContent, exportVariants),
    [exportContent, exportVariants],
  );

  const exportAsset = useCallback((all) => withExport(async () => {
    const files = await exportFiles(all);
    for (const [index, { blob, filename }] of files.entries()) {
      // Spaced out: back-to-back downloads are what trips the browser's
      // "this site wants to download multiple files" block.
      if (index) await new Promise(resolve => setTimeout(resolve, 400));
      downloadBlob(blob, filename);
    }
    notify(`Saved ${files.map(file => file.filename).join(' and ')}.`);
  }), [withExport, exportFiles, notify]);

  const exportFBX = useCallback(() => withExport(async () => {
    setStatus('Converting the exported GLB with the local Blender…');
    const files = await exportFiles(false);
    const converted = [];
    for (const { blob, filename } of files) {
      const { blob: fbx, summary } = await convertToFBX(blob);
      downloadBlob(fbx, filename.replace(/\.glb$/, '.fbx'));
      converted.push(`${filename.replace(/\.glb$/, '.fbx')}: ${summary.meshes} meshes, ${summary.triangles?.toLocaleString?.() || '?'} triangles`);
    }
    setStatus(`Converted ${converted.join(' · ')}.`);
    notify('FBX saved. It describes the same geometry as the GLB.');
  }), [withExport, exportFiles, notify]);

  const sendBlender = useCallback(() => withExport(async () => {
    setStatus('Sending the selected level to Blender…');
    const files = await exportFiles(false);
    let objects = 0, meshes = 0;
    for (const { blob } of files) {
      const added = await sendToBlender(blob);
      objects += added.objects; meshes += added.meshes;
    }
    setStatus(`Blender added ${objects} objects (${meshes} meshes) to the open scene${files.length > 1 ? ' — original and cleaned' : ''}.`);
    notify('Imported into the running Blender. Nothing in its scene was replaced.');
  }), [withExport, exportFiles, notify]);

  const screenshot = useCallback(() => withExport(async () => {
    const blob = await viewerRef.current.screenshot();
    downloadBlob(blob, `${viewerRef.current.getName() || 'asset'}.png`);
  }), [withExport]);

  // ── Rig editing ──────────────────────────────────────────────────────────
  const currentRig = useMemo(() => {
    const version = versions[selectedVersion];
    if (!version?.code) return null;
    return version.rig || null;
  }, [versions, selectedVersion]);

  const applyRig = useCallback(async (rig) => {
    setShowRig(false);
    setError('');
    const version = versions[selectedVersion];
    if (!version) return;
    try {
      setStatus('Rebuilding the rig with the adjusted joints…');
      const design = await evaluateDesign(version.code, 73519);
      design.rig = rig;
      resetCleanup();
      await viewerRef.current.load(design, { rigging: 'animated', kind: 'character' });
      setHasModel(true);
      // The adjusted rig moves every joint, so its poses are re-checked.
      applyCleanupSettings(version.cleanup);
      // Saved as its own version, explicitly unreviewed: the joints changed, so
      // the last movement review no longer describes this mesh.
      const next = [...versions, {
        ...version, rig, review: null, at: new Date().toISOString(),
        summary: 'Joints adjusted by hand.',
      }].slice(-30);
      setVersions(next);
      setSelectedVersion(next.length - 1);
      setProject(await persist({ ...project, versions: next }));
      setStatus('Rig adjusted and saved as a new, unreviewed version.');
    } catch (rigError) {
      setError(rigError.message);
    }
  }, [versions, selectedVersion, project, persist, resetCleanup, applyCleanupSettings]);

  // ── Clean-up settings on the selected version ────────────────────────────
  const cleanupSettings = useMemo(
    () => normalizeCleanup(versions[selectedVersion]?.cleanup),
    [versions, selectedVersion],
  );

  // Only the settings are stored — the version's code, review and renders are
  // untouched, and the geometry is always re-derived from them.
  const changeCleanup = useCallback(async (next) => {
    const version = versions[selectedVersion];
    if (!version) return;
    const normalized = normalizeCleanup(next);
    const nextVersions = versions.map((entry, index) => (index === selectedVersion ? { ...entry, cleanup: normalized } : entry));
    setVersions(nextVersions);
    if (normalized.enabled && !normalizeCleanup(version.cleanup).enabled) setCleanVariant('cleaned');
    applyCleanupSettings(normalized);
    setProject(await persist({ ...project, versions: nextVersions }));
  }, [versions, selectedVersion, project, persist, applyCleanupSettings]);

  // ── Render ───────────────────────────────────────────────────────────────
  return html`
    <${Toolbar}
      theme=${theme} onToggleTheme=${() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
      onHelp=${() => setShowHelp(true)}
      view=${view} onViewChange=${setView}
      appId=${APP_ID} onSelectionChange=${onSelectionChange}
      busy=${busy} canGenerate=${canGenerate}
      onGenerate=${() => generate(rigging, false)} onCancel=${cancel}
      onWanLibrary=${() => setShowWanLibrary(true)}
      onNewProject=${startNewProject}
      directoryName=${rootName} onPickDirectory=${pickDirectory}
      recordingProps=${{
        appId: APP_ID,
        appTitle: 'Understory Studio',
        appHandle,
        sourceArtefactId: () => project?.id || null,
        metadata: () => ({
          route: view,
          view,
          projectId: project?.id || null,
          projectName: project?.name || null,
          kind,
          rigging,
          version: selectedVersion >= 0 ? selectedVersion + 1 : null,
          providerId: providerId || null,
          modelId: modelId || null,
        }),
        onNeedDirectory: pickDirectory,
        onSaved: result => notify(`Recording saved: ${result.path}`),
        onDownloaded: ({ filename }) => notify(`Downloaded ${filename}`),
        onError: recordError => notify(`Recording failed: ${recordError.message}`),
      }}
    />

    <div class="us-body">
      ${view === 'projects' && html`
        <${ProjectsView}
          projects=${projects} loading=${projectsLoading} rootConnected=${Boolean(rootName)}
          onOpen=${openProject} onNew=${startNewProject} onDelete=${removeProject}
          onRename=${renameSaved}
          onPickDirectory=${pickDirectory}
        />`}

      ${view === 'runs' && html`
        <${RunsView}
          exchanges=${exchanges}
          onRefresh=${async () => setExchanges(await readExchanges(project.id).catch(() => exchanges))}
          onZoom=${setZoomImage}
          onDownload=${() => downloadBlob(
            new Blob([JSON.stringify(exchanges, null, 2)], { type: 'application/json' }),
            `${project.name || 'project'}-exchanges.json`,
          )}
        />`}

      <div class="us-studio" style=${view === 'studio' ? '' : 'display:none'}>
        <${BriefPanel}
          name=${project.name} onName=${renameCurrent}
          references=${references} onReferences=${setReferences}
          brief=${brief} onBrief=${setBrief}
          kind=${kind} onKind=${value => { setKind(value); if (value !== 'character') setRigging('none'); }}
          rigging=${rigging} onRigging=${setRigging}
          rounds=${rounds} onRounds=${setRounds}
          busy=${busy} canGenerate=${canGenerate}
          hasVersion=${selectedVersion >= 0}
          onAddFiles=${addReferenceFiles}
          onWanLibrary=${() => setShowWanLibrary(true)}
          visionModels=${visionModels}
          eyesProvider=${eyesProvider} eyesModel=${eyesModel} onEyes=${chooseEyes}
          onGenerate=${() => generate(rigging, false)}
          onPrepare=${target => generate(target, true)}
          onCancel=${cancel}
        />

        <${ViewportPanel}
          canvasRef=${canvasRef} hasModel=${hasModel}
          detail=${detail} onDetail=${id => viewerRef.current?.selectLevel(id)}
          surface=${surface} onSurface=${value => { setSurface(value); viewerRef.current?.setSurface(value); }}
          lighting=${lighting}
          onLighting=${value => { setLighting(value); localStorage.setItem(STORAGE.lighting, value); viewerRef.current?.setLighting(value); }}
          objects=${objects} focus=${focus}
          onFocus=${index => { setFocus(index); viewerRef.current?.selectObject(index); }}
          stats=${stats} onFrame=${() => viewerRef.current?.frame()}
          status=${status} busy=${busy} elapsed=${elapsed} error=${error}
        />

        <${ReviewPanel}
          versions=${versions} selectedVersion=${selectedVersion} onSelectVersion=${selectVersion}
          review=${review} views=${views} onZoom=${setZoomImage}
          animation=${animation}
          onAnimation=${name => viewerRef.current?.setAnimation(name)}
          onPlay=${value => viewerRef.current?.setPlaying(value)}
          onSpeed=${value => viewerRef.current?.setSpeed(value)}
          onAdjustRig=${() => setShowRig(true)}
          exportContent=${exportContent} onExportContent=${setExportContent}
          cleanup=${selectedVersion >= 0 && hasModel && html`
            <${CleanupPanel}
              settings=${cleanupSettings} onChange=${changeCleanup}
              disabled=${busy}
              rigging=${animation.rigged ? 'animated' : versions[selectedVersion]?.rigging === 'mixamo' ? 'mixamo' : 'none'}
              running=${cleanupRun.running} progress=${cleanupRun.progress}
              summary=${cleanupRun.summary} error=${cleanupRun.error} onCancel=${cancelCleanup}
              variant=${cleanVariant} onVariant=${setCleanVariant}
            />`}
          cleanupReady=${Boolean(cleanupRun.summary)}
          exportVariant=${exportVariant} onExportVariant=${setExportVariant}
          onExport=${() => exportAsset(false)} onExportAll=${() => exportAsset(true)}
          onExportFBX=${exportFBX} onSendBlender=${sendBlender} onScreenshot=${screenshot}
          blender=${blender} exporting=${exporting} hasModel=${hasModel} busy=${busy}
        />
      </div>
    </div>

    ${showHelp && html`<${HelpDialog} src="./HELP.md" title="Understory Studio" onClose=${() => setShowHelp(false)} />`}
    ${showWanLibrary && html`
      <${Wan2gpImageLibraryDialog}
        appId=${APP_ID}
        title="Choose a WAN2GP image"
        onSelect=${async ({ image, blob }) => {
          const added = await addReferenceFiles([new File([blob], image.name, {
            type: blob.type?.startsWith('image/') ? blob.type : 'image/png',
          })]);
          if (added) {
            setView('studio');
            notify(`Added "${image.name}" from WAN2GP as a reference.`);
          }
        }}
        onClose=${() => setShowWanLibrary(false)} />`}
    ${showRig && html`
      <${RigDialog} joints=${currentRig?.joints} canReview=${Boolean(providerId && modelId)}
        onClose=${() => setShowRig(false)} onApply=${applyRig} />`}
    ${zoomImage && html`<${ImageViewerDialog} src=${zoomImage} title="Rendered view" onClose=${() => setZoomImage('')} />`}
    ${toast && html`<div class="us-toast">${toast}</div>`}
  `;
}

render(html`<${App} />`, document.getElementById('app'));
