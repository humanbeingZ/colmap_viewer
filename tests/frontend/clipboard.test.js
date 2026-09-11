const assert = require("assert");
const clipboard = require("../../static/js/shared/clipboard.js");

const classes = new Set();
const button = {
    classList: {
        add: value => classes.add(value),
        remove: value => classes.delete(value),
    },
    dataset: {},
    innerHTML: "",
    title: "Copy value",
};

clipboard.decorateButton(button);
assert.strictEqual(classes.has("copy-icon-button"), true);
assert.match(button.innerHTML, /<svg/);
assert.strictEqual(button.dataset.copyDefaultTitle, "Copy value");

clipboard.showCopied(button, "Value copied", 0);
assert.strictEqual(classes.has("copied"), true);
assert.strictEqual(button.title, "Value copied");

setTimeout(() => {
    assert.strictEqual(classes.has("copied"), false);
    assert.strictEqual(button.title, "Copy value");
    console.log("shared clipboard tests passed");
}, 5);
