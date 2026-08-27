import assert from "node:assert/strict";

import {parseMeshChunk} from "../../static/js/reprojection/gpu_mesh_chunk.mjs";

const vertexCount = 3;
const faceCount = 1;
const colorOffset = 12 + vertexCount * 12;
const indexOffset = (colorOffset + vertexCount * 3 + 3) & ~3;
const bytes = new ArrayBuffer(indexOffset + faceCount * 12);
const header = new DataView(bytes);
header.setUint32(0, 0x314d5643, true);
header.setUint32(4, vertexCount, true);
header.setUint32(8, faceCount, true);
new Float32Array(bytes, 12, 9).set([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
]);
new Uint8Array(bytes, colorOffset, 9).set([
    255, 0, 0,
    0, 255, 0,
    0, 0, 255,
]);
new Uint32Array(bytes, indexOffset, 3).set([0, 1, 2]);

const chunk = parseMeshChunk(bytes);
assert.equal(chunk.vertexCount, 3);
assert.equal(chunk.faceCount, 1);
assert.deepEqual([...chunk.positions], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
assert.deepEqual([...chunk.colors], [255, 0, 0, 0, 255, 0, 0, 0, 255]);
assert.deepEqual([...chunk.indices], [0, 1, 2]);

assert.throws(() => parseMeshChunk(new ArrayBuffer(12)), /magic/);

console.log("GPU mesh chunk tests passed");
