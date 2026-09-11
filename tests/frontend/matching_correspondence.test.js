const assert = require("assert");
const correspondence = require("../../static/js/matching/correspondence.js");

const oneToOne = correspondence.createIndex([[3, 7], [8, 2]]);
assert.deepStrictEqual([...oneToOne.image1Indices], [3, 8]);
assert.deepStrictEqual([...oneToOne.image2Indices], [7, 2]);
assert.strictEqual(correspondence.paletteIndex(7, "image2", oneToOne), 3);
assert.strictEqual(correspondence.paletteIndex(8, "image1", oneToOne), 8);

const repeatedObservations = correspondence.createIndex([
    [2, 5], [1, 5], [2, 4], [1, 4],
]);
for (const index of [1, 2]) {
    assert.strictEqual(
        correspondence.paletteIndex(index, "image1", repeatedObservations), 1
    );
}
for (const index of [4, 5]) {
    assert.strictEqual(
        correspondence.paletteIndex(index, "image2", repeatedObservations), 1
    );
}

const palette = ["zero", "shared", "two"];
assert.strictEqual(
    correspondence.color(5, "image2", palette, repeatedObservations, () => "fallback"),
    "shared"
);
assert.strictEqual(
    correspondence.color(9, "image2", palette, repeatedObservations, () => "fallback"),
    "fallback"
);

console.log("matching correspondence tests passed");
