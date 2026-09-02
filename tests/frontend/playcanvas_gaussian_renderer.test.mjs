import assert from "node:assert/strict";

import {
    PlayCanvasGaussianRenderer,
    playCanvasCameraWorldData,
    playCanvasProjectionData,
    shouldReorderGaussianData,
} from "../../static/js/reprojection/playcanvas_gaussian_renderer.mjs";

const projection = playCanvasProjectionData({
    left: -1,
    right: 3,
    bottom: -2,
    top: 2,
    near: 2,
    far: 10,
});
assert.deepEqual(projection, [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0.5, 0, -1.5, -1,
    0, 0, -5, 0,
]);

const cameraWorld = playCanvasCameraWorldData([
    [1, 0, 0, 1],
    [0, 1, 0, 2],
    [0, 0, 1, 3],
]);
assert.deepEqual(cameraWorld.map(value => Object.is(value, -0) ? 0 : value), [
    1, 0, 0, 0,
    0, -1, 0, 0,
    0, 0, -1, 0,
    -1, -2, -3, 1,
]);
assert.equal(shouldReorderGaussianData({isWebGPU: true}), false);
assert.equal(shouldReorderGaussianData({isWebGPU: false}), true);

const uninitialized = Object.create(PlayCanvasGaussianRenderer.prototype);
uninitialized.app = null;
uninitialized.cameraEntity = {};
uninitialized.destroyed = false;
uninitialized.entries = new Map();
uninitialized.activeKey = null;
assert.doesNotThrow(() => uninitialized.destroy());
assert.equal(uninitialized.destroyed, true);
assert.equal(uninitialized.cameraEntity, null);

{
    const renderer = Object.create(PlayCanvasGaussianRenderer.prototype);
    renderer.ready = Promise.resolve();
    renderer.activate = () => {};
    renderer.configureCamera = () => {};
    renderer.cameraEntity = {camera: {scissorRect: null}};
    let postrender;
    let finishGpuWork;
    const gpuWork = new Promise(resolve => { finishGpuWork = resolve; });
    renderer.app = {
        graphicsDevice: {
            wgpu: {queue: {onSubmittedWorkDone: () => gpuWork}},
        },
        once: (event, callback) => {
            assert.equal(event, "postrender");
            postrender = callback;
        },
        setCanvasResolution: () => {},
        renderNextFrame: false,
    };

    let completed = false;
    const pending = renderer.render("gaussian", {}, 640, 480)
        .then(() => { completed = true; });
    await Promise.resolve();
    assert.equal(renderer.app.renderNextFrame, true);
    postrender();
    await Promise.resolve();
    assert.equal(completed, false);
    finishGpuWork();
    await pending;
    assert.equal(completed, true);
}

{
    const renderer = Object.create(PlayCanvasGaussianRenderer.prototype);
    renderer.canvas = {name: "gaussian-canvas"};
    let rendered = false;
    renderer.render = async () => { rendered = true; };
    const previousCreateImageBitmap = globalThis.createImageBitmap;
    globalThis.createImageBitmap = async source => ({source});
    try {
        const frame = await renderer.captureFrame(
            "gaussian", {}, 640, 480
        );
        assert.equal(rendered, true);
        assert.equal(frame.source, renderer.canvas);
    } finally {
        if (previousCreateImageBitmap) {
            globalThis.createImageBitmap = previousCreateImageBitmap;
        } else {
            delete globalThis.createImageBitmap;
        }
    }
}

console.log("PlayCanvas Gaussian renderer camera and lifecycle tests passed");
