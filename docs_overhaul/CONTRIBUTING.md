# Contributing Guide

Thank you for your interest in improving this Solana trading bot.  This project welcomes bug reports, documentation improvements and pull requests.  To help us review contributions efficiently, please follow the guidelines below.

## Code of Conduct

We aim to foster a professional, respectful community.  Be kind, constructive and empathetic when interacting with others.  Harassment, discrimination or abusive language will not be tolerated.  If you experience or witness unacceptable behaviour, please open a confidential issue or email the maintainers.

## Getting Started

1. **Fork the repository** on GitHub and clone your fork locally.
2. **Create a feature branch** off of the default branch.  Use a descriptive name like `feature/add-dca-strategy` or `docs/update-trading-guide`.  For documentation overhauls create a branch named `create-docs/overhaul-YYYYMMDD` where `YYYYMMDD` is today’s date.
3. **Install dependencies** and run a local instance to reproduce the issue or validate your change.  The [Developer Onboarding](docs/ONBOARDING.md) guide walks through setup.
4. **Make your changes**.  If you introduce new environment variables or alter existing ones, update [`docs/CONFIG_REFERENCE.md`](docs/CONFIG_REFERENCE.md).  When adding a new strategy or command, document it in the appropriate file under `docs/`.
5. **Run lint and tests** before opening a pull request.  Use `markdownlint`, `cspell` and `markdown-link-check` to ensure documentation quality.  Write unit or integration tests under `tests/` where applicable.

## Commit Style

Use [Conventional Commits](https://www.conventionalcommits.org/) to structure your commit messages.  The first line should include a **type** (`feat`, `fix`, `docs`, `refactor`, `chore`) and a short description.  Examples:

* `feat(strategy): add trend follower strategy`
* `fix(auth): handle expired nonce gracefully`
* `docs(trading): clarify slippage vs fee interaction`

If your commit fixes a bug, include the issue number.  Keep the body concise and explain **why** the change is necessary.  Avoid committing generated files (e.g. the zipped documentation) or secrets.

## Pull Request Process

1. **Open a draft PR** early if the work is in progress.  This signals intent and allows for feedback.  Use the template in `.github/PULL_REQUEST_TEMPLATE.md`.
2. **Ensure the following checklists pass** before requesting review:
   - [ ] All tests (unit/integration) pass.
   - [ ] Documentation is updated and cross‑linked.
   - [ ] `markdownlint`, `cspell` and `markdown-link-check` report zero errors.  Configuration files are located in the repository root.
   - [ ] No secrets or personal keys are committed.
3. **Request review** from maintainers.  Include a clear summary of your changes, relevant screenshots (e.g. updated dashboards or diagrams) and links to related issues.
4. **Address feedback** promptly.  Squash or rebase your branch to keep history tidy.  Once approved, a maintainer will merge your PR.

## Branch Naming Conventions

| Branch Type | Prefix            | Example                          |
|------------|------------------|----------------------------------|
| Feature    | `feature/`        | `feature/add-parallel-filler`    |
| Fix        | `fix/`            | `fix/telegram-unauthorized`      |
| Docs       | `docs/`           | `docs/update-security`           |
| Chore      | `chore/`          | `chore/dependency-bump`          |
| Docs Overhaul | `create-docs/`   | `create-docs/overhaul-20250810` |

## Style and Formatting

* Use **4‑space indentation** for JavaScript/TypeScript files and **2‑space indentation** for YAML/JSON.
* Prefer [`prettier`](https://prettier.io/) defaults.  Run `prettier --check .` to detect formatting issues.
* For markdown, follow the rules defined in `.markdownlint.json`.  Headings should use title case for H1/H2 and sentence case for H3 and below.  Keep line lengths under 120 characters.
* When adding code examples, annotate them with comments and link to the relevant module or documentation.

## Licensing

By contributing you agree that your work will be incorporated under the repository’s license.  See [`LICENSE`](LICENSE) for details.

## Reporting Issues

Bug reports and feature requests are handled via GitHub Issues.  Use the templates in `.github/ISSUE_TEMPLATE/` to ensure all necessary information is included.  Provide logs, error messages and steps to reproduce when filing a bug.  For sensitive security issues please contact the maintainers directly rather than filing a public issue.

Thank you for contributing to this project!  Your time and effort make the bot safer, faster and more useful for everyone.