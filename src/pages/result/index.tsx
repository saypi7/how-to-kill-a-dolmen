import css from "./styles.module.css";
import { canRematch, resultMessage } from "../../modules/game";
import type { ConnectionStatus, GameData, GameState, Player } from "../../types";

type Props = { data: GameData; state: GameState; status: ConnectionStatus; leave: () => Promise<void>; rematch: () => Promise<void>; rematchBusy: boolean };
const metrics: { key: keyof Pick<Player, "collected" | "summoned" | "kills" | "baseDamage">; label: string; unit: string }[] = [
    { key: "collected", label: "수집한 공룡", unit: "마리" },
    { key: "summoned", label: "출전한 공룡", unit: "마리" },
    { key: "kills", label: "쓰러뜨린 공룡", unit: "마리" },
    { key: "baseDamage", label: "고인돌에 준 피해", unit: "" }
];
export default function Result({ data, state, status, leave, rematch, rematchBusy }: Props) {
    const me = state.players[state.you],
        opponent = state.players[1 - state.you];
    const outcome = state.winner === null ? "draw" : state.winner === state.you ? "win" : "lose";
    const canPlay = status === "connected" && canRematch(state);
    const message = opponent?.left
        ? "상대가 방을 나갔어요. 처음 화면에서 새 방을 만들 수 있어요."
        : !opponent?.connected
          ? "상대의 재연결을 기다리고 있어요."
          : me?.rematchReady
            ? "신청했어요. 상대도 누르면 같은 방에서 바로 시작해요."
            : opponent.rematchReady
              ? "상대가 한 판 더 기다리고 있어요!"
              : "모은 공룡은 새로 시작해요. 방 코드는 그대로예요.";
    return (
        <main className={css.scene}>
            <section className={css.content} aria-label="대전 결과">
                <h1>{outcome === "win" ? "생존 성공!" : outcome === "lose" ? "멸종했습니다..." : "무승부!"}</h1>
                <p className={css.reason}>{resultMessage(state)}</p>
                <div className={css.summary}>
                    <div className={css.art}>
                        <img src={`/assets/ui/result-${outcome}.png`} alt={outcome === "win" ? "고인돌 옆에서 기뻐하는 공룡" : outcome === "lose" ? "무너진 고인돌 옆에 주저앉은 공룡" : "고인돌에 기대어 쉬는 두 공룡"} />
                        <p>{outcome === "win" ? "고인돌을 지켜냈어요." : outcome === "lose" ? "내 공룡들이 모두 멸종했어요." : "둘 다 끝까지 버텼어요."}</p>
                    </div>
                    <table className={css.record}>
                        <caption>이번 판 기록</caption>
                        <thead>
                            <tr>
                                <th scope="col">기록</th>
                                {[state.you, 1 - state.you].map((side) => (
                                    <th scope="col" key={side}>
                                        {state.players[side]?.name || "떠난 탐험가"}
                                        {side === state.you && <small>나</small>}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {metrics.map((metric) => (
                                <tr key={metric.key}>
                                    <th scope="row">{metric.label}</th>
                                    {[state.you, 1 - state.you].map((side) => (
                                        <td key={side}>
                                            {state.players[side]?.[metric.key] || 0}
                                            <small>{metric.unit}</small>
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr>
                                <th scope="row">남은 고인돌 체력</th>
                                {[state.you, 1 - state.you].map((side) => (
                                    <td key={side}>
                                        {state.hp[side]}
                                        <small> / {data.config.baseHp}</small>
                                    </td>
                                ))}
                            </tr>
                        </tfoot>
                    </table>
                </div>
                <div className={css.rematch}>
                    <button className={css.again} disabled={!canPlay || rematchBusy} onClick={rematch} aria-pressed={!!me?.rematchReady}>
                        {rematchBusy ? "신청 확인 중…" : me?.rematchReady ? "재대결 신청 취소" : "한 판 더!"}
                    </button>
                    <p className={css.waiting} role="status" aria-live="polite">
                        {message}
                    </p>
                    {canPlay && (
                        <div className={css.consent} aria-label="재대결 준비 상태">
                            {[state.you, 1 - state.you].map((side) => (
                                <span key={side}>
                                    <i data-ready={state.players[side]?.rematchReady} aria-hidden="true" />
                                    {state.players[side]?.name} · {state.players[side]?.rematchReady ? "다시 할래요" : "생각 중"}
                                </span>
                            ))}
                        </div>
                    )}
                </div>
                <footer className={css.footer}>
                    <span>
                        방 {state.code} · {state.round || 1}번째 대전
                    </span>
                    <button disabled={status !== "connected"} onClick={leave}>
                        처음으로 돌아가기
                    </button>
                </footer>
            </section>
        </main>
    );
}
