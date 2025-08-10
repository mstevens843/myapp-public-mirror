# Changelog

All notable changes to this project will be documented in this file.  The format is based on [Keep a Changelog](https://keepachangelog.com/) and adheres to Semantic Versioning wherever possible.  This seed file includes recent highlights; future releases should append entries chronologically with the newest at the top.

## [Unreleased]

### Added

* **Comprehensive documentation overhaul.**  Consolidated disparate files from `updated_docs/` into a cohesive `docs/` directory.  Added guides for architecture, configuration, deployment, security, trading, wallets, Telegram, performance, testing, troubleshooting, onboarding and subscriptions.  Provided examples for environment configuration, CORS setup, Docker Compose and an OpenAPI stub.  Created issue and pull request templates, lint configs, a manifest and PR draft.
* Added a *paper trader* strategy and documented its use.

### Changed

* Normalised headings to follow title/sentence case as per the style guide.
* Removed Turbo Sniper content from general guides; moved all turbo details to `docs/strategies/turbo.md` and summarised in `docs/BOT_STRATEGIES.md`.
* Added cross‑links between documents for easier navigation.

## [0.1.0] – 2025‑08‑10

Initial release of the public mirror.  Included core trading bot modules, early documentation drafts and the first set of strategies (turbo sniper, scalper, sniper, breakout, dip buyer, trend follower, delayed sniper, rotation bot, rebalancer, chad mode and paper trader).  Implemented envelope encryption, basic Telegram integration, idempotency caching and multi‑RPC quorum sending.
