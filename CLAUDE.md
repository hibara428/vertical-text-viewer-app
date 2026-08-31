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
via the jsDelivr mirror of `aozorabunko/aozorabunko`; browsing and search pages are statically
generated. See `docs/design.md` for details.

Sibling project sharing conventions (content-as-files, no CMS, low-cost static hosting):
[hibara428/hibara428-personal](https://github.com/hibara428/hibara428-personal) — Astro + Tailwind CSS + TypeScript, Cloudflare Pages.
