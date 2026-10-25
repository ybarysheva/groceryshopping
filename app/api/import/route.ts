import { json, readBody, write } from "@/lib/http";
import { applyImport, previewImport } from "@/lib/repo";
import { importList } from "@/lib/validate";

export const dynamic = "force-dynamic";

// Body: { text: "<pasted JSON>", mode: "preview" } or { text, mode: "apply", basis: "<from preview>" }
export const POST = write(async (req: Request) => {
  const body = await readBody(req);
  if (typeof body.text !== "string") return json({ error: "Paste the list first." }, 400);
  const parsed = importList(body.text);
  if (!parsed.ok) return json({ error: parsed.error, errors: parsed.errors ?? [parsed.error] }, 400);

  if (body.mode === "apply") {
    if (typeof body.basis !== "string") return json({ error: "Preview the list before replacing." }, 400);
    return json({ plan: await applyImport(parsed.value, body.basis) });
  }
  return json({ plan: await previewImport(parsed.value) });
});
