const assert = require("assert");
const {correspondingLines, lineSegment} = require("../static/js/epipolar.js");

const horizontalFundamental = [
    [0, 0, 0],
    [0, 0, 1],
    [0, -1, 0],
];
const fromLeft = correspondingLines(
    horizontalFundamental, "image1", {x: 20, y: 30}
);
const fromRight = correspondingLines(
    horizontalFundamental, "image2", {x: 80, y: 30}
);

assert.deepStrictEqual(lineSegment(fromLeft.image2, 100, 80), [
    {x: 0, y: 30}, {x: 100, y: 30},
]);
assert.deepStrictEqual(lineSegment(fromRight.image1, 100, 80), [
    {x: 0, y: 30}, {x: 100, y: 30},
]);
assert.strictEqual(lineSegment([0, 0, 1], 100, 80), null);

console.log("epipolar geometry tests passed");
