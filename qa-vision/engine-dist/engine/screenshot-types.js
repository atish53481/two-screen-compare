"use strict";
/**
 * Types for the independent Two Screen Comparison tab (screenshot vs screenshot, no live browser).
 * Dependency-free so client components can import them without pulling sharp/pngjs into the browser bundle.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHOT_LIMITS = exports.DEFAULT_TEXT_OPTIONS = exports.CATEGORY_SCOPE = exports.SHOT_SCOPE_INFO = exports.DEFAULT_SHOT_SCOPE = exports.SHOT_SCOPES = void 0;
/** All scopes in report priority order: data > images/diagrams > optional styling/layout/forms. */
exports.SHOT_SCOPES = ['data_text', 'images_diagrams', 'css_styling', 'alignment_layout', 'form_states'];
exports.DEFAULT_SHOT_SCOPE = ['data_text'];
exports.SHOT_SCOPE_INFO = {
    data_text: { label: 'Data & Text', priority: 'P1', code: 'DATA', description: 'Visible business values, table cells, labels, numbers, dates, currencies, statuses, IDs, totals, counts, error messages' },
    images_diagrams: { label: 'Images & Diagrams', priority: 'P2', code: 'IMG', description: 'Missing/wrong images, charts, icons with business meaning, diagram nodes, labels, legends' },
    css_styling: { label: 'CSS & Visual Styling', priority: 'P3', code: 'CSS', description: 'Colors, font size/weight, borders, backgrounds, element styling (visual estimates)' },
    alignment_layout: { label: 'Alignment & Layout', priority: 'P3', code: 'LAY', description: 'Element positions, dimensions, overlap, clipping, misalignment' },
    form_states: { label: 'Form Elements & States', priority: 'P3', code: 'FORM', description: 'Checked/selected states, enabled/disabled appearance, missing controls (visual estimates)' },
};
/** Which scope each finding category belongs to. */
exports.CATEGORY_SCOPE = {
    data: 'data_text',
    text: 'data_text',
    visual: 'images_diagrams',
    color: 'css_styling',
    typography: 'css_styling',
    layout: 'alignment_layout',
    state: 'form_states',
};
exports.DEFAULT_TEXT_OPTIONS = { matching: 'normalized', caseSensitive: false, numericTolerance: 0, minConfidence: 60, ignoreFields: [] };
exports.SHOT_LIMITS = {
    maxBytes: 10 * 1024 * 1024,
    maxPixels: 16_777_216, // 4096 x 4096 equivalent; tall full-page shots are fine up to this pixel count
    maxEdge: 16384,
    formats: ['png', 'jpeg', 'webp'],
};
