const assert = require("assert");
const ReprojectionPointRequester = require(
    "../static/js/reprojection_point_request.js"
);
const loaders = [];

class TestImage {
    constructor() {
        loaders.push(this);
    }

    set src(value) {
        this._src = value;
    }

    get src() {
        return this._src;
    }
}

const state = {
    images: [{name: "camera"}],
    currentIndex: 0,
    generation: 4,
    pointGeneration: 0,
};
let source = null;
let transforms = 0;
let failures = 0;
let renderCount = 0;
const requester = new ReprojectionPointRequester({
    state,
    renderUrl: () => `render-${++renderCount}`,
    createImage: () => new TestImage(),
    applySource: url => {
        source = url;
    },
    applyViewTransform: () => {
        transforms += 1;
    },
    recoverGeometry: async () => false,
    reportFailure: () => {
        failures += 1;
    },
});

(async () => {
    requester.request();
    requester.request();
    await loaders[0].onerror();
    loaders[0].onload();
    assert.strictEqual(failures, 0);
    assert.strictEqual(source, null);

    loaders[1].onload();
    assert.strictEqual(source, "render-2");
    assert.strictEqual(transforms, 1);

    requester.request();
    await loaders[2].onerror();
    assert.strictEqual(failures, 1);

    assert.strictEqual(requester.request(state.generation - 1), null);
    assert.strictEqual(loaders.length, 3);
    console.log("reprojection point request tests passed");
})().catch(error => {
    console.error(error);
    process.exit(1);
});
