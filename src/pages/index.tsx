import css from "./styles.module.css";
import type { Ack, ConnectionStatus, GameData, GameState, RequestEvent, RequestPayloads, Spawn } from "../types";
import { useCallback, useEffect, useRef, useState } from "react";
import { Connection } from "../modules/connection";
import { preloadSprites } from "../modules/sprites";
import BackgroundMusic from "../components/BackgroundMusic";
import Home from "./home";
import Lobby from "./lobby";
import Game from "./game";
import Result from "./result";
import HelpDialog from "../components/HelpDialog";
import useClock from "../modules/useClock";

function savedName() {
    try {
        return localStorage.getItem("dino-name") || "";
    } catch {
        return "";
    }
}
export default function Page() {
    const [data, setData] = useState<GameData | null>(null);
    const [state, setState] = useState<GameState | null>(null);
    const [status, setStatus] = useState<ConnectionStatus>("connecting");
    const [error, setError] = useState("");
    const [name, setName] = useState(savedName);
    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(false);
    const [readyBusy, setReadyBusy] = useState(false);
    const [guide, setGuide] = useState(false);
    const [encyclopedia, setEncyclopedia] = useState(false);
    const [notice, setNotice] = useState("");
    const [loadError, setLoadError] = useState(false);
    const conn = useRef<Connection | null>(null);
    const clicked = useRef(new Set<string>());
    const readyPending = useRef(false);
    const enterPending = useRef(false);
    const now = useClock(state);
    const closeDialog = useCallback(() => {
        setGuide(false);
        setEncyclopedia(false);
    }, []);
    useEffect(() => {
        clicked.current.clear();
    }, [state?.code]);
    async function loadData() {
        setLoadError(false);
        try {
            const response = await fetch("/game-data.json");
            if (!response.ok) throw new Error();
            const result: GameData = await response.json();
            if (!result.config || !Array.isArray(result.dinos) || !result.dinos.length) throw Error();
            await preloadSprites(result.dinos);
            setData(result);
        } catch {
            setLoadError(true);
        }
    }
    useEffect(() => {
        loadData();
        const connection = new Connection(setState, setStatus, setError);
        conn.current = connection;
        return () => connection.close();
    }, []);
    useEffect(() => {
        if (error) {
            const timer = setTimeout(() => setError(""), 6000);
            return () => clearTimeout(timer);
        }
    }, [error]);
    useEffect(() => {
        if (notice) {
            const timer = setTimeout(() => setNotice(""), 1100);
            return () => clearTimeout(timer);
        }
    }, [notice]);
    async function send<E extends RequestEvent>(
        event: E,
        ...args: E extends "leave" ? [payload?: RequestPayloads[E]] : [payload: RequestPayloads[E]]
    ): Promise<Pick<Ack, "ok" | "error">> {
        try {
            if (!conn.current) throw new Error("서버 연결을 기다려 주세요.");
            const ack = await conn.current.send(event, ...args);
            if (!ack.ok && ack.error) setError(ack.error);
            return ack;
        } catch (e) {
            setError(e instanceof Error ? e.message : "요청을 처리하지 못했습니다.");
            return { ok: false };
        }
    }
    async function enter(event: "create" | "join") {
        if (enterPending.current || status !== "connected") return;
        enterPending.current = true;
        setBusy(true);
        try {
            try {
                localStorage.setItem("dino-name", name.trim() || "탐험가");
            } catch {}
            await send(event, { name: name.trim() || "탐험가", code });
        } finally {
            enterPending.current = false;
            setBusy(false);
        }
    }
    async function leave() {
        const ack = await send("leave");
        if (ack.ok) {
            setState(null);
            clicked.current.clear();
        }
    }
    async function toggleReady() {
        if (readyPending.current || !state) return;
        readyPending.current = true;
        setReadyBusy(true);
        try {
            await send("ready", { ready: !state.players[state.you]?.ready });
        } finally {
            readyPending.current = false;
            setReadyBusy(false);
        }
    }
    async function copyCode() {
        if (!state) return;
        try {
            if (!navigator.clipboard) throw Error();
            await navigator.clipboard.writeText(state.code);
            setNotice("방 코드를 복사했어요.");
        } catch {
            setNotice(`방 코드: ${state.code}`);
        }
    }
    async function catchDino(spawn: Spawn) {
        if (!data) return;
        if (clicked.current.has(spawn.id) || status !== "connected") return;
        clicked.current.add(spawn.id);
        const ack = await send("collect", { id: spawn.id });
        if (ack.ok) {
            setNotice(`${data.dinos.find((d) => d.id === spawn.type)?.name} 수집!`);
        } else if (!ack.error) {
            setNotice("조금 늦었어요!");
        }
    }
    const me = state?.players[state.you];
    const phase = state?.phase || "home";

    return (
        <div className={css.app} data-phase={phase}>
            <header className={css["topbar"]}>
                <a href="#" className={css["wordmark"]} onClick={(e) => e.preventDefault()}>
                    How to Kill a Dolmen
                </a>
                <div className={css["top-actions"]}>
                    <BackgroundMusic />
                    <button className={css["text-button"]} onClick={() => setEncyclopedia(true)}>
                        공룡 도감
                    </button>
                    <button className={css["text-button"]} onClick={() => setGuide(true)}>
                        게임 방법
                    </button>
                </div>
            </header>
            {!data ? (
                <main className={css["loading"]}>
                    {loadError ? (
                        <>
                            <p>공룡 데이터나 이미지를 불러오지 못했습니다.</p>
                            <button onClick={loadData}>다시 불러오기</button>
                        </>
                    ) : (
                        "공룡들을 불러오는 중…"
                    )}
                </main>
            ) : (
                <>
                    {phase === "home" && (
                        <Home data={data} status={status} name={name} code={code} busy={busy} setName={setName} setCode={setCode} enter={enter} />
                    )}
                    {state && me && phase === "lobby" && (
                        <Lobby
                            data={data}
                            state={state}
                            me={me}
                            status={status}
                            readyBusy={readyBusy}
                            copyCode={copyCode}
                            toggleReady={toggleReady}
                            leave={leave}
                        />
                    )}
                    {state && me && (phase === "collect" || phase === "battle") && (
                        <Game
                            data={data}
                            state={state}
                            me={me}
                            status={status}
                            now={now}
                            notice={notice}
                            catchDino={catchDino}
                            summon={(type) => send("summon", { type })}
                            leave={leave}
                        />
                    )}
                    {state && phase === "result" && <Result data={data} state={state} status={status} leave={leave} />}
                </>
            )}
            {status !== "connected" && (
                <div className={css["connection-banner"]} role="status">
                    {status === "connecting" ? "게임에 연결하고 있습니다." : "연결이 끊겨 다시 연결하고 있습니다. 잠시 기다려 주세요."}
                </div>
            )}
            {error && (
                <div className={css["error-toast"]} role="alert">
                    {error}
                    <button aria-label="닫기" onClick={() => setError("")}>
                        ×
                    </button>
                </div>
            )}
            {notice && phase !== "collect" && (
                <div className={css["small-toast"]} role="status">
                    {notice}
                </div>
            )}
            {(guide || encyclopedia) && <HelpDialog data={data} guide={guide} encyclopedia={encyclopedia} onClose={closeDialog} />}
        </div>
    );
}
