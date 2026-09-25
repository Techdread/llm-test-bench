import { html } from 'htm/preact';
import { SvgImage } from './SvgImage.js';

export function SvgPreview({ svgContent, size }) {
  const hasSvg = !!(svgContent && svgContent.trim());

  return html`
    <div class="svg-preview">
      <div class="section-header">
        <span><i class="fa-solid fa-eye"></i> Preview</span>
      </div>
      <div class="svg-preview-container"
        style=${{ width: size ? `${size}px` : '100%', height: size ? `${size}px` : '100%' }}
      >
        ${hasSvg
          ? html`<${SvgImage} svg=${svgContent} />`
          : html`
            <div class="svg-preview-empty">
              <i class="fa-solid fa-image"></i>
              <p>SVG preview will appear here</p>
            </div>
          `}
      </div>
    </div>
  `;
}
