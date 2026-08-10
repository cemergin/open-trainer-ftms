# Changesets

Changesets record the release impact of a pull request. Run `npm run changeset`, select `@open-trainer/ftms`, choose `patch`, `minor`, or `major`, and commit the generated Markdown file with the code change.

Use:

- `patch` for compatible fixes and internal improvements.
- `minor` for compatible new public behavior.
- `major` for breaking public API changes.

While the library is below 1.0, use `minor` for intentional breaking API changes and explain the break clearly in the summary.

Documentation, tests, CI, and changes that do not affect the published package do not need a changeset.
