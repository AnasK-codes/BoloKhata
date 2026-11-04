# Post drafts

Rules for every post: the first line is the problem; Gnani Prisma and Timbre are named; `#GreatIndianAIInternshipChallenge` and `#GnaniAI` are present; Gnani AI is tagged; the link is real; **any latency number comes from your own HUD export or `docs/LATENCY.md` and has its conditions next to it**. Replace every `[...]`. **Do not post with a bracket left in it.** If you have no measured number yet, use the "no number" variants, which are written so they stay true without one.

`@GnaniAI`: confirm the exact company handle on LinkedIn and X before posting; I could not verify it.

---

## LinkedIn

### A: the problem first (no number needed)

A kirana shopkeeper has one hand on the weighing scale and the customer is already waiting. Typing out a bill and writing the udhaar in a notebook is the slow part.

So we built Bol-Bill: hold the mic, say the order the way you actually say it ("Sharma ji ko do kilo aata aur ek Maggi, teen sau ka udhaar likh do"), and the bill appears on screen while the app reads it back. Say "haan" and it is saved. Ask "Sharma ji ka kitna udhaar hai?" and you hear the answer.

What is under the hood:
→ Gnani Prisma for realtime Hinglish speech-to-text (we commit the moment you let go of the button instead of waiting for silence)
→ Gnani Timbre for the spoken readback, streamed so the voice starts while the bill is still drawing
→ a rules-first Hinglish parser, so common sentences never wait on a language model (the model is optional and never touches a price)
→ the ledger lives on the phone, so it works offline

Everything in the video is the running app with fictional data, no edits to the timings.

Built as a two-person team for the Great Indian AI Internship Challenge. Try it: [LIVE_LINK] · Code: [REPO_LINK]

@Gnani AI #GreatIndianAIInternshipChallenge #GnaniAI #Hinglish #VoiceAI #kirana

### B: the build story (includes a measured number)

Typing is a bad interface for someone who is weighing rice with one hand.

For the Great Indian AI Internship Challenge we built Bol-Bill, a voice billing app for kirana stores. The part I am proudest of is not the model, it is the plumbing: audio goes to our own small gateway in 1,024-byte frames at real-time pace, into Gnani Prisma, and a commit is sent the instant the button is released.

On [PHONE MODEL] over [Wi-Fi / mobile data], with the gateway in [REGION], the HUD in our demo showed about [X] ms from letting go of the button to the bill on screen, and [Y] ms to the first sound of the spoken readback from Gnani Timbre. That is one take on one phone, not a benchmark. The HUD is in the app, so you can check it yourself.

What I would tell another student building on voice APIs: measure from the user's finger, not from your server.

Link: [LIVE_LINK] · Code: [REPO_LINK]
@Gnani AI #GreatIndianAIInternshipChallenge #GnaniAI

### C: short and personal

My dad runs a small shop. Every evening he copies the day's udhaar into a notebook. [Edit or delete: only keep this line if it is true for you.]

Bol-Bill is our attempt at fixing the slow part: say the order in Hinglish, see the bill, say "haan". Gnani Prisma listens, Gnani Timbre reads the bill back, and the ledger stays on the phone.

60-second demo, real phone, fictional customers. Link in the comments: [LIVE_LINK]

@Gnani AI #GreatIndianAIInternshipChallenge #GnaniAI

---

## X (280 characters each, counted with the link as 23)

### A

Weighing rice with one hand, typing a bill with the other? Bol-Bill: hold, say "Sharma ji ko do kilo aata, udhaar likh do", see the bill while it reads it back. Gnani Prisma + Timbre. Demo: [LIVE_LINK] @GnaniAI #GreatIndianAIInternshipChallenge #GnaniAI

### B (with a measured number; fill honestly)

Kirana billing is slow because typing is slow. Ours is voice: Gnani Prisma hears it, Timbre reads it back. On [PHONE] over [NETWORK], bill on screen ~[X] ms after release (one take, HUD in the video). [LIVE_LINK] @GnaniAI #GreatIndianAIInternshipChallenge #GnaniAI

---

## Before posting

- [ ] No bracket remains. No number you did not read off a HUD or `docs/LATENCY.md`.
- [ ] The video is attached or linked, and it is the real app (no unlabelled replay or synthetic noise).
- [ ] The link opens on a phone over mobile data.
- [ ] You are not asking anyone to buy, swap or pump engagement.
