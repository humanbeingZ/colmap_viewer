// Original 3DGS and PlayCanvas use 0.3 screen-space dilation;
// Mip-Splatting's reference kernel_size defaults to 0.1.
export const DEFAULT_SPLAT_KERNEL_SIZE = 0.3;

export const DEFAULT_GAUSSIAN_SPLAT_FILTER = Object.freeze({
    antiAlias: false,
    kernelSize: DEFAULT_SPLAT_KERNEL_SIZE,
});

export function gaussianSplatFilter(current, options = {}) {
    const filter = {...DEFAULT_GAUSSIAN_SPLAT_FILTER, ...current};
    if (typeof options.antiAlias === "boolean") {
        filter.antiAlias = options.antiAlias;
    }
    if (Number.isFinite(options.kernelSize)) {
        filter.kernelSize = Math.max(0, options.kernelSize);
    }
    return filter;
}
