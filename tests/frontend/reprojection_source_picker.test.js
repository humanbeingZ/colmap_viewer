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
picker.knownSources = new Set(["image", "colmap"]);
picker.cycleIndex = paneSources.cycleIndex;
picker.onSelect = () => {};

assert.deepStrictEqual(picker.visibleValues(), ["image", "mesh"]);
assert.strictEqual(picker.nextValue(1), "mesh");
assert.strictEqual(picker.nextValue(-1), "mesh");
assert.strictEqual(picker.cycle(1), true);
assert.strictEqual(picker.select.value, "mesh");
assert.strictEqual(picker.nextValue(1), "image");

picker.registerSources(
    new Set(["image", "colmap", "mesh"]), new Set(["mesh"])
);
assert.deepStrictEqual(picker.visibleValues(), ["image"]);
picker.hiddenSources.delete("mesh");
picker.registerSources(
    new Set(["image", "colmap", "mesh"]), new Set(["mesh"])
);
assert.deepStrictEqual(picker.visibleValues(), ["image", "mesh"]);

console.log("reprojection source picker tests passed");
