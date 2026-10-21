import css from "./styles.module.css";
import { useEffect, useRef, useState } from "react";

function savedVolume() {
    try {
        const saved = localStorage.getItem("dino-music-volume");
        const volume = saved === null ? 0.3 : Number(saved);
        if (Number.isFinite(volume)) return Math.min(1, Math.max(0, volume));
    } catch {}
    return 0.3;
}

export default function BackgroundMusic() {
    const [volume, setVolume] = useState(savedVolume);
    const audio = useRef<HTMLAudioElement | null>(null);
    const currentVolume = useRef(volume);

    useEffect(() => {
        const music = new Audio("/assets/unmashed_potato.ogg");
        music.loop = true;
        music.volume = currentVolume.current;
        audio.current = music;
        const play = () => {
            if (music.paused)
                void music.play().catch(() => {
                    // Autoplay may be blocked; retry on the next user interaction.
                });
        };
        play();
        document.addEventListener("pointerdown", play);
        document.addEventListener("keydown", play);
        return () => {
            document.removeEventListener("pointerdown", play);
            document.removeEventListener("keydown", play);
            music.pause();
            music.removeAttribute("src");
            music.load();
            audio.current = null;
        };
    }, []);

    return (
        <input
            className={css["music-volume"]}
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(volume * 100)}
            aria-label="배경음 볼륨"
            aria-valuetext={`${Math.round(volume * 100)}%`}
            title={`배경음 볼륨 ${Math.round(volume * 100)}%`}
            onChange={(event) => {
                const next = Number(event.target.value) / 100;
                currentVolume.current = next;
                setVolume(next);
                if (audio.current) audio.current.volume = next;
                try {
                    localStorage.setItem("dino-music-volume", String(next));
                } catch {}
            }}
        />
    );
}
