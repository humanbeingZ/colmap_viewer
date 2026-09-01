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
assert.deepEqual(chunk.draws, []);

const drawCount = 1;
const v2PositionOffset = 16 + drawCount * 32;
const v2ColorOffset = v2PositionOffset + vertexCount * 12;
const v2IndexOffset = (v2ColorOffset + vertexCount * 3 + 3) & ~3;
const v2Bytes = new ArrayBuffer(v2IndexOffset + faceCount * 12);
const v2Header = new DataView(v2Bytes);
v2Header.setUint32(0, 0x324d5643, true);
v2Header.setUint32(4, vertexCount, true);
v2Header.setUint32(8, faceCount, true);
v2Header.setUint32(12, drawCount, true);
v2Header.setUint32(16, 0, true);
v2Header.setUint32(20, 1, true);
[-1, -2, -3, 4, 5, 6].forEach((value, index) => {
    v2Header.setFloat32(24 + index * 4, value, true);
});
new Float32Array(v2Bytes, v2PositionOffset, 9).set([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
]);
new Uint8Array(v2Bytes, v2ColorOffset, 9).set([
    255, 0, 0,
    0, 255, 0,
    0, 0, 255,
]);
new Uint32Array(v2Bytes, v2IndexOffset, 3).set([0, 1, 2]);
const v2Chunk = parseMeshChunk(v2Bytes);
assert.deepEqual(v2Chunk.draws, [{
    faceStart: 0,
    faceCount: 1,
    minimum: [-1, -2, -3],
    maximum: [4, 5, 6],
}]);

assert.throws(() => parseMeshChunk(new ArrayBuffer(12)), /magic/);

console.log("GPU mesh chunk tests passed");
