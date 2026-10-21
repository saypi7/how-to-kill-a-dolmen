import css from "./styles.module.css";
import type { ConnectionStatus, GameData, GameState, Spawn } from "../../types";
import Sprite from "../Sprite";

type Props = {
    data: GameData;
    state: GameState;
    now: number;
    status: ConnectionStatus;
    notice: string;
    catchDino: (spawn: Spawn) => Promise<void>;
};

export default function CollectionField(props: Props) {
    const { data, state, now, status, notice, catchDino } = props;
    const dinosaurs = data.dinos;
    return (
        <section className={css["collection-field"]} aria-label="공룡 수집장">
            <div className={css["bush-grid"]}>
                {Array.from({ length: data.config.bushes }, (_, i) => {
                    const spawn = (state.spawns || []).find((s) => s.bush === i && s.expiresAt > now);
                    const d = spawn && dinosaurs.find((d) => d.id === spawn.type);
                    return (
                        <div className={css["bush-spot"]} key={i}>
                            {d && spawn && (
                                <button
                                    key={spawn.id}
                                    className={css["catch-target"]}
                                    aria-label={`${d.name} 수집`}
                                    onClick={() => catchDino(spawn)}
                                    disabled={status !== "connected"}
                                >
                                    <Sprite className={css.sprite} d={d} />
                                    <span>{d.name}</span>
                                </button>
                            )}
                            <img className={css["bush"]} src="/assets/bush.png" alt="" draggable="false" />
                            <span className={css["spot-number"]}>{i + 1}</span>
                        </div>
                    );
                })}
            </div>
            <div className={css["catch-notice"]} aria-live="polite">
                {notice}
            </div>
        </section>
    );
}
