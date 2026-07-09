# Basepair — Demo Video Script (≤ 3:00)

**SAY** = spoken words, verbatim. **DO** = what you click/show in the UI while saying them.

Principle: **technical terms live on screen, speech stays plain.** The gene ID, phenotype, and guideline are all visible in the UI — that's where the credibility lives. Your voice just makes the stakes land.

---

## Before you hit record (prep)

- `trigger:dev` worker running and confirmed hot. Fire one throwaway order to pre-warm the Opus/Sonnet/RxNorm path.
- Queue pre-seeded and clean (run your reset). Confirm the exact **featured patient** who is a CYP2C19 poor metabolizer, and confirm **clopidogrel** fires for them.
- Confirm your **planted "looks-concerning-but-clears"** case (patient + drug) for the money shot.
- Start on the queue screen (`/`), console already logged in.

---

## The script

### [0:00–0:15] — Hook (to camera, your face — NO screen yet)

- **SAY:** "This is Basepair. A pharmacist's second set of eyes. The console they actually work in. Some patients carry a gene that makes a common drug useless, sometimes even dangerous. That result is already in their chart. But nobody re-checks it when the drug gets prescribed. Basepair does."
- **DO:** Straight to camera. No screen share. Relaxed, direct address — you're talking to one person, not presenting. Let "Basepair does." land with a small beat before you cut.
- *Optional personal lead-in (adds ethos — a real person who built it):* open with "I'm [name], and I built Basepair." Keep it to one breath, then go into the line above.
- *Reduce-motion for the viewer's eye:* hold the frame steady; save all the movement for the screen.

### [0:15–0:55] — The live wow (place an order, watch it stream)

- **SAY:** "So watch this. I'm going to prescribe clopidogrel, a common blood thinner, to a patient whose genes say it won't work for them. Basepair reads the genetics. It finds the guideline. Then it checks its own work, before it ever bothers a human." *(stream lands)* "There. Flagged."
- **DO:** **This is the reveal — cut from your face to the screen here** (on "So watch this"). You can stay as a small picture-in-picture or hand off fully to the screen. Land on the alert queue, then click **New Order…** (or press **n**) → pick the featured patient → type **clopidogrel** in the drug box, select it → pick a prescriber → **Submit**. Let the **"What Basepair found"** feed stream its dots. Land on **Alert Flagged**. The on-screen **CYP2C19 / poor metabolizer** does the technical talking.

### [0:55–1:45] — Why you trust it + close the loop

- **SAY:** "Now, why trust it? Because it shows you everything. The genotype, the phenotype, the exact rule it matched. And then this: the real guideline, word for word, with the one sentence it's citing lit up right there. Not a summary. The source. And notice, the AI never makes the call. It just finds the citation and checks it. The rule decides. So the instruction is simple. Don't use clopidogrel, switch to prasugrel. One click. It writes the switch and tells the prescriber, right back in the chart."
- **DO:** Click the flagged row → alert detail. Scroll the **reasoning trace**. Point at the **highlighted guideline** span; click **"Why this sentence"** to flash the verdict popover. Then click **Approve & Switch to Prasugrel** → confirm the patient dialog → confirm.

### [1:45–2:30] — The money shot (suppression)

- **SAY:** "Okay, here's the part I care about most. The problem with tools like this: three out of four flags don't actually matter. Pharmacists drown in them, so they stop looking. Basepair takes a side. It decides what's worth your attention. So I'll place an order that looks scary but doesn't really break the rule. Basepair drafts the warning, checks it against the guideline, finds nothing real, and drops it. No alert. The queue only holds what needs a person. It fires when the guideline says fire. And it proves it, every time."
- **DO:** Place the planted case → watch the stream resolve to **No Alert**. *(If latency is tight, skip the live placement and open `/audit` to show it sitting as a cleared row instead.)*

### [2:30–2:55] — Audit trail + close

- **SAY:** "And every decision leaves a trail. What got flagged, what got acted on, the exact rulebook it read that day. You can pull it back up months later, exactly as it was. Signal, not noise. That's Basepair."
- **DO:** Go to **/audit**. Show the evaluated / flagged / cleared / false-alarm stats and the enactment rate. Hold on the audit table as you say the last line.

---

## Timing & safety notes

- Spoken content is ~330 words (~2:20 of talking), leaving ~40s of buffer for the two live streams and clicks. Fits 3:00.
- **Written to be spoken, not read.** The lines mix short punches ("There. Flagged." / "Not a summary. The source.") with longer sentences on purpose — that variation is what keeps it from sounding scripted. Read the whole thing aloud once before recording; if a line makes you stumble, cut a clause. The period is your friend; the comma is your breath.
- The two live LLM runs (Beat 2 and Beat 4) are your only latency risk. **For the video:** record them generously, then trim/speed the waits in the edit so there's no dead air.
- **If a stream stalls mid-record:** cut, and fall back to the pre-seeded flagged alert (Beat 3 renders instantly, no LLM) as your opener; show suppression on `/audit` rather than live. Never let the camera sit on a spinner.
- **One window only.** Don't add the prescriber CDS window to the video — the single-console path is tighter and safer.

---

## The line to remember

> "Basepair is the pharmacist's second set of eyes — it only fires when the published guideline says so, and it proves the match every time."

---

## Linear lens — why these lines land (deliver with this intent)

A few Linear design principles are baked into the script. Knowing *why* helps you deliver them with conviction:

- **Workbench, not a chatbox.** "Not an AI chatbox; the console they actually work in." The AI lives inside the pharmacist's real workflow with review and approval surfaces — it isn't a prompt box bolted on. This is a genuine differentiator from most hackathon AI demos.
- **A human stays accountable.** "It never makes the clinical call — the published rule does." The alert stays a person's decision; the AI only parses and verifies. Say this plainly — judges reward the discipline.
- **Opinionated: one good way.** "Basepair takes a position on what deserves your attention" / "the queue holds only what needs a person." An opinionated tool that says *no* to noise is a feature, not a gap.
- **Speed as design: no spinners.** In Beat 2 you're watching the work happen, not a loading bar. Don't apologize for the few seconds — narrate them. The streaming feed *is* the calm-but-fast feel.
- **Reversible = confident.** The one-click approve is safe because it's undoable. If a judge asks "what if you're wrong," the answer is: every action is reversible and fully audited.
- **Plain language.** Technical terms (gene ID, phenotype) stay on screen; your voice stays human. Calm density: the UI carries the rigor, the narration carries the meaning.
