import { json, readBody, write } from "@/lib/http";
import { createAdd } from "@/lib/repo";
import { LIMITS } from "@/lib/types";
import { addStore, text, UUID_PATTERN } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const POST = write(async (req: Request) => {
  const body = await readBody(req);
  if (typeof body.id !== "string" || !UUID_PATTERN.test(body.id)) {
    return json({ error: "id must be a UUID." }, 400);
  }
  const store = addStore(body.store);
  if (!store.ok) return json({ error: store.error }, 400);
  const value = text(body.text, "Add", LIMITS.add, { required: true });
  if (!value.ok) return json({ error: value.error }, 400);
  const add = await createAdd({ id: body.id.toLowerCase(), store: store.value, text: value.value });
  return json({ add }, 201);
});
