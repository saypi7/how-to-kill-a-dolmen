import { useEffect, useRef, useState } from "react";
import type { GameState } from "../types";

export default function useClock(state: GameState | null) {
    const [now, setNow] = useState(Date.now());
    const offset = useRef(0);
    useEffect(() => {
        if (state) offset.current = state.serverNow - Date.now();
    }, [state]);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now() + offset.current), 80);
        return () => clearInterval(timer);
    }, []);
    return now;
}
