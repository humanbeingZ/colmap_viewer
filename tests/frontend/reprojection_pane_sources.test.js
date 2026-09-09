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
assert.strictEqual(paneSources.isPointCloud("colmap"), true);
assert.strictEqual(paneSources.isPointCloud("image"), false);
assert.strictEqual(paneSources.isPointCloud("mesh", [
    {gpuKey: "mesh", kind: "triangle mesh"},
]), false);
assert.strictEqual(paneSources.isPointCloud("points", [
    {gpuKey: "points", kind: "point cloud"},
]), true);
assert.strictEqual(paneSources.cycleIndex(0, 4, 1), 1);
assert.strictEqual(paneSources.cycleIndex(0, 4, -1), 3);
assert.strictEqual(paneSources.cycleIndex(3, 4, 1), 0);
assert.strictEqual(
    paneSources.uniqueLabel("point_cloud.ply", []),
    "point_cloud.ply"
);
assert.strictEqual(
    paneSources.uniqueLabel(
        "point_cloud.ply",
        ["point_cloud.ply", "point_cloud.ply (2)"]
    ),
    "point_cloud.ply (3)"
);
assert.strictEqual(paneSources.uniqueLabel("  ", []), "Geometry");

console.log("reprojection pane source tests passed");
