import type { GameState, Player } from "../types";

export function total(player: Player | null | undefined) {
    return Object.values(player?.inventory || {}).reduce((sum, count) => sum + count, 0);
}

export function playerStatus(player: Player | null) {
    if (!player) return "방 코드로 입장해 주세요.";
    if (!player.connected) return "재연결을 기다리는 중…";
    return player.ready ? "준비 완료" : "준비 중";
}

export function resultMessage(state: GameState) {
    if (state.reason === "time") return "제한시간이 종료되었습니다.";
    if (state.reason === "leave") return "한 플레이어가 대전을 떠났습니다.";
    if (state.reason !== "disconnect") return "고인돌이 무너졌습니다.";
    if (state.winner === null) return "연결이 종료되어 대전이 끝났습니다.";
    return state.winner === state.you ? "상대의 연결이 종료되었습니다." : "내 연결이 종료되어 대전에서 패배했습니다.";
}
