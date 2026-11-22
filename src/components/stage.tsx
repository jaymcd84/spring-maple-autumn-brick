import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  SONG_LENGTH,
  activeAt,
  cueAt,
  sectionFor,
  shots,
  type Cue,
  type Ken,
} from "@/lib/cues";

type Graph = {
  ctx: AudioContext;
  analyser: AnalyserNode;
  audio: HTMLAudioElement;
};

let graph: Graph | null = null;

function ensureGraph(audio: HTMLAudioElement): Graph {
  if (graph?.audio === audio) return graph;
  if (graph) void graph.ctx.close().catch(() => undefined);
  const ctx = new AudioContext();
  const source = ctx.createMediaElementSource(audio);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 128;
  analyser.smoothingTimeConstant = 0.82;
  analyser.minDecibels = -88;
  analyser.maxDecibels = -26;
  source.connect(analyser);
  analyser.connect(ctx.destination);
  graph = { ctx, analyser, audio };
  return graph;
}

function fmt(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function RichLine({ text }: { text: string }) {
  const bits = text.split(/(\bmask\b)/gi);
  return bits.map((bit, i) =>
    bit.toLowerCase() === "mask" ? (
      <span key={i} className="text-rose">
        {bit}
      </span>
    ) : (
      <span key={i}>{bit}</span>
    ),
  );
}

function lyricSize(cue: Cue) {
  if (cue.text === "Let me sing.") return "text-5xl sm:text-7xl";
  if (cue.tone === "bridge") return "text-2xl tracking-wide text-bone/80 sm:text-4xl";
  if (cue.tone === "chorus" || cue.tone === "final") return "text-4xl sm:text-6xl";
  return "text-3xl sm:text-5xl";
}

function Frame({ src, ken }: { src: string; ken: Ken }) {
  const [layers, setLayers] = useState<{ id: number; src: string }[]>([{ id: 0, src }]);

  useEffect(() => {
    setLayers((prev) => {
      const top = prev[prev.length - 1];
      if (top?.src === src) return prev;
      return [...prev.slice(-1), { id: (top?.id ?? 0) + 1, src }];
    });
  }, [src]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-ink">
      {layers.map((layer, index) => {
        const top = index === layers.length - 1;
        return (
          <img
            key={layer.id}
            src={layer.src}
            alt=""
            draggable={false}
            onError={(event) => {
              const img = event.currentTarget;
              if (img.dataset.fallback === "1") {
                img.style.opacity = "0";
                return;
              }
              img.dataset.fallback = "1";
              img.src = "/stills/portrait.jpg";
            }}
            className={cn(
              "absolute inset-0 h-full w-full object-cover transition-opacity duration-700",
              top ? cn("opacity-100", `ken-${ken}`) : "opacity-0",
            )}
          />
        );
      })}
    </div>
  );
}

function Meter({ playing }: { playing: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const bars = Array.from(root.children) as HTMLElement[];
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const data = new Uint8Array(64);
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!playing || reduce || !graph) {
        for (const bar of bars) bar.style.transform = "scaleY(0.08)";
        return;
      }
      graph.analyser.getByteFrequencyData(data);
      bars.forEach((bar, i) => {
        const idx = Math.min(data.length - 1, Math.floor((i / bars.length) * data.length * 0.72));
        const v = (data[idx] ?? 0) / 255;
        bar.style.transform = `scaleY(${(0.08 + v * 0.92).toFixed(3)})`;
      });
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-x-0 bottom-0 flex h-12 items-end gap-1 px-4"
      aria-hidden
    >
      {Array.from({ length: 36 }, (_, i) => (
        <span key={i} className="meter-bar h-full min-w-0 flex-1 bg-rose/80" />
      ))}
    </div>
  );
}

function PlayGlyph({ playing }: { playing: boolean }) {
  return (
    <span className="relative grid h-6 w-6 place-items-center">
      <Play
        aria-hidden
        className={cn(
          "col-start-1 row-start-1 h-6 w-6 translate-x-0.5 transition duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
          playing ? "scale-[0.25] opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-none",
        )}
      />
      <Pause
        aria-hidden
        className={cn(
          "col-start-1 row-start-1 h-6 w-6 transition duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
          playing ? "scale-100 opacity-100 blur-none" : "scale-[0.25] opacity-0 blur-[4px]",
        )}
      />
    </span>
  );
}

export function Stage() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const drag = useRef(false);
  const [uiTime, setUiTime] = useState(0);
  const [dur, setDur] = useState(SONG_LENGTH);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [volume, setVolume] = useState(0.9);
  const [muted, setMuted] = useState(false);
  const [audioError, setAudioError] = useState(false);

  const toggleRef = useRef<() => void>(() => undefined);
  const nudgeRef = useRef<(by: number) => void>(() => undefined);

  useEffect(() => {
    const raw = localStorage.getItem("under-the-mask-volume");
    const v = raw ? Number(raw) : 0.9;
    const next = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.9;
    setVolume(next);
    if (audioRef.current) audioRef.current.volume = next;
  }, []);

  const skipSave = useRef(true);
  useEffect(() => {
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    localStorage.setItem("under-the-mask-volume", String(volume));
    if (audioRef.current) audioRef.current.volume = muted ? 0 : volume;
  }, [volume, muted]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      if (now - last > 80 && !drag.current) {
        last = now;
        const audio = audioRef.current;
        if (audio) setUiTime(audio.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    for (const shot of shots) {
      const img = new Image();
      img.src = shot.src;
    }
  }, []);

  function seek(to: number) {
    const audio = audioRef.current;
    if (!audio) return;
    const limit = Number.isFinite(audio.duration) ? audio.duration : dur;
    const next = Math.min(Math.max(0, to), limit);
    audio.currentTime = next;
    setUiTime(next);
  }

  function nudge(by: number) {
    const audio = audioRef.current;
    seek((audio?.currentTime ?? uiTime) + by);
  }

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      const g = ensureGraph(audio);
      if (g.ctx.state !== "running") await g.ctx.resume();
    } catch {
      /* the element can still play without the meter */
    }
    try {
      await audio.play();
    } catch {
      setPlaying(false);
    }
  }

  toggleRef.current = toggle;
  nudgeRef.current = nudge;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
      if (event.repeat) return;
      if (event.code === "Space") {
        event.preventDefault();
        toggleRef.current();
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        nudgeRef.current(5);
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        nudgeRef.current(-5);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shot = activeAt(shots, uiTime);
  const cue = cueAt(uiTime);
  const section = sectionFor(uiTime);
  const ended = started && !playing && uiTime >= dur - 0.35;
  const showHero = uiTime < 17.6 || ended;
  const pct = dur > 0 ? Math.min(100, Math.max(0, (uiTime / dur) * 100)) : 0;
  const wash = section === "Chorus" || section === "Pre-chorus";

  return (
    <main className="flex h-full flex-col bg-ink text-bone">
      <audio
        ref={audioRef}
        src="/audio/under-the-mask.mp3"
        preload="auto"
        onLoadedMetadata={(event) => {
          const d = event.currentTarget.duration;
          if (Number.isFinite(d)) setDur(d);
        }}
        onPlay={() => {
          setPlaying(true);
          setStarted(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setUiTime(dur);
        }}
        onError={() => setAudioError(true)}
      />

      <section
        className="relative min-h-0 flex-1 cursor-pointer"
        onClick={() => void toggle()}
        aria-label="Music video"
      >
        <Frame src={shot.src} ken={shot.ken} />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-ink/80 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-ink via-ink/45 to-transparent" />
        <div
          className={cn(
            "pointer-events-none absolute inset-0 bg-rose/15 transition-opacity duration-700",
            wash ? "opacity-100" : "opacity-0",
          )}
        />
        <div
          className={cn(
            "pointer-events-none absolute inset-0 transition-opacity duration-700",
            section === "Bridge" ? "opacity-100" : "opacity-70",
          )}
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 42%, var(--color-ink) 100%)",
          }}
        />
        <div className="grain" />
        <Meter playing={playing} />

        <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full bg-rose transition-opacity duration-300",
                playing ? "opacity-100" : "opacity-40",
              )}
            />
            <p className="text-xs tracking-widest text-bone">Under the Mask</p>
          </div>
          <p className="tabular-nums text-sm text-dust">
            {fmt(uiTime)}
            <span className="text-dust/70"> / {fmt(dur)}</span>
          </p>
        </header>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-16 sm:px-10 sm:pb-20">
          {showHero ? (
            <div key={ended ? "end" : "open"} className="lyric-in lyric-shadow max-w-3xl">
              <p className="text-xs tracking-widest text-rose">{ended ? "Again" : "Goth-pop"}</p>
              <h1 className="mt-2 font-display text-5xl italic leading-none text-bone sm:text-7xl">
                Under the Mask
              </h1>
            </div>
          ) : cue ? (
            <div className="lyric-shadow max-w-4xl">
              {section ? (
                <p className="text-xs tracking-widest text-rose">{section}</p>
              ) : null}
              <p
                key={cue.t}
                aria-live="polite"
                className={cn(
                  "lyric-in mt-2 font-display italic leading-tight text-balance text-bone",
                  lyricSize(cue),
                )}
              >
                <RichLine text={cue.text} />
              </p>
            </div>
          ) : null}
        </div>

        {!playing ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              void toggle();
            }}
            className="absolute top-1/2 left-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-bone/30 bg-ink/80 text-bone transition duration-150 ease-out hover:border-rose hover:text-rose active:scale-[0.96]"
            aria-label={ended ? "Play again" : "Play"}
          >
            <Play className="h-7 w-7 translate-x-0.5" aria-hidden />
          </button>
        ) : null}
      </section>

      <footer
        className="shrink-0 border-t border-line bg-ink px-3 py-2 sm:px-5"
        onClick={(event) => event.stopPropagation()}
      >
        {audioError ? (
          <p className="px-1 pb-1 text-sm text-rose">The picture can’t find its sound.</p>
        ) : null}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => void toggle()}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line text-bone transition duration-150 ease-out hover:border-rose hover:text-rose active:scale-[0.96]"
            aria-label={playing ? "Pause" : "Play"}
          >
            <PlayGlyph playing={playing} />
          </button>
          <span className="w-10 shrink-0 tabular-nums text-sm text-dust sm:w-12">{fmt(uiTime)}</span>
          <input
            className="scrub min-w-0 flex-1"
            type="range"
            min={0}
            max={dur || SONG_LENGTH}
            step={0.05}
            value={Math.min(uiTime, dur || SONG_LENGTH)}
            aria-label="Seek"
            suppressHydrationWarning
            style={{ "--pct": `${pct}%` } as CSSProperties}
            onPointerDown={() => {
              drag.current = true;
            }}
            onPointerUp={(event) => {
              drag.current = false;
              seek(Number(event.currentTarget.value));
            }}
            onChange={(event) => {
              drag.current = true;
              setUiTime(Number(event.target.value));
            }}
            onKeyUp={(event) => {
              if (event.key.startsWith("Arrow")) seek(Number(event.currentTarget.value));
            }}
          />
          <span className="hidden w-12 shrink-0 tabular-nums text-sm text-dust sm:inline">
            {fmt(dur)}
          </span>
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-dust transition duration-150 ease-out hover:text-bone active:scale-[0.96]"
            aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
          >
            {muted || volume === 0 ? (
              <VolumeX className="h-5 w-5" aria-hidden />
            ) : (
              <Volume2 className="h-5 w-5" aria-hidden />
            )}
          </button>
          <input
            className="vol hidden w-20 sm:block"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            aria-label="Volume"
            suppressHydrationWarning
            style={{ "--pct": `${(muted ? 0 : volume) * 100}%` } as CSSProperties}
            onChange={(event) => {
              const next = Number(event.target.value);
              setMuted(false);
              setVolume(next);
            }}
          />
        </div>
      </footer>
    </main>
  );
}
