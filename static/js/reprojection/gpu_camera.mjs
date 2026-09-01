export function isPinholeCamera(image) {
    return ["PINHOLE", "SIMPLE_PINHOLE"].includes(image.camera.model);
}

export function pinholeIntrinsics(image) {
    const params = image.camera.params.map(Number);
    if (image.camera.model === "PINHOLE") {
        const [fx, fy, cx, cy] = params;
        return {fx, fy, cx, cy};
    }
    if (image.camera.model === "SIMPLE_PINHOLE") {
        const [focal, cx, cy] = params;
        return {fx: focal, fy: focal, cx, cy};
    }
    throw new Error(
        `GPU rendering does not yet support distorted ${image.camera.model} cameras`
    );
}

export function threeViewRows(camFromWorld) {
    if (!Array.isArray(camFromWorld) || camFromWorld.length !== 3
            || camFromWorld.some(row => !Array.isArray(row) || row.length !== 4)) {
        throw new Error("Expected a 3x4 COLMAP world-to-camera matrix");
    }
    return [
        [...camFromWorld[0]],
        camFromWorld[1].map(value => -value),
        camFromWorld[2].map(value => -value),
        [0, 0, 0, 1],
    ];
}

export function projectionFrustum(image, near, far, region = null) {
    const {fx, fy, cx, cy} = pinholeIntrinsics(image);
    const leftPixel = region?.left ?? 0;
    const rightPixel = region?.right ?? Number(image.width);
    const topPixel = region?.top ?? 0;
    const bottomPixel = region?.bottom ?? Number(image.height);
    return {
        left: (leftPixel - cx) * near / fx,
        right: (rightPixel - cx) * near / fx,
        top: (cy - topPixel) * near / fy,
        bottom: (cy - bottomPixel) * near / fy,
        near,
        far,
    };
}

export function depthRangeForSphere(distance, radius, reversedDepth = false) {
    const safeRadius = Math.max(Number(radius) || 0, 1e-6);
    const safeDistance = Number.isFinite(distance) ? distance : 0;
    const scale = Math.max(safeRadius, Math.abs(safeDistance), 1e-3);
    // A camera commonly lies inside a reconstruction's global bounding sphere.
    // Do not let that conservative bound collapse the near plane to a fixed,
    // scene-independent epsilon. Reversed floating-point depth tolerates a
    // substantially wider range than the WebGL fallback.
    const nearFloor = Math.max(
        1e-5,
        // Conventional fixed-point depth needs a materially tighter ratio
        // than reversed floating-point depth. A relative 0.1% near plane
        // matches desktop mesh viewers while remaining scale-independent.
        scale * (reversedDepth ? 1e-6 : 1e-3)
    );
    const nearest = safeDistance - safeRadius;
    const near = nearest > nearFloor
        ? Math.max(nearFloor, nearest * 0.5)
        : nearFloor;
    const farthest = Math.max(safeDistance + safeRadius, safeRadius);
    const far = Math.max(near * 1.01, farthest + safeRadius * 0.05);
    return {near, far};
}

export function clippedDepthRange(
    range, nearFraction = 0, farFraction = 1
) {
    const minimumGap = 1e-4;
    const nearRatio = Math.max(
        0, Math.min(1 - minimumGap, Number(nearFraction) || 0)
    );
    const farRatio = Math.max(
        nearRatio + minimumGap,
        Math.min(1, Number(farFraction) || 0)
    );
    const span = Math.max(Number(range.far) - Number(range.near), 1e-9);
    return {
        near: Number(range.near) + span * nearRatio,
        far: Number(range.near) + span * farRatio,
    };
}

export function depthRangesForClipping(
    range, nearFraction = 0, farFraction = 1,
    stableProjection = false
) {
    const clipping = clippedDepthRange(range, nearFraction, farFraction);
    return {
        clipping,
        // Mesh clipping uses separate planes, so its projection must remain
        // invariant as the sliders move. Other renderers still clip through
        // their projection matrix and therefore use the narrowed range.
        projection: stableProjection
            ? {near: Number(range.near), far: Number(range.far)}
            : clipping,
    };
}

export function zoomDetailMaxSize(
    image, baseMaxSize, viewScale, navigationPreview = false,
    rendererLimit = 8192
) {
    const sourceMaxSize = Math.max(Number(image.width), Number(image.height));
    const base = Math.max(1, Number(baseMaxSize) || 1);
    if (navigationPreview) {
        return Math.min(sourceMaxSize, base);
    }
    const scaled = base * Math.max(1, Number(viewScale) || 1);
    const quantized = scaled > base ? Math.ceil(scaled / 256) * 256 : base;
    return Math.min(sourceMaxSize, rendererLimit, quantized);
}

export function screenRenderSize(
    displayWidth, displayHeight, devicePixelRatio = 1,
    maximumDimension = 8192
) {
    const ratio = Math.max(1, Number(devicePixelRatio) || 1);
    const targetWidth = Math.max(1, Math.ceil((Number(displayWidth) || 1) * ratio));
    const targetHeight = Math.max(1, Math.ceil((Number(displayHeight) || 1) * ratio));
    const limit = Math.max(1, Number(maximumDimension) || 8192);
    const scale = Math.min(1, limit / Math.max(targetWidth, targetHeight));
    return {
        width: Math.max(1, Math.round(targetWidth * scale)),
        height: Math.max(1, Math.round(targetHeight * scale)),
    };
}

export function zoomViewRegion(
    image, displayWidth, displayHeight, scale, translateX, translateY
) {
    const safeScale = Math.max(Number(scale) || 1, 1e-6);
    const width = Math.max(Number(displayWidth) || 0, 1e-6);
    const height = Math.max(Number(displayHeight) || 0, 1e-6);
    const pixelsPerCssX = Number(image.width) / width;
    const pixelsPerCssY = Number(image.height) / height;
    return {
        left: (-translateX / safeScale) * pixelsPerCssX,
        right: ((width - translateX) / safeScale) * pixelsPerCssX,
        top: (-translateY / safeScale) * pixelsPerCssY,
        bottom: ((height - translateY) / safeScale) * pixelsPerCssY,
    };
}

export function imageFrameScissor(image, width, height, region = null) {
    const outputWidth = Math.max(1, Number(width) || 1);
    const outputHeight = Math.max(1, Number(height) || 1);
    const left = Number(region?.left ?? 0);
    const right = Number(region?.right ?? image.width);
    const top = Number(region?.top ?? 0);
    const bottom = Number(region?.bottom ?? image.height);
    const regionWidth = Math.max(right - left, 1e-6);
    const regionHeight = Math.max(bottom - top, 1e-6);
    const clamp = (value, maximum) => Math.max(0, Math.min(maximum, value));
    const x0 = clamp(Math.floor(-left * outputWidth / regionWidth), outputWidth);
    const x1 = clamp(
        Math.ceil((Number(image.width) - left) * outputWidth / regionWidth),
        outputWidth
    );
    const y0 = clamp(Math.floor(-top * outputHeight / regionHeight), outputHeight);
    const y1 = clamp(
        Math.ceil((Number(image.height) - top) * outputHeight / regionHeight),
        outputHeight
    );
    return {
        x: x0,
        y: y0,
        width: Math.max(0, x1 - x0),
        height: Math.max(0, y1 - y0),
    };
}

export function relativeViewTransform(renderedView, currentView) {
    const renderedScale = Math.max(Number(renderedView.scale) || 1, 1e-6);
    const scale = (Number(currentView.scale) || 1) / renderedScale;
    return {
        scale,
        translateX: (Number(currentView.translateX) || 0)
            - scale * (Number(renderedView.translateX) || 0),
        translateY: (Number(currentView.translateY) || 0)
            - scale * (Number(renderedView.translateY) || 0),
    };
}

export function detectPlyKind(header) {
    const properties = new Set();
    let faceCount = 0;
    for (const rawLine of header.split(/\r?\n/)) {
        const fields = rawLine.trim().split(/\s+/);
        if (fields[0] === "property" && fields.length >= 3) {
            properties.add(fields.at(-1));
        } else if (fields[0] === "element" && fields[1] === "face") {
            faceCount = Number(fields[2]) || 0;
        }
    }
    const gaussianProperties = [
        "scale_0", "scale_1", "scale_2",
        "rot_0", "rot_1", "rot_2", "rot_3",
        "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
    ];
    if (gaussianProperties.every(name => properties.has(name))) {
        return "gaussian splats";
    }
    return faceCount > 0 ? "triangle mesh" : "point cloud";
}
