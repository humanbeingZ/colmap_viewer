(function (globalScope) {
    "use strict";

    class ReprojectionPointRequester {
        constructor({
            state,
            renderUrl,
            captureView = () => null,
            applySource,
            applyViewTransform,
            recoverGeometry,
            reportFailure,
            createImage = () => new globalScope.Image(),
        }) {
            this.state = state;
            this.renderUrl = renderUrl;
            this.captureView = captureView;
            this.applySource = applySource;
            this.applyViewTransform = applyViewTransform;
            this.recoverGeometry = recoverGeometry;
            this.reportFailure = reportFailure;
            this.createImage = createImage;
        }

        isCurrent(frameGeneration, pointGeneration) {
            return frameGeneration === this.state.generation
                && pointGeneration === this.state.pointGeneration;
        }

        request(frameGeneration = this.state.generation) {
            if (!this.state.images.length
                    || frameGeneration !== this.state.generation) {
                return null;
            }
            const image = this.state.images[this.state.currentIndex];
            const pointGeneration = ++this.state.pointGeneration;
            const renderedView = this.captureView();
            const url = this.renderUrl(image, renderedView);
            const loader = this.createImage();
            loader.onload = () => {
                if (!this.isCurrent(frameGeneration, pointGeneration)) {
                    return;
                }
                this.applySource(url, renderedView);
                this.applyViewTransform();
            };
            loader.onerror = async () => {
                if (!this.isCurrent(frameGeneration, pointGeneration)) {
                    return;
                }
                const geometryChanged = await this.recoverGeometry();
                if (!geometryChanged
                        && this.isCurrent(frameGeneration, pointGeneration)) {
                    this.reportFailure(image);
                }
            };
            loader.src = url;
            return loader;
        }
    }

    globalScope.ReprojectionPointRequester = ReprojectionPointRequester;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = ReprojectionPointRequester;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
