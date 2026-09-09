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
assert.strictEqual(gpuCanvas.isCurrentIndependentFrame({
    source: "points",
    renderedSource: "points",
    renderedMode: "independent",
    frameKey: "size-3",
    renderedFrameKey: "size-3",
}), true, "a matching source and render signature can reuse its capture");
assert.strictEqual(gpuCanvas.isCurrentIndependentFrame({
    source: "points",
    renderedSource: "points",
    renderedMode: "independent",
    frameKey: "size-15",
    renderedFrameKey: "size-3",
}), false, "a point-size change invalidates the captured frame");
assert.strictEqual(gpuCanvas.shouldCaptureRightPane({
    includeRightPane: true,
    rightIsGpu: true,
    sideBySide: false,
    leftSource: "mesh-a",
    rightSource: "mesh-b",
    rightFrameCurrent: false,
}), true, "different meshes use an independent right presentation");
assert.strictEqual(gpuCanvas.shouldCaptureRightPane({
    includeRightPane: true,
    rightIsGpu: true,
    sideBySide: false,
    leftSource: "mesh-a",
    rightSource: "mesh-a",
    rightFrameCurrent: false,
}), false, "a completed shared source needs no duplicate capture");
assert.strictEqual(gpuCanvas.shouldCaptureRightPane({
    includeRightPane: true,
    rightIsGpu: true,
    sideBySide: true,
    leftSource: "mesh-a",
    rightSource: "mesh-a",
    rightFrameCurrent: false,
}), true, "side-by-side panes always use independent surfaces");
assert.strictEqual(gpuCanvas.shouldCaptureRightPane({
    includeRightPane: true,
    rightIsGpu: true,
    sideBySide: false,
    leftSource: "mesh-a",
    rightSource: "points-b",
    rightFrameCurrent: false,
}), true, "appearance changes invalidate an existing right capture");

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
        name: "shares a matching source after the left render commits",
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
        expected: "same",
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

const rightLayerCases = [
    ["independent mesh", true, true, "independent",
        [true, true, true, false, false]],
    ["shared mesh", true, true, "same",
        [false, true, false, false, true]],
    ["independent COLMAP render", true, false, "independent",
        [false, true, false, true, false]],
    ["camera image", false, false, "independent",
        [false, false, false, true, false]],
];
function rightLayerFlags(state) {
    return [
        state.captureActive,
        state.geometryActive,
        state.gpuIndependent,
        state.rasterVisible,
        state.sameGeometry,
    ];
}
for (const [name, sourceIsGeometry, sourceIsGpu, mode, expected] of
    rightLayerCases) {
    assert.deepStrictEqual(
        rightLayerFlags(gpuCanvas.rightLayerState({
            sourceIsGeometry, sourceIsGpu, mode,
        })),
        expected,
        name
    );
}
assert.throws(
    () => gpuCanvas.rightLayerState({
        sourceIsGeometry: true,
        sourceIsGpu: false,
        mode: "same",
    }),
    /Only GPU geometry/,
    "a raster presentation cannot claim to share the live GPU surface"
);
assert.throws(
    () => gpuCanvas.rightLayerState({
        sourceIsGeometry: true,
        sourceIsGpu: true,
        mode: "retain",
    }),
    /Unsupported right presentation mode/,
    "an uncommitted retain state cannot be applied to DOM layers"
);

const baseTransition = {
    selectedSource: "mesh-b",
    renderedSource: "mesh-a",
    renderedMode: "same",
    leftSelectedSource: "mesh-a",
    leftRenderedSource: "mesh-a",
    selectedIsGpu: true,
    leftIsGpu: true,
    sharesLeftSurface: true,
};
const transitionCases = [
    ["split mesh A/B requests a capture", {}, false, "retain", true],
    ["split mesh A/B reuses its capture", {
        renderedSource: "mesh-b", renderedMode: "independent",
    }, false, "independent", false],
    ["split mesh A/A replaces an old B capture", {
        selectedSource: "mesh-a", renderedSource: "mesh-b",
        renderedMode: "independent",
    }, false, "same", false],
    ["split mesh A/A replaces an existing A capture", {
        selectedSource: "mesh-a", renderedSource: "mesh-a",
        renderedMode: "independent",
    }, false, "same", false],
    ["split Gaussian A/A waits for the left commit", {
        selectedSource: "gaussian-a", renderedSource: "gaussian-a",
        renderedMode: "independent", leftSelectedSource: "gaussian-a",
        leftRenderedSource: "mesh-b",
    }, false, "independent", false],
    ["split mesh/Gaussian requests a capture", {
        selectedSource: "gaussian-a",
    }, false, "retain", true],
    ["side-by-side mesh A/A requests a separate surface", {
        selectedSource: "mesh-a", renderedSource: "mesh-a",
        sharesLeftSurface: false,
    }, true, "retain", true],
    ["camera image never requests a GPU capture", {
        selectedSource: "image", selectedIsGpu: false,
    }, false, "retain", false],
];
for (const [name, overrides, sideBySide, expectedMode, expectedCapture] of
    transitionCases) {
    const input = {...baseTransition, ...overrides};
    const rightFrameCurrent = input.renderedSource === input.selectedSource
        && input.renderedMode === "independent";
    assert.strictEqual(
        gpuCanvas.rightPresentationMode(input),
        expectedMode,
        `${name}: presentation mode`
    );
    assert.strictEqual(
        gpuCanvas.shouldCaptureRightPane({
            includeRightPane: true,
            rightIsGpu: input.selectedIsGpu,
            sideBySide,
            leftSource: input.leftSelectedSource,
            rightSource: input.selectedSource,
            rightFrameCurrent,
        }),
        expectedCapture,
        `${name}: capture decision`
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
