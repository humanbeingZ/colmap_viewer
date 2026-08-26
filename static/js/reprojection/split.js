(function (globalScope) {
    "use strict";

    const cursorCache = new Map();

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function normalizedAngle(angleDegrees) {
        const angle = Number(angleDegrees);
        return Number.isFinite(angle) ? clamp(angle, -180, 180) : 0;
    }

    function wrappedAngle(angleDegrees) {
        const angle = Number(angleDegrees);
        if (!Number.isFinite(angle)) {
            return 0;
        }
        return ((angle + 180) % 360 + 360) % 360 - 180;
    }

    function rotatedAngle(startAngle, startPointerAngle, pointerAngle) {
        return wrappedAngle(
            startAngle + wrappedAngle(pointerAngle - startPointerAngle)
        );
    }

    function splitBasis(angleDegrees) {
        const angle = normalizedAngle(angleDegrees);
        const radians = angle * Math.PI / 180;
        return {
            angle,
            normalX: Math.cos(radians),
            normalY: Math.sin(radians),
            lineAngle: 90 + angle,
        };
    }

    function projectionRange(width, height, normalX, normalY) {
        const projections = [
            0,
            normalX * width,
            normalY * height,
            normalX * width + normalY * height,
        ];
        return {
            minimum: Math.min(...projections),
            maximum: Math.max(...projections),
        };
    }

    function clipToInputHalfPlane(points, normalX, normalY, threshold) {
        const result = [];
        let previous = points[points.length - 1];
        let previousProjection = normalX * previous.x + normalY * previous.y;
        let previousInside = previousProjection >= threshold - 1e-7;

        for (const current of points) {
            const currentProjection = normalX * current.x + normalY * current.y;
            const currentInside = currentProjection >= threshold - 1e-7;
            if (currentInside !== previousInside) {
                const ratio = (threshold - previousProjection)
                    / (currentProjection - previousProjection);
                result.push({
                    x: previous.x + ratio * (current.x - previous.x),
                    y: previous.y + ratio * (current.y - previous.y),
                });
            }
            if (currentInside) {
                result.push(current);
            }
            previous = current;
            previousProjection = currentProjection;
            previousInside = currentInside;
        }
        return result;
    }

    function geometry(width, height, splitPercent, angleDegrees) {
        const safeWidth = Math.max(1, Number(width) || 1);
        const safeHeight = Math.max(1, Number(height) || 1);
        const percent = clamp(Number(splitPercent) || 0, 0, 100);
        const basis = splitBasis(angleDegrees);
        const range = projectionRange(
            safeWidth,
            safeHeight,
            basis.normalX,
            basis.normalY
        );
        const threshold = range.minimum
            + percent / 100 * (range.maximum - range.minimum);
        const centerX = safeWidth / 2;
        const centerY = safeHeight / 2;
        const centerProjection = basis.normalX * centerX
            + basis.normalY * centerY;
        const offset = threshold - centerProjection;
        let polygon;
        if (percent <= 0) {
            polygon = [
                {x: 0, y: 0},
                {x: safeWidth, y: 0},
                {x: safeWidth, y: safeHeight},
                {x: 0, y: safeHeight},
            ];
        } else if (percent >= 100) {
            polygon = [];
        } else {
            polygon = clipToInputHalfPlane([
                {x: 0, y: 0},
                {x: safeWidth, y: 0},
                {x: safeWidth, y: safeHeight},
                {x: 0, y: safeHeight},
            ], basis.normalX, basis.normalY, threshold);
        }
        return {
            ...basis,
            width: safeWidth,
            height: safeHeight,
            percent,
            threshold,
            lineX: centerX + basis.normalX * offset,
            lineY: centerY + basis.normalY * offset,
            lineLength: 2 * Math.hypot(safeWidth, safeHeight),
            polygon,
        };
    }

    function polygonCss(splitGeometry) {
        if (!splitGeometry.polygon.length) {
            return "polygon(0 0, 0 0, 0 0)";
        }
        const points = splitGeometry.polygon.map(point => {
            const x = 100 * point.x / splitGeometry.width;
            const y = 100 * point.y / splitGeometry.height;
            return `${x.toFixed(4)}% ${y.toFixed(4)}%`;
        });
        return `polygon(${points.join(", ")})`;
    }

    function percentFromPoint(width, height, x, y, angleDegrees) {
        const basis = splitBasis(angleDegrees);
        const range = projectionRange(
            width,
            height,
            basis.normalX,
            basis.normalY
        );
        const projection = basis.normalX * x + basis.normalY * y;
        return 100 * (projection - range.minimum)
            / Math.max(range.maximum - range.minimum, 1e-9);
    }

    function resizeCursor(angleDegrees) {
        let angle = wrappedAngle(angleDegrees);
        if (angle >= 90) {
            angle -= 180;
        } else if (angle < -90) {
            angle += 180;
        }
        angle = Number(angle.toFixed(1));
        if (cursorCache.has(angle)) {
            return cursorCache.get(angle);
        }
        if (cursorCache.size >= 256) {
            cursorCache.clear();
        }
        const arrow = "M4 16H28 M4 16l5-5 M4 16l5 5 "
            + "M28 16l-5-5 M28 16l-5 5";
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" `
            + `width="32" height="32" viewBox="0 0 32 32">`
            + `<g transform="rotate(${angle} 16 16)">`
            + `<path d="${arrow}" fill="none" stroke="black" `
            + `stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`
            + `<path d="${arrow}" fill="none" stroke="white" `
            + `stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
            + `</g></svg>`;
        const cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, move`;
        cursorCache.set(angle, cursor);
        return cursor;
    }

    const api = {
        geometry,
        normalizedAngle,
        percentFromPoint,
        polygonCss,
        resizeCursor,
        rotatedAngle,
        wrappedAngle,
    };
    globalScope.ReprojectionSplitGeometry = api;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
