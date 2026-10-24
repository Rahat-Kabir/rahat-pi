# Vision

A personal AI agent that its owner hosts and controls, safe to leave running.
It remembers, acts on schedules, reads the owner's services, and changes the
outside world only after the owner approves the exact action.

## Why Pi Durable

An always-on agent will crash, restart, and be interrupted. Rahat-PI is built on
[Pi Durable](https://earendil.com/posts/pi-durable/) so every step is checkpointed:
after a crash it resumes where it stopped, without losing state or repeating an
action. The goal is to prove a personal agent can be always-on and trustworthy.
