import { html } from 'htm/preact';
import { useState } from 'preact/hooks';

export function RatingWidget({ rating = 0, onChange, readonly = false, size = 14 }) {
  const [hovered, setHovered] = useState(0);

  if (readonly) {
    return html`
      <span class="rating-display">
        ${[1, 2, 3, 4, 5].map(i => html`
          <i key=${i}
            class=${`fa-star ${i <= rating ? 'fa-solid' : 'fa-regular empty'}`}
            style=${{ fontSize: size + 'px' }}
          ></i>
        `)}
      </span>
    `;
  }

  return html`
    <span class="rating-widget" onMouseLeave=${() => setHovered(0)}>
      ${[1, 2, 3, 4, 5].map(i => html`
        <button key=${i}
          class=${`rating-star ${i <= rating ? 'filled' : ''} ${i <= hovered ? 'hovered' : ''}`}
          style=${{ fontSize: size + 'px' }}
          onMouseEnter=${() => setHovered(i)}
          onClick=${() => onChange && onChange(i === rating ? 0 : i)}
          title=${`${i} star${i > 1 ? 's' : ''}`}
        >
          <i class=${`${i <= (hovered || rating) ? 'fa-solid' : 'fa-regular'} fa-star`}></i>
        </button>
      `)}
    </span>
  `;
}
