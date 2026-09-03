const assert = require("assert");
const gpuCanvas = require(
    "../../static/js/reprojection/gpu_canvas.js"
);

const threeCanvas = {name: "three"};
const gaussianCanvas = {name: "playcanvas"};
assert.strictEqual(
    gpuCanvas.canvasForEngine(
        threeCanvas, gaussianCanvas, "playcanvas"
    ),
    gaussianCanvas
);
assert.strictEqual(
    gpuCanvas.canvasForEngine(threeCanvas, gaussianCanvas, "three"),
    threeCanvas
);
assert.strictEqual(
    gpuCanvas.canvasForEngine(threeCanvas, gaussianCanvas, null),
    threeCanvas
);
assert.strictEqual(
    gpuCanvas.needsLiveOutgoingCanvas(threeCanvas, gaussianCanvas), true
);
assert.strictEqual(
    gpuCanvas.needsLiveOutgoingCanvas(threeCanvas, threeCanvas), false
);
assert.strictEqual(
    gpuCanvas.needsLiveOutgoingCanvas(null, threeCanvas), false
);
assert.strictEqual(gpuCanvas.sourceTransition(true, true), "attach");
assert.strictEqual(gpuCanvas.sourceTransition(true, false), "attach");
assert.strictEqual(gpuCanvas.sourceTransition(false, true), "keep");
assert.strictEqual(gpuCanvas.sourceTransition(false, false), "disable");
assert.strictEqual(gpuCanvas.leftFrameReusable(true, false), true);
assert.strictEqual(
    gpuCanvas.leftFrameReusable(true, true),
    false,
    "a comparison frame must be redrawn before an independent right pane clips it"
);
assert.strictEqual(gpuCanvas.leftFrameReusable(false, false), false);

const rightPresentationCases = [
    {
        name: "shares a completed matching GPU source",
        input: {
            selectedSource: "gaussian",
            renderedSource: "image",
            leftSelectedSource: "gaussian",
            leftRenderedSource: "gaussian",
            selectedIsGpu: true,
            leftIsGpu: true,
            sharesLeftSurface: true,
        },
        expected: "same",
    },
    {
        name: "keeps matching GPU sources independent side by side",
        input: {
            selectedSource: "gaussian",
            renderedSource: "gaussian",
            leftSelectedSource: "gaussian",
            leftRenderedSource: "gaussian",
            selectedIsGpu: true,
            leftIsGpu: true,
            sharesLeftSurface: false,
        },
        expected: "independent",
    },
    {
        name: "retains a shared GPU source while an image decodes",
        input: {
            selectedSource: "image",
            renderedSource: "gaussian",
            leftSelectedSource: "gaussian",
            leftRenderedSource: "gaussian",
            selectedIsGpu: false,
            leftIsGpu: true,
            sharesLeftSurface: true,
        },
        expected: "retain",
    },
    {
        name: "retains an independent source while another GPU source renders",
        input: {
            selectedSource: "mesh",
            renderedSource: "colmap",
            leftSelectedSource: "gaussian",
            leftRenderedSource: "gaussian",
            selectedIsGpu: true,
            leftIsGpu: true,
            sharesLeftSurface: true,
        },
        expected: "retain",
    },
    {
        name: "uses an already committed independent source",
        input: {
            selectedSource: "image",
            renderedSource: "image",
            leftSelectedSource: "gaussian",
            leftRenderedSource: "gaussian",
            selectedIsGpu: false,
            leftIsGpu: true,
            sharesLeftSurface: true,
        },
        expected: "independent",
    },
    {
        name: "does not share a matching source before the left render commits",
        input: {
            selectedSource: "gaussian",
            renderedSource: "gaussian",
            leftSelectedSource: "gaussian",
            leftRenderedSource: "mesh",
            selectedIsGpu: true,
            leftIsGpu: true,
            sharesLeftSurface: true,
        },
        expected: "independent",
    },
];
for (const testCase of rightPresentationCases) {
    assert.strictEqual(
        gpuCanvas.rightPresentationMode(testCase.input),
        testCase.expected,
        testCase.name
    );
}

(async () => {
    const callbacks = [];
    let presented = false;
    const pending = gpuCanvas.waitForPresentation(callback => {
        callbacks.push(callback);
    }).then(() => { presented = true; });
    assert.strictEqual(callbacks.length, 1);
    callbacks.shift()();
    await Promise.resolve();
    assert.strictEqual(presented, false);
    assert.strictEqual(callbacks.length, 1);
    callbacks.shift()();
    await pending;
    assert.strictEqual(presented, true);

    console.log("reprojection GPU canvas tests passed");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
