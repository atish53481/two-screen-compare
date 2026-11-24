"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderJson = renderJson;
/** No images; screenshot fields hold file names only (the model already strips directories). */
function renderJson(model) {
    return JSON.stringify(model, null, 2);
}
