import { json, write } from "@/lib/http";
import { deleteAdd } from "@/lib/repo";
import { UUID_PATTERN } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = write(async (_req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  if (!UUID_PATTERN.test(id)) return json({ error: "Unknown add." }, 404);
  await deleteAdd(id.toLowerCase());
  return json({ ok: true });
});
