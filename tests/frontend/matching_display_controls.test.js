const assert = require("assert");
const displayControls = require(
    "../../static/js/matching/display_controls.js"
);

const primary = {checked: false};
const matchedOnly = {checked: true, disabled: false};
displayControls.syncMatchedOnly(primary, matchedOnly);
assert.strictEqual(matchedOnly.disabled, true);
assert.strictEqual(matchedOnly.checked, true);
assert.strictEqual(
    displayControls.isMatchedOnlyActive(primary, matchedOnly), false
);
primary.checked = true;
displayControls.syncMatchedOnly(primary, matchedOnly);
assert.strictEqual(matchedOnly.disabled, false);
assert.strictEqual(
    displayControls.isMatchedOnlyActive(primary, matchedOnly), true
);

const classes = new Set(["active"]);
const elements = {
    displayOptions: {hidden: false},
    matchActions: {hidden: false},
    showLines: {checked: true},
    onlyMatchedLines: {checked: true, disabled: false},
    drawMatches: {classList: {remove: value => classes.delete(value)}},
};

displayControls.setLineAvailability(elements, false);
assert.strictEqual(elements.displayOptions.hidden, true);
assert.strictEqual(elements.matchActions.hidden, true);
assert.strictEqual(elements.showLines.checked, false);
assert.strictEqual(elements.onlyMatchedLines.checked, false);
assert.strictEqual(elements.onlyMatchedLines.disabled, true);
assert.strictEqual(classes.has("active"), false);

displayControls.setLineAvailability(elements, true);
assert.strictEqual(elements.displayOptions.hidden, false);
assert.strictEqual(elements.matchActions.hidden, false);
assert.strictEqual(elements.onlyMatchedLines.disabled, true);

const matchTypes = {
    container: {hidden: false},
    inlier: {checked: false},
    outlier: {checked: true},
};
displayControls.setMatchTypeAvailability(matchTypes, false);
assert.strictEqual(matchTypes.container.hidden, true);
assert.strictEqual(matchTypes.inlier.checked, true);
assert.strictEqual(matchTypes.outlier.checked, false);

displayControls.setMatchTypeAvailability(matchTypes, true);
assert.strictEqual(matchTypes.container.hidden, false);
assert.strictEqual(matchTypes.inlier.checked, false);
assert.strictEqual(matchTypes.outlier.checked, true);

console.log("matching display control tests passed");
