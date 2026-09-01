const assert = require("assert");
const canvasGeometry = require("../../static/js/matching/canvas.js");

const state = canvasGeometry.createState();
const canvas = {
    parentElement: {clientWidth: 400, clientHeight: 200},
    style: {},
    width: 0,
    height: 0,
};
canvasGeometry.configure(canvas, {naturalWidth: 800, naturalHeight: 200}, state, 2);

assert.strictEqual(canvas.width, 800);
assert.strictEqual(canvas.height, 400);
assert.strictEqual(state.scale, 0.5);
assert.strictEqual(state.translateX, 0);
assert.strictEqual(state.translateY, 50);
assert.deepStrictEqual(
    canvasGeometry.imageToViewport({x: 100, y: 20}, state),
    {x: 50, y: 60}
);
assert.strictEqual(canvasGeometry.isVisible({x: 100, y: 20}, state), true);
assert.strictEqual(canvasGeometry.isVisible({x: 900, y: 20}, state), false);

const preview = {naturalWidth: 768, naturalHeight: 512};
const sourceSize = {width: 6000, height: 4000};
assert.deepStrictEqual(
    canvasGeometry.imageSize(preview, sourceSize),
    {width: 6000, height: 4000}
);
canvasGeometry.configure(canvas, preview, state, 2, sourceSize);
assert.strictEqual(state.scale, 0.05);
assert.strictEqual(state.translateX, 50);
assert.strictEqual(state.translateY, 0);

console.log("matching canvas tests passed");
