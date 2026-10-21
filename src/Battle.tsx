import type { MouseEvent } from "react";
import type { GameState, GameData, Unit } from "./types";

interface Position {
    x: number;
    hp: number;
    hitAt: number;
    targetX: number;
}
interface HitArea {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}
import { useEffect, useRef, useState } from "react";
import { drawSprite, getImage } from "./Sprite";
import { attackMotion, fitSprite, hitMotion, screenDirection, smoothPosition, travelMotion, unitDirection } from "./battleMotion";

const WIDTH = 1200,
    HEIGHT = 480;
const serialFor = (unit: Unit, fallback: number) => Number(unit.id.replace(/\D/g, "")) || fallback;

export default function Battle({ state, data }: { state: GameState; data: GameData }) {
    const ref = useRef<HTMLCanvasElement>(null),
        latest = useRef(state),
        positions = useRef(new Map<string, Position>()),
        hitAreas = useRef<HitArea[]>([]),
        selection = useRef<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    latest.current = state;
    selection.current = selected;

    useEffect(() => {
        let raf: number,
            previousFrame = 0,
            lastSnapshot: GameState | null = null,
            clock = { serverAt: state.serverNow, receivedAt: performance.now() };
        const canvas = ref.current;
        if (!canvas) return;
        const context = canvas.getContext("2d");
        if (!context) return;
        const ctx = context,
            bg = getImage("/assets/background.png"),
            base = getImage("/assets/dolmen.png");
        const catalog = new Map(data.dinos.map((d) => [d.id, d]));
        const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");

        function draw(time: number) {
            const s = latest.current,
                you = s.you,
                elapsed = previousFrame ? time - previousFrame : 16;
            previousFrame = time;
            // A monotonic clock prevents local computer clock changes from replaying attacks.
            if (s !== lastSnapshot) {
                clock = { serverAt: s.serverNow, receivedAt: time };
                lastSnapshot = s;
            }
            const now = clock.serverAt + (time - clock.receivedAt),
                reducedMotion = motionPreference.matches;
            const scale = WIDTH / data.config.width,
                mirror = (world: number) => (you === 1 ? WIDTH - world * scale : world * scale);
            ctx.clearRect(0, 0, WIDTH, HEIGHT);
            if (bg.complete && bg.naturalWidth) ctx.drawImage(bg, 0, 0, WIDTH, HEIGHT);

            for (let side = 0; side < 2; side++) {
                const x = mirror(data.config.bases[side]),
                    dead = s.hp[side] <= 0;
                ctx.save();
                if (dead) {
                    ctx.globalAlpha = 0.35;
                    ctx.translate(x, 413);
                    ctx.rotate(side === you ? -0.18 : 0.18);
                    ctx.translate(-x, -413);
                }
                if (base.complete && base.naturalWidth) {
                    const sx = base.naturalWidth * 0.145,
                        sy = base.naturalHeight * 0.22,
                        sw = base.naturalWidth * 0.76,
                        sh = base.naturalHeight * 0.59;
                    const fitted = fitSprite(sw, sh, 152, 123);
                    ctx.drawImage(base, sx, sy, sw, sh, x - fitted.width / 2, 413 - fitted.height, fitted.width, fitted.height);
                }
                ctx.restore();
                ctx.fillStyle = "#38291f";
                ctx.font = 'bold 17px "Malgun Gothic",sans-serif';
                ctx.textAlign = "center";
                ctx.fillText(side === you ? "내 고인돌" : "상대 고인돌", x, 273);
            }

            const ids = new Set(s.units.map((u) => u.id));
            for (const key of positions.current.keys()) if (!ids.has(key)) positions.current.delete(key);
            if (selection.current && !ids.has(selection.current)) selection.current = null;
            const units = [...s.units].sort((a, b) => (serialFor(a, 0) % 5) - (serialFor(b, 0) % 5) || a.id.localeCompare(b.id));
            hitAreas.current = [];

            units.forEach((u, i) => {
                const d = catalog.get(u.type);
                if (!d) return;
                const previous = positions.current.get(u.id),
                    current = previous?.x ?? u.x;
                const smoothed = smoothPosition(current, u.x, elapsed, reducedMotion),
                    direction = screenDirection(unitDirection(u, s.units, data.config.bases), you);
                const hitAt = previous && u.hp < previous.hp ? now : (previous?.hitAt ?? 0);
                positions.current.set(u.id, { x: smoothed, hp: u.hp, hitAt, targetX: u.x });
                const serial = serialFor(u, i + 1),
                    x = mirror(smoothed) + ((serial % 3) - 1) * 4,
                    baseline = 398 + (serial % 5) * 7;
                const maxWidth = Math.min(170, d.size || 125),
                    maxHeight = 112,
                    im = getImage(d.image);
                const size = fitSprite((im.naturalWidth || maxWidth) * d.crop[2], (im.naturalHeight || maxHeight) * d.crop[3], maxWidth, maxHeight);
                const moving = !u.attacking && (Math.abs(u.x - current) > 0.08 || Math.abs(u.x - (previous?.targetX ?? u.x)) > 0.08);
                const travel = travelMotion({ now, serial, role: d.class, moving, reducedMotion });
                const attack = attackMotion({ attackAt: u.attackAt, now, role: d.class, direction, interval: d.interval, reducedMotion });
                const hit = hitMotion({ hitAt, now, direction, reducedMotion });
                const spriteX = x + (attack.x + hit.x) * scale,
                    spriteY = baseline + travel.y + attack.y;

                ctx.save();
                ctx.globalAlpha = 0.7;
                ctx.fillStyle = u.side === you ? "#e7e8d0" : "#59291e";
                ctx.beginPath();
                ctx.ellipse(x, baseline + 3, d.class === "flying" ? 17 : 21, 3, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
                ctx.save();
                ctx.translate(spriteX, spriteY);
                ctx.rotate(travel.rotation + attack.rotation);
                drawSprite(ctx, d, 0, 0, maxWidth, maxHeight, direction > 0);
                ctx.restore();

                hitAreas.current.push({ id: u.id, x: spriteX, y: spriteY - size.height / 2, width: Math.max(44, size.width), height: Math.max(44, size.height) });
                if (selection.current === u.id) {
                    ctx.strokeStyle = "#fff9e7";
                    ctx.lineWidth = 2;
                    ctx.strokeRect(spriteX - size.width / 2 - 3, spriteY - size.height - 3, size.width + 6, size.height + 6);
                }
                const hudY = spriteY - size.height - 12,
                    health = Math.max(0, Math.min(1, u.hp / d.hp));
                ctx.fillStyle = hit.highlight ? "#fff9e7" : "#493b32";
                ctx.fillRect(spriteX - 23, hudY - 1, 46, 8);
                ctx.fillStyle = "#493b32";
                ctx.fillRect(spriteX - 22, hudY, 44, 6);
                ctx.fillStyle = u.side === you ? "#dae7b0" : "#dc997d";
                ctx.fillRect(spriteX - 21, hudY + 1, 42 * health, 4);
                ctx.font = 'bold 11px "Malgun Gothic",sans-serif';
                ctx.textAlign = "center";
                if (selection.current === u.id) {
                    const label = `${d.name} #${serial}`,
                        labelWidth = ctx.measureText(label).width + 14;
                    const labelX = Math.max(labelWidth / 2 + 3, Math.min(WIDTH - labelWidth / 2 - 3, spriteX));
                    ctx.fillStyle = "#fff9e7";
                    ctx.fillRect(labelX - labelWidth / 2, hudY - 24, labelWidth, 18);
                    ctx.fillStyle = "#2d251d";
                    ctx.fillText(label, labelX, hudY - 11);
                } else {
                    ctx.fillStyle = "#2d251d";
                    ctx.fillText(`#${serial}`, spriteX, hudY - 6);
                }
            });
            raf = requestAnimationFrame(draw);
        }
        raf = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(raf);
    }, [data]);

    function inspect(e: MouseEvent<HTMLCanvasElement>) {
        const rect = e.currentTarget.getBoundingClientRect(),
            x = ((e.clientX - rect.left) / rect.width) * WIDTH,
            y = ((e.clientY - rect.top) / rect.height) * HEIGHT;
        const near = hitAreas.current.filter((u) => Math.abs(u.x - x) < u.width / 2 + 9 && Math.abs(u.y - y) < u.height / 2 + 9).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
        const old = near.findIndex((u) => u.id === selected);
        setSelected(near.length ? near[(old + 1) % near.length].id : null);
    }
    const unit = state.units.find((u) => u.id === selected),
        d = unit && data.dinos.find((d) => d.id === unit.type);
    return (
        <div className="battle-stage">
            <canvas ref={ref} width={WIDTH} height={HEIGHT} onClick={inspect} aria-label="실시간 공룡 전투. 내 진영은 왼쪽, 상대 진영은 오른쪽입니다." />
            <div className="battle-caption">
                {unit && d
                    ? `${unit.side === state.you ? "아군" : "상대"} ${d.name} · ${d.roleLabel || "돌격"} · 체력 ${Math.ceil(unit.hp)} / ${d.hp} · 공격 ${d.attack} · 사거리 ${d.range}`
                    : "전장의 공룡을 클릭하면 역할과 체력을 확인할 수 있어요. 겹친 공룡은 한 번 더 클릭해 선택하세요."}
            </div>
        </div>
    );
}
