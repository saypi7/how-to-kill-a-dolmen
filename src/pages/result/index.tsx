import css from "./styles.module.css";
import { resultMessage } from "../../modules/game";
import type { ConnectionStatus, GameData, GameState } from "../../types";
import Sprite from "../../components/Sprite";

type Props = {
    data: GameData;
    state: GameState;
    status: ConnectionStatus;
    leave: () => Promise<void>;
};

export default function Page(props: Props) {
    const { data, state, status, leave } = props;
    const dinosaurs = data.dinos;
    return (
        <main className={css["result-scene"]}>
            <section className={css["result-content"]}>
                <p className={css["eyebrow"]}>대전 종료</p>
                <h1>{state.winner === null ? "무승부!" : state.winner === state.you ? "생존 성공!" : "멸종했습니다..."}</h1>
                <p>{resultMessage(state)}</p>
                <div className={css["result-art"]}>
                    {state.winner === state.you ? (
                        <Sprite
                            className={css.sprite}
                            d={dinosaurs.find((d) => d.id === state.units.find((u) => u.side === state.you)?.type) || dinosaurs[0]}
                            flip
                        />
                    ) : (
                        <img src="/assets/dolmen.png" alt="고인돌" />
                    )}
                </div>
                <div className={css["result-score"]}>
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
                <button className={css["primary"]} onClick={leave} disabled={status !== "connected"}>
                    처음으로 돌아가기
                </button>
            </section>
        </main>
    );
}
