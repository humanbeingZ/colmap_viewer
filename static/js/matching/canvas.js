(function (globalScope) {
    "use strict";

    function createState() {
        return {
            scale: 1,
            translateX: 0,
            translateY: 0,
            viewportWidth: 0,
            viewportHeight: 0,
            pixelRatio: 1,
            isDragging: false,
            lastMouseX: 0,
            lastMouseY: 0,
        };
    }

    function configure(canvas, image, state, devicePixelRatio = 1) {
        const width = canvas.parentElement.clientWidth;
        const height = canvas.parentElement.clientHeight;
        const pixelRatio = Math.min(devicePixelRatio || 1, 3);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        canvas.width = Math.max(1, Math.round(width * pixelRatio));
        canvas.height = Math.max(1, Math.round(height * pixelRatio));
        state.viewportWidth = width;
        state.viewportHeight = height;
        state.pixelRatio = pixelRatio;

        const imageWidth = image.naturalWidth || image.width;
        const imageHeight = image.naturalHeight || image.height;
        state.scale = Math.min(width / imageWidth, height / imageHeight);
        state.translateX = (width - imageWidth * state.scale) / 2;
        state.translateY = (height - imageHeight * state.scale) / 2;
    }

    function clear(canvas, context) {
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);
    }

    function applyTransform(context, state) {
        context.setTransform(state.pixelRatio, 0, 0, state.pixelRatio, 0, 0);
        context.translate(state.translateX, state.translateY);
        context.scale(state.scale, state.scale);
    }

    function imageToViewport(point, state) {
        return {
            x: point.x * state.scale + state.translateX,
            y: point.y * state.scale + state.translateY,
        };
    }

    function isVisible(point, state) {
        const viewport = imageToViewport(point, state);
        return viewport.x >= 0 && viewport.x <= state.viewportWidth
            && viewport.y >= 0 && viewport.y <= state.viewportHeight;
    }

    const api = {createState, configure, clear, applyTransform, imageToViewport, isVisible};
    globalScope.MatchingCanvas = api;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
