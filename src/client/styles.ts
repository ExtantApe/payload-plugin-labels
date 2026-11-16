/** Styles use Payload's theme variables with fallbacks, so the editor follows light and dark mode. */
export const LABELS_STYLES = `
.labels-editor { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(220px, 2fr) minmax(220px, 1fr); gap: var(--base, 1rem); color: var(--theme-text, #111); font-size: 0.9rem; }
@media (max-width: 900px) { .labels-editor { grid-template-columns: 1fr; } }
.labels-editor h3 { margin: 0 0 0.5rem; font-size: 1rem; }
.labels-editor button, .labels-editor input, .labels-editor select, .labels-editor textarea { font: inherit; color: inherit; background: var(--theme-input-bg, var(--theme-bg, #fff)); border: 1px solid var(--theme-elevation-300, #999); border-radius: 4px; padding: 0.3rem 0.5rem; min-height: 2rem; }
.labels-editor button { cursor: pointer; background: var(--theme-elevation-100, #eee); }
.labels-editor :focus-visible { outline: 3px solid var(--theme-text, #111); outline-offset: 2px; }
.labels-editor label { display: grid; gap: 0.2rem; margin-bottom: 0.5rem; }
.labels-editor .labels-check { display: flex; align-items: center; gap: 0.5rem; }
.labels-layers { list-style: none; margin: 0 0 0.5rem; padding: 0; border: 1px solid var(--theme-elevation-300, #999); border-radius: 4px; }
.labels-layers [role='option'] { padding: 0.4rem 0.6rem; cursor: pointer; border-bottom: 1px solid var(--theme-elevation-150, #ddd); }
.labels-layers [role='option'][aria-selected='true'] { background: var(--theme-elevation-200, #ddd); font-weight: 600; }
.labels-layers [data-hidden='true'] { opacity: 0.6; text-decoration: line-through; }
.labels-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-bottom: 0.5rem; }
.labels-preview { background: var(--theme-elevation-100, #eee); padding: 0.5rem; border-radius: 4px; overflow: auto; }
.labels-preview svg { max-width: 100%; height: auto; background: #fff; box-shadow: 0 0 0 1px var(--theme-elevation-300, #999); }
.labels-warnings { margin: 0.5rem 0 0; padding-left: 1.2rem; color: var(--theme-warning-800, #7a4b00); }
.labels-error { color: var(--theme-error-700, #a00000); }
.labels-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`
