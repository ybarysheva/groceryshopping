import { json, write } from "@/lib/http";
import { setRemoved } from "@/lib/repo";
import { ID_PATTERN } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// PUT takes an item off this round's order; DELETE puts it back.
async function itemId(ctx: Ctx) {
  const { id } = await ctx.params;
  return ID_PATTERN.test(id) ? id : null;
}

export const PUT = write(async (_req: Request, ctx: Ctx) => {
  const id = await itemId(ctx);
  if (!id) return json({ error: "Unknown item." }, 404);
  return json({ removal: await setRemoved(id, true) });
});

export const DELETE = write(async (_req: Request, ctx: Ctx) => {
  const id = await itemId(ctx);
  if (!id) return json({ error: "Unknown item." }, 404);
  return json({ removal: await setRemoved(id, false) });
});
