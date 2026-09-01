(function (globalScope) {
    "use strict";

    function requiresGpuPreparation(geometry, image) {
        return Boolean(image && geometry && !geometry.gpuPrepared);
    }

    const api = {requiresGpuPreparation};
    globalScope.ReprojectionGeometryPreparation = api;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
