import {
  BrowserCacheLocation,
  PublicClientApplication,
  type AccountInfo
} from "@azure/msal-browser";
import {
  CircleDollarSign,
  Dice5,
  LogOut,
  Lock,
  MessageSquare,
  Save,
  RadioTower,
  Send,
  Timer,
  UnlockKeyhole,
  UserRound,
  UsersRound,
  Wifi,
  WifiOff
} from "lucide-react";
import {
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  BET_DEFINITIONS,
  Bet,
  BetKind,
  GameState,
  PlayerState,
  PointNumber,
  SettlementOutcome
} from "@bubble-craps/shared";

type PublicGameState = GameState & { countdownRemainingMs: number };

type ServerMessage =
  | { type: "state"; state: PublicGameState }
  | { type: "joined"; playerId: string }
  | { type: "authenticated"; playerId: string }
  | { type: "error"; message: string };

type ConnectionStatus = "connecting" | "connected" | "disconnected";

const wsUrl = import.meta.env.VITE_WS_URL ?? "ws://localhost:8080/ws";
const authMode =
  import.meta.env.VITE_AUTH_MODE ??
  (import.meta.env.VITE_ENTRA_CLIENT_ID && import.meta.env.VITE_ENTRA_AUTHORITY
    ? "entra"
    : "local");
const authEnabled = authMode === "entra";
const entraClientId = import.meta.env.VITE_ENTRA_CLIENT_ID ?? "";
const entraAuthority = import.meta.env.VITE_ENTRA_AUTHORITY ?? "";
const entraRedirectUri = import.meta.env.VITE_ENTRA_REDIRECT_URI ?? window.location.origin;
const entraPopupRedirectUri =
  import.meta.env.VITE_ENTRA_POPUP_REDIRECT_URI ??
  new URL("/auth-callback.html", entraRedirectUri).toString();
const entraApiScope = import.meta.env.VITE_ENTRA_API_SCOPE ?? "";
const rebuyChips = Number(import.meta.env.VITE_REBUY_CHIPS ?? 2000);
const CHIP_VALUES = [1, 5, 10, 25, 100] as const;
const CHIP_TRANSFER_TYPE = "application/x-bubble-craps-chip";

const POINT_BET_SPOTS: Array<{
  point: PointNumber;
  placeKind: BetKind;
  layKind: BetKind;
}> = [
  { point: 4, placeKind: "place4", layKind: "lay4" },
  { point: 5, placeKind: "place5", layKind: "lay5" },
  { point: 6, placeKind: "place6", layKind: "lay6" },
  { point: 8, placeKind: "place8", layKind: "lay8" },
  { point: 9, placeKind: "place9", layKind: "lay9" },
  { point: 10, placeKind: "place10", layKind: "lay10" }
];

const PROP_BET_SPOTS: Array<{
  kind: BetKind;
  label: string;
  sublabel: string;
  className: string;
}> = [
  { kind: "aces", label: "ACES", sublabel: "30:1", className: "prop-high" },
  { kind: "aceDeuce", label: "ACE-DEUCE", sublabel: "15:1", className: "prop-mid" },
  { kind: "yo", label: "YO", sublabel: "15:1", className: "prop-mid" },
  { kind: "boxcars", label: "BOXCARS", sublabel: "30:1", className: "prop-high" },
  { kind: "anyCraps", label: "ANY CRAPS", sublabel: "7:1", className: "prop-craps" },
  { kind: "anySeven", label: "ANY 7", sublabel: "4:1", className: "prop-seven" },
  { kind: "hard4", label: "HARD 4", sublabel: "7:1", className: "prop-hard" },
  { kind: "hard6", label: "HARD 6", sublabel: "9:1", className: "prop-hard" },
  { kind: "hard8", label: "HARD 8", sublabel: "9:1", className: "prop-hard" },
  { kind: "hard10", label: "HARD 10", sublabel: "7:1", className: "prop-hard" }
];

export function App() {
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [state, setState] = useState<PublicGameState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [authClient, setAuthClient] = useState<PublicClientApplication | null>(null);
  const [authAccount, setAuthAccount] = useState<AccountInfo | null>(null);
  const [authReady, setAuthReady] = useState(!authEnabled);
  const [authBusy, setAuthBusy] = useState(false);
  const [selectedChip, setSelectedChip] = useState(10);
  const [chatText, setChatText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const socketRef = useRef<WebSocket | null>(null);
  const previousStateRef = useRef<PublicGameState | null>(null);
  const audio = useAudioEffects();

  useEffect(() => {
    if (!authEnabled) {
      return;
    }

    if (!entraClientId || !entraAuthority || !entraApiScope) {
      setError("Entra auth is enabled but VITE_ENTRA_CLIENT_ID, VITE_ENTRA_AUTHORITY, or VITE_ENTRA_API_SCOPE is missing.");
      return;
    }

    let cancelled = false;
    const client = new PublicClientApplication({
      auth: {
        clientId: entraClientId,
        authority: entraAuthority,
        redirectUri: entraPopupRedirectUri
      },
      cache: {
        cacheLocation: BrowserCacheLocation.LocalStorage
      }
    });

    client
      .initialize()
      .then(async () => {
        const redirectResult = await client.handleRedirectPromise();
        const account = redirectResult?.account ?? client.getAllAccounts()[0] ?? null;
        if (account) {
          client.setActiveAccount(account);
        }
        if (!cancelled) {
          setAuthClient(client);
          setAuthAccount(account);
          setAuthReady(true);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setError(errorMessage(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;
    setConnection("connecting");

    socket.addEventListener("open", () => {
      setConnection("connected");
      setError(null);
    });

    socket.addEventListener("close", () => {
      setConnection("disconnected");
    });

    socket.addEventListener("error", () => {
      setConnection("disconnected");
      setError("Unable to connect to the game server.");
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as ServerMessage;
      if (message.type === "state") {
        setState(message.state);
      } else if (message.type === "joined" || message.type === "authenticated") {
        setPlayerId(message.playerId);
      } else if (message.type === "error") {
        setError(message.message);
      }
    });

    return () => {
      socket.close();
    };
  }, []);

  useEffect(() => {
    if (
      !authEnabled ||
      !authClient ||
      !authAccount ||
      connection !== "connected" ||
      playerId
    ) {
      return;
    }

    let cancelled = false;
    setAuthBusy(true);
    acquireAccessToken(authClient, authAccount)
      .then((accessToken) => {
        if (!cancelled) {
          send({ type: "authenticate", accessToken });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setError(errorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuthBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authAccount, authClient, connection, playerId]);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!state) {
      return;
    }

    const previous = previousStateRef.current;
    if (previous) {
      if (state.bets.length > previous.bets.length) {
        audio.play("bet");
      }
      if (state.chat.length > previous.chat.length) {
        audio.play("chat");
      }
      if (state.notices.length > previous.notices.length) {
        audio.play("lock");
      }
      if (
        previous.betting.status === "open" &&
        state.betting.status === "locked"
      ) {
        audio.play("lock");
      }
      if (state.device.rolling && !previous.device.rolling) {
        audio.play("roll");
      }
      if (state.lastRoll?.rollId && state.lastRoll.rollId !== previous.lastRoll?.rollId) {
        audio.play("result");
      }
    }
    previousStateRef.current = state;
  }, [audio, state]);

  const currentPlayer = playerId && state ? state.players[playerId] : null;
  const shooter = state?.shooterId ? state.players[state.shooterId] : null;
  const latestNotice = state?.notices[state.notices.length - 1] ?? null;
  const shooterAlert =
    latestNotice?.type === "roll_timeout" && latestNotice.playerId === playerId
      ? "Your turn to roll. Previous shooter timed out."
      : latestNotice?.message ?? null;
  const activePlayerBets = useMemo(
    () => state?.bets.filter((bet) => bet.playerId === playerId) ?? [],
    [playerId, state?.bets]
  );
  const countdownMs =
    state?.betting.closesAt === null || state?.betting.closesAt === undefined
      ? 0
      : Math.max(0, state.betting.closesAt - clock);
  const canRoll =
    Boolean(currentPlayer) &&
    state?.shooterId === playerId &&
    state?.betting.status === "locked" &&
    !state.device.rolling;

  function send(payload: unknown) {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(payload));
    }
  }

  function joinTable(event: FormEvent) {
    event.preventDefault();
    send({ type: "join", displayName });
  }

  async function signIn() {
    if (!authClient || !authReady) {
      return;
    }

    setAuthBusy(true);
    try {
      const result = await authClient.loginPopup({
        scopes: [entraApiScope],
        redirectUri: entraPopupRedirectUri
      });
      authClient.setActiveAccount(result.account);
      setAuthAccount(result.account);
      setError(null);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setAuthBusy(false);
    }
  }

  function place(kind: BetKind, amount = selectedChip) {
    send({ type: "placeBet", kind, amount });
  }

  function removeExistingBet(betId: string) {
    send({ type: "removeBet", betId });
  }

  function requestRoll() {
    send({ type: "requestRoll" });
  }

  function rebuy() {
    send({ type: "rebuyChips" });
  }

  function updateDisplayName(nextDisplayName: string) {
    send({ type: "updateDisplayName", displayName: nextDisplayName });
  }

  async function signOut() {
    send({ type: "leave" });
    setPlayerId(null);
    setAuthAccount(null);

    if (!authClient || !authAccount) {
      return;
    }

    setAuthBusy(true);
    try {
      await authClient.logoutPopup({
        account: authAccount,
        mainWindowRedirectUri: window.location.href,
        postLogoutRedirectUri: entraPopupRedirectUri
      });
      authClient.setActiveAccount(null);
      setError(null);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setAuthBusy(false);
    }
  }

  function sendChat(event: FormEvent) {
    event.preventDefault();
    if (!chatText.trim()) {
      return;
    }
    send({ type: "chat", message: chatText });
    setChatText("");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Dice5 size={28} aria-hidden />
          </div>
          <div>
            <h1>Remote Bubble Craps</h1>
            <p>Play-money shared table</p>
          </div>
        </div>

        <div className="status-row">
          <StatusPill
            icon={connection === "connected" ? <Wifi /> : <WifiOff />}
            label={connection}
            tone={connection === "connected" ? "good" : "bad"}
          />
          <StatusPill
            icon={<RadioTower />}
            label={state?.device.label ?? "Simulated"}
            tone={state?.device.connected ? "good" : "warn"}
          />
        </div>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}
      {shooterAlert ? <div className="table-notice">{shooterAlert}</div> : null}

      {!currentPlayer && authEnabled ? (
        <section className="join-panel">
          <div className="join-form">
            <label>Microsoft sign-in</label>
            <div className="join-row">
              <div className="auth-copy">
                {authAccount ? authAccount.name ?? authAccount.username : "Sign in or sign up to join the table."}
              </div>
              <button type="button" disabled={!authReady || authBusy || connection !== "connected"} onClick={signIn}>
                <UserRound size={18} />
                {authBusy ? "Signing in" : "Sign in"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {!currentPlayer && !authEnabled ? (
        <section className="join-panel">
          <form onSubmit={joinTable} className="join-form">
            <label htmlFor="displayName">Display name</label>
            <div className="join-row">
              <input
                id="displayName"
                value={displayName}
                maxLength={32}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Player name"
              />
              <button type="submit" disabled={connection !== "connected"}>
                <UserRound size={18} />
                Join
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <ChatPanel
        state={state}
        currentPlayer={currentPlayer}
        chatText={chatText}
        onChatTextChange={setChatText}
        onSubmit={sendChat}
      />

      <div className="layout-grid">
        <section className="table-stage">
          <div className="table-rail">
            <div className="table-felt">
              {state?.lastRoll ? (
                <RollResultOverlay
                  key={state.lastRoll.rollId}
                  die1={state.lastRoll.die1}
                  die2={state.lastRoll.die2}
                />
              ) : null}

              <div className="table-meta">
                <Metric label="Shooter" value={shooter?.displayName ?? "Waiting"} />
                <Metric label="Point" value={state?.point ? String(state.point) : "Off"} />
                <Metric
                  label="Bankroll"
                  value={currentPlayer ? chips(currentPlayer.balance) : "--"}
                />
              </div>

              <CrapsBoard
                state={state}
                playerId={playerId}
                currentPlayer={currentPlayer}
                selectedChip={selectedChip}
                onBet={place}
              />

              <div className="table-action-row">
                <div className="dice-zone">
                  {state?.lastRoll ? (
                    <>
                      <DiceFace value={state.lastRoll.die1} />
                      <DiceFace value={state.lastRoll.die2} />
                    </>
                  ) : (
                    <>
                      <DiceFace value={1} ghost />
                      <DiceFace value={1} ghost />
                    </>
                  )}
                </div>

                <button
                  className="roll-button"
                  type="button"
                  disabled={!canRoll}
                  onClick={requestRoll}
                >
                  <Dice5 size={22} />
                  {state?.device.rolling ? "Rolling" : "Roll"}
                </button>

                <div className="roll-summary">
                  <div>
                    <span>Last roll</span>
                    <strong>{state?.lastRoll?.total ?? "--"}</strong>
                  </div>
                  <div>
                    <span>Phase</span>
                    <strong>{state?.phase === "point" ? "Point" : "Come-out"}</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="table-results-row">
            <section className="settlement-panel">
              <div className="panel-header">
                <div>
                  <h2>Bet Feed</h2>
                  <p>{state?.settlementFeed.length ?? 0} results</p>
                </div>
                <CircleDollarSign size={22} />
              </div>
              <SettlementFeed state={state} />
            </section>
          </div>
        </section>

        <section className="control-panel">
          <div className="panel-header">
            <div>
              <h2>Chip Rack</h2>
              <p>{chips(selectedChip)} selected</p>
            </div>
            <div className={`lock-badge ${state?.betting.status ?? "locked"}`}>
              {state?.betting.status === "open" ? (
                <UnlockKeyhole size={18} />
              ) : (
                <Lock size={18} />
              )}
              {state?.betting.status === "open"
                ? formatCountdown(countdownMs)
                : "Locked"}
            </div>
          </div>

          <ChipRack
            selectedChip={selectedChip}
            onSelect={setSelectedChip}
            disabled={!currentPlayer || connection !== "connected"}
          />

          {currentPlayer ? (
            <AccountPanel
              player={currentPlayer}
              authEnabled={authEnabled}
              authBusy={authBusy}
              onRebuy={rebuy}
              onUpdateDisplayName={updateDisplayName}
              onSignOut={signOut}
            />
          ) : null}
        </section>

        <section className="bets-panel">
          <div className="panel-header">
            <div>
              <h2>Your Bets</h2>
              <p>{chips(activePlayerBets.reduce((sum, bet) => sum + bet.amount, 0))} working</p>
            </div>
            <CircleDollarSign size={22} />
          </div>
          <BetList
            bets={activePlayerBets}
            canRemove={state?.betting.status === "open"}
            onRemoveBet={removeExistingBet}
          />
        </section>

        <section className="history-panel">
          <div className="panel-header">
            <div>
              <h2>Recent Rolls</h2>
              <p>{state?.history.length ?? 0} shown</p>
            </div>
            <Timer size={22} />
          </div>
          <div className="history-list">
            {[...(state?.history ?? [])].reverse().map((roll) => (
              <div className="history-row" key={roll.rollId}>
                <span>{roll.die1} + {roll.die2}</span>
                <strong>{roll.total}</strong>
                <span>{roll.pointAfter ? `Point ${roll.pointAfter}` : "Point off"}</span>
              </div>
            ))}
            {state?.history.length === 0 ? <EmptyText label="No rolls yet" /> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function StatusPill({
  icon,
  label,
  tone
}: {
  icon: JSX.Element;
  label: string;
  tone: "good" | "warn" | "bad";
}) {
  return (
    <div className={`status-pill ${tone}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RollResultOverlay({
  die1,
  die2
}: {
  die1: number;
  die2: number;
}) {
  return (
    <div className="roll-result-overlay" aria-live="polite">
      {rollResultLabel(die1, die2)}
    </div>
  );
}

function AccountPanel({
  player,
  authEnabled,
  authBusy,
  onRebuy,
  onUpdateDisplayName,
  onSignOut
}: {
  player: PlayerState;
  authEnabled: boolean;
  authBusy: boolean;
  onRebuy: () => void;
  onUpdateDisplayName: (displayName: string) => void;
  onSignOut: () => void;
}) {
  const net = player.balance - player.totalBuyIns;
  const [nameDraft, setNameDraft] = useState(player.displayName);

  useEffect(() => {
    setNameDraft(player.displayName);
  }, [player.displayName]);

  function submitName(event: FormEvent) {
    event.preventDefault();
    if (!nameDraft.trim() || nameDraft.trim() === player.displayName) {
      return;
    }
    onUpdateDisplayName(nameDraft);
  }

  return (
    <div className="account-summary">
      <form className="name-edit-form" onSubmit={submitName}>
        <label htmlFor="tableDisplayName">Table name</label>
        <div className="name-edit-row">
          <input
            id="tableDisplayName"
            value={nameDraft}
            maxLength={32}
            onChange={(event) => setNameDraft(event.target.value)}
          />
          <button
            type="submit"
            disabled={!nameDraft.trim() || nameDraft.trim() === player.displayName}
            title="Save table name"
          >
            <Save size={18} />
          </button>
        </div>
      </form>
      <div>
        <span>Play buy-ins</span>
        <strong>-{chips(player.totalBuyIns)}</strong>
      </div>
      <div>
        <span>Net chips</span>
        <strong className={net < 0 ? "negative" : "positive"}>{signedChips(net)}</strong>
      </div>
      <button type="button" className="rebuy-button" onClick={onRebuy}>
        <CircleDollarSign size={18} />
        Buy {chips(rebuyChips)}
      </button>
      {authEnabled ? (
        <button type="button" className="sign-out-button" onClick={onSignOut} disabled={authBusy}>
          <LogOut size={18} />
          Sign out
        </button>
      ) : null}
    </div>
  );
}

function ChatPanel({
  state,
  currentPlayer,
  chatText,
  onChatTextChange,
  onSubmit
}: {
  state: PublicGameState | null;
  currentPlayer: PlayerState | null;
  chatText: string;
  onChatTextChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const players = Object.values(state?.players ?? {}).sort((a, b) => a.joinedAt - b.joinedAt);

  return (
    <section className="table-chat-panel">
      <div className="panel-header">
        <div>
          <h2>Table Chat</h2>
          <p>{players.length} players</p>
        </div>
        <MessageSquare size={22} />
      </div>
      <div className="chat-above-grid">
        <PlayerRoster players={players} shooterId={state?.shooterId ?? null} />
        <div className="chat-stack">
          <div className="chat-log">
            {(state?.chat ?? []).map((message) => (
              <div className="chat-message" key={message.id}>
                <strong>{message.displayName}</strong>
                <span>{message.message}</span>
              </div>
            ))}
            {state?.chat.length === 0 ? <EmptyText label="No messages yet" /> : null}
          </div>
          <form onSubmit={onSubmit} className="chat-form">
            <input
              value={chatText}
              onChange={(event) => onChatTextChange(event.target.value)}
              placeholder="Message"
              disabled={!currentPlayer}
            />
            <button type="submit" disabled={!currentPlayer || !chatText.trim()}>
              <Send size={18} />
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

function PlayerRoster({
  players,
  shooterId
}: {
  players: PlayerState[];
  shooterId: string | null;
}) {
  if (players.length === 0) {
    return <EmptyText label="No players yet" />;
  }

  return (
    <div className="player-roster">
      <div className="roster-title">
        <UsersRound size={18} />
        <span>Players</span>
      </div>
      {players.map((player) => (
        <div className="player-row" key={player.id}>
          <span className={`presence-dot ${player.connected ? "online" : "offline"}`} />
          <div>
            <strong>{player.displayName}</strong>
            <small>{player.id === shooterId ? "Shooter" : player.connected ? "Online" : "Offline"}</small>
          </div>
          <span>{chips(player.balance)}</span>
        </div>
      ))}
    </div>
  );
}

function ChipRack({
  selectedChip,
  onSelect,
  disabled
}: {
  selectedChip: number;
  onSelect: (value: number) => void;
  disabled: boolean;
}) {
  const normalizedAmount = normalizeAmount(selectedChip);

  return (
    <div className="chip-rack">
      {CHIP_VALUES.map((value) => (
        <button
          key={value}
          className={`chip-button chip-${chipTone(value)} ${selectedChip === value ? "selected" : ""}`}
          type="button"
          draggable={!disabled}
          disabled={disabled}
          aria-pressed={selectedChip === value}
          onClick={() => onSelect(value)}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData(CHIP_TRANSFER_TYPE, String(value));
            event.dataTransfer.setData("text/plain", String(value));
          }}
        >
          {value}
        </button>
      ))}
      <div className="custom-chip-control">
        <label htmlFor="customChipAmount">Amount</label>
        <div className="custom-chip-row">
          <input
            id="customChipAmount"
            type="number"
            min={1}
            step={1}
            value={Number.isFinite(selectedChip) ? selectedChip : ""}
            disabled={disabled}
            onChange={(event) => onSelect(normalizeAmount(Number(event.target.value)))}
          />
          <button
            className={`chip-button chip-${chipTone(normalizedAmount)} custom-chip ${
              !CHIP_VALUES.includes(normalizedAmount as (typeof CHIP_VALUES)[number])
                ? "selected"
                : ""
            }`}
            type="button"
            draggable={!disabled}
            disabled={disabled}
            onClick={() => onSelect(normalizedAmount)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "copy";
              event.dataTransfer.setData(CHIP_TRANSFER_TYPE, String(normalizedAmount));
              event.dataTransfer.setData("text/plain", String(normalizedAmount));
            }}
          >
            {normalizedAmount}
          </button>
        </div>
      </div>
    </div>
  );
}

function CrapsBoard({
  state,
  playerId,
  currentPlayer,
  selectedChip,
  onBet
}: {
  state: PublicGameState | null;
  playerId: string | null;
  currentPlayer: PlayerState | null;
  selectedChip: number;
  onBet: (kind: BetKind, amount: number) => void;
}) {
  return (
    <div className="craps-board">
      {!state?.point ? <span className="point-puck off-puck">OFF</span> : null}
      <div className="number-row">
        {POINT_BET_SPOTS.map(({ point, placeKind, layKind }) => (
          <div className={`number-column ${state?.point === point ? "point-on" : ""}`} key={point}>
            <BoardSpot
              kind={layKind}
              label="LAY"
              sublabel={layPayoutText(point)}
              className="lay-spot"
              state={state}
              playerId={playerId}
              currentPlayer={currentPlayer}
              selectedChip={selectedChip}
              onBet={onBet}
            />
            <div className="number-box">
              {state?.point === point ? <span className="point-puck">ON</span> : null}
              <strong>{point === 6 ? "SIX" : point === 8 ? "EIGHT" : point}</strong>
              <NumberMovedBets state={state} playerId={playerId} point={point} />
            </div>
            <BoardSpot
              kind={placeKind}
              label="PLACE"
              sublabel={placePayoutText(point)}
              className="place-spot"
              state={state}
              playerId={playerId}
              currentPlayer={currentPlayer}
              selectedChip={selectedChip}
              onBet={onBet}
            />
          </div>
        ))}
      </div>

      <div className="middle-row">
        <BoardSpot
          kind="dontCome"
          label="DON'T COME"
          sublabel="Bar 12"
          className="dont-come-spot"
          state={state}
          playerId={playerId}
          currentPlayer={currentPlayer}
          selectedChip={selectedChip}
          onBet={onBet}
          filter={(bet) => bet.kind === "dontCome" && bet.point === null}
        />
        <BoardSpot
          kind="come"
          label="COME"
          sublabel="7 or 11"
          className="come-spot"
          state={state}
          playerId={playerId}
          currentPlayer={currentPlayer}
          selectedChip={selectedChip}
          onBet={onBet}
          filter={(bet) => bet.kind === "come" && bet.point === null}
        />
      </div>

      <div className="prop-row">
        {PROP_BET_SPOTS.map((spot) => (
          <BoardSpot
            key={spot.kind}
            kind={spot.kind}
            label={spot.label}
            sublabel={spot.sublabel}
            className={`prop-spot ${spot.className}`}
            state={state}
            playerId={playerId}
            currentPlayer={currentPlayer}
            selectedChip={selectedChip}
            onBet={onBet}
          />
        ))}
      </div>

      <BoardSpot
        kind="field"
        label="FIELD"
        sublabel="2 pays double • 12 pays triple"
        className="field-spot"
        state={state}
        playerId={playerId}
        currentPlayer={currentPlayer}
        selectedChip={selectedChip}
        onBet={onBet}
      />

      <div className="line-row">
        <div className="line-stack">
          <BoardSpot
            kind="dontPassOdds"
            label="DP ODDS"
            sublabel="No vig"
            className="odds-spot dont-pass-odds-spot"
            state={state}
            playerId={playerId}
            currentPlayer={currentPlayer}
            selectedChip={selectedChip}
            onBet={onBet}
          />
          <BoardSpot
            kind="dontPass"
            label="DON'T PASS BAR"
            sublabel="Bar 12"
            className="dont-pass-spot"
            state={state}
            playerId={playerId}
            currentPlayer={currentPlayer}
            selectedChip={selectedChip}
            onBet={onBet}
          />
        </div>
        <div className="line-stack">
          <BoardSpot
            kind="passOdds"
            label="PASS ODDS"
            sublabel="True odds"
            className="odds-spot pass-odds-spot"
            state={state}
            playerId={playerId}
            currentPlayer={currentPlayer}
            selectedChip={selectedChip}
            onBet={onBet}
          />
          <BoardSpot
            kind="passLine"
            label="PASS LINE"
            sublabel="Come-out contract"
            className="pass-line-spot"
            state={state}
            playerId={playerId}
            currentPlayer={currentPlayer}
            selectedChip={selectedChip}
            onBet={onBet}
          />
        </div>
      </div>
    </div>
  );
}

function BoardSpot({
  kind,
  label,
  sublabel,
  className,
  state,
  playerId,
  currentPlayer,
  selectedChip,
  onBet,
  filter
}: {
  kind: BetKind;
  label: string;
  sublabel: string;
  className: string;
  state: PublicGameState | null;
  playerId: string | null;
  currentPlayer: PlayerState | null;
  selectedChip: number;
  onBet: (kind: BetKind, amount: number) => void;
  filter?: (bet: Bet) => boolean;
}) {
  const visibleBets = (state?.bets ?? []).filter(filter ?? ((bet) => bet.kind === kind));
  const canUseSelected = canPlaceBet(state, currentPlayer, kind, selectedChip);

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    const rawValue =
      event.dataTransfer.getData(CHIP_TRANSFER_TYPE) ||
      event.dataTransfer.getData("text/plain");
    const amount = Number(rawValue);
    if (canPlaceBet(state, currentPlayer, kind, amount)) {
      onBet(kind, amount);
    }
  }

  return (
    <button
      type="button"
      className={`board-spot ${className} ${canUseSelected ? "available" : "unavailable"}`}
      aria-disabled={!canUseSelected}
      title={`${BET_DEFINITIONS[kind].label} • fractional payouts round down`}
      onClick={() => {
        if (canUseSelected) {
          onBet(kind, selectedChip);
        }
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={handleDrop}
    >
      <span className="spot-label">{label}</span>
      <small>{sublabel}</small>
      <BetStack bets={visibleBets} playerId={playerId} players={state?.players ?? {}} />
    </button>
  );
}

function NumberMovedBets({
  state,
  playerId,
  point
}: {
  state: PublicGameState | null;
  playerId: string | null;
  point: PointNumber;
}) {
  const comeBets = (state?.bets ?? []).filter((bet) => bet.kind === "come" && bet.point === point);
  const dontComeBets = (state?.bets ?? []).filter(
    (bet) => bet.kind === "dontCome" && bet.point === point
  );

  if (comeBets.length === 0 && dontComeBets.length === 0) {
    return null;
  }

  return (
    <div className="moved-bets">
      <InlineBetStack
        label="COME"
        bets={comeBets}
        playerId={playerId}
        players={state?.players ?? {}}
      />
      <InlineBetStack
        label="DC"
        bets={dontComeBets}
        playerId={playerId}
        players={state?.players ?? {}}
      />
    </div>
  );
}

function InlineBetStack({
  label,
  bets,
  playerId,
  players
}: {
  label: string;
  bets: Bet[];
  playerId: string | null;
  players: Record<string, PlayerState>;
}) {
  if (bets.length === 0) {
    return null;
  }

  return (
    <div className="inline-stack">
      <span>{label}</span>
      <BetStack bets={bets} playerId={playerId} players={players} compact />
    </div>
  );
}

function BetStack({
  bets,
  playerId,
  players,
  compact = false
}: {
  bets: Bet[];
  playerId: string | null;
  players?: Record<string, PlayerState>;
  compact?: boolean;
}) {
  const groupedBets = groupBetsByPlayer(bets, players ?? {});

  if (groupedBets.length === 0) {
    return null;
  }

  return (
    <span className={`chip-stack ${compact ? "compact" : ""}`}>
      {groupedBets.map((group) => (
        <span
          className={`player-chip ${group.playerId === playerId ? "mine" : ""}`}
          key={group.playerId}
          title={`${group.displayName}: ${group.amount} chips`}
        >
          <span className="stack-chip">{group.amount}</span>
          <small>{group.nameLabel}</small>
        </span>
      ))}
    </span>
  );
}

function BetList({
  bets,
  canRemove,
  onRemoveBet
}: {
  bets: Bet[];
  canRemove: boolean;
  onRemoveBet: (betId: string) => void;
}) {
  if (bets.length === 0) {
    return <EmptyText label="No active bets" />;
  }

  return (
    <div className="bet-list">
      {bets.map((bet) => (
        <div className="bet-row" key={bet.id}>
          <span>{BET_DEFINITIONS[bet.kind].label}</span>
          <strong>{chips(bet.amount)}</strong>
          <small>{bet.point ? `Point ${bet.point}` : "Flat"}</small>
          <button
            className="remove-bet-button"
            type="button"
            disabled={!canRemove}
            onClick={() => onRemoveBet(bet.id)}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function SettlementFeed({ state }: { state: PublicGameState | null }) {
  const items = [...(state?.settlementFeed ?? [])].reverse().slice(0, 18);

  if (items.length === 0) {
    return <EmptyText label="No results yet" />;
  }

  return (
    <div className="settlement-list">
      {items.map((item) => (
        <div className={`settlement-row ${item.outcome}`} key={item.id}>
          <div>
            <strong>{item.displayName}</strong>
            <span>{BET_DEFINITIONS[item.kind].label}</span>
          </div>
          <div>
            <strong>{outcomeLabel(item.outcome)}</strong>
            <span>{settlementAmount(item)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyText({ label }: { label: string }) {
  return <div className="empty-text">{label}</div>;
}

function DiceFace({ value, ghost = false }: { value: number; ghost?: boolean }) {
  return (
    <div className={`die-face value-${value} ${ghost ? "ghost" : ""}`} aria-label={`Die ${value}`}>
      {Array.from({ length: 9 }).map((_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

function canPlaceBet(
  state: PublicGameState | null,
  currentPlayer: PlayerState | null,
  kind: BetKind,
  amount: number
): boolean {
  const definition = BET_DEFINITIONS[kind];
  return Boolean(
    state &&
      currentPlayer &&
      definition &&
      state.betting.status === "open" &&
      definition.allowedPhases.includes(state.phase) &&
      Number.isInteger(amount) &&
      amount > 0 &&
      amount <= currentPlayer.balance
  );
}

type SoundKind = "bet" | "chat" | "lock" | "roll" | "result";

function useAudioEffects() {
  const contextRef = useRef<AudioContext | null>(null);

  const getContext = useCallback(() => {
    if (contextRef.current) {
      return contextRef.current;
    }

    const AudioContextClass =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextClass) {
      return null;
    }

    contextRef.current = new AudioContextClass();
    return contextRef.current;
  }, []);

  const playTone = useCallback(
    (
      context: AudioContext,
      frequency: number,
      start: number,
      duration: number,
      type: OscillatorType,
      volume = 0.05
    ) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    },
    []
  );

  const play = useCallback(
    (kind: SoundKind) => {
      const context = getContext();
      if (!context) {
        return;
      }

      void context.resume();
      const start = context.currentTime + 0.01;

      if (kind === "bet") {
        playTone(context, 520, start, 0.055, "triangle", 0.04);
        playTone(context, 720, start + 0.055, 0.07, "triangle", 0.035);
      } else if (kind === "chat") {
        playTone(context, 660, start, 0.08, "sine", 0.03);
      } else if (kind === "lock") {
        playTone(context, 880, start, 0.08, "square", 0.035);
        playTone(context, 660, start + 0.09, 0.1, "square", 0.035);
      } else if (kind === "roll") {
        playTone(context, 120, start, 0.12, "sawtooth", 0.035);
        playTone(context, 180, start + 0.08, 0.12, "sawtooth", 0.03);
      } else {
        playTone(context, 260, start, 0.08, "triangle", 0.045);
        playTone(context, 520, start + 0.08, 0.12, "triangle", 0.04);
      }
    },
    [getContext, playTone]
  );

  return useMemo(() => ({ play }), [play]);
}

function groupBetsByPlayer(
  bets: Bet[],
  players: Record<string, PlayerState>
): Array<{
  playerId: string;
  displayName: string;
  nameLabel: string;
  amount: number;
}> {
  const grouped = new Map<string, { displayName: string; amount: number; joinedAt: number }>();

  for (const bet of bets) {
    const player = players[bet.playerId];
    const existing = grouped.get(bet.playerId);
    if (existing) {
      existing.amount += bet.amount;
    } else {
      grouped.set(bet.playerId, {
        displayName: player?.displayName ?? "Player",
        amount: bet.amount,
        joinedAt: player?.joinedAt ?? bet.createdAt
      });
    }
  }

  return [...grouped.entries()]
    .sort(([, a], [, b]) => a.joinedAt - b.joinedAt)
    .map(([playerId, group]) => ({
      playerId,
      displayName: group.displayName,
      nameLabel: shortNameFor(group.displayName),
      amount: group.amount
    }));
}

function shortNameFor(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "Player";
  }

  if (parts.length > 1) {
    return `${parts[0]} ${parts[1][0]}.`.slice(0, 10);
  }

  return parts[0].slice(0, 9);
}

function outcomeLabel(outcome: SettlementOutcome): string {
  switch (outcome) {
    case "win":
      return "Won";
    case "lose":
      return "Lost";
    case "push":
      return "Push";
    case "collect":
      return "Collected";
    case "moveToPoint":
      return "Moved";
    default:
      return outcome;
  }
}

function settlementAmount(item: PublicGameState["settlementFeed"][number]): string {
  if (item.outcome === "lose" || item.outcome === "moveToPoint") {
    return item.description;
  }
  if (item.outcome === "push") {
    return `Returned ${chips(item.credit)}`;
  }
  return `+${chips(item.profit)}`;
}

function chipTone(value: number): string {
  if (value >= 100) {
    return "black";
  }
  if (value >= 25) {
    return "green";
  }
  if (value >= 10) {
    return "blue";
  }
  if (value >= 5) {
    return "red";
  }
  return "white";
}

function normalizeAmount(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.floor(value);
}

function placePayoutText(point: PointNumber): string {
  if (point === 4 || point === 10) {
    return "Pays 9:5";
  }
  if (point === 5 || point === 9) {
    return "Pays 7:5";
  }
  return "Pays 7:6";
}

function layPayoutText(point: PointNumber): string {
  if (point === 4 || point === 10) {
    return "Wins 1:2";
  }
  if (point === 5 || point === 9) {
    return "Wins 2:3";
  }
  return "Wins 5:6";
}

function rollResultLabel(die1: number, die2: number): string {
  const total = die1 + die2;
  if ((total === 4 || total === 6 || total === 8 || total === 10) && die1 === die2) {
    return `Hard ${total}`;
  }

  if (total === 4 || total === 6 || total === 8 || total === 10) {
    return `Easy ${total}`;
  }

  return String(total);
}

function chips(value: number): string {
  return `${value.toLocaleString()} chips`;
}

function signedChips(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${chips(Math.abs(value))}`;
}

function formatCountdown(ms: number): string {
  return `${Math.ceil(ms / 1000)}s`;
}

async function acquireAccessToken(
  authClient: PublicClientApplication,
  account: AccountInfo
): Promise<string> {
  try {
    const result = await authClient.acquireTokenSilent({
      account,
      scopes: [entraApiScope]
    });
    return result.accessToken;
  } catch {
    const result = await authClient.acquireTokenPopup({
      account,
      scopes: [entraApiScope],
      redirectUri: entraPopupRedirectUri
    });
    return result.accessToken;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error.";
}
