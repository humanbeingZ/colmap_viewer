import assert from "node:assert/strict";

import {
    PlayCanvasGaussianRenderer,
    flipRgbaRows,
    gaussianPointCloudData,
    playCanvasCameraWorldData,
    playCanvasProjectionData,
    shouldReorderGaussianData,
    unpremultiplyRgba,
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
assert.deepEqual(
    [...flipRgbaRows(new Uint8Array([
        1, 2, 3, 4, 5, 6, 7, 8,
        9, 10, 11, 12, 13, 14, 15, 16,
    ]), 2, 2)],
    [
        9, 10, 11, 12, 13, 14, 15, 16,
        1, 2, 3, 4, 5, 6, 7, 8,
    ]
);
assert.deepEqual(
    [...unpremultiplyRgba(new Uint8ClampedArray([
        64, 32, 16, 128,
        10, 20, 30, 255,
        20, 30, 40, 0,
    ]))],
    [
        128, 64, 32, 128,
        10, 20, 30, 255,
        0, 0, 0, 0,
    ]
);

{
    const positions = new Float32Array([1, 2, 3, 4, 5, 6]);
    const properties = {
        f_dc_0: new Float32Array([0, 0]),
        f_dc_1: new Float32Array([0, 0]),
        f_dc_2: new Float32Array([0, 0]),
    };
    const pointCloud = gaussianPointCloudData({
        centers: positions,
        numSplats: 2,
        gsplatData: {getProp: name => properties[name]},
    });
    assert.equal(pointCloud.positions, positions);
    assert.deepEqual([...pointCloud.colors], [128, 128, 128, 128, 128, 128]);
}

{
    const positions = new Float32Array([1, 2, 3]);
    const pointCloud = gaussianPointCloudData({
        centers: positions,
        numSplats: 1,
        gsplatData: {
            createIter: (_position, _rotation, _scale, color) => ({
                read: () => color.set(0.25, 0.5, 0.75, 1),
            }),
        },
    });
    assert.equal(pointCloud.positions, positions);
    assert.deepEqual([...pointCloud.colors], [64, 128, 191]);
}

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
    const pixels = new Uint8Array([
        1, 2, 3, 4, 5, 6, 7, 8,
        9, 10, 11, 12, 13, 14, 15, 16,
    ]);
    const renderTarget = {name: "capture-target"};
    let renderArguments = null;
    let renderCount = 0;
    renderer._ensureCaptureTarget = () => ({
        renderTarget,
        colorBuffer: {
            read: async () => pixels,
        },
    });
    renderer.render = async (...args) => {
        renderArguments = args;
        renderCount += 1;
    };
    const previousImageData = globalThis.ImageData;
    globalThis.ImageData = class {
        constructor(data, width, height) {
            this.data = data;
            this.width = width;
            this.height = height;
        }
    };
    try {
        const frame = await renderer.captureFrame(
            "gaussian", {}, 2, 2
        );
        assert.equal(renderCount, 2);
        assert.equal(renderArguments.at(-1), renderTarget);
        assert.equal(frame.width, 2);
        assert.equal(frame.height, 2);
        assert.deepEqual([...frame.data], [
            191, 213, 234, 12, 207, 223, 239, 16,
            64, 128, 191, 4, 159, 191, 223, 8,
        ]);
    } finally {
        if (previousImageData) {
            globalThis.ImageData = previousImageData;
        } else {
            delete globalThis.ImageData;
        }
    }
}

console.log("PlayCanvas Gaussian renderer camera and lifecycle tests passed");
