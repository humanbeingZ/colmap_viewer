const CHUNK_MAGIC = 0x314d5643;

export function parseMeshChunk(bytes) {
    const header = new DataView(bytes, 0, 12);
    if (header.getUint32(0, true) !== CHUNK_MAGIC) {
        throw new Error("Invalid streamed mesh chunk magic");
    }
    const vertexCount = header.getUint32(4, true);
    const faceCount = header.getUint32(8, true);
    const positionOffset = 12;
    const colorOffset = positionOffset + vertexCount * 12;
    const indexOffset = (colorOffset + vertexCount * 3 + 3) & ~3;
    const expectedSize = indexOffset + faceCount * 12;
    if (bytes.byteLength !== expectedSize) {
        throw new Error("Invalid streamed mesh chunk length");
    }
    return {
        vertexCount,
        faceCount,
        positions: new Float32Array(bytes, positionOffset, vertexCount * 3),
        colors: new Uint8Array(bytes, colorOffset, vertexCount * 3),
        indices: new Uint32Array(bytes, indexOffset, faceCount * 3),
    };
}
