import type { Ack, ConnectionStatus, GameState, RequestEvent, RequestPayloads } from "./types";

type Timer = ReturnType<typeof globalThis.setTimeout>;
interface ConnectionOptions {
    WebSocket?: typeof WebSocket;
    setTimeout?: typeof globalThis.setTimeout;
    clearTimeout?: typeof globalThis.clearTimeout;
    url?: string;
    origin?: string;
    storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
}
interface PendingRequest {
    resolve: (ack: Ack) => void;
    reject: (error: unknown) => void;
    timer: Timer;
    ws: WebSocket;
    event: RequestEvent;
}

const SESSION_KEY = "dino-session";
const REQUEST_TIMEOUT = 5000;
const REPLACED_CLOSE_CODE = 4001;

export function socketUrl(configured: string | undefined, origin: string | undefined) {
    const value = configured?.trim();
    const url = value ? new URL(value, value.startsWith("/") ? origin : undefined) : new URL("/ws", origin);
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
        throw new Error("VITE_SERVER_URL은 http(s) 또는 ws(s) 주소여야 합니다.");
    }
    if (url.pathname === "/") url.pathname = "/ws";
    url.protocol = ["https:", "wss:"].includes(url.protocol) ? "wss:" : "ws:";
    return url;
}

// 한 탭의 연결과 세션만 관리합니다. 수량·전투 계산은 Go 서버가 담당합니다.
export class Connection {
    onState: (state: GameState | null) => void;
    onStatus: (status: ConnectionStatus) => void;
    onError: (message: string) => void;
    WebSocket: typeof WebSocket;
    setTimeout: typeof globalThis.setTimeout;
    clearTimeout: typeof globalThis.clearTimeout;
    configured: string | undefined;
    origin: string | undefined;
    storage: ConnectionOptions["storage"];
    pending: Map<string, PendingRequest>;
    stopped: boolean;
    ready: boolean;
    retry: number;
    sequence: number;
    resumeToken: string | null;
    reconnectTimer: Timer | undefined;
    ws: WebSocket | undefined;

    constructor(onState: Connection["onState"], onStatus: Connection["onStatus"], onError: Connection["onError"], options: ConnectionOptions = {}) {
        this.onState = onState;
        this.onStatus = onStatus;
        this.onError = onError;
        this.WebSocket = options.WebSocket || globalThis.WebSocket;
        this.setTimeout = options.setTimeout || globalThis.setTimeout.bind(globalThis);
        this.clearTimeout = options.clearTimeout || globalThis.clearTimeout.bind(globalThis);
        this.configured = options.url ?? import.meta.env?.VITE_SERVER_URL;
        this.origin = options.origin || globalThis.location?.origin;
        try {
            this.storage = options.storage ?? globalThis.sessionStorage;
        } catch {
            this.storage = null;
        }
        this.pending = new Map();
        this.stopped = false;
        this.ready = false;
        this.retry = 0;
        this.sequence = 0;
        this.resumeToken = this.readToken();
        this.connect();
    }

    readToken() {
        try {
            return this.storage?.getItem(SESSION_KEY) || null;
        } catch {
            return null;
        }
    }

    saveToken(token: string | null) {
        this.resumeToken = token || null;
        try {
            if (token) this.storage?.setItem(SESSION_KEY, token);
            else this.storage?.removeItem(SESSION_KEY);
        } catch {
            /* 저장소가 차단되어도 현재 탭에서는 재연결할 수 있습니다. */
        }
    }

    connect() {
        if (this.stopped) return;
        this.clearTimeout(this.reconnectTimer);
        this.ready = false;
        this.onStatus("connecting");
        let ws: WebSocket;
        try {
            ws = this.ws = new this.WebSocket(socketUrl(this.configured, this.origin));
        } catch (error) {
            this.onStatus("disconnected");
            this.onError(error instanceof Error ? error.message : "서버 주소를 확인해 주세요.");
            return;
        }
        const current = () => !this.stopped && this.ws === ws;

        ws.onopen = async () => {
            if (!current()) return;
            // 전송 가능 상태와 방 복구 완료 상태를 구분해 생성·입장 요청의 경합을 막습니다.
            if (this.resumeToken) {
                try {
                    const ack = await this.request("resume", { token: this.resumeToken }, ws);
                    if (!current() || ws.readyState !== this.WebSocket.OPEN) return;
                    if (!ack.ok) {
                        this.saveToken(null);
                        this.onState(null);
                        this.onError(ack.error || "이전 방을 복구할 수 없습니다.");
                    }
                } catch {
                    // 응답이 없을 때 이전 방 화면에서 조작을 허용하지 않고 다시 복구합니다.
                    if (current()) ws.close();
                    return;
                }
            }
            if (!current() || ws.readyState !== this.WebSocket.OPEN) return;
            this.retry = 0;
            this.ready = true;
            this.onStatus("connected");
        };

        ws.onmessage = (event) => {
            if (!current() || ws.readyState !== this.WebSocket.OPEN) return;
            let data: GameState | Ack;
            try {
                data = JSON.parse(event.data);
            } catch {
                this.onError("서버 응답을 읽을 수 없습니다.");
                return;
            }
            if (!data || typeof data !== "object") return;
            if (data.event === "state") {
                this.onState(data);
            } else if (data.event === "ack") {
                const pending = this.pending.get(data.requestId);
                if (!pending || pending.ws !== ws) return;
                this.clearTimeout(pending.timer);
                this.pending.delete(data.requestId);
                if (data.ok) {
                    if (typeof data.token === "string" && data.token) this.saveToken(data.token);
                    if (pending.event === "leave") this.saveToken(null);
                }
                pending.resolve(data);
            }
        };

        ws.onclose = (event) => {
            if (!current()) return;
            this.ready = false;
            if (event?.code === REPLACED_CLOSE_CODE) {
                this.saveToken(null);
                this.onState(null);
                this.onError("다른 탭에서 이 방에 연결했어요. 이 탭에서는 새 방을 이용할 수 있어요.");
            }
            this.onStatus("disconnected");
            this.failPending();
            this.reconnectTimer = this.setTimeout(() => this.connect(), Math.min(4000, 500 * 2 ** this.retry++));
        };
        ws.onerror = () => {
            if (current()) ws.close();
        };
    }

    send<E extends RequestEvent>(event: E, ...args: E extends "leave" ? [data?: RequestPayloads[E]] : [data: RequestPayloads[E]]) {
        if (!this.ready || this.stopped) return Promise.reject(new Error("서버 연결을 기다려 주세요."));
        return this.request(event, args[0] ?? {}, this.ws);
    }

    request(event: RequestEvent, data: RequestPayloads[RequestEvent], ws: WebSocket | undefined): Promise<Ack> {
        if (!ws || ws.readyState !== this.WebSocket.OPEN) return Promise.reject(new Error("서버 연결을 기다려 주세요."));
        return new Promise<Ack>((resolve, reject) => {
            const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${++this.sequence}`;
            const timer = this.setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error("응답이 늦어지고 있습니다. 연결을 확인해 주세요."));
            }, REQUEST_TIMEOUT);
            this.pending.set(requestId, { resolve, reject, timer, ws, event });
            try {
                ws.send(JSON.stringify({ ...data, event, requestId }));
            } catch (error) {
                this.clearTimeout(timer);
                this.pending.delete(requestId);
                reject(error);
            }
        });
    }

    failPending() {
        for (const pending of this.pending.values()) {
            this.clearTimeout(pending.timer);
            pending.reject(new Error("서버 연결이 끊겼습니다. 다시 연결하고 있습니다."));
        }
        this.pending.clear();
    }

    close() {
        this.stopped = true;
        this.ready = false;
        this.clearTimeout(this.reconnectTimer);
        this.failPending();
        this.ws?.close();
    }
}
