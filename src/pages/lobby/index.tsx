import css from "./styles.module.css";
import controls from "../../components/controls.module.css";
import { playerStatus } from "../../modules/game";
import type { ConnectionStatus, GameData, GameState, Player } from "../../types";
import Sprite from "../../components/Sprite";

type Props = {
    data: GameData;
    state: GameState;
    me: Player;
    status: ConnectionStatus;
    readyBusy: boolean;
    copyCode: () => Promise<void>;
    toggleReady: () => Promise<void>;
    leave: () => Promise<void>;
};

export default function Page(props: Props) {
    const { data, state, me, status, readyBusy, copyCode, toggleReady, leave } = props;
    const dinosaurs = data.dinos;
    return (
        <main className={css["lobby-scene"]}>
            <section className={css["lobby-content"]}>
                <p className={controls["eyebrow"]}>친구에게 이 코드를 알려 주세요</p>
                <button className={css["room-code"]} title="방 코드 복사" onClick={copyCode}>
                    {state.code}
                    <small>복사</small>
                </button>
                <div className={css["players"]}>
                    {[0, 1].map((i) => (
                        <div className={css["player-slot"]} key={i}>
                            <Sprite className={css.sprite} d={dinosaurs[i === 0 ? 0 : 3]} flip={i === 0} />
                            <h2>
                                {state.players[i]?.name || "친구를 기다리는 중…"}
                                {i === state.you && <small> 나</small>}
                            </h2>
                            <p>{playerStatus(state.players[i])}</p>
                        </div>
                    ))}
                </div>
                <p>둘 다 준비하면 공룡 수집이 시작됩니다.</p>
                <button className={`${controls["primary"]} ${css["ready-button"]}`} disabled={status !== "connected" || readyBusy} onClick={toggleReady}>
                    {me.ready ? "준비 취소" : "준비 완료"}
                </button>
                <button className={`${controls["text-button"]} ${css["leave-button"]}`} onClick={leave}>
                    방 나가기
                </button>
            </section>
        </main>
    );
}
