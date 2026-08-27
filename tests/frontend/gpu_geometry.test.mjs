import assert from "node:assert/strict";
import {BufferAttribute, BufferGeometry} from "three";
import {
    normalizeGeometryAttributesForGpu,
} from "../../static/js/reprojection/gpu_geometry.mjs";

const geometry = new BufferGeometry();
const positions = new BufferAttribute(new Float64Array([
    1.25, 2.5, 3.75,
    4.25, 5.5, 6.75,
]), 3);
positions.name = "double positions";
geometry.setAttribute("position", positions);
geometry.setAttribute("normal", new BufferAttribute(
    new Float64Array([0, 0, 1, 0, 1, 0]), 3
));
const colors = new BufferAttribute(
    new Uint8Array([10, 20, 30, 40, 50, 60]), 3, true
);
geometry.setAttribute("color", colors);

assert.equal(normalizeGeometryAttributesForGpu(geometry), geometry);
assert.ok(geometry.getAttribute("position").array instanceof Float32Array);
assert.ok(geometry.getAttribute("normal").array instanceof Float32Array);
assert.equal(geometry.getAttribute("position").name, "double positions");
assert.deepEqual(
    Array.from(geometry.getAttribute("position").array),
    [1.25, 2.5, 3.75, 4.25, 5.5, 6.75]
);
assert.equal(geometry.getAttribute("color"), colors);
assert.ok(geometry.getAttribute("color").array instanceof Uint8Array);
assert.equal(geometry.getAttribute("color").normalized, true);

console.log("GPU geometry normalization tests passed");
