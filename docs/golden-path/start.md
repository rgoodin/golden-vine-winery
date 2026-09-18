# Start: Golden Vine Integration Golden Path

**How do I start the Golden Path?** Here.

Before any technical step - before choosing a transport, before writing
a line of code - answer these questions. They're business questions,
not technical ones, and per
`docs/devex/phase-2-observation-review.md` (Finding 8, Finding 9),
answering them is not this Golden Path's job. It's yours, with the
business.

## 1. What does the target need?

Which system is receiving the business operation (ServiceNow, a
different system, something else)? What does it need to know about the
operation to act on it? Who owns setting up access to that system - see
`docs/golden-path/ownership-boundaries.md` before assuming it's yours to
configure.

## 2. What does successful completion mean?

Walk the sunny-day path: a real business event happens, and something
correct shows up in the target. What, specifically? One record? A
workflow kicked off? Write down the concrete, observable outcome - this
is what `docs/golden-path/evaluate.md` will later check the Verify-step
evidence against.

## 3. What reporting or visibility does the customer need?

Who needs to know an operation happened, and how do they find out -
looking at the target system directly, a report, an alert? This shapes
what "audit evidence" (`docs/golden-path/verify.md`) actually needs to
answer for your case, beyond what this Golden Path already provides by
default.

## 4. What identifies "the same operation," and what counts as a duplicate?

This is not a formality. Per Finding 8: **the platform will not decide
this for you.** Two deliveries of the same event, two separate customer
actions that happen to look similar, a retried request - which of these
are "the same business operation happening twice" and which are two
legitimate, separate operations? Get this wrong and every reliability
guarantee downstream is protecting the wrong thing.

---

Once you can answer these - even roughly, even as a working draft you
expect to revise - move on to `docs/golden-path/create.md`.

If you can't answer them yet, that's the actual blocker, not a missing
technical capability. Get the business answers before importing
anything.

**It's a Golden Path, not a gold watch** (Finding 9,
`docs/golden-path/0002-design-principles.md`) - everything past this
point gives you evidence-backed implementation and known behavior. It
does not, by itself, tell you whether that behavior satisfies what you
just wrote down. You determine that - see
`docs/golden-path/evaluate.md`.
