import { html } from 'htm/preact';
import { useState } from 'preact/hooks';
import { RATING_MAX } from '../services/rating.js';

const STARS = Array.from({ length: RATING_MAX }, (_, i) => i + 1);

// `rating` is on the 0–10 scale — pass ratingOf(metadata), never the raw field.
export function RatingWidget({ rating = 0, onChange, readonly = false, size = 14 }) {
  const [hovered, setHovered] = useState(0);

  if (readonly) {
    return html`
      <span class="rating-display" title=${rating ? `${rating}/${RATING_MAX}` : 'Not rated'}>
        ${STARS.map(i => html`
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
      ${STARS.map(i => html`
        <button key=${i}
          class=${`rating-star ${i <= rating ? 'filled' : ''} ${i <= hovered ? 'hovered' : ''}`}
          style=${{ fontSize: size + 'px' }}
          onMouseEnter=${() => setHovered(i)}
          onClick=${(e) => { e.stopPropagation(); onChange && onChange(i === rating ? 0 : i); }}
          title=${i === rating ? 'Clear rating' : `${i}/${RATING_MAX}`}
        >
          <i class=${`${i <= (hovered || rating) ? 'fa-solid' : 'fa-regular'} fa-star`}></i>
        </button>
      `)}
      <span class="rating-value">${(hovered || rating) ? `${hovered || rating}/${RATING_MAX}` : ''}</span>
    </span>
  `;
}
