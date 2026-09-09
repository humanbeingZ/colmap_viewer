const assert = require("assert");
const ReprojectionApi = require("../../static/js/reprojection/api.js");

const requests = [];
const fetchImpl = async (url, options = {}) => {
    requests.push({url, options});
    return {
        ok: true,
        json: async () => ({url}),
        arrayBuffer: async () => new ArrayBuffer(0),
    };
};

(async () => {
    const api = new ReprojectionApi(() => "viewer id", fetchImpl);
    await api.capabilities();
    await api.uploadGeometry({name: "cloud file.ply"}, 7, "signal");
    await api.loadLocalGeometry("/data/mesh file.ply");
    await api.activateConfiguredGeometry("/activate?token=secret");
    await api.activateConfiguredGeometry(
        "/activate?token=other", "viewer id:right"
    );
    await api.resetGeometry();
    await api.resetGeometry("viewer id:right");
    await api.heartbeat();
    await api.cancelRender();
    const colmapPoints = await api.colmapPoints();

    assert.strictEqual(requests[0].url, "/api/capabilities?stream=viewer%20id");
    assert.ok(requests[1].url.includes("filename=cloud%20file.ply"));
    assert.ok(requests[1].url.includes("generation=7"));
    assert.strictEqual(requests[1].options.method, "POST");
    assert.strictEqual(requests[2].url, "/api/reprojection/local-geometry");
    assert.deepStrictEqual(
        JSON.parse(requests[2].options.body),
        {path: "/data/mesh file.ply"}
    );
    assert.strictEqual(
        requests[3].url,
        "/activate?token=secret&stream=viewer%20id"
    );
    assert.strictEqual(requests[3].options.method, "POST");
    assert.strictEqual(
        requests[4].url,
        "/activate?token=other&stream=viewer%20id%3Aright"
    );
    assert.strictEqual(requests[5].options.method, "DELETE");
    assert.strictEqual(
        requests[6].url,
        "/api/reprojection/geometry?stream=viewer%20id%3Aright"
    );
    assert.strictEqual(requests[6].options.method, "DELETE");
    assert.strictEqual(requests[7].options.method, "POST");
    assert.strictEqual(requests[8].options.method, "POST");
    assert.ok(colmapPoints instanceof ArrayBuffer);
    assert.strictEqual(
        requests[9].url,
        "/api/reprojection/colmap-points.ply"
    );

    console.log("reprojection API tests passed");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
