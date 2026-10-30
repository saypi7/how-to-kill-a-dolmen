import { useEffect, useRef } from "react";
import type { GameState } from "../../types";
import { countdownNumber } from "../../modules/countdown";
import { gameSounds } from "../../modules/sound";
import css from "./styles.module.css";

function NumberDrawing({ number }: { number: 1 | 2 | 3 }) {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const image = new Image(),
            canvas = ref.current!,
            ctx = canvas.getContext("2d")!;
        const draw = () => {
            const width = image.naturalWidth / 3,
                height = image.naturalHeight;
            const scale = Math.min(290 / width, 245 / height),
                w = width * scale,
                h = height * scale;
            ctx.clearRect(0, 0, 320, 270);
            ctx.drawImage(image, (3 - number) * width, 0, width, height, (320 - w) / 2, (270 - h) / 2, w, h);
        };
        image.onload = draw;
        image.onerror = () => {
            ctx.font = 'bold 200px "parkdahyeon",sans-serif';
            ctx.textAlign = "center";
            ctx.fillStyle = "#503527";
            ctx.fillText(String(number), 160, 215);
        };
        image.src = "/assets/ui/countdown.png";
        return () => {
            image.onload = null;
            image.onerror = null;
        };
    }, [number]);
    return <canvas className={css.number} key={number} ref={ref} width={320} height={270} aria-label={String(number)} role="img" />;
}

export default function Countdown({ state, now }: { state: GameState; now: number }) {
    const number = countdownNumber(state.endsAt, now);
    const battle = state.nextPhase === "battle";
    useEffect(() => {
        gameSounds.play("tick");
    }, [number]);
    return (
        <main className={css.scene}>
            <section className={css.content} aria-label={battle ? "전투 시작 카운트다운" : "수집 시작 카운트다운"}>
                <h1>{battle ? "고인돌을 지킬 시간!" : "공룡을 찾아라!"}</h1>
                <p>{battle ? "모은 공룡들이 출전할 준비를 하고 있어요." : "수풀을 잘 봐 두세요. 잠깐 나타났다가 숨어요."}</p>
                <NumberDrawing number={number} />
                <div className={css.names}>
                    <span>{state.players[state.you]?.name}</span>
                    <span>VS</span>
                    <span>{state.players[1 - state.you]?.name}</span>
                </div>
                <p className={css.hint} role="status" aria-live="polite">
                    {number}초 후 {battle ? "전투" : "수집"} 시작
                </p>
            </section>
            <img className={css.stoneLeft} src="/assets/dolmen.png" alt="" />
            <img className={css.stoneRight} src="/assets/dolmen.png" alt="" />
        </main>
    );
}
