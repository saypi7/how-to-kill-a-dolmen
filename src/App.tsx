import type { Ack, ConnectionStatus, GameData, GameState, Phase, Player, RequestEvent, RequestPayloads, Spawn } from "./types";
import { useEffect, useRef, useState } from "react";
import { Connection } from "./connection";
import Sprite, { preloadSprites } from "./Sprite";
import Battle from "./Battle";
import Title from "./Title";
import BackgroundMusic from "./BackgroundMusic";

const total = (p: Player | null | undefined) => Object.values(p?.inventory || {}).reduce((a, n) => a + n, 0);
function savedName() {
    try {
        return localStorage.getItem("dino-name") || "";
    } catch {
        return "";
    }
}
const statusText = { connecting: "서버 연결 중", connected: "서버 연결됨", disconnected: "재연결 중" };
function useClock(state: GameState | null) {
    const [now, setNow] = useState(Date.now()),
        offset = useRef(0);
    useEffect(() => {
        if (state) offset.current = state.serverNow - Date.now();
    }, [state]);
    useEffect(() => {
        const t = setInterval(() => setNow(Date.now() + offset.current), 80);
        return () => clearInterval(t);
    }, []);
    return now;
}
export default function App() {
    const [data, setData] = useState<GameData | null>(null),
        [state, setState] = useState<GameState | null>(null),
        [status, setStatus] = useState<ConnectionStatus>("connecting"),
        [error, setError] = useState(""),
        [name, setName] = useState(savedName),
        [code, setCode] = useState(""),
        [busy, setBusy] = useState(false),
        [readyBusy, setReadyBusy] = useState(false),
        [guide, setGuide] = useState(false),
        [encyclopedia, setEncyclopedia] = useState(false),
        [notice, setNotice] = useState(""),
        [loadError, setLoadError] = useState(false);
    const conn = useRef<Connection | null>(null),
        clicked = useRef(new Set<string>()),
        readyPending = useRef(false),
        enterPending = useRef(false);
    const now = useClock(state);
    useEffect(() => {
        clicked.current.clear();
    }, [state?.code]);
    async function loadData() {
        setLoadError(false);
        try {
            const r = await fetch("/game-data.json");
            if (!r.ok) throw Error();
            const result: GameData = await r.json();
            if (!result.config || !Array.isArray(result.dinos) || !result.dinos.length) throw Error();
            await preloadSprites(result.dinos);
            setData(result);
        } catch {
            setLoadError(true);
        }
    }
    useEffect(() => {
        loadData();
        const c = (conn.current = new Connection(setState, setStatus, setError));
        return () => c.close();
    }, []);
    useEffect(() => {
        if (!guide && !encyclopedia) return;
        const close = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setGuide(false);
                setEncyclopedia(false);
            }
        };
        document.addEventListener("keydown", close);
        return () => document.removeEventListener("keydown", close);
    }, [guide, encyclopedia]);
    useEffect(() => {
        if (error) {
            const t = setTimeout(() => setError(""), 6000);
            return () => clearTimeout(t);
        }
    }, [error]);
    useEffect(() => {
        if (notice) {
            const t = setTimeout(() => setNotice(""), 1100);
            return () => clearTimeout(t);
        }
    }, [notice]);
    async function send<E extends RequestEvent>(event: E, ...args: E extends "leave" ? [payload?: RequestPayloads[E]] : [payload: RequestPayloads[E]]): Promise<Pick<Ack, "ok" | "error">> {
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
    const me = state?.players[state.you],
        other = state?.players[1 - state.you],
        phase = state?.phase || "home",
        remaining = state ? Math.max(0, Math.ceil((state.endsAt - now) / 1000)) : 0;
    const dinosaurs = data?.dinos || [];
    const front = dinosaurs.filter((d) => ["tyranno", "tricera", "brachio"].includes(d.id));
    const heroes = front.length === 3 ? front : [dinosaurs[0], dinosaurs[3], dinosaurs[5]].filter(Boolean);
    return (
        <div className={`app phase-${phase}`}>
            <header className="topbar">
                <a href="#" className="wordmark" onClick={(e) => e.preventDefault()}>
                    How to Kill a Dolmen
                </a>
                <div className="top-actions">
                    <BackgroundMusic />
                    <button className="text-button" onClick={() => setEncyclopedia(true)}>
                        공룡 도감
                    </button>
                    <button className="text-button" onClick={() => setGuide(true)}>
                        게임 방법
                    </button>
                </div>
            </header>
            {!data ? (
                <main className="loading">
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
                        <main className="home-scene">
                            <div className="home-title">
                                <Title />
                                <p className="home-title-sub">공룡을 모으고, 살아남으세요!</p>
                            </div>
                            <section className="room-menu" aria-label="방 생성 또는 입장">
                                <h2>함께할 탐험가를 찾으세요</h2>
                                <label htmlFor="name">내 이름</label>
                                <input id="name" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} placeholder="탐험가 이름" autoComplete="nickname" />
                                <button className="primary" disabled={busy || status !== "connected"} onClick={() => enter("create")}>
                                    새 방 만들기
                                </button>
                                <div className="join-divider">
                                    <span>방 코드가 있다면</span>
                                </div>
                                <form
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        enter("join");
                                    }}
                                >
                                    <label htmlFor="code">친구의 방 코드</label>
                                    <div className="code-entry">
                                        <input id="code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} maxLength={8} placeholder="방 코드 입력" autoComplete="off" />
                                        <button type="submit" disabled={!code || busy || status !== "connected"}>
                                            입장
                                        </button>
                                    </div>
                                </form>
                                <p className="menu-note">
                                    2인 대전 · 수집 {Math.round(data.config.collectMs / 1000)}초 · 전투 {Math.round(data.config.battleMs / 1000)}초
                                </p>
                            </section>
                            <div className="home-dinos" aria-hidden="true">
                                {heroes.map((d, i) => (
                                    <Sprite key={d.id} d={d} flip={i === 0} className={`hero hero-${i}`} />
                                ))}
                            </div>
                            <p className="home-footnote">공룡을 클릭해 모으고, 상대의 고인돌을 무너뜨리세요.</p>
                        </main>
                    )}
                    {state && me && phase === "lobby" && (
                        <main className="lobby-scene">
                            <section className="lobby-content">
                                <p className="eyebrow">친구에게 이 코드를 알려 주세요</p>
                                <button className="room-code" title="방 코드 복사" onClick={copyCode}>
                                    {state.code}
                                    <small>복사</small>
                                </button>
                                <div className="players">
                                    {[0, 1].map((i) => (
                                        <div className="player-slot" key={i}>
                                            <Sprite d={dinosaurs[i === 0 ? 0 : 3]} flip={i === 0} />
                                            <h2>
                                                {state.players[i]?.name || "친구를 기다리는 중…"}
                                                {i === state.you && <small> 나</small>}
                                            </h2>
                                            <p>{!state.players[i] ? "방 코드로 입장해 주세요." : !state.players[i].connected ? "재연결을 기다리는 중…" : state.players[i].ready ? "준비 완료" : "준비 중"}</p>
                                        </div>
                                    ))}
                                </div>
                                <p>둘 다 준비하면 공룡 수집이 시작됩니다.</p>
                                <button className="primary ready-button" disabled={status !== "connected" || readyBusy} onClick={toggleReady}>
                                    {me.ready ? "준비 취소" : "준비 완료"}
                                </button>
                                <button className="text-button leave-button" onClick={leave}>
                                    방 나가기
                                </button>
                            </section>
                        </main>
                    )}
                    {state && me && (phase === "collect" || phase === "battle") && (
                        <main className="game-layout">
                            <div className="game-heading">
                                <div>
                                    <h1>{phase === "collect" ? "공룡을 찾아라!" : "고인돌을 지켜라!"}</h1>
                                    <p>{phase === "collect" ? "수풀에서 나타나는 공룡을 빠르게 클릭하세요." : "아래 공룡을 클릭해 소환하세요. 공룡은 자동으로 싸웁니다."}</p>
                                </div>
                                <div className={`timer ${remaining <= 10 ? "urgent" : ""}`}>
                                    <span>{phase === "collect" ? "수집 종료까지" : "전투 종료까지"}</span>
                                    <strong>
                                        {String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}
                                    </strong>
                                </div>
                            </div>
                            <div className="scoreboard">
                                <div>
                                    <b>
                                        {me.name} <small>나</small>
                                    </b>
                                    {phase === "collect" ? <span>수집 {total(me)}마리</span> : <Health hp={state.hp[state.you]} max={data.config.baseHp} />}
                                </div>
                                <span className="versus">VS</span>
                                <div>
                                    <b>{other?.name || "상대"}</b>
                                    {phase === "collect" ? <span>수집 {total(other)}마리</span> : <Health hp={state.hp[1 - state.you]} max={data.config.baseHp} enemy />}
                                </div>
                            </div>
                            {phase === "collect" ? (
                                <section className="collection-field" aria-label="공룡 수집장">
                                    <div className="bush-grid">
                                        {Array.from({ length: data.config.bushes }, (_, i) => {
                                            const spawn = (state.spawns || []).find((s) => s.bush === i && s.expiresAt > now);
                                            const d = spawn && dinosaurs.find((d) => d.id === spawn.type);
                                            return (
                                                <div className="bush-spot" key={i}>
                                                    {d && spawn && (
                                                        <button key={spawn.id} className="catch-target" aria-label={`${d.name} 수집`} onClick={() => catchDino(spawn)} disabled={status !== "connected"}>
                                                            <Sprite d={d} />
                                                            <span>{d.name}</span>
                                                        </button>
                                                    )}
                                                    <img className="bush" src="/assets/bush.png" alt="" draggable="false" />
                                                    <span className="spot-number">{i + 1}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="catch-notice" aria-live="polite">
                                        {notice}
                                    </div>
                                </section>
                            ) : (
                                <Battle state={state} data={data} />
                            )}
                            <Inventory data={data} me={me} phase={phase} disabled={status !== "connected"} summon={(type) => send("summon", { type })} />
                            <footer className="game-footer">
                                <span>
                                    방 {state.code}
                                    {other && !other.connected ? " · 상대가 재연결 중입니다. 잠시 후 부전승 처리됩니다." : ""}
                                </span>
                                <button className="text-button" onClick={leave}>
                                    기권하고 나가기
                                </button>
                            </footer>
                        </main>
                    )}
                    {state && phase === "result" && (
                        <main className="result-scene">
                            <section className="result-content">
                                <p className="eyebrow">대전 종료</p>
                                <h1>{state.winner === null ? "무승부!" : state.winner === state.you ? "생존 성공!" : "멸종했습니다..."}</h1>
                                <p>
                                    {state.reason === "time"
                                        ? "제한시간이 종료되었습니다."
                                        : state.reason === "disconnect"
                                          ? state.winner === null
                                              ? "연결이 종료되어 대전이 끝났습니다."
                                              : state.winner === state.you
                                                ? "상대의 연결이 종료되었습니다."
                                                : "내 연결이 종료되어 대전에서 패배했습니다."
                                          : state.reason === "leave"
                                            ? "한 플레이어가 대전을 떠났습니다."
                                            : "고인돌이 무너졌습니다."}
                                </p>
                                <div className="result-art">
                                    {state.winner === state.you ? <Sprite d={dinosaurs.find((d) => d.id === state.units.find((u) => u.side === state.you)?.type) || dinosaurs[0]} flip /> : <img src="/assets/dolmen.png" alt="고인돌" />}
                                </div>
                                <div className="result-score">
                                    {state.players.map((p, i) => (
                                        <div key={i}>
                                            <b>{p?.name || "떠난 탐험가"}</b>
                                            <span>
                                                고인돌 체력 {state.hp[i]} / {data.config.baseHp}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                {state.winner !== null && state.winner !== state.you && <p>내 공룡들이 모두 멸종했습니다.</p>}
                                <button className="primary" onClick={leave} disabled={status !== "connected"}>
                                    처음으로 돌아가기
                                </button>
                                <p className="result-note">새 방을 만들어 다시 도전할 수 있어요.</p>
                            </section>
                        </main>
                    )}
                </>
            )}
            {status !== "connected" && (
                <div className="connection-banner" role="status">
                    {status === "connecting" ? "게임에 연결하고 있습니다." : "연결이 끊겨 다시 연결하고 있습니다. 잠시 기다려 주세요."}
                </div>
            )}
            {error && (
                <div className="error-toast" role="alert">
                    {error}
                    <button aria-label="닫기" onClick={() => setError("")}>
                        ×
                    </button>
                </div>
            )}
            {notice && phase !== "collect" && (
                <div className="small-toast" role="status">
                    {notice}
                </div>
            )}
            {(guide || encyclopedia) && (
                <div
                    className="modal-backdrop"
                    onClick={() => {
                        setGuide(false);
                        setEncyclopedia(false);
                    }}
                >
                    <section className={`modal ${encyclopedia ? "catalog-modal" : ""}`} role="dialog" aria-modal="true" aria-label={guide ? "게임 방법" : "공룡 도감"} onClick={(e) => e.stopPropagation()}>
                        <button
                            className="modal-close"
                            aria-label="닫기"
                            onClick={() => {
                                setGuide(false);
                                setEncyclopedia(false);
                            }}
                        >
                            ×
                        </button>
                        <h2>{guide ? "게임 방법" : "공룡 도감"}</h2>
                        {guide ? (
                            <ol className="instructions">
                                <li>
                                    <b>친구와 같은 방에 입장</b>
                                    <p>방을 만들고 코드를 공유하세요. 둘 다 준비하면 시작됩니다.</p>
                                </li>
                                <li>
                                    <b>{Math.round((data?.config.collectMs || 30000) / 1000)}초 동안 공룡 수집</b>
                                    <p>수풀에서 잠깐 나타나는 공룡을 클릭하세요. 같은 공룡도 여러 마리 모을 수 있습니다.</p>
                                </li>
                                <li>
                                    <b>공룡 소환, 고인돌 방어</b>
                                    <p>아래 목록을 클릭하면 한 마리씩 출전합니다. 상대 고인돌을 먼저 무너뜨리면 승리합니다.</p>
                                </li>
                                <li>
                                    <b>{Math.round((data?.config.battleMs || 90000) / 1000)}초 후에도 버텼다면</b>
                                    <p>고인돌의 남은 체력이 높은 쪽이 승리합니다. 체력이 같으면 무승부입니다.</p>
                                </li>
                            </ol>
                        ) : (
                            <div className="catalog-grid">
                                {dinosaurs.map((d) => (
                                    <article key={d.id}>
                                        <Sprite d={d} />
                                        <h3>
                                            {d.name} <span className="role-label">{d.roleLabel}</span>
                                        </h3>
                                        <p className="role-description">{d.role}</p>
                                        <p>
                                            체력 {d.hp} · 공격 {d.attack}
                                        </p>
                                        <p>
                                            공격 간격 {(d.interval / 1000).toFixed(2)}초 · 이동 {d.speed}
                                        </p>
                                        <p>
                                            사거리 {d.range} · 등장 확률 {((100 * d.weight) / dinosaurs.reduce((a, d) => a + d.weight, 0)).toFixed(1)}%
                                        </p>
                                    </article>
                                ))}
                            </div>
                        )}
                    </section>
                </div>
            )}
        </div>
    );
}
function Health({ hp, max, enemy = false }: { hp: number; max: number; enemy?: boolean }) {
    return (
        <div className={`base-health ${enemy ? "enemy" : ""}`}>
            <div className="health-track">
                <div style={{ width: `${Math.max(0, hp / max) * 100}%` }} />
            </div>
            <span>
                {hp} / {max}
            </span>
        </div>
    );
}
function Inventory({ data, me, phase, disabled, summon }: { data: GameData; me: Player; phase: Phase; disabled: boolean; summon: (type: string) => Promise<Pick<Ack, "ok" | "error">> }) {
    const [pending, setPending] = useState(false),
        locked = useRef(false),
        mounted = useRef(true),
        timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(
        () => () => {
            mounted.current = false;
            clearTimeout(timer.current);
        },
        []
    );
    async function request(type: string) {
        if (locked.current || disabled || phase !== "battle") return;
        locked.current = true;
        setPending(true);
        const started = performance.now();
        try {
            await summon(type);
        } finally {
            if (mounted.current)
                timer.current = setTimeout(
                    () => {
                        locked.current = false;
                        setPending(false);
                    },
                    Math.max(0, data.config.summonCooldown - (performance.now() - started))
                );
        }
    }
    const owned = data.dinos.filter((d) => me.inventory[d.id] > 0);
    return (
        <section className="inventory">
            <div className="inventory-label">
                <h2>
                    내 공룡 <span>{total(me)}마리</span>
                </h2>
                <span>{phase === "collect" ? "수집한 공룡은 전투에서 소환할 수 있어요." : "클릭할 때마다 1마리 소환"}</span>
            </div>
            <div className="inventory-scroll">
                {owned.length ? (
                    owned.map((d) => (
                        <button
                            className="dino-card"
                            key={d.id}
                            disabled={disabled || pending || phase !== "battle"}
                            onClick={() => request(d.id)}
                            aria-label={`${d.name} 소환, ${d.roleLabel}, ${me.inventory[d.id]}마리 보유`}
                            title={`${d.roleLabel} · ${d.role}\n체력 ${d.hp}, 공격력 ${d.attack}, 공격간격 ${d.interval / 1000}초, 이동 ${d.speed}, 사거리 ${d.range}`}
                        >
                            <Sprite d={d} flip />
                            <strong>{d.name}</strong>
                            <span className="quantity">×{me.inventory[d.id]}</span>
                            <span className="unit-role">{d.roleLabel}</span>
                            <small>
                                체력 {d.hp} · 공격 {d.attack}
                            </small>
                        </button>
                    ))
                ) : (
                    <p className="empty-inventory">{phase === "collect" ? "수풀의 공룡을 클릭해 첫 공룡을 모아 보세요." : "남은 공룡이 없습니다. 전장에서 싸우는 공룡들을 응원해 주세요."}</p>
                )}
            </div>
        </section>
    );
}
