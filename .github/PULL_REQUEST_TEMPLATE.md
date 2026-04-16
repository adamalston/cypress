<!-- Thanks for contributing! PLEASE...
- Read our contributing guidelines: https://github.com/cypress-io/cypress/blob/develop/CONTRIBUTING.md 
- Read our Code Review Checklist on coding standards and what needs to be done before a PR can be merged: https://github.com/cypress-io/cypress/blob/develop/CONTRIBUTING.md#Code-Review-Checklist
- Mark this PR as "Draft" if it is not ready for review.
- Make sure you set the correct base branch based on what packages you're changing: https://github.com/cypress-io/cypress/blob/develop/CONTRIBUTING.md#branches
-->

- Closes <!-- link to the issue here, if there is one -->

### Additional details
<!-- Examples:
- Why was this change necessary?
- What is affected by this change?
- Any implementation details to explain?
-->

Following the updates to read related commands in https://github.com/cypress-io/cypress/pull/33538, it made sense to update the write command for consistency.

I replaced that transport with the same split authorization and transfer pattern used by the read side. The driver now requests a one time privileged file write token over the existing backend channel, then uploads the authorized contents to a new HTTP endpoint. The server consumes that token once, streams the request body into a write stream, and returns the resolved file path.

I added and updated coverage for the new path:

- Driver coverage for privileged `writeFile` token creation and HTTP upload behavior.
- Driver coverage that verifies `writeFile` no longer relies on the old privileged socket response and that binary contents are uploaded through the new path.
- Server coverage for one time privileged file write tokens, rejection of unverified privileged file writes in e2e mode, rejection of unsupported privileged file write commands, and privileged file write controller error paths.

<!-- CURSOR_SUMMARY -->
<!-- /CURSOR_SUMMARY -->

### Steps to test
<!--
For non-trivial behavior changes, list the steps that a reviewer should follow to validate the new behavior.
This is not meant to be the only testing performed by a reviewer, just the "happy path" that leads to the new behavior.
-->

```sh
yarn workspace @packages/server test-unit controllers_files_spec.js
yarn workspace @packages/server test-unit privileged_commands_manager_spec.ts
yarn workspace @packages/runner build
yarn workspace @packages/driver cypress:run --spec cypress/e2e/commands/files.cy.js
```

### How has the user experience changed?
<!-- Provide before and after examples of the change.
Screenshots or GIFs are preferred. -->

Before, `writeFile` sent the full file contents to the server in one privileged socket payload.

After, Cypress authorizes the write over the backend channel and uploads the file contents over a dedicated HTTP endpoint, reducing reliance on a monolithic privileged socket message for large writes.

### PR Tasks
<!-- 
These tasks must be completed before a PR is merged.
If a task does not apply, write [na] instead of checking the box.
DO NOT DELETE the PR checklist.
-->

- [ ] Have tests been added/updated?
- [ ] Has a PR for user-facing changes been opened in [`cypress-documentation`](https://github.com/cypress-io/cypress-documentation)? <!-- Link to PR here -->
- [ ] Have API changes been updated in the [`type definitions`](https://github.com/cypress-io/cypress/blob/develop/cli/types/cypress.d.ts)?
