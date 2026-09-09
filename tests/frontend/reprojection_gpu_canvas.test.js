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
assert.strictEqual(gpuCanvas.shouldRenderRightOnly({
    rightIsGpu: true,
    leftSelectedSource: "gaussian-a",
    leftPresentedSource: "gaussian-a",
    leftPresentationActive: true,
    rightSourcePending: true,
}), true, "a right-only source change does not redraw the reusable left frame");
assert.strictEqual(gpuCanvas.shouldRenderRightOnly({
    rightIsGpu: true,
    leftSelectedSource: "gaussian-a",
    leftPresentedSource: null,
    leftPresentationActive: false,
    rightSourcePending: true,
}), false, "the full render path prepares a missing left presentation");
assert.strictEqual(gpuCanvas.shouldRenderRightOnly({
    rightIsGpu: true,
    leftSelectedSource: "gaussian-a",
    leftPresentedSource: "gaussian-a",
    leftPresentationActive: true,
    rightSourcePending: false,
}), false, "an already rendered right source needs no right-only render");
assert.strictEqual(gpuCanvas.shouldRenderRightOnly({
    rightIsGpu: true,
    leftSelectedSource: "gaussian-b",
    leftPresentedSource: "gaussian-a",
    leftPresentationActive: true,
    rightSourcePending: true,
}), false, "a stale left capture cannot suppress the selected left render");

function trackedClasses() {
    const classes = new Set();
    return {
        contains: name => classes.has(name),
        toggle(name, active) {
            if (active) {
                classes.add(name);
            } else {
                classes.delete(name);
            }
        },
    };
}

const capturedCanvas = {classList: trackedClasses()};
const capturedLayer = {classList: trackedClasses(), style: {}};
const capturedSidePane = {style: {}};
const capturedPresentation = gpuCanvas.createCapturedPresentation(
    capturedCanvas,
    capturedLayer,
    [capturedLayer, capturedSidePane]
);
capturedPresentation.setActive(true);
assert.strictEqual(capturedCanvas.classList.contains("active"), true);
assert.strictEqual(capturedLayer.classList.contains("capture-active"), true);
capturedPresentation.holdBackground("outgoing-gradient");
assert.strictEqual(capturedLayer.style.background, "outgoing-gradient");
assert.strictEqual(capturedSidePane.style.background, "outgoing-gradient");
capturedPresentation.setActive(false);
assert.strictEqual(capturedCanvas.classList.contains("active"), false);
assert.strictEqual(capturedLayer.classList.contains("capture-active"), false);
assert.strictEqual(capturedLayer.style.background, "");
assert.strictEqual(capturedSidePane.style.background, "");

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
        name: "keeps an existing independent frame when left matches it",
        input: {
            selectedSource: "gaussian",
            renderedSource: "gaussian",
            renderedMode: "independent",
            leftSelectedSource: "gaussian",
            leftRenderedSource: "gaussian",
            selectedIsGpu: true,
            leftIsGpu: true,
            sharesLeftSurface: true,
        },
        expected: "independent",
    },
    {
        name: "retains a shared right source until its independent frame is ready",
        input: {
            selectedSource: "gaussian-b",
            renderedSource: "gaussian-b",
            renderedMode: "same",
            leftSelectedSource: "gaussian-a",
            leftRenderedSource: "gaussian-b",
            selectedIsGpu: true,
            leftIsGpu: true,
            sharesLeftSurface: true,
        },
        expected: "retain",
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
