const assert = require("assert");
const clippingScroll = require(
    "../../static/js/reprojection/clipping_scroll.js"
);

assert.strictEqual(clippingScroll.adaptiveStep(100, Infinity), 0.002);
assert.strictEqual(clippingScroll.adaptiveStep(100, 120), 0.002);
assert.strictEqual(clippingScroll.adaptiveStep(100, 30), 0.008);
assert.strictEqual(clippingScroll.adaptiveStep(100, 5), 0.02);
assert.strictEqual(clippingScroll.adaptiveStep(1000, Infinity), 0.02);
assert.strictEqual(clippingScroll.adaptiveStep(3, Infinity, 1), 0.002);
assert.deepStrictEqual(
    clippingScroll.adjustRange(0, 1, "near", 1, 0.008),
    {near: 0.008, far: 1}
);
assert.deepStrictEqual(
    clippingScroll.adjustRange(0, 0.004, "near", 1, 0.02),
    {near: 0.002, far: 0.004}
);
assert.deepStrictEqual(
    clippingScroll.adjustRange(0.996, 1, "far", -1, 0.02),
    {near: 0.996, far: 0.998}
);

console.log("reprojection clipping scroll tests passed");
