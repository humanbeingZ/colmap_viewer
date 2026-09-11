const assert = require("assert");
const lineControls = require("../../static/js/matching/line_controls.js");

const classes = new Set(["active"]);
const elements = {
    displayOptions: {hidden: false},
    matchActions: {hidden: false},
    showLines: {checked: true},
    onlyMatchedLines: {checked: true},
    drawMatches: {classList: {remove: value => classes.delete(value)}},
};

lineControls.setAvailable(elements, false);
assert.strictEqual(elements.displayOptions.hidden, true);
assert.strictEqual(elements.matchActions.hidden, true);
assert.strictEqual(elements.showLines.checked, false);
assert.strictEqual(elements.onlyMatchedLines.checked, false);
assert.strictEqual(classes.has("active"), false);

lineControls.setAvailable(elements, true);
assert.strictEqual(elements.displayOptions.hidden, false);
assert.strictEqual(elements.matchActions.hidden, false);

console.log("matching line control tests passed");
