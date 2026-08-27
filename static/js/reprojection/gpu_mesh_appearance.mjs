export const DEFAULT_MESH_SHADING = "face";
export const DEFAULT_MESH_COLOR = "solid";
export const DEFAULT_MESH_BRIGHTNESS = 1;

const SHADING_MODES = new Set(["face", "none"]);
const COLOR_MODES = new Set(["vertex", "solid"]);

export function meshShading(value) {
    return SHADING_MODES.has(value) ? value : DEFAULT_MESH_SHADING;
}

export function meshColor(value) {
    return COLOR_MODES.has(value) ? value : DEFAULT_MESH_COLOR;
}

export function meshBrightness(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return DEFAULT_MESH_BRIGHTNESS;
    }
    return Math.max(0.25, Math.min(3, numeric));
}

export function meshMaterialDescription(shading, color, hasVertexColors) {
    const shadingMode = meshShading(shading);
    const colorMode = meshColor(color);
    const useVertexColors = colorMode === "vertex" && hasVertexColors;
    return {
        lit: shadingMode === "face",
        flatShading: shadingMode === "face",
        vertexColors: useVertexColors,
        color: useVertexColors ? 0xffffff : 0xc0c0c0,
    };
}
