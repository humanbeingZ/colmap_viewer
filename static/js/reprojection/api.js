(function (globalScope) {
    "use strict";

    async function jsonResponse(response) {
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || `HTTP ${response.status}`);
        }
        return response.json();
    }

    class ReprojectionApi {
        constructor(getStream, fetchImpl = globalScope.fetch.bind(globalScope)) {
            this.getStream = getStream;
            this.fetch = fetchImpl;
        }

        streamQuery() {
            return `stream=${encodeURIComponent(this.getStream())}`;
        }

        async capabilities() {
            return jsonResponse(
                await this.fetch(`/api/capabilities?${this.streamQuery()}`)
            );
        }

        async images() {
            return jsonResponse(await this.fetch("/api/reprojection/images"));
        }

        async uploadGeometry(file, generation, signal) {
            const query = `filename=${encodeURIComponent(file.name)}`
                + `&${this.streamQuery()}&generation=${generation}`;
            return jsonResponse(await this.fetch(`/api/reprojection/geometry?${query}`, {
                method: "POST",
                headers: {"Content-Type": "application/octet-stream"},
                body: file,
                signal,
            }));
        }

        async loadLocalGeometry(path) {
            return jsonResponse(await this.fetch(
                "/api/reprojection/local-geometry",
                {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({path}),
                }
            ));
        }

        async activateConfiguredGeometry(url) {
            const separator = url.includes("?") ? "&" : "?";
            return jsonResponse(await this.fetch(
                `${url}${separator}${this.streamQuery()}`,
                {method: "POST"}
            ));
        }

        async resetGeometry() {
            return jsonResponse(await this.fetch(
                `/api/reprojection/geometry?${this.streamQuery()}`,
                {method: "DELETE"}
            ));
        }

        async heartbeat() {
            return jsonResponse(await this.fetch(
                `/api/reprojection/stream/heartbeat?${this.streamQuery()}`,
                {method: "POST"}
            ));
        }

        async cancelRender() {
            const response = await this.fetch(
                `/api/reprojection/cancel-render?${this.streamQuery()}`,
                {method: "POST"}
            );
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
        }
    }

    globalScope.ReprojectionApi = ReprojectionApi;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = ReprojectionApi;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
