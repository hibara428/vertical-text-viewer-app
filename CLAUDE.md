# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Requirements and system design are documented; no application code exists yet.
The viewer design (`docs/viewer-design.md`) is still being worked out.

## Documents

- `docs/requirements.md` — what to build (scope, content constraints, viewer requirements)
- `docs/design.md` — system design (architecture, data schema, search, implementation roadmap)
- `docs/viewer-design.md` — viewer detail design (Aozora notation parser, reading modes)

## Project concept

A Japanese vertical-writing (縦書き) viewer site for Aozora Bunko (青空文庫) works. No CMS.
The point of the project is to build and compare several reading modes (horizontal/vertical,
scroll/page-turn), and converge on a good one.

Scope covers all public-domain Aozora Bunko works. Work text is fetched on demand at the edge
straight from `www.aozora.gr.jp` (the official zip) and cached in Workers KV; browsing and
search pages are statically generated. Community mirrors were evaluated and rejected — they
are dead or stale. See `docs/design.md` for details and for the rejected alternatives.

The author keeps a separate personal site sharing these conventions (content-as-files, no CMS,
low-cost static hosting), built on Astro + Tailwind CSS + TypeScript and deployed to Cloudflare.
Prefer the same stack choices here.
