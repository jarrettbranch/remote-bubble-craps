import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { GameState, PlayerState } from "@bubble-craps/shared";

export type EventLogType =
  | "player_authenticated"
  | "player_joined"
  | "player_disconnected"
  | "bet_placed"
  | "bet_removed"
  | "chips_rebought"
  | "roll_requested"
  | "roll_timeout"
  | "dice_result"
  | "payouts"
  | "chat";

export interface EventLogEntry {
  id: number;
  type: EventLogType;
  payload: unknown;
  createdAt: string;
}

export interface StoredUser {
  id: string;
  authProvider: string;
  authSubject: string;
  displayName: string;
  balance: number;
  totalBuyIns: number;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
}

interface StoredUserRow {
  id: string;
  auth_provider: string;
  auth_subject: string;
  display_name: string;
  balance: number;
  total_buy_ins: number;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

export class EventStore {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        auth_provider TEXT NOT NULL,
        auth_subject TEXT NOT NULL,
        display_name TEXT NOT NULL,
        balance INTEGER NOT NULL,
        total_buy_ins INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (auth_provider, auth_subject)
      );

      CREATE TABLE IF NOT EXISTS game_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  append(type: EventLogType, payload: unknown): void {
    this.db
      .prepare("INSERT INTO events (type, payload) VALUES (?, ?)")
      .run(type, JSON.stringify(payload));
  }

  recent(limit = 100): EventLogEntry[] {
    const rows = this.db
      .prepare(
        "SELECT id, type, payload, created_at as createdAt FROM events ORDER BY id DESC LIMIT ?"
      )
      .all(limit) as Array<{
      id: number;
      type: EventLogType;
      payload: string;
      createdAt: string;
    }>;

    return rows.reverse().map((row) => ({
      id: row.id,
      type: row.type,
      payload: JSON.parse(row.payload) as unknown,
      createdAt: row.createdAt
    }));
  }

  getOrCreateUserForIdentity(input: {
    authProvider: string;
    authSubject: string;
    displayName: string;
    startingBalance: number;
  }): StoredUser {
    const existing = this.db
      .prepare(
        `SELECT * FROM users
         WHERE auth_provider = ? AND auth_subject = ?
         LIMIT 1`
      )
      .get(input.authProvider, input.authSubject) as StoredUserRow | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE users
           SET display_name = ?, updated_at = datetime('now'), last_seen_at = datetime('now')
           WHERE id = ?`
        )
        .run(input.displayName, existing.id);
      return this.userById(existing.id) ?? rowToUser(existing);
    }

    const userId = randomUUID();
    this.db
      .prepare(
        `INSERT INTO users (
          id,
          auth_provider,
          auth_subject,
          display_name,
          balance,
          total_buy_ins
        ) VALUES (?, ?, ?, ?, ?, 0)`
      )
      .run(
        userId,
        input.authProvider,
        input.authSubject,
        input.displayName,
        input.startingBalance
      );

    const user = this.userById(userId);
    if (!user) {
      throw new Error("Failed to create user.");
    }
    return user;
  }

  createLocalUser(input: {
    id: string;
    displayName: string;
    startingBalance: number;
  }): StoredUser {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO users (
          id,
          auth_provider,
          auth_subject,
          display_name,
          balance,
          total_buy_ins
        ) VALUES (?, 'local', ?, ?, ?, 0)`
      )
      .run(
        input.id,
        `local:${input.id}`,
        input.displayName,
        input.startingBalance
      );

    const user = this.userById(input.id);
    if (!user) {
      throw new Error("Failed to create local user.");
    }
    return user;
  }

  userById(id: string): StoredUser | null {
    const row = this.db
      .prepare("SELECT * FROM users WHERE id = ? LIMIT 1")
      .get(id) as StoredUserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  updateUserFromPlayer(player: PlayerState): void {
    this.db
      .prepare(
        `UPDATE users
         SET display_name = ?,
             balance = ?,
             total_buy_ins = ?,
             updated_at = datetime('now')
         WHERE id = ?`
      )
      .run(player.displayName, player.balance, player.totalBuyIns, player.id);
  }

  saveGameState(state: GameState): void {
    this.db
      .prepare(
        `INSERT INTO game_state (id, payload, updated_at)
         VALUES (1, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           payload = excluded.payload,
           updated_at = excluded.updated_at`
      )
      .run(JSON.stringify(state));
  }

  loadGameState(): GameState | null {
    const row = this.db
      .prepare("SELECT payload FROM game_state WHERE id = 1")
      .get() as { payload: string } | undefined;

    return row ? (JSON.parse(row.payload) as GameState) : null;
  }

  close(): void {
    this.db.close();
  }
}

function rowToUser(row: StoredUserRow): StoredUser {
  return {
    id: row.id,
    authProvider: row.auth_provider,
    authSubject: row.auth_subject,
    displayName: row.display_name,
    balance: row.balance,
    totalBuyIns: row.total_buy_ins,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at
  };
}
