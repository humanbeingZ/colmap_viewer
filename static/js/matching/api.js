(function (globalScope) {
    "use strict";

    async function responseBody(response) {
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
    }

    class MatchingApi {
        constructor(fetchImpl = globalScope.fetch.bind(globalScope)) {
            this.fetch = fetchImpl;
        }

        async sources() {
            return responseBody(await this.fetch("/api/sources"));
        }

        async images() {
            return responseBody(await this.fetch("/api/images"));
        }

        async imageData(imageId) {
            return responseBody(await this.fetch(`/api/image_data/${imageId}`));
        }

        async pairCandidates(imageId, maxNeighbors) {
            const response = await this.fetch(
                `/api/matches_for_image/${imageId}?max_neighbors=${maxNeighbors}`
            );
            const imageIds = await responseBody(response);
            return {
                imageIds,
                source: response.headers.get("X-Pair-Candidate-Source") || "matches",
            };
        }

        async matches(imageId1, imageId2, matchType = null) {
            const query = matchType ? `?match_type=${matchType}` : "";
            return responseBody(
                await this.fetch(`/api/matches/${imageId1}/${imageId2}${query}`)
            );
        }

        async matchSummary(imageId1, imageId2) {
            return responseBody(
                await this.fetch(`/api/match_summary/${imageId1}/${imageId2}`)
            );
        }
    }

    globalScope.MatchingApi = MatchingApi;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = MatchingApi;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
