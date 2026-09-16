# Research Cat · MCP server

The same literature-graph engine as the DSH plugin, exposed as a **standard MCP server**. One implementation, two transports:

| Transport | Entry point | For |
|---|---|---|
| **stdio** | `bin/stdio.mjs` | local clients: **Codex CLI**, **Claude Code**, Cursor, anything that can spawn a process |
| **Streamable HTTP** | `bin/http.mjs` | clients that run in someone else's cloud and cannot start a local process — **ChatGPT connectors**, plus remote/self-hosted clients |

Because it is plain MCP, this does not only work in Codex and ChatGPT: the same server also serves Claude Code, Cursor, and any other MCP host.

## Install

```bash
cd mcp
npm install
```

## Codex CLI

Syntax verified against `codex-cli 0.154.0` (`codex mcp add <NAME> (--url <URL> | -- <COMMAND>...)`):

```bash
cd mcp
codex mcp add research-cat -- node "$PWD/bin/stdio.mjs"
codex mcp list          # confirm it is registered
```

The entry is written to `~/.codex/config.toml` as `[mcp_servers.research-cat]`. Remove it with `codex mcp remove research-cat`.

## Claude Code

Syntax verified against Claude Code `2.1.270`:

```bash
claude mcp add research-cat -- node "$PWD/bin/stdio.mjs"          # stdio
claude mcp add --transport http research-cat https://host/mcp     # or a remote HTTP server
claude mcp list
```

## ChatGPT

**Read this before wiring it up.** I could not load OpenAI's own documentation while writing this (`openai.com` answered HTTP 403 through Cloudflare), so the ChatGPT side below is stated as *constraints that follow from how ChatGPT runs*, not as a verified step-by-step. Confirm the current UI and requirements against OpenAI's docs.

What is certain:

- ChatGPT executes in OpenAI's cloud, so it **cannot** launch a local `stdio` server. It can only reach a **publicly reachable HTTPS URL** speaking MCP over HTTP.
- So run the HTTP entry point, expose it, and give ChatGPT the public URL ending in `/mcp`:

```bash
cd mcp
PORT=8787 MCP_PATH=/mcp node bin/http.mjs      # serves http://127.0.0.1:8787/mcp
# then expose that port publicly (tunnel / reverse proxy / a host of your own)
```

- **There is no authentication in this server.** Anyone who can reach the URL can search and expand. If you expose it publicly, put it behind a tunnel or an auth proxy, and set `MCP_ALLOW_ORIGIN` instead of the permissive default.
- Add it in ChatGPT as a custom connector / app (developer mode), pointing at `https://<your-host>/mcp`.

Health check for whatever proxy you use: `GET /health` returns `{"ok":true,"name":"research-cat-mcp","sessions":N}`.

## DSH

DeepSeek Harness also consumes MCP, but this repository does not document how to register a third-party MCP server inside a DSH profile — I did not verify that surface. Inside DSH you probably want the **plugin form** in the repository root instead, because only that form can draw the graph panel.

## Tools

| Tool | Arguments | Returns |
|---|---|---|
| `search_papers` | `query` (title / author / topic / DOI) | up to 20 matches with year, venue, citation count and OpenAlex work id |
| `add_paper` | `id` | adds the paper to the collection (a graph seed) |
| `expand_paper` | `id`, `kind` = `references` \| `citations` \| `related` | pulls the paper's neighbours into the graph |
| `paper_details` | `id` | title, authors, venue, year, citations, DOI, OpenAlex link, abstract |
| `list_collection` | — | the collection plus graph size and per-kind link counts |
| `clear_collection` | — | drops the collection and graph for this session |

Suggested flow: `search_papers` → `add_paper` → `expand_paper` → `list_collection` / `paper_details`. The server sends this as MCP `instructions`, so the model sees it on connect.

## State model

- Every MCP **session** gets its **own** collection and graph, so concurrent users never see each other's data. This is asserted by `test/smoke-http.mjs`, which opens two sessions and checks that a paper collected in one does not appear in the other.
- State is **in memory only**: no database, no files, no `localStorage`. It disappears when the session ends.
- OpenAlex responses are cached per session (URL-keyed, cleared past 240 entries).

## Limits

- search: 20 results per call
- `references` / `related`: at most 30 neighbours each, per expand
- `citations`: the **25 most cited** citing papers, not exhaustive
- a graph holds at most **400** papers; clear it to keep expanding
- `related` is empty for some works (OpenAlex itself reports none)

## Verify it yourself

```bash
cd mcp
npm test                       # stdio end-to-end against live OpenAlex (16 checks)
node test/smoke-http.mjs       # Streamable HTTP end-to-end + session isolation (11 checks)
```

Both suites talk to the real OpenAlex API; the stdio suite also checks that re-expanding a paper adds zero new nodes (dedup) and that bad input is reported as a tool error rather than a crash.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `MCP_PORT` | `8787` | HTTP listen port |
| `HOST` | `127.0.0.1` | HTTP bind address — set `0.0.0.0` inside a container |
| `MCP_PATH` | `/mcp` | HTTP endpoint path |
| `MCP_JSON_RESPONSE` | off | `1` = plain JSON responses instead of SSE streams (easier to debug) |
| `MCP_ALLOW_ORIGIN` | `*` | `Access-Control-Allow-Origin` for the HTTP endpoint |
| `RESEARCH_CAT_MAILTO` | `research-cat-mcp@localhost` | contact address sent to OpenAlex's polite pool |

## What this form cannot do

The graph **panel** does not exist here. Codex, ChatGPT and the like are text surfaces: you get the tools and their text output, not the radial graph, node colours or the detail pane. For the visual workbench use the plugin form in the repository root. This is a hard boundary, not a missing feature.

## License

[MIT](../LICENSE) — same as the repository.
