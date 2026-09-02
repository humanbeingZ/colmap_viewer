import assert from "node:assert/strict";
import {
    Float32BufferAttribute,
    Matrix4,
    Uint8BufferAttribute,
} from "three/webgpu";

import {
    instancedAttributeView,
    needsVisiblePointDepthRange,
    visiblePointDepthPercentiles,
} from "../../static/js/reprojection/gpu_point_cloud.mjs";

assert.equal(needsVisiblePointDepthRange("point cloud", "depth"), true);
assert.equal(needsVisiblePointDepthRange("point cloud", "rgb"), false);
assert.equal(needsVisiblePointDepthRange("point cloud", "white"), false);
assert.equal(needsVisiblePointDepthRange("triangle mesh", "depth"), false);

{
    const colors = new Uint8BufferAttribute([255, 0, 0], 3, true);
    const instancedColors = instancedAttributeView(colors);
    assert.equal(instancedColors.isInstancedBufferAttribute, true);
    assert.equal(instancedColors.array, colors.array);
    assert.equal(instancedColors.normalized, true);
}

const position = new Float32BufferAttribute([
    0, 0, -1,
    0, 0, -2,
    0, 0, -3,
    0, 0, -4,
    0, 0, -5,
    8, 0, -3,
    0, 0, 1,
], 3);
const range = visiblePointDepthPercentiles(
    position,
    new Matrix4(),
    {left: -1, right: 1, bottom: -1, top: 1, near: 1},
    {near: 1.5, far: 4.5}
);

// Only depths 2, 3, and 4 survive clipping, positive-depth, and frustum tests.
// NumPy's default linear percentile convention gives these interpolated ends.
assert.ok(Math.abs(range.near - 2.04) < 1e-12);
assert.ok(Math.abs(range.far - 3.96) < 1e-12);

assert.equal(visiblePointDepthPercentiles(
    position,
    new Matrix4(),
    {left: -1, right: 1, bottom: -1, top: 1, near: 1},
    {near: 10, far: 20}
), null);

console.log("GPU point appearance tests passed");
