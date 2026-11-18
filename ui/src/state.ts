import { createMemo, createRoot, createSignal, untrack } from "solid-js";
import { initialConfig, type RuntimeConfig, type Session } from "./config";
import { sessionInfo, listSessions } from "./api/control";

/** App-wide reactive state: the runtime configuration, the clock, the sessions. */
const store = createRoot(() => {
  const [config, setConfigSignal] = createSignal<RuntimeConfig>(initialConfig());
  // A page may adopt a deep link's session while it sets up (Functions event links), so the
  // selection and the poll state it resets accept writes from an owned scope.
  const adoptable = { ownedWrite: true } as const;
  const [clock, setClock] = createSignal<string>("", adoptable);
  const [sessions, setSessionSnapshot] = createSignal<Session[]>(initialConfig().sessions);
  // Keep row-local forms for unchanged targets, but discard them for a replacement project.
  // Solid 2 commits signal writes on the next microtask, so a read right after a write returns
  // the old value. The poll compares the selection it started with against the current one,
  // and a caller may select a session and poll in the same handler, so the selection is also
  // kept in plain variables that change at the write.
  let currentConfig = untrack(config);
  let currentSessions = untrack(sessions);
  let currentSession = "default";
  const projectIn = (list: Session[], name: string, fallback: RuntimeConfig) =>
    list.find((s) => s.name === name)?.project ?? fallback.project;
  const currentProject = () => projectIn(currentSessions, currentSession, currentConfig);
  const setConfig = (next: RuntimeConfig) => {
    currentConfig = next;
    setConfigSignal(next);
  };
  const setSessions = (snapshot: Session[]) => {
    const previous = currentSessions;
    const next = snapshot.map(
      (row) => previous.find((old) => old.name === row.name && old.project === row.project) ?? row,
    );
    const before = currentProject();
    currentSessions = next;
    setSessionSnapshot(next);
    if (before !== currentProject()) resetPoll();
  };
  const [session, setSelectedSession] = createSignal<string>("default", adoptable);
  let pollEpoch = 0;
  let completedEpoch = 0;
  const [lastConnectedAt, setLastConnectedAt] = createSignal<string | null>(null, adoptable);
  const setSession = (name: string) => {
    if (name === currentSession) return;
    currentSession = name;
    setSelectedSession(name);
    resetPoll();
  };
  const resetPoll = () => {
    completedEpoch = ++pollEpoch;
    setConnected(null);
    setLastConnectedAt(null);
    setClock("");
  };
  /** Whether the last poll of the daemon answered (null until the first one). */
  const [connected, setConnected] = createSignal<boolean | null>(null, adoptable);

  /** The project of the selected session. */
  // Polling must not invalidate consumers when the selected project is unchanged.
  const project = createMemo(() => projectIn(sessions(), session(), config()));

  /** Re-reads the clock (and the session list) from the daemon. */
  const refreshClock = async (): Promise<void> => {
    const mine = ++pollEpoch;
    const selected = currentSession;
    const selectedProject = currentProject();
    const [info, list] = await Promise.all([sessionInfo(selected), listSessions()]);
    if (
      mine <= completedEpoch ||
      selected !== currentSession ||
      selectedProject !== currentProject()
    )
      return;
    list.map((l) => setSessions(l.sessions));
    if (mine <= completedEpoch) return;
    completedEpoch = mine;
    info.map((i) => setClock(i.clock.clock));
    const answered = info.isOk() && list.isOk();
    if (answered) setLastConnectedAt(new Date().toISOString());
    setConnected(answered);
  };

  return {
    config,
    setConfig,
    clock,
    setClock,
    sessions,
    setSessions,
    session,
    setSession,
    project,
    /** The selected project as of the last write, before the write has rendered. */
    peekProject: currentProject,
    connected,
    lastConnectedAt,
    refreshClock,
  };
});

export const appState = store;
