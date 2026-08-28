# Prescripto MCP servers

Exposes the Prescripto tools to an MCP host such as Claude Desktop, so you can
ask about your appointments or your practice in a normal conversation.

**There are two servers, and they are separate on purpose** — separate
processes, separate registries, separate token files. Neither can reach the
other's tools. A patient token is refused by the doctor server and vice versa,
even though both signatures are perfectly valid.

| | Patient | Doctor |
|---|---|---|
| Script | `patient-server.js` | `doctor-server.js` |
| Tools | `search_doctors`, `get_doctor`, `list_specialities`, `check_availability`, `suggest_speciality`, `my_appointments` | `my_schedule`, `schedule_gaps`, `patients_needing_followup`, `my_stats` |
| Token file variable | `PRESCRIPTO_TOKEN_FILE` | `PRESCRIPTO_DOCTOR_TOKEN_FILE` |
| Identity | one patient | one doctor |
| Transport | stdio — the host launches it as a subprocess | same |
| Writes | none | none |

**Steps 1-5 below set up the patient server.** The doctor server is the same
process with three substitutions — see
[The doctor server](#the-doctor-server) at the end.

---

## Before you start

- **Node 20 or newer** (`node --version`). This was built and tested on 22.17.
- **`backend/.env` must exist and be filled in.** The server reads it to find
  the database and `JWT_SECRET`. You do **not** put its path in any config —
  the server locates it from its own file location.
- **Whatever `backend/.env` points at must be running.** See
  [Which database am I talking to?](#which-database-am-i-talking-to) — with the
  default `DB_HOST=localhost` that means your local MySQL.

---

## Step 1 — Install the server's dependencies

`mcp/` is its own npm root. Installing in `backend/` does **not** cover it.

```bash
cd mcp
npm install
```

Then check it starts (it will say it is not authenticated — that is Step 2):

```bash
npm run start
```

You should see one line on stderr ending `…6 patient tool(s) registered`.
Press `Ctrl+C` to stop it.

---

## Step 2 — Get a patient access token

The server acts as whichever patient the token belongs to. The demo account is
`demo@prescripto.com`.

**Recommended — from the browser**, because your password never touches a
command line or your shell history:

1. Start the backend (`cd backend && npm run server`) and the patient app
   (`cd frontend && npm run dev`).
2. Open <http://localhost:5173> and sign in as the patient.
3. Open DevTools (`F12`) → **Console**, and run:

   ```js
   copy(localStorage.getItem('token'))
   ```

   The token is now on your clipboard. It is a long string beginning `eyJ`.

**Alternative — from the API.** Note your password will be stored in your shell
history, and the login endpoint is rate limited, so don't loop on it:

```bash
curl -s -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"demo@prescripto.com\",\"password\":\"YOUR_PASSWORD\"}"
```

Copy the value of `token` from the JSON response.

---

## Step 3 — Save the token to a file

> **This file is a live credential.** Anyone holding it can read that patient's
> appointments. Treat it like a password.

**Put it outside the repository.** That is simpler and safer than relying on a
`.gitignore` rule, because a file that isn't in the working tree cannot be
committed by accident.

**Windows** (PowerShell):

```powershell
mkdir "$env:USERPROFILE\.prescripto" -Force
"PASTE_YOUR_TOKEN_HERE" | Out-File -NoNewline -Encoding ascii "$env:USERPROFILE\.prescripto\mcp-token"
```

**macOS / Linux:**

```bash
mkdir -p ~/.prescripto
printf '%s' 'PASTE_YOUR_TOKEN_HERE' > ~/.prescripto/mcp-token
chmod 600 ~/.prescripto/mcp-token
```

A trailing newline is fine — the server trims it.

**Never commit this file, and never commit `backend/.env`.** Both are ignored
where they live, but the safest habit is to keep the token out of the repo
entirely.

---

## Step 4 — Add the server to Claude Desktop

**Open the config from inside the app.** In Claude Desktop go to
**Settings → Edit Config**. That opens the correct file for your installation
and is the method to use — it sidesteps the path question entirely.

<details>
<summary>Why not just edit the file by path?</summary>

Because the path depends on how Claude Desktop was installed, and the commonly
quoted one is wrong for the Microsoft Store build. A Store (MSIX) install is
sandboxed, so its config lives at:

```
%LOCALAPPDATA%\Packages\Claude_<publisher-id>\LocalCache\Roaming\Claude\claude_desktop_config.json
```

not at `%APPDATA%\Claude\claude_desktop_config.json`. Editing the latter on a
Store install silently changes a file the app never reads, and the server never
appears — with nothing to indicate why.

For reference, the paths for a non-Store install are:

| Platform | Path |
|---|---|
| Windows (non-Store) | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

**Settings → Edit Config** works for all of them, which is why it is the
instruction above rather than a footnote.

</details>

> **This file probably already exists and has your Claude Desktop settings in
> it.** Do not replace it. Add an `"mcpServers"` key alongside whatever is
> already there, and leave the rest untouched.

Add this block, with both paths changed to match your machine:

```json
{
  "mcpServers": {
    "prescripto-patient": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Ghadi\\Future\\React\\prescripto\\mcp\\patient-server.js"],
      "env": {
        "PRESCRIPTO_TOKEN_FILE": "C:\\Users\\LENOVO\\.prescripto\\mcp-token"
      }
    }
  }
}
```

Four things that matter:

1. **The path to `patient-server.js` must be absolute.** A relative path fails
   with `MODULE_NOT_FOUND`, because the host launches the server from its own
   working directory, not from this repo.
2. **Use the full path to `node.exe` rather than just `"node"`.** A desktop app
   does not always inherit the `PATH` your terminal has. `"node"` may work; the
   absolute path always does. Find yours with `where node` (Windows) or
   `which node` (macOS/Linux).
3. **On Windows, backslashes must be doubled** in JSON (`\\`), as shown.
   Forward slashes (`C:/Ghadi/...`) also work and avoid the issue entirely.
4. **You do not need to point at `backend/.env`.** The server finds it from its
   own location, whatever directory the host starts it in.

macOS / Linux equivalent:

```json
{
  "mcpServers": {
    "prescripto-patient": {
      "command": "/usr/local/bin/node",
      "args": ["/absolute/path/to/prescripto/mcp/patient-server.js"],
      "env": {
        "PRESCRIPTO_TOKEN_FILE": "/Users/you/.prescripto/mcp-token"
      }
    }
  }
}
```

---

## Step 5 — Restart and try it

**Quit Claude Desktop from the system tray.** Closing the window does *not*
reload the config — the app keeps running in the background and your new server
will not appear. Right-click the Claude icon in the system tray (bottom-right,
possibly under the `^` overflow arrow) and choose **Quit**. Then reopen it.

The server appears as `prescripto-patient` with six tools. Try:

> Which dermatologists do you have in Khalda?

> What appointments do I have coming up?

The second is the interesting one: it returns **your** appointments, because
identity comes from the token file and cannot be set by the conversation.

### The permission prompt is expected

The first time each tool runs, Claude Desktop asks you to approve it. That is
the host protecting you, not a problem with the server — approve it and the
call proceeds.

**You'll be asked again in each new conversation**, because "Allow always"
applies to the current chat rather than globally — this is Claude Desktop's
behaviour, not something the server controls. Approving again is safe; every
tool here is read-only.

---

## Which database am I talking to?

Whatever `backend/.env` points at. Check before you rely on any answer:

```bash
grep -E "^DB_HOST|^DB_NAME" backend/.env
```

- `DB_HOST=localhost` — your local MySQL. It must be running, and the data you
  see is your local seed data.
- Anything else (for example an Aiven host) — **that is production data.** The
  tools are read-only, so nothing can be modified, but real patient
  appointments would be readable through the assistant.

---

## The token expires after 7 days

Patient tokens are issued with a 7-day lifetime. This is normal and the server
is built to handle it gracefully.

**What you will see on day eight** — not a broken server, but a clear tool
error:

> Your access token has expired. Sign in to Prescripto again and write the new
> token to the file named by `PRESCRIPTO_TOKEN_FILE`.

**How to fix it:** repeat Steps 2 and 3 — get a fresh token and overwrite the
same file.

That is all. The token file is re-read on **every** tool call, so:

- no editing `claude_desktop_config.json`
- no restarting Claude Desktop
- the next question you ask just works

The same applies if you want to switch which patient the server acts as: change
the file, and the next call uses the new identity.

---

## Security

- **The token file is a live credential.** Keep it outside the repository, and
  never commit it. On macOS/Linux, `chmod 600` it.
- **`backend/.env` is never committed.** It holds `JWT_SECRET` and your
  database password. It is gitignored; keep it that way.
- **Each server serves one role only.** The patient server refuses a doctor's
  or admin's token with `wrong_role`, and the doctor server refuses a
  patient's — in both cases even though the signature is perfectly valid. The
  two have separate registries, separate token files and separate processes;
  see [The doctor server](#the-doctor-server).
- **Every tool call is logged** to the `assistant_audit_log` table with the
  patient id, tool name, arguments and result count.
- **Nothing here can write.** No tool books, changes or cancels an appointment.

---

## The doctor server

Everything above applies, with three substitutions. Nothing else differs —
same `backend/.env`, same Node, same install.

| Step | Patient | Doctor |
|---|---|---|
| 2 — get a token | sign in at <http://localhost:5173> | sign in to the **doctor panel** at <http://localhost:5174> |
| 3 — save it | `~/.prescripto/mcp-token` | `~/.prescripto/mcp-doctor-token` |
| 4 — config | `patient-server.js`, `PRESCRIPTO_TOKEN_FILE` | `doctor-server.js`, `PRESCRIPTO_DOCTOR_TOKEN_FILE` |

> **Use a different file for the doctor token.** The two servers deliberately
> read different variables and the doctor server has **no fallback** to the
> patient one — so a doctor server with no `PRESCRIPTO_DOCTOR_TOKEN_FILE` set
> tells you the variable is missing, rather than quietly reading a patient's
> credential and failing with a confusing "wrong role".

Both servers can run at once. Add them as two entries:

```json
{
  "mcpServers": {
    "prescripto-patient": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Ghadi\\Future\\React\\prescripto\\mcp\\patient-server.js"],
      "env": {
        "PRESCRIPTO_TOKEN_FILE": "C:\\Users\\LENOVO\\.prescripto\\mcp-token"
      }
    },
    "prescripto-doctor": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\Ghadi\\Future\\React\\prescripto\\mcp\\doctor-server.js"],
      "env": {
        "PRESCRIPTO_DOCTOR_TOKEN_FILE": "C:\\Users\\LENOVO\\.prescripto\\mcp-doctor-token"
      }
    }
  }
}
```

The doctor server appears as `prescripto-doctor` with four tools. Try:

> What does my day look like tomorrow?

> Where do I have a free hour this week?

> Which of my patients haven't been back in a couple of months?

**What it cannot do.** It has no write tool and no patient tools: it cannot
book, cancel or complete an appointment, cannot look up another doctor's
schedule, and returns no patient contact details — only names, so you can
recognise your own patients. Acting on any of it happens in the doctor panel.

**Patient names are shown to you and sent to your MCP host.** That is the same
information the doctor panel already shows you, but over MCP it leaves this
machine's process and reaches the host. Worth knowing before pointing this at
a database with real patients in it.

---

## Troubleshooting

Diagnostics go to **stderr**, which the host shows in its MCP server logs.
Nothing is ever printed to stdout, because on this transport stdout carries the
protocol itself.

| What you see | What it means | Fix |
|---|---|---|
| `PRESCRIPTO_TOKEN_FILE is not set` | The `env` block is missing or misspelled in the config | Recheck Step 4, then fully quit and reopen Claude Desktop |
| `Could not read the token file at … (ENOENT)` | The path is wrong, or the file was never created | Recheck Step 3. On Windows, remember the doubled backslashes |
| `The token file at … is empty` | The file was created but nothing was written to it | Redo Step 3 |
| `Your access token has expired` | Normal after 7 days | Steps 2 and 3 again — no restart needed |
| `That token could not be verified` | The file holds something that is not a complete token — often a partial copy/paste | Copy the whole `eyJ…` string again |
| `That token belongs to a doctor or admin account` | Right signature, wrong account | Sign in as a patient |
| `The server cannot verify tokens: JWT_SECRET is not available` | **An operator problem, not a token problem.** `backend/.env` is missing or unreadable | Check `backend/.env` exists and contains `JWT_SECRET` |
| `Could not reach the Prescripto database` | The database in `backend/.env` is not reachable | Start MySQL (or the Docker stack), then just ask again — the server reconnects without a restart |
| `MODULE_NOT_FOUND` in the host's logs | The path in `args` is relative or wrong | Use an absolute path to `patient-server.js` |
| The server does not appear at all | Usually `command` — the host cannot find `node` | Use the absolute path to `node.exe` (Step 4, note 2) |

### Check it works without Claude Desktop

This drives the real server over a real stdio pipe, with a real token and the
real database, and prints a report:

```bash
cd mcp
npm run smoke
```

It exits 0 on success. If this passes but Claude Desktop does not work, the
problem is in `claude_desktop_config.json`, not in the server.
