import css from "./styles.module.css";
import type { Ack, ConnectionStatus, GameData, GameState, Player, Spawn } from "../../types";
import Battle from "../../components/Battle";
import CollectionField from "../../components/CollectionField";
import Health from "../../components/Health";
import Inventory from "../../components/Inventory";
import { total } from "../../modules/game";

type Props = {
    data: GameData;
    state: GameState;
    me: Player;
    status: ConnectionStatus;
    now: number;
    notice: string;
    catchDino: (spawn: Spawn) => Promise<void>;
    summon: (type: string) => Promise<Pick<Ack, "ok" | "error">>;
    leave: () => Promise<void>;
};

export default function Page(props: Props) {
    const { data, state, me, status, now, notice, catchDino, summon, leave } = props;
    const phase = state.phase;
    const other = state.players[1 - state.you];
    const remaining = Math.max(0, Math.ceil((state.endsAt - now) / 1000));
    return (
        <main className={css["game-layout"]}>
            <div className={css["game-heading"]}>
                <div>
                    <h1>{phase === "collect" ? "공룡을 찾아라!" : "고인돌을 지켜라!"}</h1>
                    <p>{phase === "collect" ? "수풀에서 나타나는 공룡을 빠르게 클릭하세요." : "아래 공룡을 클릭해 소환하세요. 공룡은 자동으로 싸웁니다."}</p>
                </div>
                <div className={`${css.timer} ${remaining <= 10 ? css.urgent : ""}`}>
                    <span>{phase === "collect" ? "수집 종료까지" : "전투 종료까지"}</span>
                    <strong>
                        {String(Math.floor(remaining / 60)).padStart(2, "0")}:{String(remaining % 60).padStart(2, "0")}
                    </strong>
                </div>
            </div>
            <div className={css["scoreboard"]}>
                <div>
                    <b>
                        {me.name} <small>나</small>
                    </b>
                    {phase === "collect" ? <span>수집 {total(me)}마리</span> : <Health hp={state.hp[state.you]} max={data.config.baseHp} />}
                </div>
                <span className={css["versus"]}>VS</span>
                <div>
                    <b>{other?.name || "상대"}</b>
                    {phase === "collect" ? <span>수집 {total(other)}마리</span> : <Health hp={state.hp[1 - state.you]} max={data.config.baseHp} enemy />}
                </div>
            </div>
            {phase === "collect" ? (
                <CollectionField data={data} state={state} now={now} status={status} notice={notice} catchDino={catchDino} />
            ) : (
                <Battle state={state} data={data} />
            )}
            <Inventory data={data} me={me} phase={phase} disabled={status !== "connected"} summon={summon} />
            <footer className={css["game-footer"]}>
                <span>
                    방 {state.code}
                    {other && !other.connected ? " · 상대가 재연결 중입니다. 잠시 후 부전승 처리됩니다." : ""}
                </span>
                <button className={css["text-button"]} onClick={leave}>
                    기권하고 나가기
                </button>
            </footer>
        </main>
    );
}
