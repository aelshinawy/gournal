# Security policy

## Supported versions

Only the latest release of gournal gets security fixes. Update to the latest release before you report a problem.

## Report a vulnerability

Use GitHub private vulnerability reporting.

1. Open the [Security tab](https://github.com/aelshinawy/gournal/security) of the repository.
2. Select "Report a vulnerability".
3. Fill in the form.

Do not post a vulnerability in a public issue, a pull request, or a discussion.

## What to include

- The gournal version. Run `gournal --version`.
- The Node.js version and the operating system.
- A description of the problem and its impact.
- The steps to reproduce it.
- A proof of concept, if you have one.
- Any fix or mitigation that you suggest.

Do not include real journal entries or other private data in the report.

## Platform notes

On macOS and Linux, gournal sets the mode 0700 on its folders and 0600 on its files. On Windows, gournal cannot set these modes. The journal depends on the permissions of your profile folder. These permissions normally block other standard users. Administrators and the system can still read your files. Do not put `GOURNAL_HOME` on a shared folder.
