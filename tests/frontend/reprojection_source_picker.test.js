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
let renamed = null;
picker.onRename = (value, label) => { renamed = {value, label}; };
picker.onInfo = value => ({
    label: `${value} label`,
    filename: `${value}.ply`,
    path: `/data/${value}.ply`,
});

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

assert.strictEqual(picker.renameValue("mesh", "  baseline  "), true);
assert.deepStrictEqual(renamed, {value: "mesh", label: "baseline"});
assert.strictEqual(picker.renameValue("mesh", "image"), true);
assert.deepStrictEqual(
    renamed,
    {value: "mesh", label: "image"},
    "manual labels are preserved even when another source uses the same label"
);
assert.strictEqual(picker.renameValue("mesh", "   "), false);
assert.deepStrictEqual(picker.infoForValue("mesh", "fallback"), {
    label: "mesh label",
    filename: "mesh.ply",
    path: "/data/mesh.ply",
});
picker.onInfo = null;
assert.deepStrictEqual(picker.infoForValue("mesh", "fallback"), {
    label: "fallback",
    filename: "",
    path: "",
});

console.log("reprojection source picker tests passed");
