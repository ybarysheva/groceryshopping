import { json, read, write } from "@/lib/http";
import { listRounds, startRound } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const GET = read(async () => json({ rounds: await listRounds() }));

export const POST = write(async () => json({ round: await startRound() }));
