import { html } from 'htm/preact';
import { BudgetDialog as SharedBudgetDialog, BUDGET_FIELDS } from '../../shared/forge/components/BudgetDialog.js';
import { normalizeBudgets } from '../services/budgets.js';

// The shared Forge budgets dialog (no ceilings, a "No limit" toggle per field),
// normalised with this Forge's own defaults.
export function BudgetDialog(props) {
  return html`<${SharedBudgetDialog} ...${props} fields=${BUDGET_FIELDS} normalize=${normalizeBudgets} />`;
}
