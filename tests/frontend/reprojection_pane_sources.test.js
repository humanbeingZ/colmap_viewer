const assert = require("assert");
const paneSources = require(
    "../../static/js/reprojection/pane_sources.js"
);

assert.strictEqual(paneSources.isImage("image"), true);
assert.strictEqual(paneSources.isColmap("colmap"), true);
assert.strictEqual(paneSources.isGpuGeometry("17"), true);
assert.strictEqual(paneSources.isGpuGeometry("image"), false);
assert.strictEqual(paneSources.isGpuGeometry("colmap"), false);
assert.strictEqual(paneSources.isGeometry("colmap"), true);
assert.strictEqual(paneSources.isGeometry("image"), false);
assert.strictEqual(paneSources.cycleIndex(0, 4, 1), 1);
assert.strictEqual(paneSources.cycleIndex(0, 4, -1), 3);
assert.strictEqual(paneSources.cycleIndex(3, 4, 1), 0);

console.log("reprojection pane source tests passed");
