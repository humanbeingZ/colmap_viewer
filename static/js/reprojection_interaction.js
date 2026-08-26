(function (globalScope) {
    "use strict";

    class ReprojectionInteraction {
        constructor({
            viewer,
            splitElement,
            inputLayer,
            divider,
            layoutControl,
            angleControl,
            state,
            splitGeometry,
            applyViewTransform,
        }) {
            this.viewer = viewer;
            this.splitElement = splitElement;
            this.inputLayer = inputLayer;
            this.divider = divider;
            this.layoutControl = layoutControl;
            this.angleControl = angleControl;
            this.state = state;
            this.splitGeometry = splitGeometry;
            this.applyViewTransform = applyViewTransform;
            this.pointerMode = null;
            this.pointerId = null;
            this.pointerLastX = 0;
            this.pointerLastY = 0;
            this.rotationStartPointerAngle = null;
            this.rotationStartSplitAngle = 0;
            this.displayWidth = null;
            this.displayHeight = null;
        }

        currentGeometry(bounds = null) {
            const size = bounds || this.splitElement.getBoundingClientRect();
            return this.splitGeometry.geometry(
                size.width,
                size.height,
                this.state.splitPercent,
                this.state.splitAngle
            );
        }

        applySplit() {
            const split = this.currentGeometry({
                width: this.splitElement.clientWidth,
                height: this.splitElement.clientHeight,
            });
            this.inputLayer.style.clipPath = this.splitGeometry.polygonCss(split);
            this.divider.style.left = `${split.lineX}px`;
            this.divider.style.top = `${split.lineY}px`;
            this.divider.style.width = `${split.lineLength}px`;
            this.divider.style.transform =
                `translate(-50%, -50%) rotate(${split.lineAngle}deg)`;
        }

        resize(width, height) {
            if (width === this.displayWidth && height === this.displayHeight) {
                return false;
            }
            this.displayWidth = width;
            this.displayHeight = height;
            this.splitElement.style.width = `${width}px`;
            this.splitElement.style.height = `${height}px`;
            this.applySplit();
            return true;
        }

        setAngle(angle) {
            this.state.splitAngle = this.splitGeometry.wrappedAngle(angle);
            this.angleControl.value = Number(this.state.splitAngle.toFixed(1));
            this.applySplit();
        }

        resetDivider() {
            this.state.splitPercent = 50;
            this.setAngle(0);
        }

        pointInside(clientX, clientY, bounds = null) {
            const box = bounds || this.splitElement.getBoundingClientRect();
            return clientX >= box.left && clientX <= box.right
                && clientY >= box.top && clientY <= box.bottom;
        }

        pointNearDivider(clientX, clientY) {
            if (this.layoutControl.value === "side") {
                return false;
            }
            const bounds = this.splitElement.getBoundingClientRect();
            if (!this.pointInside(clientX, clientY, bounds)) {
                return false;
            }
            const split = this.currentGeometry(bounds);
            const localX = clientX - bounds.left;
            const localY = clientY - bounds.top;
            const projection = split.normalX * localX + split.normalY * localY;
            return Math.abs(projection - split.threshold) <= 7;
        }

        pointerAngle(clientX, clientY) {
            const bounds = this.splitElement.getBoundingClientRect();
            const deltaX = clientX - (bounds.left + bounds.width / 2);
            const deltaY = clientY - (bounds.top + bounds.height / 2);
            if (Math.hypot(deltaX, deltaY) < 2) {
                return null;
            }
            return Math.atan2(deltaY, deltaX) * 180 / Math.PI;
        }

        setSplitFromPointer(clientX, clientY) {
            const bounds = this.splitElement.getBoundingClientRect();
            const percent = this.splitGeometry.percentFromPoint(
                bounds.width,
                bounds.height,
                clientX - bounds.left,
                clientY - bounds.top,
                this.state.splitAngle
            );
            this.state.splitPercent = Math.max(0, Math.min(100, percent));
            this.applySplit();
        }

        updateCursor(clientX, clientY, rotateModifier = false) {
            const resizeCursor = this.splitGeometry.resizeCursor(this.state.splitAngle);
            const rotateHover = rotateModifier
                && this.layoutControl.value !== "side"
                && this.pointInside(clientX, clientY);
            if (this.pointerMode === "rotate" || rotateHover) {
                this.viewer.style.cursor = "crosshair";
            } else if (this.pointerMode === "split") {
                this.viewer.style.cursor = resizeCursor;
            } else if (this.pointerMode === "pan") {
                this.viewer.style.cursor = "grabbing";
            } else {
                this.viewer.style.cursor = this.pointNearDivider(clientX, clientY)
                    ? resizeCursor
                    : "grab";
            }
        }

        start(event) {
            if (event.button !== 0) {
                return;
            }
            event.preventDefault();
            const rotate = (event.ctrlKey || event.metaKey)
                && this.layoutControl.value !== "side"
                && this.pointInside(event.clientX, event.clientY);
            this.pointerMode = rotate
                ? "rotate"
                : (this.pointNearDivider(event.clientX, event.clientY)
                    ? "split"
                    : "pan");
            this.pointerId = event.pointerId;
            this.pointerLastX = event.clientX;
            this.pointerLastY = event.clientY;
            this.viewer.setPointerCapture(event.pointerId);
            if (this.pointerMode === "rotate") {
                this.state.splitPercent = 50;
                this.rotationStartPointerAngle = this.pointerAngle(
                    event.clientX, event.clientY
                );
                this.rotationStartSplitAngle = this.state.splitAngle;
                this.applySplit();
            } else if (this.pointerMode === "split") {
                this.setSplitFromPointer(event.clientX, event.clientY);
            }
            this.updateCursor(event.clientX, event.clientY, rotate);
        }

        move(event) {
            if (this.pointerId !== event.pointerId) {
                this.updateCursor(
                    event.clientX,
                    event.clientY,
                    event.ctrlKey || event.metaKey
                );
                return;
            }
            event.preventDefault();
            if (this.pointerMode === "rotate") {
                this.rotate(event.clientX, event.clientY);
            } else if (this.pointerMode === "split") {
                this.setSplitFromPointer(event.clientX, event.clientY);
            } else if (this.pointerMode === "pan") {
                this.state.viewTranslateX += event.clientX - this.pointerLastX;
                this.state.viewTranslateY += event.clientY - this.pointerLastY;
                this.applyViewTransform();
            }
            this.pointerLastX = event.clientX;
            this.pointerLastY = event.clientY;
        }

        rotate(clientX, clientY) {
            const pointerAngle = this.pointerAngle(clientX, clientY);
            if (pointerAngle === null) {
                return;
            }
            if (this.rotationStartPointerAngle === null) {
                this.rotationStartPointerAngle = pointerAngle;
                return;
            }
            this.setAngle(this.splitGeometry.rotatedAngle(
                this.rotationStartSplitAngle,
                this.rotationStartPointerAngle,
                pointerAngle
            ));
        }

        stop(event) {
            if (this.pointerId !== event.pointerId) {
                return;
            }
            if (this.viewer.hasPointerCapture(event.pointerId)) {
                this.viewer.releasePointerCapture(event.pointerId);
            }
            this.pointerMode = null;
            this.pointerId = null;
            this.rotationStartPointerAngle = null;
            this.updateCursor(
                event.clientX,
                event.clientY,
                event.ctrlKey || event.metaKey
            );
        }

        attach() {
            this.viewer.addEventListener("pointerdown", event => this.start(event));
            this.viewer.addEventListener("pointermove", event => this.move(event));
            this.viewer.addEventListener("pointerup", event => this.stop(event));
            this.viewer.addEventListener("pointercancel", event => this.stop(event));
            this.viewer.addEventListener("pointerleave", () => {
                if (this.pointerMode === null) {
                    this.viewer.style.cursor = "grab";
                }
            });
        }
    }

    globalScope.ReprojectionInteraction = ReprojectionInteraction;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = ReprojectionInteraction;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
