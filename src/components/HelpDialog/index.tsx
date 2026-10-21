import css from "./styles.module.css";
import { useEffect } from "react";
import type { GameData } from "../../types";
import Sprite from "../Sprite";

type Props = {
    data: GameData | null;
    guide: boolean;
    encyclopedia: boolean;
    onClose: () => void;
};

export default function HelpDialog(props: Props) {
    const { data, guide, encyclopedia, onClose } = props;
    const dinosaurs = data?.dinos || [];

    useEffect(() => {
        const close = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        document.addEventListener("keydown", close);
        return () => document.removeEventListener("keydown", close);
    }, [onClose]);
    return (
        <div className={css["modal-backdrop"]} onClick={onClose}>
            <section
                className={`${css.modal} ${encyclopedia ? css["catalog-modal"] : ""}`}
                role="dialog"
                aria-modal="true"
                aria-label={guide ? "게임 방법" : "공룡 도감"}
                onClick={(e) => e.stopPropagation()}
            >
                <button className={css["modal-close"]} aria-label="닫기" onClick={onClose}>
                    ×
                </button>
                <h2>{guide ? "게임 방법" : "공룡 도감"}</h2>
                {guide ? (
                    <ol className={css["instructions"]}>
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
                    <div className={css["catalog-grid"]}>
                        {dinosaurs.map((d) => (
                            <article key={d.id}>
                                <Sprite className={css.sprite} d={d} />
                                <h3>
                                    {d.name} <span className={css["role-label"]}>{d.roleLabel}</span>
                                </h3>
                                <p className={css["role-description"]}>{d.role}</p>
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
    );
}
