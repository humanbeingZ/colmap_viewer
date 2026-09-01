const CHUNK_MAGIC_V1 = 0x314d5643;
const CHUNK_MAGIC_V2 = 0x324d5643;
const DRAW_RECORD_SIZE = 32;

export function parseMeshChunk(bytes) {
    if (bytes.byteLength < 12) {
        throw new Error("Invalid streamed mesh chunk length");
    }
    const header = new DataView(bytes, 0, 12);
    const magic = header.getUint32(0, true);
    if (magic !== CHUNK_MAGIC_V1 && magic !== CHUNK_MAGIC_V2) {
        throw new Error("Invalid streamed mesh chunk magic");
    }
    const vertexCount = header.getUint32(4, true);
    const faceCount = header.getUint32(8, true);
    let drawCount = 0;
    let positionOffset = 12;
    const draws = [];
    if (magic === CHUNK_MAGIC_V2) {
        if (bytes.byteLength < 16) {
            throw new Error("Invalid streamed mesh chunk length");
        }
        drawCount = new DataView(bytes, 12, 4).getUint32(0, true);
        positionOffset = 16 + drawCount * DRAW_RECORD_SIZE;
        if (positionOffset > bytes.byteLength) {
            throw new Error("Invalid streamed mesh draw records");
        }
        const records = new DataView(bytes, 16, drawCount * DRAW_RECORD_SIZE);
        let nextFaceStart = 0;
        for (let drawIndex = 0; drawIndex < drawCount; drawIndex += 1) {
            const offset = drawIndex * DRAW_RECORD_SIZE;
            const faceStart = records.getUint32(offset, true);
            const drawFaceCount = records.getUint32(offset + 4, true);
            if (faceStart !== nextFaceStart || drawFaceCount === 0
                    || faceStart + drawFaceCount > faceCount) {
                throw new Error("Invalid streamed mesh draw range");
            }
            nextFaceStart += drawFaceCount;
            draws.push({
                faceStart,
                faceCount: drawFaceCount,
                minimum: [
                    records.getFloat32(offset + 8, true),
                    records.getFloat32(offset + 12, true),
                    records.getFloat32(offset + 16, true),
                ],
                maximum: [
                    records.getFloat32(offset + 20, true),
                    records.getFloat32(offset + 24, true),
                    records.getFloat32(offset + 28, true),
                ],
            });
        }
        if (nextFaceStart !== faceCount) {
            throw new Error("Incomplete streamed mesh draw ranges");
        }
    }
    const colorOffset = positionOffset + vertexCount * 12;
    const indexOffset = (colorOffset + vertexCount * 3 + 3) & ~3;
    const expectedSize = indexOffset + faceCount * 12;
    if (bytes.byteLength !== expectedSize) {
        throw new Error("Invalid streamed mesh chunk length");
    }
    return {
        vertexCount,
        faceCount,
        draws,
        positions: new Float32Array(bytes, positionOffset, vertexCount * 3),
        colors: new Uint8Array(bytes, colorOffset, vertexCount * 3),
        indices: new Uint32Array(bytes, indexOffset, faceCount * 3),
    };
}
