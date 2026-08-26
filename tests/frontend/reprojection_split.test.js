const assert = require("assert");
const split = require("../../static/js/reprojection/split.js");

function close(actual, expected, tolerance = 1e-7) {
    assert.ok(Math.abs(actual - expected) <= tolerance,
        `${actual} is not close to ${expected}`);
}

const vertical = split.geometry(200, 100, 25, 0);
close(vertical.lineX, 50);
close(vertical.lineY, 50);
assert.ok(vertical.polygon.every(point => point.x >= 50 - 1e-7));
close(split.percentFromPoint(200, 100, 150, 40, 0), 75);
assert.ok(decodeURIComponent(split.resizeCursor(0)).includes("rotate(0 16 16)"));

const horizontal = split.geometry(200, 100, 25, 90);
close(horizontal.lineY, 25);
assert.ok(horizontal.polygon.every(point => point.y >= 25 - 1e-7));
close(split.percentFromPoint(200, 100, 20, 75, 90), 75);
assert.ok(decodeURIComponent(split.resizeCursor(90)).includes("rotate(-90 16 16)"));

const diagonal = split.geometry(200, 100, 50, 45);
close(diagonal.normalX * diagonal.lineX
    + diagonal.normalY * diagonal.lineY, diagonal.threshold);
assert.ok(diagonal.polygon.length >= 3);
assert.ok(decodeURIComponent(split.resizeCursor(45)).includes("rotate(45 16 16)"));
assert.ok(decodeURIComponent(split.resizeCursor(-45)).includes("rotate(-45 16 16)"));

assert.strictEqual(split.geometry(200, 100, 100, 0).polygon.length, 0);
assert.strictEqual(split.geometry(200, 100, 0, 0).polygon.length, 4);
assert.strictEqual(split.normalizedAngle(-200), -180);
assert.strictEqual(split.normalizedAngle(200), 180);
assert.strictEqual(split.wrappedAngle(190), -170);
assert.strictEqual(split.wrappedAngle(-190), 170);
assert.strictEqual(split.rotatedAngle(10, 170, -170), 30);
assert.ok(decodeURIComponent(split.resizeCursor(135)).includes("rotate(-45 16 16)"));

console.log("reprojection split geometry tests passed");
