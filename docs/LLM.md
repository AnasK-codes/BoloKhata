# The optional LLM fallback

The rule parser handles the common sentences. The LLM is only asked when the rules are not confident (or an item does not resolve), under a hard timeout (`LLM_TIMEOUT_MS`, default 1200 ms). If it is slow, wrong or absent, the turn ships the rules result with a review flag. **Rules-only (`LLM_PROVIDER=none`) is the default and must always work.**

The model never sets a price, total or balance. Its Zod schema accepts only intent, names, quantities and payment/credit amounts. Rules may extract explicit spoken item prices, and shared code computes their totals; otherwise catalog prices apply. A turn with a spoken item-price quote always stays rules-only (also under `LLM_MODE=always`), so the model cannot rewrite or invent that price. Model output is revalidated to strip any injected quote metadata. Invalid spoken prices require review.

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
