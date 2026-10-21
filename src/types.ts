export type Side = 0 | 1;
export type Phase = "lobby" | "collect" | "battle" | "result";
export type ConnectionStatus = "connecting" | "connected" | "disconnected";
export type DinoClass = "tank" | "assault" | "skirmisher" | "flying";

export interface Dino {
    id: string;
    name: string;
    image: string;
    crop: [number, number, number, number];
    sourceImage: string;
    sourceCrop: [number, number, number, number];
    weight: number;
    hp: number;
    attack: number;
    interval: number;
    speed: number;
    range: number;
    role: string;
    size: number;
    class: DinoClass;
    roleLabel: string;
}

export interface GameData {
    config: {
        collectMs: number;
        battleMs: number;
        baseHp: number;
        tickMs: number;
        spawnMin: number;
        spawnMax: number;
        visibleMin: number;
        visibleMax: number;
        bushes: number;
        width: number;
        bases: [number, number];
        summonCooldown: number;
        disconnectMs: number;
    };
    dinos: Dino[];
}

export interface Player {
    name: string;
    ready: boolean;
    connected: boolean;
    inventory: Record<string, number>;
    collected: number;
    reconnectUntil?: number;
}

export interface Spawn {
    id: string;
    type: string;
    bush: number;
    expiresAt: number;
}

export interface Unit {
    id: string;
    type: string;
    side: Side;
    x: number;
    hp: number;
    attacking: boolean;
    target: string;
    attackAt: number;
}

export interface GameState {
    event: "state";
    code: string;
    phase: Phase;
    endsAt: number;
    serverNow: number;
    you: Side;
    players: [Player | null, Player | null];
    hp: [number, number];
    units: Unit[];
    spawns: Spawn[];
    winner: Side | null;
    reason: string;
}

export interface Ack {
    event: "ack";
    requestId: string;
    ok: boolean;
    error?: string;
    token?: string;
}

export interface RequestPayloads {
    create: { name: string };
    join: { name: string; code: string };
    resume: { token: string };
    leave: Record<string, never>;
    ready: { ready: boolean };
    collect: { id: string };
    summon: { type: string };
}
export type RequestEvent = keyof RequestPayloads;
