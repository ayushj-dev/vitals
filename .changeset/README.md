# Changesets

This monorepo uses [Changesets](https://github.com/changesets/changesets) to version and publish the `@vitalsjs/*` packages.

## Workflow

1. After a user-facing change, record it:

   ```bash
   pnpm changeset
   ```

2. When ready to cut a release, bump versions from pending changesets:

   ```bash
   pnpm version-packages
   ```

   This updates `package.json` versions and changelogs. Internal `workspace:*` ranges stay as workspace protocol in the repo; pnpm rewrites them to real versions only in the published tarball.

3. Build and publish all changed packages (public scoped access):

   ```bash
   pnpm release
   ```

   Equivalent to `pnpm build && changeset publish`. You must be logged in to npm (`npm login`) and own the `@vitalsjs` scope.

The three publishable packages are **fixed** together so they share one version number.
