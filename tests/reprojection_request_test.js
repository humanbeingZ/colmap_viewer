const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("static/js/reprojection.js", "utf8");
const start = source.indexOf("function requestReprojectionPointLayer");
const end = source.indexOf("function loadReprojectionPointLayer", start);
const requestFunction = source.slice(start, end);
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
const cloud = {src: null, style: {visibility: "hidden"}};
const cloudSide = {src: null, style: {visibility: "hidden"}};
let failures = 0;
const context = {
    reprojectionState: state,
    reprojectionUrls: () => ({render: `render-${state.pointGeneration + 1}`}),
    currentPointRadius: () => 1,
    Image: TestImage,
    reprojectionCloud: cloud,
    reprojectionCloudSide: cloudSide,
    applyReprojectionViewTransform: () => {},
    heartbeatReprojectionStream: async () => false,
    setReprojectionStatus: () => {
        failures += 1;
    },
};

vm.runInNewContext(
    `${requestFunction}; globalThis.requestLayer = requestReprojectionPointLayer;`,
    context
);

(async () => {
    context.requestLayer();
    context.requestLayer();
    await loaders[0].onerror();
    loaders[0].onload();
    assert.strictEqual(failures, 0);
    assert.strictEqual(cloud.src, null);

    loaders[1].onload();
    assert.strictEqual(cloud.src, "render-2");
    assert.strictEqual(cloud.style.visibility, "visible");
    console.log("reprojection point request tests passed");
})().catch(error => {
    console.error(error);
    process.exit(1);
});
