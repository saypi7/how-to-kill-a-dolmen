import type { Dino } from "./types";
import { useLayoutEffect, useRef } from "react";
const images = new Map<string, HTMLImageElement>();
export function getImage(src: string) {
    if (!images.has(src)) {
        const im = new Image();
        im.src = src;
        images.set(src, im);
    }
    return images.get(src)!;
}
export async function preloadSprites(dinos: Dino[]) {
    await Promise.all(
        [...new Set(dinos.map((d) => d.image))].map(async (src) => {
            const im = getImage(src);
            try {
                // Keep the decoded image in the same cache used by both canvas renderers.
                await im.decode();
            } catch (error) {
                if (images.get(src) === im) images.delete(src);
                throw error;
            }
        })
    );
}
export function drawSprite(ctx: CanvasRenderingContext2D, d: Dino, x: number, y: number, width: number, height: number, flip = false) {
    const im = getImage(d.image);
    if (!im.complete || !im.naturalWidth) return;
    const [sx, sy, sw, sh] = d.crop.map((n, i) => n * (i % 2 ? im.naturalHeight : im.naturalWidth));
    const scale = Math.min(width / sw, height / sh),
        w = sw * scale,
        h = sh * scale;
    ctx.save();
    ctx.translate(x, y);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(im, sx, sy, sw, sh, -w / 2, -h, w, h);
    ctx.restore();
}
export default function Sprite({ d, flip = false, className = "" }: { d: Dino; flip?: boolean; className?: string }) {
    const ref = useRef<HTMLCanvasElement>(null);
    useLayoutEffect(() => {
        const c = ref.current;
        if (!c) return;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        const im = getImage(d.image);
        const draw = () => {
            ctx.clearRect(0, 0, c.width, c.height);
            drawSprite(ctx, d, c.width / 2, c.height - 4, c.width - 8, c.height - 8, flip);
        };
        draw();
        im.addEventListener("load", draw);
        return () => im.removeEventListener("load", draw);
    }, [d, flip]);
    return <canvas ref={ref} width="320" height="220" className={`sprite ${className}`} role="img" aria-label={d.name} />;
}
