import assert from "node:assert/strict";
import {PerspectiveCamera, Vector3} from "three";
import {
    depthRangeForSphere,
    detectPlyKind,
    imageFrameScissor,
    projectionFrustum,
    relativeViewTransform,
    screenRenderSize,
    threeViewRows,
    zoomDetailMaxSize,
    zoomViewRegion,
} from "../../static/js/reprojection/gpu_camera.mjs";

assert.deepEqual(threeViewRows([
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11, 12],
]), [
    [1, 2, 3, 4],
    [-5, -6, -7, -8],
    [-9, -10, -11, -12],
    [0, 0, 0, 1],
]);

const projection = projectionFrustum({
    width: 1000,
    height: 500,
    camera: {model: "PINHOLE", params: [800, 700, 450, 220]},
}, 0.1, 100);
assert.equal(projection.left, -450 * 0.1 / 800);
assert.equal(projection.right, 550 * 0.1 / 800);
assert.equal(projection.top, 220 * 0.1 / 700);
assert.equal(projection.bottom, -280 * 0.1 / 700);

const croppedProjection = projectionFrustum({
    width: 1000,
    height: 500,
    camera: {model: "PINHOLE", params: [800, 700, 450, 220]},
}, 0.1, 100, {left: 250, right: 750, top: 125, bottom: 375});
assert.equal(croppedProjection.left, -200 * 0.1 / 800);
assert.equal(croppedProjection.right, 300 * 0.1 / 800);
assert.equal(croppedProjection.top, 95 * 0.1 / 700);
assert.equal(croppedProjection.bottom, -155 * 0.1 / 700);

assert.deepEqual(depthRangeForSphere(20, 2, false), {
    near: 9,
    far: 22.1,
});
const enclosingRange = depthRangeForSphere(2, 10, false);
assert.equal(enclosingRange.near, 0.001);
assert.equal(enclosingRange.far, 12.5);
assert.equal(depthRangeForSphere(2, 10, true).near, 0.00001);

const detailImage = {width: 6000, height: 4000};
assert.equal(zoomDetailMaxSize(detailImage, 1600, 1), 1600);
assert.equal(zoomDetailMaxSize(detailImage, 1600, 1.1), 1792);
assert.equal(zoomDetailMaxSize(detailImage, 1600, 4), 6000);
assert.equal(zoomDetailMaxSize(detailImage, 1600, 10, false, 4096), 4096);
assert.equal(zoomDetailMaxSize(detailImage, 768, 5, true), 768);

assert.deepEqual(screenRenderSize(800, 600, 2), {
    width: 1600,
    height: 1200,
});
assert.deepEqual(screenRenderSize(5000, 3000, 2, 8192), {
    width: 8192,
    height: 4915,
});
assert.deepEqual(screenRenderSize(800, 600, 0.5), {
    width: 800,
    height: 600,
});

assert.deepEqual(zoomViewRegion(
    {width: 1000, height: 500}, 1000, 500, 2, -500, -250
), {left: 250, right: 750, top: 125, bottom: 375});
assert.deepEqual(imageFrameScissor(
    {width: 1000, height: 500},
    1000,
    500,
    {left: -500, right: 1500, top: -250, bottom: 750}
), {x: 250, y: 125, width: 500, height: 250});
assert.deepEqual(imageFrameScissor(
    {width: 1000, height: 500},
    1000,
    500,
    {left: 250, right: 750, top: 125, bottom: 375}
), {x: 0, y: 0, width: 1000, height: 500});
assert.deepEqual(relativeViewTransform(
    {scale: 2, translateX: -500, translateY: -250},
    {scale: 3, translateX: -900, translateY: -400}
), {scale: 1.5, translateX: -150, translateY: -25});

const camera = new PerspectiveCamera();
camera.projectionMatrix.makePerspective(
    projection.left, projection.right, projection.top, projection.bottom,
    projection.near, projection.far, camera.coordinateSystem
);
camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
const colmapPoint = {x: 0.25, y: -0.1, z: 2};
const ndc = new Vector3(
    colmapPoint.x, -colmapPoint.y, -colmapPoint.z
).project(camera);
assert.ok(Math.abs((ndc.x + 1) * 500 - (800 * 0.25 / 2 + 450)) < 1e-9);
assert.ok(Math.abs((1 - ndc.y) * 250 - (700 * -0.1 / 2 + 220)) < 1e-9);

assert.equal(detectPlyKind("element vertex 3\nelement face 1"), "triangle mesh");
assert.equal(detectPlyKind("element vertex 3\nelement face 0"), "point cloud");
assert.equal(detectPlyKind(`
element vertex 3
property float scale_0
property float scale_1
property float scale_2
property float rot_0
property float rot_1
property float rot_2
property float rot_3
property float f_dc_0
property float f_dc_1
property float f_dc_2
property float opacity
`), "gaussian splats");

console.log("GPU camera and PLY detection tests passed");
