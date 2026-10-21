import css from "./styles.module.css";
import { useEffect, useRef, useState } from "react";
import type { Ack, GameData, Phase, Player } from "../../types";
import Sprite from "../Sprite";
import { total } from "../../modules/game";

type Props = {
    data: GameData;
    me: Player;
    phase: Phase;
    disabled: boolean;
    summon: (type: string) => Promise<Pick<Ack, "ok" | "error">>;
};

export default function Inventory(props: Props) {
    const { data, me, phase, disabled, summon } = props;
    const [pending, setPending] = useState(false);
    const locked = useRef(false);
    const mounted = useRef(true);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
        <section className={css["inventory"]}>
            <div className={css["inventory-label"]}>
                <h2>
                    내 공룡 <span>{total(me)}마리</span>
                </h2>
                <span>{phase === "collect" ? "수집한 공룡은 전투에서 소환할 수 있어요." : ""}</span>
            </div>
            <div className={css["inventory-scroll"]}>
                {owned.length ? (
                    owned.map((d) => (
                        <button
                            className={css["dino-card"]}
                            key={d.id}
                            disabled={disabled || pending || phase !== "battle"}
                            onClick={() => request(d.id)}
                            aria-label={`${d.name} 소환, ${d.roleLabel}, ${me.inventory[d.id]}마리 보유`}
                            title={`${d.roleLabel} · ${d.role}\n체력 ${d.hp}, 공격력 ${d.attack}, 공격간격 ${d.interval / 1000}초, 이동 ${d.speed}, 사거리 ${d.range}`}
                        >
                            <Sprite className={css.sprite} d={d} flip />
                            <strong>{d.name}</strong>
                            <span className={css["quantity"]}>×{me.inventory[d.id]}</span>
                            <span className={css["unit-role"]}>{d.roleLabel}</span>
                            <small>
                                체력 {d.hp} · 공격 {d.attack}
                            </small>
                        </button>
                    ))
                ) : (
                    <p className={css["empty-inventory"]}>
                        {phase === "collect" ? "수풀의 공룡을 클릭해 첫 공룡을 모아 보세요." : "남은 공룡이 없습니다. 전장에서 싸우는 공룡들을 응원해 주세요."}
                    </p>
                )}
            </div>
        </section>
    );
}
