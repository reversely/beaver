# Cloudflare agent

The Cloudflare agent gives the newcomer at the desktop app a second way to get answers and adds
three features on top: every screen in the room follows the conversation as it happens, the
newcomer's notebooks are stored online and reachable from any laptop with the token, and the words
each question taught come back for review on a schedule. It lives on the `cloudflare_agents` branch
(issues #60 to #63) and runs as the Cloudflare Worker `beaver-agent`, built on the Cloudflare
Agents SDK (`agents` 0.24.0).

The desktop app's Settings panel switches between the two paths with "Answers from: Gemini /
Cloudflare" (`provider.name`). The rover keeps using Gemini and ElevenLabs in both cases.

## Parts

| Part | Where it runs | File | What it does for the newcomer |
|---|---|---|---|
| Whisper | Laptop | `src/beaver/core/transcribe.py` | Turns their spoken question into text, so their voice never leaves the laptop |
| Guard proxy | Laptop | `src/beaver/core/guard.py` | Replaces a phone number, address, or card number in the question and in every answer sentence before anything is sent or spoken |
| Provider switch | Laptop | `src/beaver/desktop/provider.py` | Sends the answer, notebook, and speech requests to Gemini and ElevenLabs or to the agent, from one setting |
| Agent client | Laptop | `src/beaver/desktop/cloudflare.py` | Carries guarded text and camera frames to the agent and brings answers, audio, and notebooks back |
| `BeaverGuide` agent | Cloudflare, one Durable Object per session | `agent/src/index.ts` | Answers, translates, and speaks with Workers AI; holds the session's live turns, notebooks, and review schedule |
| Viewer page | Cloudflare static files | `agent/public/session.html`, `session.js`, `session.css` | Shows each question and answer, and the words due for review, on a phone or a second screen |
| Session and review cards | Laptop browser | `src/beaver/desktop/ui/live-session.js` | Shows the viewer link and its QR code on the Ask view, and the due words with Remembered and Forgot on the Notebooks view |

## Models

| Step | Workers AI model | Setting |
|---|---|---|
| Answer, and notebook filing | `@cf/meta/llama-4-scout-17b-16e-instruct` | `ANSWER_MODEL` in `agent/wrangler.jsonc` |
| Translation | `@cf/meta/m2m100-1.2b` | `TRANSLATE_MODEL` |
| Speech | `@cf/myshell-ai/melotts` | `SPEECH_MODEL` |

MeloTTS speaks English, Spanish, French, and Chinese (`cloudflare.spoken_languages` in the desktop
`config.toml`). A sentence in any other language shows on the page without audio. MeloTTS returns
WAV audio, although its published schema says MP3.

The answer request takes its temperature and length limit from the desktop app's `[gemini]`
section (`temperature`, `max_output_tokens`), so the two providers answer under the same limits.

## One turn

These steps follow one question through the Cloudflare path. Steps 1, 2, 5, and 8 run on the
laptop, and nothing leaves it before step 3.

1. **Question.** The newcomer types a question, or holds the talk button and speaks it, with an
   optional camera frame. The page posts it to `/api/ask` on the desktop app
   (`src/beaver/desktop/server.py`, `ask_events`).
2. **Transcribe and guard.** A spoken question goes through Whisper on the laptop. The guard
   proxy redacts the text, and the run record keeps the redacted question and the rules that fired.
3. **Answer.** `bilingual.answer` renders the system prompt, the answer instruction, and the
   question from the laptop's own prompt files, and `provider.ask` sends them with the camera frame
   to the agent's `ask` action. The agent calls the answer model with a JSON schema and returns the
   reply text, its token counts, and its model time. The reply names the visitor's language and
   holds the answer in the first official language.
4. **Translate.** The laptop splits the answer into sentences (`core/sentences.split_sentences`)
   and works out the spoken languages from the settings: English, French, or both, plus the
   visitor's language when that setting is on. It sends the sentences and target codes to the
   agent's `translate` action, which runs one m2m100 request per sentence per language at once and
   returns the sentences per language in their original order.
   With Answer mode set to "In the answer", step 3 returns every language at once and this step
   does not run.
5. **Guard the reply.** `guard_answer` redacts every sentence in every language. From here on, the
   agent only receives text the guard has checked.
6. **Publish.** In a background thread, so the first audio does not wait for it, the laptop sends
   the guarded turn to the agent's `publish` action. The agent checks the turn's fields and adds it
   to the session's state, and the Agents SDK sends the new state to every connected viewer. With
   notebooks on, the same request carries a filing request (see Notebooks).
7. **Speak.** The laptop sends each guarded sentence to the agent's `speak` action, two at a time
   (`tts.parallel`), in speaking order. The agent returns the MeloTTS audio, labelled by its first
   bytes.
8. **Play and save.** The laptop saves each clip in the run folder under the extension its bytes
   show and streams a `sentence` event per clip to the page, which plays them in order. The run
   record keeps the timings: `workers_ai_answer`, `workers_ai_answer_model`,
   `workers_ai_translate`, `text_ready`, `first_audio_ready`, and `all_synthesized`.

The translate request in step 4 carries the model's own answer before the reply guard runs, as the
Gemini path does. That text came from the agent's model, so it shows the agent nothing new.

## Agent actions

Every action lives under `/agents/beaver-guide/<session>/`. The Agents SDK's `routeAgentRequest`
maps the binding name `BeaverGuide` to the path segment `beaver-guide`, and the session name picks
one Durable Object. The desktop app uses the session in `cloudflare.session` (`desktop` by
default).

| Method and action | Body | Reply |
|---|---|---|
| `POST ask` | `system`, `instruction`, `parts` (each `{text}` or `{image_jpeg}` in base64), optional `schema`, `temperature`, `max_tokens` | `{text, usage: {prompt, reply}, model, ms}` |
| `POST translate` | `sentences`, `source` code, `targets` codes | `{translations: {code: [sentences]}, ms}` |
| `POST speak` | `text`, `lang` | Audio bytes, with `Content-Type` from the bytes and `X-Synth-Ms`; 422 for a language MeloTTS does not speak |
| `POST publish` | `question`, `visitor: {name, code}`, `sentences: [{group, code, text}]`, optional `notebook` filing request | `{turns, filing}`, where `filing` is the queued task's id |
| `GET notebooks` | None | The session's notebook summaries, in the shape `/api/notebooks` returned before |
| `GET notebooks/<id>` | None | One notebook with its entries, in the shape of one notebook in `notebooks.json` |
| `POST review` | `id`, `remembered` (true or false) | `{next_review_seconds}`; 404 when the word is not due |

A refused request answers with JSON `{error}`: 400 for a malformed body or turn, 401 for a missing
or wrong token, 413 for a body over 4 MB, and 502 when Workers AI fails. An error message names the
failure and never carries question or answer text.

## Live session

Any screen with the viewer link follows the session. The laptop's Ask view shows the link and a QR
code of it whenever the provider is Cloudflare and `.env` holds the token.

- **Link.** `https://beaver-agent.shereenlee-ds.workers.dev/session.html?s=<session>&key=<key>`.
  The key is HMAC-SHA256 of the session name under the shared token, cut to 32 hex characters.
  The laptop (`cloudflare.viewer_key`) and the Worker (`agent/src/auth.ts`, `viewerKey`) derive it
  the same way. A key opens only its own session, and the link never contains the token.
- **Connection.** The viewer page opens a WebSocket to `/agents/beaver-guide/<session>?key=<key>`.
  The Worker checks the key before the upgrade. The agent's `onConnect` marks every WebSocket
  connection read-only, so a viewer's attempt to change state gets "Connection is readonly" back.
- **State.** On connect and after every change, the SDK sends
  `{"type": "cf_agent_state", "state": {...}}`. The state holds `turns`, the latest 20 guarded turns,
  and `reviews_due`, the words due for review. The viewer page redraws from each message, sets all
  text with `textContent`, and takes each line's direction from its own text, so Arabic reads right
  to left. It reconnects after a drop, waiting 1 s at first and up to 30 s.
- **The laptop's own page** opens the same kind of read-only socket (`live-session.js`, using the
  `socket` URL from `/api/session`) to show the due words.

The SDK also sends each viewer a `cf_agent_identity` message with the session name and a
`cf_agent_mcp_servers` message; both pages ignore them.

## Notebooks

With the Cloudflare provider, the agent files each turn into the session's notebooks instead of
the laptop's `notebooks.json`, so the newcomer's notebooks follow the session to any laptop with
the token.

1. The laptop builds the filing request (`notebooks.filing_request`): its own notebook prompt from
   `prompts/notebook.md` with `${notebooks}` left unfilled, the JSON schema, the eight artifact
   pieces, the four themes, the vocabulary and concept limits, the answer in the first spoken
   language, and the first review interval. It sends the request with the turn in step 6.
2. The agent queues the filing with the SDK's `queue`, so the filing survives the page closing and
   retries after a Workers AI error. The publish request returns before filing starts.
3. The queued `fileTurn` task fills `${notebooks}` with the session's existing notebooks, one line
   each in the laptop's format, and asks the answer model with the schema.
4. `checkFiling` (`agent/src/notebooks.ts`) trims the reply to the limits, refuses a theme outside
   the list or a year that is not a whole number, and drops an unlisted piece.
5. The agent stores the result in its SQLite tables, through the SDK's `sql` template with bound
   parameters. It reuses a notebook when the model names one by id and widens that notebook's years
   to cover the new moments; otherwise it creates one with an eight-character id.

| Table | Columns |
|---|---|
| `notebooks` | `id`, `title_en`, `title_fr`, `theme`, `artifact`, `year_start`, `year_end` |
| `entries` | `id`, `notebook_id`, `at`, `question`, `visitor`, `answer`, `vocabulary`, `concepts`, `moments` (the last four as JSON) |
| `reviews` | `id`, `notebook_id`, `en`, `fr`, `visitor`, `meaning`, `interval_seconds`, `first_seconds` |

The desktop app's `/api/notebooks` and `/api/notebooks/<id>` read from the agent when the provider
is Cloudflare, in the same shapes as before, so `ui/notebooks.js` renders them unchanged. The laptop
skips its own filing for those turns. The rover's synced turns still file into `notebooks.json`.

## Review

Each word a filing adds comes back to the newcomer for review, sooner when they forget it and
later each time they remember it.

1. For every vocabulary word, `fileTurn` inserts a `reviews` row and calls the SDK's
   `schedule(first, "reviewDue", {id})`. The first interval comes from
   `review.first_interval_seconds` in the desktop `config.toml` (600 s by default), kept between
   60 s and 30 days.
2. When the time comes, the scheduler calls `reviewDue`, which adds the word to `reviews_due` in
   the state. Every connected screen receives it: the Notebooks view lists it with Remembered and
   Forgot, and the viewer page lists it without buttons.
3. Remembered or Forgot posts to the laptop's `/api/review`, which accepts only the laptop's own
   page (its host name and the `X-Beaver` header) and forwards the choice with the token.
4. The agent's `review` action refuses a word that is not in `reviews_due`. A remembered word waits
   2.5 times its last interval, up to 180 days; a forgotten word goes back to its first interval.
   The agent schedules the next review and removes the word from `reviews_due`.

## Security

- **Token.** Every HTTP request to the Worker carries `Authorization: Bearer <token>`. The token
  lives in the Worker secret `BEAVER_AGENT_TOKEN` and as the same variable in the repo's `.env`.
  The Worker compares tokens in constant time and refuses everything when the secret is unset.
- **What leaves the laptop.** The guarded question, the camera frame when one is on, the model's
  own answer for translation, the guarded sentences for speech, and the guarded turn for the live
  session and notebooks. The question audio stays on the laptop.
- **Checks in the agent.** Bodies over 4 MB are refused. A published turn keeps only its expected
  fields, with text up to 2,000 characters and at most 40 sentences. Filings and reviews are checked
  as described above, and SQL takes bound parameters only.
- **User agent.** Cloudflare's edge refuses the default `Python-urllib` user agent with error 1010
  before the Worker runs, so `cloudflare.py` sends `User-Agent: beaver-desktop/1`.
- **Logs.** `observability` is on in `agent/wrangler.jsonc`, so Cloudflare keeps request metadata,
  including each viewer's WebSocket URL with its key. The agent writes no question or answer text
  to the logs.

## Settings

| Setting | File | Default | Meaning |
|---|---|---|---|
| `provider.name` | `src/beaver/desktop/config.toml`, editable on the Settings panel | `gemini` | `cloudflare` sends answers, translation, speech, and notebooks to the agent |
| `cloudflare.url` | same | `https://beaver-agent.shereenlee-ds.workers.dev` | The Worker's address |
| `cloudflare.session` | same | `desktop` | The session name: one agent, one set of turns, notebooks, and reviews |
| `cloudflare.timeout_seconds` | same | 60 | Longest wait for one agent request |
| `cloudflare.spoken_languages` | same | en, es, fr, zh | Languages sent for speech |
| `cloudflare.max_characters` | same | 600 | Longest sentence sent for speech |
| `review.first_interval_seconds` | same | 600 | Wait before a new word's first review |
| `BEAVER_AGENT_TOKEN` | `.env` and the Worker secret | None | The shared token |
| `ANSWER_MODEL`, `TRANSLATE_MODEL`, `SPEECH_MODEL` | `agent/wrangler.jsonc` | See Models | Workers AI model per step |

## Measured

On 2026-10-01, with the three `bilingualtest` questions and the visitor's language spoken first,
the Cloudflare path reached first audio in 8.4 to 12.8 s and the Gemini path in 3.3 to 7.8 s.
A spoken English question took 3.0 s in Whisper and reached first audio in 10.1 s on the Cloudflare
path. [measurements.md](measurements.md) has the full rows.

In the same run, the answer model wrote the visitor's language into the answer ("The visitor spoke
Arabic, ar."), and m2m100 translated "poutine" as "Putin" in Chinese, Ukrainian, Tagalog, and
Punjabi, and "gravy" as "strawberries" in Chinese.

## Tests

| Command | Covers |
|---|---|
| `cd agent && npm test` | Token and viewer-key checks, the chat input, reply parsing, translation order, the audio label, turn checks, filing checks, and review intervals (16 tests) |
| `cd agent && npm run check` | TypeScript types for the Worker |
| `uv run python -m unittest discover -s src/beaver/desktop/tests` | `test_cloudflare.py` runs whole turns against a fake agent: the question and spoken sentences arrive guarded, publish and filing carry guarded text, notebooks and reviews route through the laptop, and the review route accepts only the laptop's page |
| `cd agent && npx wrangler dev -c test/dev/wrangler.jsonc` | Runs the real agent locally with canned Workers AI replies (`agent/test/dev/entry.ts`), for checking state sync, SQL, and the scheduler without a Cloudflare login |

[deployment.md](deployment.md) covers deploying the Worker and setting the token.
