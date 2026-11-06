# The optional LLM fallback

The rule parser handles the common sentences. The LLM is only asked when the rules are not confident (or an item does not resolve), under a hard timeout (`LLM_TIMEOUT_MS`, default 1200 ms). If it is slow, wrong or absent, the turn ships the rules result with a review flag. **Rules-only (`LLM_PROVIDER=none`) is the default and must always work.**

**Circuit breaker.** After three timeouts or provider errors in a row, or one rate-limit answer (HTTP 429 / `ThrottlingException`), the gateway skips the model for 30 s and answers from the rules at once (status `skipped`, review flag on). The next unsure sentence after the cooldown tries the model again; one success resets the count. An interrupted turn or an invalid answer does not count. The breaker is process-wide and the manual `llm:eval` turns it off.

What was looked at and not changed: the system prompt is already static (provider prompt caching can apply), Node's `fetch` already reuses connections (keep-alive), and the per-turn name list is small next to the system prompt (measured: 3,433 characters of system prompt; 658 characters of user block with the 43-product seed catalog, 3,337 at the 500/500 maximum). Sending only the closest candidate names would cut the names that leave the server, but it changes what the model sees and needs a fresh `llm:eval` run (real calls) to prove accuracy holds, so it was not done.

The model never sets a price, total or balance. Its Zod schema accepts only intent, names, quantities and payment/credit amounts. Rules may extract explicit spoken item prices, and shared code computes their totals; otherwise catalog prices apply. A turn with a spoken item-price quote always stays rules-only (also under `LLM_MODE=always`), so the model cannot rewrite or invent that price. Model output is revalidated to strip any injected quote metadata. Invalid spoken prices require review.

## Two modes: `PARSER_MODE`

| | `rules_ai` (default) | `ai_only` |
|---|---|---|
| Who reads the sentence | the rule parser; the model only when the rules are unsure | the model, for every sentence, by calling a tool |
| Spoken reply | fixed templates | written by the model, checked and filled by code (below) |
| Typical wait | microseconds, plus up to `LLM_TIMEOUT_MS` on an unsure sentence | one model round trip on every sentence (measured floor about 1.5 s with Gemini free tier); set `LLM_TIMEOUT_MS` to 2500 to 4000 |
| Model fails or is slow | rules result, review flag | the **rules answer that sentence**, `source: rules`, review flag, "basic result" notice; the breaker skips a failing model for 30 s |

`ai_only` refuses to start with `LLM_PROVIDER=none`. Rules are not removed from the code: they are the fallback, and the same correction commands for an open bill ("teen kilo karo") still run first, as they do in both modes. This is a deliberate exception to "never block a turn on the model": in this mode the model is the parser.

**Tools** (`apps/gateway/src/parse/agent/tools.ts`): `create_bill`, `record_payment`, `query_balance`, `query_summary`, `out_of_stock`, `add_customer`, `add_product`, `add_products`, `update_price`, `say` (greetings, unclear sentences, a question back such as the rate of a new product). The model chooses one tool; code maps it to the same parsed shape the rules produce and everything after that is the ordinary code: matching names to the catalog, pricing, totals, balances, the draft, the confirm card. A tool call never carries a price, total or balance. Every rupee amount the model reports (paid, udhaar, a quoted price, a rate, a discount) must be a number the speaker actually said (`spokenNumbers`); otherwise the call is rejected and the rules answer.

**Not tools, on purpose:** confirm and cancel. A bare "haan" or "nahi" is matched by exact words before any model call (instant, and a model can never save or cancel a bill). A longer sentence that also says yes must be said as "haan" on its own.

**Replies.** The model writes the reply with placeholders (`{customer} {total} {paid} {udhaar} {balance} {amount} {product} {rate} {sales} {bills}`); code fills them from the draft in Hindi number words, so a spoken amount always equals the card. The reply is used only if the draft is clean (something the user can simply confirm, or a plain answer) and the reply has no digits, at most two short sentences of at most 160 characters, no claim that something was saved or done, and only placeholders the draft can fill. Otherwise the fixed template is spoken. TTS characters count against the daily cap as before.

**Privacy.** Same as `rules_ai`: the model sees the transcript and customer and product names only, never balances, prices or ids; the new tool arguments contain names and spoken amounts that are already in the transcript.

**Unverified.** Tool calling was tested with stub models and a fake HTTP server only. Whether your Gemini model accepts `tools` with `tool_choice: required` on the OpenAI-compatible endpoint, and how fast it is, is not measured: run `pnpm --filter @bolbill/gateway llm:check -- --tools` once (it makes ONE real call and spends a few hundred tokens). A latency and accuracy comparison of the two modes needs real calls too and has not been done; do not quote a number for `ai_only` until it has.

## Providers

| `LLM_PROVIDER` | What it does | Needs |
|---|---|---|
| `none` (default) | Always falls back to rules. | Nothing. |
| `bedrock` | Amazon Bedrock Converse API with forced tool use (one tool whose input schema is the parser schema), temperature 0, 300 max tokens, keep-alive HTTPS, no retries. | `AWS_REGION`, `BEDROCK_MODEL_ID`, AWS credentials from the default provider chain (instance role on EC2; a local profile or environment variables in dev). |
| `openai-compatible` | `POST {OPENAI_BASE_URL}/chat/completions` in JSON mode, validated with Zod. | `OPENAI_BASE_URL`, `OPENAI_MODEL`, optional `OPENAI_API_KEY`. |

Credentials never come from the browser or from `.env` keys for AWS. Do not put AWS keys in the repo.

## Verify Bedrock by hand

Nothing here was verified against your account: model availability, access and quotas differ by region and account type, and this repo has never made a real Bedrock call.

1. **Region.** In the AWS console pick the region you will run in (the plan uses `ap-south-1`, Mumbai). Bedrock is not offered everywhere.
2. **Model access.** Console, Amazon Bedrock, Model access (or Model catalog). Check that at least one text model that supports **tool use** is available to you. Some models are only reachable through an **inference profile**; if the console shows a profile ID or ARN for a model, put that in `BEDROCK_MODEL_ID`. I have not guessed an ID for you: copy it from the console.
3. **Quotas.** Console, Service Quotas, Amazon Bedrock. Look at requests per minute and tokens per minute for your model. A brand-new or Free Plan account may have very low or zero quotas.
4. **Credentials.** Locally: `aws configure` or `AWS_PROFILE`. On EC2: attach an instance role allowing `bedrock:InvokeModel` for that model.
5. **One real call.** Set `LLM_PROVIDER=bedrock`, `AWS_REGION` and `BEDROCK_MODEL_ID` in your environment, then run:

   ```bash
   pnpm --filter @bolbill/gateway llm:check
   ```

   It sends one fictional sentence and prints the result and the latency. It is the only way the LLM is called outside the gateway, and it is never run by tests.

## If it fails or is slow

| Printed reason | Usual cause | What to do |
|---|---|---|
| `unavailable (AccessDeniedException)` | Model access not granted, or the role lacks `bedrock:InvokeModel`. | Request model access in the console; fix the role. |
| `unavailable (ValidationException)` | Wrong model ID, or the model needs an inference profile, or it does not support tool use. | Use the ID or profile from the console; pick a tool-capable model. |
| `unavailable (ThrottlingException)` / quota | Account quota is too low. | Raise the quota or stay on `none`. |
| `unavailable (CredentialsProviderError)` | No credentials found. | Configure a profile or instance role. |
| `timeout` | The model needs longer than `LLM_TIMEOUT_MS`. | Try a smaller or faster model or a nearer region. Do not raise the timeout past what the demo can afford; the point is that the turn never waits on the model. |
| `invalid_output` | The model answered without a valid tool call. | Try another model. |

If Bedrock stays blocked or too slow, either stay on `LLM_PROVIDER=none` (everything keeps working, with more "review" banners on unusual sentences) or use `openai-compatible` with any provider that offers a chat-completions endpoint.

Always disclose the LLM provider in the submission.
