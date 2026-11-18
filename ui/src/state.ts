import { createMemo, createRoot, createSignal } from "solid-js";
import { initialConfig, type RuntimeConfig, type Session } from "./config";
import { sessionInfo, listSessions, type ClockInfo } from "./api/control";
import { createSubmitGuard } from "./lib/submitGuard";

/** App-wide reactive state: the runtime configuration, the clock, the sessions. */
const store = createRoot(() => {
  const [config, setConfig] = createSignal<RuntimeConfig>(initialConfig());
  const [clock, setClock] = createSignal<string>("");
  // The mode the daemon last reported; until it does (or on an older daemon), the configured one.
  const [liveClockMode, setLiveClockMode] = createSignal<"frozen" | "realtime" | null>(null);
  const clockMode = (): "frozen" | "realtime" => liveClockMode() ?? config().clockMode;
  /** Takes a clock answer: its instant, and its mode when the daemon reports one. */
  const setClockInfo = (info: ClockInfo) => {
    setClock(info.clock);
    if (typeof info.running === "boolean") setLiveClockMode(info.running ? "realtime" : "frozen");
  };
  /**
   * Takes the answer of a clock mutation (advance, set, freeze, resume): a poll that started
   * before it is older than the mutation and is discarded, so it cannot restore the old mode.
   */
  /**
   * One guard for every clock mutation in the app, so a mutation started on a page that was
   * left and opened again still blocks the next one until its answer is in.
   */
  const clockGuard = createSubmitGuard();
  const applyClockMutation = (info: ClockInfo) => {
    completedEpoch = ++pollEpoch;
    setClockInfo(info);
  };
  const [sessions, setSessionSnapshot] = createSignal<Session[]>(initialConfig().sessions);
  // Keep row-local forms for unchanged targets, but discard them for a replacement project.
  const setSessions = (snapshot: Session[]) => {
    const before = project();
    setSessionSnapshot((previous) =>
      snapshot.map(
        (next) =>
          previous.find((old) => old.name === next.name && old.project === next.project) ?? next,
      ),
    );
    if (before !== project()) resetPoll();
  };
  const [session, setSelectedSession] = createSignal<string>("default");
  let pollEpoch = 0;
  let completedEpoch = 0;
  const [lastConnectedAt, setLastConnectedAt] = createSignal<string | null>(null);
  const setSession = (name: string) => {
    if (name === session()) return;
    setSelectedSession(name);
    resetPoll();
  };
  const resetPoll = () => {
    completedEpoch = ++pollEpoch;
    setConnected(null);
    setLastConnectedAt(null);
    setClock("");
    setLiveClockMode(null);
  };
  /** Whether the last poll of the daemon answered (null until the first one). */
  const [connected, setConnected] = createSignal<boolean | null>(null);

  /** The project of the selected session. */
  // Polling must not invalidate consumers when the selected project is unchanged.
  const project = createMemo(
    () => sessions().find((s) => s.name === session())?.project ?? config().project,
  );

  /** Re-reads the clock (and the session list) from the daemon. */
  const refreshClock = async (): Promise<void> => {
    const mine = ++pollEpoch;
    const selected = session();
    const selectedProject = project();
    const [info, list] = await Promise.all([sessionInfo(selected), listSessions()]);
    if (mine <= completedEpoch || selected !== session() || selectedProject !== project()) return;
    list.map((l) => setSessions(l.sessions));
    if (mine <= completedEpoch) return;
    completedEpoch = mine;
    info.map((i) => setClockInfo(i.clock));
    const answered = info.isOk() && list.isOk();
    if (answered) setLastConnectedAt(new Date().toISOString());
    setConnected(answered);
  };

  return {
    config,
    setConfig,
    clock,
    setClock,
    clockMode,
    setClockInfo,
    applyClockMutation,
    clockGuard,
    sessions,
    setSessions,
    session,
    setSession,
    project,
    connected,
    lastConnectedAt,
    refreshClock,
  };
});

export const appState = store;
