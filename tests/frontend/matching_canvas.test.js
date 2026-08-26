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

console.log("matching canvas tests passed");
