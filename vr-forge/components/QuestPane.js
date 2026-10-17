import { html } from 'htm/preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import {
  openOnQuest, questProjectUrl, questStatus, questWirelessRoute, restoreQuestReverse,
} from '../../shared/services/quest-bridge.js';

/**
 * The real headset: status, the URL it should open, and one button that opens
 * it there. Nothing is copied to the Quest — it reads the run straight off this
 * machine's data root, by one of two routes:
 *
 *  - **Over Wi-Fi**: the headset opens the hub's network address. No cable, no
 *    adb, and the route that works when VR Forge itself is open on the Quest.
 *    VR needs that address to be secure (HTTPS, or allowed in the browser).
 *  - **adb reverse**: the hub appears as `localhost` on the headset, which the
 *    browser already trusts.
 *
 * What happens after the page opens is invisible to the hub, so this pane
 * records provenance ("opened at…"), never evidence.
 */
export function QuestPane({ projectDir, entry = 'index.html', onOpened }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [opened, setOpened] = useState(null);

  const refresh = useCallback(async () => {
    setStatus(await questStatus());
  }, []);

  useEffect(() => {
    refresh();
    // The headset sleeps, the reverse drops, the watchdog restores it: poll
    // slowly so the pane is never confidently wrong for long.
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  // The adb route is always the loopback HTTP port, whatever address or scheme
  // this page itself was loaded from.
  const loopbackOrigin = status?.network?.httpPort ? `http://localhost:${status.network.httpPort}` : null;
  const url = projectDir ? questProjectUrl(projectDir, { entry, origin: loopbackOrigin }) : '';
  const wireless = questWirelessRoute({
    projectDir, entry, network: status?.network || null,
    page: {
      origin: location.origin,
      secureContext: window.isSecureContext,
      hasXr: typeof navigator !== 'undefined' && 'xr' in navigator,
    },
  });
  const [copied, setCopied] = useState(false);

  const openHere = (target) => {
    window.open(target, '_blank', 'noopener');
    const at = new Date().toISOString();
    setOpened({ at, where: 'in this browser, over Wi-Fi' });
    onOpened?.({ opened: true, at, target: 'this browser (wireless)', url: target, route: 'wireless' });
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(wireless.url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setError('Could not copy — select the address above instead.'); }
  };

  const wirelessSection = html`
    <div class="vr-quest-route">
      <div class="vr-quest-route-title"><i class="fas fa-wifi"></i> Over Wi-Fi <span>no cable, no adb</span></div>
      ${!projectDir && html`<p class="vr-quest-note">Build a project to get its address.</p>`}
      ${projectDir && !wireless.available && html`<p class="vr-quest-note">
        ${wireless.reason === 'loopback-only'
          ? html`This hub only listens on this machine. Start it with <code>python3 serve.py 8084 --host 0.0.0.0 --https-port 8443</code> and a headset on the same Wi-Fi can open runs directly.`
          : html`This server does not report its network address yet — restart <code>serve.py</code> to pick up the wireless route.`}
      </p>`}
      ${wireless.available && html`
        <div class="vr-quest-status">
          ${wireless.vrReady === true && html`<span class="vr-good"><i class="fas fa-circle-check"></i> This browser can enter VR here</span>`}
          ${wireless.vrReady === false && html`<span class="vr-warn"><i class="fas fa-triangle-exclamation"></i> Opens flat — this address is not secure, so the browser hides Enter VR</span>`}
          ${wireless.vrReady === null && html`<span class=${wireless.secure ? 'vr-good' : 'vr-warn'}>
            <i class=${`fas ${wireless.secure ? 'fa-lock' : 'fa-lock-open'}`}></i>
            ${wireless.secure ? 'Secure address — the headset can enter VR' : 'Plain HTTP — the headset opens it flat, without Enter VR'}
          </span>`}
        </div>
        <code class="vr-quest-url" title="What a headset on the same network opens — served straight from the data root">${wireless.url}</code>
        <div class="vr-quest-actions">
          ${wireless.here && html`
            <button class=${`gf-btn ${wireless.vrReady || !wireless.secureUrl ? 'gf-primary' : ''}`} onClick=${() => openHere(wireless.url)}
              title="Open this run in a new tab of this browser">
              <i class="fas fa-arrow-up-right-from-square"></i> Open here
            </button>`}
          ${wireless.here && wireless.secureUrl && html`
            <button class="gf-btn gf-primary" onClick=${() => openHere(wireless.secureUrl)}
              title=${wireless.trusted
                ? "Open the run on the hub's Tailscale HTTPS address, where the browser allows VR. No certificate warning."
                : "Open the run on the hub's HTTPS port, where the browser allows VR. Accept the certificate warning the first time."}>
              <i class="fas fa-lock"></i> Open in VR (HTTPS)
            </button>`}
          ${!wireless.here && html`
            <button class="gf-btn" onClick=${copyLink} title="Copy the address to open in Quest Browser">
              <i class=${`fas ${copied ? 'fa-check' : 'fa-copy'}`}></i> ${copied ? 'Copied' : 'Copy address'}
            </button>`}
        </div>
        ${!wireless.secure && html`<p class="vr-quest-note">
          Browsers only allow VR on a secure address. Two ways to get one, both once only:
          ${wireless.secureUrl
            ? (wireless.trusted
              ? html` use <b>Open in VR (HTTPS)</b> — over Tailscale the certificate is a real one, so there is no warning;`
              : html` use <b>Open in VR (HTTPS)</b> and accept the certificate warning (Advanced → Proceed);`)
            : html` restart the hub with <code>--https-port 8443</code> and open its <code>https://</code> address, accepting the certificate warning;`}
          ${' '}or in Quest Browser open <code>chrome://flags</code>, find <b>Insecure origins treated as secure</b>,
          add <code>${wireless.flagOrigin}</code>, enable it and relaunch.
        </p>`}
        ${wireless.secure && !wireless.here && html`<p class="vr-quest-note">
          The certificate is self-signed, so the headset warns once: Advanced → Proceed.
        </p>`}`}
    </div>`;

  const open = async () => {
    setBusy('open'); setError('');
    try {
      const result = await openOnQuest(url);
      const at = new Date().toISOString();
      setOpened({ at, where: `on ${result.target}` });
      onOpened?.({ opened: true, at, target: result.target, url });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const restore = async () => {
    setBusy('reverse'); setError('');
    try { setStatus({ ...(await restoreQuestReverse()), reachable: true, ...(await questStatus()) }); }
    catch (e) { setError(e.message); }
    finally { setBusy(''); }
  };

  if (status && !status.reachable) {
    return html`
      <div class="vr-quest-pane">
        <div class="vr-pane-bar"><span><i class="fas fa-vr-cardboard"></i> On the Quest</span></div>
        <div class="vr-quest-body">
          <p class="vr-quest-note">
            This server has no Quest bridge. Run the hub with <code>python3 serve.py 8084</code> to get headset
            status and one-click opening; everything else in VR Forge works without it.
          </p>
          ${url && html`<code class="vr-quest-url">${url}</code>`}
          ${wireless.available && wirelessSection}
        </div>
      </div>`;
  }

  const connected = !!status?.connected;
  const reverse = !!status?.reverseActive;
  return html`
    <div class="vr-quest-pane">
      <div class="vr-pane-bar">
        <span><i class="fas fa-vr-cardboard"></i> On the Quest</span>
        <div class="vr-pane-actions">
          <button class="gf-btn" onClick=${refresh} title="Check the headset connection now">
            <i class="fas fa-rotate"></i></button>
        </div>
      </div>
      <div class="vr-quest-body">
        ${wireless.here && wirelessSection}
        <div class="vr-quest-route">
        <div class="vr-quest-route-title"><i class="fas fa-plug"></i> adb reverse <span>the hub as localhost on the headset</span></div>
        <div class="vr-quest-status">
          <span class=${connected ? 'vr-good' : (wireless.here ? 'vr-warn' : 'vr-bad')}>
            <i class=${`fas ${connected ? 'fa-circle-check' : 'fa-circle-xmark'}`}></i>
            ${connected ? `${status.devices?.find(d => d.serial === status.target)?.model || 'Quest'} connected` : 'No headset on adb'}
          </span>
          <span class=${reverse ? 'vr-good' : 'vr-warn'}>
            <i class=${`fas ${reverse ? 'fa-link' : 'fa-link-slash'}`}></i>
            ${reverse ? `reverse tcp:${status.reversePort} alive` : 'port reverse not active'}
          </span>
          ${!status?.adb && html`<span class="vr-bad"><i class="fas fa-triangle-exclamation"></i> adb not found on this machine</span>`}
        </div>

        ${url
          ? html`<code class="vr-quest-url" title="What the headset opens — served straight from the data root">${url}</code>`
          : html`<p class="vr-quest-note">Build a project to get its headset URL.</p>`}

        <div class="vr-quest-actions">
          <button class="gf-btn gf-primary" disabled=${!url || !connected || busy === 'open'} onClick=${open}
            title=${connected ? 'Open this run in Quest Browser' : 'Connect the headset over adb first'}>
            <i class=${`fas ${busy === 'open' ? 'fa-spinner fa-spin' : 'fa-arrow-up-right-from-square'}`}></i> Open on Quest
          </button>
          <button class="gf-btn" disabled=${!connected || reverse || busy === 'reverse'} onClick=${restore}
            title="Re-establish adb reverse tcp:8084 after the headset slept">
            <i class=${`fas ${busy === 'reverse' ? 'fa-spinner fa-spin' : 'fa-link'}`}></i> Restore reverse
          </button>
        </div>
        </div>
        ${!wireless.here && wirelessSection}

        ${opened && html`<p class="vr-quest-note vr-good">
          <i class="fas fa-check"></i> Opened ${opened.where} at ${new Date(opened.at).toLocaleTimeString()}.
          What happens next is only visible in the headset — it is recorded as provenance, not as evidence.
        </p>`}
        ${error && html`<p class="vr-quest-note vr-bad"><i class="fas fa-triangle-exclamation"></i> ${error}</p>`}
      </div>
    </div>`;
}
