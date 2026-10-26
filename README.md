# Grocery list

A shared, phone-friendly grocery list for Amazon Fresh and Netcost Market.

- `/` is the shared page. Anyone with the link can leave a note on an item, add something, or remove an item with its × button. No sign-in. Removing hides the item (the same as Hide on `/edit`), with Undo in the toast; bring it back with Show on `/edit`.
- `/edit` is where the list is managed: edit items, import a new list, mark it final, copy it for Claude, start a new round.
- `/api/export` is the read-only order that Claude reads to place the orders.

There are no accounts. Anyone with the link can read and write, by design. Writes are rate limited per IP (30 a minute), and pages are marked `noindex`.

## Stack

Next.js (App Router, TypeScript), plain CSS, and Upstash Redis from the Vercel Marketplace for storage. Runtime dependencies: `next`, `react`, `react-dom`, `@upstash/redis`.

## Run locally

```bash
npm install
npm run seed   # first run only; loads data/seed.json
npm run dev    # http://localhost:3000
```

Without Upstash credentials, local dev stores everything in `.data/local-db.json` (git-ignored). To use the real store locally instead:

```bash
vercel link
vercel env pull .env.local
npm run dev
```

## Deploy

1. Push this folder to a GitHub repo and import it in Vercel (or `vercel link` then connect the repo under Project, Settings, Git). Pushes to `main` deploy production.
2. Add storage: Vercel dashboard, the project, **Storage**, **Create Database**, **Upstash** (Redis), plan **Free**, connect to all environments (Production, Preview, Development). Choose the option where Vercel creates the Upstash account, so no separate signup is needed. This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` on the project. `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` also work.
3. Redeploy so the new env vars take effect.
4. Seed once: `vercel env pull .env.local && npm run seed`. It only writes when the store has never been seeded and has no items. Running it again changes nothing.
5. Make production public: project, Settings, **Deployment Protection**. Vercel Authentication must not cover production. "Standard Protection" (previews only) is fine; "All Deployments" is not.

On Vercel, if the Redis env vars are missing, the API returns a clear "Storage isn't connected" error instead of silently using a file.

## Editing the list

The list lives in Redis and changes only through `/edit`. `data/seed.json` is a first-run starting point only: the app never reads it, and deploys never reset the list.

On `/edit` you can:

- Edit any item inline: name, store, section, size, image URL, sort, shown/hidden. Delete asks for confirmation on the page.
- **Add item.**
- **Import list**, the usual way to change the list each round (see below).
- **Mark as final** / back to draft. The status and time show at the top and in the export.
- **Copy for Claude**: a ready-to-paste message with the status, the live export URL and the full order text.
- **Start a new round**: saves the current notes and adds under Past rounds with today's date, clears them, and sets the status back to draft. Items stay.
- **Past rounds**: read-only, newest first.

### Import format

Paste a JSON array of items:

```json
[
  {"store": "Amazon Fresh", "section": "Produce", "name": "Bananas"},
  {"store": "Netcost", "section": "Deli", "name": "Doktorskaya", "size": "about 0.5 lb"}
]
```

- Required: `store` (`"Amazon Fresh"` or `"Netcost"`), `section`, `name`.
- Optional: `id`, `size`, `price`, `imageUrl`, `sort`, `active` (defaults to `true`).
- `price` is free text up to 40 characters, e.g. `"$5.49"`, `"$7.69/lb"` or `"$6.49/lb sale, reg. $7.69"`. The server records when each price was set (`priceAt`); you never send that.
- Matching: by `id` when given, otherwise by store + name (case-insensitive). Matched items keep their id, their photo and price (unless a new `imageUrl` / `price` is given) and any note. To clear a price, edit the item on `/edit`. Unmatched entries become new items. Existing items not in the paste are removed, along with their notes.
- Missing `sort` means the order in the pasted array.
- **Preview** shows what will be added, changed, reordered and removed, then **Replace list** applies it. If the list changed between preview and replace, you're asked to preview again.
- Errors name the entry and the problem, for example `Entry 4 ("kefir"): same store and name as entry 3.`
- **Copy current list as JSON** produces this format with ids. Pasting it straight back changes nothing.

## Export (stable: Claude depends on this)

`GET /api/export` returns JSON:

```json
{
  "generatedAt": "2026-10-25T18:10:00.000Z",
  "status": "final",
  "finalizedAt": "2026-10-25T18:10:00.000Z",
  "orders": [
    {
      "store": "Amazon Fresh",
      "items": [{"store": "Amazon Fresh", "section": "Produce", "name": "Blueberries", "size": null, "price": "$4.99", "priceAt": "2026-10-25T21:50:00.000Z", "note": "get 2"}],
      "adds": [{"store": "Amazon Fresh", "text": "Milk"}]
    },
    {"store": "Netcost", "items": [], "adds": []},
    {"store": "Either", "items": [], "adds": [{"store": "Either", "text": "Paper towels"}]}
  ]
}
```

`GET /api/export?format=text` returns `text/plain; charset=utf-8`:

```
Grocery order (status: final, Oct 25, 2026 2:10 PM)

AMAZON FRESH
Produce
- Bananas
- Blueberries ($4.99; note: get 2)
Meat and fish
- Chicken thighs, boneless skinless, about 6 lb (2 packs)
Added
- Milk

NETCOST
...

EITHER STORE
- Paper towels
```

- Only shown (active) items. Price and note appear inline in parentheses, price first, separated by `;`. Adds go under "Added" in their store; "Either" adds get their own block. A store with nothing on it is left out.
- Times are Brooklyn time (America/New_York). A draft reads `(status: draft)`.
- `Cache-Control: no-store`, `Access-Control-Allow-Origin: *`.

## Data model (Redis)

One hash field per record, so concurrent writes to different items, notes or adds never overwrite each other:

| Key | Type | Contents |
|---|---|---|
| `g:items` | hash | item id → `{id, store, section, name, size?, imageUrl?, price?, priceAt?, active, sort}` |
| `g:notes` | hash | item id → `{text, updatedAt}` |
| `g:adds` | hash | add id (client UUID) → `{id, store, text, createdAt}` |
| `g:meta` | hash | `status`, `finalizedAt`, `seededAt` |
| `g:rounds` | list | newest first: `{id, date, notes[{store,item,text}], adds[{store,text}]}` |
| `g:rl:<ip>:<minute>` | counter | write rate limit, expires after 70s |

- Item edits send only the changed fields and the server merges them.
- Import replaces `g:items` in one MULTI/EXEC transaction, guarded by a fingerprint taken at preview.
- New round deletes only the note and add fields it archived, so a note saved at that moment survives.
- Adds use client-generated UUIDs, so a retried request can't create a duplicate.

## Notes

- Both pages are static shells that load data from the API in the browser, so nothing is cached at build. All `/api` routes are `force-dynamic` and send `no-store`.
- Pages refresh on focus, on tab return and every 30 seconds while visible. An open note editor is never overwritten.
- Writes update the screen immediately. If the server rejects one, it's undone and a toast explains why.

## Prices

- Each item can have an optional `price` (free text). It shows under the item on both pages, with its "as of" date on `/edit`, and in the export.
- **Netcost** prices were taken from Netcost's online shop for the **Neptune Ave, Brooklyn** store. Prices differ by store, and specials change weekly. The site can't refresh them by itself, because Netcost blocks requests from servers, so they're a snapshot. To refresh, ask Claude Code to look them up again in a browser, then apply them with Import.
- **Amazon Fresh** prices aren't pulled automatically. Enter them on `/edit`, or include `price` in the JSON you paste into Import.
