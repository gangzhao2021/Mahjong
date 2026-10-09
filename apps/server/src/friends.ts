/**
 * Friend rooms' waiting rooms: the host opens one and gets a 6-digit number,
 * friends join by typing it in, and the host starts the game (AI fill the
 * empty seats). Held in memory; a waiting room disappears when everyone has
 * left it or the game starts.
 */
import type { FriendRoomInfo, FriendRoomRejection } from '@mahjong/protocol';

export const FRIEND_ROOM_SEATS = 4;

export interface FriendMember {
  playerId: string;
  name: string;
  avatar: string;
}

export interface FriendTable {
  code: string;
  hostId: string;
  /** In join order; the host is first. */
  members: FriendMember[];
  handsPerGame: number;
  xueliu: boolean;
}

export class FriendTables {
  private readonly tables = new Map<string, FriendTable>();
  private readonly memberOf = new Map<string, string>();

  constructor(
    /** Pushes the current waiting room (or null) to one player's open sockets. */
    private readonly notify: (playerId: string, room: FriendRoomInfo | null) => void,
    private readonly isOnline: (playerId: string) => boolean,
    private readonly random: () => number = Math.random,
  ) {}

  tableOf(playerId: string): FriendTable | null {
    const code = this.memberOf.get(playerId);
    return code ? (this.tables.get(code) ?? null) : null;
  }

  create(host: FriendMember, handsPerGame: number, xueliu = false): FriendTable {
    this.leave(host.playerId);
    const table: FriendTable = { code: this.freshCode(), hostId: host.playerId, members: [host], handsPerGame, xueliu };
    this.tables.set(table.code, table);
    this.memberOf.set(host.playerId, table.code);
    this.broadcast(table);
    return table;
  }

  join(member: FriendMember, code: string): FriendTable | FriendRoomRejection {
    const table = this.tables.get(code.trim());
    if (!table) return 'notFound';
    if (table.members.some((m) => m.playerId === member.playerId)) return table;
    if (table.members.length >= FRIEND_ROOM_SEATS) return 'full';
    this.leave(member.playerId);
    table.members.push(member);
    this.memberOf.set(member.playerId, table.code);
    this.broadcast(table);
    return table;
  }

  /** Leaving passes the host role to the next member; the last one out closes the room. */
  leave(playerId: string): void {
    const table = this.tableOf(playerId);
    if (!table) return;
    table.members = table.members.filter((m) => m.playerId !== playerId);
    this.memberOf.delete(playerId);
    this.notify(playerId, null);
    if (!table.members.length) {
      this.tables.delete(table.code);
      return;
    }
    if (table.hostId === playerId) table.hostId = table.members[0].playerId;
    this.broadcast(table);
  }

  /** The game started: the waiting room is gone for everyone. */
  close(table: FriendTable): void {
    this.tables.delete(table.code);
    for (const m of table.members) {
      this.memberOf.delete(m.playerId);
      this.notify(m.playerId, null);
    }
  }

  info(table: FriendTable): FriendRoomInfo {
    return {
      code: table.code,
      members: table.members.map((m) => ({ ...m, isHost: m.playerId === table.hostId, online: this.isOnline(m.playerId) })),
      handsPerGame: table.handsPerGame,
      maxPlayers: FRIEND_ROOM_SEATS,
      xueliu: table.xueliu,
    };
  }

  /** Re-sends the room to everyone in it (membership or someone's connection changed). */
  broadcast(table: FriendTable): void {
    const info = this.info(table);
    for (const m of table.members) this.notify(m.playerId, info);
  }

  private freshCode(): string {
    for (;;) {
      const code = String(100000 + Math.floor(this.random() * 900000));
      if (!this.tables.has(code)) return code;
    }
  }
}
