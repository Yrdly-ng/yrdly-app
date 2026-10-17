# Domain Docs

## Layout

This repository uses a single-context layout: `GLOSSARY.md` at the repository root and architectural decision records in `docs/adr/`. The YRDLY workspace contains separate Git repositories, each with its own domain documents.

## Before exploring

Read `GLOSSARY.md` if present, then read ADRs relevant to the area being changed. If either is absent, proceed with the task. Create glossary entries when terms are resolved, and ADRs when a meaningful architectural trade-off is settled; use the installed `domain-modeling` skill's formats.

For current product behavior, consult `docs/app-reference.md`. For payment terminology and behavior, consult `docs/payments.md` when relevant.

## Vocabulary and decisions

Use glossary terms consistently in code names, tickets, tests, and explanations. Keep the glossary focused on domain definitions. Record implementation decisions in ADRs or feature documentation. Surface conflicts with an existing ADR explicitly before proposing a different decision.
