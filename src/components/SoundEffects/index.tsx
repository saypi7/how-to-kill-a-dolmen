import { useEffect, useRef, useState } from "react";
import type { GameState } from "../../types";
import { gameSounds } from "../../modules/sound";
import { soundEvents } from "../../modules/soundEvents";
import css from "./styles.module.css";

export default function SoundEffects({ state }: { state: GameState | null }) {
    const [muted, setMuted] = useState(gameSounds.muted);
    const previous = useRef<GameState | null>(null);
    useEffect(() => {
        document.addEventListener("pointerdown", gameSounds.unlock);
        document.addEventListener("keydown", gameSounds.unlock);
        return () => {
            document.removeEventListener("pointerdown", gameSounds.unlock);
            document.removeEventListener("keydown", gameSounds.unlock);
        };
    }, []);
    useEffect(() => {
        if (state) for (const cue of soundEvents(previous.current, state)) gameSounds.play(cue);
        previous.current = state;
    }, [state]);
    return (
        <button
            className={css.sound}
            aria-pressed={!muted}
            onClick={() => {
                gameSounds.setMuted(!muted);
                setMuted(!muted);
            }}
            title="효과음 켜기 또는 끄기"
        >
            효과음 {muted ? "꺼짐" : "켜짐"}
        </button>
    );
}
