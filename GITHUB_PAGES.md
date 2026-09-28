# Publish with GitHub Pages

The app is a static site. GitHub Pages hosts it over HTTPS for free from this public repository:

- Ride app: <https://cemergin.github.io/open-trainer-ftms/>
- Trainer diagnostics: <https://cemergin.github.io/open-trainer-ftms/lab.html>

Publishing is manual: merging source changes into `main` does not update the live site. The commands below publish the current checkout.

## Deploy

Install the dependencies with `npm ci`, and authenticate [GitHub CLI](https://cli.github.com/) with `gh auth login`. The signed-in account needs permission to push this repository and manage its Pages settings. A classic token with the `repo` scope is sufficient; no workflow token scope is needed.

Check the current changes before committing:

```sh
node scripts/publish-pages.mjs --dry-run
```

Commit and push the source changes, then publish:

```sh
node scripts/publish-pages.mjs
```

The command runs type checking, tests, and the production build, and checks that the app and diagnostics page use valid relative asset paths. It publishes only `apps/trainer-lab/dist` plus `.nojekyll` to the dedicated `gh-pages` branch and enables Pages with that branch's root directory as its source. An existing custom domain is retained.

The source checkout must be clean for publication. Deployment commits preserve `gh-pages` history and use a normal push; the command never force-pushes or changes the source branch. GitHub credentials are supplied through `gh` for this command only. An existing Pages configuration using another source must be reviewed before switching.

GitHub can take a few minutes to make the new site available. Inspect its status with:

```sh
gh api repos/cemergin/open-trainer-ftms/pages
gh api repos/cemergin/open-trainer-ftms/pages/builds/latest
```

GitHub documents [branch publishing](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) and the [Pages API](https://docs.github.com/en/rest/pages/pages).
