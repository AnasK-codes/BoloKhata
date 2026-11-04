# Pre-submission smoke test (3 minutes)

Run this on the **deployed** app, on a **real phone over mobile data**, the day you record and again right before you submit. Tick every box or write down what failed.

Setup: phone on mobile data (Wi-Fi off), volume up, quiet room, the live HTTPS link, the demo access code if you set one.

**Before you start (30 s)**
- [ ] `https://YOUR.DOMAIN/healthz` shows `{"ok":true,...}` in the phone's browser.
- [ ] The pill on the voice screen says **Online** within 3 seconds.
- [ ] Operator check on the instance: `credits.stt_seconds_remaining` and `credits.tts_chars_remaining` are comfortably above what the next 20 turns need (see `docs/DEPLOY.md` section 7, step 5).

**The happy path (90 s)**
- [ ] Hold the mic, say "Sharma ji ko do kilo aata aur ek Maggi, udhaar likh do", release. The bill appears, rows animate in, the voice reads it back.
- [ ] The total and udhaar on screen match the numbers the voice says.
- [ ] Say "haan" (hold, say it, release). The toast says the bill was saved. Open **Khata**: Sharma's balance went up by the udhaar amount.
- [ ] Back on **Bolo**: ask "Sharma ji ka kitna udhaar hai". The balance card shows the new number and the voice says it.
- [ ] Say "Verma ji ne do sau de diye", tap **Confirm**. Khata shows Verma's balance lower by 200.

**Barge-in and errors (45 s)**
- [ ] While the voice is still speaking, press the mic: the voice stops at once and you are recording.
- [ ] Tap-to-latch: tap once, speak, tap again: it sends.
- [ ] Airplane mode on, press the mic: a clear "Internet nahi hai" message, no crash. Airplane mode off: **Online** returns by itself.
- [ ] Say nothing and release: "Kuch sunai nahi diya", then a normal turn works.

**Install and offline (15 s)**
- [ ] The app is installed (home-screen icon, opens without browser bars).
- [ ] In airplane mode, **Khata** and **Samaan** open and show data.
- [ ] Latency toggle (Settings, "Latency HUD") shows spans; "Copy timings as JSON" works.

**Before you hit submit**
- [ ] The demo video uses only synthetic data and is not a replay presented as live (anything synthetic or replayed is labelled on screen).
- [ ] Every latency number in the post comes from `docs/LATENCY.md` or a HUD export, with the conditions written next to it.
- [ ] The post is live, tags Gnani AI, has `#GreatIndianAIInternshipChallenge` and `#GnaniAI`, and links the app or repo.
- [ ] The instance and the Free Plan credits will last through the evaluation period (`docs/DEPLOY.md` section 3).
