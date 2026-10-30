import type { GameState } from "../types";
export type Cue = "collect" | "summon" | "hit" | "stone" | "collapse" | "tick" | "go" | "win" | "lose" | "draw" | "ready";

// Derive cues from confirmed server changes, never from optimistic clicks.
export function soundEvents(previous: GameState | null, current: GameState): Cue[] {
    if (!previous || previous.matchId !== current.matchId) return [];
    const cues: Cue[] = [];
    const before = previous.players[current.you],
        after = current.players[current.you];
    if (before && after) {
        if (after.collected > before.collected) cues.push("collect");
        if (after.summoned > before.summoned) cues.push("summon");
        if (after.rematchReady && !before.rematchReady) cues.push("ready");
    }
    if (previous.phase === "countdown" && ["collect", "battle"].includes(current.phase)) cues.push("go");
    const damagedBase = current.hp.some((hp, side) => hp < previous.hp[side]);
    const destroyedBase = current.hp.some((hp, side) => hp === 0 && previous.hp[side] > 0);
    if (destroyedBase) cues.push("collapse");
    else if (damagedBase) cues.push("stone");
    if (
        current.phase === "battle" &&
        current.units.some((unit) => {
            const old = previous.units.find((candidate) => candidate.id === unit.id);
            return old && unit.attackAt > old.attackAt;
        })
    )
        cues.push("hit");
    if (current.phase === "result" && previous.phase !== "result") {
        cues.push(current.winner === null ? "draw" : current.winner === current.you ? "win" : "lose");
    }
    return cues;
}
