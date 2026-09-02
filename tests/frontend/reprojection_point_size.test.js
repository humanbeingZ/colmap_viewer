const assert = require("assert");
const pointSize = require("../../static/js/reprojection/point_size.js");

assert.strictEqual(pointSize.normalize(2), 3);
assert.strictEqual(pointSize.normalize(0.6), 0.5);
assert.strictEqual(pointSize.step(3, 1), 5);
assert.strictEqual(pointSize.step(1, -1), 0.75);

assert.strictEqual(pointSize.displayRenderMaxSize({
    displayWidth: 799.2,
    displayHeight: 450,
    fallbackMaxSize: 1600,
    maxRenderSize: 4096,
}), 800);
assert.strictEqual(pointSize.displayRenderMaxSize({
    displayWidth: 799.2,
    displayHeight: 450,
    fallbackMaxSize: 1600,
    navigationPreview: true,
    navigationPreviewSize: 640,
    maxRenderSize: 4096,
}), 640);
assert.strictEqual(pointSize.displayRenderMaxSize({
    displayWidth: 0,
    displayHeight: 0,
    fallbackMaxSize: 1600,
    maxRenderSize: 1024,
}), 1024);
assert.strictEqual(pointSize.displayRenderMaxSize({
    displayWidth: 200,
    displayHeight: 100,
    fallbackMaxSize: 1600,
    minRenderSize: 320,
    maxRenderSize: 4096,
}), 320);

assert.deepStrictEqual(pointSize.renderParameters({
    pointSize: 3,
    baseMaxSize: 1600,
    navigationPreview: false,
    maxRenderSize: 4096,
}), {maxSize: 1600, radius: 1});
assert.deepStrictEqual(pointSize.renderParameters({
    pointSize: 0.5,
    baseMaxSize: 1600,
    navigationPreview: false,
    maxRenderSize: 4096,
}), {maxSize: 3200, radius: 0});
assert.deepStrictEqual(pointSize.renderParameters({
    pointSize: 0.25,
    baseMaxSize: 1600,
    navigationPreview: false,
    maxRenderSize: 4096,
}), {maxSize: 4096, radius: 0});
assert.deepStrictEqual(pointSize.renderParameters({
    pointSize: 0.25,
    baseMaxSize: 768,
    navigationPreview: true,
    maxRenderSize: 4096,
}), {maxSize: 768, radius: 0});

console.log("reprojection point size tests passed");
