import type { Dino } from "../types";

const images = new Map<string, HTMLImageElement>();
export function getImage(src: string) {
    if (!images.has(src)) {
        const image = new Image();
        image.src = src;
        images.set(src, image);
    }
    return images.get(src)!;
}
export async function preloadSprites(dinos: Dino[]) {
    await Promise.all(
        [...new Set(dinos.map((dinosaur) => dinosaur.image))].map(async (src) => {
            const image = getImage(src);
            try {
                // Keep the decoded image in the same cache used by both canvas renderers.
                await image.decode();
            } catch (error) {
                if (images.get(src) === image) images.delete(src);
                throw error;
            }
        })
    );
}
export function drawSprite(context: CanvasRenderingContext2D, dinosaur: Dino, x: number, y: number, width: number, height: number, flip = false) {
    const image = getImage(dinosaur.image);
    if (!image.complete || !image.naturalWidth) return;
    const [sx, sy, sw, sh] = dinosaur.crop.map((n, i) => n * (i % 2 ? image.naturalHeight : image.naturalWidth));
    const scale = Math.min(width / sw, height / sh);
    const w = sw * scale;
    const h = sh * scale;
    context.save();
    context.translate(x, y);
    if (flip) context.scale(-1, 1);
    context.drawImage(image, sx, sy, sw, sh, -w / 2, -h, w, h);
    context.restore();
}
