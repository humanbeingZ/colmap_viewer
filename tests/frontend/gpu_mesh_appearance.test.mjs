import assert from "node:assert/strict";
import {
    DEFAULT_MESH_COLOR,
    DEFAULT_MESH_BRIGHTNESS,
    DEFAULT_MESH_SHADING,
    meshColor,
    meshBrightness,
    meshMaterialDescription,
    meshShading,
} from "../../static/js/reprojection/gpu_mesh_appearance.mjs";

assert.equal(meshShading("unknown"), DEFAULT_MESH_SHADING);
assert.equal(meshColor("unknown"), DEFAULT_MESH_COLOR);
assert.equal(meshBrightness("unknown"), DEFAULT_MESH_BRIGHTNESS);
assert.equal(meshBrightness(0), 0.25);
assert.equal(meshBrightness(4), 3);
assert.equal(meshBrightness(1.4), 1.4);
assert.deepEqual(meshMaterialDescription("face", "vertex", true), {
    lit: true,
    vertexColors: true,
    color: 0xffffff,
});
assert.deepEqual(meshMaterialDescription("face", "solid", true), {
    lit: true,
    vertexColors: false,
    color: 0xc0c0c0,
});
assert.deepEqual(meshMaterialDescription("none", "vertex", false), {
    lit: false,
    vertexColors: false,
    color: 0xc0c0c0,
});

console.log("GPU mesh appearance tests passed");
