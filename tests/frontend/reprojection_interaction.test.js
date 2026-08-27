const assert = require("assert");
const ReprojectionInteraction = require("../../static/js/reprojection/interaction.js");
const splitGeometry = require("../../static/js/reprojection/split.js");

const listeners = {};
const viewer = {
    style: {},
    addEventListener: (name, callback) => {
        listeners[name] = callback;
    },
    setPointerCapture: () => {},
    hasPointerCapture: () => true,
    releasePointerCapture: () => {},
};
const splitElement = {
    clientWidth: 200,
    clientHeight: 100,
    style: {},
    getBoundingClientRect: () => ({
        left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100,
    }),
};
const state = {
    splitPercent: 25,
    splitAngle: 0,
    viewTranslateX: 0,
    viewTranslateY: 0,
};
let viewUpdates = 0;
let splitRenderUpdates = 0;
const interaction = new ReprojectionInteraction({
    viewer,
    splitElement,
    inputLayer: {style: {}},
    divider: {style: {}},
    layoutControl: {value: "split"},
    angleControl: {value: 0},
    state,
    splitGeometry,
    applyViewTransform: () => {
        viewUpdates += 1;
    },
    applySplitRender: () => {
        splitRenderUpdates += 1;
    },
});
interaction.attach();

assert.strictEqual(interaction.resize(240, 120), true);
assert.strictEqual(interaction.resize(240, 120), false);
assert.strictEqual(splitElement.style.width, "240px");
assert.strictEqual(splitElement.style.height, "120px");
assert.strictEqual(splitRenderUpdates, 1);

function pointer(overrides) {
    return {
        button: 0,
        pointerId: 1,
        clientX: 150,
        clientY: 50,
        ctrlKey: false,
        metaKey: false,
        preventDefault: () => {},
        ...overrides,
    };
}

listeners.pointerdown(pointer({ctrlKey: true}));
assert.strictEqual(state.splitPercent, 50);
listeners.pointermove(pointer({clientX: 100, clientY: 90, ctrlKey: true}));
assert.strictEqual(state.splitAngle, 90);
listeners.pointerup(pointer({clientX: 100, clientY: 90}));

listeners.pointerdown(pointer({clientX: 20, clientY: 20}));
listeners.pointermove(pointer({clientX: 25, clientY: 30}));
assert.strictEqual(state.viewTranslateX, 5);
assert.strictEqual(state.viewTranslateY, 10);
assert.strictEqual(viewUpdates, 1);

interaction.resetDivider();
assert.strictEqual(state.splitPercent, 50);
assert.strictEqual(state.splitAngle, 0);
assert.ok(splitRenderUpdates > 1);

console.log("reprojection interaction tests passed");
