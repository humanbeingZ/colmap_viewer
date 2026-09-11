const assert = require("assert");
const {handle, isEditingTarget} = require(
    "../../static/js/matching/shortcuts.js"
);

const markers = {checked: false, disabled: false};
const lines = {checked: false, disabled: false};
const changed = [];
const bindings = {
    f: {control: markers},
    l: {control: lines, enabled: () => false},
};
const event = (key, overrides = {}) => ({
    key,
    target: {tagName: "CANVAS"},
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    ...overrides,
});
const dispatch = control => changed.push(control);

assert.strictEqual(handle(event("f"), bindings, dispatch), true);
assert.strictEqual(markers.checked, true);
assert.deepStrictEqual(changed, [markers]);
assert.strictEqual(handle(event("F"), bindings, dispatch), true);
assert.strictEqual(markers.checked, false);

assert.strictEqual(handle(event("l"), bindings, dispatch), false);
assert.strictEqual(lines.checked, false);
assert.strictEqual(handle(event("f", {repeat: true}), bindings, dispatch), false);
assert.strictEqual(handle(event("f", {ctrlKey: true}), bindings, dispatch), false);
assert.strictEqual(handle(event("f", {
    target: {tagName: "INPUT"},
}), bindings, dispatch), false);
assert.strictEqual(handle(event("x"), bindings, dispatch), false);

assert.strictEqual(isEditingTarget({tagName: "select"}), true);
assert.strictEqual(isEditingTarget({tagName: "DIV", isContentEditable: true}), true);
assert.strictEqual(isEditingTarget({tagName: "CANVAS"}), false);

console.log("matching shortcut tests passed");
