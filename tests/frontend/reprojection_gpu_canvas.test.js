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

console.log("reprojection GPU canvas tests passed");
