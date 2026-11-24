"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isJsonContentType = isJsonContentType;
/** True only when the Content-Type media type is application/json (parameters like charset allowed). */
function isJsonContentType(header) {
    return /^application\/json(\s*;|$)/i.test((header || '').trim());
}
