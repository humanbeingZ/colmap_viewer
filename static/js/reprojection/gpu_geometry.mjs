import {BufferAttribute} from "three";

/** Convert PLY attributes that WebGL cannot upload to GPU-supported storage. */
export function normalizeGeometryAttributesForGpu(geometry) {
    for (const [name, attribute] of Object.entries(geometry.attributes)) {
        if (!(attribute.array instanceof Float64Array)) {
            continue;
        }
        const converted = new BufferAttribute(
            new Float32Array(attribute.array),
            attribute.itemSize,
            attribute.normalized
        );
        converted.name = attribute.name;
        converted.setUsage(attribute.usage);
        geometry.setAttribute(name, converted);
    }
    return geometry;
}
