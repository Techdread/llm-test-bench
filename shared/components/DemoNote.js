import { html } from 'htm/preact';

// One line above a gallery's preview while its bundled demo is on screen:
// what it is, which model made it, and what to do next. `onClear` empties the
// editors for a fresh start.
export function DemoNote({ demo, onClear, next = 'Edit the prompt, pick a model and press Generate to make your own.' }) {
  if (!demo) return null;
  return html`
    <div class="demo-note" role="note">
      <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
      <span>
        <strong>Demo: ${demo.title}</strong>${demo.model ? html`, built by ${demo.model} from the prompt shown.` : '.'}
        ${' '}${next}
      </span>
      ${onClear && html`<button class="btn btn-sm" type="button" onClick=${onClear}>Start empty</button>`}
    </div>`;
}
