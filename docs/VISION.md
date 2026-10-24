# Vision

A personal AI agent that its owner hosts and controls. It should be safe to
leave running: it remembers, acts on schedules, reads the owner's services,
and only changes the outside world after the owner approves the exact action.

## Success criteria (M1)
Five crash-and-restart demos pass on a Linux machine:

1. A preference is remembered after a restart.
2. A scheduled briefing runs once per occurrence, even after a restart.
3. A draft action survives a restart while waiting for approval.
4. Approving it runs the (fake) send exactly once.
5. A crash after dispatch but before the receipt is saved shows `unknown` and does not resend.
