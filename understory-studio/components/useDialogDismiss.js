// useDialogDismiss — Escape-to-close for modal dialogs.
//
// Paired with removing the overlay's outside-click handler, this makes a dialog
// dismissable only by its close button or the Escape key — never by an
// accidental click on the backdrop, which can lose in-progress input.
//
//   useDialogDismiss(onClose);              // Esc closes
//   useDialogDismiss(onClose, { disabled }); // Esc ignored while `disabled`

import { useEffect } from 'preact/hooks';

export function useDialogDismiss(onClose, { disabled = false } = {}) {
  useEffect(() => {
    if (disabled || typeof onClose !== 'function') return undefined;
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, disabled]);
}
