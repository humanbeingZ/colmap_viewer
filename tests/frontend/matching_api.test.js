const assert = require("assert");
const MatchingApi = require("../../static/js/matching/api.js");

const requests = [];
const fetchImpl = async url => {
    requests.push(url);
    return {
        ok: true,
        headers: {get: name => name === "X-Pair-Candidate-Source" ? "tracks" : null},
        json: async () => [2, 3],
    };
};

(async () => {
    const api = new MatchingApi(fetchImpl);
    const candidates = await api.pairCandidates(1, 12);
    assert.deepStrictEqual(candidates, {imageIds: [2, 3], source: "tracks"});
    assert.strictEqual(
        requests[0], "/api/matches_for_image/1?max_neighbors=12"
    );

    await api.matches(1, 2, "inlier");
    assert.strictEqual(requests[1], "/api/matches/1/2?match_type=inlier");

    await api.lineMatches(1, 2);
    assert.strictEqual(requests[2], "/api/line_matches/1/2");

    await api.capabilities();
    assert.strictEqual(requests[3], "/api/matching/capabilities");
    console.log("matching API tests passed");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
