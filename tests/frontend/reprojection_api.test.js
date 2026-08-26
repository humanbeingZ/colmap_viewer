const assert = require("assert");
const ReprojectionApi = require("../../static/js/reprojection/api.js");

const requests = [];
const fetchImpl = async (url, options = {}) => {
    requests.push({url, options});
    return {
        ok: true,
        json: async () => ({url}),
    };
};

(async () => {
    const api = new ReprojectionApi(() => "viewer id", fetchImpl);
    await api.capabilities();
    await api.uploadGeometry({name: "cloud file.ply"}, 7, "signal");
    await api.resetGeometry();
    await api.heartbeat();
    await api.cancelRender();

    assert.strictEqual(requests[0].url, "/api/capabilities?stream=viewer%20id");
    assert.ok(requests[1].url.includes("filename=cloud%20file.ply"));
    assert.ok(requests[1].url.includes("generation=7"));
    assert.strictEqual(requests[1].options.method, "POST");
    assert.strictEqual(requests[2].options.method, "DELETE");
    assert.strictEqual(requests[3].options.method, "POST");
    assert.strictEqual(requests[4].options.method, "POST");

    console.log("reprojection API tests passed");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
