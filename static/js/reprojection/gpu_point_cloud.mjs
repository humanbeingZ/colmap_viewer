import {InstancedBufferAttribute} from "three/webgpu";

const DEFAULT_MAX_DEPTH_SAMPLES = 65_536;

export function instancedAttributeView(attribute) {
    const instanced = new InstancedBufferAttribute(
        attribute.array, attribute.itemSize, attribute.normalized
    );
    instanced.name = attribute.name;
    instanced.setUsage(attribute.usage);
    instanced.gpuType = attribute.gpuType;
    return instanced;
}

export function needsVisiblePointDepthRange(kind, colorMode) {
    return kind === "point cloud" && colorMode === "depth";
}

function percentile(sorted, fraction) {
    const position = (sorted.length - 1) * fraction;
    const left = Math.floor(position);
    const blend = position - left;
    const right = Math.min(left + 1, sorted.length - 1);
    return sorted[left] * (1 - blend) + sorted[right] * blend;
}

export function visiblePointDepthPercentiles(
    position, viewMatrix, frustum, clipping,
    maxSamples = DEFAULT_MAX_DEPTH_SAMPLES
) {
    const count = position?.count || 0;
    if (!count || maxSamples <= 0) {
        return null;
    }
    const elements = viewMatrix.elements;
    const leftSlope = frustum.left / frustum.near;
    const rightSlope = frustum.right / frustum.near;
    const bottomSlope = frustum.bottom / frustum.near;
    const topSlope = frustum.top / frustum.near;
    const sampleCount = Math.min(count, Math.floor(maxSamples));
    const depths = [];

    // Stratification covers the complete PLY without allocating or walking a
    // multi-million-point position buffer on every camera change.
    for (let sample = 0; sample < sampleCount; sample += 1) {
        const index = sampleCount === count
            ? sample
            : Math.min(
                count - 1,
                Math.floor((sample + 0.5) * count / sampleCount)
            );
        const x = position.getX(index);
        const y = position.getY(index);
        const z = position.getZ(index);
        const viewX = elements[0] * x + elements[4] * y
            + elements[8] * z + elements[12];
        const viewY = elements[1] * x + elements[5] * y
            + elements[9] * z + elements[13];
        const depth = -(elements[2] * x + elements[6] * y
            + elements[10] * z + elements[14]);
        if (depth < clipping.near || depth > clipping.far
                || viewX < leftSlope * depth
                || viewX >= rightSlope * depth
                || viewY < bottomSlope * depth
                || viewY >= topSlope * depth) {
            continue;
        }
        depths.push(depth);
    }
    if (!depths.length) {
        return null;
    }
    depths.sort((left, right) => left - right);
    return {
        near: percentile(depths, 0.02),
        far: percentile(depths, 0.98),
    };
}
