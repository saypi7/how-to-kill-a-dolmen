import type { Cue } from "./soundEvents";

// Original small wooden/stone sounds synthesized locally. No audio downloads.
class GameSounds {
    private context: AudioContext | null = null;
    private master: GainNode | null = null;
    private last = new Map<Cue, number>();
    private sources = new Set<AudioScheduledSourceNode>();
    muted = false;
    constructor() {
        try {
            this.muted = localStorage.getItem("dolmen-sfx-muted") === "true";
        } catch {}
    }
    unlock = () => {
        try {
            if (!this.context && typeof AudioContext !== "undefined") {
                this.context = new AudioContext();
                this.master = this.context.createGain();
                this.master.gain.value = this.muted ? 0 : 0.34;
                this.master.connect(this.context.destination);
            }
            if (this.context?.state === "suspended") void this.context.resume().catch(() => {});
        } catch {
            /* Audio is optional; gameplay continues when unavailable. */
        }
    };
    setMuted(muted: boolean) {
        this.muted = muted;
        try {
            localStorage.setItem("dolmen-sfx-muted", String(muted));
        } catch {}
        if (this.context && this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.34, this.context.currentTime, 0.015);
        if (muted)
            for (const source of this.sources) {
                try {
                    source.stop();
                } catch {}
            }
        else this.unlock();
    }
    private track(source: AudioScheduledSourceNode) {
        this.sources.add(source);
        source.onended = () => {
            this.sources.delete(source);
            source.disconnect();
        };
    }
    private tone(hz: number, duration: number, level: number, delay = 0, endHz = hz) {
        const ctx = this.context!,
            at = ctx.currentTime + delay;
        const voice = ctx.createOscillator(),
            volume = ctx.createGain();
        voice.type = "sine";
        voice.frequency.setValueAtTime(hz, at);
        voice.frequency.exponentialRampToValueAtTime(Math.max(20, endHz), at + duration);
        volume.gain.setValueAtTime(0.0001, at);
        volume.gain.exponentialRampToValueAtTime(level, at + 0.006);
        volume.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        voice.connect(volume);
        volume.connect(this.master!);
        this.track(voice);
        voice.addEventListener("ended", () => volume.disconnect());
        voice.start(at);
        voice.stop(at + duration + 0.01);
    }
    private dust(duration: number, level: number, frequency: number, delay = 0) {
        const ctx = this.context!,
            at = ctx.currentTime + delay;
        const buffer = ctx.createBuffer(1, Math.ceil(duration * ctx.sampleRate), ctx.sampleRate);
        const samples = buffer.getChannelData(0);
        let seed = 7819,
            low = 0;
        for (let i = 0; i < samples.length; i++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
            low = 0.55 * low + 0.45 * (seed / 2147483648);
            samples[i] = low;
        }
        const source = ctx.createBufferSource(),
            filter = ctx.createBiquadFilter(),
            volume = ctx.createGain();
        source.buffer = buffer;
        filter.type = "bandpass";
        filter.frequency.value = frequency;
        filter.Q.value = 0.7;
        volume.gain.setValueAtTime(level, at);
        volume.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        source.connect(filter);
        filter.connect(volume);
        volume.connect(this.master!);
        this.track(source);
        source.addEventListener("ended", () => {
            filter.disconnect();
            volume.disconnect();
        });
        source.start(at);
        source.stop(at + duration + 0.01);
    }
    play = (cue: Cue) => {
        if (this.muted || !this.context || this.context.state !== "running" || document.hidden || this.sources.size > 14) return;
        const now = this.context.currentTime,
            gap = cue === "hit" ? 0.14 : cue === "stone" ? 0.24 : 0.065;
        if (now - (this.last.get(cue) ?? -Infinity) < gap) return;
        this.last.set(cue, now);
        try {
            switch (cue) {
                case "collect":
                    this.tone(660, 0.12, 0.16);
                    this.tone(990, 0.1, 0.08, 0.055);
                    break;
                case "summon":
                    this.dust(0.14, 0.45, 850);
                    this.tone(180, 0.12, 0.22, 0, 95);
                    break;
                case "hit":
                    this.dust(0.08, 0.32, 650);
                    this.tone(145, 0.08, 0.13, 0, 75);
                    break;
                case "stone":
                    this.dust(0.18, 0.65, 420);
                    this.tone(115, 0.15, 0.25, 0, 58);
                    break;
                case "collapse":
                    this.dust(0.65, 0.9, 320);
                    this.dust(0.45, 0.6, 700, 0.16);
                    this.tone(95, 0.5, 0.3, 0, 35);
                    break;
                case "tick":
                    this.tone(250, 0.11, 0.23, 0, 170);
                    this.dust(0.05, 0.23, 1000);
                    break;
                case "go":
                    [330, 440, 660].forEach((note, i) => this.tone(note, 0.19, 0.13, i * 0.07));
                    break;
                case "win":
                    [392, 494, 587, 784].forEach((note, i) => this.tone(note, 0.28, 0.13, 0.2 + i * 0.12));
                    break;
                case "lose":
                    this.tone(294, 0.27, 0.13, 0.2, 220);
                    this.tone(196, 0.4, 0.12, 0.5, 130);
                    break;
                case "draw":
                    this.tone(330, 0.2, 0.12, 0.1);
                    this.tone(330, 0.26, 0.12, 0.37);
                    break;
                case "ready":
                    this.tone(440, 0.09, 0.1);
                    break;
            }
        } catch {
            /* A browser/device audio failure must never abort the game. */
        }
    };
}
export const gameSounds = new GameSounds();
