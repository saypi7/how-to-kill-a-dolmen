export function countdownNumber(endsAt: number, now: number): 1 | 2 | 3 {
    return Math.min(3, Math.max(1, Math.ceil((endsAt - now) / 1000))) as 1 | 2 | 3;
}
