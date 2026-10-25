import { json, readBody, write } from "@/lib/http";
import { setNote } from "@/lib/repo";
import { LIMITS } from "@/lib/types";
import { ID_PATTERN, text } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function itemId(ctx: Ctx) {
  const { id } = await ctx.params;
  return ID_PATTERN.test(id) ? id : null;
}

export const PUT = write(async (req: Request, ctx: Ctx) => {
  const id = await itemId(ctx);
  if (!id) return json({ error: "Unknown item." }, 404);
  const body = await readBody(req);
  const note = text(body.text, "Note", LIMITS.note);
  if (!note.ok) return json({ error: note.error }, 400);
  return json({ note: await setNote(id, note.value) });
});

export const DELETE = write(async (_req: Request, ctx: Ctx) => {
  const id = await itemId(ctx);
  if (!id) return json({ error: "Unknown item." }, 404);
  return json({ note: await setNote(id, "") });
});
