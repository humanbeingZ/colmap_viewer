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
assert.strictEqual(paneSources.isPointCloud("server-mesh", [
    {
        gpuKey: "server-mesh",
        kind: "triangle mesh",
        renderPath: "server",
    },
]), true, "server fallback renders every configured geometry as points");
assert.strictEqual(paneSources.renderPath("mesh"), "gpu");
assert.strictEqual(paneSources.renderPath("image"), "image");
assert.strictEqual(paneSources.renderPath("colmap", {
    colmapGpuReady: true,
    cameraSupported: true,
}), "gpu");
assert.strictEqual(paneSources.renderPath("colmap", {
    colmapGpuReady: true,
    cameraSupported: false,
}), "server", "unsupported cameras keep the distortion-aware server path");
assert.strictEqual(paneSources.renderPath("colmap", {
    colmapGpuReady: false,
    cameraSupported: true,
}), "server", "COLMAP uses the server while its GPU geometry is unavailable");
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
assert.deepStrictEqual(
    paneSources.sourceLabelDisplay("always"),
    {visible: true, timeoutMs: null}
);
assert.deepStrictEqual(
    paneSources.sourceLabelDisplay("temporary"),
    {visible: true, timeoutMs: 2000}
);
assert.deepStrictEqual(
    paneSources.sourceLabelDisplay("hidden"),
    {visible: false, timeoutMs: null}
);
assert.deepStrictEqual(
    paneSources.sourceLabelDisplay("unexpected"),
    {visible: true, timeoutMs: null},
    "unknown modes preserve the always-visible default"
);

console.log("reprojection pane source tests passed");
