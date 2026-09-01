const assert = require("assert");
const preparation = require(
    "../../static/js/reprojection/geometry_preparation.js"
);

const image = {id: 1};
assert.equal(preparation.requiresGpuPreparation({gpuPrepared: true}, image), false);
assert.equal(preparation.requiresGpuPreparation({gpuPrepared: false}, image), true);
assert.equal(preparation.requiresGpuPreparation({}, image), true);
assert.equal(preparation.requiresGpuPreparation({}, null), false);

console.log("reprojection geometry preparation tests passed");
