// Linking staff to Telegram, and the limited identity their messages run as.
//
// A staff member's Telegram messages never run as the manager. Each linked
// person gets a random "principal" email that only exists in our database.
// Manager actions check team access, which this identity doesn't have, so a
// staff message can only reach the staff actions below.

import { fail } from "@agent-native/core/action";
import { and, eq, ne } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import { logActivity, notifyTeamChanged } from "./activity.js";

const PRINCIPAL_DOMAIN = "staff.rota.invalid";
// No 0/O/1/I so codes are easy to read aloud or type.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomString(length: number, alphabet: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function newInviteCode(): string {
  return randomString(8, CODE_ALPHABET);
}

function newPrincipal(): string {
  return `staff-${randomString(32, "abcdefghijklmnopqrstuvwxyz0123456789")}@${PRINCIPAL_DOMAIN}`;
}

export function isStaffPrincipal(email: string | null | undefined): boolean {
  return Boolean(email?.endsWith(`@${PRINCIPAL_DOMAIN}`));
}

/** t.me deep link that opens the bot and sends `/start <code>`, when the bot username is known. */
export function inviteLink(code: string): string | null {
  const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "").trim(); // guard:allow-env-credential — public bot username, not a secret
  return username ? `https://t.me/${username}?start=${code}` : null;
}

export interface LinkedStaff {
  staffId: string;
  staffName: string;
  teamId: string;
  teamName: string;
  timezone: string;
  principal: string | null;
}

async function staffWhere(condition: ReturnType<typeof eq>): Promise<LinkedStaff | null> {
  const { staff, teams } = schema;
  const [row] = await getDb()
    .select({
      staffId: staff.id,
      staffName: staff.name,
      teamId: teams.id,
      teamName: teams.name,
      timezone: teams.timezone,
      principal: staff.telegramPrincipal,
      active: staff.active,
    })
    .from(staff)
    .innerJoin(teams, eq(teams.id, staff.teamId))
    .where(condition)
    .limit(1);
  if (!row || !row.active) return null;
  const { active: _active, ...linked } = row;
  return linked;
}

export function findStaffByChat(chatId: string): Promise<LinkedStaff | null> {
  return staffWhere(eq(schema.staff.telegramChatId, chatId));
}

/**
 * Use an invite code: connect this Telegram chat to the staff member and give
 * them a fresh principal. A chat belongs to one person, so any older link from
 * the same chat is removed.
 */
export async function linkTelegram(code: string, chatId: string): Promise<LinkedStaff | null> {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,12}$/.test(normalized)) return null;
  const target = await staffWhere(eq(schema.staff.telegramInviteCode, normalized));
  if (!target) return null;
  const principal = newPrincipal();
  const { staff } = schema;
  await getDb().transaction(async (tx) => {
    await tx
      .update(staff)
      .set({ telegramChatId: null, telegramPrincipal: null, telegramLinkedAt: null })
      .where(and(eq(staff.telegramChatId, chatId), ne(staff.id, target.staffId)));
    await tx
      .update(staff)
      .set({
        telegramChatId: chatId,
        telegramPrincipal: principal,
        telegramLinkedAt: new Date().toISOString(),
        telegramInviteCode: null,
      })
      .where(eq(staff.id, target.staffId));
  });
  await logActivity(getDb(), {
    teamId: target.teamId,
    actor: { kind: "staff", name: target.staffName },
    kind: "telegram",
    text: `${target.staffName} connected Telegram`,
  });
  notifyTeamChanged(target.teamId);
  return { ...target, principal };
}

/** The staff member behind a Telegram-originated action call, or 403. */
export async function requireStaffCaller(ctx: { userEmail?: string | null } | undefined): Promise<LinkedStaff> {
  const email = ctx?.userEmail;
  if (!email || !isStaffPrincipal(email)) {
    fail("This action is only for staff messaging the team's Telegram bot.", {
      errorCode: "forbidden",
      statusCode: 403,
    });
  }
  const linked = await staffWhere(eq(schema.staff.telegramPrincipal, email));
  if (!linked) fail("This Telegram account isn't linked to a staff member anymore.", { errorCode: "forbidden", statusCode: 403 });
  return linked;
}
