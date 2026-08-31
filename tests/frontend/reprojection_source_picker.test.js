const assert = require("assert");
const SourcePicker = require(
    "../../static/js/reprojection/source_picker.js"
);
const paneSources = require(
    "../../static/js/reprojection/pane_sources.js"
);

const picker = Object.create(SourcePicker.prototype);
picker.select = {
    value: "image",
    options: [
        {value: "image"},
        {value: "colmap"},
        {value: "mesh"},
    ],
};
picker.hiddenSources = new Set(["colmap"]);
picker.cycleIndex = paneSources.cycleIndex;
picker.onSelect = () => {};

assert.deepStrictEqual(picker.visibleValues(), ["image", "mesh"]);
assert.strictEqual(picker.nextValue(1), "mesh");
assert.strictEqual(picker.nextValue(-1), "mesh");
assert.strictEqual(picker.cycle(1), true);
assert.strictEqual(picker.select.value, "mesh");
assert.strictEqual(picker.nextValue(1), "image");

console.log("reprojection source picker tests passed");
