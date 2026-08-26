(function (globalScope) {
    "use strict";

    function matrixVector(matrix, vector) {
        return matrix.map(row => (
            row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2]
        ));
    }

    function transposeMatrixVector(matrix, vector) {
        return [0, 1, 2].map(column => (
            matrix[0][column] * vector[0]
            + matrix[1][column] * vector[1]
            + matrix[2][column] * vector[2]
        ));
    }

    function pointOnLine([a, b, c]) {
        if (Math.abs(a) > Math.abs(b) && Math.abs(a) > 1e-12) {
            return [-c / a, 0, 1];
        }
        if (Math.abs(b) > 1e-12) {
            return [0, -c / b, 1];
        }
        return null;
    }

    function correspondingLines(matrix, canvasKey, point) {
        const homogeneous = [point.x, point.y, 1];
        if (canvasKey === "image1") {
            const image2 = matrixVector(matrix, homogeneous);
            const point2 = pointOnLine(image2);
            return point2
                ? {image1: transposeMatrixVector(matrix, point2), image2}
                : null;
        }
        const image1 = transposeMatrixVector(matrix, homogeneous);
        const point1 = pointOnLine(image1);
        return point1
            ? {image1, image2: matrixVector(matrix, point1)}
            : null;
    }

    function lineSegment([a, b, c], width, height) {
        const candidates = [];
        const add = (x, y) => {
            if (!Number.isFinite(x) || !Number.isFinite(y)
                    || x < -1e-7 || x > width + 1e-7
                    || y < -1e-7 || y > height + 1e-7) {
                return;
            }
            if (!candidates.some(point => (
                Math.hypot(point.x - x, point.y - y) < 1e-6
            ))) {
                candidates.push({
                    x: Math.max(0, Math.min(width, x)),
                    y: Math.max(0, Math.min(height, y)),
                });
            }
        };
        if (Math.abs(b) > 1e-12) {
            add(0, -c / b);
            add(width, -(a * width + c) / b);
        }
        if (Math.abs(a) > 1e-12) {
            add(-c / a, 0);
            add(-(b * height + c) / a, height);
        }
        return candidates.length >= 2 ? candidates.slice(0, 2) : null;
    }

    class EpipolarTool {
        constructor({
            button,
            overlay,
            viewer,
            canvases,
            getPair,
            getSourceKey,
            getImageData,
            getCanvasState,
            imageToOverlay,
        }) {
            this.button = button;
            this.overlay = overlay;
            this.context = overlay.getContext("2d");
            this.viewer = viewer;
            this.canvases = canvases;
            this.getPair = getPair;
            this.getSourceKey = getSourceKey;
            this.getImageData = getImageData;
            this.getCanvasState = getCanvasState;
            this.imageToOverlay = imageToOverlay;
            this.enabled = false;
            this.geometry = null;
            this.lines = null;
            this.pairKey = undefined;
            this.loadGeneration = 0;
            this.frameRequest = null;
            this.pendingPointer = null;

            button.addEventListener("click", () => this.toggle());
            canvases.forEach(canvas => {
                canvas.addEventListener("mousemove", event => {
                    this.pendingPointer = {canvas, event};
                    this.schedulePointerUpdate();
                });
                canvas.addEventListener("wheel", () => this.scheduleDraw());
            });
            window.addEventListener("resize", () => this.scheduleDraw());
            this.updateButton();
        }

        currentPairKey() {
            const [image1, image2] = this.getPair();
            return image1 && image2
                ? `${this.getSourceKey()}\0${image1}\0${image2}`
                : null;
        }

        syncPair() {
            const key = this.currentPairKey();
            if (key === this.pairKey) {
                return;
            }
            this.pairKey = key;
            this.geometry = null;
            this.lines = null;
            this.loadGeneration += 1;
            this.clear();
            this.button.disabled = !key;
            this.button.title = key
                ? "Move over either image to inspect pose-derived epipolar lines"
                : "Select two images first";
            if (this.enabled && key) {
                this.loadGeometry();
            }
        }

        async toggle() {
            this.syncPair();
            if (!this.pairKey) {
                return;
            }
            this.enabled = !this.enabled;
            this.lines = null;
            this.updateButton();
            this.clear();
            if (this.enabled && !this.geometry) {
                await this.loadGeometry();
            }
        }

        updateButton() {
            this.button.textContent = this.enabled
                ? "Hide Epipolar Lines"
                : "Draw Epipolar Lines";
            this.button.classList.toggle("active", this.enabled);
            this.button.setAttribute("aria-pressed", String(this.enabled));
        }

        async loadGeometry() {
            const generation = ++this.loadGeneration;
            const key = this.pairKey;
            const [image1, image2] = this.getPair();
            try {
                const response = await fetch(`/api/epipolar/${image1}/${image2}`);
                const body = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(body.detail || `HTTP ${response.status}`);
                }
                if (generation !== this.loadGeneration || key !== this.pairKey) {
                    return;
                }
                this.geometry = body;
                this.button.title =
                    "Move over either image to inspect pose-derived epipolar lines";
            } catch (error) {
                if (generation !== this.loadGeneration || key !== this.pairKey) {
                    return;
                }
                this.enabled = false;
                this.geometry = null;
                this.lines = null;
                this.updateButton();
                this.button.title = error.message;
                this.clear();
                console.warn("Unable to enable epipolar lines:", error);
            }
        }

        schedulePointerUpdate() {
            if (this.frameRequest !== null) {
                return;
            }
            this.frameRequest = requestAnimationFrame(() => {
                this.frameRequest = null;
                this.updateFromPointer();
            });
        }

        updateFromPointer() {
            if (!this.enabled || !this.geometry || !this.pendingPointer) {
                return;
            }
            const {canvas, event} = this.pendingPointer;
            const canvasKey = canvas === this.canvases[0] ? "image1" : "image2";
            const imageData = this.getImageData(canvasKey);
            if (!imageData) {
                return;
            }
            const bounds = canvas.getBoundingClientRect();
            const state = this.getCanvasState(canvasKey);
            const canvasX = (event.clientX - bounds.left)
                * state.viewportWidth / bounds.width;
            const canvasY = (event.clientY - bounds.top)
                * state.viewportHeight / bounds.height;
            const point = {
                x: (canvasX - state.translateX) / state.scale,
                y: (canvasY - state.translateY) / state.scale,
            };
            if (point.x < 0 || point.x > imageData.width
                    || point.y < 0 || point.y > imageData.height) {
                return;
            }
            this.lines = correspondingLines(
                this.geometry.fundamental_matrix, canvasKey, point
            );
            this.draw();
        }

        scheduleDraw() {
            requestAnimationFrame(() => this.draw());
        }

        clear() {
            this.resizeOverlay();
            this.context.clearRect(0, 0, this.overlay.width, this.overlay.height);
        }

        resizeOverlay() {
            const width = this.viewer.clientWidth;
            const height = this.viewer.clientHeight;
            if (this.overlay.width !== width || this.overlay.height !== height) {
                this.overlay.width = width;
                this.overlay.height = height;
            }
        }

        draw() {
            this.clear();
            if (!this.enabled || !this.lines
                    || this.overlay.width === 0 || this.overlay.height === 0) {
                return;
            }
            this.context.save();
            this.context.strokeStyle = "rgba(255, 40, 40, 0.95)";
            this.context.lineWidth = 1;
            ["image1", "image2"].forEach((canvasKey, index) => {
                const imageData = this.getImageData(canvasKey);
                if (!imageData) {
                    return;
                }
                const segment = lineSegment(
                    this.lines[canvasKey], imageData.width, imageData.height
                );
                if (!segment) {
                    return;
                }
                const start = this.imageToOverlay(segment[0], canvasKey);
                const end = this.imageToOverlay(segment[1], canvasKey);
                const viewerBounds = this.viewer.getBoundingClientRect();
                const canvasBounds = this.canvases[index].getBoundingClientRect();
                const scaleX = this.overlay.width / viewerBounds.width;
                const scaleY = this.overlay.height / viewerBounds.height;
                this.context.save();
                this.context.beginPath();
                this.context.rect(
                    (canvasBounds.left - viewerBounds.left) * scaleX,
                    (canvasBounds.top - viewerBounds.top) * scaleY,
                    canvasBounds.width * scaleX,
                    canvasBounds.height * scaleY
                );
                this.context.clip();
                this.context.beginPath();
                this.context.moveTo(start.x, start.y);
                this.context.lineTo(end.x, end.y);
                this.context.stroke();
                this.context.restore();
            });
            this.context.restore();
        }
    }

    const api = {EpipolarTool, correspondingLines, lineSegment};
    globalScope.EpipolarTool = EpipolarTool;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
